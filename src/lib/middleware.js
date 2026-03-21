// Authentication middleware
// User identity: Cloudflare Access header (set by CF edge, not forgeable by clients)
// API key auth: pm_ prefix tokens stored as SHA-256 hashes in D1

import { hashApiKey } from './crypto.js';
import { getApiKeyByHash, getUserByEmail, createUser } from './db.js';

// Authenticate via Cloudflare Access. CF sets Cf-Access-Authenticated-User-Email
// on every request that passes through an Access policy. If missing, the request
// either didn't go through Access or Access isn't configured.
export async function authenticateUser(request, env) {
  const email =
    request.headers.get('Cf-Access-Authenticated-User-Email') ||
    env.DEV_EMAIL; // local dev escape hatch only

  if (!email) {
    throw new Error('Unauthenticated');
  }

  let user = await getUserByEmail(env.DB, email);
  if (!user) {
    user = await createUser(env.DB, email);
  }
  return { userId: user.id, email: user.email };
}

// Authenticate via pm_ API key (for MCP clients — not gated by CF Access)
export async function authenticateApiKey(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer pm_')) {
    throw new Error('Missing or invalid API key');
  }
  const rawKey = auth.slice(7);
  const keyHash = await hashApiKey(rawKey);
  const record = await getApiKeyByHash(env.DB, keyHash);
  if (!record) {
    throw new Error('Invalid API key');
  }
  return { userId: record.user_id, email: record.email };
}
