# unthinkmail

MCP server that gives AI clients direct access to email inboxes via IMAP/SMTP. Runs as a Cloudflare Worker with Durable Objects.

## Commands

```bash
bun run dev          # wrangler dev (local)
bun run deploy       # wrangler deploy
bun run tail         # wrangler tail (live logs)
```

Package manager: **Bun only** (never npm/yarn/pnpm).

## Architecture

```
/mcp  POST  Authorization: Bearer um_...
  → index.js router
  → routes/mcp.js  (decode key → hash → route to DO)
  → ImapSession DO  (session.js — JSON-RPC 2.0)
    → imap.js / smtp.js  (cloudflare:sockets TLS)
    → mime.js            (RFC 2822/2046/2047 parser)
```

### Key system (`src/lib/crypto.js`)

New keys are **AES-GCM encrypted credential tokens** when `OAUTH_SECRET` is configured. Legacy `um_` base64url(JSON credentials) keys are still accepted for compatibility. There is no server-side credential storage; to revoke, disable the app password at the email provider.

```js
encodeKey(creds, secret?)   // → 'um2_...' with secret, legacy 'um_...' without
decodeKey(token, secret?)   // → credentials object
credHash(creds)    // → SHA-256 hex (stable Durable Object ID)
```

### OAuth 2.1 (`src/routes/oauth.js`)

Adds Claude.ai-compatible OAuth flow on top of the existing key system. **Access token = `um_` key**, so `/mcp` requires no changes.

Endpoints:
| Path | Method | Purpose |
|------|--------|---------|
| `/.well-known/oauth-authorization-server` | GET | Server metadata |
| `/oauth/register` | POST | RFC 7591 dynamic client registration |
| `/oauth/authorize` | GET | Show credentials form |
| `/oauth/authorize` | POST | Validate creds → signed auth code → redirect |
| `/oauth/token` | POST | PKCE-verify code → return `um_` key as access_token |

Auth codes are HMAC-signed self-contained tokens (no KV needed). `OAUTH_SECRET` is a static signing key set via Wrangler secrets and is also used to encrypt new access tokens.

Client IDs are deterministic (base64url of sorted redirect_uris) — no client registration storage needed.

### Durable Objects

One `ImapSession` DO per unique credential hash. Holds a live IMAP TCP connection (via `cloudflare:sockets`). Worker injects `_credentials` into every JSON-RPC request body; clients never send credentials directly.

### MCP tools

`listfolders`, `searchmessages`, `getmessage`, `deletemessage`, `movemessage`, `sendemail`, `replyemail`

## Files

```
src/
  index.js          router + json/jsonError helpers + ImapSession export
  session.js        ImapSession DO — JSON-RPC 2.0 handler + all tools
  imap.js           IMAP client (cloudflare:sockets)
  smtp.js           SMTP client (STARTTLS + AUTH LOGIN)
  mime.js           RFC 2822/2046/2047 MIME parser
  pages.js          HUB landing page HTML (Alpine.js + Tailwind)
  lib/crypto.js     encodeKey / decodeKey / credHash
  routes/
    key.js          POST /api/key
    mcp.js          POST /mcp
    oauth.js        OAuth 2.1 endpoints
```

## Deployment

```bash
wrangler deploy
```

`wrangler.jsonc` binds `IMAP_SESSION` DO to the `unthinkmail.undivisible.dev` route. Migrations: v1 created `McpContainer` (removed), v2 creates `ImapSession`.

## Conventions

- No external IMAP/SMTP libraries — native TLS via `cloudflare:sockets`
- All JSON responses use `json()` / `jsonError()` helpers from `index.js`
- CORS headers applied universally (open: any origin, auth via Bearer token)
- `credHash` prefixed with `v2:` to force new DO instances on credential changes
