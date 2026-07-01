// ImapSession Durable Object
// Maintains an IMAP connection via Cloudflare TCP Sockets (cloudflare:sockets)
// Handles MCP JSON-RPC directly — no container needed

import { ImapClient } from './imap.js';
import { SmtpClient } from './smtp.js';
import { parseBodyStructure, decodeBodyRaw } from './mime.js';
import { buildMimeMessage, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, MAX_TOTAL_ATTACHMENT_BYTES } from './outbound-mime.js';
import { buildTemplatedSendMessages } from './send-template.js';
import { fetchUrlAttachments } from './url-attachments.js';

// IMAP date format: DD-Mon-YYYY (e.g. 1-Jan-2024)
const IMAP_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function toImapDate(s) {
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d)) throw new Error('Invalid date: ' + s);
  return `${d.getUTCDate()}-${IMAP_MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

// Escape a value for use in an IMAP quoted string
const imapStr = (s) =>
  `"${String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]/g, '')}"`;
const headerStr = (s) =>
  String(s ?? '')
    .replace(/[\r\n]/g, '')
    .trim();
const headerList = (value) =>
  Array.isArray(value)
    ? value.map(headerStr).filter(Boolean).join(', ')
    : String(value ?? '')
        .split(',')
        .map(headerStr)
        .filter(Boolean)
        .join(', ');

function validateSearchQuery(query) {
  const s = String(query);
  if (/[\r\n]/.test(s)) throw new Error('Raw IMAP query must not contain newlines');
  return s.trim() || 'ALL';
}

function validateKeyword(label) {
  const s = String(label ?? '').trim();
  if (!s || s.length > 64) throw new Error('Invalid label');
  if (/[\x00-\x20(){%*"\\\]\[]/.test(s)) throw new Error('Invalid label');
  return s;
}

// Build an IMAP SEARCH criteria string from structured args
// Falls back to raw `query` if provided (for advanced use)
function buildSearchQuery(args) {
  if (args.query) return validateSearchQuery(args.query);
  const parts = [];
  if (args.unseen) parts.push('UNSEEN');
  if (args.from) parts.push(`FROM ${imapStr(args.from)}`);
  if (args.subject) parts.push(`SUBJECT ${imapStr(args.subject)}`);
  if (args.since) parts.push(`SINCE ${toImapDate(args.since)}`);
  if (args.before) parts.push(`BEFORE ${toImapDate(args.before)}`);
  return parts.length ? parts.join(' ') : 'ALL';
}

// Build a compact IMAP UID sequence string from an array of UID strings.
// e.g. ['1','2','3','5','10','11'] → "1:3,5,10:11"
function buildUidSequence(uids) {
  const nums = [...new Set(uids.map((u) => parseInt(u, 10)).filter((n) => !isNaN(n)))].sort((a, b) => a - b);
  if (nums.length === 0) throw new Error('No valid UIDs');
  const parts = [];
  let start = nums[0],
    end = nums[0];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] === end + 1) {
      end = nums[i];
    } else {
      parts.push(start === end ? String(start) : `${start}:${end}`);
      start = end = nums[i];
    }
  }
  parts.push(start === end ? String(start) : `${start}:${end}`);
  return parts.join(',');
}

// Convert Uint8Array to base64 without hitting V8's call stack argument limit
function uint8ToBase64(bytes) {
  let s = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(s);
}

// Parse header block text (unfolded RFC 2822 headers) into a lowercase-keyed map
function parseHeaderBlock(raw) {
  const map = {};
  if (!raw) return map;
  const unfolded = raw.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const val = line.slice(colon + 1).trim();
    if (!map[key]) map[key] = val;
  }
  return map;
}

function splitHeaderBody(raw) {
  let pos = raw.indexOf('\r\n\r\n');
  if (pos >= 0) return [raw.slice(0, pos), raw.slice(pos + 4)];
  pos = raw.indexOf('\n\n');
  if (pos >= 0) return [raw.slice(0, pos), raw.slice(pos + 2)];
  return [raw, ''];
}

function stripHeader(raw, name) {
  const [headerRaw, body] = splitHeaderBody(raw);
  const lines = headerRaw.split(/\r?\n/);
  const kept = [];
  let skipping = false;
  for (const line of lines) {
    if (/^[ \t]/.test(line)) {
      if (!skipping) kept.push(line);
      continue;
    }
    const colon = line.indexOf(':');
    skipping = colon > 0 && line.slice(0, colon).trim().toLowerCase() === name.toLowerCase();
    if (!skipping) kept.push(line);
  }
  return kept.join('\r\n') + '\r\n\r\n' + body;
}

// Extract email addresses from a header value like "Name <a@b.com>, c@d.com"
function parseAddresses(header) {
  if (!header) return [];
  const emails = [];
  // Prefer angle-bracket format: <user@domain>
  const re1 = /<([^>]+)>/g;
  let m;
  while ((m = re1.exec(header)) !== null) {
    const addr = m[1].trim();
    if (addr.includes('@')) emails.push(addr.toLowerCase());
  }
  if (emails.length) return emails;
  // Bare email fallback
  const re2 = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  while ((m = re2.exec(header)) !== null) emails.push(m[0].toLowerCase());
  return emails;
}

// Compose a minimal RFC 2822 message string suitable for APPEND or SMTP
function buildRawMessage({ from, to, subject, body, htmlBody, cc, bcc, replyTo, inReplyTo, references, date, messageId, attachments }) {
  const msgDate = headerStr(date) || new Date().toUTCString();
  const msgId = headerStr(messageId) || `<${Date.now()}.${Math.random().toString(36).slice(2)}@unthinkmail.local>`;
  const toStr = headerList(to);
  const ccStr = cc ? headerList(cc) : '';
  const bccStr = bcc ? headerList(bcc) : '';
  if (htmlBody != null || (Array.isArray(attachments) && attachments.length)) {
    return buildMimeMessage({
      from,
      to,
      subject: headerStr(subject) || '(no subject)',
      body: body || '',
      htmlBody,
      cc,
      bcc,
      includeBccHeader: true,
      replyTo,
      attachments,
      extraHeaders: {
        Date: msgDate,
        'Message-ID': msgId,
        ...(inReplyTo ? { 'In-Reply-To': inReplyTo } : {}),
        ...(references ? { References: references } : {}),
      },
    });
  }
  const lines = [
    `From: ${headerStr(from)}`,
    `To: ${toStr}`,
    ccStr ? `Cc: ${ccStr}` : null,
    bccStr ? `Bcc: ${bccStr}` : null,
    replyTo ? `Reply-To: ${headerStr(replyTo)}` : null,
    `Subject: ${headerStr(subject) || '(no subject)'}`,
    `Date: ${msgDate}`,
    `Message-ID: ${msgId}`,
    inReplyTo ? `In-Reply-To: ${headerStr(inReplyTo)}` : null,
    references ? `References: ${headerStr(references)}` : null,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body || '',
  ].filter((l) => l !== null);
  return lines.join('\r\n');
}

const ATTACHMENT_SCHEMA = {
  type: 'object',
  properties: {
    filename: {
      type: 'string',
      description:
        'ASCII filename. Convert non-ASCII filenames to ASCII because outbound MIME filename encoding is not emitted yet and some mail clients show encoded filenames poorly.',
    },
    mimeType: { type: 'string' },
    content: { type: 'string', description: 'Base64-encoded file content' },
    contentBase64: { type: 'string', description: 'Base64-encoded file content' },
    contentDataUrl: { type: 'string', description: 'data: URL with base64 content' },
    contentText: { type: 'string', description: 'Raw text content; server UTF-8 encodes it' },
    contentBytes: {
      type: 'array',
      items: { type: 'integer', minimum: 0, maximum: 255 },
      description: 'Raw bytes as integers 0-255; server base64 encodes them',
    },
    contentId: { type: 'string', description: 'Content-ID for inline use, referenced in HTML as cid:contentId' },
    inline: { type: 'boolean', description: 'Set true for inline images referenced by htmlBody' },
  },
  required: ['filename'],
};

const sizeMb = (bytes) => bytes / (1024 * 1024);
const LOCAL_ATTACHMENT_GUIDANCE =
  'Local file guidance for Claude: this hosted server cannot read local paths. Do not paste large base64 directly into chat if it would waste tokens. If a user wants to send a local file, either ask for/upload a public HTTPS URL and use sendemailfromurls, or generate a small local script that reads the file, base64-encodes it, and POSTs a tools/call request to this MCP endpoint with Authorization: Bearer <key>. The script should send attachments with filename, mimeType, and contentBase64.';
const ATTACHMENT_LIMITS = `Optional attachments. Maximum ${MAX_ATTACHMENTS} attachments per email, ${sizeMb(MAX_ATTACHMENT_BYTES)} MB each, ${sizeMb(MAX_TOTAL_ATTACHMENT_BYTES)} MB total. Each item must include an ASCII filename plus one content field: content/contentBase64, contentDataUrl, contentText, or contentBytes. mimeType is optional. ${LOCAL_ATTACHMENT_GUIDANCE}`;

const ATTACHMENTS_SCHEMA = {
  type: 'array',
  description: ATTACHMENT_LIMITS,
  minItems: 1,
  items: ATTACHMENT_SCHEMA,
};

const HOSTED_ATTACHMENT_GUIDANCE = `Hosted attachment guidance for Claude: if user gives hosted files, use attachmentUrls or the sendemailfromurls tool. Do not paste raw base64 when a public HTTPS URL exists. Example: {"to":"person@example.com","subject":"Report","body":"Attached.","attachmentUrls":[{"url":"https://example.com/report.pdf","filename":"report.pdf","mimeType":"application/pdf"}]}. Inline image example: htmlBody '<img src="cid:logo">' plus attachmentUrls [{"url":"https://example.com/logo.png","filename":"logo.png","mimeType":"image/png","contentId":"logo","inline":true}]. URLs must be HTTPS and publicly fetchable by this server. Limits: ${MAX_ATTACHMENTS} attachments, ${sizeMb(MAX_ATTACHMENT_BYTES)} MB each, ${sizeMb(MAX_TOTAL_ATTACHMENT_BYTES)} MB total.`;

const URL_ATTACHMENT_SCHEMA = {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'Public HTTPS URL for the attachment content' },
    filename: { type: 'string', description: 'Optional ASCII filename override. Defaults from Content-Disposition or URL path.' },
    mimeType: { type: 'string', description: 'Optional MIME type override. Defaults from Content-Type header.' },
    contentId: { type: 'string', description: 'Content-ID for inline use, referenced in HTML as cid:contentId' },
    inline: { type: 'boolean', description: 'Set true for inline images referenced by htmlBody' },
  },
  required: ['url'],
};

const URL_ATTACHMENTS_SCHEMA = {
  type: 'array',
  description: HOSTED_ATTACHMENT_GUIDANCE,
  minItems: 1,
  items: URL_ATTACHMENT_SCHEMA,
};

const RECIPIENTS_SCHEMA = {
  type: 'string',
  description: 'Email recipient(s): single address or comma-separated addresses.',
};

const TEMPLATED_RECIPIENTS_SCHEMA = {
  type: 'array',
  description: 'Personalized recipient entries. Each entry gets its own rendered email. Template variables use {name} syntax in subject, body, and htmlBody.',
  minItems: 1,
  maxItems: 50,
  items: {
    type: 'object',
    properties: {
      to: RECIPIENTS_SCHEMA,
      cc: RECIPIENTS_SCHEMA,
      bcc: RECIPIENTS_SCHEMA,
      variables: { type: 'object', additionalProperties: true, description: 'Values used to replace {variable} placeholders for this recipient.' },
    },
    required: ['to'],
  },
};

const hasMessageContent = (args) =>
  String(args.body ?? '').length > 0 ||
  String(args.htmlBody ?? '').length > 0 ||
  (Array.isArray(args.attachments) && args.attachments.length > 0) ||
  (Array.isArray(args.attachmentUrls) && args.attachmentUrls.length > 0);

const TOOLS = [
  {
    name: 'listfolders',
    description: 'List all IMAP mail folders / mailboxes',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'searchmessages',
    description: 'Search for messages in a mail folder. Returns a list of UIDs.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder to search (default: INBOX)' },
        unseen: { type: 'boolean', description: 'Only return unread messages' },
        from: { type: 'string', description: 'Filter by sender address or name' },
        subject: { type: 'string', description: 'Filter by subject text' },
        since: { type: 'string', description: 'Messages on or after this date (YYYY-MM-DD)' },
        before: { type: 'string', description: 'Messages before this date (YYYY-MM-DD)' },
        query: { type: 'string', description: 'Raw IMAP SEARCH criteria (overrides other fields when provided)' },
      },
      required: [],
    },
  },
  {
    name: 'getmessage',
    description: 'Fetch and parse a message by UID. Returns sender, subject, decoded body, and attachment list.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder containing the message (default: INBOX)' },
        uid: { type: 'string', description: 'Message UID from searchmessages' },
      },
      required: ['uid'],
    },
  },
  {
    name: 'deletemessage',
    description: 'Permanently delete a message by UID',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string' },
        uid: { type: 'string' },
      },
      required: ['uid'],
    },
  },
  {
    name: 'movemessage',
    description: 'Move a message to another folder',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string' },
        uid: { type: 'string' },
        destination: { type: 'string', description: 'Destination folder name' },
      },
      required: ['uid', 'destination'],
    },
  },
  {
    name: 'sendemail',
    description: `Compose and send a new email via SMTP. Supports multiple recipients via comma-separated string, array, or single address. For per-recipient personalization, omit to/cc/bcc and pass recipients with variables, then use placeholders like {name} in subject, body, or htmlBody. ${HOSTED_ATTACHMENT_GUIDANCE} ${LOCAL_ATTACHMENT_GUIDANCE}`,
    inputSchema: {
      type: 'object',
      properties: {
        to: RECIPIENTS_SCHEMA,
        recipients: TEMPLATED_RECIPIENTS_SCHEMA,
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Plain text email body. Required unless attachments are provided.' },
        htmlBody: {
          type: 'string',
          description: 'Optional HTML email body. Inline images should use cid:contentId and matching attachment contentId with inline true.',
        },
        cc: RECIPIENTS_SCHEMA,
        bcc: RECIPIENTS_SCHEMA,
        attachments: ATTACHMENTS_SCHEMA,
        attachmentUrls: URL_ATTACHMENTS_SCHEMA,
      },
      required: ['subject'],
    },
  },
  {
    name: 'sendemailfromurls',
    description: `Compose and send a new email via SMTP with attachments fetched from public HTTPS URLs. Prefer this when files are hosted. The server downloads and encodes attachments; Claude should provide URLs, not raw base64. ${HOSTED_ATTACHMENT_GUIDANCE} ${LOCAL_ATTACHMENT_GUIDANCE}`,
    inputSchema: {
      type: 'object',
      properties: {
        to: RECIPIENTS_SCHEMA,
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Plain text email body. Required unless htmlBody is provided.' },
        htmlBody: {
          type: 'string',
          description: 'Optional HTML email body. Inline images should use cid:contentId and matching URL attachment contentId with inline true.',
        },
        cc: RECIPIENTS_SCHEMA,
        bcc: RECIPIENTS_SCHEMA,
        attachmentUrls: URL_ATTACHMENTS_SCHEMA,
      },
      required: ['to', 'subject', 'attachmentUrls'],
    },
  },
  {
    name: 'replyemail',
    description: 'Reply to an existing message, preserving threading headers (In-Reply-To / References)',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder containing the original message (default: INBOX)' },
        uid: { type: 'string', description: 'UID of the message to reply to' },
        body: { type: 'string', description: 'Plain text reply body. Required unless attachments are provided.' },
        htmlBody: { type: 'string', description: 'Optional HTML reply body' },
        cc: RECIPIENTS_SCHEMA,
        bcc: RECIPIENTS_SCHEMA,
        attachments: ATTACHMENTS_SCHEMA,
        attachmentUrls: URL_ATTACHMENTS_SCHEMA,
      },
      required: ['uid'],
    },
  },
  {
    name: 'markmessage',
    description: 'Mark a message as read, unread, flagged, or unflagged',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder containing the message (default: INBOX)' },
        uid: { type: 'string', description: 'Message UID' },
        mark: { type: 'string', enum: ['read', 'unread', 'flagged', 'unflagged'], description: 'Mark to apply' },
      },
      required: ['uid', 'mark'],
    },
  },
  {
    name: 'forwardemail',
    description: 'Forward an existing message to one or more recipients',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder containing the message (default: INBOX)' },
        uid: { type: 'string', description: 'UID of the message to forward' },
        to: RECIPIENTS_SCHEMA,
        cc: RECIPIENTS_SCHEMA,
        bcc: RECIPIENTS_SCHEMA,
        note: { type: 'string', description: 'Optional note to prepend before the forwarded content' },
        includeOriginalAttachments: { type: 'boolean', description: 'Forward original attachments too. Defaults to true.' },
        attachments: ATTACHMENTS_SCHEMA,
        attachmentUrls: URL_ATTACHMENTS_SCHEMA,
      },
      required: ['uid', 'to'],
    },
  },
  {
    name: 'getthread',
    description: 'Reconstruct a full conversation thread by following Message-ID / References chains. Returns up to 50 messages sorted by date.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder to search (default: INBOX)' },
        uid: { type: 'string', description: 'UID of any message in the thread' },
        order: { type: 'string', enum: ['asc', 'desc'], description: 'Date sort order (default: asc)' },
      },
      required: ['uid'],
    },
  },
  {
    name: 'downloadattachment',
    description: 'Extract a named attachment from a message and return it as base64-encoded content. Maximum 10 MB.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder containing the message (default: INBOX)' },
        uid: { type: 'string', description: 'Message UID' },
        filename: { type: 'string', description: 'Exact filename of the attachment to download' },
      },
      required: ['uid', 'filename'],
    },
  },
  {
    name: 'bulkaction',
    description: 'Apply an action to multiple messages at once. Supports mark read/unread/flag/unflag, delete, and move. Maximum 100 UIDs per call.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Source folder (default: INBOX)' },
        uids: { type: 'array', items: { type: 'string' }, description: 'Array of message UIDs (max 100)' },
        action: { type: 'string', enum: ['read', 'unread', 'flag', 'unflag', 'delete', 'move'], description: 'Action to apply' },
        destination: { type: 'string', description: 'Destination folder — required when action is "move"' },
      },
      required: ['uids', 'action'],
    },
  },
  {
    name: 'getemailstatus',
    description: 'Get the flags and size of a message without downloading its body. Returns seen, flagged, and custom keyword flags.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder containing the message (default: INBOX)' },
        uid: { type: 'string', description: 'Message UID' },
      },
      required: ['uid'],
    },
  },
  {
    name: 'getemails',
    description: 'Fetch header summaries for multiple messages at once. Returns from, to, subject, date, and flags for each UID — without downloading bodies.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder to fetch from (default: INBOX)' },
        uids: { type: 'array', items: { type: 'string' }, description: 'Array of message UIDs to fetch (max 100)' },
      },
      required: ['uids'],
    },
  },
  {
    name: 'getfolderstats',
    description: 'Get message counts (total, unseen, recent) for one or more folders using the IMAP STATUS command.',
    inputSchema: {
      type: 'object',
      properties: {
        folders: { type: 'array', items: { type: 'string' }, description: 'Folder names to stat. Defaults to ["INBOX"] if omitted.' },
      },
      required: [],
    },
  },
  {
    name: 'createfolder',
    description: 'Create a new mail folder / mailbox. Use "/" as separator for nested folders.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the folder to create' },
      },
      required: ['name'],
    },
  },
  {
    name: 'renamefolder',
    description: 'Rename an existing mail folder',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Current folder name' },
        newName: { type: 'string', description: 'New folder name' },
      },
      required: ['folder', 'newName'],
    },
  },
  {
    name: 'deletefolder',
    description: 'Permanently delete a mail folder and all its messages',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder to delete' },
      },
      required: ['folder'],
    },
  },
  {
    name: 'addlabel',
    description: 'Add an IMAP keyword label to a message (provider-agnostic — works as an IMAP keyword on any server)',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder containing the message (default: INBOX)' },
        uid: { type: 'string', description: 'Message UID' },
        label: { type: 'string', description: 'Label / keyword to add (e.g. "important", "needs-reply")' },
      },
      required: ['uid', 'label'],
    },
  },
  {
    name: 'removelabel',
    description: 'Remove an IMAP keyword label from a message',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder containing the message (default: INBOX)' },
        uid: { type: 'string', description: 'Message UID' },
        label: { type: 'string', description: 'Label / keyword to remove' },
      },
      required: ['uid', 'label'],
    },
  },
  {
    name: 'extractcontacts',
    description: 'Mine the inbox for unique email contacts, sorted by frequency. Scans the most recent messages for From/To/Cc addresses.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder to scan (default: INBOX)' },
        limit: { type: 'number', description: 'Max messages to scan (default: 100, max: 200)' },
      },
      required: [],
    },
  },
  {
    name: 'savedraft',
    description: 'Save a message as a draft by appending it to the Drafts folder with the \\Draft flag. Preserves HTML and attachments.',
    inputSchema: {
      type: 'object',
      properties: {
        to: RECIPIENTS_SCHEMA,
        subject: { type: 'string', description: 'Subject line' },
        body: { type: 'string', description: 'Plain text body. Required unless htmlBody or attachments are provided.' },
        htmlBody: { type: 'string', description: 'Optional HTML email body' },
        cc: RECIPIENTS_SCHEMA,
        bcc: RECIPIENTS_SCHEMA,
        attachments: ATTACHMENTS_SCHEMA,
        attachmentUrls: URL_ATTACHMENTS_SCHEMA,
        folder: { type: 'string', description: 'Drafts folder (auto-detected if omitted)' },
      },
      required: ['to', 'subject'],
    },
  },
  {
    name: 'senddraft',
    description: 'Send a saved draft: fetches its raw MIME content by UID, sends via SMTP, then deletes the draft.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        uid: { type: 'string', description: 'UID of the draft to send' },
        folder: { type: 'string', description: 'Drafts folder (auto-detected if omitted)' },
      },
      required: ['uid'],
    },
  },
  {
    name: 'listdrafts',
    description: 'List messages in the Drafts folder with subject, to, and date summaries.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Drafts folder name (auto-detected if omitted)' },
        limit: { type: 'number', description: 'Maximum number of drafts to return (default: 50)' },
      },
      required: [],
    },
  },
];

export class ImapSession {
  #imap = null;
  #credentials = null;

  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/oauth-code/use') return this.#useOAuthCode(request);
    if (request.method === 'GET') {
      return Response.json({ name: 'unthinkmail', version: '1.0.0', protocolVersion: '2024-11-05' });
    }

    const body = await request.json().catch(() => null);
    if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 });

    // Update credentials if provided (injected by mcp.js Worker, not from clients)
    if (body._credentials) {
      await this.state.blockConcurrencyWhile(async () => {
        const creds = body._credentials;
        const changed =
          !this.#credentials ||
          this.#credentials.imap_host !== creds.imap_host ||
          this.#credentials.imap_user !== creds.imap_user ||
          this.#credentials.imap_port !== creds.imap_port;
        if (changed) await this.#disconnect();
        this.#credentials = creds;
      });
    }

    const response = await this.#handleRpc(body);
    return Response.json(response);
  }

  async #useOAuthCode(request) {
    return this.state.blockConcurrencyWhile(async () => {
      const body = await request.json().catch(() => null);
      const hash = String(body?.hash ?? '');
      const exp = Number(body?.exp ?? 0);
      if (!hash || !exp) return Response.json({ error: 'Invalid code' }, { status: 400 });
      const key = `oauth-code:${hash}`;
      if (await this.state.storage.get(key)) return Response.json({ error: 'Code already used' }, { status: 409 });
      await this.state.storage.put(key, Date.now(), { expiration: Math.ceil(exp / 1000) });
      return Response.json({ used: true });
    });
  }

  async #ensureConnected() {
    if (this.#imap?.isConnected()) return;
    if (!this.#credentials) throw new Error('No credentials');
    console.log('[imap] connecting to', this.#credentials.imap_host, this.#credentials.imap_port);
    this.#imap = new ImapClient();
    await this.#imap.connect(this.#credentials.imap_host, this.#credentials.imap_port, this.#credentials.imap_user, this.#credentials.imap_pass);
    console.log('[imap] authenticated');
  }

  async #disconnect() {
    if (this.#imap) {
      await this.#imap.close().catch(() => {});
      this.#imap = null;
    }
  }

  async #fetchAttachmentsForSending(folder, uid) {
    const bsRaw = await this.#imap.fetchBodyStructure(folder, uid);
    const parts = parseBodyStructure(bsRaw).filter((p) => p.filename);
    const attachments = [];
    let total = 0;
    for (const part of parts) {
      const decodedSize = part.encoding === 'base64' ? Math.floor(part.size * 0.75) : part.size;
      if (decodedSize > MAX_ATTACHMENT_BYTES) {
        throw new Error(`Original attachment "${part.filename}" exceeds ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB limit`);
      }
      total += decodedSize;
      if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
        throw new Error(`Original attachments exceed ${MAX_TOTAL_ATTACHMENT_BYTES / (1024 * 1024)}MB total limit`);
      }
      const rawPart = await this.#imap.fetchBodyPart(folder, uid, part.partNum);
      if (rawPart === null) throw new Error(`Could not fetch original attachment "${part.filename}"`);
      const bytes = decodeBodyRaw(rawPart, part.encoding);
      attachments.push({
        filename: part.filename,
        mimeType: `${part.type}/${part.subtype}`,
        contentBase64: uint8ToBase64(bytes),
      });
    }
    return attachments;
  }

  async #attachmentsFromArgs(args) {
    return [...(Array.isArray(args.attachments) ? args.attachments : []), ...(await fetchUrlAttachments(args.attachmentUrls))];
  }

  #smtpParams() {
    const c = this.#credentials;
    return {
      host: c.smtp_host,
      port: c.smtp_port ?? 587,
      user: c.smtp_user ?? c.imap_user,
      pass: c.smtp_pass ?? c.imap_pass,
      from: c.smtp_user ?? c.imap_user,
      replyTo: c.smtp_reply_to ?? null,
      signature: c.smtp_signature ?? null,
    };
  }

  async #handleRpc({ method, params, id }) {
    const ok = (result) => ({ jsonrpc: '2.0', id, result });
    const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
    const toolOk = (data) => ok({ content: [{ type: 'text', text: JSON.stringify(data) }], isError: false });
    const toolErr = (msg) => ok({ content: [{ type: 'text', text: msg }], isError: true });

    if (!method) return err(-32600, 'Missing method');
    if (method.startsWith('notifications/') || method === 'ping') return ok({});

    if (method === 'initialize') {
      return ok({
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'unthinkmail', version: '1.0.0' },
        capabilities: { tools: { listChanged: false } },
      });
    }

    if (method === 'tools/list') return ok({ tools: TOOLS });
    if (method !== 'tools/call') return err(-32601, 'Method not found');

    const name = params?.name;
    const args = params?.arguments ?? {};

    // --- sendemail (no IMAP needed) ---
    if (name === 'sendemail' || name === 'sendemailfromurls') {
      const usesTemplatedRecipients = name === 'sendemail' && args.recipients;
      if (!args.to && !usesTemplatedRecipients) return err(-32602, 'Missing to');
      if (!args.subject) return err(-32602, 'Missing subject');
      if (!hasMessageContent(args)) return err(-32602, 'Missing body or attachments');
      if (name === 'sendemailfromurls' && (!Array.isArray(args.attachmentUrls) || args.attachmentUrls.length === 0))
        return err(-32602, 'Missing attachmentUrls');
      try {
        const templatedMessages = usesTemplatedRecipients ? buildTemplatedSendMessages(args) : null;
        const attachments = await this.#attachmentsFromArgs(args);
        if (templatedMessages) {
          const results = [];
          for (const message of templatedMessages) {
            try {
              const result = await new SmtpClient().send({ ...this.#smtpParams(), ...message, attachments }, this.#credentials);
              results.push({ to: message.to, ok: true, ...result });
            } catch (e) {
              results.push({ to: message.to, ok: false, error: e.message });
            }
          }
          return toolOk({ sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
        }
        const result = await new SmtpClient().send(
          { ...this.#smtpParams(), to: args.to, subject: args.subject, body: args.body, htmlBody: args.htmlBody, cc: args.cc, bcc: args.bcc, attachments },
          this.#credentials,
        );
        return toolOk(result);
      } catch (e) {
        return toolErr(`${name === 'sendemailfromurls' ? 'Attachment/SMTP' : 'SMTP'} error: ` + e.message);
      }
    }

    // --- replyemail (needs IMAP for headers, then SMTP) ---
    if (name === 'replyemail') {
      if (!args.uid) return err(-32602, 'Missing uid');
      if (!hasMessageContent(args)) return err(-32602, 'Missing body or attachments');
      try {
        await this.#ensureConnected();
      } catch (e) {
        return toolErr('IMAP connection failed: ' + e.message);
      }
      try {
        const folder = args.folder ?? 'INBOX';
        const h = await this.#imap.fetchHeaders(folder, args.uid);

        const replyTo = h.replyTo || h.from;
        const replySubject = /^re:/i.test(h.subject) ? h.subject : 'Re: ' + h.subject;

        // Build References: chain (prior references + original message-id)
        const refs = [h.references, h.messageId].filter(Boolean).join(' ').trim();

        const attachments = await this.#attachmentsFromArgs(args);

        const result = await new SmtpClient().send(
          {
            ...this.#smtpParams(),
            to: replyTo,
            subject: replySubject,
            body: args.body,
            htmlBody: args.htmlBody,
            cc: args.cc,
            bcc: args.bcc,
            attachments,
            extraHeaders: {
              'In-Reply-To': h.messageId,
              References: refs,
            },
          },
          this.#credentials,
        );
        return toolOk(result);
      } catch (e) {
        await this.#disconnect();
        return toolErr(e.message);
      }
    }

    // --- forwardemail (needs IMAP to fetch original, then SMTP) ---
    if (name === 'forwardemail') {
      if (!args.uid) return err(-32602, 'Missing uid');
      if (!args.to) return err(-32602, 'Missing to');
      try {
        await this.#ensureConnected();
      } catch (e) {
        return toolErr('IMAP connection failed: ' + e.message);
      }
      try {
        const folder = args.folder ?? 'INBOX';
        const original = await this.#imap.getMessage(folder, args.uid);

        const origSubject = original.subject || '';
        const fwdSubject = /^fwd:/i.test(origSubject) ? origSubject : 'Fwd: ' + origSubject;

        const note = args.note ? args.note + '\r\n\r\n' : '';
        const fwdBody =
          note +
          '---------- Forwarded message ----------\r\n' +
          `From: ${original.from || ''}\r\n` +
          `Date: ${original.date || ''}\r\n` +
          `Subject: ${origSubject}\r\n` +
          `To: ${original.to || ''}\r\n` +
          '\r\n' +
          (original.body || '');

        const extraHeaders = {};
        if (original.messageId) extraHeaders['X-Forwarded-Message-Id'] = original.messageId;
        const originalAttachments = args.includeOriginalAttachments === false ? [] : await this.#fetchAttachmentsForSending(folder, args.uid);
        const attachments = [...originalAttachments, ...(await this.#attachmentsFromArgs(args))];

        const result = await new SmtpClient().send(
          {
            ...this.#smtpParams(),
            to: args.to,
            cc: args.cc,
            bcc: args.bcc,
            subject: fwdSubject,
            body: fwdBody,
            attachments,
            extraHeaders,
          },
          this.#credentials,
        );
        return toolOk(result);
      } catch (e) {
        await this.#disconnect();
        return toolErr(e.message);
      }
    }

    // --- all other tools require IMAP ---
    try {
      await this.#ensureConnected();
    } catch (e) {
      return toolErr('IMAP connection failed: ' + e.message);
    }

    try {
      let result;
      if (name === 'listfolders') {
        result = await this.#imap.listFolders();
      } else if (name === 'searchmessages') {
        let query;
        try {
          query = buildSearchQuery(args);
        } catch (e) {
          return err(-32602, e.message);
        }
        result = await this.#imap.searchMessages(args.folder ?? 'INBOX', query);
      } else if (name === 'getmessage') {
        if (!args.uid) return err(-32602, 'Missing uid');
        result = await this.#imap.getMessage(args.folder ?? 'INBOX', args.uid);
      } else if (name === 'deletemessage') {
        if (!args.uid) return err(-32602, 'Missing uid');
        result = await this.#imap.deleteMessage(args.folder ?? 'INBOX', args.uid);
      } else if (name === 'movemessage') {
        if (!args.uid) return err(-32602, 'Missing uid');
        if (!args.destination) return err(-32602, 'Missing destination');
        result = await this.#imap.moveMessage(args.folder ?? 'INBOX', args.uid, args.destination);
      } else if (name === 'markmessage') {
        if (!args.uid) return err(-32602, 'Missing uid');
        if (!args.mark) return err(-32602, 'Missing mark');
        const MARK_MAP = {
          read: ['+FLAGS', ['\\Seen']],
          unread: ['-FLAGS', ['\\Seen']],
          flagged: ['+FLAGS', ['\\Flagged']],
          unflagged: ['-FLAGS', ['\\Flagged']],
        };
        const entry = MARK_MAP[args.mark];
        if (!entry) return err(-32602, 'Invalid mark value — must be read, unread, flagged, or unflagged');
        result = await this.#imap.storeFlags(args.folder ?? 'INBOX', args.uid, entry[0], entry[1]);
      } else if (name === 'getthread') {
        if (!args.uid) return err(-32602, 'Missing uid');
        const folder = args.folder ?? 'INBOX';
        const order = args.order ?? 'asc';

        // Fetch seed message headers to get its Message-ID and References chain
        const seed = await this.#imap.fetchHeaders(folder, args.uid);
        const parseIds = (s) => (s || '').match(/<[^>]+>/g) || [];
        const allIds = new Set([seed.messageId, ...parseIds(seed.references), ...parseIds(seed.inReplyTo)].filter(Boolean));

        // Search the folder for each referenced Message-ID
        const threadUids = new Set([String(args.uid)]);
        for (const msgId of allIds) {
          if (threadUids.size >= 50) break;
          const r = await this.#imap.searchMessages(folder, `HEADER Message-ID ${msgId}`);
          for (const u of r.uids) threadUids.add(u);
        }

        // Fetch summary headers for every UID in the thread
        const messages = [];
        for (const u of threadUids) {
          if (messages.length >= 50) break;
          const h = await this.#imap.fetchHeaders(folder, u);
          messages.push({
            uid: u,
            from: h.from,
            to: h.to,
            subject: h.subject,
            date: h.date,
            messageId: h.messageId,
            inReplyTo: h.inReplyTo,
          });
        }

        messages.sort((a, b) => {
          const da = new Date(a.date || 0).getTime();
          const db = new Date(b.date || 0).getTime();
          return order === 'desc' ? db - da : da - db;
        });

        result = { folder, threadSize: messages.length, messages };
      } else if (name === 'downloadattachment') {
        if (!args.uid) return err(-32602, 'Missing uid');
        if (!args.filename) return err(-32602, 'Missing filename');
        const folder = args.folder ?? 'INBOX';
        const MAX_BYTES = MAX_ATTACHMENT_BYTES;

        const bsRaw = await this.#imap.fetchBodyStructure(folder, args.uid);
        const parts = parseBodyStructure(bsRaw);

        const part = parts.find((p) => p.filename === args.filename);
        if (!part) {
          const available =
            parts
              .filter((p) => p.filename)
              .map((p) => p.filename)
              .join(', ') || 'none';
          return toolErr(`Attachment "${args.filename}" not found. Available: ${available}`);
        }

        const decodedSize = part.encoding === 'base64' ? Math.floor(part.size * 0.75) : part.size;
        if (decodedSize > MAX_BYTES) {
          return toolErr(`Attachment too large: ~${Math.round(decodedSize / 1024)}KB exceeds ${MAX_BYTES / (1024 * 1024)}MB limit`);
        }

        const rawPart = await this.#imap.fetchBodyPart(folder, args.uid, part.partNum);
        if (rawPart === null) return toolErr('Could not fetch attachment part — server returned no literal');

        const bytes = decodeBodyRaw(rawPart, part.encoding);
        result = {
          filename: part.filename,
          mimeType: `${part.type}/${part.subtype}`,
          encoding: 'base64',
          size: bytes.length,
          content: uint8ToBase64(bytes),
        };
      } else if (name === 'bulkaction') {
        if (!Array.isArray(args.uids) || args.uids.length === 0) return err(-32602, 'Missing uids array');
        if (args.uids.length > 100) return err(-32602, 'Maximum 100 UIDs per bulkaction');
        if (!args.action) return err(-32602, 'Missing action');
        if (args.action === 'move' && !args.destination) return err(-32602, 'move action requires destination');

        let uidSeq;
        try {
          uidSeq = buildUidSequence(args.uids);
        } catch (e) {
          return err(-32602, e.message);
        }

        const folder = args.folder ?? 'INBOX';
        const FLAG_MAP = {
          read: ['+FLAGS', ['\\Seen']],
          unread: ['-FLAGS', ['\\Seen']],
          flag: ['+FLAGS', ['\\Flagged']],
          unflag: ['-FLAGS', ['\\Flagged']],
        };

        if (FLAG_MAP[args.action]) {
          const [op, flags] = FLAG_MAP[args.action];
          await this.#imap.storeFlags(folder, uidSeq, op, flags);
        } else if (args.action === 'delete') {
          await this.#imap.storeFlags(folder, uidSeq, '+FLAGS', ['\\Deleted']);
          await this.#imap.expunge();
        } else if (args.action === 'move') {
          await this.#imap.bulkMove(folder, uidSeq, args.destination);
        } else {
          return err(-32602, 'Unknown action: ' + args.action);
        }

        result = { action: args.action, count: args.uids.length, uidSequence: uidSeq };
      } else if (name === 'getemailstatus') {
        if (!args.uid) return err(-32602, 'Missing uid');
        result = await this.#imap.fetchMessageStatus(args.folder ?? 'INBOX', args.uid);
      } else if (name === 'getemails') {
        if (!Array.isArray(args.uids) || args.uids.length === 0) return err(-32602, 'Missing uids array');
        if (args.uids.length > 100) return err(-32602, 'Maximum 100 UIDs per getemails');
        const folder = args.folder ?? 'INBOX';
        const raw = await this.#imap.fetchMultiple(folder, args.uids);
        const emails = raw.map((msg) => {
          const h = parseHeaderBlock(msg.headerLiteral);
          return {
            uid: msg.uid,
            from: h['from'] || '',
            to: h['to'] || '',
            subject: h['subject'] || '',
            date: h['date'] || msg.internalDate || '',
            messageId: h['message-id'] || '',
            flags: msg.flags,
            seen: msg.flags.some((f) => f.toLowerCase() === '\\seen'),
            flagged: msg.flags.some((f) => f.toLowerCase() === '\\flagged'),
          };
        });
        result = { folder, count: emails.length, emails };
      } else if (name === 'getfolderstats') {
        const folders = Array.isArray(args.folders) && args.folders.length ? args.folders : ['INBOX'];
        const stats = [];
        for (const f of folders) {
          stats.push(await this.#imap.getFolderStatus(f));
        }
        result = { stats };
      } else if (name === 'createfolder') {
        if (!args.name) return err(-32602, 'Missing name');
        result = await this.#imap.createFolder(args.name);
      } else if (name === 'renamefolder') {
        if (!args.folder) return err(-32602, 'Missing folder');
        if (!args.newName) return err(-32602, 'Missing newName');
        result = await this.#imap.renameFolder(args.folder, args.newName);
      } else if (name === 'deletefolder') {
        if (!args.folder) return err(-32602, 'Missing folder');
        result = await this.#imap.deleteFolder(args.folder);
      } else if (name === 'addlabel') {
        if (!args.uid) return err(-32602, 'Missing uid');
        if (!args.label) return err(-32602, 'Missing label');
        let label;
        try {
          label = validateKeyword(args.label);
        } catch (e) {
          return err(-32602, e.message);
        }
        result = await this.#imap.storeFlags(args.folder ?? 'INBOX', args.uid, '+FLAGS', [label]);
      } else if (name === 'removelabel') {
        if (!args.uid) return err(-32602, 'Missing uid');
        if (!args.label) return err(-32602, 'Missing label');
        let label;
        try {
          label = validateKeyword(args.label);
        } catch (e) {
          return err(-32602, e.message);
        }
        result = await this.#imap.storeFlags(args.folder ?? 'INBOX', args.uid, '-FLAGS', [label]);
      } else if (name === 'extractcontacts') {
        const folder = args.folder ?? 'INBOX';
        const maxScan = Math.min(args.limit ?? 100, 200);
        // Fetch recent UIDs (search ALL, take the last maxScan)
        const search = await this.#imap.searchMessages(folder, 'ALL');
        const uids = search.uids.slice(-maxScan);
        const raw = await this.#imap.fetchMultiple(folder, uids);
        const freq = {};
        for (const msg of raw) {
          const h = parseHeaderBlock(msg.headerLiteral);
          for (const field of ['from', 'to', 'cc']) {
            for (const addr of parseAddresses(h[field])) {
              freq[addr] = (freq[addr] || 0) + 1;
            }
          }
        }
        const contacts = Object.entries(freq)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 50)
          .map(([email, count]) => ({ email, count }));
        result = { scanned: raw.length, contacts };
      } else if (name === 'savedraft') {
        if (!args.to) return err(-32602, 'Missing to');
        if (!args.subject) return err(-32602, 'Missing subject');
        if (!hasMessageContent(args)) return err(-32602, 'Missing body or attachments');
        const draftsFolder = args.folder ?? (await this.#imap.findDraftsFolder());
        const attachments = await this.#attachmentsFromArgs(args);
        const rawMsg = buildRawMessage({
          from: this.#smtpParams().from,
          to: args.to,
          subject: args.subject,
          body: args.body,
          htmlBody: args.htmlBody,
          cc: args.cc ?? null,
          bcc: args.bcc ?? null,
          attachments,
        });
        result = await this.#imap.appendMessage(draftsFolder, rawMsg, ['\\Draft']);
        result.draftsFolder = draftsFolder;
      } else if (name === 'senddraft') {
        if (!args.uid) return err(-32602, 'Missing uid');
        const draftsFolder = args.folder ?? (await this.#imap.findDraftsFolder());
        const draft = await this.#imap.getRawMessage(draftsFolder, args.uid);
        if (draft.error) return toolErr('Could not fetch draft: ' + draft.error);
        const [headerRaw] = splitHeaderBody(draft.raw);
        const h = parseHeaderBlock(headerRaw);
        if (!h['to']) return toolErr('Draft has no To address');
        const sendResult = await new SmtpClient().sendRaw(
          {
            ...this.#smtpParams(),
            to: h['to'],
            cc: h['cc'] || null,
            bcc: h['bcc'] || null,
            rawMessage: stripHeader(draft.raw, 'bcc'),
          },
          this.#credentials,
        );
        await this.#imap.deleteMessage(draftsFolder, args.uid);
        result = { sent: true, ...sendResult, deletedDraft: args.uid };
      } else if (name === 'listdrafts') {
        const draftsFolder = args.folder ?? (await this.#imap.findDraftsFolder());
        const limit = Math.min(args.limit ?? 50, 200);
        const search = await this.#imap.searchMessages(draftsFolder, 'ALL');
        const uids = search.uids.slice(-limit);
        const raw = await this.#imap.fetchMultiple(draftsFolder, uids);
        const drafts = raw
          .map((msg) => {
            const h = parseHeaderBlock(msg.headerLiteral);
            return {
              uid: msg.uid,
              to: h['to'] || '',
              subject: h['subject'] || '',
              date: h['date'] || msg.internalDate || '',
              flags: msg.flags,
            };
          })
          .reverse(); // most recent first
        result = { folder: draftsFolder, count: drafts.length, drafts };
      } else {
        return err(-32601, 'Unknown tool: ' + name);
      }
      return toolOk(result);
    } catch (e) {
      // Reset connection on error so next request reconnects cleanly
      await this.#disconnect();
      return toolErr(e.message);
    }
  }
}
