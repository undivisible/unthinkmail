import { encodeKey } from './lib/crypto.js';
import { HUB } from './pages.js';
import { handleMcp } from './routes/mcp.js';
import { handleOAuthMeta, handleOAuthRegister, handleOAuthAuthorize, handleOAuthToken, handleProtectedResourceMeta } from './routes/oauth.js';
import { ImapSession } from './session.js';

export { ImapSession };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export function jsonError(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

async function handleKey(request, env) {
  const body = await request.json().catch(() => ({}));
  const { imap_host, imap_user, imap_pass, smtp_host, smtp_from_email, smtp_from_name, smtp_reply_to, smtp_signature } = body;
  if (!imap_host || !imap_user || !imap_pass) return jsonError('imap_host, imap_user, imap_pass are required', 400);
  let key;
  try {
    key = await encodeKey(
      {
        imap_host: imap_host.trim(),
        imap_port: parseInt(body.imap_port) || 993,
        imap_user: imap_user.trim(),
        imap_pass,
        smtp_host: (smtp_host || imap_host).trim(),
        smtp_port: parseInt(body.smtp_port) || 587,
        smtp_from_email: smtp_from_email?.trim() || null,
        smtp_from_name: smtp_from_name?.trim() || null,
        smtp_reply_to: smtp_reply_to?.trim() || null,
        smtp_signature: smtp_signature?.trim() || null,
      },
      env?.OAUTH_SECRET,
    );
  } catch (e) {
    return jsonError(e.message, 500);
  }
  return json({ key });
}

async function fetch(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const { pathname } = new URL(request.url);
  if (request.method === 'GET' && pathname === '/') return new Response(HUB, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS } });
  if (request.method === 'GET' && pathname === '/health') return json({ status: 'ok' });
  if (request.method === 'POST' && pathname === '/api/key') return handleKey(request, env);
  if ((request.method === 'GET' || request.method === 'POST') && pathname === '/mcp') return handleMcp(request, env);
  if (
    request.method === 'GET' &&
    (pathname === '/.well-known/oauth-authorization-server' ||
      pathname === '/.well-known/oauth-authorization-server/mcp' ||
      pathname === '/.well-known/openid-configuration')
  )
    return handleOAuthMeta(request, env);
  if (request.method === 'GET' && (pathname === '/.well-known/oauth-protected-resource' || pathname === '/.well-known/oauth-protected-resource/mcp'))
    return handleProtectedResourceMeta(request, env);
  if (request.method === 'POST' && pathname === '/oauth/register') return handleOAuthRegister(request, env);
  if ((request.method === 'GET' || request.method === 'POST') && pathname === '/oauth/authorize') return handleOAuthAuthorize(request, env);
  if (request.method === 'POST' && pathname === '/oauth/token') return handleOAuthToken(request, env);
  return jsonError('Not found', 404);
}

export default { fetch };
