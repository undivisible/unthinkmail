export const MAX_ATTACHMENTS = 25;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const sanitizeHeader = (s) => String(s).replace(/[\r\n]/g, '').trim();

const parseRecipients = (value) => {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',');
  return raw.map(sanitizeHeader).filter(Boolean);
};

const base64ToBytes = (s) => Uint8Array.from(atob(String(s).replace(/\s/g, '')), c => c.charCodeAt(0));

const textToBytes = (s) => new TextEncoder().encode(String(s));

const bytesToBase64 = (bytes) => {
  let s = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(s);
};

const foldBase64 = (s) => String(s).replace(/.{1,76}/g, '$&\r\n').trimEnd();

const asciiFilename = (s) => {
  const value = sanitizeHeader(s)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/[\\/"]/g, '_')
    .replace(/[\x00-\x1f\x7f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return value || 'attachment';
};

const sanitizeMimeType = (s) => {
  const value = sanitizeHeader(s || 'application/octet-stream').toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(value) ? value : 'application/octet-stream';
};

export function normalizeAttachments(attachments) {
  if (attachments == null) return [];
  if (!Array.isArray(attachments)) throw new Error('attachments must be an array');
  if (attachments.length > MAX_ATTACHMENTS) throw new Error(`Maximum ${MAX_ATTACHMENTS} attachments per email`);
  let total = 0;
  return attachments.map((attachment, i) => {
    if (!attachment || typeof attachment !== 'object') throw new Error(`Invalid attachment at index ${i}`);
    const originalFilename = sanitizeHeader(attachment.filename || attachment.name || '');
    if (!originalFilename) throw new Error(`Attachment at index ${i} is missing filename`);
    const filename = asciiFilename(originalFilename);
    let bytes;
    let mimeType = attachment.mimeType || attachment.type;
    const dataUrl = attachment.contentDataUrl || attachment.dataUrl;
    if (dataUrl) {
      const m = String(dataUrl).match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/is);
      if (!m) throw new Error(`Attachment "${filename}" data URL must be base64`);
      if (!mimeType && m[1]) mimeType = m[1];
      try {
        bytes = base64ToBytes(m[2]);
      } catch {
        throw new Error(`Attachment "${filename}" data URL must contain valid base64`);
      }
    } else if (attachment.contentText != null || attachment.text != null) {
      bytes = textToBytes(attachment.contentText ?? attachment.text);
      if (!mimeType) mimeType = 'text/plain';
    } else if (attachment.contentBytes instanceof Uint8Array || attachment.bytes instanceof Uint8Array) {
      bytes = attachment.contentBytes ?? attachment.bytes;
    } else if (Array.isArray(attachment.contentBytes) || Array.isArray(attachment.bytes)) {
      const values = attachment.contentBytes ?? attachment.bytes;
      if (!values.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) {
        throw new Error(`Attachment "${filename}" byte content must be integers from 0 to 255`);
      }
      bytes = Uint8Array.from(values);
    } else {
      const content = String(attachment.contentBase64 ?? attachment.base64 ?? attachment.content ?? '').replace(/\s/g, '');
      if (!content) throw new Error(`Attachment "${filename}" is missing content`);
      try {
        bytes = base64ToBytes(content);
      } catch {
        throw new Error(`Attachment "${filename}" content must be valid base64`);
      }
    }
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment "${filename}" exceeds 10MB limit`);
    total += bytes.length;
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error('Total attachment size exceeds 20MB limit');
    return {
      filename,
      originalFilename,
      mimeType: sanitizeMimeType(mimeType),
      contentId: attachment.contentId ? asciiFilename(attachment.contentId) : null,
      disposition: attachment.inline || attachment.disposition === 'inline' ? 'inline' : 'attachment',
      base64: foldBase64(bytesToBase64(bytes)),
      size: bytes.length,
    };
  });
}

const htmlToText = (html) => String(html)
  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const partText = (body) => `Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${body}`;

const partHtml = (htmlBody) => `Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${htmlBody}`;

const partAlternative = (body, htmlBody) => {
  const boundary = `unthinkmail-alt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n` +
    `--${boundary}\r\n${partText(body)}\r\n` +
    `--${boundary}\r\n${partHtml(htmlBody)}\r\n` +
    `--${boundary}--`;
};

const bodyPart = (body, htmlBody) => {
  const safeBody = String(body ?? '');
  const safeHtml = htmlBody == null ? '' : String(htmlBody);
  if (safeHtml) return partAlternative(safeBody || htmlToText(safeHtml), safeHtml);
  return partText(safeBody);
};

const attachmentPart = (attachment) => {
  const contentId = attachment.contentId ? `Content-ID: <${attachment.contentId}>\r\n` : '';
  return `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"\r\n` +
    `Content-Disposition: ${attachment.disposition}; filename="${attachment.filename}"\r\n${contentId}` +
    `Content-Transfer-Encoding: base64\r\n\r\n${attachment.base64}`;
};

const relatedPart = (body, htmlBody, inlineAttachments) => {
  const boundary = `unthinkmail-related-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `Content-Type: multipart/related; boundary="${boundary}"\r\n\r\n` +
    `--${boundary}\r\n${bodyPart(body, htmlBody)}\r\n` +
    inlineAttachments.map(attachment => `--${boundary}\r\n${attachmentPart(attachment)}\r\n`).join('') +
    `--${boundary}--`;
};

export function buildMimeMessage({ from, to, subject, body, htmlBody, cc, extraHeaders = {}, replyTo, attachments, normalizedAttachments }) {
  const toList = parseRecipients(to);
  const ccList = cc ? parseRecipients(cc) : [];
  const safeFrom = sanitizeHeader(from);
  const safeSubject = sanitizeHeader(subject);
  const attachmentList = normalizedAttachments ?? normalizeAttachments(attachments);
  const inlineAttachments = htmlBody != null ? attachmentList.filter(a => a.disposition === 'inline' && a.contentId) : [];
  const fileAttachments = attachmentList.filter(a => !(htmlBody != null && a.disposition === 'inline' && a.contentId));
  const toHeader = toList.join(', ');
  const ccHeader = ccList.length ? `Cc: ${ccList.join(', ')}\r\n` : '';
  const extraLines = Object.entries(extraHeaders)
    .filter(([, v]) => v)
    .map(([k, v]) => `${sanitizeHeader(k)}: ${sanitizeHeader(v)}\r\n`)
    .join('');
  const replyToHeader = replyTo ? `Reply-To: ${sanitizeHeader(replyTo)}\r\n` : '';

  if (attachmentList.length === 0 && htmlBody == null) {
    return `From: ${safeFrom}\r\nTo: ${toHeader}\r\n${ccHeader}` +
      `Subject: ${safeSubject}\r\n${replyToHeader}${extraLines}` +
      `MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n` +
      String(body ?? '');
  }

  let content = inlineAttachments.length
    ? relatedPart(body, htmlBody, inlineAttachments)
    : bodyPart(body, htmlBody);

  if (fileAttachments.length) {
    const boundary = `unthinkmail-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    content = `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
      `--${boundary}\r\n${content}\r\n` +
      fileAttachments.map(attachment => `--${boundary}\r\n${attachmentPart(attachment)}\r\n`).join('') +
      `--${boundary}--`;
  }

  return `From: ${safeFrom}\r\nTo: ${toHeader}\r\n${ccHeader}` +
    `Subject: ${safeSubject}\r\n${replyToHeader}${extraLines}` +
    `MIME-Version: 1.0\r\n${content}`;
}
