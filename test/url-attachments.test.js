import { expect, test } from 'bun:test';
import { fetchUrlAttachments } from '../src/url-attachments.js';

test('fetchUrlAttachments downloads HTTPS files into byte attachments', async () => {
  const attachments = await fetchUrlAttachments([
    'https://files.example.com/reports/report.pdf',
  ], async () => new Response(new Uint8Array([1, 2, 3]), {
    headers: {
      'content-type': 'application/pdf',
      'content-length': '3',
    },
  }));

  expect(attachments).toHaveLength(1);
  expect(attachments[0].filename).toBe('report.pdf');
  expect(attachments[0].mimeType).toBe('application/pdf');
  expect([...attachments[0].bytes]).toEqual([1, 2, 3]);
});

test('fetchUrlAttachments honors filename and content type overrides', async () => {
  const attachments = await fetchUrlAttachments([
    { url: 'https://files.example.com/download', filename: 'invoice.txt', mimeType: 'text/plain' },
  ], async () => new Response('hello', {
    headers: {
      'content-type': 'application/octet-stream',
    },
  }));

  expect(attachments[0].filename).toBe('invoice.txt');
  expect(attachments[0].mimeType).toBe('text/plain');
});

test('fetchUrlAttachments rejects non-HTTPS URLs', async () => {
  await expect(fetchUrlAttachments([
    'http://files.example.com/report.pdf',
  ], async () => new Response('x'))).rejects.toThrow('https');
});

test('fetchUrlAttachments rejects oversized content length', async () => {
  await expect(fetchUrlAttachments([
    'https://files.example.com/large.bin',
  ], async () => new Response('x', {
    headers: {
      'content-length': String(11 * 1024 * 1024),
    },
  }))).rejects.toThrow('10MB');
});
