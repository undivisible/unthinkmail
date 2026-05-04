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
  #selectedFolder = null;

  isConnected() { return this.#authenticated; }

  async connect(host, port, user, pass) {
    this.#socket = connect({ hostname: host, port }, { secureTransport: 'on' });
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
    this.#selectedFolder = null;
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
    await this.#selectIfNeeded(folder);
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
    await this.#selectIfNeeded(folder);
    const safeUid = validateUid(uid);
    const raw = await this.#fetchLiteral(safeUid, 'BODY.PEEK[]');
    if (raw === null) return { uid, error: 'no_literal' };

    const parsed = parseMime(raw);
    return { uid, ...parsed };
  }

  // Fetch only the headers needed to construct a reply / thread
  async fetchHeaders(folder, uid) {
    await this.#selectIfNeeded(folder);
    const safeUid = validateUid(uid);
    const raw = await this.#fetchLiteral(
      safeUid,
      'BODY.PEEK[HEADER.FIELDS (FROM REPLY-TO SUBJECT MESSAGE-ID REFERENCES IN-REPLY-TO DATE TO)]'
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
      date:       map['date'] || '',
      to:         map['to'] || '',
    };
  }

  async deleteMessage(folder, uid) {
    const safeUid = validateUid(uid);
    await this.#selectIfNeeded(folder);
    await this.#cmd(`UID STORE ${safeUid} +FLAGS (\\Deleted)`);
    await this.#cmd('EXPUNGE');
    return { deleted: true };
  }

  async moveMessage(folder, uid, destination) {
    const safeUid = validateUid(uid);
    await this.#selectIfNeeded(folder);
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

  // Set or clear IMAP flags on one or more messages.
  // uid may be a single UID or a pre-validated sequence set string (e.g. "1,5,10:15")
  async storeFlags(folder, uid, op, flags) {
    await this.#selectIfNeeded(folder);
    const safeUid = validateUid(uid);
    const flagStr = '(' + flags.join(' ') + ')';
    await this.#cmd(`UID STORE ${safeUid} ${op} ${flagStr}`);
    return { stored: true };
  }

  // Fetch raw BODYSTRUCTURE response for a message (parsed by mime.js parseBodyStructure)
  async fetchBodyStructure(folder, uid) {
    await this.#selectIfNeeded(folder);
    const safeUid = validateUid(uid);
    const tag = this.#tag();
    await this.#write(`${tag} UID FETCH ${safeUid} (BODYSTRUCTURE)\r\n`);
    return await this.#readUntilTag(tag);
  }

  // Fetch a specific MIME body part by part number (e.g. "1", "2", "1.2")
  async fetchBodyPart(folder, uid, partNum) {
    await this.#selectIfNeeded(folder);
    const safeUid = validateUid(uid);
    if (!/^\d+(\.\d+)*$/.test(String(partNum))) throw new Error('Invalid part number: ' + partNum);
    return await this.#fetchLiteral(safeUid, `BODY.PEEK[${partNum}]`);
  }

  // Move a sequence set of UIDs to destination; falls back to COPY+DELETE if MOVE unsupported
  async bulkMove(folder, uidSeq, destination) {
    await this.#selectIfNeeded(folder);
    const tag = this.#tag();
    await this.#write(`${tag} UID MOVE ${uidSeq} ${imapQuote(destination)}\r\n`);
    const resp = await this.#readUntilTag(tag);
    if (!this.#lastLine(resp, tag).startsWith('OK')) {
      await this.#cmd(`UID COPY ${uidSeq} ${imapQuote(destination)}`);
      await this.#cmd(`UID STORE ${uidSeq} +FLAGS (\\Deleted)`);
      await this.#cmd('EXPUNGE');
    }
    return { moved: true };
  }

  async expunge() {
    await this.#cmd('EXPUNGE');
  }

  async createFolder(name) {
    const tag = this.#tag();
    await this.#write(`${tag} CREATE ${imapQuote(name)}\r\n`);
    const resp = await this.#readUntilTag(tag);
    if (!this.#lastLine(resp, tag).startsWith('OK')) throw new Error('CREATE failed: ' + this.#lastLine(resp, tag));
    return { created: true, folder: name };
  }

  async renameFolder(name, newName) {
    const tag = this.#tag();
    await this.#write(`${tag} RENAME ${imapQuote(name)} ${imapQuote(newName)}\r\n`);
    const resp = await this.#readUntilTag(tag);
    if (!this.#lastLine(resp, tag).startsWith('OK')) throw new Error('RENAME failed: ' + this.#lastLine(resp, tag));
    if (this.#selectedFolder === name) this.#selectedFolder = null;
    return { renamed: true, from: name, to: newName };
  }

  async deleteFolder(name) {
    const tag = this.#tag();
    await this.#write(`${tag} DELETE ${imapQuote(name)}\r\n`);
    const resp = await this.#readUntilTag(tag);
    if (!this.#lastLine(resp, tag).startsWith('OK')) throw new Error('DELETE failed: ' + this.#lastLine(resp, tag));
    if (this.#selectedFolder === name) this.#selectedFolder = null;
    return { deleted: true, folder: name };
  }

  // Get message/unseen/recent counts for a folder via STATUS command.
  // Intentionally does NOT call #selectIfNeeded — STATUS works on non-selected folders.
  async getFolderStatus(folder) {
    const resp = await this.#cmd(`STATUS ${imapQuote(folder)} (MESSAGES UNSEEN RECENT UIDNEXT)`);
    const result = { folder, messages: 0, unseen: 0, recent: 0, uidNext: 0 };
    const m = resp.match(/\bSTATUS\s+(?:"[^"]*"|\S+)\s+\(([^)]+)\)/i);
    if (m) {
      const parts = m[1].trim().split(/\s+/);
      for (let i = 0; i + 1 < parts.length; i += 2) {
        const key = parts[i].toLowerCase();
        const val = parseInt(parts[i + 1]) || 0;
        if (key === 'messages') result.messages = val;
        if (key === 'unseen')   result.unseen   = val;
        if (key === 'recent')   result.recent   = val;
        if (key === 'uidnext')  result.uidNext  = val;
      }
    }
    return result;
  }

  // Lightweight flag + size fetch — no body download needed
  async fetchMessageStatus(folder, uid) {
    await this.#selectIfNeeded(folder);
    const safeUid = validateUid(uid);
    const resp = await this.#cmd(`UID FETCH ${safeUid} (UID FLAGS RFC822.SIZE)`);
    const result = { uid: safeUid, flags: [], seen: false, flagged: false, size: 0 };
    for (const line of resp.split('\n')) {
      if (!line.startsWith('* ')) continue;
      const uidM   = line.match(/\bUID (\d+)/i);
      if (uidM) result.uid = uidM[1];
      const flagsM = line.match(/\bFLAGS \(([^)]*)\)/i);
      if (flagsM) {
        result.flags   = flagsM[1].trim().split(/\s+/).filter(Boolean);
        result.seen    = result.flags.some(f => f.toLowerCase() === '\\seen');
        result.flagged = result.flags.some(f => f.toLowerCase() === '\\flagged');
      }
      const sizeM = line.match(/\bRFC822\.SIZE (\d+)/i);
      if (sizeM) result.size = parseInt(sizeM[1]);
    }
    return result;
  }

  // Batch header fetch — returns array of { uid, flags, internalDate, headerLiteral }
  async fetchMultiple(folder, uids) {
    if (!uids || uids.length === 0) return [];
    await this.#selectIfNeeded(folder);
    const uidSeq = uids.map(u => validateUid(u)).join(',');

    const tag = this.#tag();
    await this.#write(`${tag} UID FETCH ${uidSeq} (UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID)])\r\n`);

    const messages = [];
    let current = null;

    while (true) {
      const line = await this.#readLine();
      if (line.startsWith(tag + ' ')) break;

      // New FETCH response
      if (/^\* \d+ FETCH/i.test(line)) {
        current = { uid: null, flags: [], internalDate: '', headerLiteral: '' };
        messages.push(current);
      }

      // Extract fields from any line belonging to the current message
      if (current) {
        const uidM = line.match(/\bUID (\d+)/i);
        if (uidM && !current.uid) current.uid = uidM[1];

        const flagsM = line.match(/\bFLAGS \(([^)]*)\)/i);
        if (flagsM) current.flags = flagsM[1].trim().split(/\s+/).filter(Boolean);

        const dateM = line.match(/\bINTERNALDATE "([^"]+)"/i);
        if (dateM) current.internalDate = dateM[1];
      }

      // Literal block
      const litM = line.match(/\{(\d+)\}$/);
      if (litM && current) {
        const bytes = await this.#readBytes(parseInt(litM[1], 10));
        current.headerLiteral = dec.decode(bytes);
      }
    }

    return messages;
  }

  // APPEND a raw RFC 2822 message to a folder (used for saving drafts)
  async appendMessage(folder, rawMessage, flags = ['\\Draft']) {
    const msgBytes = enc.encode(rawMessage);
    const flagStr = '(' + flags.join(' ') + ')';
    const tag = this.#tag();
    await this.#write(`${tag} APPEND ${imapQuote(folder)} ${flagStr} {${msgBytes.length}}\r\n`);

    // Server sends a '+' continuation before we upload the literal
    const cont = await this.#readLine();
    if (!cont.startsWith('+')) throw new Error('APPEND continuation expected, got: ' + cont);

    await this.#writer.write(msgBytes);
    await this.#write('\r\n');

    const resp = await this.#readUntilTag(tag);
    if (!this.#lastLine(resp, tag).startsWith('OK')) {
      throw new Error('APPEND failed: ' + this.#lastLine(resp, tag));
    }

    // Invalidate SELECT cache — APPEND can affect folder state
    this.#selectedFolder = null;
    return { appended: true, folder };
  }

  // Detect the Drafts folder by \Drafts attribute, then common name fallbacks
  async findDraftsFolder() {
    const resp = await this.#cmd('LIST "" "*"');
    for (const line of resp.split('\n')) {
      if (!line.startsWith('* LIST')) continue;
      if (/\\Drafts/i.test(line)) {
        const m = line.match(/"([^"]*)"$/) || line.match(/(\S+)$/);
        if (m) return m[1];
      }
    }
    for (const name of ['Drafts', 'INBOX.Drafts', '[Gmail]/Drafts', 'Draft']) {
      try {
        await this.#cmd(`SELECT ${imapQuote(name)}`);
        this.#selectedFolder = name;
        return name;
      } catch {}
    }
    return 'Drafts';
  }

  // --- internals ---

  #tag() { return `T${++this.#tagCounter}`; }

  async #write(s) { await this.#writer.write(enc.encode(s)); }

  // Select a folder only if it isn't already selected — avoids redundant round-trips
  async #selectIfNeeded(folder) {
    if (this.#selectedFolder === folder) return;
    await this.#cmd(`SELECT ${imapQuote(folder)}`);
    this.#selectedFolder = folder;
  }

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
