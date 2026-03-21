import { McpContainer } from './container.js';
import { handleAuth } from './routes/auth.js';
import { handleKeys } from './routes/keys.js';
import { handleCredentials } from './routes/credentials.js';
import { handleMcp } from './routes/mcp.js';

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

const LANDING_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>mailpoke</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;color:#e0e0e0;font-family:-apple-system,system-ui,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem}
a{color:#888;text-decoration:none;border-bottom:1px solid #333;transition:color .2s}
a:hover{color:#fff}
h1{font-size:2.5rem;font-weight:200;letter-spacing:-.02em;color:#fff;margin-bottom:.25rem}
.sub{color:#555;font-size:.9rem;margin-bottom:3rem}
.grid{display:grid;grid-template-columns:1fr;gap:1.5rem;max-width:480px;width:100%}
.card{border:1px solid #1a1a1a;border-radius:8px;padding:1.25rem;background:#0a0a0a}
.card h3{color:#fff;font-weight:500;font-size:.85rem;margin-bottom:.5rem;letter-spacing:.03em;text-transform:uppercase}
.card p{color:#666;font-size:.8rem;line-height:1.5}
code{background:#111;color:#888;padding:.15em .4em;border-radius:3px;font-size:.75rem}
.endpoints{margin-top:2.5rem;width:100%;max-width:480px}
.endpoints h2{font-size:.75rem;text-transform:uppercase;letter-spacing:.1em;color:#444;margin-bottom:1rem}
table{width:100%;border-collapse:collapse}
td{padding:.4rem 0;font-size:.75rem;border-bottom:1px solid #111}
td:first-child{color:#555;font-family:monospace;white-space:nowrap;padding-right:1rem}
td:last-child{color:#444}
.method{display:inline-block;width:3rem;color:#333;font-weight:600}
footer{margin-top:3rem;text-align:center}
footer a{font-size:.75rem;color:#333;border-bottom-color:#1a1a1a}
footer a:hover{color:#666}
.dot{display:inline-block;width:6px;height:6px;background:#1a1a1a;border-radius:50%;margin:0 .5rem;vertical-align:middle}
</style>
</head>
<body>
<h1>mailpoke</h1>
<p class="sub">imap mcp server &mdash; connect any email to any ai</p>

<div class="grid">
<div class="card">
<h3>1. create account</h3>
<p><code>POST /api/auth/register</code> with your email and password</p>
</div>
<div class="card">
<h3>2. add your imap credentials</h3>
<p><code>PUT /api/credentials</code> with your imap/smtp host, port, user, and password. encrypted at rest with aes-256-gcm.</p>
</div>
<div class="card">
<h3>3. generate an api key</h3>
<p><code>POST /api/keys</code> to get a <code>pm_</code> prefixed key. use it to authenticate mcp requests.</p>
</div>
<div class="card">
<h3>4. connect your ai</h3>
<p>point any mcp client at <code>POST /mcp</code> with your api key. list folders, search messages, read email.</p>
</div>
</div>

<div class="endpoints">
<h2>api reference</h2>
<table>
<tr><td><span class="method">POST</span> /api/auth/register</td><td>create account</td></tr>
<tr><td><span class="method">POST</span> /api/auth/login</td><td>get jwt token</td></tr>
<tr><td><span class="method">PUT</span> /api/credentials</td><td>store imap/smtp credentials</td></tr>
<tr><td><span class="method">GET</span> /api/credentials</td><td>view stored credentials</td></tr>
<tr><td><span class="method">POST</span> /api/keys</td><td>generate api key</td></tr>
<tr><td><span class="method">GET</span> /api/keys</td><td>list api keys</td></tr>
<tr><td><span class="method">DEL</span> /api/keys/:id</td><td>revoke api key</td></tr>
<tr><td><span class="method">POST</span> /mcp</td><td>json-rpc mcp endpoint</td></tr>
</table>
</div>

<footer>
<a href="https://buymeacoffee.com/undivisible">buy me a coffee</a>
<span class="dot"></span>
<a href="https://github.com/undivisible/purelymail-mcp-server">source</a>
</footer>
</body>
</html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') return handleCors();

    try {
      // Landing page
      if (url.pathname === '/' && request.method === 'GET') {
        return new Response(LANDING_PAGE, {
          headers: { 'Content-Type': 'text/html;charset=utf-8' },
        });
      }

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
