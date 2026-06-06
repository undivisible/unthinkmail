import { expect, test } from 'bun:test';
import { PRESET_NAMES, PROVIDER_GUIDE_HTML, PROVIDER_PRESETS } from '../src/provider-content.js';

test('provider content includes iCloud in the shared preset source of truth', () => {
  expect(PRESET_NAMES).toContain('icloud');
  expect(PROVIDER_PRESETS.icloud).toEqual({
    ih: 'imap.mail.me.com',
    ip: '993',
    sh: 'smtp.mail.me.com',
    sp: '587',
    note: 'Use an app-specific password',
  });
});

test('provider instructions include iCloud mail setup guidance', () => {
  expect(PROVIDER_GUIDE_HTML).toContain('icloud mail');
  expect(PROVIDER_GUIDE_HTML).toContain('imap.mail.me.com:993');
  expect(PROVIDER_GUIDE_HTML).toContain('smtp.mail.me.com:587');
});

test('preset pickers use presetNames instead of embedding a raw array in x-for', async () => {
  const pagesSource = await Bun.file('src/pages.js').text();
  const oauthSource = await Bun.file('src/routes/oauth.js').text();

  expect(pagesSource).toContain('presetNames: ${JSON.stringify(PRESET_NAMES)}');
  expect(pagesSource).toContain('x-for="p in presetNames"');
  expect(oauthSource).toContain('presetNames: ${JSON.stringify(PRESET_NAMES)}');
  expect(oauthSource).toContain('x-for="p in presetNames"');
});
