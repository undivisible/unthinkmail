import { expect, test } from 'bun:test';

test('MCP tool surface does not expose batchsend', async () => {
  const sessionSource = await Bun.file('src/session.js').text();

  expect(sessionSource).not.toContain("name: 'batchsend'");
  expect(sessionSource).not.toContain("if (name === 'batchsend')");
});

test('sendemail schema exposes templated recipients', async () => {
  const sessionSource = await Bun.file('src/session.js').text();

  expect(sessionSource).toContain('recipients: TEMPLATED_RECIPIENTS_SCHEMA');
  expect(sessionSource).toContain('variables: { type:');
});
