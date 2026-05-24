const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

const renderTemplate = (template, variables, recipientNumber) => {
  if (template == null) return template;
  return String(template).replace(PLACEHOLDER_RE, (_, name) => {
    if (!Object.prototype.hasOwnProperty.call(variables, name)) {
      throw new Error(`Missing template variable "${name}" for recipient ${recipientNumber}`);
    }
    return String(variables[name]);
  });
};

export function buildTemplatedSendMessages(args) {
  const recipients = args.recipients;
  if (!Array.isArray(recipients) || recipients.length === 0) throw new Error('Missing recipients array');
  if (recipients.length > 50) throw new Error('Maximum 50 templated recipients per sendemail call');
  if (args.to || args.cc || args.bcc) throw new Error('Use either recipients or to/cc/bcc');

  return recipients.map((recipient, index) => {
    if (!recipient || typeof recipient !== 'object') throw new Error(`Invalid recipient at index ${index}`);
    if (!recipient.to) throw new Error(`Missing to for recipient ${index + 1}`);
    const variables = recipient.variables ?? {};
    if (!variables || typeof variables !== 'object' || Array.isArray(variables)) throw new Error(`Invalid variables for recipient ${index + 1}`);
    return {
      to: recipient.to,
      cc: recipient.cc,
      bcc: recipient.bcc,
      subject: renderTemplate(args.subject, variables, index + 1),
      body: renderTemplate(args.body, variables, index + 1),
      htmlBody: renderTemplate(args.htmlBody, variables, index + 1),
    };
  });
}
