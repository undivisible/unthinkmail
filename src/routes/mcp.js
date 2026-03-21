// MCP proxy route: authenticate via API key, decrypt credentials, forward to container

import { decryptCredentials } from '../lib/crypto.js';
import { getCredentials } from '../lib/db.js';
import { authenticateApiKey } from '../lib/middleware.js';
import { json, jsonError } from '../index.js';

export async function handleMcp(request, env) {
  if (request.method !== 'POST') {
    return jsonError('Method not allowed', 405);
  }

  let user;
  try {
    user = await authenticateApiKey(request, env);
  } catch (e) {
    return jsonError(e.message, 401);
  }

  // Fetch encrypted credentials from D1
  const record = await getCredentials(env.DB, user.userId);
  if (!record) {
    return jsonError('No credentials configured. Store credentials via PUT /api/credentials first.', 400);
  }

  // Decrypt all credential fields
  const credentials = await decryptCredentials(env.MASTER_ENCRYPTION_KEY, user.userId, record);

  // Parse the incoming JSON-RPC request
  const body = await request.json();

  // Inject credentials into the request for the container
  const enrichedBody = { ...body, _credentials: credentials };

  // Forward to the container via Durable Object stub
  const id = env.MCP_CONTAINER.idFromName(user.userId);
  const stub = env.MCP_CONTAINER.get(id);

  const containerResponse = await stub.fetch(new Request(request.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(enrichedBody),
  }));

  // Return the container's response with CORS headers
  const responseBody = await containerResponse.text();
  return new Response(responseBody, {
    status: containerResponse.status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
