// IMAP client using Cloudflare TCP Sockets (cloudflare:sockets)
// No external process — uses Cloudflare's own connect() API with TLS

import { connect } from 'cloudflare:sockets';
import { parseMime } from './mime.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

// Produce an IMAP quoted-string, escaping \ and " per RFC 3501 §4.3
const imapQuote = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// Validate an IMAP sequence-set (UIDs): digits, colons, commas, star only
const validateUid = (uid) => {
  if (!/^[\d:,*]+$/.test(String(uid))) throw new Error('Invalid UID: ' + uid);
  return String(uid);
};

export class ImapClient {
  #socket = null;
  #reader = null;
  #writer = null;
  // Chunk list + total length — avoids O(n²) copies during large message reads
  #chunks = [];
  #bufLen = 0;
  #tagCounter = 0;
  #authenticated = false;

  isConnected() { return this.#authenticated; }

  async connect(host, port, user, pass) {
    this.#socket = connect({ hostname: host, port }, { secureTransport: 'on' });
    // Await connection establishment — surfaces TLS/TCP errors with a real message
    await this.#socket.opened;
    this.#reader = this.#socket.readable.getReader();
    this.#writer = this.#socket.writable.getWriter();

    const greeting = await this.#readLine();
    console.log('[imap] greeting:', greeting);
    if (!greeting.startsWith('* OK') && !greeting.startsWith('* PREAUTH')) {
      throw new Error('Bad greeting: ' + greeting);
    }

    const tag = this.#tag();
    await this.#write(`${tag} LOGIN ${imapQuote(user)} ${imapQuote(pass)}\r\n`);
    const resp = await this.#readUntilTag(tag);
    const status = this.#lastLine(resp, tag);
    if (!status.startsWith('OK')) throw new Error('Login failed: ' + status);
    this.#authenticated = true;
  }

  async close() {
    this.#authenticated = false;
    try { await this.#write(`${this.#tag()} LOGOUT\r\n`); } catch {}
    try { await this.#writer?.close(); } catch {}
    try { this.#reader?.cancel(); } catch {}
  }

  async listFolders() {
    const resp = await this.#cmd('LIST "" "*"');
    const folders = [];
    for (const line of resp.split('\n')) {
      if (!line.startsWith('* LIST')) continue;
      // Match last quoted string or unquoted name
      const m = line.match(/"([^"]*)"$/) || line.match(/(\S+)$/);
      if (m) folders.push(m[1]);
    }
    return { folders };
  }

  async searchMessages(folder, query) {
    await this.#cmd(`SELECT ${imapQuote(folder)}`);
    const resp = await this.#cmd(`UID SEARCH ${query}`);
    const uids = [];
    for (const line of resp.split('\n')) {
      if (!line.startsWith('* SEARCH')) continue;
      uids.push(...line.slice(8).trim().split(/\s+/).filter(Boolean));
    }
    return { folder, uids };
  }

  // Fetch a message and return parsed MIME structure
  async getMessage(folder, uid) {
    await this.#cmd(`SELECT ${imapQuote(folder)}`);
    const safeUid = validateUid(uid);
    const raw = await this.#fetchLiteral(safeUid, 'BODY.PEEK[]');
    if (raw === null) return { uid, error: 'no_literal' };

    const parsed = parseMime(raw);
    return { uid, ...parsed };
  }

  // Fetch only the headers needed to construct a reply (Message-ID, References, From, Reply-To, Subject)
  async fetchHeaders(folder, uid) {
    await this.#cmd(`SELECT ${imapQuote(folder)}`);
    const safeUid = validateUid(uid);
    const raw = await this.#fetchLiteral(
      safeUid,
      'BODY.PEEK[HEADER.FIELDS (FROM REPLY-TO SUBJECT MESSAGE-ID REFERENCES IN-REPLY-TO)]'
    );
    if (raw === null) return {};

    const map = {};
    const unfolded = raw.replace(/\r?\n[ \t]+/g, ' ');
    for (const line of unfolded.split(/\r?\n/)) {
      const colon = line.indexOf(':');
      if (colon <= 0) continue;
      const key = line.slice(0, colon).trim().toLowerCase();
      const val = line.slice(colon + 1).trim();
      if (!map[key]) map[key] = val;
    }
    return {
      from:       map['from'] || '',
      replyTo:    map['reply-to'] || '',
      subject:    map['subject'] || '',
      messageId:  map['message-id'] || '',
      references: map['references'] || '',
      inReplyTo:  map['in-reply-to'] || '',
    };
  }

  async deleteMessage(folder, uid) {
    const safeUid = validateUid(uid);
    await this.#cmd(`SELECT ${imapQuote(folder)}`);
    await this.#cmd(`UID STORE ${safeUid} +FLAGS (\\Deleted)`);
    await this.#cmd('EXPUNGE');
    return { deleted: true };
  }

  async moveMessage(folder, uid, destination) {
    const safeUid = validateUid(uid);
    await this.#cmd(`SELECT ${imapQuote(folder)}`);
    // Try UID MOVE (RFC 6851), fall back to COPY+DELETE
    const tag = this.#tag();
    await this.#write(`${tag} UID MOVE ${safeUid} ${imapQuote(destination)}\r\n`);
    const resp = await this.#readUntilTag(tag);
    if (!this.#lastLine(resp, tag).startsWith('OK')) {
      await this.#cmd(`UID COPY ${safeUid} ${imapQuote(destination)}`);
      await this.#cmd(`UID STORE ${safeUid} +FLAGS (\\Deleted)`);
      await this.#cmd('EXPUNGE');
    }
    return { moved: true };
  }

  // --- internals ---

  #tag() { return `T${++this.#tagCounter}`; }

  async #write(s) { await this.#writer.write(enc.encode(s)); }

  // Issue a UID FETCH for a single item (e.g. BODY.PEEK[] or BODY.PEEK[HEADER...])
  // Returns the decoded literal string, or null if no literal found
  async #fetchLiteral(safeUid, item) {
    const tag = this.#tag();
    await this.#write(`${tag} UID FETCH ${safeUid} (${item})\r\n`);
    let literal = null;
    while (true) {
      const line = await this.#readLine();
      if (line.startsWith(tag + ' ')) break;
      const m = line.match(/\{(\d+)\}$/);
      if (m) {
        const n = parseInt(m[1], 10);
        const bytes = await this.#readBytes(n);
        literal = dec.decode(bytes);
      }
    }
    return literal;
  }

  // Flatten accumulated chunks into a single Uint8Array and reset
  #flatten() {
    if (this.#chunks.length === 0) return new Uint8Array(0);
    if (this.#chunks.length === 1) {
      const buf = this.#chunks[0];
      this.#chunks = [];
      this.#bufLen = 0;
      return buf;
    }
    const buf = new Uint8Array(this.#bufLen);
    let off = 0;
    for (const c of this.#chunks) { buf.set(c, off); off += c.length; }
    this.#chunks = [];
    this.#bufLen = 0;
    return buf;
  }

  async #readLine() {
    while (true) {
      // Search existing chunks for \n without flattening
      let scanned = 0;
      for (const chunk of this.#chunks) {
        const nl = chunk.indexOf(10);
        if (nl >= 0) {
          const flat = this.#flatten();
          const pos = scanned + nl;
          const line = dec.decode(flat.subarray(0, pos + 1)).replace(/\r?\n$/, '');
          const rest = flat.subarray(pos + 1);
          if (rest.length) { this.#chunks = [rest]; this.#bufLen = rest.length; }
          return line;
        }
        scanned += chunk.length;
      }
      const { done, value } = await this.#reader.read();
      if (done) {
        const flat = this.#flatten();
        return dec.decode(flat).trim();
      }
      this.#chunks.push(value);
      this.#bufLen += value.length;
    }
  }

  async #readUntilTag(tag) {
    const lines = [];
    while (true) {
      const line = await this.#readLine();
      lines.push(line);
      if (line.startsWith(tag + ' ')) break;
      if (lines.length > 10000) break;
    }
    return lines.join('\n');
  }

  // Read exactly n raw bytes from the socket buffer
  async #readBytes(n) {
    while (this.#bufLen < n) {
      const { done, value } = await this.#reader.read();
      if (done) break;
      this.#chunks.push(value);
      this.#bufLen += value.length;
    }
    const flat = this.#flatten();
    const chunk = flat.subarray(0, n);
    const rest = flat.subarray(n);
    if (rest.length) { this.#chunks = [rest]; this.#bufLen = rest.length; }
    return chunk;
  }

  #lastLine(resp, tag) {
    for (const line of resp.split('\n')) {
      if (line.startsWith(tag + ' ')) return line.slice(tag.length + 1);
    }
    return '';
  }

  async #cmd(cmd) {
    const tag = this.#tag();
    await this.#write(`${tag} ${cmd}\r\n`);
    return this.#readUntilTag(tag);
  }
}
