// MCP proxy: decrypt self-contained um_ key → forward to ImapSession DO

import { decodeKey, credHash } from '../lib/crypto.js';
import { jsonError } from '../index.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const WWW_AUTH = 'Bearer realm="unthinkmail", error="unauthorized"';

export async function handleMcp(request, env) {
  if (request.method !== 'GET' && request.method !== 'POST') return jsonError('Method not allowed', 405);

  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': WWW_AUTH, ...CORS },
    });
  }

  let credentials;
  try {
    credentials = await decodeKey(auth.slice(7), env?.OAUTH_SECRET);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid API key' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': `Bearer realm="unthinkmail", error="invalid_token"`, ...CORS },
    });
  }

  // MCP clients probe with GET to validate the server URL
  if (request.method === 'GET') {
    return new Response(
      JSON.stringify({ name: 'unthinkmail', version: '1.0.0', protocolVersion: '2024-11-05' }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Invalid JSON body', 400);

  // Route to a stable ImapSession DO per unique credential set
  const hash = await credHash(credentials);
  const id = env.IMAP_SESSION.idFromName(hash);
  const stub = env.IMAP_SESSION.get(id);

  const enrichedBody = { ...body, _credentials: credentials };

  console.log('[mcp] method=%s routing to session hash=%s', body.method, hash.slice(0, 8));

  let sessionResponse;
  try {
    sessionResponse = await stub.fetch(new Request('https://do/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(enrichedBody),
    }));
  } catch (e) {
    console.error('[mcp] session error:', e?.message ?? e);
    return jsonError('Session error: ' + (e?.message ?? 'unknown'), 502);
  }

  console.log('[mcp] session responded status=%d', sessionResponse.status);

  const responseBody = await sessionResponse.text();
  return new Response(responseBody, {
    status: sessionResponse.status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
