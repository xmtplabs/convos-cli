---
name: convos-cli
description: Use when working with Convos messaging - privacy-focused ephemeral messaging with per-conversation identities, invites, profiles, and group management via the convos CLI tool
---

# Convos CLI

The Convos CLI (`convos`) is a command-line tool for privacy-focused ephemeral messaging built on [XMTP](https://xmtp.org). Unlike standard XMTP, Convos creates a **unique identity per conversation** so conversations cannot be linked or correlated.

Key differences from standard XMTP:

- **Per-conversation identities**: Each conversation gets its own wallet, inbox, and database
- **No global wallet key**: Identities are created automatically when creating/joining conversations
- **Invite system**: Serverless QR code + URL invites for joining conversations
- **Per-conversation profiles**: Different display name and avatar in each conversation
- **Explode**: Permanently destroy a conversation and all cryptographic keys
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
```

This creates a `.env` file with:

- `CONVOS_ENV` - Network environment (local, dev, production)
- `CONVOS_UPLOAD_PROVIDER` - Upload provider for attachments (e.g., `pinata`)
- `CONVOS_UPLOAD_PROVIDER_TOKEN` - Authentication token for upload provider
- `CONVOS_UPLOAD_PROVIDER_GATEWAY` - Custom gateway URL for upload provider

**Note:** Unlike standard XMTP, there is no global wallet key. Each conversation creates its own identity stored in `~/.convos/identities/`.

### Configuration Loading Priority

1. CLI flags (highest priority)
2. Explicit `--env-file <path>`
3. `.env` in the current working directory
4. `~/.convos/.env` (global default)

## Command Structure

```
convos [TOPIC] [COMMAND] [ARGUMENTS] [FLAGS]
```

### Topics

| Topic | Purpose |
| ----- | ------- |
| `agent` | Agent mode — long-running sessions with streaming I/O |
| `identity` | Manage per-conversation identities (inboxes) |
| `conversations` | List, create, join, and stream conversations |
| `conversation` | Interact with a specific conversation |

### Standalone Commands

| Command | Purpose |
| ------- | ------- |
| `init` | Initialize configuration and directory structure |
| `reset` | Delete all identities and conversation data (preserves .env) |

## Output Modes

All commands support `--json` for machine-readable JSON output:

```bash
convos conversations list --json
```

Use `--verbose` to see detailed client initialization logs. When combined with `--json`, verbose output goes to stderr:

```bash
convos identity info <id> --verbose
convos conversations list --json --verbose 2>/dev/null
```

## Common Workflows

### Create a Conversation

```bash
# create a conversation (auto-creates a per-conversation identity)
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

To enable automatic upload for large files, configure a provider in your `.env`:

```bash
CONVOS_UPLOAD_PROVIDER=pinata
CONVOS_UPLOAD_PROVIDER_TOKEN=<your-pinata-jwt>
# Optional: custom gateway URL
CONVOS_UPLOAD_PROVIDER_GATEWAY=https://your-gateway.mypinata.cloud
```

Supported upload providers: `pinata`

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

Each conversation has independent profiles — you can have a different name and avatar in each.

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

Identities are created automatically when creating/joining conversations, but you can manage them directly.

```bash
# list all identities
convos identity list

# create an identity manually
convos identity create --label "Work Chat" --profile-name "Alice"

# view identity details (connects to XMTP to show inbox ID)
convos identity info <identity-id>

# remove an identity (destroys all keys — irreversible)
convos identity remove <identity-id> --force
```

### Reset All Data

Delete all identities and conversation data. The `.env` configuration is preserved.

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

Permanently destroy a conversation and all its cryptographic keys. Sends an ExplodeSettings notification to all members (so iOS and other clients can trigger their cleanup), updates group metadata with the expiration timestamp, removes all members, then destroys the local identity. **Irreversible.**

```bash
# explode immediately
convos conversation explode <conversation-id> --force

# schedule explosion for a future date (ISO8601)
convos conversation explode <conversation-id> --scheduled "2025-03-01T00:00:00Z"
```

When scheduled, the ExplodeSettings message is sent with a future `expiresAt` date. Members are notified but not removed — clients handle cleanup when the time arrives. When immediate (no `--scheduled`), members are removed and the local identity is destroyed right away.

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
| `message` | New message received | `id`, `senderInboxId`, `senderProfile` (optional: `name`, `image`), `content`, `contentType`, `sentAt`, `catchup` (optional) |
| `member_joined` | Member joined via invite | `inboxId`, `conversationId`, `catchup` (optional) |
| `sent` | Message sent confirmation | `id`, `text`, `replyTo` (optional), `type` (optional) |
| `heartbeat` | Periodic health check | `conversationId`, `activeStreams` |
| `error` | Error occurred | `message` |

Messages with `catchup: true` were fetched during stream reconnection (missed while disconnected).

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
{"type":"lock"}
{"type":"unlock"}
{"type":"explode"}
{"type":"explode","scheduled":"2025-03-01T00:00:00Z"}
{"type":"stop"}
```

| Command | Required Fields | Optional Fields |
| ------- | --------------- | --------------- |
| `send` | `text` | `replyTo` |
| `react` | `messageId`, `emoji` | `action` (`add`/`remove`, default: `add`) |
| `attach` | `file` (local path) | `mimeType`, `replyTo` |
| `remote-attach` | `url`, `contentDigest`, `secret`, `salt`, `nonce`, `contentLength` | `filename`, `scheme` |
| `rename` | `name` | — |
| `lock` | — | — |
| `unlock` | — | — |
| `explode` | — | `scheduled` (ISO8601 date) |
| `stop` | — | — |

Small attachments (≤1MB) are sent inline. Larger files are auto-encrypted and uploaded via the configured upload provider (e.g., Pinata).

**Lock** prevents new members from joining by rotating the invite tag and setting addMember permission to deny. **Unlock** reverses this (previously shared invites remain invalid). **Explode** permanently destroys the conversation — sends ExplodeSettings notification, removes members, and deletes the local identity. Immediate explode triggers agent shutdown. **Rename** updates the conversation name visible to all members.

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

### Example: AI Auto-Reply Agent

The pattern below shows how to wire `agent serve` to an AI model. The key idea: spawn the process with a **named pipe** for stdin so you can read events and write commands independently.

```bash
#!/usr/bin/env bash
set -euo pipefail

# Create a named pipe for writing commands to agent serve's stdin
FIFO=$(mktemp -u /tmp/convos-agent.XXXXXX)
mkfifo "$FIFO"
trap 'rm -f "$FIFO"' EXIT

# Start agent serve: stdin from the FIFO, stdout piped to the while loop
convos agent serve --name "My Bot" --profile-name "Assistant" < "$FIFO" | while IFS= read -r event; do
  type=$(echo "$event" | jq -r '.event')
  case "$type" in
    ready)
      echo "Bot ready! Invite: $(echo "$event" | jq -r '.inviteUrl')" >&2
      ;;
    message)
      content=$(echo "$event" | jq -r '.content')
      content_type=$(echo "$event" | jq -r '.contentType.typeId')
      sender=$(echo "$event" | jq -r '.senderProfile.name // .senderInboxId[:12]')

      # Only reply to text and reply content types
      [ "$content_type" = "text" ] || [ "$content_type" = "reply" ] || continue

      echo "[$sender]: $content" >&2

      # Call your AI model here — replace with your own endpoint
      response=$(curl -s https://api.example.com/chat \
        -H "Content-Type: application/json" \
        -d "{\"message\": $(echo "$content" | jq -Rs .)}" \
        | jq -r '.reply')

      # Send the response as a flat message (no replyTo — not visible in production app)
      # Always plain text — strip any markdown the model may have generated
      echo "{\"type\":\"send\",\"text\":$(echo "$response" | jq -Rs .)}" > "$FIFO"
      ;;
    member_joined)
      echo "{\"type\":\"send\",\"text\":\"Welcome!\"}" > "$FIFO"
      ;;
  esac
