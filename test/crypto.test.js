import { expect, test } from 'bun:test';
import { encodeKey } from '../src/lib/crypto.js';

test('encodeKey fails closed without a strong secret', async () => {
  await expect(encodeKey({ imap_host: 'imap.example.com' }, '')).rejects.toThrow('OAUTH_SECRET');
  await expect(encodeKey({ imap_host: 'imap.example.com' }, 'short')).rejects.toThrow('OAUTH_SECRET');
});
