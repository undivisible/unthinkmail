import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, MAX_TOTAL_ATTACHMENT_BYTES } from './outbound-mime.js';

const headerStr = (s) =>
  String(s ?? '')
    .replace(/[\r\n]/g, '')
    .trim();

const filenameFromDisposition = (value) => {
  const s = String(value || '');
  const star = s.match(/filename\*\s*=\s*(?:UTF-8''|)([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {}
  }
  const quoted = s.match(/filename\s*=\s*"([^"]+)"/i);
  if (quoted) return quoted[1];
  const bare = s.match(/filename\s*=\s*([^;]+)/i);
  return bare ? bare[1].trim() : '';
};

const filenameFromUrl = (url) => {
  const name = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
  return name || 'attachment';
};

const privateHost = (hostname) => {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '[::1]') return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

const readBytes = async (response, maxBytes) => {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error(`Attachment exceeds ${maxBytes / (1024 * 1024)}MB limit`);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) throw new Error(`Attachment exceeds ${maxBytes / (1024 * 1024)}MB limit`);
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
};

export async function fetchUrlAttachments(urlAttachments, fetcher = fetch) {
  if (!Array.isArray(urlAttachments) || urlAttachments.length === 0) return [];
  if (urlAttachments.length > MAX_ATTACHMENTS) throw new Error(`Maximum ${MAX_ATTACHMENTS} URL attachments per email`);
  const attachments = [];
  let total = 0;
  for (const item of urlAttachments) {
    const source = typeof item === 'string' ? { url: item } : item;
    if (!source || typeof source !== 'object') throw new Error('URL attachment must be a URL string or object');
    const url = new URL(String(source.url || ''));
    if (url.protocol !== 'https:') throw new Error(`Attachment URL must use https: ${url.href}`);
    if (privateHost(url.hostname)) throw new Error(`Attachment URL host is not allowed: ${url.hostname}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetcher(url.href, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`Attachment fetch failed ${response.status}: ${url.href}`);
    if (response.url) {
      const finalUrl = new URL(response.url);
      if (finalUrl.protocol !== 'https:') throw new Error(`Attachment redirect must stay on https: ${url.href}`);
      if (privateHost(finalUrl.hostname)) throw new Error(`Attachment redirect host is not allowed: ${finalUrl.hostname}`);
    }
    const length = parseInt(response.headers.get('content-length') || '0', 10);
    if (length > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment exceeds ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB limit: ${url.href}`);
    if (length && total + length > MAX_TOTAL_ATTACHMENT_BYTES)
      throw new Error(`Total attachment size exceeds ${MAX_TOTAL_ATTACHMENT_BYTES / (1024 * 1024)}MB limit`);
    const bytes = await readBytes(response, MAX_ATTACHMENT_BYTES);
    total += bytes.length;
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error(`Total attachment size exceeds ${MAX_TOTAL_ATTACHMENT_BYTES / (1024 * 1024)}MB limit`);
    attachments.push({
      filename: headerStr(source.filename) || filenameFromDisposition(response.headers.get('content-disposition')) || filenameFromUrl(url),
      mimeType:
        headerStr(source.mimeType || source.type) || headerStr((response.headers.get('content-type') || '').split(';')[0]) || 'application/octet-stream',
      bytes,
      contentId: source.contentId,
      inline: source.inline,
    });
  }
  return attachments;
}
