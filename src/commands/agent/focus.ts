import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { Args, Flags } from "@oclif/core";
import type { AsyncStreamProxy, Client, DecodedMessage, Group } from "@xmtp/node-sdk";
import { ConvosBaseCommand } from "../../baseCommand.js";
import { getIdentityAndClient } from "../../utils/client.js";
import {
  inviteToSlug,
  parseInvite,
  verifyInvite,
} from "../../utils/invite.js";
import { JoinRequestCodec, type JoinRequestContent } from "../../utils/joinRequest.js";
import {
  FocusModeControlCodec,
  getFocusModeControlContent,
  isFocusModeControlMessage,
  type FocusModeControl,
} from "../../utils/focusModeControl.js";
import {
  StreamingTextCodec,
  getStreamingTextContent,
  isStreamingTextMessage,
  type StreamingText,
} from "../../utils/streamingText.js";
import {
  STREAMING_CLEAR_DELAY_MS,
  StreamingClearCodec,
  getStreamingClearContent,
  isStreamingClearMessage,
  type StreamingClear,
} from "../../utils/streamingClear.js";
import {
  getConversationSnapshotContent,
  isConversationSnapshotMessage,
} from "../../utils/conversationSnapshot.js";
import { isGroup, jsonStringify, requireGroup } from "../../utils/xmtp.js";
import {
  attestationToProfileMetadata,
  resolveAttestationFromFlags,
} from "../../utils/attestation.js";
import {
  MemberKind,
  parseMetadataFlags,
  resolveProfilesFromMessages,
  sendProfileUpdate,
  type EncryptedProfileImageRef,
  type ProfileMetadata,
} from "../../utils/profileMessages.js";
import { encryptAndUploadProfileImage } from "../../utils/imageEncryption.js";
import { getUploadProvider } from "../../utils/upload.js";

interface RemoteBubble {
  text: string;
  lastRevision: number;
  clearTimer?: NodeJS.Timeout;
}

interface SessionState {
  sessionId: string;
  focusedInboxId: string | null;
  state: "started" | "stopped";
  bubbles: Map<string, RemoteBubble>;
  /** Our local revision counter, shared between StreamingText and StreamingClear. */
  localRevision: number;
}

interface TextCommand {
  type: "text";
  text: string;
}
interface ClearCommand {
  type: "clear";
}
interface ProfileCommand {
  type: "profile";
  name?: string;
  image?: string;
  metadata?: Record<string, string | number | boolean>;
}
interface StopCommand {
  type: "stop";
}
type FocusCommand =
  | TextCommand
  | ClearCommand
  | ProfileCommand
  | StopCommand;

function toProfileMetadata(
  raw: Record<string, string | number | boolean>,
): ProfileMetadata {
  const out: ProfileMetadata = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "boolean") out[key] = { type: "bool", value };
    else if (typeof value === "number") out[key] = { type: "number", value };
    else out[key] = { type: "string", value };
  }
  return out;
}

export default class AgentFocus extends ConvosBaseCommand {
  static description = `Run an agent in Assistant Builder Focus Mode.

Joins a conversation by invite, waits for the iOS-side
FocusModeControl(.start) message, then participates in a real-time
co-typing session via three silent content types:

  - convos.org/focus_mode_control:1.0   session lifecycle
  - convos.org/streaming_text:1.0       full bubble snapshots (with revision)
  - convos.org/streaming_clear:1.0      end-of-thought clear

Each StreamingText carries the FULL current bubble content (not a
delta). Receivers compare revisions to drop stale arrivals. Revisions
are monotonic per (sessionId, senderInboxId) and shared between
StreamingText and StreamingClear.

Uses an ndjson protocol on stdin / stdout — symmetric with 'agent serve'.

STDIN commands (one JSON object per line):
  {"type":"text","text":"Hello"}                     Publish a snapshot of the current bubble
  {"type":"clear"}                                   Send StreamingClear (end of thought)
  {"type":"profile","name":"X","metadata":{"k":"v"}} Update display name / metadata mid-session
  {"type":"stop"}                                    Send FocusModeControl(.stop) and exit

STDOUT events (ndjson):
  {"event":"joined","conversationId":"..."}
  {"event":"focus_pending","sessionId":"..."}
  {"event":"focused","sessionId":"...","focusedInboxId":"..."}
  {"event":"streaming_text","sessionId":"...","senderInboxId":"...","revision":N,"text":"..."}
  {"event":"streaming_clear","sessionId":"...","senderInboxId":"...","revision":N}
  {"event":"focus_stopped","sessionId":"..."}
  {"event":"sent","id":"...","type":"text|clear|stop","revision":N?}
  {"event":"error","message":"..."}`;

