// ImapSession Durable Object
// Maintains an IMAP connection via Cloudflare TCP Sockets (cloudflare:sockets)
// Handles MCP JSON-RPC directly — no container needed

import { ImapClient } from './imap.js';
import { SmtpClient } from './smtp.js';

// IMAP date format: DD-Mon-YYYY (e.g. 1-Jan-2024)
const IMAP_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function toImapDate(s) {
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d)) throw new Error('Invalid date: ' + s);
  return `${d.getUTCDate()}-${IMAP_MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

// Escape a value for use in an IMAP quoted string
const imapStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, '')}"`;

// Build an IMAP SEARCH criteria string from structured args
// Falls back to raw `query` if provided (for advanced use)
function buildSearchQuery(args) {
  if (args.query) return args.query;
  const parts = [];
  if (args.unseen) parts.push('UNSEEN');
  if (args.from) parts.push(`FROM ${imapStr(args.from)}`);
  if (args.subject) parts.push(`SUBJECT ${imapStr(args.subject)}`);
  if (args.since) parts.push(`SINCE ${toImapDate(args.since)}`);
  if (args.before) parts.push(`BEFORE ${toImapDate(args.before)}`);
  return parts.length ? parts.join(' ') : 'ALL';
}

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
        folder:  { type: 'string', description: 'Folder to search (default: INBOX)' },
        unseen:  { type: 'boolean', description: 'Only return unread messages' },
        from:    { type: 'string', description: 'Filter by sender address or name' },
        subject: { type: 'string', description: 'Filter by subject text' },
        since:   { type: 'string', description: 'Messages on or after this date (YYYY-MM-DD)' },
        before:  { type: 'string', description: 'Messages before this date (YYYY-MM-DD)' },
        query:   { type: 'string', description: 'Raw IMAP SEARCH criteria (overrides other fields when provided)' },
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
        uid:    { type: 'string', description: 'Message UID from searchmessages' },
      },
      required: ['uid'],
    },
  },
  {
    name: 'deletemessage',
    description: 'Permanently delete a message by UID',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string' },
        uid:    { type: 'string' },
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
        folder:      { type: 'string' },
        uid:         { type: 'string' },
        destination: { type: 'string', description: 'Destination folder name' },
      },
      required: ['uid', 'destination'],
    },
  },
  {
    name: 'sendemail',
    description: 'Compose and send a new email via SMTP.to can be a single address or array.',
    inputSchema: {
      type: 'object',
      properties: {
        to:      { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } } }], description: 'Recipient email address(es)' },
        subject: { type: 'string' },
        body:    { type: 'string', description: 'Plain text email body' },
        cc:      { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } } }, null], description: 'Optional CC address(es)' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'batchsend',
    description: 'Send multiple emails in a single call. Takes an array of {to, subject, body, cc} objects.',
    inputSchema: {
      type: 'object',
      properties: {
        emails: {
          type: 'array',
          description: 'Array of emails to send',
          items: {
            type: 'object',
            properties: {
              to:      { type: 'string' },
              subject: { type: 'string' },
              body:    { type: 'string' },
              cc:      { type: 'string' },
            },
            required: ['to', 'subject', 'body'],
          },
        },
      },
      required: ['emails'],
    },
  },
  {
    name: 'replyemail',
    description: 'Reply to an existing message, preserving threading headers (In-Reply-To / References)',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder containing the original message (default: INBOX)' },
        uid:    { type: 'string', description: 'UID of the message to reply to' },
        body:   { type: 'string', description: 'Plain text reply body' },
      },
      required: ['uid', 'body'],
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
    return this.state.blockConcurrencyWhile(async () => {
      if (request.method === 'GET') {
        return Response.json({ name: 'unthinkmail', version: '1.0.0', protocolVersion: '2024-11-05' });
      }

      const body = await request.json().catch(() => null);
      if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 });

      // Update credentials if provided (injected by mcp.js Worker, not from clients)
      if (body._credentials) {
        const creds = body._credentials;
        const changed = !this.#credentials ||
          this.#credentials.imap_host !== creds.imap_host ||
          this.#credentials.imap_user !== creds.imap_user ||
          this.#credentials.imap_port !== creds.imap_port;
        if (changed) await this.#disconnect();
        this.#credentials = creds;
      }

      const response = await this.#handleRpc(body);
      return Response.json(response);
    });
  }

  async #ensureConnected() {
    if (this.#imap?.isConnected()) return;
    if (!this.#credentials) throw new Error('No credentials');
    console.log('[imap] connecting to', this.#credentials.imap_host, this.#credentials.imap_port);
    this.#imap = new ImapClient();
    await this.#imap.connect(
      this.#credentials.imap_host,
      this.#credentials.imap_port,
      this.#credentials.imap_user,
      this.#credentials.imap_pass,
    );
    console.log('[imap] authenticated');
  }

  async #disconnect() {
    if (this.#imap) {
      await this.#imap.close().catch(() => {});
      this.#imap = null;
    }
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
    const ok      = (result)         => ({ jsonrpc: '2.0', id, result });
    const err     = (code, message)  => ({ jsonrpc: '2.0', id, error: { code, message } });
    const toolOk  = (data)           => ok({ content: [{ type: 'text', text: JSON.stringify(data) }], isError: false });
    const toolErr = (msg)            => ok({ content: [{ type: 'text', text: msg }], isError: true });

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
    if (name === 'sendemail') {
      if (!args.to)      return err(-32602, 'Missing to');
      if (!args.subject) return err(-32602, 'Missing subject');
      if (!args.body)    return err(-32602, 'Missing body');
      try {
        const result = await new SmtpClient().send({ ...this.#smtpParams(), to: args.to, subject: args.subject, body: args.body, cc: args.cc }, this.#credentials);
        return toolOk(result);
      } catch (e) {
        return toolErr('SMTP error: ' + e.message);
      }
    }

    // --- batchsend (multiple emails) ---
    if (name === 'batchsend') {
      const emails = args.emails;
      if (!Array.isArray(emails) || emails.length === 0) return err(-32602, 'Missing emails array');
      if (emails.length > 50) return err(-32602, 'Maximum 50 emails per batch');
      const results = [];
      for (const email of emails) {
        if (!email.to || !email.subject || !email.body) {
          results.push({ to: email.to, ok: false, error: 'Missing required field' });
          continue;
        }
        try {
          const r = await new SmtpClient().send({ ...this.#smtpParams(), to: email.to, subject: email.subject, body: email.body, cc: email.cc }, this.#credentials);
          results.push({ to: email.to, ok: true, ...r });
        } catch (e) {
          results.push({ to: email.to, ok: false, error: e.message });
        }
      }
      return toolOk({ sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results });
    }

    // --- replyemail (needs IMAP for headers, then SMTP) ---
    if (name === 'replyemail') {
      if (!args.uid)  return err(-32602, 'Missing uid');
      if (!args.body) return err(-32602, 'Missing body');
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

        const result = await new SmtpClient().send({
          ...this.#smtpParams(),
          to: replyTo,
          subject: replySubject,
          body: args.body,
          extraHeaders: {
            'In-Reply-To': h.messageId,
            'References':  refs,
          },
        }, this.#credentials);
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
        try { query = buildSearchQuery(args); } catch (e) { return err(-32602, e.message); }
        result = await this.#imap.searchMessages(args.folder ?? 'INBOX', query);

      } else if (name === 'getmessage') {
        if (!args.uid) return err(-32602, 'Missing uid');
        result = await this.#imap.getMessage(args.folder ?? 'INBOX', args.uid);

      } else if (name === 'deletemessage') {
        if (!args.uid) return err(-32602, 'Missing uid');
        result = await this.#imap.deleteMessage(args.folder ?? 'INBOX', args.uid);

      } else if (name === 'movemessage') {
        if (!args.uid)         return err(-32602, 'Missing uid');
        if (!args.destination) return err(-32602, 'Missing destination');
        result = await this.#imap.moveMessage(args.folder ?? 'INBOX', args.uid, args.destination);

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
