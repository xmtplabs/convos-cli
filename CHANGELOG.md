# Changelog

## 0.10.1 - 2026-05-19

### Breaking: attachments are always sent as remote attachments

`agent serve`'s `attach` command, `conversation send-attachment`, and
`conversation send-reply --file` now always encrypt and upload via the
configured upload provider — the 1 MB inline-attachment threshold and
code path are gone.

- The `--remote` flag is removed from `send-attachment` and `send-reply`
  (it's now the only behavior).
- These commands error immediately if no upload provider is configured,
  instead of silently routing small files inline.
- `download-attachment` still decodes inline messages transparently for
  backward compatibility with messages from other senders.

### Added: Thinking content type

New silent codec for ambient agent thinking-status indicators, anchored to
a specific message (like read receipts):

- **`convos.org/thinking:1.0`** — JSON payload `{state, targetMessageId, content, resultMessageId?}`.
  `state` is `"start"` or `"stop"` — agents pair a `start` with a matching `stop`
  on the same `targetMessageId`. `content` is a 3–5 word human-readable label
  shown alongside the indicator (e.g. `"Designing your cycling guide"`).
  `resultMessageId` is optional and only meaningful on `stop` — the agent's own
  reply message that closed the thought, so receivers can link "thought about X"
  to "replied with Y".
- Silent (`shouldPush: false`), no fallback. Filtered from the chat stream by
  `isDisplayableMessage`.
- `agent serve` event surface: receive path emits a `thinking` event; live and
  catchup both surface, deduped by message id. Stdin command `{"type":"thinking","state":"start|stop","targetMessageId":"...","content":"...","resultMessageId":"..."}` sends a Thinking message. `resultMessageId` only valid with `state: "stop"`.

Exports: `ThinkingCodec`, `ContentTypeThinking`, `isThinkingMessage`,
`getThinkingContent`, `Thinking`, `ThinkingState`.

### Added: Remote-attachment decode helpers

`agent serve`'s `message` event now carries structured attachment metadata
when the content type is one of XMTP's native remote-attachment types:

- **`xmtp.org/remoteStaticAttachment:1.0`** — emits a `remoteAttachment`
  object alongside `content`.
- **`xmtp.org/multiRemoteStaticAttachment:1.0`** — emits a
  `multiRemoteAttachment: { attachments: [...] }` object.

Each entry has `url`, `contentDigest`, `scheme`, `secret`/`salt`/`nonce`
(base64-encoded), and optional `contentLength`/`filename` — enough for
an agent to fetch and decrypt the bytes with `decryptAttachment`. Bytes
were previously `Uint8Array` on `message.content`, which doesn't
serialize to JSON cleanly. Encoding matches the `agent serve` `remote-attach`
stdin command so agents send and receive attachments through one mental
model. Live and catchup `message` paths both populate the new fields.

New exports: `extractRemoteAttachment`, `extractMultiRemoteAttachment`,
`RemoteAttachmentJson`, `RemoteAttachmentInfoJson`, `MultiRemoteAttachmentJson`.

## 0.10.0 - 2026-05-15

### Breaking

- **Bumps `@xmtp/node-sdk` 5.3.0 → 6.0.0-nightly.20260515.1fc0c5c** ([npm](https://www.npmjs.com/package/@xmtp/node-sdk/v/6.0.0-nightly.20260515.1fc0c5c)), pulling in `@xmtp/node-bindings` 1.9.1 → 1.10.0-nightly. CLI commands, flags, and output are unchanged.
- **On-disk database**: libxmtp may run forward-only migrations against the local `xmtp-<env>-<inbox>.db3` on first open. After upgrading, do not flip back to a 0.9.x binary against the same DB. Recovery if a DB ends up incompatible: `convos identity remove` + recreate.
- **For library consumers of `./utils/*` / `./baseCommand`**: no signature changes here, but if a downstream package also imports `@xmtp/node-sdk` directly it will see 6.x types (`ClientOptions` is now a discriminated union `(NetworkOptions | { backend: Backend }) & …`, `RemoteAttachmentInfo` is no longer exported, `ApiUrls` is deprecated in favor of `createBackend()`). `Client.create(signer, { env, … })` inline-literal calls now fail with TS2353; construct the options as a `ClientOptions` first.

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
