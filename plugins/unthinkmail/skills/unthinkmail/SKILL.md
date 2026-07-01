---
name: unthinkmail
description: Use Unthinkmail's hosted MCP email server at https://unthinkmail.undivisible.dev/mcp. Use when Codex needs to search, read, move, delete, reply to, or send email through a user's IMAP/SMTP-backed mailbox using an Unthinkmail API key.
---

# Unthinkmail

Use the `unthinkmail` MCP server for email work when it is available through this plugin. The server expects `Authorization: Bearer <key>`; this plugin reads that value from `UNTHINKMAIL_KEY` in the MCP header configuration.

## Workflow

1. Confirm the user intends to use their Unthinkmail-backed email account.
2. If the MCP server is unavailable, ask the user to set `UNTHINKMAIL_KEY` to their `um_...` key and reload the plugin.
3. Use read-only tools before any destructive or outbound action.
4. Ask for explicit confirmation before deleting messages, moving messages out of their current folder, or sending email.
5. Keep email content concise in chat; summarize unless the user asks for exact message text.

## Tool Use

Use `listfolders` to discover mailbox names before folder-specific searches or moves.

Use `searchmessages` for keyword, sender, date, and flag searches. Prefer narrow searches before fetching full message bodies.

Use `getmessage` only after identifying the relevant UID from search results.

Use `movemessage` and `deletemessage` only after confirmation because they mutate the mailbox.

Use `sendemail`, `replyemail`, or `sendemailfromurls` only after the user approves the recipient, subject, and final body.

## Attachments

For hosted files, prefer `sendemailfromurls` or `attachmentUrls` with public HTTPS URLs.

For local files, do not paste file bytes into chat. Use a local conversion path so file content stays local until the MCP request is made.

## Reference

Read `references/tools.md` when you need the available Unthinkmail tool list or attachment constraints.
