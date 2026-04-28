import { Args, Flags } from "@oclif/core";
import { getAccountAddress, isGroup } from "../../utils/xmtp.js";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getIdentityAndClient } from "../../utils/client.js";
import { parseInvite, verifyInvite, inviteToSlug } from "../../utils/invite.js";
import { parseAppData } from "../../utils/metadata.js";
import {
  sendProfileUpdate,
  MemberKind,
  parseMetadataFlags,
  type ProfileMetadata,
} from "../../utils/profileMessages.js";
import {
  JoinRequestCodec,
  type JoinRequestContent,
} from "../../utils/joinRequest.js";

export default class ConversationsJoin extends ConvosBaseCommand {
  static description = `Join a conversation using an invite slug or URL.

Uses this install's singleton identity (per ADR 011) to send a join
request to the creator.

Steps:
1. Parse and validate the invite (verify signature, check expiration)
2. DM the creator's inbox with the invite slug + joiner profile
3. Wait for the creator's client to process the request and add us
4. Send a ProfileUpdate once joined

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
    "profile-name": Flags.string({
      description: "Profile display name to use in this conversation",
      helpValue: "<name>",
    }),
    "profile-image": Flags.string({
      description: "Profile image URL to use in this conversation",
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

    const meta = parseMetadataFlags(flags.metadata, (msg) => this.error(msg));
    const parsedMetadata = meta?.parsedMetadata;
    const joinMetadata = meta?.joinMetadata;

    const invite = parseInvite(args.invite);

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

    const { identity, client } = await getIdentityAndClient(
      config,
      this.getConvosHome(),
    );

    if (invite.creatorInboxId === client.inboxId) {
      this.error(
        "Invite was created by this install — you cannot join your own conversation.",
      );
    }

    this.log(
      `Identity ${identity.id.slice(0, 12)}... (${getAccountAddress(identity.walletKey)})`,
    );
    this.log(`Sending join request to creator inbox ${invite.creatorInboxId.slice(0, 12)}...`);

    // createDm is idempotent — returns the existing DM with the creator if we
    // already have one (e.g. from a previous join attempt for another invite)
    const dm = await client.conversations.createDm(invite.creatorInboxId);

    // Record group IDs that existed before the join, so we can identify
    // the newly-added group after the creator accepts.
    await client.conversations.sync();
    const preJoinGroupIds = new Set<string>();
    for (const conv of await client.conversations.list()) {
      if (conv.id !== dm.id) preJoinGroupIds.add(conv.id);
    }

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

    this.log(`Waiting for acceptance (timeout: ${flags.timeout}s)...`);

    const startTime = Date.now();
    const timeoutMs = flags.timeout * 1000;
    let conversationId: string | undefined;

    while (Date.now() - startTime < timeoutMs) {
      await client.conversations.sync();
      const conversations = await client.conversations.list();

      for (const conv of conversations) {
        if (conv.id === dm.id) continue;
        if (preJoinGroupIds.has(conv.id)) continue;
        conversationId = conv.id;
        break;
      }

      if (conversationId) break;

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

    // Verify the group's invite tag matches (ADR 001 safety check)
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

    // Send ProfileUpdate message (primary profile source).
    // Always send to set memberKind: Agent (and name/image/metadata if provided).
    try {
      await client.conversations.sync();
      const conv = await client.conversations.getConversationById(conversationId);
      if (conv && isGroup(conv)) {
        await conv.sync();
        const profileName = flags["profile-name"] ?? identity.profileName;
        const profileImage = flags["profile-image"] ?? identity.profileImageUrl;

        let encryptedImage: import("../../utils/profileMessages.js").EncryptedProfileImageRef | undefined;
        if (profileImage) {
          try {
            const { getUploadProvider } = await import("../../utils/upload.js");
            const { encryptAndUploadProfileImage } = await import("../../utils/imageEncryption.js");

            const uploadProvider = getUploadProvider(config);
            if (uploadProvider) {
              encryptedImage = await encryptAndUploadProfileImage(
                profileImage,
                conv,
                (data, filename, mimeType) => uploadProvider.upload(data, filename, mimeType),
                { verboseLog: (m) => this.verboseLog(m) },
              );
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
