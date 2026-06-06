// OAuth 2.1 endpoints for MCP client compatibility (e.g., Claude.ai)
// Strategy: access_token = um_ key, so /mcp requires zero changes.
// Auth codes are HMAC-signed, self-contained — no KV or DO storage needed.
// Requires OAUTH_SECRET env var (set via: wrangler secret put OAUTH_SECRET).

import { encodeKey } from '../lib/crypto.js';
import { json } from '../index.js';
import { PRESET_NAMES, PROVIDER_GUIDE_HTML, PROVIDER_PRESETS } from '../provider-content.js';

const enc = new TextEncoder();

function b64url(buf) {
  if (typeof buf === 'string') buf = enc.encode(buf);
  if (buf instanceof ArrayBuffer) buf = new Uint8Array(buf);
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromB64url(s) {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return atob(b);
}

async function hmacSign(payload, secret) {
  if (!secret) throw new Error('Missing OAUTH_SECRET');
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return b64url(new Uint8Array(sig));
}

async function hmacVerify(payload, sig, secret) {
  if (!secret) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  let sigBin;
  try {
    sigBin = b64urlToBytes(sig);
  } catch {
    return false;
  }
  return crypto.subtle.verify('HMAC', key, sigBin, enc.encode(payload));
}

function b64urlToBytes(s) {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
}

function oauthError(error, description) {
  return json({ error, ...(description ? { error_description: description } : {}) }, 400);
}

function oauthServerError(description) {
  return json({ error: 'server_error', ...(description ? { error_description: description } : {}) }, 500);
}

function requireOAuthSecret(env) {
  const secret = String(env?.OAUTH_SECRET ?? '').trim();
  if (!secret) {
    console.error('[oauth] OAUTH_SECRET is missing; refusing OAuth code/token operations');
    return null;
  }
  if (secret.length < 32) {
    console.error('[oauth] OAUTH_SECRET is too short; require at least 32 characters');
    return null;
  }
  return secret;
}

// GET /.well-known/oauth-authorization-server
export async function handleOAuthMeta(request) {
  const o = new URL(request.url).origin;
  console.log('[oauth] meta requested from', request.headers.get('User-Agent')?.slice(0, 60));
  return json({
    issuer: o,
    authorization_endpoint: `${o}/oauth/authorize`,
    token_endpoint: `${o}/oauth/token`,
    registration_endpoint: `${o}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['email'],
  });
}

export async function handleProtectedResourceMeta(request) {
  const o = new URL(request.url).origin;
  return json({
    resource: `${o}/mcp`,
    authorization_servers: [o],
    scopes_supported: ['email'],
    bearer_methods_supported: ['header'],
    resource_name: 'unthinkmail',
  });
}

// POST /oauth/register — RFC 7591 dynamic client registration
// client_id is deterministic (base64url of sorted redirect_uris) — no storage needed.
export async function handleOAuthRegister(request) {
  const body = await request.json().catch(() => ({}));
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  const clientId = b64url(enc.encode(JSON.stringify(uris.sort())));
  console.log('[oauth] register redirect_uris=%j client_id_prefix=%s', uris, clientId.slice(0, 12));
  return json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: uris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'email',
    },
    201,
  );
}

// GET /oauth/authorize — show credentials form
// POST /oauth/authorize — validate creds, create signed code, redirect
export async function handleOAuthAuthorize(request, env) {
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const p = Object.fromEntries(url.searchParams);
    console.log('[oauth] authorize GET client_id_prefix=%s redirect_uri=%s has_challenge=%s', p.client_id?.slice(0, 12), p.redirect_uri, !!p.code_challenge);
    return new Response(oauthForm(p, null), {
      headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  }

  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const oauthSecret = requireOAuthSecret(env);
  if (!oauthSecret) return oauthServerError('OAuth is not configured on this server');

  const form = await request.formData().catch(() => null);
  if (!form) return new Response('Invalid form data', { status: 400 });

  const redirectUri = form.get('redirect_uri');
  const state = form.get('state');
  const codeChallenge = form.get('code_challenge');
  const codeChallengeMethod = form.get('code_challenge_method') || 'S256';
  const clientId = form.get('client_id');

  if (!redirectUri) return new Response('Missing redirect_uri', { status: 400 });
  if (!codeChallenge) return new Response('Missing code_challenge', { status: 400 });
  if (codeChallengeMethod !== 'S256') return new Response('Unsupported code_challenge_method', { status: 400 });

  // Validate redirect_uri against registered client
  if (clientId) {
    try {
      const registered = JSON.parse(fromB64url(clientId));
      if (Array.isArray(registered) && !registered.includes(redirectUri)) {
        return new Response('redirect_uri not registered for this client', { status: 400 });
      }
    } catch {
      return new Response('Invalid client_id', { status: 400 });
    }
  }

  const imapHost = form.get('imap_host')?.trim();
  const imapPort = parseInt(form.get('imap_port')) || 993;
  const imapUser = form.get('imap_user')?.trim();
  const imapPass = form.get('imap_pass');
  const smtpHost = form.get('smtp_host')?.trim() || imapHost;
  const smtpPort = parseInt(form.get('smtp_port')) || 587;
  const smtpFromEmail = form.get('smtp_from_email')?.trim() || null;
  const smtpFromName = form.get('smtp_from_name')?.trim() || null;
  const smtpReplyTo = form.get('smtp_reply_to')?.trim() || null;
  const smtpSignature = form.get('smtp_signature')?.trim() || null;

  const oauthParams = { redirect_uri: redirectUri, state, code_challenge: codeChallenge, client_id: clientId };

  if (!imapHost || !imapUser || !imapPass) {
    return new Response(oauthForm(oauthParams, 'imap host, username, and password are required'), {
      headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  }

  const creds = {
    imap_host: imapHost,
    imap_port: imapPort,
    imap_user: imapUser,
    imap_pass: imapPass,
    smtp_host: smtpHost,
    smtp_port: smtpPort,
    smtp_from_email: smtpFromEmail,
    smtp_from_name: smtpFromName,
    smtp_reply_to: smtpReplyTo,
    smtp_signature: smtpSignature,
  };
  const umKey = await encodeKey(creds, oauthSecret);

  const payloadJson = JSON.stringify({
    k: umKey,
    cc: codeChallenge,
    ru: redirectUri,
    ci: clientId || null,
    exp: Date.now() + 10 * 60 * 1000,
  });
  const payload = b64url(enc.encode(payloadJson));
  const sig = await hmacSign(payload, oauthSecret);
  const code = `${payload}.${sig}`;

  const dest = new URL(redirectUri);
  dest.searchParams.set('code', code);
  if (state) dest.searchParams.set('state', state);

  console.log('[oauth] authorize POST success redirecting to=%s code_len=%d', dest.hostname, code.length);
  return Response.redirect(dest.toString(), 302);
}

// POST /oauth/token — exchange PKCE-verified auth code for access_token (= um_ key)
export async function handleOAuthToken(request, env) {
  const oauthSecret = requireOAuthSecret(env);
  if (!oauthSecret) return oauthServerError('OAuth is not configured on this server');

  let body;
  const ct = request.headers.get('Content-Type') || '';
  console.log('[oauth] token request ct=%s', ct);
  if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null);
    if (!form) {
      console.log('[oauth] token: formData parse failed');
      return oauthError('invalid_request', 'Invalid form data');
    }
    body = Object.fromEntries(form);
  } else {
    body = await request.json().catch(() => null);
    if (!body) {
      console.log('[oauth] token: json parse failed');
      return oauthError('invalid_request', 'Invalid request body');
    }
  }

  console.log('[oauth] token grant_type=%s has_code=%s has_verifier=%s', body.grant_type, !!body.code, !!body.code_verifier);

  if (body.grant_type !== 'authorization_code') return oauthError('unsupported_grant_type');

  const { code, code_verifier, redirect_uri, client_id } = body;
  if (!code) return oauthError('invalid_request', 'Missing code');
  if (!code_verifier) return oauthError('invalid_request', 'Missing code_verifier');

  const dotIdx = code.lastIndexOf('.');
  if (dotIdx < 1) {
    console.log('[oauth] token: bad code format');
    return oauthError('invalid_grant');
  }
  const payload = code.slice(0, dotIdx);
  const sig = code.slice(dotIdx + 1);

  const valid = await hmacVerify(payload, sig, oauthSecret);
  if (!valid) {
    console.log('[oauth] token: HMAC invalid');
    return oauthError('invalid_grant');
  }

  let data;
  try {
    data = JSON.parse(fromB64url(payload));
  } catch (e) {
    console.log('[oauth] token: payload decode failed', e?.message);
    return oauthError('invalid_grant');
  }

  if (Date.now() > data.exp) {
    console.log('[oauth] token: code expired');
    return oauthError('invalid_grant', 'Code expired');
  }

  if (redirect_uri && redirect_uri !== data.ru) {
    console.log('[oauth] token: redirect_uri mismatch got=%s want=%s', redirect_uri, data.ru);
    return oauthError('invalid_grant', 'redirect_uri mismatch');
  }

  if (client_id && data.ci && client_id !== data.ci) {
    console.log('[oauth] token: client_id mismatch got=%s want=%s', client_id, data.ci);
    return oauthError('invalid_grant', 'client_id mismatch');
  }

  const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(code_verifier));
  const challenge = b64url(new Uint8Array(hashBuf));
  if (challenge !== data.cc) {
    console.log('[oauth] token: PKCE failed computed=%s stored=%s', challenge, data.cc);
    return oauthError('invalid_grant', 'PKCE verification failed');
  }

  console.log('[oauth] token: success issuing access_token');
  return json({
    access_token: data.k,
    token_type: 'bearer',
    scope: 'email',
  });
}

const TAILWIND_CONFIG = `
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: '#0e0e0e',
        border:  '#1e1e1e',
        muted:   '#2a2a2a',
        dim:     '#3d3d3d',
        sub:     '#686868',
        body:    '#e2e2e2',
      },
      fontFamily: { mono: ["'SF Mono'", 'Monaco', 'monospace'] },
    }
  }
}`;

const OAUTH_SCRIPT = `
function oauthForm() {
  return {
    presetNames: ${JSON.stringify(PRESET_NAMES)},
    providerPresets: ${JSON.stringify(PROVIDER_PRESETS)},
    f: { 
      imapHost: '', imapPort: '993', 
      smtpHost: '', smtpPort: '587', 
      user: '', pass: '',
      fromEmail: '', fromName: '', replyTo: '', signature: '',
    },
    showAdvanced: false,
    providerNote: '',
    loading: false,

    imapHostChanged() {
      if (!this.f.smtpHost || this.f.smtpHost === this.lastImapHost) {
        this.f.smtpHost = this.f.imapHost.replace('imap.', 'smtp.');
      }
      this.lastImapHost = this.f.imapHost;
    },

    preset(p) {
      const r = this.providerPresets[p]; if (!r) return;
      this.f.imapHost = r.ih; this.f.imapPort = r.ip;
      this.f.smtpHost = r.sh; this.f.smtpPort = r.sp;
      this.providerNote = r.note;
    },

    submit() { this.loading = true; this.$el.closest('form').submit(); },
  };
}`;

function oauthForm(params, error) {
  const h = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  const { redirect_uri = '', state = '', code_challenge = '', code_challenge_method = 'S256', client_id = '' } = params;

  return `<!DOCTYPE html>
