import { expect, test } from 'bun:test';
import { MAX_ATTACHMENTS, buildMimeMessage, buildRecipientLists, normalizeAttachments } from '../src/outbound-mime.js';

test('buildMimeMessage keeps simple text messages as text/plain', () => {
  const message = buildMimeMessage({
    from: 'sender@example.com',
    to: 'recipient@example.com',
    subject: 'Hello',
    body: 'Plain body',
  });

  expect(message).toContain('Content-Type: text/plain; charset=utf-8');
  expect(message).not.toContain('multipart/mixed');
  expect(message).toEndWith('Plain body');
});

test('buildRecipientLists includes bcc only in envelope recipients', () => {
  const recipients = buildRecipientLists({
    to: ['primary@example.com', ' second@example.com '],
    cc: 'copy@example.com, other-copy@example.com',
    bcc: ['hidden@example.com', ' hidden-two@example.com '],
  });

  expect(recipients.toList).toEqual(['primary@example.com', 'second@example.com']);
  expect(recipients.ccList).toEqual(['copy@example.com', 'other-copy@example.com']);
  expect(recipients.bccList).toEqual(['hidden@example.com', 'hidden-two@example.com']);
  expect(recipients.envelopeRecipients).toEqual([
    'primary@example.com',
    'second@example.com',
    'copy@example.com',
    'other-copy@example.com',
    'hidden@example.com',
    'hidden-two@example.com',
  ]);
});

test('buildMimeMessage only emits bcc when explicitly requested for drafts', () => {
  const sentMessage = buildMimeMessage({
    from: 'sender@example.com',
    to: 'recipient@example.com',
    bcc: ['hidden@example.com'],
    subject: 'Hello',
    body: 'Plain body',
  });
  const draftMessage = buildMimeMessage({
    from: 'sender@example.com',
    to: 'recipient@example.com',
    bcc: ['hidden@example.com'],
    includeBccHeader: true,
    subject: 'Hello',
    body: 'Plain body',
  });

  expect(sentMessage).not.toContain('Bcc: hidden@example.com');
  expect(draftMessage).toContain('Bcc: hidden@example.com');
});

test('buildMimeMessage emits multipart attachments', () => {
  const message = buildMimeMessage({
    from: 'sender@example.com',
    to: ['recipient@example.com'],
    subject: 'With attachment',
    body: 'See attached',
    attachments: [
      {
        filename: 'hello.txt',
        mimeType: 'text/plain',
        content: 'aGVsbG8=',
      },
    ],
  });

  expect(message).toContain('Content-Type: multipart/mixed; boundary="unthinkmail-');
  expect(message).toContain('Content-Type: text/plain; name="hello.txt"');
  expect(message).toContain('Content-Disposition: attachment; filename="hello.txt"');
  expect(message).toContain('Content-Transfer-Encoding: base64');
  expect(message).toContain('aGVsbG8=');
  expect(message).toContain('See attached');
});

test('normalizeAttachments rejects invalid base64 content', () => {
  expect(() => normalizeAttachments([{ filename: 'bad.txt', content: 'not valid base64!!!!' }])).toThrow('valid base64');
});

test('normalizeAttachments rejects too many attachments', () => {
  const attachments = Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => ({
    filename: `file-${i}.txt`,
    content: 'b2s=',
  }));

  expect(() => normalizeAttachments(attachments)).toThrow(`Maximum ${MAX_ATTACHMENTS} attachments`);
});

test('normalizeAttachments sanitizes filenames and MIME types', () => {
  const [attachment] = normalizeAttachments([{ filename: '../résumé.txt', mimeType: 'bad/type/value', content: 'b2s=' }]);

  expect(attachment.filename).toBe('.._resume.txt');
  expect(attachment.mimeType).toBe('application/octet-stream');
  expect(attachment.size).toBe(2);
});

test('normalizeAttachments encodes raw text bytes and data URLs', () => {
  const attachments = normalizeAttachments([
    { filename: 'text.txt', contentText: 'hello' },
    { filename: 'bytes.bin', contentBytes: [1, 2, 3] },
    { filename: 'pixel.png', contentDataUrl: 'data:image/png;base64,aW1n' },
  ]);

  expect(attachments[0].base64).toBe('aGVsbG8=');
  expect(attachments[0].mimeType).toBe('text/plain');
  expect(attachments[1].base64).toBe('AQID');
  expect(attachments[2].mimeType).toBe('image/png');
});

test('buildMimeMessage supports attachment-only messages', () => {
  const message = buildMimeMessage({
    from: 'sender@example.com',
    to: 'recipient@example.com',
    subject: 'Attachment only',
    attachments: [
      {
        filename: 'empty-body.txt',
        content: 'ZmlsZQ==',
      },
    ],
  });

  expect(message).toContain('Content-Type: multipart/mixed; boundary="unthinkmail-');
  expect(message).toContain('filename="empty-body.txt"');
  expect(message).toContain('ZmlsZQ==');
});

test('buildMimeMessage emits html alternative body', () => {
  const message = buildMimeMessage({
    from: 'sender@example.com',
    to: 'recipient@example.com',
    subject: 'HTML',
    body: 'Plain',
    htmlBody: '<p><strong>HTML</strong></p>',
  });

  expect(message).toContain('Content-Type: multipart/alternative; boundary="unthinkmail-alt-');
  expect(message).toContain('Content-Type: text/plain; charset=utf-8');
  expect(message).toContain('Content-Type: text/html; charset=utf-8');
  expect(message).toContain('<p><strong>HTML</strong></p>');
});

test('buildMimeMessage emits inline cid image parts', () => {
  const message = buildMimeMessage({
    from: 'sender@example.com',
    to: 'recipient@example.com',
    subject: 'Inline',
    htmlBody: '<img src="cid:logo">',
    attachments: [
      {
        filename: 'logo.png',
        mimeType: 'image/png',
        content: 'aW1n',
        contentId: 'logo',
        inline: true,
      },
    ],
  });

  expect(message).toContain('Content-Type: multipart/related; boundary="unthinkmail-related-');
  expect(message).toContain('Content-ID: <logo>');
  expect(message).toContain('Content-Disposition: inline; filename="logo.png"');
});
