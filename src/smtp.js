// SMTP client using Cloudflare TCP Sockets
// Connects to SMTPS (port 465, TLS from start) and sends email

import { connect } from 'cloudflare:sockets';

const enc = new TextEncoder();
const dec = new TextDecoder();

export class SmtpClient {
  async send({ host, port, user, pass, from, to, subject, body, cc }) {
    const socket = connect({ hostname: host, port }, { secureTransport: 'on' });
    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();
    let buf = new Uint8Array(0);

    const write = (s) => writer.write(enc.encode(s));

    const readLine = async () => {
      while (true) {
        const nl = buf.indexOf(10);
        if (nl >= 0) {
          const line = dec.decode(buf.slice(0, nl + 1)).trimEnd();
          buf = buf.slice(nl + 1);
          return line;
        }
        const { done, value } = await reader.read();
        if (done) return dec.decode(buf).trim();
        const next = new Uint8Array(buf.length + value.length);
        next.set(buf); next.set(value, buf.length);
        buf = next;
      }
    };

    // Read multi-line SMTP response (250-... continues, 250 ... ends)
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

      await write('AUTH LOGIN\r\n');
      await readResp(); // 334 Username:
      await write(btoa(user) + '\r\n');
      await readResp(); // 334 Password:
      await write(btoa(pass) + '\r\n');
      const authResp = await readResp();
      if (!authResp.startsWith('235')) throw new Error('Auth failed: ' + authResp);

      await write(`MAIL FROM:<${from}>\r\n`);
      const fromResp = await readResp();
      if (!fromResp.startsWith('250')) throw new Error('MAIL FROM failed: ' + fromResp);

      const recipients = [to, ...(Array.isArray(cc) ? cc : cc ? [cc] : [])].filter(Boolean);
      for (const r of recipients) {
        await write(`RCPT TO:<${r}>\r\n`);
        const rcptResp = await readResp();
        if (!rcptResp.startsWith('250')) throw new Error(`RCPT TO <${r}> failed: ` + rcptResp);
      }

      await write('DATA\r\n');
      const dataResp = await readResp();
      if (!dataResp.startsWith('354')) throw new Error('DATA failed: ' + dataResp);

      const ccHeader = recipients.length > 1 ? `Cc: ${recipients.slice(1).join(', ')}\r\n` : '';
      // Dot-stuff lines starting with "." per RFC 5321
      const stuffed = body
        .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        .split('\n').map(l => l.startsWith('.') ? '.' + l : l).join('\r\n');

      await write(
        `From: ${from}\r\nTo: ${to}\r\n${ccHeader}` +
        `Subject: ${subject}\r\nMIME-Version: 1.0\r\n` +
        `Content-Type: text/plain; charset=utf-8\r\n\r\n` +
        `${stuffed}\r\n.\r\n`
      );

      const sentResp = await readResp();
      if (!sentResp.startsWith('250')) throw new Error('Send failed: ' + sentResp);

      await write('QUIT\r\n');
      return { sent: true, to, subject };
    } finally {
      try { await writer.close(); } catch {}
      try { reader.cancel(); } catch {}
    }
  }
}
