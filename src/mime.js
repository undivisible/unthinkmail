// Minimal RFC 2822 / MIME parser
// parseMime(raw) → { from, to, subject, date, messageId, references, inReplyTo, body, hasHtml, attachments }

// Decode RFC 2047 encoded words: =?charset?B|Q?text?=
function decodeWords(s) {
  if (!s || !s.includes('=?')) return s || '';
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, text) => {
    try {
      let bytes;
      if (enc.toUpperCase() === 'B') {
        bytes = Uint8Array.from(atob(text), c => c.charCodeAt(0));
      } else {
        // Quoted-printable with _ → space; each decoded char is a raw byte value
        const qp = text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
        bytes = Uint8Array.from(qp, c => c.charCodeAt(0));
      }
      return new TextDecoder(charset).decode(bytes);
    } catch { return text; }
  });
}

// Unfold and parse a raw header block into a lowercase-keyed map (first occurrence wins)
function parseHeaders(raw) {
  const map = {};
  const unfolded = raw.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const val = line.slice(colon + 1).trim();
    if (!map[key]) map[key] = val;
  }
  return map;
}

// Split raw RFC 2822 / MIME entity at the first blank line
function splitHeaderBody(raw) {
  let pos = raw.indexOf('\r\n\r\n');
  if (pos >= 0) return [raw.slice(0, pos), raw.slice(pos + 4)];
  pos = raw.indexOf('\n\n');
  if (pos >= 0) return [raw.slice(0, pos), raw.slice(pos + 2)];
  return [raw, ''];
}

