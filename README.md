# unthinkmail

Give your AI access to your email inbox via MCP.

unthinkmail connects to your existing email account over IMAP and exposes it as a remote [Model Context Protocol](https://modelcontextprotocol.io) server. Any MCP-compatible AI client can then read, search, and manage your mail as native tools — no copy-pasting, no forwarding, no plugins.

**Live at [unthinkmail.undivisible.dev](https://unthinkmail.undivisible.dev)**

## How it works

1. Enter your IMAP/SMTP credentials on the hub
2. Get an encrypted API key (`um_...`) or use OAuth
3. Point your AI client at `https://unthinkmail.undivisible.dev/mcp` with `Authorization: Bearer <your key>`
4. Your AI can now search, read, move, and delete mail

The key contains your credentials so the server can connect to your mailbox without storing anything. When `OAUTH_SECRET` is configured, new keys are encrypted with AES-GCM; legacy base64url `um_` keys are still accepted for compatibility.

## Tools exposed

| Tool | Description |
|------|-------------|
| `listfolders` | List all IMAP folders |
| `searchmessages` | Search by keyword, sender, date, flags, etc. (IMAP search syntax) |
| `getmessage` | Fetch full message content by UID |
| `deletemessage` | Permanently delete a message |
| `movemessage` | Move a message to another folder |
| `sendemail` | Send a new email |
| `replyemail` | Reply to an existing message |

Messages are fetched live from your provider on every request — nothing is cached or stored on our side.

## Architecture

```
MCP client
  └─ POST /mcp  (Bearer um_...)
       └─ Cloudflare Worker
            ├─ decodes um_ key → credentials
            └─ routes to Durable Object (per credential hash)
                  └─ native TLS IMAP/SMTP via cloudflare:sockets
```

- **Worker** (`src/index.js`) — routing, key decoding, DO dispatch
- **Durable Object** (`src/session.js`) — per-connection IMAP/SMTP state, JSON-RPC handler
- **IMAP/SMTP** (`src/imap.js`, `src/smtp.js`) — native TLS via cloudflare:sockets

## Self-hosting

### Prerequisites

- [Cloudflare account](https://cloudflare.com) with Workers & Durable Objects
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) v4+

### Deploy

```bash
# 1. Clone
git clone https://github.com/undivisible/unthinkmail
cd unthinkmail

# 2. Set required secrets
wrangler secret put OAUTH_SECRET
# enter any random 32+ character string

# 3. Update wrangler.jsonc with your own route/domain, then deploy
wrangler deploy
```

### Local dev

```bash
bun run dev
```

## Security

- Credentials are carried in the access token so there is no server-side credential storage. Configure `OAUTH_SECRET` so new tokens are encrypted at rest.
- Each credential set gets its own Durable Object instance
- IMAP/SMTP connections use native TLS via cloudflare:sockets
- Use an **app-specific password** if your provider supports it (Gmail, Outlook, Fastmail all do). To revoke access, disable the app password at your provider.

## Supported providers

Any IMAP/SMTP provider works. Quick-fill presets on the hub: Purelymail, Gmail, Outlook, Fastmail.
