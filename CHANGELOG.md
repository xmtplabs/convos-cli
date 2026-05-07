# Changelog

## Unreleased

### Added: Assistant Builder Focus Mode (mirrors convos-ios `jarod/assistant-builder`)

Three new silent content types support a real-time co-typing "build session"
between an iOS user and a CLI agent. All three are JSON-encoded, `shouldPush: false`,
and have no text fallback.

- **`convos.org/focus_mode_control:1.0`** — session lifecycle. iOS opens the
  pending session and promotes focus when the agent joins; the agent sends
  `stop` to end the interview.
- **`convos.org/streaming_text:1.0`** — full-snapshot bubble text with a
  monotonic `revision` (uint32) per `(sessionId, senderInboxId)`. Receivers drop
  any snapshot with `revision <= existing.revision`. Decoder rejects payloads
  larger than 1 KiB.
- **`convos.org/streaming_clear:1.0`** — end-of-thought clear. Shares the same
  monotonic counter as StreamingText. Receivers apply a 600 ms readability delay
  before blanking the bubble.
- **`convos.org/conversation_snapshot:1.0`** — conversation-level state restore
  for new joiners. Carries an optional `focusSession` block
  (`sessionId` / `state` / `focusedInboxId`) that mirrors `FocusModeControl`
  exactly. Decoder is **strict-additive**: unknown top-level keys are
  preserved so v1 readers survive future v1.x extensions (locks, capability
  state, …). `agent focus` treats a non-null `focusSession` as a virtual
  `FocusModeControl(.start)` and emits `focused`/`focus_pending` with
  `viaSnapshot: true`. Absent or null `focusSession` is a no-op.

### Added: `convos agent focus <invite>` command

New long-running command that joins by invite, waits for the iOS-initiated
`FocusModeControl(.start)`, then participates in the session via ndjson
stdin/stdout — symmetric with `agent serve`.

- **STDIN commands**: `{"type":"text","text":"..."}`, `{"type":"clear"}`,
  `{"type":"profile","name":"...","image":"...","metadata":{...}}` (mid-session
  profile updates — mirrors `convos conversation update-profile` semantics),
  `{"type":"stop"}`
- **STDOUT events**: `joined`, `focus_pending`, `focused`, `streaming_text`,
  `streaming_clear`, `focus_stopped`, `sent`, `profile_updated`, `auto_stop`,
  `shutdown`, `error`
- **Flags**: `--persona <file>`, `--auto-stop-after <seconds>`,
  `--join-timeout`, `--focus-timeout`, `--profile-name`, `--profile-image`,
  `--profile-metadata <key=value>` (repeatable; folded into the post-join
  `ProfileUpdate` alongside attestation), and the same attestation triple as
  `agent serve` / `conversations join` (`--attestation` / `--attestation-ts` /
  `--attestation-kid` *or* `--attestation-private-key` for runtime signing).
  Attestation metadata is shipped on a single post-join `ProfileUpdate` so iOS
  renders the verified-avatar ring during the focus session.
- Refuses to publish StreamingText when focus is on a different member.
- Applies the 600 ms clear delay locally so its in-memory bubble state mirrors
  iOS rendering.

### Exports

- `FocusModeControlCodec`, `ContentTypeFocusModeControl`,
  `isFocusModeControlMessage`, `getFocusModeControlContent`,
  `FocusModeControl`, `FocusModeState`
- `StreamingTextCodec`, `ContentTypeStreamingText`, `STREAMING_TEXT_MAX_BYTES`,
  `isStreamingTextMessage`, `getStreamingTextContent`, `StreamingText`
- `StreamingClearCodec`, `ContentTypeStreamingClear`, `STREAMING_CLEAR_DELAY_MS`,
  `isStreamingClearMessage`, `getStreamingClearContent`, `StreamingClear`

## 0.9.1

### Multi-agent capability resolution (mirrors convos-ios#812)

- **`CapabilityRequest.askerInboxId: string` is now required.** Identifies which
  agent issued the request so receivers (and other agents in the same group)
  can distinguish whose request this is, and so subsequent grants can be
  targeted at the right agent. The `agent serve` `capability-request` stdin
  command and `convos conversation send-capability-request` populate
  `askerInboxId` automatically from `client.inboxId`; downstream consumers
  using the codec directly must populate it themselves. Decoder rejects
  payloads missing or with empty `askerInboxId`.
