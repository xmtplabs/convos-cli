# Changelog

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
