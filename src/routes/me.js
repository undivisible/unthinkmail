// Identity endpoint — returns the authenticated user's info
// Authentication is handled by Cloudflare Access (reads Cf-Access-Authenticated-User-Email header)

import { authenticateUser } from '../lib/middleware.js';
import { json, jsonError } from '../index.js';

export async function handleMe(request, env) {
  if (request.method !== 'GET') return jsonError('Method not allowed', 405);
  try {
    const user = await authenticateUser(request, env);
    return json({ id: user.userId, email: user.email });
  } catch {
    return jsonError('Unauthenticated', 401);
  }
}
