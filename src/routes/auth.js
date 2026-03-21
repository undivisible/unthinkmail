// Authentication routes: register, login, me

import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { createUser, getUserByEmail } from '../lib/db.js';
import { createJwt, authenticateJwt } from '../lib/middleware.js';
import { json, jsonError } from '../index.js';

export async function handleAuth(request, env) {
  const url = new URL(request.url);

  if (request.method === 'POST' && url.pathname === '/api/auth/register') {
    const body = await request.json();
    if (!body.email || !body.password) {
      return jsonError('email and password are required', 400);
    }
    const existing = await getUserByEmail(env.DB, body.email);
    if (existing) {
      return jsonError('Email already registered', 409);
    }
    const passwordHash = await hashPassword(body.password);
    const user = await createUser(env.DB, body.email, passwordHash);
    return json({ id: user.id, email: user.email }, 201);
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await request.json();
    if (!body.email || !body.password) {
      return jsonError('email and password are required', 400);
    }
    const user = await getUserByEmail(env.DB, body.email);
    if (!user) {
      return jsonError('Invalid email or password', 401);
    }
    const valid = await verifyPassword(body.password, user.password_hash);
    if (!valid) {
      return jsonError('Invalid email or password', 401);
    }
    const token = await createJwt({ sub: user.id, email: user.email }, env.JWT_SECRET);
    return json({ token });
  }

  if (request.method === 'GET' && url.pathname === '/api/auth/me') {
    try {
      const user = await authenticateJwt(request, env);
      return json({ id: user.userId, email: user.email });
    } catch (e) {
      return jsonError(e.message, 401);
    }
  }

  return jsonError('Not found', 404);
}
