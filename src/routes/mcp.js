// MCP proxy: decrypt self-contained um_ key → forward to container with credentials

import { decodeKey, credHash } from '../lib/crypto.js';
import { json, jsonError } from '../index.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function handleMcp(request, env) {
  if (request.method !== 'POST') return jsonError('Method not allowed', 405);

  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer um_')) return jsonError('Missing or invalid API key', 401);

  let credentials;
  try {
    credentials = await decodeKey(auth.slice(7), env.MASTER_ENCRYPTION_KEY);
  } catch {
    return jsonError('Invalid API key', 401);
  }

  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Invalid JSON body', 400);

  // Route to a stable container per unique credential set
  const hash = await credHash(credentials);
  const id = env.MCP_CONTAINER.idFromName(hash);
  const stub = env.MCP_CONTAINER.get(id);

  const enrichedBody = { ...body, _credentials: credentials };

  const containerResponse = await stub.fetch(new Request(request.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(enrichedBody),
  }));

  const responseBody = await containerResponse.text();
  return new Response(responseBody, {
    status: containerResponse.status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
