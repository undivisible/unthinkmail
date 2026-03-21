# unthinkmail

Give your AI access to your email inbox via MCP.

unthinkmail connects to your existing email account over IMAP and exposes it as a remote [Model Context Protocol](https://modelcontextprotocol.io) server. Any MCP-compatible AI client can then read, search, and manage your mail as native tools — no copy-pasting, no forwarding, no plugins.

**Live at [unthinkmail.undivisible.dev](https://unthinkmail.undivisible.dev)**

## How it works

1. Go to `/hub`, enter your IMAP/SMTP credentials
2. Get an encrypted API key (`um_...`)
3. Point your AI client at `https://unthinkmail.undivisible.dev/mcp` with `Authorization: Bearer <your key>`
4. Your AI can now search, read, move, and delete mail

The key *is* your credentials — AES-256-GCM encrypted with a server-side master key. Nothing is stored. The same credentials always produce the same key, so you can regenerate it any time.

## Tools exposed

| Tool | Description |
|------|-------------|
| `listfolders` | List all IMAP folders |
| `searchmessages` | Search by keyword, sender, date, flags, etc. (IMAP search syntax) |
| `getmessage` | Fetch full message content by UID |
| `deletemessage` | Permanently delete a message |
| `movemessage` | Move a message to another folder |

Messages are fetched live from your provider on every request — nothing is cached or stored on our side. IMAP keeps your mail on your provider's servers; we just query it.

## Architecture

```
MCP client
  └─ POST /mcp  (Bearer um_...)
       └─ Cloudflare Worker
            ├─ decrypts um_ key → IMAP credentials
            └─ routes to Durable Object Container (per credential hash)
                  └─ Zig HTTP server
                       └─ TLS IMAP connection to your provider
```

- **Worker** (`src/index.js`) — routing, key decryption, DO dispatch
- **Zig binary** (`src/main.zig`) — HTTP/JSON-RPC server, IMAP client with TLS
- **Container** (`Dockerfile`) — Alpine + ca-certificates + 6.6 MB static binary, no Node.js
- One container instance per unique credential set; IMAP connection reused across requests

## Self-hosting

### Prerequisites

- [Cloudflare account](https://cloudflare.com) with Workers & Containers access
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) v4+
- [Zig](https://ziglang.org) 0.15+

### Deploy

```bash
# 1. Clone
git clone https://github.com/undivisible/unthinkmail
cd unthinkmail

# 2. Cross-compile Zig binary for Linux (container target)
zig build -Dtarget=x86_64-linux-musl -Doptimize=ReleaseSafe

# 3. Set required secret
wrangler secret put MASTER_ENCRYPTION_KEY
# enter any random 32+ character string

# 4. Update wrangler.jsonc with your own route/domain, then deploy
wrangler deploy
```

### Local dev

The Worker can run locally, but the container requires a remote deployment. For local testing of the Worker layer only:

```bash
wrangler dev
```

## Security

- Credentials are encrypted client-side using AES-256-GCM, key derived via HKDF from `MASTER_ENCRYPTION_KEY`
- Deterministic IV (HMAC-SHA256 of plaintext) means same credentials → same key, always
- Nothing stored server-side — no database, no logs of credentials
- Use an **app-specific password** if your provider supports it (Gmail, Outlook, Fastmail all do). To revoke access, disable the app password at your provider.

## Supported providers

Any IMAP/SMTP provider works. Quick-fill presets on the hub: Purelymail, Gmail, Outlook, Fastmail.
