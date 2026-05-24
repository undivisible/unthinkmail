import { expect, test } from 'bun:test';
import { buildTemplatedSendMessages } from '../src/send-template.js';

test('buildTemplatedSendMessages renders subject and bodies per recipient variables', () => {
  const messages = buildTemplatedSendMessages({
    subject: 'Hello {name}',
    body: 'Hi {name}, your code is {code}.',
    htmlBody: '<p>Hi {name}</p>',
    recipients: [
      { to: 'ada@example.com', variables: { name: 'Ada', code: 'A1' } },
      { to: 'grace@example.com', cc: 'manager@example.com', variables: { name: 'Grace', code: 'G2' } },
    ],
  });

  expect(messages).toEqual([
    {
      to: 'ada@example.com',
      cc: undefined,
      bcc: undefined,
      subject: 'Hello Ada',
      body: 'Hi Ada, your code is A1.',
      htmlBody: '<p>Hi Ada</p>',
    },
    {
      to: 'grace@example.com',
      cc: 'manager@example.com',
      bcc: undefined,
      subject: 'Hello Grace',
      body: 'Hi Grace, your code is G2.',
      htmlBody: '<p>Hi Grace</p>',
    },
  ]);
});

test('buildTemplatedSendMessages fails before sending when any recipient is missing a variable', () => {
  expect(() =>
    buildTemplatedSendMessages({
      subject: 'Hello {name}',
      body: 'Hi {name}, your code is {code}.',
      recipients: [
        { to: 'ada@example.com', variables: { name: 'Ada', code: 'A1' } },
        { to: 'grace@example.com', variables: { name: 'Grace' } },
      ],
    }),
  ).toThrow('Missing template variable "code" for recipient 2');
});

test('buildTemplatedSendMessages rejects mixed top-level and per-recipient addresses', () => {
  expect(() =>
    buildTemplatedSendMessages({
      to: 'everyone@example.com',
      subject: 'Hello {name}',
      body: 'Hi {name}.',
      recipients: [{ to: 'ada@example.com', variables: { name: 'Ada' } }],
    }),
  ).toThrow('Use either recipients or to/cc/bcc');
});
