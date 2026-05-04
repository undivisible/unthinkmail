import { Hono } from 'hono';
import { ImapSession } from './session.js';
import { handleKey } from './routes/key.js';
import { handleMcp } from './routes/mcp.js';
import { handleOAuthMeta, handleOAuthRegister, handleOAuthAuthorize, handleOAuthToken } from './routes/oauth.js';
import { HUB } from './pages.js';

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

const app = new Hono();

app.options('*', (c) => new Response(null, { status: 204, headers: CORS }));

app.get('/',       (c) => c.html(HUB));
app.get('/health', (c) => c.json({ status: 'ok' }));

app.post('/api/key', (c) => handleKey(c.req.raw, c.env));

app.get('/mcp',  (c) => handleMcp(c.req.raw, c.env));
app.post('/mcp', (c) => handleMcp(c.req.raw, c.env));

app.get('/.well-known/oauth-authorization-server',     (c) => handleOAuthMeta(c.req.raw, c.env));
app.get('/.well-known/oauth-authorization-server/mcp', (c) => handleOAuthMeta(c.req.raw, c.env));
app.get('/.well-known/openid-configuration',           (c) => handleOAuthMeta(c.req.raw, c.env));

app.post('/oauth/register',  (c) => handleOAuthRegister(c.req.raw, c.env));
app.get('/oauth/authorize',  (c) => handleOAuthAuthorize(c.req.raw, c.env));
app.post('/oauth/authorize', (c) => handleOAuthAuthorize(c.req.raw, c.env));
app.post('/oauth/token',     (c) => handleOAuthToken(c.req.raw, c.env));

export default app;
