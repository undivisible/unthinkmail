// ImapSession Durable Object
// Maintains an IMAP connection via Cloudflare TCP Sockets (cloudflare:sockets)
// Handles MCP JSON-RPC directly — no container needed

import { ImapClient } from './imap.js';
import { SmtpClient } from './smtp.js';

const TOOLS = [
  { name: 'listfolders', description: 'List all IMAP mail folders / mailboxes', inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'searchmessages', description: 'Search messages in a folder using IMAP search criteria (e.g. ALL, UNSEEN, FROM "user@example.com", SUBJECT "hello", SINCE 1-Jan-2024)', inputSchema: { type: 'object', properties: { folder: { type: 'string', description: 'Folder to search, e.g. INBOX' }, query: { type: 'string', description: 'IMAP search criteria' } }, required: ['folder'] } },
  { name: 'getmessage', description: 'Fetch the full content of a message by its UID', inputSchema: { type: 'object', properties: { folder: { type: 'string' }, uid: { type: 'string', description: 'Message UID from searchmessages' } }, required: ['folder', 'uid'] } },
  { name: 'deletemessage', description: 'Permanently delete a message by UID', inputSchema: { type: 'object', properties: { folder: { type: 'string' }, uid: { type: 'string' } }, required: ['folder', 'uid'] } },
  { name: 'movemessage', description: 'Move a message to another folder', inputSchema: { type: 'object', properties: { folder: { type: 'string' }, uid: { type: 'string' }, destination: { type: 'string' } }, required: ['folder', 'uid', 'destination'] } },
  { name: 'sendemail', description: 'Send an email via SMTP', inputSchema: { type: 'object', properties: { to: { type: 'string', description: 'Recipient email address' }, subject: { type: 'string' }, body: { type: 'string', description: 'Plain text email body' }, cc: { type: 'string', description: 'Optional CC address' } }, required: ['to', 'subject', 'body'] } },
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export class ImapSession {
  #imap = null;
  #credentials = null;

  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    return this.state.blockConcurrencyWhile(async () => {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS });
      }

      if (request.method === 'GET') {
        return Response.json(
          { name: 'unthinkmail', version: '1.0.0', protocolVersion: '2024-11-05' },
          { headers: CORS }
        );
      }

      const body = await request.json().catch(() => null);
      if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: CORS });

      // Update credentials if provided
      if (body._credentials) {
        const creds = body._credentials;
        const changed = !this.#credentials ||
          this.#credentials.imap_host !== creds.imap_host ||
          this.#credentials.imap_user !== creds.imap_user ||
          this.#credentials.imap_port !== creds.imap_port;
        if (changed) {
          await this.#disconnect();
        }
        this.#credentials = creds;
      }

      const response = await this.#handleRpc(body);
      return Response.json(response, { headers: CORS });
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

    // sendemail doesn't need IMAP
    if (name === 'sendemail') {
      if (!args.to) return err(-32602, 'Missing to');
      if (!args.subject) return err(-32602, 'Missing subject');
      if (!args.body) return err(-32602, 'Missing body');
      try {
        const smtp = new SmtpClient();
        const result = await smtp.send({
          host: this.#credentials.smtp_host,
          port: this.#credentials.smtp_port ?? 465,
          user: this.#credentials.smtp_user ?? this.#credentials.imap_user,
          pass: this.#credentials.smtp_pass ?? this.#credentials.imap_pass,
          from: this.#credentials.smtp_user ?? this.#credentials.imap_user,
          to: args.to,
          subject: args.subject,
          body: args.body,
          cc: args.cc,
        });
        return toolOk(result);
      } catch (e) {
        return toolErr('SMTP error: ' + e.message);
      }
    }

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
        result = await this.#imap.searchMessages(args.folder ?? 'INBOX', args.query ?? 'ALL');
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
      } else {
        return err(-32601, 'Unknown tool: ' + name);
      }
      return toolOk(result);
    } catch (e) {
      // Reset connection on error so next request reconnects
      await this.#disconnect();
      return toolErr(e.message);
    }
  }
}
