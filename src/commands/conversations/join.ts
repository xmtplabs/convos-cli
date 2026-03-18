import { Args, Flags } from "@oclif/core";
import { getAccountAddress, isGroup } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { createClientForIdentity } from "../../utils/client.js";
import { createIdentityStore } from "../../utils/identities.js";
import { parseInvite, verifyInvite, inviteToSlug } from "../../utils/invite.js";
import { parseAppData } from "../../utils/metadata.js";
import { sendProfileUpdate, MemberKind, type ProfileMetadata } from "../../utils/profileMessages.js";
import {
  JoinRequestCodec,
  type JoinRequestContent,
} from "../../utils/joinRequest.js";

export default class ConversationsJoin extends ConvosBaseCommand {
  static description = `Join a conversation using an invite slug or URL.

Implements the Convos join flow (per ADR 001):

1. Parse and validate the invite (verify signature, check expiration)
2. Create a new per-conversation identity for this conversation
3. Send the invite slug as a DM to the creator's inbox
4. Wait for the creator's client to process the join request and
   add this identity to the conversation
5. Link the identity to the conversation once joined

The creator's client (iOS app or another CLI instance running
'convos conversations process-join-requests') must be online to
process the join request.

Accepts either a raw invite slug or a full URL containing the
slug as query parameter 'i'.`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %> <invite-slug>",
      description: "Join using a raw invite slug",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> "https://popup.convos.org/v2?i=<slug>"',
      description: "Join using a full invite URL",
    },
    {
      command:
        "<%= config.bin %> <%= command.id %> <slug> --no-wait",
      description: "Send join request without waiting for acceptance",
    },
    {
      command:
        "<%= config.bin %> <%= command.id %> <slug> --timeout 120 --json",
      description: "Wait up to 2 minutes for acceptance",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> <slug> --profile-name "Bot" --profile-image "https://example.com/avatar.jpg"',
      description: "Join with a display name and avatar",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> <slug> --metadata role=assistant --metadata version=2',
      description: "Join with custom metadata",
    },
  ];

  static args = {
    invite: Args.string({
      description: "Invite slug or URL",
      required: true,
    }),
  };

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    "no-wait": Flags.boolean({
      description:
        "Send the join request but don't wait for the creator to accept",
      default: false,
    }),
    timeout: Flags.integer({
      description: "Seconds to wait for acceptance (default: 60)",
      helpValue: "<seconds>",
      default: 60,
    }),
    label: Flags.string({
      description: "Local label for the new identity",
      helpValue: "<label>",
    }),
    "profile-name": Flags.string({
      description: "Profile display name for this conversation",
      helpValue: "<name>",
    }),
    "profile-image": Flags.string({
      description: "Profile image URL for this conversation",
      helpValue: "<url>",
    }),
    metadata: Flags.string({
      description:
        'Set a metadata field on the join request and profile (key=value). ' +
        'Value is auto-typed: "true"/"false" → bool, numeric → number, else string. ' +
        "Repeat for multiple fields.",
      helpValue: "<key=value>",
      multiple: true,
    }),
    identity: Flags.string({
      description: "Use an existing unlinked identity instead of creating one",
      helpValue: "<id>",
    }),
    attestation: Flags.string({
      description: "Base64url-encoded Ed25519 attestation signature",
      helpValue: "<signature>",
      env: "CONVOS_ATTESTATION",
    }),
    "attestation-ts": Flags.string({
      description: "ISO 8601 timestamp used in the attestation",
      helpValue: "<iso8601>",
      env: "CONVOS_ATTESTATION_TS",
    }),
    "attestation-kid": Flags.string({
      description: "Key ID for the attestation",
      helpValue: "<kid>",
      env: "CONVOS_ATTESTATION_KID",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConversationsJoin);
    const config = this.getConvosConfig();
    const store = createIdentityStore(this.getConvosHome());

    // Parse metadata flags into typed ProfileMetadata + flat string map for JoinRequest
    let parsedMetadata: ProfileMetadata | undefined;
    let joinMetadata: Record<string, string> | undefined;
    if (flags.metadata && flags.metadata.length > 0) {
      parsedMetadata = {};
      joinMetadata = {};
      for (const entry of flags.metadata) {
        const eqIdx = entry.indexOf("=");
        if (eqIdx === -1) {
          this.error(`Invalid metadata format: "${entry}". Expected key=value`);
        }
        const key = entry.slice(0, eqIdx);
        const rawValue = entry.slice(eqIdx + 1);

        if (!key) {
          this.error(`Empty metadata key in "${entry}"`);
        }

        // Flat string map for JoinRequest
        joinMetadata[key] = rawValue;

        // Auto-type the value for ProfileMetadata: bool → number → string
        if (rawValue === "true" || rawValue === "false") {
          parsedMetadata[key] = { type: "bool", value: rawValue === "true" };
        } else if (rawValue !== "" && !isNaN(Number(rawValue))) {
          parsedMetadata[key] = { type: "number", value: Number(rawValue) };
        } else {
          parsedMetadata[key] = { type: "string", value: rawValue };
        }
      }
    }

    // Step 1: Parse invite
    const invite = parseInvite(args.invite);

    // Validate
    if (!(await verifyInvite(invite))) {
      this.error("Invalid invite signature");
    }

    if (invite.expiresAt && invite.expiresAt < new Date()) {
      this.error("Invite has expired");
    }

    if (invite.conversationExpiresAt && invite.conversationExpiresAt < new Date()) {
      this.error("Conversation has expired");
    }

    this.log(
      `Invite parsed: tag=${invite.tag}` +
        (invite.name ? ` name="${invite.name}"` : "") +
        ` creator=${invite.creatorInboxId.slice(0, 12)}...`,
    );

    // Check if we've already joined this conversation (same invite tag)
    const existingIdentity = store.getByInviteTag(invite.tag);
    if (existingIdentity) {
      this.error(
        `Already joined this conversation.\n` +
          `  Identity: ${existingIdentity.id}\n` +
          `  Conversation: ${existingIdentity.conversationId ?? "(pending)"}\n` +
          `  Label: ${existingIdentity.label ?? ""}\n\n` +
          `Use 'convos conversation send-text ${existingIdentity.conversationId ?? "<id>"}' to send messages.`,
      );
    }

    // Step 2: Get or create identity
    let identity;
    if (flags.identity) {
      identity = store.get(flags.identity);
      if (!identity) this.error(`Identity not found: ${flags.identity}`);
      if (identity.conversationId) {
        this.error(`Identity already linked to conversation ${identity.conversationId}`);
      }
    } else {
      identity = store.create({
        label: flags.label ?? invite.name,
        profileName: flags["profile-name"],
      });
    }

    // Store invite tag immediately so duplicate detection works even if we exit early
    store.update(identity.id, { inviteTag: invite.tag });

    // Step 3: Create XMTP client and send DM to creator
    const client = await createClientForIdentity(identity, config, this.getConvosHome());

    this.log(`Created identity ${identity.id.slice(0, 12)}... (${getAccountAddress(identity.walletKey)})`);
    this.log(`Sending join request to creator inbox ${invite.creatorInboxId.slice(0, 12)}...`);

    // Create DM with creator using their XMTP inbox ID
    const dm = await client.conversations.createDm(invite.creatorInboxId);

    // Send JoinRequest content type (new format) + plain text slug (backward compat)
    const slug = inviteToSlug(invite);
    const joinRequest: JoinRequestContent = {
      inviteSlug: slug,
      profile: {
        ...(flags["profile-name"] && { name: flags["profile-name"] }),
        ...(flags["profile-image"] && { imageURL: flags["profile-image"] }),
        memberKind: "agent",
      },
      ...(joinMetadata && { metadata: joinMetadata }),
    };
    const codec = new JoinRequestCodec();
    const encoded = codec.encode(joinRequest);
    await dm.send(encoded);
    // Also send plain text slug for older iOS clients that don't understand JoinRequestContent
    await dm.sendText(slug);

    this.log("Join request sent.");

    if (flags["no-wait"]) {
      if (flags.attestation || flags["attestation-ts"] || flags["attestation-kid"]) {
        this.warn(
          "Attestation flags have no effect with --no-wait. " +
          "Attestation metadata is sent via ProfileUpdate after joining, " +
          "which requires waiting for acceptance.",
        );
      }
      this.output({
        status: "request_sent",
        identityId: identity.id,
        address: getAccountAddress(identity.walletKey),
        inboxId: client.inboxId,
        creatorInboxId: invite.creatorInboxId,
        tag: invite.tag,
        conversationName: invite.name ?? null,
        profileName: flags["profile-name"] ?? null,
        profileImage: flags["profile-image"] ?? null,
        ...(joinMetadata && { metadata: joinMetadata }),
        message:
          "Join request sent. The creator must accept it. " +
          "Run 'convos conversations list --sync' to check if you've been added.",
      });
      return;
    }

    // Step 4: Wait for acceptance (poll for new group conversations)
    this.log(`Waiting for acceptance (timeout: ${flags.timeout}s)...`);

    const startTime = Date.now();
    const timeoutMs = flags.timeout * 1000;
    let conversationId: string | undefined;

    while (Date.now() - startTime < timeoutMs) {
      await client.conversations.sync();
      const conversations = await client.conversations.list();

      // Look for a new group conversation (not the DM we created)
      for (const conv of conversations) {
        if (conv.id !== dm.id) {
          conversationId = conv.id;
          break;
        }
      }

      if (conversationId) break;

      // Poll every 2 seconds
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    if (!conversationId) {
      this.log("Timed out waiting for acceptance.");
      this.output({
        status: "timeout",
        identityId: identity.id,
        address: getAccountAddress(identity.walletKey),
        inboxId: client.inboxId,
        tag: invite.tag,
        message:
          "The creator has not yet accepted the join request. " +
          "Run 'convos conversations list --sync' later to check.",
      });
      return;
    }

    // Step 5: Verify the group's invite tag matches the invite we used (ADR 001)
    // This protects against being added to a different conversation than requested.
    try {
      const conv = await client.conversations.getConversationById(conversationId);
      if (conv && isGroup(conv)) {
        const appData = conv.appData ?? "";
        const metadata = parseAppData(appData);
        if (metadata.tag && metadata.tag !== invite.tag) {
          this.warn(
            `Invite tag mismatch: expected "${invite.tag}" but group has "${metadata.tag}". ` +
            "You may have been added to a different conversation than expected.",
          );
        }

      }
    } catch {
      // Non-fatal: tag verification is a safety check, don't block joining
    }

    // Step 6: Write joiner's profile via ProfileUpdate message.
    // We intentionally do NOT write profiles to appData to avoid the
    // read-modify-write race that can corrupt invite tags and erase
    // other members' profiles.
    // Always send a ProfileUpdate to set memberKind: Agent (and name/image/metadata if provided).
    try {
      await client.conversations.sync();
      const conv = await client.conversations.getConversationById(conversationId);
      if (conv && isGroup(conv)) {
        await conv.sync();
        const profileName = flags["profile-name"];
        const profileImage = flags["profile-image"];

        // If an image URL is provided, encrypt and upload it
        let encryptedImage: import("../../utils/profileMessages.js").EncryptedProfileImageRef | undefined;
        if (profileImage) {
          try {
            const { getUploadProvider } = await import("../../utils/upload.js");
            const { encryptImage, fetchImageData, generateGroupKey } = await import("../../utils/imageEncryption.js");
            const { serializeAppData } = await import("../../utils/metadata.js");

            const uploadProvider = getUploadProvider(config);
            if (uploadProvider) {
              // Get or generate the group's image encryption key
              await conv.sync();
              const appData = conv.appData ?? "";
              const groupMetadata = parseAppData(appData);
              let groupKey = groupMetadata.imageEncryptionKey;

              if (!groupKey || groupKey.length === 0) {
                groupKey = generateGroupKey();
                groupMetadata.imageEncryptionKey = groupKey;
                await conv.updateAppData(serializeAppData(groupMetadata));
              }

              // Download, encrypt, and upload the image
              const imageData = await fetchImageData(profileImage);
              const payload = await encryptImage(imageData, groupKey);
              const filename = `ep-${Date.now()}.enc`;
              const assetUrl = await uploadProvider.upload(
                payload.ciphertext,
                filename,
                "application/octet-stream",
              );

              encryptedImage = {
                url: assetUrl,
                salt: payload.salt,
                nonce: payload.nonce,
              };
            } else {
              this.warn(
                "Image upload requires an upload provider. Set CONVOS_API_KEY or CONVOS_UPLOAD_PROVIDER. Skipping image.",
              );
            }
          } catch (imgError) {
            this.warn(
              `Could not encrypt/upload profile image: ${imgError instanceof Error ? imgError.message : "unknown"}`,
            );
          }
        }

        // Merge attestation metadata if provided
        let allMetadata = parsedMetadata;
        if (flags.attestation && flags["attestation-ts"] && flags["attestation-kid"]) {
          const attestationMeta: ProfileMetadata = {
            attestation: { type: "string", value: flags.attestation },
            attestation_ts: { type: "string", value: flags["attestation-ts"] },
            attestation_kid: { type: "string", value: flags["attestation-kid"] },
          };
          allMetadata = { ...(allMetadata ?? {}), ...attestationMeta };
        }

        await sendProfileUpdate(conv, {
          ...(profileName && { name: profileName }),
          ...(encryptedImage && { encryptedImage }),
          ...(allMetadata && Object.keys(allMetadata).length > 0 && { metadata: allMetadata }),
          memberKind: MemberKind.Agent,
        });
      }
    } catch (error) {
      this.warn(
        `Could not send ProfileUpdate message: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }

    // Step 7: Link identity to conversation
    store.update(identity.id, {
      conversationId,
      inboxId: client.inboxId,
      inviteTag: invite.tag,
      label: flags.label ?? invite.name ?? identity.label,
      profileName: flags["profile-name"] ?? identity.profileName,
      profileImageUrl: flags["profile-image"] ?? identity.profileImageUrl,
    });

    this.output({
      status: "joined",
      conversationId,
      identityId: identity.id,
      address: getAccountAddress(identity.walletKey),
      inboxId: client.inboxId,
      tag: invite.tag,
      conversationName: invite.name ?? null,
      profileName: flags["profile-name"] ?? null,
      profileImage: flags["profile-image"] ?? null,
      ...(joinMetadata && { metadata: joinMetadata }),
    });
  }
}
