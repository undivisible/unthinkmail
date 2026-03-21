// Email OTP authentication
// POST /api/auth/otp/request  — send 6-digit code via Purelymail SMTP
// POST /api/auth/otp/verify   — verify code → return JWT
// GET  /api/auth/me           — return user from JWT

import { generateOtpCode, hashOtpCode, createJwt, verifyJwt } from '../lib/crypto.js';
import { createOtp, verifyOtp, getRecentOtp, cleanExpiredOtps, getUserByEmail, createUser, countRecentFailedVerifies, recordOtpAttempt } from '../lib/db.js';
import { sendOtpEmail } from '../lib/smtp.js';
import { json, jsonError } from '../index.js';

const OTP_TTL = 10 * 60;          // 10 minutes
const RATE_WINDOW = 60;            // 1 OTP request per email per minute
const MAX_VERIFY_ATTEMPTS = 5;    // max failed verifies per 10 min window

export async function handleAuth(request, env) {
  const url = new URL(request.url);

  // POST /api/auth/otp/request
  if (request.method === 'POST' && url.pathname === '/api/auth/otp/request') {
    const body = await request.json().catch(() => ({}));
    const email = (body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return jsonError('Valid email required', 400);

    // Rate limit
    const windowStart = Math.floor(Date.now() / 1000) - RATE_WINDOW;
    const recent = await getRecentOtp(env.DB, email, windowStart);
    if (recent) return jsonError('Please wait a minute before requesting another code', 429);

    const code = generateOtpCode();
    const codeHash = await hashOtpCode(code);
    const expiresAt = Math.floor(Date.now() / 1000) + OTP_TTL;

    await createOtp(env.DB, email, codeHash, expiresAt);
    cleanExpiredOtps(env.DB).catch(() => {});

    if (env.SMTP_USER && env.SMTP_PASS) {
      await sendOtpEmail({
        smtpUser: env.SMTP_USER,
        smtpPass: env.SMTP_PASS,
        smtpHost: env.SMTP_HOST || 'smtp.purelymail.com',
        smtpPort: env.SMTP_PORT || '465',
        to: email,
        code,
      });
    } else {
      // Dev: log to console
      console.log(`[unthinkmail OTP] ${email} → ${code}`);
    }

    return json({ sent: true });
  }

  // POST /api/auth/otp/verify
  if (request.method === 'POST' && url.pathname === '/api/auth/otp/verify') {
    const body = await request.json().catch(() => ({}));
    const email = (body.email || '').trim().toLowerCase();
    const code = (body.code || '').trim().replace(/\s/g, '');
    if (!email || !code) return jsonError('Email and code required', 400);

    // Rate limit failed verify attempts (prevent 6-digit brute force)
    const attemptWindow = Math.floor(Date.now() / 1000) - OTP_TTL;
    const failCount = await countRecentFailedVerifies(env.DB, email, attemptWindow);
    if (failCount >= MAX_VERIFY_ATTEMPTS) {
      return jsonError('Too many failed attempts. Request a new code.', 429);
    }

    const codeHash = await hashOtpCode(code);
    const valid = await verifyOtp(env.DB, email, codeHash);

    recordOtpAttempt(env.DB, email, valid).catch(() => {});

    if (!valid) return jsonError('Invalid or expired code', 401);

    let user = await getUserByEmail(env.DB, email);
    if (!user) user = await createUser(env.DB, email);

    const token = await createJwt({ sub: user.id, email: user.email }, env.JWT_SECRET);
    return json({ token });
  }

  // GET /api/auth/me
  if (request.method === 'GET' && url.pathname === '/api/auth/me') {
    const auth = request.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ') || auth.startsWith('Bearer pm_')) {
      return jsonError('Unauthenticated', 401);
    }
    try {
      const payload = await verifyJwt(auth.slice(7), env.JWT_SECRET);
      return json({ id: payload.sub, email: payload.email });
    } catch {
      return jsonError('Unauthenticated', 401);
    }
  }

  return jsonError('Not found', 404);
}
