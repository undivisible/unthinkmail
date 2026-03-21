// Hub and landing page HTML
// Single page — no accounts, no login. Enter creds, get a key.

const TAILWIND_CONFIG = `
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: '#0e0e0e',
        border:  '#1e1e1e',
        muted:   '#2a2a2a',
        dim:     '#3d3d3d',
        sub:     '#686868',
        body:    '#e2e2e2',
      },
      fontFamily: {
        mono: ["'SF Mono'", 'Monaco', 'monospace'],
      },
    }
  }
}`;

const HEAD = (title) => `
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<script src="https://cdn.tailwindcss.com"><\/script>
<script>${TAILWIND_CONFIG}<\/script>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"><\/script>
<style>
  [x-cloak]{display:none!important}
  input:-webkit-autofill{-webkit-text-fill-color:#e2e2e2!important;-webkit-box-shadow:0 0 0 1000px #0e0e0e inset!important}
  pre{font-family:'SF Mono',Monaco,monospace;white-space:pre-wrap;word-break:break-all}
</style>`;

const FOOTER_LINKS = `
  <div class="mt-12 text-xs text-dim space-x-3 text-center">
    <a href="https://undivisible.dev" class="hover:text-sub transition-colors">undivisible.dev</a>
    <span class="text-border">·</span>
    <a href="https://buymeacoffee.com/undivisible" class="hover:text-sub transition-colors">donate</a>
    <span class="text-border">·</span>
    <a href="https://github.com/undivisible/unthinkmail" class="hover:text-sub transition-colors">source</a>
  </div>`;

const HUB_SCRIPT = `
function hub() {
  return {
    // form state
    f: {
      imapHost: '', imapPort: '993',
      smtpHost: '', smtpPort: '465',
      user: '', pass: '',
    },
    loading: false,
    key: null,
    error: null,
    copied: false,
    showAbout: false,

    // Pre-fill smtp host when imap host changes
    imapHostChanged() {
      if (!this.f.smtpHost || this.f.smtpHost === this.lastImapHost) {
        this.f.smtpHost = this.f.imapHost.replace('imap.', 'smtp.');
      }
      this.lastImapHost = this.f.imapHost;
    },

    // Populate from a known provider preset
    preset(p) {
      const presets = {
        purelymail: { ih: 'imap.purelymail.com', ip: '993', sh: 'smtp.purelymail.com', sp: '465' },
        gmail:      { ih: 'imap.gmail.com',       ip: '993', sh: 'smtp.gmail.com',      sp: '465' },
        outlook:    { ih: 'outlook.office365.com', ip: '993', sh: 'smtp.office365.com', sp: '587' },
        fastmail:   { ih: 'imap.fastmail.com',     ip: '993', sh: 'smtp.fastmail.com',  sp: '465' },
      };
      const r = presets[p]; if (!r) return;
      this.f.imapHost = r.ih; this.f.imapPort = r.ip;
      this.f.smtpHost = r.sh; this.f.smtpPort = r.sp;
    },

    async generate() {
      this.error = null;
      const { imapHost, imapPort, smtpHost, smtpPort, user, pass } = this.f;
      if (!imapHost || !user || !pass) { this.error = 'imap host, username, and password are required'; return; }
      this.loading = true;
      try {
        const r = await fetch('/api/key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imap_host: imapHost, imap_port: parseInt(imapPort) || 993,
            smtp_host: smtpHost || imapHost, smtp_port: parseInt(smtpPort) || 465,
            imap_user: user, imap_pass: pass,
          }),
        });
        const d = await r.json();
        if (!r.ok) { this.error = d.error || 'HTTP ' + r.status; return; }
        this.key = d.key;
        this.f.pass = ''; // clear password from form
      } catch(e) { this.error = e.message; }
      finally { this.loading = false; }
    },

    async copy(text) {
      await navigator.clipboard.writeText(text);
      this.copied = true;
      setTimeout(() => { this.copied = false; }, 2000);
    },

    get endpoint() { return 'https://unthinkmail.undivisible.dev/mcp'; },

    get claudeCfg() {
      const k = this.key || 'um_your_key_here';
      return JSON.stringify({
        mcpServers: {
          unthinkmail: { url: this.endpoint, headers: { Authorization: 'Bearer ' + k } }
        }
      }, null, 2);
    },
  };
}`;

