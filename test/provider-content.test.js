import { expect, test } from 'bun:test';
import { HUB } from '../src/pages.js';
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
  expect(pagesSource).toContain('providerPresets: ${JSON.stringify(PROVIDER_PRESETS)}');
  expect(pagesSource).toContain('x-for="p in presetNames"');
  expect(pagesSource).toContain('this.providerPresets[p]');
  expect(pagesSource).not.toContain('const r = PROVIDER_PRESETS[p]');
  expect(oauthSource).toContain('presetNames: ${JSON.stringify(PRESET_NAMES)}');
  expect(oauthSource).toContain('providerPresets: ${JSON.stringify(PROVIDER_PRESETS)}');
  expect(oauthSource).toContain('x-for="p in presetNames"');
  expect(oauthSource).toContain('this.providerPresets[p]');
  expect(oauthSource).not.toContain('const r = PROVIDER_PRESETS[p]');
});

test('rendered hub preset function fills iCloud settings', () => {
  const component = componentFromHtml(HUB, 'hub');

  component.preset('icloud');

  expect(component.f.imapHost).toBe('imap.mail.me.com');
  expect(component.f.imapPort).toBe('993');
  expect(component.f.smtpHost).toBe('smtp.mail.me.com');
  expect(component.f.smtpPort).toBe('587');
});

test('rendered oauth preset function fills iCloud settings', async () => {
  const source = await Bun.file('src/routes/oauth.js').text();
  const script = scriptTemplateFromSource(source, 'OAUTH_SCRIPT');
  const component = componentFromScript(script, 'oauthForm');

  component.preset('icloud');

  expect(component.f.imapHost).toBe('imap.mail.me.com');
  expect(component.f.imapPort).toBe('993');
  expect(component.f.smtpHost).toBe('smtp.mail.me.com');
  expect(component.f.smtpPort).toBe('587');
});

function componentFromHtml(html, factoryName) {
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).find((content) => content.includes(`function ${factoryName}()`));

  expect(script).toBeString();

  return componentFromScript(script, factoryName);
}

function componentFromScript(script, factoryName) {
  const factory = Function(`${script}; return ${factoryName};`)();
  return factory();
}

function scriptTemplateFromSource(source, name) {
  const match = source.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));

  expect(match?.[1]).toBeString();

  return Function('PRESET_NAMES', 'PROVIDER_PRESETS', `return \`${match[1]}\`;`)(PRESET_NAMES, PROVIDER_PRESETS);
}
