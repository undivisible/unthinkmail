// Cryptographic utilities using Web Crypto API only

const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AES_KEY_LENGTH = 256;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateId() {
  return crypto.randomUUID();
}

export async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return arrayBufferToBase64(salt) + ':' + arrayBufferToBase64(hash);
}

export async function verifyPassword(password, stored) {
  const [saltB64, hashB64] = stored.split(':');
  const salt = new Uint8Array(base64ToArrayBuffer(saltB64));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const computed = arrayBufferToBase64(hash);
  // Constant-time comparison
  if (computed.length !== hashB64.length) return false;
  let result = 0;
  for (let i = 0; i < computed.length; i++) {
    result |= computed.charCodeAt(i) ^ hashB64.charCodeAt(i);
  }
  return result === 0;
}

export async function hashApiKey(rawKey) {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(rawKey));
  return arrayBufferToHex(hash);
}

export function generateApiKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return 'pm_' + arrayBufferToHex(bytes.buffer);
}

export async function deriveEncryptionKey(masterKeyBase64, userId) {
  const masterKeyBytes = new Uint8Array(base64ToArrayBuffer(masterKeyBase64));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    masterKeyBytes,
    'HKDF',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: encoder.encode(userId) },
    keyMaterial,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptCredentials(masterKeyBase64, userId, credentialsObj) {
  const key = await deriveEncryptionKey(masterKeyBase64, userId);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoder = new TextEncoder();
  const encrypted = {};
  for (const [field, value] of Object.entries(credentialsObj)) {
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(String(value))
    );
    encrypted[field + '_enc'] = arrayBufferToBase64(ciphertext);
  }
  encrypted.iv = arrayBufferToBase64(iv.buffer);
  return encrypted;
}

export async function decryptCredentials(masterKeyBase64, userId, encryptedObj) {
  const key = await deriveEncryptionKey(masterKeyBase64, userId);
  const iv = new Uint8Array(base64ToArrayBuffer(encryptedObj.iv));
  const decoder = new TextDecoder();
  const decrypted = {};
  for (const [field, value] of Object.entries(encryptedObj)) {
    if (field === 'iv' || field === 'id' || field === 'user_id' || field === 'created_at') continue;
    const plainName = field.replace(/_enc$/, '');
    const ciphertext = base64ToArrayBuffer(value);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    decrypted[plainName] = decoder.decode(plaintext);
  }
  return decrypted;
}
