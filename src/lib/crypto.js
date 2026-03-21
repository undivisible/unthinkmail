// Cryptographic utilities — self-contained credential keys
// A pm_ key IS the encrypted credentials. No database needed.

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

// Derive an AES-256-GCM key from the raw MASTER_ENCRYPTION_KEY string
async function aesKey(masterKeyRaw) {
  const raw = enc.encode(masterKeyRaw);
  const keyMaterial = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('unthinkmail-v1') },
    keyMaterial,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

// Deterministic IV: HMAC-SHA256(masterKey, plaintext)[0:12]
// Same credentials → same IV → same key every time
async function deterministicIv(masterKeyRaw, plaintext) {
  const hmacKey = await crypto.subtle.importKey(
    'raw', enc.encode(masterKeyRaw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', hmacKey, plaintext);
  return new Uint8Array(sig).slice(0, 12);
}

// Encode credentials into a self-contained pm_ key
export async function encodeKey(creds, masterKeyRaw) {
  const plain = enc.encode(JSON.stringify(creds));
  const key = await aesKey(masterKeyRaw);
  const iv = await deterministicIv(masterKeyRaw, plain);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  const buf = new Uint8Array(12 + ct.byteLength);
  buf.set(iv, 0);
  buf.set(new Uint8Array(ct), 12);
  return 'pm_' + b64url(buf.buffer);
}

// Decode a pm_ key back into credentials
export async function decodeKey(token, masterKeyRaw) {
  if (!token.startsWith('pm_')) throw new Error('Invalid key format');
  const buf = b64urlDecode(token.slice(3));
  if (buf.length < 29) throw new Error('Key too short'); // 12 iv + 16 tag + 1 data min
  const iv = buf.slice(0, 12);
  const ct = buf.slice(12);
  const key = await aesKey(masterKeyRaw);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  } catch {
    throw new Error('Invalid key');
  }
  return JSON.parse(dec.decode(plain));
}

// SHA-256 hex of credentials JSON — used as stable Durable Object ID
export async function credHash(creds) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(JSON.stringify(creds)));
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
}
