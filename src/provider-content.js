export const PROVIDER_PRESETS = {
  purelymail: { ih: 'imap.purelymail.com', ip: '993', sh: 'smtp.purelymail.com', sp: '587', note: 'Use your email password' },
  gmail: { ih: 'imap.gmail.com', ip: '993', sh: 'smtp.gmail.com', sp: '587', note: 'Requires app password (see below)' },
  outlook: { ih: 'outlook.office365.com', ip: '993', sh: 'smtp.office365.com', sp: '587', note: 'Use your email password' },
  fastmail: { ih: 'imap.fastmail.com', ip: '993', sh: 'smtp.fastmail.com', sp: '465', note: 'Use your password or app password' },
  icloud: { ih: 'imap.mail.me.com', ip: '993', sh: 'smtp.mail.me.com', sp: '587', note: 'Use an app-specific password' },
};

export const PRESET_NAMES = Object.keys(PROVIDER_PRESETS);

export const PROVIDER_GUIDE_HTML = `
      <div>
        <p class="text-body text-xs font-medium mb-1">gmail app password setup</p>
        <ol class="text-dim space-y-1 list-decimal list-inside text-xs">
          <li>go to your google account → security</li>
          <li>enable 2-step verification if not already on</li>
          <li>search for "app passwords" or go to → app passwords</li>
          <li>create a new app password named "unthinkmail"</li>
          <li>use this 16-character password in the form above (not your regular gmail password)</li>
        </ol>
        <p class="text-dim text-xs mt-2">smtp uses port 587 (submission with tls). imap uses port 993.</p>
      </div>

      <div class="border-t border-border"></div>

      <div>
        <p class="text-body text-xs font-medium mb-1">outlook / office 365</p>
        <ol class="text-dim space-y-1 list-decimal list-inside text-xs">
          <li>sign in to your microsoft account</li>
          <li>if using 2fa, go to security → app passwords</li>
          <li>create a new app password for unthinkmail</li>
          <li>use this password in the form above</li>
        </ol>
        <p class="text-dim text-xs mt-2">settings: imap.outlook.office365.com:993, smtp.office365.com:587 (tls). use your full email as username.</p>
      </div>

      <div class="border-t border-border"></div>

      <div>
        <p class="text-body text-xs font-medium mb-1">fastmail</p>
        <ol class="text-dim space-y-1 list-decimal list-inside text-xs">
          <li>go to fastmail → settings → security</li>
          <li>scroll to "app passwords" and create a new one</li>
          <li>name it "unthinkmail" and copy the password</li>
          <li>use this password in the form above</li>
        </ol>
        <p class="text-dim text-xs mt-2">settings: imap.fastmail.com:993 (ssl), smtp.fastmail.com:465 (ssl) or 587 (starttls). use your full email as username.</p>
      </div>

      <div class="border-t border-border"></div>

      <div>
        <p class="text-body text-xs font-medium mb-1">icloud mail</p>
        <ol class="text-dim space-y-1 list-decimal list-inside text-xs">
          <li>create an app-specific password for your Apple Account.</li>
          <li>use the local part of your iCloud address for IMAP if it connects; otherwise use the full address.</li>
          <li>use the app-specific password in the form above.</li>
        </ol>
        <p class="text-dim text-xs mt-2">settings: imap.mail.me.com:993 (ssl), smtp.mail.me.com:587 (ssl/starttls). SMTP username should be your full iCloud email address.</p>
      </div>

      <div class="border-t border-border"></div>

      <div>
        <p class="text-body text-xs font-medium mb-1">purelymail</p>
        <p class="text-dim text-xs">if you have 2fa enabled on your purelymail account, generate an app password in your account settings and use that. otherwise, use your regular password.</p>
        <p class="text-dim text-xs mt-2">settings: imap.purelymail.com:993 (ssl), smtp.purelymail.com:587 (starttls).</p>
      </div>

      <div class="border-t border-border"></div>

      <div>
        <p class="text-body text-xs font-medium mb-1">security</p>
        <p class="text-dim">your credentials are never stored — they're encoded into the access token itself and decrypted per-request. use an app-specific password if your provider supports it (gmail, outlook, fastmail, and icloud all do). to revoke access, just disable the app password at your email provider.</p>
      </div>
`;
