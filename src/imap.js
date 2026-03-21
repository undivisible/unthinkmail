// IMAP client using Cloudflare TCP Sockets (cloudflare:sockets)
// No external process — uses Cloudflare's own connect() API with TLS

import { connect } from 'cloudflare:sockets';

const enc = new TextEncoder();
const dec = new TextDecoder();

export class ImapClient {
  #socket = null;
  #reader = null;
  #writer = null;
  #buf = new Uint8Array(0);
  #tagCounter = 0;
  #authenticated = false;

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
    await this.#write(`${tag} LOGIN "${user}" "${pass}"\r\n`);
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
    await this.#cmd(`SELECT "${folder}"`);
    const resp = await this.#cmd(`UID SEARCH ${query}`);
    const uids = [];
    for (const line of resp.split('\n')) {
      if (!line.startsWith('* SEARCH')) continue;
      uids.push(...line.slice(8).trim().split(/\s+/).filter(Boolean));
    }
    return { folder, uids };
  }

  async getMessage(folder, uid) {
    await this.#cmd(`SELECT "${folder}"`);
    const tag = this.#tag();
    await this.#write(`${tag} UID FETCH ${uid} (BODY.PEEK[])\r\n`);

    let message = null;
    while (true) {
      const line = await this.#readLine();
      if (line.startsWith(tag + ' ')) break;
      const litMatch = line.trimEnd().match(/\{(\d+)\}$/);
      if (litMatch) {
        const n = parseInt(litMatch[1], 10);
        const bytes = await this.#readBytes(n);
        message = dec.decode(bytes);
      }
    }

    if (message === null) return { uid, error: 'no_literal' };
    return { uid, message };
  }

  async deleteMessage(folder, uid) {
    await this.#cmd(`SELECT "${folder}"`);
    await this.#cmd(`UID STORE ${uid} +FLAGS (\\Deleted)`);
    await this.#cmd('EXPUNGE');
    return { deleted: true };
  }

  async moveMessage(folder, uid, destination) {
    await this.#cmd(`SELECT "${folder}"`);
    // Try UID MOVE (RFC 6851), fall back to COPY+DELETE
    const tag = this.#tag();
    await this.#write(`${tag} UID MOVE ${uid} "${destination}"\r\n`);
    const resp = await this.#readUntilTag(tag);
    if (!this.#lastLine(resp, tag).startsWith('OK')) {
      await this.#cmd(`UID COPY ${uid} "${destination}"`);
      await this.#cmd(`UID STORE ${uid} +FLAGS (\\Deleted)`);
      await this.#cmd('EXPUNGE');
    }
    return { moved: true };
  }

  // --- internals ---

  #tag() { return `T${++this.#tagCounter}`; }

  async #write(s) { await this.#writer.write(enc.encode(s)); }

  async #readLine() {
    while (true) {
      const nl = this.#buf.indexOf(10);
      if (nl >= 0) {
        const line = dec.decode(this.#buf.slice(0, nl + 1)).replace(/\r\n$/, '').replace(/\n$/, '');
        this.#buf = this.#buf.slice(nl + 1);
        return line;
      }
      const { done, value } = await this.#reader.read();
      if (done) return dec.decode(this.#buf).trim();
      const next = new Uint8Array(this.#buf.length + value.length);
      next.set(this.#buf);
      next.set(value, this.#buf.length);
      this.#buf = next;
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
    while (this.#buf.length < n) {
      const { done, value } = await this.#reader.read();
      if (done) break;
      const next = new Uint8Array(this.#buf.length + value.length);
      next.set(this.#buf);
      next.set(value, this.#buf.length);
      this.#buf = next;
    }
    const chunk = this.#buf.slice(0, n);
    this.#buf = this.#buf.slice(n);
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
