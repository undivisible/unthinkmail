import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const endpoint = process.env.UNTHINKMAIL_MCP_URL || 'https://unthinkmail.undivisible.dev/mcp';
const token = process.env.UNTHINKMAIL_KEY;
const to = process.env.TO;
const subject = process.env.SUBJECT || 'Local attachment';
const body = process.env.BODY || 'Attached.';
const file = process.env.ATTACHMENT_FILE || process.argv[2];
const filename = process.env.ATTACHMENT_FILENAME || basename(file || '');
const mimeType = process.env.ATTACHMENT_MIME_TYPE || 'application/octet-stream';

if (!token || !to || !file) {
  console.error('Required env: UNTHINKMAIL_KEY, TO, ATTACHMENT_FILE or first arg');
  process.exit(1);
}

const bytes = await readFile(file);
const contentBase64 = bytes.toString('base64');

const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: crypto.randomUUID(),
    method: 'tools/call',
    params: {
      name: 'sendemail',
      arguments: {
        to,
        subject,
        body,
        attachments: [
          {
            filename,
            mimeType,
            contentBase64,
          },
        ],
      },
    },
  }),
});

const result = await response.json();
console.log(JSON.stringify(result, null, 2));
if (!response.ok || result.error || result.result?.isError) process.exit(1);
