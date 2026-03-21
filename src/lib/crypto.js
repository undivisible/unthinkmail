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

export async function hashApiKey(rawKey) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey));
  return arrayBufferToHex(hash);
}

export function generateApiKey() {
  return 'pm_' + arrayBufferToHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
}

export async function deriveEncryptionKey(masterKeyBase64, userId) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new Uint8Array(base64ToArrayBuffer(masterKeyBase64)), 'HKDF', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode(userId) },
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
      { name: 'AES-GCM', iv }, key, encoder.encode(String(value))
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
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, key, base64ToArrayBuffer(value)
    );
    decrypted[field.replace(/_enc$/, '')] = decoder.decode(plaintext);
  }
  return decrypted;
}