done
```

**Key points:**
- Use a **named pipe** (FIFO) so the event-reading loop can write commands back to `agent serve`'s stdin without deadlocking
- Only reply to `text` and `reply` content types — ignore reactions, attachments, and group updates
- Always send **plain text** — the Convos app does not render markdown
- On **production**, do not use the `replyTo` field — the App Store app does not display threaded replies yet. On **dev** (TestFlight), `replyTo` works
- Self-echo filtering is handled by `agent serve` — your own messages are never emitted as events
- Make sure `convos init --env` matches your target: `production` for the App Store app, `dev` for TestFlight

### Agent Flags

| Flag | Description |
| ---- | ----------- |
| `--name` | Conversation name (when creating new) |
| `--description` | Conversation description (when creating new) |
| `--permissions` | `all-members` or `admin-only` (when creating new) |
| `--profile-name` | Display name for this conversation |
| `--identity` | Use an existing unlinked identity |
| `--label` | Local label for the identity |
| `--no-invite` | Skip generating an invite (attach mode) |
| `--heartbeat` | Emit heartbeat events every N seconds (0 to disable, default: 0) |

### Agent Auto-Reply (AI Agents)

This section describes how an AI agent should run as an auto-reply bot using `convos agent serve`. No additional extensions or frameworks are required — just spawn the process, read events, and write commands.

#### Process Lifecycle

1. Make sure `convos init` has been run with the correct `--env` for your target network. The Convos iOS app on the App Store uses **production** (`convos init --env production`); the TestFlight beta uses **dev** (`convos init --env dev`). Mismatched environments mean users will not see your messages.
2. Spawn `convos agent serve` as a child process with `--name` and `--profile-name` flags
3. Read **stdout** line-by-line — each line is an ndjson event (one JSON object per line)
4. Write **stdin** line-by-line — each line is an ndjson command (one JSON object per line)
5. stderr contains the QR code and diagnostic logs — do not parse it as protocol data
6. The process runs until it receives `SIGINT`, `SIGTERM`, stdin close, or a `{"type":"stop"}` command

#### Event Handling

On each event read from stdout, handle by event type:

- **`ready`**: The session has started. Note the `conversationId` for reference. The `qrCodePath` field contains the path to a PNG file of the invite QR code — display it to the user so they can scan it to join. The `inviteUrl` is also available as a text link.
- **`message`**: A message was received. Read `content` for the message text and `senderProfile.name` (if present) for the sender's display name. Generate a response and send it back by writing to stdin:
  ```
  {"type":"send","text":"your reply here"}
  ```
  On **production**, do not use the `replyTo` field — the App Store version of Convos does not yet display threaded replies, so users will not see the context. Always send flat messages on production. On **dev** (TestFlight), `replyTo` works and can be used freely.
- **`member_joined`**: A new member joined via invite. Optionally send a welcome message:
  ```
  {"type":"send","text":"Welcome!"}
  ```
- **`sent`**, **`heartbeat`**, **`error`**: No reply needed. Log them if debugging.

#### Message Formatting

- Always send **plain text**. Convos does not render markdown. Never use `**bold**`, `*italic*`, `# headings`, `` `code` ``, `[links](url)`, or bullet lists with `- ` or `* `. Write naturally in plain text instead.
- Self-echo filtering is handled by `agent serve` — your own messages are never emitted as `message` events, so there is no need to filter them yourself.
- Messages with `catchup: true` were missed during a stream disconnection and fetched on reconnect. Reply to them the same way as live messages, or skip them if the content is stale.

