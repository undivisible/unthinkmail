// SMTP client using cloudflare:sockets (TCP + TLS)
// Supports SMTPS (port 465, TLS from start) and STARTTLS (port 587)
import { connect } from 'cloudflare:sockets';

class SmtpStream {
  constructor(readable) {
    this.reader = readable.getReader();
    this.dec = new TextDecoder();
    this.buf = '';
  }

  async readLine() {
    while (true) {
      const nl = this.buf.indexOf('\n');
      if (nl !== -1) {
        const line = this.buf.slice(0, nl).trimEnd();
        this.buf = this.buf.slice(nl + 1);
        return line;
      }
      const { value, done } = await this.reader.read();
      if (done) throw new Error('SMTP: connection closed unexpectedly');
      this.buf += this.dec.decode(value, { stream: true });
    }
  }

  // Read a full SMTP response (handles multi-line like 250-...\r\n250 ...)
  async readResp() {
    let code = '';
    let text = [];
    while (true) {
      const line = await this.readLine();
      code = line.slice(0, 3);
      text.push(line.slice(4));
      if (line[3] === ' ' || line.length < 4) break;
    }
    return { code, text };
  }
}

export async function sendOtpEmail({ smtpUser, smtpPass, smtpHost, smtpPort, to, code }) {
  const host = smtpHost || 'smtp.purelymail.com';
  const port = parseInt(smtpPort || '465');
  const startTls = port === 587;

  const socket = connect(`${host}:${port}`, {
    secureTransport: startTls ? 'off' : 'on',
  });

  let stream = new SmtpStream(socket.readable);
  let writer = socket.writable.getWriter();
  const enc = new TextEncoder();

  const write = async (line) => writer.write(enc.encode(line + '\r\n'));

  const expect = async (code) => {
    const resp = await stream.readResp();
    if (resp.code !== code) throw new Error(`SMTP expected ${code}, got ${resp.code}: ${resp.text.join(' ')}`);
    return resp;
  };

  try {
    await expect('220'); // greeting

    await write('EHLO unthinkmail');
    await expect('250');

    if (startTls) {
      await write('STARTTLS');
      await expect('220');
      const tlsSock = socket.startTls();
      stream = new SmtpStream(tlsSock.readable);
      writer = tlsSock.writable.getWriter();
      await write('EHLO unthinkmail');
      await expect('250');
    }

    // AUTH LOGIN
    await write('AUTH LOGIN');
    await expect('334');
    await write(btoa(smtpUser));
    await expect('334');
    await write(btoa(smtpPass));
    await expect('235');

    // Envelope
    await write(`MAIL FROM:<${smtpUser}>`);
    await expect('250');
    await write(`RCPT TO:<${to}>`);
    await expect('250');

    // Message
    await write('DATA');
    await expect('354');

    const subject = `${code} is your unthinkmail code`;
    const body = [
      `From: unthinkmail <${smtpUser}>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      `Your login code: ${code}`,
      '',
      'Valid for 10 minutes. If you didn\'t request this, ignore it.',
    ];

    for (const line of body) {
      await write(line.startsWith('.') ? '.' + line : line);
    }

    await write('.');
    await expect('250');

    await write('QUIT');
  } finally {
    await socket.close().catch(() => {});
  }
}
