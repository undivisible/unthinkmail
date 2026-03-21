// Hub and landing page HTML
// Single page — no accounts, no login. Enter creds, get a key.

const TAILWIND_CONFIG = `
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: '#050505',
        border:  '#141414',
        muted:   '#1a1a1a',
        dim:     '#2a2a2a',
        sub:     '#444',
        body:    '#d0d0d0',
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
  input:-webkit-autofill{-webkit-text-fill-color:#d0d0d0!important;-webkit-box-shadow:0 0 0 1000px #080808 inset!important}
  pre{font-family:'SF Mono',Monaco,monospace;white-space:pre-wrap;word-break:break-all}
</style>`;

export const LANDING = `<!DOCTYPE html>
<html lang="en" class="dark bg-black">
<head>${HEAD('unthinkmail')}</head>
<body class="bg-black text-body min-h-screen flex items-center justify-center">
<div class="max-w-lg w-full mx-auto px-6 py-16 text-center">
  <h1 class="text-4xl font-thin tracking-tight text-white mb-1">unthinkmail</h1>
  <p class="text-sub text-sm mb-8">connect any email to any ai via imap</p>

  <div class="grid grid-cols-2 gap-3 mb-8 text-left">
    <div class="bg-surface border border-border rounded-lg p-4">
      <p class="text-xs uppercase tracking-widest text-dim mb-2">any provider</p>
      <p class="text-sub text-xs">gmail, outlook, fastmail, purelymail — if it speaks imap, it works.</p>
    </div>
    <div class="bg-surface border border-border rounded-lg p-4">
      <p class="text-xs uppercase tracking-widest text-dim mb-2">mcp protocol</p>
      <p class="text-sub text-xs">expose your inbox as tools for any ai. search, read, compose, send.</p>
    </div>
    <div class="bg-surface border border-border rounded-lg p-4">
      <p class="text-xs uppercase tracking-widest text-dim mb-2">no accounts</p>
      <p class="text-sub text-xs">enter your imap credentials, get an encrypted key. nothing stored server-side.</p>
    </div>
    <div class="bg-surface border border-border rounded-lg p-4">
      <p class="text-xs uppercase tracking-widest text-dim mb-2">open source</p>
      <p class="text-sub text-xs">workers + zig. unlimited users, no seat limits, no vendor lock-in.</p>
    </div>
  </div>

  <a href="/hub" class="inline-block px-6 py-2 border border-dim rounded-md text-sub text-xs tracking-wider hover:text-white hover:border-sub transition-colors">
    get your key
  </a>

  <div class="mt-16 text-xs text-muted space-x-3">
    <a href="https://buymeacoffee.com/undivisible" class="hover:text-sub transition-colors">buy me a coffee</a>
    <span class="text-border">·</span>
    <a href="https://github.com/undivisible/unthinkmail" class="hover:text-sub transition-colors">source</a>
  </div>
</div>
</body>
</html>`;

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
      const k = this.key || 'pm_your_key_here';
      return JSON.stringify({
        mcpServers: {
          unthinkmail: { url: this.endpoint, headers: { Authorization: 'Bearer ' + k } }
        }
      }, null, 2);
    },
  };
}`;

export const HUB = `<!DOCTYPE html>
<html lang="en" class="dark bg-black">
<head>${HEAD('unthinkmail')}</head>
<body class="bg-black text-body min-h-screen" x-data="hub()" x-cloak>
<script>${HUB_SCRIPT}<\/script>

<div class="max-w-lg mx-auto px-6 py-12">

  <div class="mb-8">
    <a href="/" class="text-white font-light text-lg hover:text-sub transition-colors">unthinkmail</a>
    <p class="text-sub text-xs mt-1">enter your email credentials to get an encrypted api key. nothing is stored.</p>
  </div>

  <!-- Provider presets -->
  <div class="flex gap-2 mb-5 flex-wrap">
    <span class="text-xs text-dim self-center">quick fill:</span>
    <template x-for="p in ['purelymail','gmail','outlook','fastmail']">
      <button @click="preset(p)"
        class="text-xs border border-border text-muted px-2.5 py-1 rounded hover:text-body hover:border-dim transition-colors"
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

    <div x-show="error" class="text-xs text-red-700 py-1" x-text="error"></div>

    <button @click="generate()" :disabled="loading"
      class="w-full bg-surface border border-dim text-sub text-xs rounded-md py-2.5 hover:text-white hover:border-sub transition-colors disabled:opacity-40">
      <span x-text="loading ? 'generating...' : 'generate key'"></span>
    </button>
  </div>

  <!-- Key output -->
  <div x-show="key" class="mt-4">
    <div class="bg-green-950/10 border border-green-950/60 rounded-lg p-4">
      <div class="flex justify-between items-center mb-2">
        <span class="text-xs text-green-800">your api key — save this somewhere safe</span>
        <button @click="copy(key)"
          class="text-xs border border-green-950 text-green-900 px-3 py-1 rounded hover:text-green-600 transition-colors"
          x-text="copied ? 'copied!' : 'copy'"></button>
      </div>
      <pre class="text-green-900 text-xs break-all" x-text="key"></pre>
    </div>

    <div class="mt-4 space-y-3">
      <div class="bg-surface border border-border rounded-lg p-4">
        <div class="flex justify-between items-center mb-2">
          <p class="text-xs text-dim uppercase tracking-widest">claude desktop / claude code</p>
          <button @click="copy(claudeCfg)" class="text-xs border border-border text-muted px-2 py-1 rounded hover:text-body transition-colors">copy</button>
        </div>
        <pre class="text-sub text-xs" x-text="claudeCfg"></pre>
      </div>

      <div class="bg-surface border border-border rounded-lg p-4">
        <p class="text-xs text-dim uppercase tracking-widest mb-2">endpoint</p>
        <div class="flex justify-between items-center">
          <pre class="text-sub text-xs" x-text="endpoint"></pre>
          <button @click="copy(endpoint)" class="text-xs border border-border text-muted px-2 py-1 rounded hover:text-body transition-colors ml-3">copy</button>
        </div>
      </div>

      <p class="text-xs text-muted">same credentials always produce the same key. re-enter them here any time to recover it.</p>
    </div>
  </div>

</div>
</body>
</html>`;
