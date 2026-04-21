// POST /api/key — generate a self-contained encrypted API key from IMAP/SMTP credentials

import { encodeKey } from '../lib/crypto.js';
import { json, jsonError } from '../index.js';

export async function handleKey(request, env) {
  if (request.method !== 'POST') return jsonError('Method not allowed', 405);

  const body = await request.json().catch(() => ({}));
  const { imap_host, imap_user, imap_pass, smtp_host, smtp_from_email, smtp_from_name, smtp_reply_to, smtp_signature } = body;

  if (!imap_host || !imap_user || !imap_pass) {
    return jsonError('imap_host, imap_user, imap_pass are required', 400);
  }

  const creds = {
    imap_host: imap_host.trim(),
    imap_port: parseInt(body.imap_port) || 993,
    imap_user: imap_user.trim(),
    imap_pass: imap_pass,
    smtp_host: (smtp_host || imap_host).trim(),
    smtp_port: parseInt(body.smtp_port) || 587,
    smtp_from_email: smtp_from_email?.trim() || null,
    smtp_from_name: smtp_from_name?.trim() || null,
    smtp_reply_to: smtp_reply_to?.trim() || null,
    smtp_signature: smtp_signature?.trim() || null,
  };

  const key = await encodeKey(creds);
  return json({ key });
}
