# @convos/cli

> [!CAUTION]
> This CLI is in beta status and ready for you to use. Software in this status may contain bugs or change based on feedback.

A command-line interface for [Convos](https://convos.org) — privacy-focused ephemeral messaging built on [XMTP](https://xmtp.org).

## Features

- **Per-conversation identities**: Every conversation gets its own XMTP inbox — no linkability across conversations
- **Invite system**: Generate QR codes and invite links; join conversations without knowing the creator's address
- **Per-conversation profiles**: Different display name and avatar in each conversation
- **Explode**: Permanently destroy a conversation and all its cryptographic keys
- **Lock**: Prevent new members from being added to a conversation
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
npm install -g @convos/cli

# pnpm
pnpm add -g @convos/cli
```

## Run Without Installing

```bash
# npx
npx @convos/cli --help

# pnpx
pnpx @convos/cli --help

# yarn
yarn dlx @convos/cli --help
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

| Variable | Description |
| -------- | ----------- |
| `CONVOS_ENV` | Network: `local`, `dev`, or `production` |

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
| `identity` | Manage per-conversation identities (inboxes) |
| `conversations` | List, create, join, and stream conversations |
| `conversation` | Interact with a specific conversation |

Run `convos --help` for all commands, or `convos <command> --help` for details on a specific command.

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

# Create with admin-only permissions (default)
convos conversations create --name "Announcement Channel"

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

### Profiles

Each conversation has independent profiles — you can be a different person in each conversation. Profiles are stored in the group's metadata and visible to all members.

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
convos conversation explode <id> --force
```

This removes the identity, wallet keys, database, and all local data. The conversation becomes unreadable.

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
│              @convos/cli                 │
│                                          │
│  Commands:                               │
│    identity create/list/info/remove      │
│    conversations create/join/list/sync   │
│    conversation invite/explode/lock      │
│    conversation send-text/stream/...     │
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

`@convos/cli` exports its core functionality for use in other applications:

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
  ConvosBaseCommand,
} from "@convos/cli";
```

See the [exports](./src/index.ts) for the full API.

## AI Coding Agent Skill

This package includes an [agent skill](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) (`skills/convos-cli/SKILL.md`) that teaches AI coding agents how to use the Convos CLI.

**Claude Code**

Add the skill directory to your project's `.claude/settings.json`:

```json
{
  "skills": ["./node_modules/@convos/cli/skills"]
}
```

**Other agents** (Cursor, Windsurf, Codex, etc.)

Use [openskills](https://github.com/numman-ali/openskills) to install the skill:

```bash
npx openskills install ./node_modules/@convos/cli/skills
```

Or point your agent to `node_modules/@convos/cli/skills/convos-cli/SKILL.md` directly.

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
