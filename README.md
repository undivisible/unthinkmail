# unthinkmail

Give your AI access to your email inbox via MCP.

unthinkmail connects to your existing email account over IMAP and exposes it as a remote [Model Context Protocol](https://modelcontextprotocol.io) server. Any MCP-compatible AI client can then read, search, and manage your mail as native tools — no copy-pasting, no forwarding, no plugins.

**Live at [unthinkmail.undivisible.dev](https://unthinkmail.undivisible.dev)**

## How it works

1. Enter your IMAP/SMTP credentials on the hub
2. Get an encrypted API key or use OAuth
3. Point your AI client at `https://unthinkmail.undivisible.dev/mcp` with `Authorization: Bearer <your key>`
4. Your AI can now search, read, move, and delete mail

The key contains your credentials so the server can connect to your mailbox without storing anything. `OAUTH_SECRET` is required for new keys, which are encrypted with AES-GCM; legacy base64url `um_` keys are still accepted for compatibility.

## Tools exposed

| Tool | Description |
|------|-------------|
| `listfolders` | List all IMAP folders |
| `searchmessages` | Search by keyword, sender, date, flags, etc. (IMAP search syntax) |
| `getmessage` | Fetch full message content by UID |
| `deletemessage` | Permanently delete a message |
| `movemessage` | Move a message to another folder |
| `sendemail` | Send a new email |
| `sendemailfromurls` | Send a new email with attachments fetched from public HTTPS URLs |
| `replyemail` | Reply to an existing message |
| `markmessage` | Mark a message as read, unread, flagged, or unflagged |
| `forwardemail` | Forward an existing message to one or more recipients |
| `getthread` | Reconstruct a conversation thread from Message-ID and References headers |
| `downloadattachment` | Download a named attachment from a message as base64 content |
| `bulkaction` | Apply mark, delete, or move actions to multiple messages |
| `getemailstatus` | Fetch flags and size for a message without downloading its body |
| `getemails` | Fetch header summaries for multiple messages |
| `getfolderstats` | Get total, unseen, and recent counts for folders |
| `createfolder` | Create a new mail folder |
| `renamefolder` | Rename an existing mail folder |
| `deletefolder` | Permanently delete a mail folder and its messages |
| `addlabel` | Add an IMAP keyword label to a message |
| `removelabel` | Remove an IMAP keyword label from a message |
| `extractcontacts` | Extract frequent email contacts from recent messages |
| `savedraft` | Save a message to the Drafts folder |
| `senddraft` | Send a saved draft and delete it afterward |
| `listdrafts` | List saved drafts |

Outgoing tools that send mail accept `to`, `cc`, and `bcc` as a single address, comma-separated addresses, or an array of addresses. `sendemail` also accepts `recipients` for personalized sends: each recipient entry has `to`, optional `cc`/`bcc`, and `variables`; placeholders like `{name}` in `subject`, `body`, and `htmlBody` are rendered per recipient. They also accept optional `attachments`: an array of `{ filename, mimeType, content }`, where `content` is base64-encoded file content. They also accept `contentText`, `contentBytes`, or `contentDataUrl` so clients can provide raw text, byte arrays, or data URLs and let the server encode them. When files are hosted, prefer `sendemailfromurls` or `attachmentUrls`; the server fetches public HTTPS URLs and encodes them before sending. Local/private hosts are rejected. Limits are 25 attachments per email, 10 MB per attachment, and 20 MB total. Use ASCII filenames; non-ASCII names are normalized because outbound MIME filename encoding is not emitted yet. HTML email uses `htmlBody`; inline images use `htmlBody` references like `cid:logo` plus an attachment with `contentId: "logo"` and `inline: true`.

Example personalized send:

```json
{
  "subject": "Hi {name}",
  "body": "Hi {name}, your code is {code}.",
  "recipients": [
    {
      "to": "ada@example.com",
      "variables": { "name": "Ada", "code": "A1" }
    },
    {
      "to": "grace@example.com",
      "variables": { "name": "Grace", "code": "G2" }
    }
  ]
}
```

Example MCP arguments for hosted files:

```json
{
  "to": "person@example.com",
  "subject": "Report",
  "body": "Attached.",
  "attachmentUrls": [
    {
      "url": "https://example.com/report.pdf",
      "filename": "report.pdf",
      "mimeType": "application/pdf"
    }
  ]
}
```

For local files, the hosted Worker cannot read local paths. Use a local script so the file bytes stay out of the chat transcript.

For inline hosted images:

```json
{
  "to": "person@example.com",
  "subject": "Logo",
  "htmlBody": "<p>Inline logo:</p><img src=\"cid:logo\">",
  "attachmentUrls": [
    {
      "url": "https://example.com/logo.png",
      "filename": "logo.png",
      "mimeType": "image/png",
      "contentId": "logo",
      "inline": true
    }
  ]
}
```

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

- Credentials are carried in the access token so there is no server-side credential storage. Configure `OAUTH_SECRET` because new tokens require encryption.
- Each credential set gets its own Durable Object instance
- IMAP/SMTP connections use native TLS via cloudflare:sockets
- Use an **app-specific password** if your provider supports it (Gmail, Outlook, Fastmail, and iCloud all do). To revoke access, disable the app password at your provider.

## Supported providers

Any IMAP/SMTP provider works. Quick-fill presets on the hub: Purelymail, Gmail, Outlook, Fastmail, iCloud.
