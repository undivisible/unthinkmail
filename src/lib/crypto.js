// Cryptographic utilities — self-contained credential keys.
// New keys are AES-GCM encrypted when OAUTH_SECRET is configured. Legacy
// um_ keys are still accepted so existing clients keep working.

const TOKEN_PREFIX = 'um_';
const ENCRYPTED_TOKEN_PREFIX = 'um2_';
const MIN_SECRET_LENGTH = 32;

function bytesToBinary(bytes) {
  let out = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return out;
}

const b64url = (buf) =>
  btoa(bytesToBinary(new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const b64urlDecode = (s) => {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
};

const enc = new TextEncoder();
const dec = new TextDecoder();

function usableSecret(secret) {
  const value = String(secret ?? '').trim();
  return value.length >= MIN_SECRET_LENGTH ? value : null;
}

async function aesKey(secret) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`unthinkmail-key-v1:${secret}`));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// Encode credentials into a self-contained key.
export async function encodeKey(creds, secret) {
  const plain = enc.encode(JSON.stringify(creds));
  const keySecret = usableSecret(secret);
  if (!keySecret) throw new Error('OAUTH_SECRET must be at least 32 characters');

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keySecret), plain);
  return `${ENCRYPTED_TOKEN_PREFIX}${b64url(iv)}.${b64url(cipher)}`;
}

// Decode a key back into credentials.
export async function decodeKey(token, secret) {
  if (token.startsWith(ENCRYPTED_TOKEN_PREFIX)) {
    const keySecret = usableSecret(secret);
    if (!keySecret) throw new Error('Encrypted keys require OAUTH_SECRET');

    const parts = token.slice(ENCRYPTED_TOKEN_PREFIX.length).split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('Invalid encrypted key format');

    const iv = b64urlDecode(parts[0]);
    const cipher = b64urlDecode(parts[1]);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await aesKey(keySecret), cipher);
    return JSON.parse(dec.decode(plain));
  }

  if (!token.startsWith(TOKEN_PREFIX)) throw new Error('Invalid key format');
  const buf = b64urlDecode(token.slice(3));
  return JSON.parse(dec.decode(buf));
}

// SHA-256 hex of credentials JSON — used as stable Durable Object ID
// v2: forces new DO instances (fixes stale IMAP code)
export async function credHash(creds) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode('v2:' + JSON.stringify(creds)));
  return Array.from(new Uint8Array(h))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