#### Sender Identification

Use `senderProfile.name` when available to address people by name. Fall back to a truncated `senderInboxId` if no profile is set. The `senderProfile` object may also contain an `image` field (avatar URL).

#### Content Types

The `contentType` field on message events is an object with `authorityId` and `typeId`. Common typeIds (all under `authorityId: "xmtp.org"`):

| typeId | Meaning |
| ------ | ------- |
| `text` | Plain text message |
| `reply` | Reply to another message (content is the reply text) |
| `reaction` | Emoji reaction to a message |
| `attachment` | Inline file attachment (small files) |
| `remoteStaticAttachment` | Uploaded file attachment (large files) |
| `group_updated` | Group metadata change (name, members, etc.) |

Only generate replies for `text` and `reply` content types. Ignore `reaction`, `attachment`, `remoteStaticAttachment`, and `group_updated` events — or acknowledge them if contextually appropriate, but do not treat them as conversational messages.

## Important Concepts

### Per-Conversation Identities

Every conversation has its own:

- **Wallet key** (secp256k1 private key)
- **DB encryption key** (32-byte key)
- **XMTP inbox** (unique inbox ID)
- **Local database** (SQLite)

Identities are stored in `~/.convos/identities/<id>.json`. Databases are stored in `~/.convos/db/<env>/<id>.db3`.

### Invite Flow

1. **Creator** generates an invite URL/QR code (contains encrypted conversation token + creator's inbox ID)
2. **Person opens the invite URL in Convos app** (or scans the QR code) — this creates a per-conversation identity and sends a DM join request to the creator
3. **Creator processes the join request** — validates the invite signature, decrypts the conversation token, and adds the person to the group
4. Person is now a member with their own isolated identity

**Key point:** Step 3 must happen *after* step 2. The creator must either run `process-join-requests` after the invite has been opened, or use `--watch` to stream and process requests as they arrive.

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

```
~/.convos/
├── .env                    # Global config (env only)
├── identities/
│   ├── <id-1>.json         # Identity: wallet key, db key, conversation link
│   └── <id-2>.json
└── db/
    └── dev/                # XMTP databases by environment
        ├── <id-1>.db3
        └── <id-2>.db3
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
2. **Never use markdown in messages**: Always use plain text — see "Message Formatting" under "Agent Auto-Reply" for details
3. **Identities are automatic**: You rarely need to manage them directly — creating/joining conversations handles it
4. **Use JSON output for scripting**: Add `--json` flag when extracting data programmatically
5. **Sync before reading**: Add `--sync` flag when reading messages to ensure fresh data
6. **Process join requests after invite is opened**: After generating an invite, wait for the person to open/scan it, then run `process-join-requests`. If you don't know when they'll open it, use `--watch` to stream requests as they arrive
7. **Lock before exploding**: Lock a conversation first to prevent new joins, then explode when ready
8. **Dangerous operations require --force**: Commands like `explode`, `identity remove`, and `lock` prompt for confirmation unless `--force` is passed
9. **Check command help**: Run `convos <command> --help` for full flag documentation