// Extract a named parameter from a Content-Type / Content-Disposition value
// e.g. ctParam('text/plain; charset="utf-8"', 'charset') → 'utf-8'
function ctParam(s, name) {
  if (!s) return null;
  const re = new RegExp(name + '\\s*=\\s*(?:"([^"]*)"|(\\S+?)(?:;|$))', 'i');
  const m = s.match(re);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

// Decode a MIME body according to Content-Transfer-Encoding
function decodeBody(body, cte, charset) {
  const enc = (cte || '7bit').toLowerCase().trim();
  try {
    if (enc === 'base64') {
      const bytes = Uint8Array.from(atob(body.replace(/\s/g, '')), c => c.charCodeAt(0));
      return new TextDecoder(charset || 'utf-8').decode(bytes);
    }
    if (enc === 'quoted-printable') {
      const s = body.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      const bytes = Uint8Array.from(s, c => c.charCodeAt(0));
      return new TextDecoder(charset || 'utf-8').decode(bytes);
    }
  } catch {}
  return body;
}

// Split a multipart body on --boundary delimiters, returning raw part strings
function splitParts(body, boundary) {
  const delim = '--' + boundary;
  const parts = [];
  let start = -1;
  let pos = 0;
  while (pos < body.length) {
    const idx = body.indexOf(delim, pos);
    if (idx < 0) break;
    const after = idx + delim.length;
    // Check for closing delimiter --boundary--
    const tail = body.slice(after, after + 2);
    if (tail === '--') {
      if (start >= 0) {
        let part = body.slice(start, idx);
        if (part.endsWith('\r\n')) part = part.slice(0, -2);
        else if (part.endsWith('\n')) part = part.slice(0, -1);
        parts.push(part);
      }
      break;
    }
    if (start >= 0) {
      // Strip the CRLF immediately before the boundary — it belongs to the
      // delimiter, not the part body (RFC 2046 §5.1.1)
      let part = body.slice(start, idx);
      if (part.endsWith('\r\n')) part = part.slice(0, -2);
      else if (part.endsWith('\n')) part = part.slice(0, -1);
      parts.push(part);
    }
    // Advance past the delimiter line
    const nl = body.indexOf('\n', after);
    start = nl >= 0 ? nl + 1 : after;
    pos = start;
  }
  if (start >= 0 && parts.length === 0) parts.push(body.slice(start));
  return parts;
}

// Minimally strip HTML tags to produce readable plain text
function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Recursively parse a MIME entity (headers + body), return { text, html, attachments }
function parsePart(raw) {
  const [headerRaw, bodyRaw] = splitHeaderBody(raw);
  const h = parseHeaders(headerRaw);
  const ct = h['content-type'] || 'text/plain';
  const mimeType = ct.split(';')[0].trim().toLowerCase();
  const cte = h['content-transfer-encoding'] || '';
  const charset = ctParam(ct, 'charset');
  const cd = h['content-disposition'] || '';

  if (mimeType.startsWith('multipart/')) {
    const boundary = ctParam(ct, 'boundary');
    if (!boundary) return { text: null, html: null, attachments: [] };
    const parts = splitParts(bodyRaw, boundary).map(parsePart);
    let text = null, html = null;
    const attachments = [];
    for (const p of parts) {
      if (p.text !== null && text === null) text = p.text;
      if (p.html !== null && html === null) html = p.html;
      attachments.push(...p.attachments);
    }
    return { text, html, attachments };
  }

  // Treat as attachment if: explicit attachment disposition, or non-text/non-multipart type
  const isAttachment = cd.toLowerCase().startsWith('attachment') ||
    (!mimeType.startsWith('text/') && !mimeType.startsWith('message/'));

  if (isAttachment) {
    const name = decodeWords(ctParam(cd, 'filename') || ctParam(ct, 'name') || mimeType.split('/')[1] || 'attachment');
    // Estimate decoded size (base64 is ~75% of raw, others ~1:1)
    const rawSize = bodyRaw.replace(/\s/g, '').length;
    const size = cte.toLowerCase().trim() === 'base64' ? Math.floor(rawSize * 0.75) : rawSize;
    return { text: null, html: null, attachments: [{ name, type: mimeType, size }] };
  }

  const decoded = decodeBody(bodyRaw, cte, charset);
  if (mimeType === 'text/html') return { text: null, html: decoded, attachments: [] };
  return { text: decoded, html: null, attachments: [] };
}

// Parse a complete RFC 2822 message
// Returns { from, to, subject, date, messageId, references, inReplyTo, body, hasHtml, attachments }
export function parseMime(raw) {
  const [headerRaw] = splitHeaderBody(raw);
  const h = parseHeaders(headerRaw);

  const from      = decodeWords(h['from'] || '');
  const to        = decodeWords(h['to'] || '');
  const subject   = decodeWords(h['subject'] || '');
  const date      = h['date'] || '';
  const messageId = h['message-id'] || '';
  const references  = h['references'] || '';
  const inReplyTo   = h['in-reply-to'] || '';

  const { text, html, attachments } = parsePart(raw);

  // Prefer text/plain; fall back to stripped HTML
  let body;
  if (text !== null) {
    body = text;
  } else if (html !== null) {
    body = stripHtml(html);
  } else {
    body = '';
  }

  return { from, to, subject, date, messageId, references, inReplyTo, body, hasHtml: html !== null, attachments };
}

// ---------------------------------------------------------------------------
// BODYSTRUCTURE parser
// ---------------------------------------------------------------------------
// parseBodyStructure(rawFetchResponse) → PartDescriptor[]
// where PartDescriptor = { partNum, type, subtype, encoding, size, filename, disp }
//
// Parses the raw IMAP FETCH response line(s) that contain a BODYSTRUCTURE
// parenthesised list and returns a flat array of leaf-part descriptors so
// callers can locate an attachment by filename and fetch it by part number.

function tokenizeBS(s) {
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    // skip whitespace
    if (s[i] === ' ' || s[i] === '\t' || s[i] === '\r' || s[i] === '\n') { i++; continue; }
    if (s[i] === '(') { tokens.push({ t: '(' }); i++; continue; }
    if (s[i] === ')') { tokens.push({ t: ')' }); i++; continue; }
    if (s[i] === '"') {
      let val = '';
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\') i++;
        val += s[i++];
      }
      i++; // closing "
      tokens.push({ t: 'str', v: val });
      continue;
    }
    // atom (NIL, numbers, encoding names, etc.)
    let val = '';
    while (i < s.length && s[i] !== '(' && s[i] !== ')' && s[i] !== '"' && s[i] !== ' ' && s[i] !== '\t' && s[i] !== '\r' && s[i] !== '\n') {
      val += s[i++];
    }
    tokens.push({ t: 'atom', v: val.toUpperCase() === 'NIL' ? null : val });
  }
  return tokens;
}

