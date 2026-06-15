# Unthinkmail MCP Tools

The hosted MCP endpoint is `https://unthinkmail.undivisible.dev/mcp`.

Set authentication with `Authorization: Bearer <UNTHINKMAIL_KEY>`, where the key is the user's encrypted `um_...` Unthinkmail key.

## Tools

- `listfolders`: List all IMAP folders.
- `searchmessages`: Search by keyword, sender, date, flags, and other IMAP search syntax.
- `getmessage`: Fetch full message content by UID.
- `deletemessage`: Permanently delete a message.
- `movemessage`: Move a message to another folder.
- `sendemail`: Send a new email.
- `sendemailfromurls`: Send a new email with attachments fetched from public HTTPS URLs.
- `replyemail`: Reply to an existing message.

Outgoing email tools accept `to`, `cc`, and `bcc` as a single address, comma-separated addresses, or an array of addresses.

## Attachments

Outgoing email tools accept `attachments` as an array of objects with `filename`, `mimeType`, and base64-encoded `content`.

They also accept `contentText`, `contentBytes`, or `contentDataUrl` so clients can provide raw text, byte arrays, or data URLs and let the server encode them.

For hosted files, prefer `sendemailfromurls` or `attachmentUrls`.

Limits are 25 attachments per email, 10 MB per attachment, and 20 MB total.

Use ASCII filenames because outbound MIME filename encoding is not emitted yet.

For inline images, use `htmlBody` references such as `cid:logo` plus an attachment with `contentId: "logo"` and `inline: true`.
