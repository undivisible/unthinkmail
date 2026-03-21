// Cryptographic utilities — self-contained credential keys
// A um_ key is base64url(JSON credentials) — no server secret needed.

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlDecode = (s) => {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return Uint8Array.from(atob(b), c => c.charCodeAt(0));
};

const enc = new TextEncoder();
const dec = new TextDecoder();

// Encode credentials into a self-contained um_ key
export async function encodeKey(creds) {
  const plain = enc.encode(JSON.stringify(creds));
  return 'um_' + b64url(plain.buffer);
}

// Decode a um_ key back into credentials
export async function decodeKey(token) {
  if (!token.startsWith('um_')) throw new Error('Invalid key format');
  const buf = b64urlDecode(token.slice(3));
  return JSON.parse(dec.decode(buf));
}

// SHA-256 hex of credentials JSON — used as stable Durable Object ID
// v2: forces new DO instances (fixes stale IMAP code)
export async function credHash(creds) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode('v2:' + JSON.stringify(creds)));
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
}
