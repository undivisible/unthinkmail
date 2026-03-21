// D1 database query helpers

import { generateId } from './crypto.js';

export async function createUser(db, email, passwordHash) {
  const id = generateId();
  await db.prepare(
    'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)'
  ).bind(id, email, passwordHash).run();
  return { id, email };
}

export async function getUserByEmail(db, email) {
  return db.prepare(
    'SELECT id, email, password_hash, created_at FROM users WHERE email = ?'
  ).bind(email).first();
}

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
    'SELECT id, key_prefix, label, created_at FROM api_keys WHERE user_id = ?'
  ).bind(userId).all();
  return results;
}

export async function deleteApiKey(db, id, userId) {
  const result = await db.prepare(
    'DELETE FROM api_keys WHERE id = ? AND user_id = ?'
  ).bind(id, userId).run();
  return result.meta.changes > 0;
}

export async function upsertCredentials(db, userId, encryptedFields) {
  const id = generateId();
  await db.prepare(
    `INSERT OR REPLACE INTO credentials (id, user_id, imap_host_enc, imap_port_enc, imap_user_enc, imap_pass_enc, smtp_host_enc, smtp_port_enc, iv)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    userId,
    encryptedFields.imap_host_enc,
    encryptedFields.imap_port_enc,
    encryptedFields.imap_user_enc,
    encryptedFields.imap_pass_enc,
    encryptedFields.smtp_host_enc,
    encryptedFields.smtp_port_enc,
    encryptedFields.iv
  ).run();
}

export async function getCredentials(db, userId) {
  return db.prepare(
    'SELECT id, user_id, imap_host_enc, imap_port_enc, imap_user_enc, imap_pass_enc, smtp_host_enc, smtp_port_enc, iv, created_at FROM credentials WHERE user_id = ?'
  ).bind(userId).first();
}

export async function deleteCredentials(db, userId) {
  const result = await db.prepare(
    'DELETE FROM credentials WHERE user_id = ?'
  ).bind(userId).run();
  return result.meta.changes > 0;
}