const ABOUT_SECTION = `
  <!-- About / Setup instructions -->
  <div class="mt-6">
    <button @click="showAbout = !showAbout"
      class="w-full text-xs text-dim border border-border rounded-md py-2 hover:text-sub hover:border-dim transition-colors flex items-center justify-center gap-2">
      <span x-text="showAbout ? 'hide setup guide' : 'how to connect to your ai'"></span>
      <span x-text="showAbout ? '↑' : '↓'" class="text-muted"></span>
    </button>

    <div x-show="showAbout" x-transition class="mt-3 bg-surface border border-border rounded-lg p-5 space-y-4 text-xs text-sub">
      <div>
        <p class="text-body text-xs font-medium mb-1">1. get your key</p>
        <p class="text-dim">enter your imap credentials above and click generate. the same credentials always produce the same key — enter them again any time to recover it. nothing is stored on our side.</p>
      </div>

      <div>
        <p class="text-body text-xs font-medium mb-1">2. configure your ai client</p>
        <p class="text-dim mb-2">your ai client needs two things:</p>
        <div class="bg-black rounded-md p-3 space-y-1 font-mono">
          <p><span class="text-dim">endpoint</span>  <span class="text-sub">https://unthinkmail.undivisible.dev/mcp</span></p>
          <p><span class="text-dim">auth     </span>  <span class="text-sub">Bearer &lt;your key&gt;</span></p>
        </div>
        <p class="text-dim mt-2">look for "mcp servers", "tools", or "integrations" in your ai app's settings. paste the endpoint and set the authorization header.</p>
      </div>

      <div>
        <p class="text-body text-xs font-medium mb-1">3. what the ai can do</p>
        <ul class="text-dim space-y-0.5 list-disc list-inside">
          <li>list your mail folders</li>
          <li>search messages by keyword, sender, date</li>
          <li>read full message content</li>
          <li>move messages between folders</li>
          <li>delete messages</li>
        </ul>
      </div>

      <div>
        <p class="text-body text-xs font-medium mb-1">security</p>
        <p class="text-dim">your key is your credentials, aes-256 encrypted. the server decrypts them per-request — nothing is stored. use an app-specific password if your provider supports it (gmail, outlook, fastmail all do). to revoke access, just disable the app password at your email provider.</p>
      </div>
    </div>
  </div>`;

