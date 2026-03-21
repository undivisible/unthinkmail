import { McpContainer } from './container.js';
import { handleKey } from './routes/key.js';
import { handleMcp } from './routes/mcp.js';
import { HUB } from './pages.js';

export { McpContainer };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      if (url.pathname === '/' && request.method === 'GET') {
        return new Response(HUB, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
      }
      if (url.pathname === '/health') return json({ status: 'ok' });
      if (url.pathname === '/api/key') return handleKey(request, env);
      if (url.pathname === '/mcp') return handleMcp(request, env);

      return jsonError('Not found', 404);
    } catch (e) {
      console.error('Unhandled error:', e);
      return jsonError('Internal server error', 500);
    }
  },
};
