import { McpContainer } from './container.js';
import { handleAuth } from './routes/auth.js';
import { handleKeys } from './routes/keys.js';
import { handleCredentials } from './routes/credentials.js';
import { handleMcp } from './routes/mcp.js';
import { LANDING, HUB } from './pages.js';

export { McpContainer };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export function jsonError(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function handleCors() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function html(content) {
  return new Response(content, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') return handleCors();

    try {
      // Landing page
      if (url.pathname === '/' && request.method === 'GET') return html(LANDING);

      // Hub (dashboard)
      if (url.pathname === '/hub' && request.method === 'GET') return html(HUB);

      // Health check
      if (url.pathname === '/health') return json({ status: 'ok' });

      // Routes
      if (url.pathname.startsWith('/api/auth/')) return handleAuth(request, env);
      if (url.pathname.startsWith('/api/keys')) return handleKeys(request, env);
      if (url.pathname.startsWith('/api/credentials')) return handleCredentials(request, env);
      if (url.pathname === '/mcp') return handleMcp(request, env);

      return jsonError('Not found', 404);
    } catch (e) {
      console.error('Unhandled error:', e);
      return jsonError('Internal server error', 500);
    }
  },
};
