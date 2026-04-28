---
name: convos-cli
description: Use when working with Convos messaging - single-inbox agent messaging with invites, per-conversation profiles, and group management via the convos CLI tool
---

# Convos CLI

The Convos CLI (`convos`) is a command-line tool for agent-focused messaging built on [XMTP](https://xmtp.org). Each install has a single XMTP inbox shared across every conversation (per ADR 011), matching the iOS app's single-inbox identity model.

Key properties:

- **One identity per install**: A single XMTP inbox is created on first use and reused for every conversation and DM
- **Multiple agents per machine**: Run each agent under its own `CONVOS_HOME` to keep identities isolated
- **Invite system**: Serverless QR code + URL invites for joining conversations
- **Per-conversation profiles**: Display a different name/avatar in each conversation (the identity stays the same)
- **Explode**: Notify members and remove them from the group — does not destroy the install's identity
- **Lock**: Prevent new members from being added

## Prerequisites

### Initialize Configuration

```bash
# generate config and save to default path (~/.convos/.env)
convos init

# output config to console instead of writing to file
convos init --stdout

# initialize for production environment
convos init --env production

# overwrite existing config
convos init --force

# initialize with a custom data directory (useful for multiple agents)
convos init --home /path/to/agent1-data

# or use the CONVOS_HOME environment variable
CONVOS_HOME=/path/to/agent1-data convos init
```

This creates a `.env` file with:

- `CONVOS_ENV` - Network environment (local, dev, production)
- `CONVOS_API_KEY` - Agent API key for uploads (auto-selects `convos-api` provider)
- `CONVOS_UPLOAD_PROVIDER` - Upload provider override (`convos-api`, `pinata`, `s3`)

**Note:** One identity per install lives at `~/.convos/identity.json`. To run multiple independent agents on one machine, give each a distinct `CONVOS_HOME`.

### Custom Data Directory

By default, all data is stored in `~/.convos/`. To use a different directory (e.g., when running multiple agents on one machine), use the `--home` flag or the `CONVOS_HOME` environment variable:

```bash
# via flag (works on any command)
convos conversations list --home /path/to/agent-data

# via environment variable
export CONVOS_HOME=/path/to/agent-data
convos conversations list
```

Priority: `--home` flag > `CONVOS_HOME` env var > `~/.convos`

### Configuration Loading Priority

1. CLI flags (highest priority)
2. Explicit `--env-file <path>`
3. `.env` in the current working directory
4. `<convos-home>/.env` (default: `~/.convos/.env`)

## Command Structure

```
convos [TOPIC] [COMMAND] [ARGUMENTS] [FLAGS]
```

### Topics

| Topic | Purpose |
| ----- | ------- |
| `agent` | Agent mode — long-running sessions with streaming I/O |
| `identity` | Manage this install's singleton identity |
| `conversations` | List, create, join, and stream conversations |
| `conversation` | Interact with a specific conversation |

### Standalone Commands

| Command | Purpose |
| ------- | ------- |
| `init` | Initialize configuration and directory structure |
| `reset` | Delete this install's identity and conversation data (preserves .env) |
| `schema` | Introspect CLI commands as machine-readable JSON (args, flags, examples) |

## Output Modes

All commands support `--json` for machine-readable JSON output:

```bash
convos conversations list --json
```

Use `--fields` to limit JSON output to specific fields (implicitly enables `--json`). Supports dot notation for nested paths:

```bash
# only get message id, content, and sender
convos conversation messages <id> --fields id,content,senderInboxId

# nested field extraction
convos conversation messages <id> --fields id,content,contentType.typeId,sentAt

# works on any command
convos conversation profiles <id> --fields profiles
convos conversations list --fields conversationId,name
```

Use `--verbose` to see detailed client initialization logs. When combined with `--json`, verbose output goes to stderr:

```bash
convos identity info --verbose
convos conversations list --json --verbose 2>/dev/null
```

## Common Workflows

### Create a Conversation

```bash
# create a conversation (uses this install's singleton identity, auto-created on first use)
convos conversations create --name "My Group" --profile-name "Alice"

# create with admin-only permissions
convos conversations create --name "Announcement Channel" --permissions admin-only

# create and capture the conversation ID
CONV_ID=$(convos conversations create --name "Test" --json | jq -r '.conversationId')
```

### Send Messages

```bash
# send a text message
convos conversation send-text <conversation-id> "Hello, world!"

# send a reaction
convos conversation send-reaction <conversation-id> <message-id> add "👍"
# remove a reaction
convos conversation send-reaction <conversation-id> <message-id> remove "👍"

# send a reply referencing another message
convos conversation send-reply <conversation-id> <message-id> "Replying to you"

# reply with a photo
convos conversation send-reply <conversation-id> <message-id> --file ./photo.jpg

# reply with a large file (auto-uploaded via provider)
convos conversation send-reply <conversation-id> <message-id> --file ./video.mp4

# send a read receipt (silent — no visible message, no push notification)
convos conversation send-read-receipt <conversation-id>

# query last read times per member (nanosecond timestamps)
convos conversation last-read-times <conversation-id>
convos conversation last-read-times <conversation-id> --sync --json

# send a typing indicator (silent — notifies others you are typing)
convos conversation send-typing-indicator <conversation-id>

# stop typing indicator
convos conversation send-typing-indicator <conversation-id> --stop

# send a ConvosConnections invocation (agent → device write request)
# (full flag docs and the response side: see ConvosConnections under Important Concepts)
convos conversation send-invocation <conversation-id> \
  --kind calendar --action create_event \
  --arguments '{"title":{"type":"string","value":"Team sync"}}'

# request a capability up front (agent → user picker; reply via CapabilityRequestResult)
convos conversation send-capability-request <conversation-id> \
  --subject calendar --capability read \
  --rationale "To summarize your week"
```

### Send Attachments

```bash
# send a photo (small files ≤1MB sent inline, large files auto-uploaded via provider)
convos conversation send-attachment <conversation-id> ./photo.jpg

# force remote upload even for small files
convos conversation send-attachment <conversation-id> ./photo.jpg --remote

# override MIME type
convos conversation send-attachment <conversation-id> ./file.bin --mime-type image/png

# use upload provider via flags (no .env needed)
convos conversation send-attachment <conversation-id> ./photo.jpg \
  --upload-provider pinata --upload-provider-token <jwt>

# encrypt only — outputs encrypted file + decryption keys for manual upload
convos conversation send-attachment <conversation-id> ./photo.jpg --encrypt

# send a pre-uploaded encrypted file with decryption keys
convos conversation send-remote-attachment <conversation-id> <url> \
  --content-digest <hex> --secret <base64> --salt <base64> \
  --nonce <base64> --content-length <bytes> --filename photo.jpg

# download an attachment (handles both inline and remote transparently)
convos conversation download-attachment <conversation-id> <message-id>

# download to a specific path
convos conversation download-attachment <conversation-id> <message-id> --output ./photo.jpg

# save encrypted payload without decrypting
convos conversation download-attachment <conversation-id> <message-id> --raw
```

To enable automatic upload for large files, set your agent API key in `.env`:

```bash
CONVOS_API_KEY=<your-agent-api-key>
```

This auto-selects the `convos-api` upload provider. Other providers (`pinata`, `s3`) are also available via `CONVOS_UPLOAD_PROVIDER`.

### Read Messages

```bash
# list messages (default: descending order)
convos conversation messages <conversation-id>
# sync from network and limit results
convos conversation messages <conversation-id> --sync --limit 10
```

### Stream Messages in Real-Time

```bash
# stream messages from a single conversation
convos conversation stream <conversation-id>
# stop after 60 seconds
convos conversation stream <conversation-id> --timeout 60
```

### List Conversations

```bash
# list all conversations across all identities
convos conversations list
# sync from network before listing
convos conversations list --sync
```

### Invite System

Convos uses a serverless invite system. The creator generates a cryptographic invite URL; the person joining must open the URL in the Convos app (or scan the QR code); then the creator processes the join request to add them to the group.

**Important: Adding someone to a conversation is a multi-step process:**

1. **Generate an invite** (creator side) — produces a URL and QR code
2. **Person opens the invite URL in Convos or scans the QR code** — this sends a join request to the creator via DM
3. **Creator processes the join request** — this validates the request and adds the person to the group

The creator must process join requests *after* the person has opened/scanned the invite. If you don't know when that will happen, use `--watch` with a timeout to stream and process requests as they arrive.

#### Inspect an Invite

```bash
# decode and inspect an invite without joining (useful for debugging)
convos conversations inspect-invite <invite-slug>

# inspect a full invite URL
convos conversations inspect-invite "https://dev.convos.org/v2?i=<slug>"

# output as JSON
convos conversations inspect-invite <slug> --json
```

This displays the invite's tag, creator inbox ID, conversation name, expiration dates, signature validity, and whether the invite is expired — without creating any identities or sending join requests.

#### Create an Invite

```bash
# generate invite — displays QR code in terminal
convos conversation invite <conversation-id>

# generate invite with 1-hour expiry
convos conversation invite <conversation-id> --expires-in 3600

# single-use invite
convos conversation invite <conversation-id> --single-use

# JSON output (suppresses QR code)
convos conversation invite <conversation-id> --json

# capture invite URL for scripting
INVITE_URL=$(convos conversation invite <conversation-id> --json | jq -r '.url')
```

#### Person Joins via Invite

The person being invited must open the invite URL in the Convos app or scan the QR code with Convos. This can be done:

- **On iOS**: Open the URL in Safari (redirects to Convos app) or scan the QR code from within the app
- **Via CLI**: Use `convos conversations join`

```bash
# join using a raw invite slug
convos conversations join <invite-slug>

# join using a full invite URL
convos conversations join "https://dev.convos.org/v2?i=<slug>"

# join with a display name
convos conversations join <slug> --profile-name "Bob"

# join with a display name and avatar image
convos conversations join <slug> --profile-name "Bot" --profile-image "https://example.com/avatar.jpg"

# join with custom metadata
convos conversations join <slug> --metadata role=assistant --metadata version=2

# send join request without waiting for acceptance
convos conversations join <slug> --no-wait

# wait up to 2 minutes for acceptance
convos conversations join <slug> --timeout 120
```

#### Process Join Requests (Creator Side)

After the person has opened/scanned the invite, the creator must process the join request:

```bash
# process all pending join requests (use when you know the invite has already been opened)
convos conversations process-join-requests

# process for a specific conversation only
convos conversations process-join-requests --conversation <id>

# watch for join requests with a timeout (use when you don't know when the invite will be opened)
convos conversations process-join-requests --watch --conversation <id>
# note: use ctrl-c or a timeout to stop watching

# continuously watch for all join requests (keep running in background)
convos conversations process-join-requests --watch
```

### Per-Conversation Profiles

Profiles are per-conversation — the singleton identity can present a different display name and avatar in each conversation it participates in.

Profile updates are sent as **ProfileUpdate messages** to the group. The CLI no longer writes profiles to `appData` (this was removed to fix a data corruption bug where concurrent read-modify-write cycles could erase invite tags and other members' profiles). When reading profiles, message-sourced profiles take precedence, with `appData` as a read-only fallback for profiles written by older clients (e.g., iOS).

When new members are added (via invite or directly), a **ProfileSnapshot message** is sent containing all current member profiles so the new joiner has everyone's data immediately — solving the MLS forward secrecy problem where older messages may be undecryptable.

Profile resolution precedence:
1. **Latest ProfileUpdate from that member** — highest priority, most recent self-authored update
2. **Most recent ProfileSnapshot containing that member** — fallback when no ProfileUpdate exists
3. **appData profiles** — legacy fallback for backward compatibility with older clients
4. **No profile** — member has no name/avatar set

Both ProfileUpdate and ProfileSnapshot are silent messages (`shouldPush = false`) — they do not appear in chat or trigger notifications.

```bash
# set display name
convos conversation update-profile <conversation-id> --name "Alice"

# set name and avatar
convos conversation update-profile <conversation-id> --name "Alice" --image "https://example.com/avatar.jpg"

# go anonymous (clear profile)
convos conversation update-profile <conversation-id> --name "" --image ""

# view all member profiles
convos conversation profiles <conversation-id>
convos conversation profiles <conversation-id> --json
```

### Identity Management

Each install has exactly one identity, created automatically on first use. To run multiple independent agents on one machine, give each its own `CONVOS_HOME`.

```bash
# show this install's identity (0 or 1 entries)
convos identity list

# create the identity manually (errors if one already exists)
convos identity create --label "My Bot" --profile-name "Alice"

# view identity details (registers the XMTP client if needed)
convos identity info

# remove the identity (destroys all keys and databases — irreversible)
convos identity remove --force
```

### Reset All Data

Delete the install's identity and all conversation data. The `.env` configuration is preserved.

```bash
# reset with confirmation prompt
convos reset

# reset without confirmation
convos reset --force
```

### Group Management

```bash
# view members
convos conversation members <conversation-id>

# add members by inbox ID
convos conversation add-members <conversation-id> <inbox-id>

# remove members
convos conversation remove-members <conversation-id> <inbox-id>

# update group name
convos conversation update-name <conversation-id> "New Name"

# update group description
convos conversation update-description <conversation-id> "New description"

# view permissions
convos conversation permissions <conversation-id>
```

### Lock a Conversation

Prevent new members from joining by setting the addMember permission to deny. This also invalidates all existing invites. Only super admins can lock/unlock.

```bash
# lock
convos conversation lock <conversation-id>

# unlock (previously shared invites remain invalid — generate new ones)
convos conversation lock <conversation-id> --unlock
```

### Explode a Conversation

Notify members and remove them from the MLS group. Sends an ExplodeSettings message (so iOS and other clients can trigger their cleanup), updates group metadata with the expiration timestamp, and removes every other member. Receiving clients drop the conversation on either the ExplodeSettings message or the MLS remove commit, whichever arrives first. **Irreversible for other members; the install's identity is preserved** (ADR 011 §5 / ADR 004 C9).

```bash
# explode immediately
convos conversation explode <conversation-id> --force

# schedule explosion for a future date (ISO8601)
convos conversation explode <conversation-id> --scheduled "2025-03-01T00:00:00Z"
```

When scheduled, the ExplodeSettings message is sent with a future `expiresAt` date. Members are notified but not removed — clients handle cleanup when the time arrives. When immediate (no `--scheduled`), all other members are removed from the group right away.

### Assistant Attestation

Cryptographically verify that an agent was provisioned by the Convos backend. Attestations use Ed25519 signatures over `sha256(inboxId || timestamp)`.

```bash
# generate a test attestation (creates a key pair, signs, outputs JWKS)
convos attestation generate <inbox-id>
convos attestation generate <inbox-id> --kid my-key-2026 --json

# verify an attestation against a JWKS endpoint
convos attestation verify <inbox-id> \
  --attestation <base64url-sig> \
  --attestation-ts <iso8601> \
  --attestation-kid <kid>

# verify against a raw public key
convos attestation verify <inbox-id> \
  --attestation <sig> \
  --attestation-ts <ts> \
  --public-key <base64url-pubkey>

# verify against a local JWKS file
convos attestation verify <inbox-id> \
  --attestation <sig> \
  --attestation-ts <ts> \
  --attestation-kid <kid> \
  --jwks-file ./agents.json
```

Agents include attestation in their profile metadata when joining:

```bash
# agent serve with attestation (typically provided by the backend)
convos agent serve --name "Bot" \
  --attestation <sig> \
  --attestation-ts <ts> \
  --attestation-kid <kid>

# or via environment variables
CONVOS_ATTESTATION=<sig> CONVOS_ATTESTATION_TS=<ts> CONVOS_ATTESTATION_KID=<kid> \
  convos agent serve --name "Bot"

# join with attestation
convos conversations join <slug> \
  --attestation <sig> \
  --attestation-ts <ts> \
  --attestation-kid <kid>
```

### Sync Data from Network

```bash
# sync conversation list
convos conversations sync

# sync a single conversation
convos conversation sync <conversation-id>
```

## Agent Mode

The `agent serve` command runs a long-running process that combines conversation creation, message streaming, join request processing, and stdin command handling — ideal for AI agents and bots.

### Quick Start (Agent)

```bash
# create a new conversation and start serving
convos agent serve --name "My Bot" --profile-name "Assistant"

# attach to an existing conversation
convos agent serve <conversation-id>

# create with admin-only permissions
convos agent serve --name "Agent" --permissions admin-only
```

### Protocol

The agent uses an **ndjson** (newline-delimited JSON) protocol:

- **stdout**: Events (one JSON object per line)
- **stdin**: Commands (one JSON object per line)
- **stderr**: QR code + diagnostic logs

#### Events (stdout)

| Event | Description | Key Fields |
| ----- | ----------- | ---------- |
| `ready` | Session started | `conversationId`, `inviteUrl`, `inboxId` |
| `message` | New chat message received | `id`, `senderInboxId`, `senderProfile` (optional: `name`, `image`), `content`, `contentType`, `sentAt`, `catchup` (optional) |
| `typing` | Member typing status changed | `senderInboxId`, `isTyping`, `conversationId`, `timestamp` |
| `read_receipt` | Member sent an `xmtp.org/read_receipt` (they've read up to messages dated before `sentAt`) | `id`, `senderInboxId`, `conversationId`, `sentAt`. Live-only — not replayed on catchup, since only the latest receipt matters. Agents that need historical read state should call `convos conversation last-read-times`. |
| `member_joined` | Member joined via invite | `inboxId`, `conversationId`, `catchup` (optional) |
| `explode_notice` | A member sent an `ExplodeSettings` message scheduling or triggering conversation teardown | `conversationId`, `senderInboxId`, `expiresAt` (ISO8601), `sentAt`, `catchup` (optional) |
| `profile_update` | A member published a `ProfileUpdate` (changed their name, avatar, member kind, or metadata for this conversation) | `id`, `senderInboxId`, `conversationId`, plus only the fields the sender included: `name` (may be `""` to clear), `encryptedImage` (`{url, salt, nonce}`), `memberKind` (numeric, 1=`Agent`, 2=`User`), `metadata` (`{key: {type, value}}`), `sentAt`, `catchup` (optional). `ProfileSnapshot` messages (sent on join) are not surfaced as separate events — agents react to `member_joined` instead. |
| `connection_payload` | A `ConnectionPayload` arrived (device → agent sensor data) | `id` (XMTP message id), `envelopeId` (payload UUID), `senderInboxId`, `conversationId`, `source` (`ConnectionKind`), `schemaVersion`, `capturedAt` (Swift reference seconds), `body` (`{type, data}`), `sentAt`, `catchup` (optional) |
| `connection_invocation` | A `ConnectionInvocation` arrived (rare — agent-to-agent or other-agent) | `id`, `envelopeId`, `senderInboxId`, `conversationId`, `invocationId`, `kind`, `schemaVersion`, `action` (`{name, arguments}`), `issuedAt`, `sentAt`, `catchup` (optional) |
| `connection_result` | A `ConnectionInvocationResult` arrived (device → agent reply to a write) | `id`, `envelopeId`, `senderInboxId`, `conversationId`, `invocationId`, `kind`, `actionName`, `status`, `schemaVersion`, `result`, `errorMessage` (optional, present on non-success), `completedAt`, `sentAt`, `catchup` (optional) |
| `capability_request` | A `CapabilityRequest` arrived (rare — agent-to-agent) | `id`, `senderInboxId`, `conversationId`, `version`, `requestId`, `subject`, `capability`, `rationale`, `preferredProviders` (optional), `sentAt`, `catchup` (optional) |
| `capability_result` | A `CapabilityRequestResult` arrived (user → agent picker outcome) | `id`, `senderInboxId`, `conversationId`, `version`, `requestId`, `status`, `subject`, `capability`, `providers`, `sentAt`, `catchup` (optional) |
| `sent` | Message sent confirmation (replies to a stdin command) | `id`, `type`, plus type-specific fields (e.g. `text`, `replyTo`, `invocationId`, `requestId`, `expiresAt`, …) |
| `heartbeat` | Periodic health check | `conversationId`, `activeStreams`, `timestamp` |
| `error` | Error occurred | `message`, plus optional context fields |

Events with `catchup: true` were fetched during stream reconnection (missed while disconnected). The five connection / capability events plus `explode_notice` and `profile_update` carry the flag the same way `message` does — agents should treat catchup events as the source of truth for state they may have missed (e.g. a `connection_result` arriving with `catchup: true` is exactly as authoritative as one delivered live; a `profile_update` with `catchup: true` should still update whatever local cache renders the sender's name). Live and catchup paths dedupe by message id, so the same `id` will not appear twice.

`typing` is intentionally not replayed on catchup — the indicator is ephemeral, and surfacing a stale "is typing" state on reconnect is worse than dropping it.

#### Commands (stdin)

```jsonl
{"type":"send","text":"Hello, world!"}
{"type":"send","text":"Replying to you","replyTo":"<message-id>"}
{"type":"react","messageId":"<message-id>","emoji":"👍"}
{"type":"react","messageId":"<message-id>","emoji":"👍","action":"remove"}
{"type":"attach","file":"./photo.jpg"}
{"type":"attach","file":"./photo.jpg","replyTo":"<message-id>"}
{"type":"attach","file":"./photo.jpg","mimeType":"image/jpeg"}
{"type":"remote-attach","url":"https://...","contentDigest":"<hex>","secret":"<base64>","salt":"<base64>","nonce":"<base64>","contentLength":12345,"filename":"photo.jpg"}
{"type":"rename","name":"New Group Name"}
{"type":"read-receipt"}
{"type":"typing"}
{"type":"typing","isTyping":false}
{"type":"lock"}
{"type":"unlock"}
{"type":"explode"}
{"type":"explode","scheduled":"2025-03-01T00:00:00Z"}
{"type":"connection-invoke","kind":"calendar","action":"create_event","arguments":{"title":{"type":"string","value":"Team sync"},"isAllDay":{"type":"bool","value":false}}}
{"type":"connection-invoke","kind":"contacts","action":"create_contact","invocationId":"req-42","arguments":{}}
{"type":"capability-request","subject":"calendar","capability":"read","rationale":"To summarize your week"}
{"type":"capability-request","subject":"fitness","capability":"read","rationale":"To summarize training","preferredProviders":["composio.strava","composio.fitbit"]}
{"type":"stop"}
```

| Command | Required Fields | Optional Fields |
| ------- | --------------- | --------------- |
| `send` | `text` | `replyTo` |
| `react` | `messageId`, `emoji` | `action` (`add`/`remove`, default: `add`) |
| `attach` | `file` (local path) | `mimeType`, `replyTo` |
| `remote-attach` | `url`, `contentDigest`, `secret`, `salt`, `nonce`, `contentLength` | `filename`, `scheme` |
| `rename` | `name` | — |
| `read-receipt` | — | — |
| `typing` | — | `isTyping` (bool, default: `true`) |
| `lock` | — | — |
| `unlock` | — | — |
| `explode` | — | `scheduled` (ISO8601 date) |
| `connection-invoke` | `kind`, `action` | `arguments` (object, default `{}`), `invocationId` (default: `agent-<8-hex>`), `issuedAt` (ISO8601, default: now) |
| `capability-request` | `subject`, `capability`, `rationale` | `requestId` (default: `agent-<8-hex>`), `preferredProviders` (string array, max 16) |
| `stop` | — | — |

Small attachments (≤1MB) are sent inline. Larger files are auto-encrypted and uploaded via the configured upload provider (e.g., Pinata).

**Lock** prevents new members from joining by rotating the invite tag and setting addMember permission to deny. **Unlock** reverses this (previously shared invites remain invalid). **Explode** sends ExplodeSettings and removes every other member — the install's identity is preserved. Immediate explode triggers agent shutdown (the agent was bound to that conversation). **Rename** updates the conversation name visible to all members. **connection-invoke** sends a ConvosConnections invocation (see ConvosConnections section under Important Concepts) — the device replies asynchronously with a `ConnectionInvocationResult` keyed on the same `invocationId`. The reply does not surface as a `message` event (the codec is silent and filtered from the chat stream); it surfaces as a dedicated `connection_result` event on stdout, so agents can correlate by reading lines and matching `invocationId`. **capability-request** is the same shape for capability resolution: agent posts a request naming a `(subject, capability)` pair plus a human rationale, and the device replies asynchronously with a `CapabilityRequestResult` (`approved` / `denied` / `cancelled`) — surfaced as a `capability_result` event with the persisted `providers` array.

### How It Works

When started, `agent serve`:

1. **Creates or attaches** to a conversation
2. **Displays QR code** invite on stderr (so users can scan and join)
3. **Emits `ready` event** with conversation ID, invite URL, and identity info
4. **Processes pending join requests** from before the agent started
5. **Streams messages** — emits `message` events as they arrive in real-time
6. **Streams DM join requests** — automatically adds new members and emits `member_joined`
7. **Reads stdin** — accepts `send`, `rename`, `lock`, `unlock`, `explode`, and `stop` commands
8. **Emits heartbeat** (optional) — periodic health check events when `--heartbeat` is set
9. **Catches up on reconnect** — if a stream disconnects and reconnects, fetches any missed messages since the last seen timestamp

All of these run concurrently. The agent stays alive until `SIGINT`, `SIGTERM`, stdin close, a `stop` command, or an immediate `explode`.

### Example: Agent Integration

```bash
# Start the agent, pipe commands in, read events out
convos agent serve --name "Bot" --profile-name "AI Assistant" | while IFS= read -r event; do
  type=$(echo "$event" | jq -r '.event')
  case "$type" in
    ready)
      echo "Bot ready! Invite URL: $(echo "$event" | jq -r '.inviteUrl')" >&2
      ;;
    message)
      content=$(echo "$event" | jq -r '.content')
      echo "Received: $content" >&2
      # Send a reply (write JSON command to agent's stdin)
      msg_id=$(echo "$event" | jq -r '.id')
      echo "{\"type\":\"send\",\"text\":\"You said: $content\",\"replyTo\":\"$msg_id\"}"
      ;;
    member_joined)
      inbox=$(echo "$event" | jq -r '.inboxId')
      echo "New member: $inbox" >&2
      echo "{\"type\":\"send\",\"text\":\"Welcome!\"}"
      ;;
    connection_payload)
      summary=$(echo "$event" | jq -r '.body.data.summary // "no summary"')
      echo "[connection] $(echo "$event" | jq -r '.source'): $summary" >&2
      ;;
    connection_result)
      # Reply to a connection-invoke we sent — correlate by invocationId
      inv=$(echo "$event" | jq -r '.invocationId')
      status=$(echo "$event" | jq -r '.status')
      echo "[invocation $inv] $status" >&2
      ;;
    capability_result)
      # Reply to a capability-request — correlate by requestId
      req=$(echo "$event" | jq -r '.requestId')
      status=$(echo "$event" | jq -r '.status')
      echo "[capability $req] $status" >&2
      ;;
  esac
done
```

### Agent Flags

| Flag | Description |
| ---- | ----------- |
| `--name` | Conversation name (when creating new) |
| `--description` | Conversation description (when creating new) |
| `--permissions` | `all-members` or `admin-only` (when creating new) |
| `--profile-name` | Display name for this conversation |
| `--no-invite` | Skip generating an invite (attach mode) |
| `--heartbeat` | Emit heartbeat events every N seconds (0 to disable, default: 0) |

## Important Concepts

### Single-Inbox Identity Model (ADR 011)

Every install has exactly one identity, shared across every conversation and DM — matching the Convos iOS app after the single-inbox refactor.

The identity owns:

- **Wallet key** (secp256k1 private key) — signs XMTP + invites
- **DB encryption key** (32-byte key)
- **XMTP inbox** (a single inbox ID that every conversation uses)
- **Local database** (SQLite)

Stored at `<convos-home>/identity.json`. The XMTP database is at `<convos-home>/db/<env>/main.db3`. The data directory defaults to `~/.convos/` but can be overridden with `--home` or `CONVOS_HOME`. To run multiple independent agents on one machine, give each its own `CONVOS_HOME`.

### Invite Flow

1. **Creator** generates an invite URL/QR code (contains encrypted conversation token + creator's inbox ID)
2. **Person opens the invite URL** — their singleton inbox sends a DM join request to the creator
3. **Creator processes the join request** — validates the invite signature, decrypts the conversation token, and adds the person to the group
4. Person is now a member of that group inside their singleton inbox

**Key point:** Step 3 must happen *after* step 2. The creator must either run `process-join-requests` after the invite has been opened, or use `--watch` to stream and process requests as they arrive.

### Profile Messages

Member profiles are stored as XMTP group messages using two custom content types:

- **`ProfileUpdate`** (`convos.org/profile_update:1.0`) — sent by a member when they change their own name or avatar. The sender's inbox ID is implicit from the XMTP message, preventing spoofing.
- **`ProfileSnapshot`** (`convos.org/profile_snapshot:1.0`) — sent after adding members to a group. Contains all current member profiles so new joiners have data immediately (solves MLS forward secrecy gap).

Both are silent (no push notification, not displayed in chat). The CLI reads `appData` profiles as a fallback for backward compatibility with older clients, but does not write profiles there. Custom XMTP content codecs (`ProfileUpdateCodec`, `ProfileSnapshotCodec`) are registered with the XMTP client at creation time so the SDK can decode these message types natively.

Profiles support typed **metadata** — arbitrary key-value pairs where values can be string, number (double), or boolean. Metadata is carried in both `ProfileUpdate` and `ProfileSnapshot` messages via a `map<string, MetadataValue>` protobuf field. Use `--metadata key=value` on `update-profile` (repeatable, auto-typed: "true"/"false" → bool, numeric → number, else string). Metadata merges with existing values (new keys overwrite, unmentioned keys preserved).

Profile **images** are encrypted end-to-end using the same scheme as iOS: HKDF-SHA256 derives a per-image AES-256-GCM key from the group's `imageEncryptionKey` (stored in appData) + random 32-byte salt, then encrypts with a random 12-byte nonce. The encrypted blob is uploaded via the configured upload provider and the URL + salt + nonce are sent as `EncryptedProfileImageRef` in the `ProfileUpdate` message. If no `imageEncryptionKey` exists for the group, the CLI generates one and writes it to appData.

Supported upload providers:
- **Convos API:** `CONVOS_UPLOAD_PROVIDER=convos-api`, `CONVOS_API_KEY=<agent-assets-api-key>`, optional `CONVOS_API_BASE_URL=<url>` (auto-derived from XMTP env: dev → `https://api.dev.convos.xyz/api`, production → `https://api.prod.convos.xyz/api`). Uses the agent asset upload endpoint (`GET /v2/agents/assets/presigned`) with `X-Agent-API-Key` header auth — no JWT step needed.
- **Pinata (IPFS):** `CONVOS_UPLOAD_PROVIDER=pinata`, `CONVOS_UPLOAD_PROVIDER_TOKEN=<jwt>`, optional `CONVOS_UPLOAD_PROVIDER_GATEWAY=<url>`
- **S3 (direct):** `CONVOS_UPLOAD_PROVIDER=s3`, `CONVOS_UPLOAD_PROVIDER_TOKEN=<accessKeyId>:<secretAccessKey>`, `CONVOS_S3_BUCKET=<bucket>`, optional `CONVOS_S3_REGION=<region>` (default: us-east-1), optional `CONVOS_S3_ENDPOINT=<url>` (for S3-compatible services like MinIO, R2), optional `CONVOS_UPLOAD_PROVIDER_GATEWAY=<public-url-prefix>`

### Join Request Messages

Join requests use a structured content type instead of plain text:

- **`JoinRequest`** (`convos.org/join_request:1.0`) — sent as a DM to the conversation creator when joining via invite. Contains the invite slug, joiner's profile (name, image, memberKind), and optional metadata.

The CLI sets `memberKind: "agent"` by default on all join requests so the creator knows a bot is joining. For backward compatibility, the CLI sends both the JoinRequestContent message and a plain text slug — older clients that don't understand the new content type will read the text fallback. When processing incoming join requests, the CLI tries JoinRequestContent first, then falls back to plain text.

### ConvosConnections (Device Data Sources & Sinks)

ConvosConnections lets an iOS user wire native device frameworks (HealthKit, Calendar, Contacts, Location, Photos, Music, HomeKit, Screen Time, Motion) into a conversation, so an agent in the same group can both **receive sensor data** from the device and **request writes back** to it. The wire-level handshake is three custom XMTP content codecs, all under `convos.org`. The CLI registers them on every client, so encoded messages decode into structured objects automatically rather than landing as opaque bytes. All three are silent (`shouldPush = false`) — they do **not** appear in the chat stream and do not generate notifications. Agents must reach in via the dedicated helpers (see below) instead of expecting them to surface through `agent serve`'s `message` events.

#### Content Types

| Content Type | Direction | Role | Fallback |
| ------------ | --------- | ---- | -------- |
| `convos.org/connection_payload:1.0` | device → agent | Sensor reading from a device data source | `payload.body.data.summary` |
| `convos.org/connection_invocation:1.0` | agent → device | Request the device to execute a named action | `Action requested: <name>` |
| `convos.org/connection_invocation_result:1.0` | device → agent | Reply to an invocation, always emitted (success or error) | `<actionName>: <status>` |

All three encode their content as JSON. The TypeScript types (`ConnectionPayload`, `ConnectionInvocation`, `ConnectionInvocationResult`) ship from `@xmtp/convos-cli/utils/connectionPayload`, `.../connectionInvocation`, and `.../connectionInvocationResult`. Shared enums and the `ArgumentValue` tagged union live in `.../connectionTypes`.

#### ConnectionKind

`kind` (and `source` on payloads) identifies the device data source. Raw values are snake_case for compound names:

| Raw value | Source |
| --------- | ------ |
| `health` | HealthKit |
| `calendar` | EventKit calendars |
| `contacts` | Contacts framework |
| `location` | CoreLocation visits / region monitoring |
| `photos` | PhotoKit |
| `music` | MusicKit / MPMusicPlayerController |
| `home_kit` | HomeKit |
| `screen_time` | Screen Time / FamilyControls |
| `motion` | CoreMotion activity classifier |

Forward compatibility: a `ConnectionPayload` body uses a `{type, data}` discriminator. If iOS ships a new source the CLI doesn't recognize, the message still round-trips — `payload.body.type` is the new raw string and `payload.body.data` is the un-typed JSON object.

#### Invocation Flow

```
agent                                       iOS device
  |                                              |
  |  ConnectionInvocation                        |
  |    invocationId: "agent-1-001"               |
  |    kind: "calendar"                          |
  |    action: { name, arguments }               |
  |--------------------------------------------->|
  |                                              | (gates via per-conversation
  |                                              |  enablement; may prompt user)
  |                                              |
  |              ConnectionInvocationResult      |
  |                invocationId: "agent-1-001"   |
  |                status: "success" | ...       |
  |                result: { ... } | {}          |
  |<---------------------------------------------|
```

The agent picks the `invocationId` and uses it to correlate the reply. The device echoes the same `invocationId` on the result so multiple in-flight invocations don't get confused. If the agent's invocation references a `kind` that isn't enabled for the conversation, the device replies with `status: "capability_not_enabled"` rather than executing.

#### Discovering Enabled Capabilities

There is no capability-advertisement content type — agents discover what's available by observing payloads and probing invocations.

**Capabilities are a private per-conversation gate on the device, with four independent dimensions:**

| Capability raw | Meaning |
| -------------- | ------- |
| `read` | The source may publish `ConnectionPayload` messages into this conversation |
| `write_create` | Actions that create a new record (e.g. `create_event`, `create_calendar`, `create_contact`) |
| `write_update` | Actions that modify an existing record (e.g. `update_event`) |
| `write_delete` | Actions that destroy a record (e.g. `delete_event`) |

Each `ActionSchema` declares which capability it consumes — `create_event` and `create_calendar` both require `calendar.write_create`; `update_event` requires `calendar.write_update`; `delete_event` requires `calendar.write_delete`. A user can enable any subset (for example, read + create but not delete).

**Read capability is announced implicitly.** When the user enables `(kind, read, conversation)`, iOS's source starts publishing `ConnectionPayload` messages of that source into the conversation. The first inbound payload with `source: "calendar"` is the agent's proof that calendar reads are enabled here. Stop seeing payloads for a while? Don't infer revocation from silence — the source may simply have nothing new to report. The user revoking read does not generate a teardown message; the agent just stops receiving payloads.

**Write capabilities are discovered by probing.** Send the invocation and read back the status:

| Result status | Agent action |
| ------------- | ------------ |
| `success` | Enabled and executed; consume `result` |
| `capability_not_enabled` | Capability is off — ask the user in chat to enable it. The `errorMessage` carries the specific capability raw value, so you can be precise ("please enable calendar create") |
| `unknown_action` | Either the action name is wrong, or this iOS build doesn't expose this `(kind, action)` pair (e.g. older app version), or the invocation's `schemaVersion` is newer than the device knows. Treat as unsupported on this device. |
| `authorization_denied` | Always-confirm is on and the user said no this time. Don't retry the same invocation without user prompting. |
| `requires_confirmation` | Always-confirm is on but the device couldn't surface the prompt (app backgrounded, no handler). Retry later, or ask the user to open Convos. |
| `capability_revoked` | Was enabled at gate-check, off at execution. Treat the same as `capability_not_enabled`. |
| `execution_failed` | Capability was on but the underlying iOS framework errored. `errorMessage` carries the detail; report verbatim, do not auto-retry. |

**Action schemas don't travel over the wire.** `ConnectionsManager.actionSchemas(for:)` is in-process on iOS — agents must know the schema for an action ahead of time. The canonical source is each iOS `<Kind>ActionSchemas.swift` (e.g. `CalendarActionSchemas.swift`); this skill keeps a documented snapshot for the kinds users care about, starting with Calendar below.

**Pattern for a polite agent:**

1. On joining a conversation, listen for `ConnectionPayload` messages to learn which `kind`s the user has enabled for reads.
2. When the agent has a write it wants to do, just send the invocation. Don't ask for permission first — the device's gate is the source of truth.
3. If the result is `capability_not_enabled`, send a chat message naming the specific capability and how to enable it ("I'd like to add an event to your calendar — turn on Calendar → Create in Convos when you're ready"), then back off until you see a related payload (rough proxy for the user having opened the connection settings).
4. If the result is `unknown_action`, log it but don't pester the user — their iOS build can't run that action regardless.
5. Do not store an internal "is enabled" cache for longer than a single transaction; the user can toggle it off in Settings without notice. The wire is the cache.

Action names and argument shapes are **not** carried on the CLI side — they're defined by `ActionSchema` declarations on each iOS `DataSink`. Agents must know the schema for the action they're invoking ahead of time.

#### Capability Resolution

iOS uses a unified subject/provider model that lets cloud-OAuth providers (Composio-linked services like Google Calendar, Strava, Fitbit) satisfy the same capability requests that route to device frameworks. Two new wire codecs landed in [convos-ios#771](https://github.com/xmtplabs/convos-ios/pull/771) — `convos.org/capability_request:1.0` and `convos.org/capability_request_result:1.0` — both registered on every CLI client and filtered out of the chat stream alongside the existing connection codecs. The wider routing layer (resolver dispatching `ConnectionInvocation` by subject, the `profile.metadata["connections"]` manifest) is rolling out incrementally; the wire-level pieces an agent needs to actively use today are the two codecs documented in this section.

##### Subjects vs. kinds

`ConnectionKind` (the wire field on `ConnectionInvocation` and `ConnectionPayload` today) describes a **device** data source. `CapabilitySubject` (the upcoming routing key) describes what an agent is asking for, agnostic of device vs. cloud. They're deliberately separate enums:

| `ConnectionKind` (wire today) | `CapabilitySubject` (upcoming) | Notes |
| ----------------------------- | ------------------------------ | ----- |
| `health` | `fitness` | Renamed user-facing; the same Apple Health `DataSource` becomes one provider for the `fitness` subject |
| `home_kit` | `home` | Renamed user-facing |
| `screen_time` | `screen_time` | Same |
| `calendar` / `contacts` / `location` / `photos` / `music` | identical | |
| `motion` | _(no equivalent)_ | Motion is device-only telemetry; doesn't surface as a user-facing subject |
| _(no equivalent)_ | `tasks`, `mail` | Subjects without a device counterpart yet |

When the routing migration ships, `ConnectionInvocation` will gain an optional `subject` field. During the transition `kind == "calendar"` implies `subject == "calendar"`; once routing is fully subject-based, `kind` becomes device-specific and `subject` is the source of truth. The CLI will be updated then; for now `ConnectionInvocation` still uses `kind` as documented above. `CapabilityRequest` already routes by subject because it never had a `kind` field to migrate.

##### Providers and the registry

A `CapabilityProvider` is a concrete way to satisfy a subject. Provider IDs are dotted strings:

- `device.calendar`, `device.contacts`, `device.health`, … (registered by `ConnectionsManager` at startup, one per `ConnectionKind`)
- `composio.google_calendar`, `composio.strava`, `composio.fitbit`, … (registered by the cloud-OAuth subsystem on link, removed on unlink)

Each provider declares a `Set<ConnectionCapability>` describing which verbs it supports — a read-only Strava provider just publishes `[read]`. A user can have several providers linked for the same subject (Apple Calendar + Google Calendar + Outlook), so the resolver picks one (or many, for federating reads) per `(subject, conversation, capability)`.

##### Resolution and read federation

A resolution row binds `(subject, conversationId, capability)` to a `Set<ProviderID>`. The cardinality matrix from the PRD:

| `subject.allowsReadFederation` | Capability | Allowed set size |
| ------------------------------ | ---------- | ---------------- |
| `false` (default) | `read` | exactly 1 |
| `false` | any write | exactly 1 |
| `true` | `read` | ≥ 1 |
| `true` | any write | exactly 1 (writes never federate) |

Only `fitness` opts in to read federation in v1 — Strava + Fitbit + Apple Health summed across a week is the natural agent ask. Every other subject (calendar, contacts, photos, music, location, home, screen_time, mail, tasks) is single-provider for every verb. The default is conservative because flipping a subject to `true` later is non-breaking; the reverse is breaking.

For federating subjects, each verb is independent: read can resolve to `{Strava, Fitbit}` while `write_create` is `{Strava}`.

##### Wire shape: `convos.org/capability_request:1.0`

Agent → user, "may I have this capability?". JSON-encoded.

| Field | Type | Notes |
| ----- | ---- | ----- |
| `version` | `int` | Currently `1`. Decoders reject anything higher to keep hostile or future senders from smuggling fields the picker can't render. |
| `requestId` | `string` | Caller-chosen correlation key. Echoed back on the result. |
| `subject` | `CapabilitySubject` raw | `calendar`, `fitness`, `home`, etc. — the user-facing routing key. |
| `capability` | `ConnectionCapability` raw | `read`, `write_create`, `write_update`, or `write_delete`. |
| `rationale` | `string` | Shown verbatim on the picker card. **Truncated at 500 chars** on encode and decode — going over the cap doesn't fail, but the user only sees the prefix. |
| `preferredProviders` | `string[]` (optional) | Agent hint — provider IDs the resolver should default to (e.g. `["device.calendar"]` or `["composio.strava", "composio.fitbit"]`). **Truncated at 16 entries.** Resolver may override if the hint isn't applicable (provider unlinked, doesn't match the verb's federation rule, etc.). |

Fallback string (rendered when a client doesn't have the codec): `"The assistant is requesting access to your <subject>"` — subject lowercased.

##### Wire shape: `convos.org/capability_request_result:1.0`

Device → agent picker outcome. Always emitted, even on cancel/deny, so the agent can correlate by `requestId` and stop waiting.

| Field | Type | Notes |
| ----- | ---- | ----- |
| `version` | `int` | Currently `1`. |
| `requestId` | `string` | Echoes the request's `requestId`. |
| `status` | `string` | `approved` \| `denied` \| `cancelled`. |
| `subject` / `capability` | as above | |
| `providers` | `string[]` | Empty for `denied` / `cancelled`. For `approved`, size 1 for non-federating subjects and write verbs, ≥ 1 for federating-subject reads. **Truncated at 16 entries.** Reflects what the resolver actually persisted — agents that supplied a `preferredProviders` hint should compare against this to confirm whether their hint was honored. |

Fallback strings:

- `approved`: `"Approved <subject> access"`
- `denied`: `"Declined <subject> access"`
- `cancelled`: `"Cancelled <subject> access request"`

##### `profile.metadata["connections"]` manifest (in flight)

A unified per-sender manifest, published on every `ProfileUpdate` under the `connections` key, listing every provider available to the sender plus per-verb `resolved` flags so agents can plan tool calls without speculative probing. The wire codec for capability requests has shipped (above), but the manifest writer is still rolling out — the CLI will start surfacing it through `profile.metadata` once iOS commits to the shape. See the [PRD](https://github.com/xmtplabs/convos-ios/blob/jarod/convos-connections-squashed/docs/plans/capability-resolution.md#runtime-capabilities-manifest) for the planned structure.

Note the key reuse: the original CloudConnections design (PR #719) was going to publish a separate OAuth-only `connections` payload, but that's been folded into the unified shape — when this lands, every capabilities-aware iOS build emits one manifest under `connections` covering both device sources and cloud providers, not two parallel keys.

##### What this changes for agents

- **Pre-emptive consent.** Instead of firing a write invocation and getting `capability_not_enabled` back, an agent can post a `capability_request` first; the user's pick persists per `(subject, conversation, capability)`, so subsequent invocations on the same `ConnectionKind` (until the manifest's subject-routing migration completes) land cleanly.
- **Probe-driven discovery is still load-bearing for now.** Until the `metadata["connections"]` manifest ships, the "polite agent" pattern under "Discovering Enabled Capabilities" remains the right way to learn what's enabled. Sending a `capability_request` is a complement, not a replacement — use it when you know up front you'll need a capability and want to surface the picker before the user is mid-conversation.
- **Federated reads aggregate.** When fitness reads resolve to multiple providers, the device fans the read out and returns one combined payload with a `partialFailures` array if any provider errored. Agents handling fitness data should expect that shape rather than assuming a single-source result.
- **Provider unlink is silent.** When the user unlinks a cloud provider, resolutions referencing it are pruned — single-element rows delete (next invocation re-prompts), multi-element rows shrink. No teardown message hits the wire.

##### Sending a CapabilityRequest from the CLI

```bash
# request calendar reads
convos conversation send-capability-request <conversation-id> \
  --subject calendar --capability read \
  --rationale "To summarize your week"

# request fitness reads with a federation hint (only fitness allows multi-provider reads)
convos conversation send-capability-request <conversation-id> \
  --subject fitness --capability read \
  --rationale "To summarize training" \
  --preferred-providers composio.strava,composio.fitbit

# request a write capability with a pinned correlation id
convos conversation send-capability-request <conversation-id> \
  --subject contacts --capability write_create \
  --rationale "To save the lead you mentioned" \
  --request-id req-42 --json
```

`--subject` and `--capability` are validated against the documented enum sets; `--rationale` is required and gets truncated at 500 chars on encode (matches the iOS cap). `--preferred-providers` takes a comma-separated list of provider IDs and is capped at 16 entries. `--request-id` defaults to a random `cli-<8-hex>` token; pin it when you need to correlate the eventual `CapabilityRequestResult` deterministically.

##### Sending a CapabilityRequest from `agent serve`

The agent stdin protocol exposes the same path under `capability-request`:

```jsonl
{"type":"capability-request","subject":"calendar","capability":"read","rationale":"To summarize your week"}
{"type":"capability-request","subject":"fitness","capability":"read","rationale":"To summarize training","preferredProviders":["composio.strava","composio.fitbit"]}
{"type":"capability-request","subject":"contacts","capability":"write_create","rationale":"Saving your lead","requestId":"req-42"}
```

| Required | Optional |
| -------- | -------- |
| `subject`, `capability`, `rationale` | `requestId` (default: `agent-<8-hex>`), `preferredProviders` (string array) |

The agent emits a `sent` event of `type: "capability-request"` carrying both the message `id` and the `requestId`. The eventual `CapabilityRequestResult` arrives as a regular message but is filtered from the chat stream (codec is silent), so agent code that wants to react to it must consume `getCapabilityRequestResultContent(message)` from a stream loop, the same way it would for `ConnectionInvocationResult`.

---

#### Action Schema Reference

Other kinds expose actions in the same shape — short examples from the iOS package:

- Contacts: `create_contact(givenName, familyName, email, phone, …)`
- Health: `log_water(amount, unit)`, `log_workout(activityType, startDate, endDate, …)`
- Photos: `save_image(url, …)`
- Music: `play(title, artist, …)`

##### Calendar action schemas

The Calendar `DataSink` exposes four actions. Required inputs in **bold**; outputs are returned in `ConnectionInvocationResult.result` on `status: "success"`.

**`create_event`** — write a new event.

| Input | Type | Notes |
| ----- | ---- | ----- |
| **`title`** | `string` | |
| **`startDate`** | `iso8601` | RFC 3339 with offset, e.g. `2026-05-01T15:00:00-07:00` |
| **`endDate`** | `iso8601` | RFC 3339 with offset |
| **`timeZone`** | `string` | IANA identifier, e.g. `America/Los_Angeles` |
| `isAllDay` | `bool` | Defaults to false |
| `location` | `string` | Free-form |
| `notes` | `string` | |
| `calendarId` | `string` | Target calendar identifier. Omit to use the user's default calendar |
| `calendarTitle` | `string` | Target calendar title; collisions return `execution_failed` |

Outputs: `eventId` (string), `calendarId` (string — identifier of the calendar the event was written to).

**`update_event`** — patch an existing event. All inputs except `eventId` are optional; pass only the fields you're changing.

| Input | Type | Notes |
| ----- | ---- | ----- |
| **`eventId`** | `string` | Identifier returned from a prior `create_event` |
| `title` | `string` | |
| `startDate` | `iso8601` | RFC 3339 with offset |
| `endDate` | `iso8601` | RFC 3339 with offset |
| `timeZone` | `string` | Required if `startDate` or `endDate` is supplied |
| `location` | `string` | |
| `notes` | `string` | |
| `span` | `enum` | `thisEvent` or `futureEvents`. Defaults to `futureEvents` |

Outputs: `eventId` (string).

**`delete_event`** — remove an event.

| Input | Type | Notes |
| ----- | ---- | ----- |
| **`eventId`** | `string` | |
| `span` | `enum` | `thisEvent` or `futureEvents`. Defaults to `futureEvents` |

Outputs: none (empty `result` map on success).

**`create_calendar`** — create a new calendar that subsequent `create_event` invocations can target via the returned `calendarId`.

| Input | Type | Notes |
| ----- | ---- | ----- |
| **`title`** | `string` | Display name of the new calendar |
| `color` | `string` | Hex color, e.g. `"#FF8800"` or `"#FF8800AA"`. Falls back to the source's default |
| `sourceType` | `enum` | `iCloud` or `local`. Defaults to iCloud if available, falling back to local |

Outputs: `calendarId` (string — `EKCalendar.calendarIdentifier`).

Chained example — provision a per-conversation calendar then write into it:

```jsonl
{"type":"connection-invoke","kind":"calendar","action":"create_calendar","invocationId":"req-create-cal","arguments":{"title":{"type":"string","value":"Team Standups"},"color":{"type":"string","value":"#FF8800"},"sourceType":{"type":"enum","value":"iCloud"}}}
```

After the device returns `{"status":"success", "result":{"calendarId":{"type":"string","value":"<cal-id>"}}}`, plug that `calendarId` into `create_event`:

```jsonl
{"type":"connection-invoke","kind":"calendar","action":"create_event","invocationId":"req-evt-1","arguments":{"title":{"type":"string","value":"Daily standup"},"startDate":{"type":"iso8601","value":"2026-05-04T09:00:00-07:00"},"endDate":{"type":"iso8601","value":"2026-05-04T09:15:00-07:00"},"timeZone":{"type":"string","value":"America/Los_Angeles"},"calendarId":{"type":"string","value":"<cal-id>"}}}
```

#### ConnectionPayload

```ts
interface ConnectionPayload {
  id: string;                    // uppercase UUID
  schemaVersion: number;         // currently 1
  source: ConnectionKind;
  capturedAt: number;            // Swift reference date seconds (see Wire Format)
  body: {
    type: ConnectionKind | string;  // unknown future kinds round-trip as string
    data: unknown;               // source-specific shape; usually has a `summary` field
  };
}
```

Use `summarizeConnectionPayload(payload)` for a human-readable line — it pulls `body.data.summary` when present and falls back to `Unknown payload (<type>)`.

#### ConnectionInvocation

```ts
interface ConnectionInvocation {
  id: string;                    // uppercase UUID (envelope ID)
  schemaVersion: number;         // currently 1
  invocationId: string;          // agent-chosen correlation key (echoed on the result)
  kind: ConnectionKind;
  action: {
    name: string;                // e.g. "create_event"
    arguments: Record<string, ArgumentValue>;
  };
  issuedAt: number;              // Swift reference date seconds
}
```

#### ConnectionInvocationResult

```ts
interface ConnectionInvocationResult {
  id: string;                    // uppercase UUID (envelope ID)
  schemaVersion: number;         // currently 1
  invocationId: string;          // matches the request
  kind: ConnectionKind;
  actionName: string;
  status: InvocationStatus;
  result: Record<string, ArgumentValue>;  // populated only on `success`
  errorMessage?: string;         // present on non-success when iOS surfaces a message
  completedAt: number;           // Swift reference date seconds
}
```

`InvocationStatus` (raw values, snake_case):

| Status | Meaning |
| ------ | ------- |
| `success` | Action executed; `result` carries the outputs |
| `capability_not_enabled` | The user has not enabled this `kind` for this conversation |
| `capability_revoked` | The user previously enabled and has since revoked |
| `requires_confirmation` | The action requires interactive confirmation that hasn't happened |
| `authorization_denied` | The OS framework denied the underlying authorization (e.g. HealthKit permission) |
| `execution_failed` | The action ran but the framework returned an error (see `errorMessage`) |
| `unknown_action` | The device build doesn't recognize this action name for this kind |

#### ArgumentValue

Both `action.arguments` and `result` use a tagged-union value type so each parameter carries its declared type alongside the value. Wire form is `{"type": <tag>, "value": …}`:

| Tag | Value type | Notes |
| --- | ---------- | ----- |
| `string` | `string` | |
| `bool` | `boolean` | |
| `int` | `number` | Integer; producers should not send fractional values |
| `double` | `number` | Floating-point |
| `date` | `number` | Swift reference date seconds |
| `iso8601` | `string` | Pre-formatted ISO 8601 datetime — preferred over `date` when the value comes from user input or the wire |
| `enum` | `string` | Constrained to the action schema's `allowed` list |
| `array` | `ArgumentValue[]` | Recursive |
| `null` | `null` | |

The CLI validates the tag and value type on encode and decode and throws on the first mismatch — agents constructing invocations get a clear error if they pass `{type: "int", value: "1"}` or `{type: "uint64", …}`.

Pick `iso8601` over `date` when the value is a calendar moment (event start, deadline) — it round-trips human-readably and is what the iOS calendar/photos action schemas expect. Use `date` only when the value is a wall-clock instant produced by the device itself.

#### Wire Format Notes

These are mostly invisible — the codecs handle them — but matter when constructing payloads from raw JSON or comparing against captures from another tool:

- **Dates** are encoded as `Double` seconds since the **Swift reference date** (2001-01-01 00:00:00 UTC), not the Unix epoch. The CLI exposes `dateToSwiftReference(date)` and `swiftReferenceToDate(seconds)` from `@xmtp/convos-cli/utils/connectionTypes`. Don't use `Date.now() / 1000` — that produces a Unix timestamp and iOS will decode it as ~50 years in the future.
- **UUIDs** are uppercase hex with dashes (`AABBCCDD-EEFF-1122-3344-556677889900`), matching Swift's default `UUID` encoding. Lowercase will decode but echoes back uppercase.
- **Enum raw values** are lowercase or snake_case — never camelCase.
- **`shouldPush` is false** for all three codecs. They are intentionally invisible to the chat stream and the push-notification pipeline. `isDisplayableMessage` filters them out; `agent serve` does not emit `message` events for them.

#### Sending an Invocation from the CLI

```bash
# raw JSON arguments
convos conversation send-invocation <conversation-id> \
  --kind calendar \
  --action create_event \
  --arguments '{"title":{"type":"string","value":"Team sync"},"isAllDay":{"type":"bool","value":false}}'

# arguments from a file (handy for non-trivial payloads)
convos conversation send-invocation <conversation-id> \
  --kind health --action log_water --arguments-file ./water.json

# pin a known invocationId for correlating the eventual result
convos conversation send-invocation <conversation-id> \
  --kind contacts --action create_contact \
  --invocation-id req-42 \
  --arguments '{}' \
  --json
```

`--kind` must be one of the nine `ConnectionKind` raw values. `--arguments` (or `--arguments-file`) is required — pass `'{}'` for an action with no parameters. Each value is validated as an `ArgumentValue` tagged object before the message is sent; a malformed tag (`{type:"uint64",…}`) or a value-type mismatch (`{type:"int",value:"1"}`) errors out without sending. `--invocation-id` defaults to a random `cli-<8-hex>` token; pin it when you need to correlate the eventual result deterministically. The output JSON includes both the envelope `id` (per-message UUID) and the caller-correlation `invocationId`.

The CLI does **not** expose a corresponding `send-payload` or `send-result` command — those are device-originated and only iOS produces them in production.

#### Sending an Invocation from `agent serve`

The agent stdin protocol exposes the same path under the `connection-invoke` command type — see the Agent Mode section's Commands table. The wire-level outcome is identical to `send-invocation`; the agent emits a `sent` event with `type: "connection-invoke"`, the message `id`, and both `invocationId` and `envelopeId` for correlation.

```jsonl
{"type":"connection-invoke","kind":"calendar","action":"create_event","arguments":{"title":{"type":"string","value":"Team sync"},"startDate":{"type":"iso8601","value":"2026-05-01T15:00:00-07:00"},"isAllDay":{"type":"bool","value":false}}}
```

#### Consuming Connection Messages from an Agent

`agent serve` emits structured stdout events for every silent codec — `connection_payload`, `connection_invocation`, `connection_result`, `capability_request`, `capability_result`, and `explode_notice` (see the Events table under Agent Mode). The fields mirror the decoded codec content directly, so the typical agent loop is:

```jsonl
// stdout (excerpt)
{"event":"ready","conversationId":"…","inviteUrl":"…","inboxId":"…"}
{"event":"connection_payload","id":"msg-abc","envelopeId":"E1A…","senderInboxId":"u1","conversationId":"c1","source":"calendar","schemaVersion":1,"capturedAt":721692800,"body":{"type":"calendar","data":{"summary":"2 events today"}},"sentAt":"2026-04-28T12:00:00.000Z"}
{"event":"capability_result","id":"msg-def","senderInboxId":"u1","conversationId":"c1","version":1,"requestId":"req-1","status":"approved","subject":"calendar","capability":"read","providers":["device.calendar"],"sentAt":"2026-04-28T12:00:05.000Z"}
{"event":"connection_result","id":"msg-ghi","envelopeId":"E2B…","senderInboxId":"u1","conversationId":"c1","invocationId":"agent-1-001","kind":"calendar","actionName":"create_event","status":"success","schemaVersion":1,"result":{"eventId":{"type":"string","value":"evt-1"}},"completedAt":721692900,"sentAt":"2026-04-28T12:01:30.000Z"}
```

Live and catchup share the same event shape; catchup events carry `"catchup": true`. Dedupe is handled inside `agent serve` via message id, so an agent that wires its own retry/reconnect logic on top of stdin commands won't double-process a result if the stream reconnects while it was firing.

For agents that embed the CLI as a library rather than driving it via stdin, the same library helpers used by `agent serve` are exported under `@xmtp/convos-cli/utils/...`:

```ts
import {
  ConnectionInvocationCodec,
  isConnectionInvocationMessage,
  getConnectionInvocationContent,
} from "@xmtp/convos-cli/utils/connectionInvocation";
import {
  isConnectionPayloadMessage,
  getConnectionPayloadContent,
  summarizeConnectionPayload,
} from "@xmtp/convos-cli/utils/connectionPayload";
import {
  isConnectionInvocationResultMessage,
  getConnectionInvocationResultContent,
} from "@xmtp/convos-cli/utils/connectionInvocationResult";
import {
  dateToSwiftReference,
  type ArgumentValue,
} from "@xmtp/convos-cli/utils/connectionTypes";
import { randomUUID } from "node:crypto";

// Read: route incoming messages to the right handler.
for await (const message of stream) {
  if (isConnectionPayloadMessage(message)) {
    const payload = getConnectionPayloadContent(message);
    if (payload) console.log(summarizeConnectionPayload(payload));
    continue;
  }
  if (isConnectionInvocationResultMessage(message)) {
    const result = getConnectionInvocationResultContent(message);
    // correlate result.invocationId against an in-flight request table
    continue;
  }
  // ... handle text, attachments, etc.
}

// Write: send a calendar create_event invocation.
const invocation = {
  id: randomUUID().toUpperCase(),
  schemaVersion: 1,
  invocationId: "agent-1-001",
  kind: "calendar" as const,
  action: {
    name: "create_event",
    arguments: {
      title: { type: "string", value: "Team sync" },
      startDate: { type: "iso8601", value: "2026-05-01T15:00:00-07:00" },
      endDate: { type: "iso8601", value: "2026-05-01T16:00:00-07:00" },
      timeZone: { type: "string", value: "America/Los_Angeles" },
      isAllDay: { type: "bool", value: false },
    } satisfies Record<string, ArgumentValue>,
  },
  issuedAt: dateToSwiftReference(new Date()),
};
const codec = new ConnectionInvocationCodec();
await conversation.send(invocation, codec.contentType);
```

Pure-shell agents can stick to the `agent serve` stdout events — piping through `jq -r 'select(.event == "connection_payload" or .event == "capability_result")'` is the supported way to filter without embedding the library.

### Consent States

| State | Meaning |
| ----- | ------- |
| `allowed` | Messages are welcome |
| `denied` | Messages are blocked |
| `unknown` | No decision made |

### Environment Networks

| Network | Use Case |
| ------- | -------- |
| `local` | Local XMTP node |
| `dev` | Development/testing (default) |
| `production` | Production use |

### Data Directory

The data directory defaults to `~/.convos/` but can be overridden with `--home` or `CONVOS_HOME`:

```
<convos-home>/          # default: ~/.convos/
├── .env                # Global config (env only)
├── identity.json       # Singleton identity: wallet key, db key, inbox ID
└── db/
    └── dev/            # XMTP database for this install, by environment
        └── main.db3
```

## Error Handling

1. **Not initialized**: Run `convos init` to create configuration
2. **No identities**: Create a conversation or identity first
3. **Identity not found**: Use `convos identity list` to see available identities
4. **Conversation not found**: Sync first with `convos conversations sync`
5. **Permission denied**: Check group permissions with `convos conversation permissions`
6. **Invite expired or invalid**: Generate a new invite with `convos conversation invite`

## Complete Example

```bash
# 1. initialize (first time only)
convos init --env dev

# 2. create a conversation
CONV=$(convos conversations create --name "Project Team" --profile-name "Alice" --json)
CONV_ID=$(echo "$CONV" | jq -r '.conversationId')

# 3. generate an invite for others to join
convos conversation invite "$CONV_ID"

# 4. wait for the person to open the invite URL or scan the QR code,
#    then process their join request
convos conversations process-join-requests --conversation "$CONV_ID"

# OR: if you don't know when they'll open it, watch for requests
# convos conversations process-join-requests --watch --conversation "$CONV_ID"

# 5. send a message
convos conversation send-text "$CONV_ID" "Welcome to the team!"

# 6. stream messages
convos conversation stream "$CONV_ID" --timeout 300
```

## Tips

1. **Always display the full QR code**: The `conversation invite` and `conversations create` commands output a scannable QR code rendered in Unicode block characters followed by the invite URL. When showing the user the result, you **must** display the complete, unmodified command output so the QR code renders correctly in the terminal. Do not summarize, truncate, or omit the QR code — it is the primary way users share invites. Always show the full stdout output to the user. When running `agent serve`, the QR code is saved as a PNG file (path in the `qrCodePath` field of the `ready` event) — display it to the user using the read tool so they can scan it.
2. **Never use markdown in messages**: Convos does not render markdown. When sending messages (via `send-text`, `send-reply`, or agent `send` commands), always use plain text. Do not use markdown formatting like `**bold**`, `*italic*`, `# headings`, `` `code` ``, `[links](url)`, or bullet lists with `- ` or `* `. Write naturally in plain text instead.
3. **Identities are automatic**: You rarely need to manage them directly — creating/joining conversations handles it
4. **Use JSON output for scripting**: Add `--json` flag when extracting data programmatically
5. **Use `--fields` to limit output**: When fetching messages or other large responses, use `--fields` to include only the fields you need — this saves context window tokens and reduces noise. e.g. `--fields id,content,senderInboxId`
6. **Sync before reading**: Add `--sync` flag when reading messages to ensure fresh data
6. **Process join requests after invite is opened**: After generating an invite, wait for the person to open/scan it, then run `process-join-requests`. If you don't know when they'll open it, use `--watch` to stream requests as they arrive
7. **Lock before exploding**: Lock a conversation first to prevent new joins, then explode when ready
8. **Dangerous operations require --force**: Commands like `explode`, `identity remove`, and `lock` prompt for confirmation unless `--force` is passed
9. **Check command help**: Run `convos <command> --help` for full flag documentation
10. **Use `convos schema` for runtime introspection**: `convos schema` lists all commands as JSON, `convos schema <command>` shows full args/flags/examples for a specific command. Useful for discovering capabilities without pre-loaded docs
