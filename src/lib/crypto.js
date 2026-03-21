// Cryptographic utilities using Web Crypto API

const IV_LENGTH = 12;
const AES_KEY_LENGTH = 256;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function arrayBufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateId() {
  return crypto.randomUUID();
}

// --- OTP ---

export function generateOtpCode() {
  // 6-digit numeric code
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, '0');
}

export async function hashOtpCode(code) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return arrayBufferToHex(hash);
}

// --- API keys ---

export async function hashApiKey(rawKey) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey));
  return arrayBufferToHex(hash);
}

export function generateApiKey() {
  return 'pm_' + arrayBufferToHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
}

// --- JWT (HS256) ---

const BASE64URL = (buf) => {
  const b = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const textToBase64url = (s) => BASE64URL(new TextEncoder().encode(s));

const base64urlDecode = (s) => {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  const bin = atob(b);
  return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
};

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

export async function createJwt(payload, secret) {
  const now = Math.floor(Date.now() / 1000);
  const full = { ...payload, iat: now, exp: now + 604800 }; // 7 days
  const header = textToBase64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = textToBase64url(JSON.stringify(full));
  const input = header + '.' + body;
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
  return input + '.' + BASE64URL(sig);
}

export async function verifyJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const [h, b, s] = parts;
  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify('HMAC', key, base64urlDecode(s), new TextEncoder().encode(h + '.' + b));
  if (!valid) throw new Error('Invalid signature');
  const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(b)));
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  return payload;
}

// --- Credential encryption (AES-256-GCM + HKDF) ---

export async function deriveEncryptionKey(masterKeyBase64, userId) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new Uint8Array(base64ToArrayBuffer(masterKeyBase64)), 'HKDF', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode(userId) },
    keyMaterial,
    { name: 'AES-GCM', length: AES_KEY_LENGTH }, false, ['encrypt', 'decrypt']
  );
}

export async function encryptCredentials(masterKeyBase64, userId, credentialsObj) {
  const key = await deriveEncryptionKey(masterKeyBase64, userId);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const enc = new TextEncoder();
  const encrypted = {};
  for (const [field, value] of Object.entries(credentialsObj)) {
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(String(value)));
    encrypted[field + '_enc'] = arrayBufferToBase64(ct);
  }
  encrypted.iv = arrayBufferToBase64(iv.buffer);
  return encrypted;
}

export async function decryptCredentials(masterKeyBase64, userId, encryptedObj) {
  const key = await deriveEncryptionKey(masterKeyBase64, userId);
  const iv = new Uint8Array(base64ToArrayBuffer(encryptedObj.iv));
  const dec = new TextDecoder();
  const decrypted = {};
  for (const [field, value] of Object.entries(encryptedObj)) {
    if (['iv', 'id', 'user_id', 'created_at'].includes(field)) continue;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToArrayBuffer(value));
    decrypted[field.replace(/_enc$/, '')] = dec.decode(pt);
  }
  return decrypted;
}
