// Authentication middleware

import { hashApiKey, verifyJwt } from './crypto.js';
import { getApiKeyByHash, getUserByEmail, createUser } from './db.js';

// Authenticate hub requests via JWT (issued after email OTP verification)
export async function authenticateUser(request, env) {
  // Dev bypass: set DEV_EMAIL env var to skip OTP entirely
  if (env.DEV_EMAIL) {
    let user = await getUserByEmail(env.DB, env.DEV_EMAIL);
    if (!user) user = await createUser(env.DB, env.DEV_EMAIL);
    return { userId: user.id, email: user.email };
  }

  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) throw new Error('Unauthenticated');
  const token = auth.slice(7);

  // Reject API keys sent to hub endpoints
  if (token.startsWith('pm_')) throw new Error('Unauthenticated');

  const payload = await verifyJwt(token, env.JWT_SECRET);
  return { userId: payload.sub, email: payload.email };
}

// Authenticate MCP requests via pm_ API key
export async function authenticateApiKey(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer pm_')) throw new Error('Missing or invalid API key');
  const keyHash = await hashApiKey(auth.slice(7));
  const record = await getApiKeyByHash(env.DB, keyHash);
  if (!record) throw new Error('Invalid API key');
  return { userId: record.user_id, email: record.email };
}