- **`ConnectionEvent.grantedToInboxId?: string` (optional).** When present,
  identifies which agent inbox a `granted` / `revoked` notification applies
  to. Agents in multi-agent groups must filter to entries where
  `grantedToInboxId === client.inboxId` (with a missing-field fallback for
  pre-#812 grants) when reading `profile.metadata["connections"]`. Backward
  compatible — older messages without the field still decode.
- **`agent serve` event surface**: `capability_request` now carries
  `askerInboxId`; `connection_event` carries `grantedToInboxId` when present.
  The `sent` event for `capability-request` also echoes `askerInboxId`.

## 0.9.0 - 2026-05-05

### Added

- **ConvosConnections content codecs** (mirrors convos-ios#767) — `convos.org/connection_payload:1.0`, `connection_invocation:1.0`, `connection_invocation_result:1.0`, plus the `convos.org/connection_event:1.0` grant/revoke notification.
- **Capability resolution codecs** (mirrors convos-ios#771) — `convos.org/capability_request:1.0`, `capability_request_result:1.0` (latter carries `availableActions: AvailableAction[]`).
- **CloudConnectionGrantRequest codec** — `convos.org/connection_grant_request:1.0`, agent → device prompt to link a cloud OAuth provider.
- **CLI commands**:
  - `convos conversation send-invocation` — send a `ConnectionInvocation` to a conversation.
  - `convos conversation send-capability-request` — send a `CapabilityRequest`.
  - `convos conversation send-cloud-connection-grant-request` — send a `CloudConnectionGrantRequest`.
- **`agent serve` events**: `connection_payload`, `connection_invocation`, `connection_result`, `connection_event`, `cloud_connection_grant_request`, `capability_request`, `capability_result`, `profile_update`, `read_receipt`, plus the previously-undocumented `explode_notice`. All silent codecs are filtered from chat and surface as structured stdout events with catchup parity.
- **`agent serve` stdin commands**: `connection-invoke`, `capability-request`, `cloud-connection-grant-request`.

## 0.8.0

### Breaking Changes: Single-Inbox Identity Model (ADR 011)

The CLI now uses **one XMTP inbox per install**, shared across every conversation and DM — mirroring the [convos-ios single-inbox refactor](https://github.com/xmtplabs/convos-ios/pull/713). This replaces the previous per-conversation identity model (ADR 002), which created a fresh XMTP inbox for every conversation.

Agents benefit: one agent identity across every conversation it participates in.

**Behavior changes:**

- `conversations create` / `conversations join` no longer create a new identity per conversation. They use (or create on first use) the install's single identity at `~/.convos/identity.json`.
- `conversation explode` no longer destroys the identity. It sends `ExplodeSettings`, updates metadata, and calls `removeMembers` on every other member. Receiving clients drop the conversation on either the `ExplodeSettings` message or the MLS remove commit.
- `identity list` returns zero or one entries. `identity info` and `identity remove` take no id argument. `identity create` errors if an identity already exists.
- `conversations list` returns every group in the install's inbox (no more deduplication across identities); pass `--include-dms` to include DMs.
- `conversations sync` now performs a single `client.sync()` call.
- `agent serve` drops `--identity`. Bind to an existing conversation via positional arg, or create a new one.
- `reset` wipes the single identity.json and all db files. Legacy per-conversation identity files are swept out if found.

**Wire protocol is unchanged.** Invites, join requests, ProfileUpdate/ProfileSnapshot, and ExplodeSettings all interop with older CLI clients and the iOS app both pre- and post-refactor.

**Migration from 0.7.x:**

Existing `~/.convos/identities/*.json` files are no longer used. The CLI will create a fresh `identity.json` on first use. To clear the legacy files, run `convos reset`. To keep them as archival state, they will sit unused and can be removed manually.

**Data layout:**

```
~/.convos/
├── .env
├── identity.json       (was: identities/<id>.json × N)
└── db/
    └── dev/
        └── main.db3    (was: db/dev/<id>.db3 × N)
```

**API changes:**

- `createClientForIdentity(identity, config, home)` → `getClient(config, home)` and `getIdentityAndClient(config, home)`. The client is cached per (home, env) for the process lifetime.
- `IdentityStore`: `list()`, `get(id)`, `create()`, `update(id, patch)`, `remove(id)`, `getByConversationId()`, `getByInviteTag()`, `getUnlinked()`, `getAllByConversationId()` are gone. Replaced with `load()`, `loadOrUpsert(opts)`, `exists()`, `update(patch)`, `delete()`, `getDbPath(env)`. `loadOrUpsert` overwrites `label`/`profileName` when those opts differ from the stored values.
- `Identity`: loses `conversationId` and `inviteTag` fields.

### Added

- `conversations list --include-dms` — include DMs alongside groups in output.

### Fixed

- **Agent serve attach mode is read-only for invite generation** — existing conversations no longer rewrite appData when invite metadata is missing or unreadable (also released as 0.7.6).

## 0.7.6 (2026-05-03)

### Bug Fixes

- **Agent serve attach mode is read-only for invite generation** — existing conversations no longer rewrite appData when invite metadata is missing or unreadable

### Notes

- Reverts the `@xmtp/node-sdk` 5.3.0 → 6.0.0 dependabot bump that landed on `main` after `v0.7.4`. The 6.0.0 SDK introduced breaking codec and `ClientOptions` API changes that have not yet been adapted in this repo. Pin remains at 5.3.0.

## 0.4.0 (2025-03-04)

### Features

- **ProfileUpdate messages** — profile changes are now sent as `convos.org/profile_update:1.0` group messages, matching convos-ios PR #552
- **ProfileSnapshot messages** — after adding members, a `convos.org/profile_snapshot:1.0` message is sent containing all current profiles so new joiners have data immediately
- **Message-based profile resolution** — `conversation profiles` and agent message events now resolve profiles from messages first (ProfileUpdate > ProfileSnapshot) with appData as fallback
- **MemberKind enum** — profiles include a `memberKind` field for agent self-identification (`Unspecified`, `Agent`)
- **JoinRequest content type** — join requests now use `convos.org/join_request:1.0` with structured payload (invite slug, profile, metadata) instead of plain text. CLI sets `memberKind: "agent"` by default. Plain text slug is also sent for backward compatibility with older clients.
- **`--fields` flag** — all commands support `--fields` to limit JSON output to specific fields (supports dot notation for nested paths). Implicitly enables `--json`.
- **`convos schema` command** — runtime introspection of all CLI commands as machine-readable JSON for AI agents
- **New exports** — `encodeProfileUpdate`, `decodeProfileUpdate`, `encodeProfileSnapshot`, `decodeProfileSnapshot`, `sendProfileUpdate`, `sendProfileSnapshot`, `resolveProfilesFromMessages`, `isProfileMessage`, `ContentTypeProfileUpdate`, `ContentTypeProfileSnapshot`, `MemberKind`, `JoinRequestCodec`, `ContentTypeJoinRequest`

### Bug Fixes

- **Fixed appData corruption** — profile updates no longer do a read-modify-write on appData, which could erase invite tags and other members' profiles when `parseAppData` failed or concurrent writes raced
- **Profile messages filtered from streams** — `isDisplayableMessage` now filters out ProfileUpdate and ProfileSnapshot messages so they don't appear in chat

### Breaking Changes

- `conversation update-profile` no longer writes profiles to appData (sends ProfileUpdate message only)
- `conversations create` writes only the invite tag to appData (no profiles); creator profile is sent via ProfileUpdate message
- `conversations join` no longer writes profiles to appData; joiner profile is sent via ProfileUpdate message

## 0.1.0 (2025-02-09)

Initial release.

### Features

- Per-conversation identities — each conversation gets its own XMTP inbox
- Serverless invite system with QR codes and invite URLs
- Per-conversation profiles stored in XMTP group metadata
- Explode — permanently destroy a conversation and all cryptographic keys
- Lock — prevent new members from being added
- Identity management (create, list, info, remove)
- Conversation management (create, join, list, sync)
- Message sending (text, reactions, replies)
- Message streaming (single conversation and all conversations)
- Group management (members, permissions, metadata)
- JSON output for all commands (`--json`)
- Built on `@xmtp/node-sdk` 5.3.0
