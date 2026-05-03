# Changelog

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
