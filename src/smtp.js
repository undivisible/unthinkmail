// SMTP client using Cloudflare TCP Sockets
// Supports SMTPS (port 465, TLS-from-start) and STARTTLS (port 587 / any non-465)

import { connect } from 'cloudflare:sockets';
import { buildMimeMessage, normalizeAttachments } from './outbound-mime.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

// Extract bare email address from "Display Name <addr@example.com>" or plain "addr@example.com"
const envelopeAddr = (s) => {
  const m = String(s).match(/<([^>]+)>/);
  return (m ? m[1] : String(s).trim()).replace(/[\r\n]/g, '').trim();
};

// Sanitize a header value — strip CRLF to prevent header injection
const sanitizeHeader = (s) => String(s).replace(/[\r\n]/g, '').trim();

const parseRecipients = (value) => {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',');
  return raw.map(sanitizeHeader).filter(Boolean);
};

const b64utf8 = (s) => btoa(String.fromCharCode(...enc.encode(String(s))));

export class SmtpClient {
  async send({ host, port, user, pass, from, to, subject, body, htmlBody, cc, extraHeaders = {}, replyTo, signature, attachments }, creds) {
    const normalizedAttachments = normalizeAttachments(attachments);
    // Append signature to body if configured
    const sig = signature || creds?.smtp_signature;
    const messageBody = String(body ?? '');
    const signedBody = sig ? `${messageBody}\r\n\r\n${sig}` : messageBody;
    from    = sanitizeHeader(from);
    const toList = parseRecipients(to);
    const ccList = cc ? parseRecipients(cc) : [];
    subject = sanitizeHeader(subject);

    // Override from address if custom SMTP sender configured
    let fromAddr = from;
    if (creds?.smtp_from_email) {
      if (creds.smtp_from_name) {
        fromAddr = `${creds.smtp_from_name} <${creds.smtp_from_email}>`;
      } else {
        fromAddr = creds.smtp_from_email;
      }
      fromAddr = sanitizeHeader(fromAddr);
    }

    const effectiveReplyTo = sanitizeHeader(replyTo || creds?.smtp_reply_to || '');

    const message = buildMimeMessage({
      from: fromAddr,
      to: toList,
      subject,
      body: signedBody,
      htmlBody,
      cc: ccList,
      extraHeaders,
      replyTo: effectiveReplyTo,
      normalizedAttachments,
    });

    await this.#sendMessage({ host, port, user, pass, fromAddr, toList, ccList, message });
    return { sent: true, to: toList.join(', '), subject, attachments: normalizedAttachments.map(({ filename, mimeType, size }) => ({ filename, mimeType, size })) };
  }

  async sendRaw({ host, port, user, pass, from, to, cc, bcc, rawMessage }, creds) {
    from = sanitizeHeader(from);
    let fromAddr = from;
    if (creds?.smtp_from_email) {
      if (creds.smtp_from_name) {
        fromAddr = `${creds.smtp_from_name} <${creds.smtp_from_email}>`;
      } else {
        fromAddr = creds.smtp_from_email;
      }
      fromAddr = sanitizeHeader(fromAddr);
    }
    const toList = parseRecipients(to);
    const ccList = cc ? parseRecipients(cc) : [];
    const bccList = bcc ? parseRecipients(bcc) : [];
    await this.#sendMessage({ host, port, user, pass, fromAddr, toList, ccList: [...ccList, ...bccList], message: rawMessage });
    return { sent: true, to: toList.join(', ') };
  }

  async #sendMessage({ host, port, user, pass, fromAddr, toList, ccList, message }) {
    const isSmtps = port === 465;
    const socket = connect({ hostname: host, port }, { secureTransport: isSmtps ? 'on' : 'starttls' });
    // Use a state object so write/readLine closures see upgrades after STARTTLS
    const state = {
      reader: socket.readable.getReader(),
      writer: socket.writable.getWriter(),
      buf: new Uint8Array(0),
    };

    const write = (s) => state.writer.write(enc.encode(s));

    const readLine = async () => {
      while (true) {
        const nl = state.buf.indexOf(10);
        if (nl >= 0) {
          const line = dec.decode(state.buf.slice(0, nl + 1)).trimEnd();
          state.buf = state.buf.slice(nl + 1);
          return line;
        }
        const { done, value } = await state.reader.read();
        if (done) return dec.decode(state.buf).trim();
        const next = new Uint8Array(state.buf.length + value.length);
        next.set(state.buf); next.set(value, state.buf.length);
        state.buf = next;
      }
    };

    // Read a full multi-line SMTP response (handles 250-... continuations)
    const readResp = async () => {
      let last = '';
      while (true) {
        const line = await readLine();
        last = line;
        if (line.length < 4 || line[3] !== '-') break;
      }
      return last;
    };

    try {
      const banner = await readResp();
      if (!banner.startsWith('220')) throw new Error('Bad banner: ' + banner);

      await write('EHLO unthinkmail\r\n');
      await readResp();

      // STARTTLS upgrade for non-SMTPS ports
      if (!isSmtps) {
        await write('STARTTLS\r\n');
        const r = await readResp();
        if (!r.startsWith('220')) throw new Error('STARTTLS rejected: ' + r);
        // Release locks before upgrading
        state.reader.releaseLock();
        state.writer.releaseLock();
        const tls = socket.startTls();
        state.reader = tls.readable.getReader();
        state.writer = tls.writable.getWriter();
        state.buf = new Uint8Array(0);
        // Re-EHLO over TLS
        await write('EHLO unthinkmail\r\n');
        await readResp();
      }

      await write('AUTH LOGIN\r\n');
      await readResp(); // 334 Username:
      await write(b64utf8(user) + '\r\n');
      await readResp(); // 334 Password:
      await write(b64utf8(pass) + '\r\n');
      const authResp = await readResp();
      if (!authResp.startsWith('235')) throw new Error('Auth failed: ' + authResp);

      await write(`MAIL FROM:<${envelopeAddr(fromAddr)}>\r\n`);
      const fromResp = await readResp();
      if (!fromResp.startsWith('250')) throw new Error('MAIL FROM failed: ' + fromResp);

      const recipients = [...toList, ...ccList];
      for (const r of recipients) {
        await write(`RCPT TO:<${envelopeAddr(r)}>\r\n`);
        const rcptResp = await readResp();
        if (!rcptResp.startsWith('250')) throw new Error(`RCPT TO <${r}> failed: ` + rcptResp);
      }

      await write('DATA\r\n');
      const dataResp = await readResp();
      if (!dataResp.startsWith('354')) throw new Error('DATA failed: ' + dataResp);

      // Dot-stuff lines starting with "." per RFC 5321
      const stuffed = String(message)
        .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        .split('\n').map(l => l.startsWith('.') ? '.' + l : l).join('\r\n');

      await write(`${stuffed}\r\n.\r\n`);

      const sentResp = await readResp();
      if (!sentResp.startsWith('250')) throw new Error('Send failed: ' + sentResp);

      await write('QUIT\r\n');
    } finally {
      try { await state.writer.close(); } catch {}
      try { state.reader.cancel(); } catch {}
    }
  }
}
