// Authentication middleware using Web Crypto API for JWT (HS256)

import { hashApiKey } from './crypto.js';
import { getApiKeyByHash } from './db.js';

function base64urlEncode(data) {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(data)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function textToBase64url(text) {
  const encoder = new TextEncoder();
  return base64urlEncode(encoder.encode(text));
}

async function getHmacKey(secret) {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function createJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + 3600 };
  const headerB64 = textToBase64url(JSON.stringify(header));
  const payloadB64 = textToBase64url(JSON.stringify(fullPayload));
  const signingInput = headerB64 + '.' + payloadB64;
  const key = await getHmacKey(secret);
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
  return signingInput + '.' + base64urlEncode(signature);
}

export async function verifyJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  const [headerB64, payloadB64, signatureB64] = parts;
  const signingInput = headerB64 + '.' + payloadB64;
  const key = await getHmacKey(secret);
  const encoder = new TextEncoder();
  const signatureBytes = base64urlDecode(signatureB64);
  const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(signingInput));
  if (!valid) throw new Error('Invalid signature');
  const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }
  return payload;
}

export async function authenticateJwt(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header');
  }
  const token = authHeader.slice(7);
  const payload = await verifyJwt(token, env.JWT_SECRET);
  return { userId: payload.sub, email: payload.email };
}

export async function authenticateApiKey(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer pm_')) {
    throw new Error('Missing or invalid API key');
  }
  const rawKey = authHeader.slice(7);
  const keyHash = await hashApiKey(rawKey);
  const record = await getApiKeyByHash(env.DB, keyHash);
  if (!record) {
    throw new Error('Invalid API key');
  }
  return { userId: record.user_id, email: record.email };
}
