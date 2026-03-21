// D1 database query helpers

import { generateId } from './crypto.js';

// --- Users ---

export async function createUser(db, email) {
  const id = generateId();
  await db.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(id, email).run();
  return { id, email };
}

export async function getUserByEmail(db, email) {
  return db.prepare('SELECT id, email, created_at FROM users WHERE email = ?').bind(email).first();
}

// --- OTPs ---

export async function createOtp(db, email, codeHash, expiresAt) {
  const id = generateId();
  await db.prepare(
    'INSERT INTO otps (id, email, code_hash, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(id, email, codeHash, expiresAt).run();
  return id;
}

export async function getRecentOtp(db, email, sinceEpoch) {
  return db.prepare(
    'SELECT id FROM otps WHERE email = ? AND created_at >= datetime(?, \'unixepoch\') AND used = 0 ORDER BY created_at DESC LIMIT 1'
  ).bind(email, sinceEpoch).first();
}

// Count recent failed verify attempts for an email (to rate-limit brute force)
export async function countRecentFailedVerifies(db, email, sinceEpoch) {
  const row = await db.prepare(
    'SELECT COUNT(*) as n FROM otp_attempts WHERE email = ? AND attempted_at >= ? AND succeeded = 0'
  ).bind(email, sinceEpoch).first();
  return row?.n ?? 0;
}

export async function recordOtpAttempt(db, email, succeeded) {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    'INSERT INTO otp_attempts (id, email, attempted_at, succeeded) VALUES (?, ?, ?, ?)'
  ).bind(id, email, now, succeeded ? 1 : 0).run();
}

export async function verifyOtp(db, email, codeHash) {
  const now = Math.floor(Date.now() / 1000);
  const row = await db.prepare(
    'SELECT id FROM otps WHERE email = ? AND code_hash = ? AND expires_at > ? AND used = 0 LIMIT 1'
  ).bind(email, codeHash, now).first();
  if (!row) return false;
  await db.prepare('UPDATE otps SET used = 1 WHERE id = ?').bind(row.id).run();
  return true;
}

export async function cleanExpiredOtps(db) {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare('DELETE FROM otps WHERE expires_at < ? OR used = 1').bind(now - 3600).run();
}

// --- API keys ---

export async function createApiKey(db, userId, keyHash, keyPrefix, label) {
  const id = generateId();
  await db.prepare(
    'INSERT INTO api_keys (id, user_id, key_hash, key_prefix, label) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, userId, keyHash, keyPrefix, label || null).run();
  return { id, key_prefix: keyPrefix, label };
}

export async function getApiKeyByHash(db, keyHash) {
  return db.prepare(
    'SELECT api_keys.id, api_keys.user_id, users.email FROM api_keys JOIN users ON api_keys.user_id = users.id WHERE api_keys.key_hash = ?'
  ).bind(keyHash).first();
}

export async function listApiKeys(db, userId) {
  const { results } = await db.prepare(
    'SELECT id, key_prefix, label, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(userId).all();
  return results;
}

export async function deleteApiKey(db, id, userId) {
  const result = await db.prepare(
    'DELETE FROM api_keys WHERE id = ? AND user_id = ?'
  ).bind(id, userId).run();
  return result.meta.changes > 0;
}

export async function deleteAllApiKeys(db, userId) {
  const result = await db.prepare('DELETE FROM api_keys WHERE user_id = ?').bind(userId).run();
  return result.meta.changes;
}

// --- Credentials ---

export async function upsertCredentials(db, userId, encryptedFields) {
  const id = generateId();
  await db.prepare(
    `INSERT OR REPLACE INTO credentials
     (id, user_id, imap_host_enc, imap_port_enc, imap_user_enc, imap_pass_enc, smtp_host_enc, smtp_port_enc, iv)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, userId,
    encryptedFields.imap_host_enc, encryptedFields.imap_port_enc,
    encryptedFields.imap_user_enc, encryptedFields.imap_pass_enc,
    encryptedFields.smtp_host_enc, encryptedFields.smtp_port_enc,
    encryptedFields.iv
  ).run();
}

export async function getCredentials(db, userId) {
  return db.prepare(
    'SELECT * FROM credentials WHERE user_id = ?'
  ).bind(userId).first();
}

export async function deleteCredentials(db, userId) {
  const result = await db.prepare('DELETE FROM credentials WHERE user_id = ?').bind(userId).run();
  return result.meta.changes > 0;
}