function parseBSList(tokens, pos) {
  // tokens[pos] must be '('
  pos++; // consume '('
  const items = [];
  while (pos < tokens.length && tokens[pos].t !== ')') {
    if (tokens[pos].t === '(') {
      const [sub, next] = parseBSList(tokens, pos);
      items.push(sub);
      pos = next;
    } else {
      items.push(tokens[pos].v ?? null);
      pos++;
    }
  }
  pos++; // consume ')'
  return [items, pos];
}

function pairsToMap(arr) {
  const m = {};
  if (!Array.isArray(arr)) return m;
  for (let i = 0; i + 1 < arr.length; i += 2) {
    if (arr[i] != null) m[String(arr[i]).toLowerCase()] = arr[i + 1] ?? '';
  }
  return m;
}

function walkBS(node, partNum) {
  // Multipart: first element is an array (a nested body part)
  if (Array.isArray(node[0])) {
    const results = [];
    let childIdx = 1;
    for (let i = 0; i < node.length; i++) {
      if (!Array.isArray(node[i])) break;
      const childNum = partNum ? `${partNum}.${childIdx}` : String(childIdx);
      results.push(...walkBS(node[i], childNum));
      childIdx++;
    }
    return results;
  }

  // Leaf part
  const type    = (node[0] || 'application').toLowerCase();
  const subtype = (node[1] || 'octet-stream').toLowerCase();
  const params  = pairsToMap(node[2]);
  const encoding = (node[5] || '7bit').toLowerCase();
  const size    = parseInt(node[6]) || 0;

  // Disposition is node[8]: either null/string or ["attachment", ["filename","foo"]]
  let disp = null;
  let filename = null;
  const dispNode = node[8];
  if (Array.isArray(dispNode)) {
    disp = (dispNode[0] || '').toLowerCase();
    const dispParams = pairsToMap(dispNode[1]);
    filename = dispParams['filename'] || dispParams['filename*'] || null;
  }

  // Fall back to name in content-type params
  if (!filename) filename = params['name'] || params['name*'] || null;

  // Decode RFC 2047 encoded-word filenames
  if (filename) filename = decodeWords(filename);

  return [{ partNum: partNum || '1', type, subtype, encoding, size, filename, disp }];
}

export function parseBodyStructure(rawFetchResponse) {
  // Extract the BODYSTRUCTURE (...) section from the raw IMAP response
  const m = rawFetchResponse.match(/BODYSTRUCTURE\s+(\([\s\S]*)/i);
  if (!m) return [];
  const tokens = tokenizeBS(m[1]);
  if (!tokens.length || tokens[0].t !== '(') return [];
  const [tree] = parseBSList(tokens, 0);
  return walkBS(tree, '');
}

// ---------------------------------------------------------------------------
// Raw body decoder (returns Uint8Array — for attachment download)
// ---------------------------------------------------------------------------
// Unlike decodeBody() which returns a decoded string for display, this returns
// raw bytes so the caller can re-encode as base64 for transport.

export function decodeBodyRaw(body, cte) {
  const encoding = (cte || '7bit').toLowerCase().trim();
  if (encoding === 'base64') {
    return Uint8Array.from(atob(body.replace(/\s/g, '')), c => c.charCodeAt(0));
  }
  if (encoding === 'quoted-printable') {
    const s = body
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return Uint8Array.from(s, c => c.charCodeAt(0));
  }
  // 7bit / 8bit — treat as latin-1 bytes
  return Uint8Array.from(body, c => c.charCodeAt(0));
}