export const HUB = `<!DOCTYPE html>
<html lang="en" class="dark bg-black">
<head>${HEAD('unthinkmail')}</head>
<body class="bg-black text-body min-h-screen" x-data="hub()" x-cloak>
<script>${HUB_SCRIPT}<\/script>

<div class="max-w-lg mx-auto px-6 py-12">

  <div class="mb-8">
    <h1 class="text-white font-light text-2xl mb-1">unthinkmail</h1>
    <p class="text-sub text-xs">give your ai access to your email inbox via mcp</p>
    <p class="text-dim text-xs mt-2 leading-relaxed max-w-sm">enter your imap credentials to get an encrypted api key. same credentials always produce the same key. nothing is stored.</p>
  </div>

  <!-- Provider presets -->
  <div class="flex gap-2 mb-5 flex-wrap">
    <span class="text-xs text-dim self-center">quick fill:</span>
    <template x-for="p in ['purelymail','gmail','outlook','fastmail']">
      <button @click="preset(p)"
        class="text-xs border border-border text-dim px-2.5 py-1 rounded hover:text-body hover:border-dim transition-colors"
        x-text="p"></button>
    </template>
  </div>

  <!-- Credentials form -->
  <div class="bg-surface border border-border rounded-lg p-5 space-y-3">

    <div class="grid grid-cols-[1fr_6rem] gap-2">
      <div>
        <label class="text-xs text-dim block mb-1">imap host</label>
        <input x-model="f.imapHost" @input="imapHostChanged()" type="text" placeholder="imap.example.com" autocomplete="off" spellcheck="false"
          class="w-full bg-black border border-border text-body text-sm rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted font-mono">
      </div>
      <div>
        <label class="text-xs text-dim block mb-1">port</label>
        <input x-model="f.imapPort" type="number" placeholder="993"
          class="w-full bg-black border border-border text-body text-sm rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted font-mono">
      </div>
    </div>

    <div class="grid grid-cols-[1fr_6rem] gap-2">
      <div>
        <label class="text-xs text-dim block mb-1">smtp host</label>
        <input x-model="f.smtpHost" type="text" placeholder="smtp.example.com" autocomplete="off" spellcheck="false"
          class="w-full bg-black border border-border text-body text-sm rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted font-mono">
      </div>
      <div>
        <label class="text-xs text-dim block mb-1">port</label>
        <input x-model="f.smtpPort" type="number" placeholder="465"
          class="w-full bg-black border border-border text-body text-sm rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted font-mono">
      </div>
    </div>

    <div>
      <label class="text-xs text-dim block mb-1">email / username</label>
      <input x-model="f.user" type="email" placeholder="you@example.com" autocomplete="email"
        class="w-full bg-black border border-border text-body text-sm rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted font-mono">
    </div>

    <div>
      <label class="text-xs text-dim block mb-1">password <span class="text-muted">(app password if 2fa enabled)</span></label>
      <input x-model="f.pass" type="password" placeholder="••••••••" autocomplete="current-password"
        @keydown.enter="generate()"
        class="w-full bg-black border border-border text-body text-sm rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted">
    </div>

    <div x-show="error" class="text-xs text-red-600 py-1" x-text="error"></div>

    <button @click="generate()" :disabled="loading"
      class="w-full bg-surface border border-dim text-sub text-xs rounded-md py-2.5 hover:text-white hover:border-sub transition-colors disabled:opacity-40">
      <span x-text="loading ? 'generating...' : 'generate key'"></span>
    </button>
  </div>

  <!-- Key output -->
  <div x-show="key" class="mt-4">
    <div class="bg-green-950/10 border border-green-900/30 rounded-lg p-4">
      <div class="flex justify-between items-center mb-2">
        <span class="text-xs text-green-700">your api key — save this somewhere safe</span>
        <button @click="copy(key)"
          class="text-xs border border-green-900/40 text-green-800 px-3 py-1 rounded hover:text-green-500 transition-colors"
          x-text="copied ? 'copied!' : 'copy'"></button>
      </div>
      <pre class="text-green-700 text-xs break-all" x-text="key"></pre>
    </div>

    <div class="mt-4 space-y-3">
      <div class="bg-surface border border-border rounded-lg p-4">
        <div class="flex justify-between items-center mb-2">
          <p class="text-xs text-dim uppercase tracking-widest">claude desktop / claude code</p>
          <button @click="copy(claudeCfg)" class="text-xs border border-border text-dim px-2 py-1 rounded hover:text-body transition-colors">copy</button>
        </div>
        <pre class="text-sub text-xs" x-text="claudeCfg"></pre>
      </div>

      <div class="bg-surface border border-border rounded-lg p-4">
        <p class="text-xs text-dim uppercase tracking-widest mb-2">endpoint</p>
        <div class="flex justify-between items-center">
          <pre class="text-sub text-xs" x-text="endpoint"></pre>
          <button @click="copy(endpoint)" class="text-xs border border-border text-dim px-2 py-1 rounded hover:text-body transition-colors ml-3">copy</button>
        </div>
      </div>

      <p class="text-xs text-dim">same credentials always produce the same key. re-enter them here any time to recover it.</p>
    </div>
  </div>

  ${ABOUT_SECTION}

  ${FOOTER_LINKS}

</div>
</body>
</html>`;
