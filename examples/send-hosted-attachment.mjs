const endpoint = process.env.UNTHINKMAIL_MCP_URL || 'https://unthinkmail.undivisible.dev/mcp';
const token = process.env.UNTHINKMAIL_KEY;
const to = process.env.TO;
const subject = process.env.SUBJECT || 'Hosted attachment';
const body = process.env.BODY || 'Attached.';
const url = process.env.ATTACHMENT_URL;
const filename = process.env.ATTACHMENT_FILENAME;
const mimeType = process.env.ATTACHMENT_MIME_TYPE;

if (!token || !to || !url) {
  console.error('Required env: UNTHINKMAIL_KEY, TO, ATTACHMENT_URL');
  process.exit(1);
}

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
      name: 'sendemailfromurls',
      arguments: {
        to,
        subject,
        body,
        attachmentUrls: [
          {
            url,
            ...(filename ? { filename } : {}),
            ...(mimeType ? { mimeType } : {}),
          },
        ],
      },
    },
  }),
});

const result = await response.json();
console.log(JSON.stringify(result, null, 2));
if (!response.ok || result.error || result.result?.isError) process.exit(1);
