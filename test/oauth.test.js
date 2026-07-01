import { expect, test } from 'bun:test';
import { handleOAuthAuthorize, handleOAuthRegister, handleOAuthToken } from '../src/routes/oauth.js';

const enc = new TextEncoder();
const secret = '0123456789abcdef0123456789abcdef';

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const challengeFor = async (verifier) => b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));

const envWithCodeStore = () => {
  const used = new Set();
  return {
    OAUTH_SECRET: secret,
    IMAP_SESSION: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async (request) => {
          const { hash } = await request.json();
          if (used.has(hash)) return Response.json({ error: 'used' }, { status: 409 });
          used.add(hash);
          return Response.json({ used: true });
        },
      }),
    },
  };
};

async function registerClient(redirectUri) {
  const response = await handleOAuthRegister(
    new Request('https://unthinkmail.test/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [redirectUri] }),
    }),
  );
  return response.json();
}

async function authorize({ redirectUri, clientId, challenge }) {
  const form = new FormData();
  form.set('redirect_uri', redirectUri);
  form.set('client_id', clientId);
  form.set('code_challenge', challenge);
  form.set('code_challenge_method', 'S256');
  form.set('imap_host', 'imap.example.com');
  form.set('imap_user', 'me@example.com');
  form.set('imap_pass', 'password');
  return handleOAuthAuthorize(
    new Request('https://unthinkmail.test/oauth/authorize', {
      method: 'POST',
      body: form,
    }),
    { OAUTH_SECRET: secret },
  );
}

async function exchange({ code, verifier, redirectUri, clientId, env }) {
  return handleOAuthToken(
    new Request('https://unthinkmail.test/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        client_id: clientId,
      }),
    }),
    env,
  );
}

test('OAuth rejects invalid redirect URIs at registration', async () => {
  const response = await handleOAuthRegister(
    new Request('https://unthinkmail.test/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://evil.example/callback'] }),
    }),
  );
  expect(response.status).toBe(400);
});

test('OAuth authorize requires a registered client id', async () => {
  const response = await authorize({
    redirectUri: 'https://client.example/callback',
    clientId: '',
    challenge: await challengeFor('verifier'),
  });
  expect(response.status).toBe(400);
  expect(await response.text()).toContain('Missing client_id');
});

test('OAuth authorization codes can only be exchanged once', async () => {
  const redirectUri = 'https://client.example/callback';
  const verifier = 'correct horse battery staple';
  const { client_id: clientId } = await registerClient(redirectUri);
  const authResponse = await authorize({
    redirectUri,
    clientId,
    challenge: await challengeFor(verifier),
  });
  expect(authResponse.status).toBe(302);
  const code = new URL(authResponse.headers.get('location')).searchParams.get('code');
  const env = envWithCodeStore();

  expect((await exchange({ code, verifier, redirectUri, clientId, env })).status).toBe(200);
  const replay = await exchange({ code, verifier, redirectUri, clientId, env });
  expect(replay.status).toBe(400);
  expect(await replay.json()).toEqual({ error: 'invalid_grant', error_description: 'Code already used' });
});
