// POST /api/key — generate a self-contained encrypted API key from IMAP/SMTP credentials

import { encodeKey } from '../lib/crypto.js';
import { json, jsonError } from '../index.js';

export async function handleKey(request, env) {
  if (request.method !== 'POST') return jsonError('Method not allowed', 405);

  const body = await request.json().catch(() => ({}));
  const { imap_host, imap_user, imap_pass, smtp_host } = body;

  if (!imap_host || !imap_user || !imap_pass) {
    return jsonError('imap_host, imap_user, imap_pass are required', 400);
  }

  const creds = {
    imap_host: imap_host.trim(),
    imap_port: parseInt(body.imap_port) || 993,
    imap_user: imap_user.trim(),
    imap_pass: imap_pass,
    smtp_host: (smtp_host || imap_host).trim(),
    smtp_port: parseInt(body.smtp_port) || 465,
  };

  const key = await encodeKey(creds);
  return json({ key });
}
