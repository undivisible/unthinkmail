// Credential management routes

import { encryptCredentials, decryptCredentials } from '../lib/crypto.js';
import { upsertCredentials, getCredentials, deleteCredentials } from '../lib/db.js';
import { authenticateJwt } from '../lib/middleware.js';
import { json, jsonError } from '../index.js';

const REQUIRED_FIELDS = ['imap_host', 'imap_port', 'imap_user', 'imap_pass', 'smtp_host', 'smtp_port'];

export async function handleCredentials(request, env) {
  let user;
  try {
    user = await authenticateJwt(request, env);
  } catch (e) {
    return jsonError(e.message, 401);
  }

  if (request.method === 'PUT') {
    const body = await request.json();
    for (const field of REQUIRED_FIELDS) {
      if (body[field] === undefined || body[field] === null) {
        return jsonError(`Missing required field: ${field}`, 400);
      }
    }
    const credentialsObj = {};
    for (const field of REQUIRED_FIELDS) {
      credentialsObj[field] = body[field];
    }
    const encrypted = await encryptCredentials(env.MASTER_ENCRYPTION_KEY, user.userId, credentialsObj);
    await upsertCredentials(env.DB, user.userId, encrypted);
    return json({ stored: true });
  }

  if (request.method === 'GET') {
    const record = await getCredentials(env.DB, user.userId);
    if (!record) {
      return jsonError('No credentials stored', 404);
    }
    // Decrypt only metadata fields, never return password
    const decrypted = await decryptCredentials(env.MASTER_ENCRYPTION_KEY, user.userId, record);
    return json({
      imap_host: decrypted.imap_host,
      imap_port: decrypted.imap_port,
      imap_user: decrypted.imap_user,
    });
  }

  if (request.method === 'DELETE') {
    const deleted = await deleteCredentials(env.DB, user.userId);
    if (!deleted) {
      return jsonError('No credentials stored', 404);
    }
    return json({ deleted: true });
  }

  return jsonError('Method not allowed', 405);
}