<html lang="en" class="dark bg-black">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>unthinkmail — connect</title>
<script src="https://cdn.tailwindcss.com"><\/script>
<script>${TAILWIND_CONFIG}<\/script>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"><\/script>
<style>
  [x-cloak]{display:none!important}
  input:-webkit-autofill{-webkit-text-fill-color:#e2e2e2!important;-webkit-box-shadow:0 0 0 1000px #0e0e0e inset!important}
</style>
</head>
<body class="bg-black text-body min-h-screen" x-data="oauthForm()" x-cloak>
<script>${OAUTH_SCRIPT}<\/script>

<form method="POST" action="/oauth/authorize">
  <input type="hidden" name="redirect_uri" value="${h(redirect_uri)}">
  <input type="hidden" name="state" value="${h(state)}">
  <input type="hidden" name="code_challenge" value="${h(code_challenge)}">
  <input type="hidden" name="code_challenge_method" value="${h(code_challenge_method)}">
  <input type="hidden" name="client_id" value="${h(client_id)}">

  <div class="max-w-lg mx-auto px-6 py-12">

    <div class="mb-8">
      <a href="/" class="hover:opacity-70 transition-opacity"><h1 class="text-white font-light text-2xl mb-1">unthinkmail</h1></a>
      <p class="text-sub text-xs">connect your email to your ai</p>
      <p class="text-dim text-xs mt-2 leading-relaxed max-w-sm">enter your imap credentials to authorize access. nothing is stored — your credentials are encoded into the access token.</p>
    </div>

    <div class="flex gap-2 mb-5 flex-wrap">
      <span class="text-xs text-dim self-center">quick fill:</span>
      <template x-for="p in presetNames">
        <button type="button" @click="preset(p)"
          class="text-xs border border-border text-dim px-2.5 py-1 rounded hover:text-body hover:border-dim transition-colors"
          x-text="p"></button>
      </template>
    </div>

    <div class="bg-surface border border-border rounded-lg p-5 space-y-3">

      <div class="grid grid-cols-[1fr_6rem] gap-2">
        <div>
          <label class="text-xs text-dim block mb-1">imap host</label>
          <input x-model="f.imapHost" @input="imapHostChanged()" name="imap_host" type="text" placeholder="imap.example.com" autocomplete="off" spellcheck="false"
            class="w-full bg-black border border-border text-body text-sm rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted font-mono">
        </div>
        <div>
          <label class="text-xs text-dim block mb-1">port</label>
          <input x-model="f.imapPort" name="imap_port" type="number" placeholder="993"
            class="w-full bg-black border border-border text-body text-sm rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted font-mono">
        </div>
      </div>

      <div class="grid grid-cols-[1fr_6rem] gap-2">
        <div>
          <label class="text-xs text-dim block mb-1">smtp host</label>
          <input x-model="f.smtpHost" name="smtp_host" type="text" placeholder="smtp.example.com" autocomplete="off" spellcheck="false"
            class="w-full bg-black border border-border text-body text-sm rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted font-mono">
        </div>
        <div>
          <label class="text-xs text-dim block mb-1">port</label>
          <input x-model="f.smtpPort" name="smtp_port" type="number" placeholder="465"
            class="w-full bg-black border border-border text-body text-sm rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted font-mono">
        </div>
      </div>

      <div>
        <label class="text-xs text-dim block mb-1">email / username</label>
        <input x-model="f.user" name="imap_user" type="email" placeholder="you@example.com" autocomplete="email"
          class="w-full bg-black border border-border text-body text-sm rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted font-mono">
      </div>

      <div>
        <label class="text-xs text-dim block mb-1">password <span class="text-muted">(app password if 2fa enabled)</span></label>
        <input name="imap_pass" type="password" placeholder="••••••••" autocomplete="current-password"
          class="w-full bg-black border border-border text-body text-sm rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted">
      </div>

      <!-- Advanced options toggle -->
      <button @click="showAdvanced = !showAdvanced" type="button"
        class="text-xs text-dim flex items-center gap-1 hover:text-sub transition-colors">
        <span x-text="showAdvanced ? '−' : '+'"></span>
        <span>advanced send options</span>
      </button>

      <!-- Advanced send options -->
      <div x-show="showAdvanced" x-transition class="space-y-3 pt-2">
        <div>
          <label class="text-xs text-dim block mb-1">from email <span class="text-muted">(optional — defaults to username)</span></label>
          <input x-model="f.fromEmail" name="smtp_from_email" type="email" placeholder="different@domain.com"
            class="w-full bg-black border border-border text-body text-sm rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted font-mono">
        </div>
        <div>
          <label class="text-xs text-dim block mb-1">from name <span class="text-muted">(optional)</span></label>
          <input x-model="f.fromName" name="smtp_from_name" type="text" placeholder="Your Name"
            class="w-full bg-black border border-border text-body text-sm rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted">
        </div>
        <div>
          <label class="text-xs text-dim block mb-1">reply-to address <span class="text-muted">(optional)</span></label>
          <input x-model="f.replyTo" name="smtp_reply_to" type="email" placeholder="reply@different.com"
            class="w-full bg-black border border-border text-body text-sm rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted font-mono">
        </div>
        <div>
          <label class="text-xs text-dim block mb-1">signature <span class="text-muted">(optional — appended to sent emails)</span></label>
          <textarea x-model="f.signature" name="smtp_signature" rows="3" placeholder="--&#10;John Doe&#10;Software Engineer"
            class="w-full bg-black border border-border text-body text-sm rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted resize-none font-mono"></textarea>
        </div>
      </div>

      <!-- Provider-specific note -->
      <div x-show="providerNote" class="text-xs text-amber-700 mt-1" x-text="providerNote"></div>

      ${error ? `<div class="text-xs text-red-600 py-1">${h(error)}</div>` : ''}

      <button type="button" @click="submit()" :disabled="loading"
        class="w-full bg-surface border border-dim text-sub text-xs rounded-md py-2.5 hover:text-white hover:border-sub transition-colors disabled:opacity-40">
        <span x-text="loading ? 'connecting...' : 'authorize access'"></span>
      </button>
    </div>

    <p class="text-xs text-dim mt-4 text-center">your credentials are never stored — they become the access token itself.</p>

    <details class="mt-6 bg-surface border border-border rounded-lg p-4 text-xs text-sub">
      <summary class="cursor-pointer text-dim">provider setup instructions</summary>
      <div class="mt-4 space-y-4 text-xs text-sub">
${PROVIDER_GUIDE_HTML}
      </div>
    </details>

    <div class="mt-8 text-xs text-dim space-x-3 text-center">
      <a href="https://undivisible.dev" class="hover:text-sub transition-colors">undivisible.dev</a>
      <span class="text-border">·</span>
      <a href="https://github.com/undivisible/unthinkmail" class="hover:text-sub transition-colors">source</a>
    </div>

  </div>
</form>
</body>
</html>`;
}
