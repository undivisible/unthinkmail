// API key management routes

import { generateApiKey, hashApiKey } from '../lib/crypto.js';
import { createApiKey, listApiKeys, deleteApiKey, deleteAllApiKeys } from '../lib/db.js';
import { authenticateUser } from '../lib/middleware.js';
import { json, jsonError } from '../index.js';

export async function handleKeys(request, env) {
  const url = new URL(request.url);
  let user;
  try {
    user = await authenticateUser(request, env);
  } catch {
    return jsonError('Unauthenticated', 401);
  }

  if (request.method === 'POST' && url.pathname === '/api/keys') {
    const body = await request.json().catch(() => ({}));
    const rawKey = generateApiKey();
    const keyHash = await hashApiKey(rawKey);
    const keyPrefix = rawKey.slice(0, 10) + '...';
    const record = await createApiKey(env.DB, user.userId, keyHash, keyPrefix, body.label);
    return json({ id: record.id, key: rawKey, prefix: record.key_prefix, label: record.label }, 201);
  }

  if (request.method === 'GET' && url.pathname === '/api/keys') {
    const keys = await listApiKeys(env.DB, user.userId);
    return json({ keys });
  }

  // DELETE /api/keys — revoke all keys (security reset)
  if (request.method === 'DELETE' && url.pathname === '/api/keys') {
    const count = await deleteAllApiKeys(env.DB, user.userId);
    return json({ revoked: count });
  }

  const deleteMatch = url.pathname.match(/^\/api\/keys\/([^/]+)$/);
  if (request.method === 'DELETE' && deleteMatch) {
    const deleted = await deleteApiKey(env.DB, deleteMatch[1], user.userId);
    if (!deleted) return jsonError('API key not found', 404);
    return json({ deleted: true });
  }

  return jsonError('Not found', 404);
}