  static examples = [
    {
      command: "<%= config.bin %> <%= command.id %> <invite-slug>",
      description: "Join the build session by invite slug and wait for focus",
    },
    {
      command: "<%= config.bin %> <%= command.id %> <slug> --persona ./persona.txt",
      description: "Run with a persona file (emitted in the joined event)",
    },
    {
      command: "<%= config.bin %> <%= command.id %> <slug> --auto-stop-after 60",
      description: "Send FocusModeControl(.stop) after 60s of receiver silence",
    },
    {
      command:
        '<%= config.bin %> <%= command.id %> <slug> --profile-name "Bot" \\\n  --attestation-kid <kid> --attestation-private-key ./signing.pem',
      description:
        "Join as a verified assistant — signs an attestation against the resolved inbox id and ships it on the post-join ProfileUpdate",
    },
  ];

  static args = {
    invite: Args.string({
      description: "Invite slug or URL from the iOS bootstrap sheet",
      required: true,
    }),
  };

  static flags = {
    ...ConvosBaseCommand.baseFlags,
    "auto-stop-after": Flags.integer({
      description:
        "Seconds of inactivity (no incoming StreamingText/Clear) before " +
        "auto-sending FocusModeControl(.stop). Disabled if omitted.",
      helpValue: "<seconds>",
    }),
    persona: Flags.string({
      description:
        "Path to a text file describing how the agent should behave. " +
        "Contents are emitted on the 'joined' event for downstream consumers.",
      helpValue: "<path>",
    }),
    "join-timeout": Flags.integer({
      description: "Seconds to wait for the creator to accept the join request",
      helpValue: "<seconds>",
      default: 60,
    }),
    "focus-timeout": Flags.integer({
      description:
        "Seconds to wait for the iOS-initiated FocusModeControl(.start) " +
        "before exiting with an error.",
      helpValue: "<seconds>",
      default: 120,
    }),
    "profile-name": Flags.string({
      description: "Profile display name to send on the post-join ProfileUpdate",
      helpValue: "<name>",
    }),
    "profile-image": Flags.string({
      description: "Profile image URL to send on the post-join ProfileUpdate",
      helpValue: "<url>",
    }),
    "profile-metadata": Flags.string({
      description:
        'Set a profile metadata field on the post-join ProfileUpdate (key=value). ' +
        'Value is auto-typed: "true"/"false" → bool, numeric → number, else string. ' +
        "Repeat for multiple fields. Folded in alongside attestation metadata.",
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
    "attestation-private-key": Flags.string({
      description:
        "Path to an Ed25519 private key (PEM). When set with --attestation-kid, " +
        "the CLI signs the attestation against the resolved XMTP inbox id once the " +
        "join is accepted. Mutually exclusive with --attestation / --attestation-ts.",
      helpValue: "<path>",
      env: "CONVOS_ATTESTATION_PRIVATE_KEY",
    }),
  };

  private sessions = new Map<string, SessionState>();
  private streams: AsyncStreamProxy<DecodedMessage<unknown>>[] = [];
  private autoStopTimer?: NodeJS.Timeout;
  private autoStopAfterMs?: number;
  private shuttingDown = false;
  private rl?: ReturnType<typeof createInterface>;

  async run(): Promise<void> {
    const { args, flags } = await this.parse(AgentFocus);
    const config = this.getConvosConfig();

    if (flags["auto-stop-after"] !== undefined && flags["auto-stop-after"] <= 0) {
      this.error("--auto-stop-after must be a positive integer");
    }
    this.autoStopAfterMs =
      flags["auto-stop-after"] !== undefined
        ? flags["auto-stop-after"] * 1000
        : undefined;

    let persona: string | undefined;
    if (flags.persona) {
      try {
        persona = await readFile(flags.persona, "utf-8");
      } catch (error) {
        this.error(
          `Could not read persona file ${flags.persona}: ${
            error instanceof Error ? error.message : "unknown"
          }`,
        );
      }
    }

    const invite = parseInvite(args.invite);
    if (!(await verifyInvite(invite))) {
      this.error("Invalid invite signature");
    }
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      this.error("Invite has expired");
    }

    const { client } = await getIdentityAndClient(config, this.getConvosHome());

    if (invite.creatorInboxId === client.inboxId) {
      this.error(
        "Invite was created by this install — focus mode requires a different creator.",
      );
    }

    const conversation = await this.joinByInvite(
      client,
      invite,
      flags["join-timeout"],
    );

    const attestation = await resolveAttestationFromFlags(flags, client.inboxId);
    const startupMetadata = parseMetadataFlags(
      flags["profile-metadata"],
      (msg) => this.error(msg),
    )?.parsedMetadata;
    await this.publishProfileUpdate(conversation, {
      profileName: flags["profile-name"],
      profileImageUrl: flags["profile-image"],
      profileMetadata: startupMetadata,
      attestation,
    });

    this.emit({
      event: "joined",
      conversationId: conversation.id,
      inboxId: client.inboxId,
      ...(persona && { persona }),
      ...(attestation && { attestationKid: attestation.kid }),
    });

    process.on("SIGINT", () => this.shutdown("SIGINT"));
    process.on("SIGTERM", () => this.shutdown("SIGTERM"));

    this.startStdinReader(conversation, client);
    await this.startMessageStream(conversation, client, flags["focus-timeout"]);
  }

  private async publishProfileUpdate(
    conversation: Group,
    opts: {
      profileName?: string;
      profileImageUrl?: string;
      profileMetadata?: ProfileMetadata;
      attestation?: Awaited<ReturnType<typeof resolveAttestationFromFlags>>;
    },
  ): Promise<void> {
    const { profileName, profileImageUrl, profileMetadata, attestation } = opts;
    const hasAttestation = attestation !== undefined && attestation !== null;
    if (
      !profileName &&
      !profileImageUrl &&
      !hasAttestation &&
      (!profileMetadata || Object.keys(profileMetadata).length === 0)
    ) {
      // Nothing worth sending: leave it to identity defaults.
      return;
    }

    // Attestation metadata wins on conflict — the attestation triple is
    // signed against the inbox id and shouldn't be overridden by user flags.
    const merged: ProfileMetadata = { ...(profileMetadata ?? {}) };
    if (hasAttestation) {
      Object.assign(merged, attestationToProfileMetadata(attestation));
    }

    try {
      await conversation.sync();
      await sendProfileUpdate(conversation, {
        ...(profileName && { name: profileName }),
        ...(profileImageUrl && { imageURL: profileImageUrl }),
        ...(Object.keys(merged).length > 0 && { metadata: merged }),
        memberKind: MemberKind.Agent,
      });
    } catch (error) {
      this.emitError(
        `ProfileUpdate failed: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }
  }

  /**
   * Mid-session profile update triggered by a {"type":"profile",...} stdin
   * command. Mirrors `convos conversation update-profile` semantics: existing
   * profile is read first, partial updates merge in (don't clear other fields).
   */
  private async runProfileCommand(
    conversation: Group,
    client: Client<unknown>,
    cmd: ProfileCommand,
    config: ReturnType<ConvosBaseCommand["getConvosConfig"]>,
  ): Promise<void> {
    if (
      cmd.name === undefined &&
      cmd.image === undefined &&
      (!cmd.metadata || Object.keys(cmd.metadata).length === 0)
    ) {
      this.emitError(
        "profile command requires at least one of name, image, or metadata",
      );
      return;
    }

    let existing: import("../../utils/profileMessages.js").ResolvedProfile | undefined;
    try {
      const profiles = await resolveProfilesFromMessages(conversation);
      existing = profiles.get(client.inboxId.toLowerCase());
    } catch {
      // Best-effort: if we can't read existing, send what we have.
    }

    const profileName =
      cmd.name !== undefined ? cmd.name || undefined : existing?.name;

    let encryptedImage: EncryptedProfileImageRef | undefined;
    if (cmd.image !== undefined) {
      if (cmd.image === "") {
        encryptedImage = undefined;
      } else {
        const uploadProvider = getUploadProvider(config);
        if (!uploadProvider) {
          this.emitError(
            "image update requires an upload provider (CONVOS_API_KEY or CONVOS_UPLOAD_PROVIDER)",
          );
          return;
        }
        try {
          encryptedImage = await encryptAndUploadProfileImage(
            cmd.image,
            conversation,
            (data, filename, mimeType) =>
              uploadProvider.upload(data, filename, mimeType),
            { verboseLog: (m) => this.verboseLog(m) },
          );
        } catch (error) {
          this.emitError(
            `image upload failed: ${error instanceof Error ? error.message : "unknown"}`,
          );
          return;
        }
      }
    } else {
      encryptedImage = existing?.encryptedImage;
    }

    const incomingMetadata = cmd.metadata
      ? toProfileMetadata(cmd.metadata)
      : undefined;
    const mergedMetadata: ProfileMetadata | undefined =
      incomingMetadata && Object.keys(incomingMetadata).length > 0
        ? { ...(existing?.metadata ?? {}), ...incomingMetadata }
        : existing?.metadata;

    try {
      await sendProfileUpdate(conversation, {
        name: profileName,
        memberKind: existing?.memberKind ?? MemberKind.Agent,
        ...(encryptedImage && { encryptedImage }),
        ...(mergedMetadata &&
          Object.keys(mergedMetadata).length > 0 && { metadata: mergedMetadata }),
      });
      this.emit({
        event: "profile_updated",
        conversationId: conversation.id,
        ...(profileName !== undefined && { name: profileName ?? null }),
        ...(cmd.image !== undefined && { image: cmd.image || null }),
        ...(mergedMetadata &&
          Object.keys(mergedMetadata).length > 0 && { metadata: mergedMetadata }),
      });
    } catch (error) {
      this.emitError(
        `profile update failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  private async joinByInvite(
    client: Client<unknown>,
    invite: ReturnType<typeof parseInvite>,
    timeoutSec: number,
  ): Promise<Group> {
    const dm = await client.conversations.createDm(invite.creatorInboxId);
    await client.conversations.sync();

    const preJoinGroupIds = new Set<string>();
    for (const conv of await client.conversations.list()) {
      if (conv.id !== dm.id) preJoinGroupIds.add(conv.id);
    }

    const slug = inviteToSlug(invite);
    const joinRequest: JoinRequestContent = {
      inviteSlug: slug,
      profile: { memberKind: "agent" },
    };
    const codec = new JoinRequestCodec();
    await dm.send(codec.encode(joinRequest));
    await dm.sendText(slug);

    const start = Date.now();
    const timeoutMs = timeoutSec * 1000;
    while (Date.now() - start < timeoutMs) {
      await client.conversations.sync();
      const list = await client.conversations.list();
      for (const conv of list) {
        if (conv.id === dm.id) continue;
        if (preJoinGroupIds.has(conv.id)) continue;
        const group = isGroup(conv) ? conv : undefined;
        if (group) return requireGroup(group);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    this.error(
      `Timed out after ${timeoutSec}s waiting for the creator to accept the join request.`,
    );
  }

  private async startMessageStream(
    conversation: Group,
    client: Client<unknown>,
    focusTimeoutSec: number,
  ): Promise<void> {
    const stream = await conversation.stream({});
    this.streams.push(stream);

    const focusDeadline = Date.now() + focusTimeoutSec * 1000;
    const focusWatcher = setInterval(() => {
      if (this.shuttingDown) return;
      if (this.sessions.size > 0) {
        clearInterval(focusWatcher);
        return;
      }
      if (Date.now() >= focusDeadline) {
        clearInterval(focusWatcher);
        this.emitError(
          `No FocusModeControl(.start) received after ${focusTimeoutSec}s. Exiting.`,
        );
        this.shutdown("focus_timeout");
      }
    }, 1000);

    try {
      for await (const message of stream) {
        if (this.shuttingDown) break;
        if (message.senderInboxId === client.inboxId) continue;

        if (isFocusModeControlMessage(message)) {
          this.handleIncomingControl(message, client);
          continue;
        }
        if (isStreamingTextMessage(message)) {
          this.handleIncomingText(message);
          continue;
        }
        if (isStreamingClearMessage(message)) {
          this.handleIncomingClear(message);
          continue;
        }
        if (isConversationSnapshotMessage(message)) {
          this.handleIncomingSnapshot(message, client);
          continue;
        }
        // Non-focus messages are ignored in focus mode. They will land in
        // the regular message history and can be picked up by `agent serve`
        // after focus ends.
      }
    } catch (error) {
      if (!this.shuttingDown) {
        this.emitError(
          `Message stream ended: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    } finally {
      clearInterval(focusWatcher);
    }
  }

  private handleIncomingControl(
    message: DecodedMessage,
    client: Client<unknown>,
  ): void {
    const control = getFocusModeControlContent(message);
    if (!control) return;

    let session = this.sessions.get(control.sessionId);
    if (!session) {
      session = {
        sessionId: control.sessionId,
        focusedInboxId: control.focusedInboxId,
        state: control.state === "stop" ? "stopped" : "started",
        bubbles: new Map(),
        localRevision: 0,
      };
      this.sessions.set(control.sessionId, session);
    }

    if (control.state === "start") {
      session.state = "started";
      // Promotion rule: only overwrite focusedInboxId with non-null values so
      // a stale start(null) arriving late doesn't blow away a known focus.
      if (control.focusedInboxId !== null) {
        session.focusedInboxId = control.focusedInboxId;
      }
      const focused = session.focusedInboxId;
      if (focused === null) {
        this.emit({
          event: "focus_pending",
          sessionId: session.sessionId,
        });
      } else {
        this.emit({
          event: "focused",
          sessionId: session.sessionId,
          focusedInboxId: focused,
          isUs: focused === client.inboxId,
        });
      }
      this.armAutoStopTimer();
      return;
    }

    // state === "stop"
    session.state = "stopped";
    this.emit({
      event: "focus_stopped",
      sessionId: session.sessionId,
    });
  }

  /**
   * Treat the focus-session block of an incoming ConversationSnapshot as
   * equivalent to a FocusModeControl message. Snapshots arrive when we join
   * mid-session and the existing member ships us the current state.
   *
   * Promotion rule from FocusModeControl applies: only overwrite focusedInboxId
   * with non-null values, so a stale snapshot containing focusedInboxId=null
   * cannot blow away a known focus we already learned about via a live
   * FocusModeControl(.start).
   */
  private handleIncomingSnapshot(
    message: DecodedMessage,
    client: Client<unknown>,
  ): void {
    const snapshot = getConversationSnapshotContent(message);
    if (!snapshot) return;
    const focus = snapshot.focusSession;
    if (focus === undefined || focus === null) {
      // No live focus session at snapshot time — nothing to do.
      return;
    }

    let session = this.sessions.get(focus.sessionId);
    if (!session) {
      session = {
        sessionId: focus.sessionId,
        focusedInboxId: focus.focusedInboxId,
        state: focus.state === "stop" ? "stopped" : "started",
        bubbles: new Map(),
        localRevision: 0,
      };
      this.sessions.set(focus.sessionId, session);
    } else {
      if (focus.focusedInboxId !== null) {
        session.focusedInboxId = focus.focusedInboxId;
      }
      session.state = focus.state === "stop" ? "stopped" : "started";
    }

    if (focus.state === "stop") {
      this.emit({
        event: "focus_stopped",
        sessionId: session.sessionId,
        viaSnapshot: true,
      });
      return;
    }

    if (session.focusedInboxId === null) {
      this.emit({
        event: "focus_pending",
        sessionId: session.sessionId,
        viaSnapshot: true,
      });
    } else {
      this.emit({
        event: "focused",
        sessionId: session.sessionId,
        focusedInboxId: session.focusedInboxId,
        isUs: session.focusedInboxId === client.inboxId,
        viaSnapshot: true,
      });
    }
    this.armAutoStopTimer();
  }

  private handleIncomingText(message: DecodedMessage): void {
    const payload = getStreamingTextContent(message);
    if (!payload) return;
    const session = this.sessions.get(payload.sessionId);
    if (!session) return;
    if (session.state === "stopped") return;

    const bubble = session.bubbles.get(payload.senderInboxId) ?? {
      text: "",
      lastRevision: 0,
    };
    if (payload.revision <= bubble.lastRevision) return;

    if (bubble.clearTimer) {
      clearTimeout(bubble.clearTimer);
      bubble.clearTimer = undefined;
    }
    bubble.text = payload.text;
    bubble.lastRevision = payload.revision;
    session.bubbles.set(payload.senderInboxId, bubble);

    this.emit({
      event: "streaming_text",
      sessionId: payload.sessionId,
      senderInboxId: payload.senderInboxId,
      revision: payload.revision,
      text: payload.text,
    });
    this.armAutoStopTimer();
  }

  private handleIncomingClear(message: DecodedMessage): void {
    const payload = getStreamingClearContent(message);
    if (!payload) return;
    const session = this.sessions.get(payload.sessionId);
    if (!session) return;
    if (session.state === "stopped") return;

    const bubble = session.bubbles.get(payload.senderInboxId) ?? {
      text: "",
      lastRevision: 0,
    };
    if (payload.revision <= bubble.lastRevision) return;

    bubble.lastRevision = payload.revision;
    if (bubble.clearTimer) clearTimeout(bubble.clearTimer);
    // Apply the same 600ms readability delay iOS uses before blanking the
    // bubble. The clear event is emitted immediately so consumers can decide
    // their own UX; the in-memory bubble text drops after the delay.
    bubble.clearTimer = setTimeout(() => {
      bubble.text = "";
      bubble.clearTimer = undefined;
    }, STREAMING_CLEAR_DELAY_MS);
    session.bubbles.set(payload.senderInboxId, bubble);

    this.emit({
      event: "streaming_clear",
      sessionId: payload.sessionId,
      senderInboxId: payload.senderInboxId,
      revision: payload.revision,
    });
    this.armAutoStopTimer();
  }

  private startStdinReader(
    conversation: Group,
    client: Client<unknown>,
  ): void {
    if (process.stdin.isTTY) {
      this.emit({
        event: "info",
        message:
          "stdin is a TTY; agent focus expects ndjson commands on stdin. " +
          "Pipe a producer or run with input redirection.",
      });
      return;
    }
    this.rl = createInterface({ input: process.stdin, terminal: false });
    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let cmd: FocusCommand;
      try {
        cmd = JSON.parse(trimmed) as FocusCommand;
      } catch {
        this.emitError("Invalid JSON on stdin", { input: trimmed });
        return;
      }
      this.handleStdinCommand(cmd, conversation, client).catch((err) => {
        this.emitError(
          `Command failed: ${err instanceof Error ? err.message : "unknown"}`,
        );
      });
    });
    this.rl.on("close", () => {
      // EOF on stdin → graceful shutdown. Mirrors agent serve.
      this.shutdown("stdin_eof");
    });
  }

  private async handleStdinCommand(
    cmd: FocusCommand,
    conversation: Group,
    client: Client<unknown>,
  ): Promise<void> {
    const session = this.firstActiveSession();
    if (cmd.type === "text" || cmd.type === "clear") {
      if (!session) {
        this.emitError(
          "No active focus session yet — wait for the focus_pending or focused event.",
        );
        return;
      }
      if (
        session.focusedInboxId !== null &&
        session.focusedInboxId !== client.inboxId
      ) {
        // Per spec: only the focused member should publish StreamingText.
        this.emitError(
          `Refusing to send: focus is on ${session.focusedInboxId}, not us (${client.inboxId}).`,
        );
        return;
      }
    }

    if (cmd.type === "text") {
      if (typeof cmd.text !== "string") {
        this.emitError("text command requires 'text' string field");
        return;
      }
      session!.localRevision += 1;
      const payload: StreamingText = {
        sessionId: session!.sessionId,
        senderInboxId: client.inboxId,
        revision: session!.localRevision,
        text: cmd.text,
      };
      const id = await conversation.send(new StreamingTextCodec().encode(payload));
      this.emit({
        event: "sent",
        id,
        type: "text",
        sessionId: payload.sessionId,
        revision: payload.revision,
      });
      return;
    }

    if (cmd.type === "clear") {
      session!.localRevision += 1;
      const payload: StreamingClear = {
        sessionId: session!.sessionId,
        senderInboxId: client.inboxId,
        revision: session!.localRevision,
      };
      const id = await conversation.send(new StreamingClearCodec().encode(payload));
      this.emit({
        event: "sent",
        id,
        type: "clear",
        sessionId: payload.sessionId,
        revision: payload.revision,
      });
      return;
    }

    if (cmd.type === "profile") {
      await this.runProfileCommand(
        conversation,
        client,
        cmd,
        this.getConvosConfig(),
      );
      return;
    }

    if (cmd.type === "stop") {
      const sid = session?.sessionId;
      if (sid) await this.sendStop(conversation, sid);
      this.shutdown("stop_command");
      return;
    }

    this.emitError(`Unknown command type: ${(cmd as { type?: string }).type}`);
  }

  private async sendStop(conversation: Group, sessionId: string): Promise<void> {
    const control: FocusModeControl = {
      state: "stop",
      focusedInboxId: null,
      sessionId,
    };
    try {
      const id = await conversation.send(
        new FocusModeControlCodec().encode(control),
      );
      this.emit({
        event: "sent",
        id,
        type: "stop",
        sessionId,
      });
    } catch (error) {
      this.emitError(
        `Failed to send FocusModeControl(.stop): ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }

  private firstActiveSession(): SessionState | undefined {
    for (const session of this.sessions.values()) {
      if (session.state === "started") return session;
    }
    return undefined;
  }

  private armAutoStopTimer(): void {
    if (this.autoStopAfterMs === undefined) return;
    if (this.autoStopTimer) clearTimeout(this.autoStopTimer);
    this.autoStopTimer = setTimeout(() => {
      const session = this.firstActiveSession();
      if (!session) return;
      this.emit({
        event: "auto_stop",
        sessionId: session.sessionId,
        idleMs: this.autoStopAfterMs,
      });
      // Best-effort send before exit.
      void Promise.resolve();
      this.shutdown("auto_stop");
    }, this.autoStopAfterMs);
  }

  private shutdown(reason: string): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    if (this.autoStopTimer) clearTimeout(this.autoStopTimer);
    for (const session of this.sessions.values()) {
      for (const bubble of session.bubbles.values()) {
        if (bubble.clearTimer) clearTimeout(bubble.clearTimer);
      }
    }
    for (const stream of this.streams) {
      try {
        (stream as { return?: () => unknown }).return?.();
      } catch {
        // best-effort
      }
    }
    this.rl?.close();
    this.emit({ event: "shutdown", reason });
    // Give the emit a tick to flush, then exit.
    setImmediate(() => process.exit(0));
  }

  private emit(event: Record<string, unknown>): void {
    process.stdout.write(jsonStringify(event) + "\n");
  }

  private emitError(message: string, extra?: Record<string, unknown>): void {
    this.emit({ event: "error", message, ...(extra ?? {}) });
  }
}
