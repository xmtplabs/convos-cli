# Changelog

## 0.10.22

### Patch Changes

- [#132](https://github.com/xmtplabs/convos-cli/pull/132) [`fe418b5`](https://github.com/xmtplabs/convos-cli/commit/fe418b5cbbc6656e39a3520e3a06e17248c1535b) Thanks [@lourou](https://github.com/lourou)! - Preserve `ConversationCustomMetadata.participationMode` (field 9) through appData read-modify-write. The field was missing from the CLI schema, so any agent-side appData rewrite silently dropped a conversation's participation mode.

## 0.10.21

### Patch Changes

- [#129](https://github.com/xmtplabs/convos-cli/pull/129) [`ea2455d`](https://github.com/xmtplabs/convos-cli/commit/ea2455d3131c37edf813a6e90bead0575b04a541) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update xmtp

- [#131](https://github.com/xmtplabs/convos-cli/pull/131) [`5d57e83`](https://github.com/xmtplabs/convos-cli/commit/5d57e830a627901700736773d37286b3f3833054) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update xmtp

## 0.10.20

### Patch Changes

- [#126](https://github.com/xmtplabs/convos-cli/pull/126) [`5371411`](https://github.com/xmtplabs/convos-cli/commit/53714117bbc15c3958431e152ded6b41ba53ebf4) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update xmtp

- [#128](https://github.com/xmtplabs/convos-cli/pull/128) [`f5138db`](https://github.com/xmtplabs/convos-cli/commit/f5138db5f0a94e1842efcf068ad3388e849e490d) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Move `ConversationCustomMetadata.spaceUrl` to protobuf field 10 to deconflict with field 9.

## 0.10.19

### Patch Changes

- [#124](https://github.com/xmtplabs/convos-cli/pull/124) [`025c171`](https://github.com/xmtplabs/convos-cli/commit/025c1712943ea790a1124e894addafdd15ae21f8) Thanks [@neekolas](https://github.com/neekolas)! - Add `ConversationCustomMetadata.spaceUrl` appData support.

## 0.10.18

### Patch Changes

- [#122](https://github.com/xmtplabs/convos-cli/pull/122) [`afd1303`](https://github.com/xmtplabs/convos-cli/commit/afd13039ae1e5a03a632b23a7b9d175d87e9b561) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update xmtp

## 0.10.17

### Patch Changes

- [#117](https://github.com/xmtplabs/convos-cli/pull/117) [`31ff6f8`](https://github.com/xmtplabs/convos-cli/commit/31ff6f8f91e8e49566fafe0f9e82ebb8720467a6) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update dependency @xmtp/node-sdk to v6.2.0-nightly.20260805.d14feba

- [#120](https://github.com/xmtplabs/convos-cli/pull/120) [`3c6cefa`](https://github.com/xmtplabs/convos-cli/commit/3c6cefa2cb4067599900026bf1ff3cf933c34519) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update dependency @xmtp/node-bindings to >=1.11.0-dev <1.12.0

- [#121](https://github.com/xmtplabs/convos-cli/pull/121) [`fcc9b3e`](https://github.com/xmtplabs/convos-cli/commit/fcc9b3effdb93e996b4c44c6d6ec579dffeacd82) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update dependency @xmtp/node-bindings to >=1.11.0-dev <1.13.0

## 0.10.16

### Patch Changes

- [#116](https://github.com/xmtplabs/convos-cli/pull/116) [`3106bc1`](https://github.com/xmtplabs/convos-cli/commit/3106bc1fbbec4b8812002607c71bca5fc7fc471b) Thanks [@yewreeka](https://github.com/yewreeka)! - Add the `agentDm` marker (field 8) to the `ConversationCustomMetadata` codec (`AgentDmInfo.originConversationId`), matching the iOS proto so agent-DM markers round-trip byte-compatibly. Enables server-side (Herald) stamping of the marker for CON-761 agent-owned DM creation; `parseAppDataForWrite` preserves it across read-modify-write.

- [#102](https://github.com/xmtplabs/convos-cli/pull/102) [`633d2a5`](https://github.com/xmtplabs/convos-cli/commit/633d2a50f6cb0d3dfa7ad1dc022e7bf5162eb406) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update xmtp

- [#103](https://github.com/xmtplabs/convos-cli/pull/103) [`6e272c9`](https://github.com/xmtplabs/convos-cli/commit/6e272c967ae6025e7f2731f81a4d0e606aab7259) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update xmtp

- [#104](https://github.com/xmtplabs/convos-cli/pull/104) [`472e963`](https://github.com/xmtplabs/convos-cli/commit/472e9631e3c5779a1cda44761f343bff6811dc42) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update xmtp

- [#105](https://github.com/xmtplabs/convos-cli/pull/105) [`12ee6a3`](https://github.com/xmtplabs/convos-cli/commit/12ee6a37482748d2960a2d4e31e9f615b8cab5d7) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update xmtp

- [#106](https://github.com/xmtplabs/convos-cli/pull/106) [`3beeea7`](https://github.com/xmtplabs/convos-cli/commit/3beeea79c30379e30a18f90dbe8c530cfc09ce43) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update xmtp

- [#107](https://github.com/xmtplabs/convos-cli/pull/107) [`3a66d35`](https://github.com/xmtplabs/convos-cli/commit/3a66d35545f522b29f971e7a48e1ecbf5262305c) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update xmtp

- [#108](https://github.com/xmtplabs/convos-cli/pull/108) [`0e5b559`](https://github.com/xmtplabs/convos-cli/commit/0e5b559384e24e2ddc3f01cd470530bef484530a) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update xmtp

- [#109](https://github.com/xmtplabs/convos-cli/pull/109) [`5f20fa9`](https://github.com/xmtplabs/convos-cli/commit/5f20fa9deb1efdd4a993036545da75d599380948) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update xmtp

- [#110](https://github.com/xmtplabs/convos-cli/pull/110) [`f804694`](https://github.com/xmtplabs/convos-cli/commit/f80469474ae38e6a0272e796738c1a1fccc5539f) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update xmtp

- [#111](https://github.com/xmtplabs/convos-cli/pull/111) [`b643c21`](https://github.com/xmtplabs/convos-cli/commit/b643c21ad8a579ca5e1d233aa3e8e4ec20ee74c6) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update xmtp

- [#112](https://github.com/xmtplabs/convos-cli/pull/112) [`1318571`](https://github.com/xmtplabs/convos-cli/commit/1318571cb46107774f7e962e69207b0aff0435a4) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update dependency @xmtp/node-bindings to v1.11.0

- [#113](https://github.com/xmtplabs/convos-cli/pull/113) [`b4916d4`](https://github.com/xmtplabs/convos-cli/commit/b4916d4dbc3b670f3d1df8676b3564a18fb5a00c) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update dependency @xmtp/node-sdk to v6.2.0-nightly.20260730.3623322

- [#114](https://github.com/xmtplabs/convos-cli/pull/114) [`6cd0f47`](https://github.com/xmtplabs/convos-cli/commit/6cd0f47b85a423c51b7ca7d806a0b6d8fc905e9a) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update dependency @xmtp/node-sdk to v6.2.0-nightly.20260731.66944e2

- [#115](https://github.com/xmtplabs/convos-cli/pull/115) [`2d7833d`](https://github.com/xmtplabs/convos-cli/commit/2d7833d7ee227ef60715021fb3aa89ce0d403387) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update dependency @xmtp/node-sdk to v6.2.0-nightly.20260804.0f01ea1

- [#99](https://github.com/xmtplabs/convos-cli/pull/99) [`bc4b492`](https://github.com/xmtplabs/convos-cli/commit/bc4b492041b7dbfec2e72a5d50b69dba6eef0c25) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update xmtp

## 0.10.15

### Patch Changes

- [#96](https://github.com/xmtplabs/convos-cli/pull/96) [`b793494`](https://github.com/xmtplabs/convos-cli/commit/b793494637bf0d2c0fbe92007393071564481ce5) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update xmtp

- [#98](https://github.com/xmtplabs/convos-cli/pull/98) [`cf03ed6`](https://github.com/xmtplabs/convos-cli/commit/cf03ed639fe7af56790d090d6a2436b9dacf0b42) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update xmtp

## 0.10.14

### Patch Changes

- [#94](https://github.com/xmtplabs/convos-cli/pull/94) [`b008c80`](https://github.com/xmtplabs/convos-cli/commit/b008c80d1a356b4f3ea49f5c6fb06b43e465305b) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update xmtp

- [#93](https://github.com/xmtplabs/convos-cli/pull/93) [`fcb4ce1`](https://github.com/xmtplabs/convos-cli/commit/fcb4ce1cdfa08094806cfbaf4f30035994ca908d) Thanks [@insipx](https://github.com/insipx)! - Write appData compressed bodies as raw DEFLATE (matching iOS/Android), completing the compression-format convergence. Historic zlib-wrapped blobs remain readable via the dual-format reader.

## 0.10.13

### Patch Changes

- [#91](https://github.com/xmtplabs/convos-cli/pull/91) [`2455d7c`](https://github.com/xmtplabs/convos-cli/commit/2455d7cafa507d0036a4789a8ed78a081bfbe5f1) Thanks [@insipx](https://github.com/insipx)! - Accept raw-DEFLATE (iOS-compressed) appData in parseAppData/parseAppDataForWrite, and attach the original decode error as `cause` on the write-guard throw.

## 0.10.12

### Patch Changes

- [#89](https://github.com/xmtplabs/convos-cli/pull/89) [`dfe5ad7`](https://github.com/xmtplabs/convos-cli/commit/dfe5ad72f76988b015cf5b07d27cf84377aee490) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): Update xmtp

## 0.10.11

### Patch Changes

- [#85](https://github.com/xmtplabs/convos-cli/pull/85) [`eb09c2e`](https://github.com/xmtplabs/convos-cli/commit/eb09c2e0fd764b0709c89c5d26f0d749fab02bc0) Thanks [@insipx](https://github.com/insipx)! - update XMTP

## 0.10.10

### Patch Changes

- [#82](https://github.com/xmtplabs/convos-cli/pull/82) [`1a4a74c`](https://github.com/xmtplabs/convos-cli/commit/1a4a74c2744446b091d403dcb290d5c7913ef6b3) Thanks [@saulmc](https://github.com/saulmc)! - Fix `normalizeMessageContent` so a reply that carries a non-text payload renders its display string instead of a raw JSON dump of the decoded content. A reply containing a remote attachment now renders `reply to "…": [remote attachment: photo.jpg (… bytes) https://…]` rather than serializing the attachment envelope — which leaked the AES key material (secret/salt/nonce) into the message text. Inline attachments, reactions, and other nested content types render through the same path.

## 0.10.9

### Patch Changes

- [#79](https://github.com/xmtplabs/convos-cli/pull/79) [`08a76dd`](https://github.com/xmtplabs/convos-cli/commit/08a76dd94209e98afb6fdd05c850e9ed1741dc7e) Thanks [@insipx](https://github.com/insipx)! - update xmtp

## 0.10.8

### Patch Changes

- [#73](https://github.com/xmtplabs/convos-cli/pull/73) [`d3cc3f2`](https://github.com/xmtplabs/convos-cli/commit/d3cc3f2a14e0976dcb0b2d9ac38dad97029a7eb4) Thanks [@insipx](https://github.com/insipx)! - update to xmtp 06-10-2026 pending self remove worker fix

## 0.10.7

### Patch Changes

- [#70](https://github.com/xmtplabs/convos-cli/pull/70) [`ea300be`](https://github.com/xmtplabs/convos-cli/commit/ea300bec28e3d5e3c7157311cc08eac9e89d8116) Thanks [@insipx](https://github.com/insipx)! - update to libxmtp 06-09-2026, event-driven disappearing messages

## 0.10.6

### Patch Changes

- [#67](https://github.com/xmtplabs/convos-cli/pull/67) [`29f7593`](https://github.com/xmtplabs/convos-cli/commit/29f759307ddf3b37ccc5b09b5558d8ee2d10b47f) Thanks [@insipx](https://github.com/insipx)! - update xmtp to include init_logging panic fix

## 0.10.5

### Patch Changes

- [#64](https://github.com/xmtplabs/convos-cli/pull/64) [`88d3794`](https://github.com/xmtplabs/convos-cli/commit/88d3794c5c7c011398cecaeec95b3aa9199399a2) Thanks [@insipx](https://github.com/insipx)! - Pin `@xmtp/node-sdk` and `@xmtp/node-bindings` to dev build `*-dev.f7b334d` (node-sdk `6.0.0-dev.f7b334d`, node-bindings `1.11.0-dev.f7b334d`). Widen the node-sdk/node-bindings peer ranges to `>=…-dev` so dev-channel prereleases satisfy the peer.

## 0.10.4

### Patch Changes

- [#60](https://github.com/xmtplabs/convos-cli/pull/60) [`39c349a`](https://github.com/xmtplabs/convos-cli/commit/39c349a8d18aea318f71be5dbef73ebcadc4d819) Thanks [@insipx](https://github.com/insipx)! - Declare `@xmtp/node-sdk` and `@xmtp/node-bindings` as peer dependencies so consumers install a single copy. Prevents native-binding segfaults from duplicate node-sdk trees.

## 0.10.3

### Patch Changes

- [#55](https://github.com/xmtplabs/convos-cli/pull/55) [`286753e`](https://github.com/xmtplabs/convos-cli/commit/286753ec6325718cd487e942e6a761820c833c84) Thanks [@insipx](https://github.com/insipx)! - make a release with the automated workflow

## 0.10.2 - 2026-05-27

### Changed

- Bumped `@xmtp/node-sdk` to `6.0.0-nightly.20260522.3d3b1e2`.

### Fixed

- `@xmtp/node-sdk` 6.x no longer exports `RemoteAttachmentInfo` (noted
  in the 0.10.0 CHANGELOG). Replaced the remaining reference in
  `toJson` with `RemoteAttachment`, whose shape is identical and
  matches `MultiRemoteAttachment.attachments`.

### Build

- Switched dependency automation from Dependabot to Renovate so the
  `@xmtp/node-sdk` `nightly` dist-tag is tracked directly (Dependabot
  only follows `latest`).

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
