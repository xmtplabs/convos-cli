# @xmtp/convos-cli

> [!CAUTION]
> This CLI is in beta status and ready for you to use. Software in this status may contain bugs or change based on feedback.

A command-line interface for [Convos](https://convos.org) — privacy-focused ephemeral messaging built on [XMTP](https://xmtp.org).

## Features

- **Per-conversation identities**: Every conversation gets its own XMTP inbox — no linkability across conversations
- **Invite system**: Generate QR codes and invite links; join conversations without knowing the creator's address
- **Per-conversation profiles**: Different display name and avatar in each conversation
- **Explode**: Permanently destroy a conversation and all its cryptographic keys
- **Lock**: Prevent new members from being added to a conversation
- **Agent mode**: Single long-running process for bots — streams messages, auto-processes joins, accepts commands via stdin
- **JSON output**: Every command supports `--json` for scripting and automation

## How Convos Differs from Standard XMTP

Standard XMTP uses a single identity (wallet + inbox) across all conversations. Convos creates a **unique identity per conversation** for maximum privacy:

| Property | How |
| -------- | --- |
| **No linkability** | Conversations cannot be correlated by external observers |
| **Isolated keys** | Each conversation has its own wallet key, encryption key, and database |
| **Ephemeral** | Exploding a conversation destroys the cryptographic identity permanently |
| **Per-conversation profiles** | Different display names and avatars per conversation |

## Requirements

- Node.js >= 22

## Installation

```bash
# npm
npm install -g @xmtp/convos-cli

# pnpm
pnpm add -g @xmtp/convos-cli
```

## Run Without Installing

```bash
# npx
npx @xmtp/convos-cli --help

# pnpx
pnpx @xmtp/convos-cli --help

# yarn
yarn dlx @xmtp/convos-cli --help
```

## Quick Start

```bash
# 1. Initialize configuration
convos init

# 2. Create a conversation (auto-creates a per-conversation identity)
convos conversations create --name "My Group" --profile-name "Alice"

# 3. Send a message
convos conversation send-text <conversation-id> "Hello!"

# 4. Generate an invite QR code for others to join
convos conversation invite <conversation-id>

# 5. List all conversations across all identities
convos conversations list

# 6. Stream messages in real-time
convos conversation stream <conversation-id>
```

## Configuration

Running `convos init` creates `~/.convos/.env` with:

| Variable                       | Description                                      |
| ------------------------------ | ------------------------------------------------ |
| `CONVOS_ENV`                   | Network: `local`, `dev`, or `production`         |
| `CONVOS_UPLOAD_PROVIDER`       | Upload provider for attachments (e.g., `pinata`) |
| `CONVOS_UPLOAD_PROVIDER_TOKEN` | Authentication token for upload provider         |
| `CONVOS_UPLOAD_PROVIDER_GATEWAY` | Custom gateway URL for upload provider         |

Unlike standard XMTP, there is **no global wallet key**. Each conversation creates its own identity stored in `~/.convos/identities/`.

The default environment is `dev`. Use `--env` to change it:

```bash
convos init --env production
```

Configuration is loaded in priority order:

1. CLI flags (highest)
2. `--env-file <path>`
3. `.env` in current directory
4. `~/.convos/.env` (default)

## Command Topics

| Topic | Purpose |
| ----- | ------- |
| `agent` | Agent mode — long-running sessions with streaming I/O |
| `identity` | Manage per-conversation identities (inboxes) |
| `conversations` | List, create, join, and stream conversations |
| `conversation` | Interact with a specific conversation |

Run `convos --help` for all commands, or `convos <command> --help` for details on a specific command. For machine-readable introspection, use `convos schema`.

## Agent Mode

The `agent serve` command runs a single long-running process that combines conversation management, message streaming, join request processing, and command handling — purpose-built for AI agents and bots.

```bash
# Create a new conversation and start serving
convos agent serve --name "My Bot" --profile-name "Assistant"

# Attach to an existing conversation
convos agent serve <conversation-id>
```

### Why Agent Mode?

Without `agent serve`, an agent has to juggle multiple processes:
- `convos conversation stream` for incoming messages
- `convos conversations process-join-requests --watch` for new members
- `convos conversation send-text` for each outgoing message (spawning a new process each time)

`agent serve` replaces all of that with a single process using an **ndjson** (newline-delimited JSON) protocol on stdin/stdout.

### Protocol

**stdout** emits one JSON object per line:

| Event | Description | Key Fields |
| ----- | ----------- | ---------- |
| `ready` | Session initialized | `conversationId`, `inviteUrl`, `inboxId` |
| `message` | Incoming message | `id`, `senderInboxId`, `content`, `contentType`, `sentAt` |
| `member_joined` | New member added | `inboxId`, `conversationId` |
| `sent` | Outgoing message confirmed | `id`, `text` or `type` + details |
| `error` | Something went wrong | `message` |

**stdin** accepts one JSON command per line:

| Command | Required Fields | Optional Fields |
| ------- | --------------- | --------------- |
| `send` | `text` | `replyTo` (message ID) |
| `react` | `messageId`, `emoji` | `action` (`add`/`remove`, default `add`) |
| `attach` | `file` (local path) | `mimeType`, `replyTo` |
| `remote-attach` | `url`, `contentDigest`, `secret`, `salt`, `nonce`, `contentLength` | `filename`, `scheme` |
| `stop` | — | — |

**stderr** receives the QR code and diagnostic logs (never interferes with the JSON protocol).

### Example: Echo Bot

```bash
#!/usr/bin/env bash
# Start agent, read events, echo back every message
convos agent serve --name "Echo Bot" --profile-name "🤖 Echo" | \
while IFS= read -r event; do
  type=$(echo "$event" | jq -r '.event')
  case "$type" in
    ready)
      echo "Bot ready! Invite: $(echo "$event" | jq -r '.inviteUrl')" >&2
      ;;
    message)
      content=$(echo "$event" | jq -r '.content')
      msg_id=$(echo "$event" | jq -r '.id')
      # Echo the message back as a reply
      echo "{\"type\":\"send\",\"text\":\"You said: $content\",\"replyTo\":\"$msg_id\"}"
      ;;
    member_joined)
      echo '{"type":"send","text":"Welcome! 👋"}'
      ;;
  esac
done
```

### Sending Reactions

```bash
# React to a message
echo '{"type":"react","messageId":"abc123","emoji":"👍"}' 

# Remove a reaction
echo '{"type":"react","messageId":"abc123","emoji":"👍","action":"remove"}'
```

### Sending Attachments

```bash
# Send a file (≤1MB sent inline, larger files auto-uploaded via provider)
echo '{"type":"attach","file":"./chart.png"}'

# Reply with an attachment
echo '{"type":"attach","file":"./report.pdf","replyTo":"abc123"}'

# Send a pre-uploaded encrypted file
echo '{"type":"remote-attach","url":"https://...","contentDigest":"...","secret":"...","salt":"...","nonce":"...","contentLength":12345}'
```

### Agent Flags

| Flag | Description |
| ---- | ----------- |
| `--name` | Conversation name (when creating new) |
| `--description` | Conversation description (when creating new) |
| `--permissions` | `all-members` or `admin-only` (when creating new) |
| `--profile-name` | Display name for this conversation |
| `--identity` | Use an existing unlinked identity |
| `--label` | Local label for the identity |
| `--no-invite` | Skip generating an invite (attach mode only) |

## Usage Examples

### Identity Management

Each conversation has its own XMTP identity (wallet + inbox). Identities are created automatically when you create or join a conversation, but you can also manage them directly.

```bash
# List all identities
convos identity list

# Create an identity manually
convos identity create --label "Work Chat" --profile-name "Alice"

# View identity details (connects to XMTP to show inbox ID)
convos identity info <identity-id>

# Remove an identity (destroys all keys — irreversible)
convos identity remove <identity-id> --force
```

### Conversations

```bash
# Create a conversation (auto-creates per-conversation identity)
convos conversations create --name "Project Team" --profile-name "Alice"

# Create with admin-only permissions
convos conversations create --name "Announcement Channel" --permissions admin-only

# List all conversations across all identities
convos conversations list --sync

# Sync all conversations from the network
convos conversations sync
```

### Invites

Convos uses a serverless invite system. The creator generates a cryptographic invite slug; the joiner sends a DM join request; the creator's client processes it and adds them to the group.

#### Creating Invites

```bash
# Generate an invite — displays a QR code in the terminal
convos conversation invite <conversation-id>

# Invite that expires in 1 hour
convos conversation invite <conversation-id> --expires-in 3600

# Single-use invite
convos conversation invite <conversation-id> --single-use

# JSON output (suppresses QR code)
convos conversation invite <conversation-id> --json
```

#### Joining via Invite

```bash
# Join using a raw invite slug
convos conversations join <invite-slug>

# Join using a full invite URL
convos conversations join "https://dev.convos.org/v2?i=<slug>"

# Join with a display name
convos conversations join <slug> --profile-name "Bob"

# Send join request without waiting for acceptance
convos conversations join <slug> --no-wait

# Wait up to 2 minutes
convos conversations join <slug> --timeout 120
```

#### Processing Join Requests (Creator Side)

The creator's client must be running to process incoming join requests:

```bash
# Process all pending join requests
convos conversations process-join-requests

# Continuously watch for join requests
convos conversations process-join-requests --watch

# Process for a specific conversation only
convos conversations process-join-requests --conversation <id>
```

### Messages

```bash
# Send different message types
convos conversation send-text <id> "Hello!"
convos conversation send-reaction <id> <message-id> add "👍"
convos conversation send-reply <id> <message-id> "I agree!"

# Read messages
convos conversation messages <id> --sync --limit 10

# Stream messages in real-time
convos conversation stream <id>
convos conversation stream <id> --timeout 60
```

### Attachments

```bash
# Send a photo (small files ≤1MB sent inline)
convos conversation send-attachment <id> ./photo.jpg

# Large files are automatically encrypted and uploaded via configured provider
convos conversation send-attachment <id> ./video.mp4

# Force remote upload even for small files
convos conversation send-attachment <id> ./photo.jpg --remote

# Override MIME type
convos conversation send-attachment <id> ./file.bin --mime-type image/png

# Per-command upload provider (no .env needed)
convos conversation send-attachment <id> ./photo.jpg \
  --upload-provider pinata --upload-provider-token <jwt>

# Encrypt only (for manual upload workflows)
convos conversation send-attachment <id> ./photo.jpg --encrypt

# Send a pre-uploaded encrypted file
convos conversation send-remote-attachment <id> <url> \
  --content-digest <hex> --secret <base64> --salt <base64> \
  --nonce <base64> --content-length <bytes>

# Download an attachment (handles both inline and remote transparently)
convos conversation download-attachment <id> <message-id>

# Download to a specific path
convos conversation download-attachment <id> <message-id> --output ./photo.jpg

# Reply with a photo
convos conversation send-reply <id> <message-id> --file ./photo.jpg
```

To configure an upload provider for large files, add to your `~/.convos/.env`:

```bash
CONVOS_UPLOAD_PROVIDER=pinata
CONVOS_UPLOAD_PROVIDER_TOKEN=<your-pinata-jwt>
# Optional: custom gateway URL
CONVOS_UPLOAD_PROVIDER_GATEWAY=https://your-gateway.mypinata.cloud
```

Supported upload providers: `pinata`

### Profiles

Each conversation has independent profiles — you can be a different person in each conversation.

Profiles are sent as **ProfileUpdate messages** to the group. The CLI no longer writes profiles to `appData` (this was removed to fix a data corruption bug). When reading profiles, message-sourced profiles take precedence, with `appData` as a read-only fallback for profiles written by older clients.

When new members are added (via invite or directly), a **ProfileSnapshot message** is sent containing all current member profiles so the new joiner has everyone's data immediately.

```bash
# Set your display name in a conversation
convos conversation update-profile <id> --name "Alice"

# Set name and avatar
convos conversation update-profile <id> --name "Alice" --image "https://example.com/avatar.jpg"

# Go anonymous (clear profile)
convos conversation update-profile <id> --name "" --image ""

# View all member profiles
convos conversation profiles <id>
convos conversation profiles <id> --json
```

### Group Management

```bash
# View members
convos conversation members <id>

# Add/remove members
convos conversation add-members <id> <inbox-id>
convos conversation remove-members <id> <inbox-id>

# Update metadata
convos conversation update-name <id> "New Name"
convos conversation update-description <id> "New description"

# View permissions
convos conversation permissions <id>
```

### Lock a Conversation

Prevent new members from being added:

```bash
convos conversation lock <id>
convos conversation lock <id> --unlock
```

### Explode a Conversation

Permanently destroy a conversation and all its cryptographic keys:

```bash
# Explode immediately
convos conversation explode <id> --force

# Schedule explosion for a future date
convos conversation explode <id> --scheduled "2025-03-01T00:00:00Z"
```

Exploding sends an `ExplodeSettings` notification to all members (so iOS and other clients trigger their cleanup flow), updates group metadata with the expiration timestamp, removes all members, then destroys the local identity. The conversation becomes unreadable.

When using `--scheduled`, members are notified but not removed — clients handle cleanup when the time arrives.

### JSON Output

All commands support `--json` for machine-readable output:

```bash
# Create a conversation and capture the ID
CONV_ID=$(convos conversations create --name "Test" --json | jq -r '.conversationId')

# Send a message
convos conversation send-text "$CONV_ID" "Hello!"

# Read messages as JSON
convos conversation messages "$CONV_ID" --sync --json

# Generate invite and capture the URL
INVITE_URL=$(convos conversation invite "$CONV_ID" --json | jq -r '.url')
```

### Field Masks

Use `--fields` to limit JSON output to specific fields (implicitly enables `--json`). Supports dot notation for nested paths:

```bash
# Only get message id, content, and sender
convos conversation messages <id> --fields id,content,senderInboxId

# Nested field extraction
convos conversation messages <id> --fields id,content,contentType.typeId,sentAt

# Works on any command
convos conversation profiles <id> --fields profiles
convos conversations list --fields conversationId,name
```

This is especially useful for AI agents to conserve context window tokens by fetching only the fields they need.

### Schema Introspection

Use `convos schema` to discover tool capabilities at runtime as machine-readable JSON — no docs or skill files needed:

```bash
# List all commands with summaries
convos schema

# Full schema for a specific command (args, flags, examples)
convos schema conversation send-text

# Filter by topic
convos schema --topic conversation
convos schema --topic agent
```

Common flags (--json, --fields, --env, etc.) are listed once at the top level rather than repeated on every command.

### Verbose Output

Use `--verbose` to see detailed client initialization info. When combined with `--json`, verbose logs go to stderr:

```bash
convos identity info <id> --verbose
```

## Data Directory

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

## Architecture

```
┌──────────────────────────────────────────┐
│              @xmtp/convos-cli                 │
│                                          │
│  Commands:                               │
│    agent serve (long-running bot mode)   │
│    identity create/list/info/remove      │
│    conversations create/join/list/sync   │
│    conversation invite/explode/lock      │
│    conversation send-text/stream/...     │
│    conversation send-attachment/download  │
│    conversation update-profile/profiles  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │         @xmtp/node-sdk            │  │
│  │                                    │  │
│  │  Per-conversation XMTP clients    │  │
│  │  Group/DM management              │  │
│  │  Message encryption & delivery    │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

## Library Usage

`@xmtp/convos-cli` exports its core functionality for use in other applications:

```typescript
import {
  createIdentityStore,
  createClientForIdentity,
  createInviteSlug,
  parseInvite,
  verifyInvite,
  parseAppData,
  serializeAppData,
  upsertProfile,
  // Profile messages (primary profile source)
  encodeProfileUpdate,
  decodeProfileUpdate,
  encodeProfileSnapshot,
  decodeProfileSnapshot,
  sendProfileUpdate,
  sendProfileSnapshot,
  resolveProfilesFromMessages,
  ConvosBaseCommand,
} from "@xmtp/convos-cli";
```

See the [exports](./src/index.ts) for the full API.

## AI Coding Agent Skill

This package includes an [agent skill](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) (`skills/convos-cli/SKILL.md`) that teaches AI coding agents how to use the Convos CLI.

**Claude Code**

Add the skill directory to your project's `.claude/settings.json`:

```json
{
  "skills": ["./node_modules/@xmtp/convos-cli/skills"]
}
```

**Other agents** (Cursor, Windsurf, Codex, etc.)

Use [openskills](https://github.com/numman-ali/openskills) to install the skill:

```bash
npx openskills install ./node_modules/@xmtp/convos-cli/skills
```

Or point your agent to `node_modules/@xmtp/convos-cli/skills/convos-cli/SKILL.md` directly.

## Testing

```bash
# Run all tests (fast, no network required)
npm test

# Watch mode
npm run test:watch
```

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Dev mode (tsx, no build needed)
npm run dev -- conversations list

# Run built version
npm start -- conversations list

# Type check without emitting
npm run typecheck
```
