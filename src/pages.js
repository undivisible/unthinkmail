// Hub and landing page HTML
// Uses Alpine.js + Tailwind CDN — no build step required

const TAILWIND_CONFIG = `
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: '#050505',
        border: '#141414',
        muted: '#1a1a1a',
        dim: '#2a2a2a',
        sub: '#444',
        body: '#d0d0d0',
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
  .otp-input{width:2.6rem;text-align:center;font-size:1.3rem;font-weight:200;letter-spacing:.05em;padding:.4rem .2rem;background:#080808;border:1px solid #1a1a1a;border-radius:.4rem;color:#ccc;outline:none}
  .otp-input:focus{border-color:#333}
  .tab-active{color:#ccc;border-bottom:2px solid #ccc}
  .tab-inactive{color:#333;border-bottom:2px solid transparent}
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
      <p class="text-xs uppercase tracking-widest text-dim mb-2">encrypted</p>
      <p class="text-sub text-xs">aes-256-gcm per-user key derivation. credentials never in plaintext.</p>
    </div>
    <div class="bg-surface border border-border rounded-lg p-4">
      <p class="text-xs uppercase tracking-widest text-dim mb-2">open source</p>
      <p class="text-sub text-xs">workers + zig. unlimited users, no seat limits, no vendor lock-in.</p>
    </div>
  </div>

  <a href="/hub" class="inline-block px-6 py-2 border border-dim rounded-md text-sub text-xs tracking-wider hover:text-white hover:border-sub transition-colors">
    open hub
  </a>

  <div class="mt-16 text-xs text-muted space-x-3">
    <a href="https://buymeacoffee.com/undivisible" class="hover:text-sub transition-colors">buy me a coffee</a>
    <span class="text-border">·</span>
    <a href="https://github.com/undivisible/unthinkmail" class="hover:text-sub transition-colors">source</a>
  </div>
</div>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Hub Alpine component
// ---------------------------------------------------------------------------

const HUB_SCRIPT = `
function hub() {
  return {
    // state
    loading: true,
    user: null,
    token: localStorage.getItem('um_tok'),
    toast: { msg: '', ok: true, show: false },
    activeTab: 'email',

    // auth
    authStep: 'email',
    authEmail: '',
    authCode: '',
    authLoading: false,

    // email tab
    cred: null,
    credLoading: false,
    fields: { imapHost:'', imapPort:'993', smtpHost:'', smtpPort:'465', user:'', pass:'' },

    // keys tab
    keys: [],
    keyLabel: '',
    newKey: null,
    keysLoading: false,

    async init() {
      if (this.token) {
        try {
          const me = await this.api('/api/auth/me');
          this.user = me;
          await this.loadCreds();
        } catch {
          this.token = null;
          localStorage.removeItem('um_tok');
        }
      }
      this.loading = false;
    },

    async api(path, opts = {}) {
      const headers = { 'Content-Type': 'application/json', ...opts.headers };
      if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
      const r = await fetch(path, { ...opts, headers });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401 && this.user) { this.signOut(); throw new Error('Session expired'); }
      if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
      return d;
    },

    notify(msg, ok = true) {
      this.toast = { msg, ok, show: true };
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => { this.toast.show = false; }, 3000);
    },

    signOut() {
      this.token = null;
      this.user = null;
      this.cred = null;
      this.keys = [];
      this.newKey = null;
      localStorage.removeItem('um_tok');
      this.authStep = 'email';
      this.authEmail = '';
      this.authCode = '';
    },

    /* --- OTP auth --- */
    async requestOtp() {
      const email = this.authEmail.trim();
      if (!email || !email.includes('@')) { this.notify('enter a valid email', false); return; }
      this.authLoading = true;
      try {
        await this.api('/api/auth/otp/request', { method: 'POST', body: JSON.stringify({ email }) });
        this.authStep = 'code';
        this.notify('check your inbox', true);
        this.$nextTick(() => { const f = document.querySelector('.otp-input'); if (f) f.focus(); });
      } catch(e) { this.notify(e.message, false); }
      finally { this.authLoading = false; }
    },

    async verifyOtp() {
      const code = this.authCode.replace(/\\s/g, '');
      if (code.length !== 6) { this.notify('enter all 6 digits', false); return; }
      this.authLoading = true;
      try {
        const d = await this.api('/api/auth/otp/verify', {
          method: 'POST', body: JSON.stringify({ email: this.authEmail.trim(), code })
        });
        this.token = d.token;
        localStorage.setItem('um_tok', d.token);
        const me = await this.api('/api/auth/me');
        this.user = me;
        await this.loadCreds();
      } catch(e) {
        this.notify(e.message, false);
        this.authCode = '';
        this.$nextTick(() => { const f = document.querySelector('.otp-input'); if (f) f.focus(); });
      } finally { this.authLoading = false; }
    },

    /* --- Tabs --- */
    async setTab(tab) {
      this.activeTab = tab;
      if (tab === 'email') await this.loadCreds();
      if (tab === 'keys') await this.loadKeys();
    },

    /* --- Credentials --- */
    async loadCreds() {
      this.credLoading = true;
      try {
        this.cred = await this.api('/api/credentials');
        this.fields.imapHost = this.cred.imap_host || '';
        this.fields.imapPort = this.cred.imap_port || '993';
        this.fields.smtpHost = this.cred.smtp_host || '';
        this.fields.smtpPort = this.cred.smtp_port || '465';
        this.fields.user = this.cred.imap_user || '';
        this.fields.pass = '';
      } catch(e) {
        if (e.message === 'No credentials stored') this.cred = null;
      } finally { this.credLoading = false; }
    },

    async saveCreds() {
      const { imapHost, imapPort, smtpHost, smtpPort, user, pass } = this.fields;
      if (!imapHost || !smtpHost || !user || !pass) { this.notify('all fields required', false); return; }
      try {
        await this.api('/api/credentials', { method: 'PUT', body: JSON.stringify({
          imap_host: imapHost, imap_port: parseInt(imapPort) || 993,
          smtp_host: smtpHost, smtp_port: parseInt(smtpPort) || 465,
          imap_user: user, imap_pass: pass
        })});
        this.notify('credentials saved');
        this.fields.pass = '';
        await this.loadCreds();
      } catch(e) { this.notify(e.message, false); }
    },

    async deleteCreds() {
      if (!confirm('remove stored credentials?')) return;
      try {
        await this.api('/api/credentials', { method: 'DELETE' });
        this.cred = null;
        Object.keys(this.fields).forEach(k => { this.fields[k] = ''; });
        this.fields.imapPort = '993';
        this.fields.smtpPort = '465';
        this.notify('credentials removed');
      } catch(e) { this.notify(e.message, false); }
    },

    /* --- API Keys --- */
    async loadKeys() {
      this.keysLoading = true;
      try { const d = await this.api('/api/keys'); this.keys = d.keys || []; }
      catch(e) { this.notify(e.message, false); }
      finally { this.keysLoading = false; }
    },

    async createKey() {
      try {
        const d = await this.api('/api/keys', { method: 'POST', body: JSON.stringify({ label: this.keyLabel || null }) });
        this.newKey = d.key;
        this.keyLabel = '';
        this.notify('key created — copy it now');
        await this.loadKeys();
      } catch(e) { this.notify(e.message, false); }
    },

    async revokeKey(id) {
      if (!confirm('revoke this key?')) return;
      try {
        await this.api('/api/keys/' + id, { method: 'DELETE' });
        this.newKey = null;
        this.notify('key revoked');
        await this.loadKeys();
      } catch(e) { this.notify(e.message, false); }
    },

    async copy(text) {
      await navigator.clipboard.writeText(text);
      this.notify('copied');
    },

    /* --- Connect tab --- */
    get endpoint() { return 'https://unthinkmail.undivisible.dev/mcp'; },
    get sampleKey() { return this.keys.length ? this.keys[0].key_prefix.replace('...','') + '...' : 'pm_your_key_here'; },
    get claudeCfg() {
      return JSON.stringify({ mcpServers: { unthinkmail: { url: this.endpoint, headers: { Authorization: 'Bearer ' + this.sampleKey } } } }, null, 2);
    },
    get curlCfg() {
      return 'curl -X POST ' + this.endpoint + ' \\\\\\n  -H "Authorization: Bearer ' + this.sampleKey + '" \\\\\\n  -H "Content-Type: application/json" \\\\\\n  -d \'{"jsonrpc":"2.0","method":"tools/list","id":1}\'';
    },
  };
}`;

export const HUB = `<!DOCTYPE html>
<html lang="en" class="dark bg-black">
<head>${HEAD('unthinkmail hub')}</head>
<body class="bg-black text-body min-h-screen" x-data="hub()" x-init="init()" x-cloak>

<!-- Loading -->
<div x-show="loading" class="flex items-center justify-center min-h-screen">
  <div class="w-5 h-5 border border-muted border-t-dim rounded-full animate-spin"></div>
</div>

<!-- Auth screen -->
<div x-show="!loading && !user" class="flex items-center justify-center min-h-screen">
  <div class="w-full max-w-xs px-6">
    <p class="text-white font-light text-lg mb-1">unthinkmail</p>
    <p class="text-sub text-xs mb-6">sign in with your email</p>

    <!-- Step 1: email -->
    <div x-show="authStep === 'email'" style="display:none">
      <div class="space-y-2">
        <input x-model="authEmail" type="email" placeholder="you@example.com" autocomplete="email"
          @keydown.enter="requestOtp()"
          class="w-full bg-surface border border-border text-body text-sm rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted">
        <button @click="requestOtp()" :disabled="authLoading"
          class="w-full bg-surface border border-dim text-sub text-xs rounded-md py-2 hover:text-white hover:border-sub transition-colors disabled:opacity-40">
          <span x-text="authLoading ? 'sending...' : 'send code'"></span>
        </button>
      </div>
    </div>

    <!-- Step 2: OTP code -->
    <div x-show="authStep === 'code'" style="display:none">
      <p class="text-xs text-sub mb-4">code sent to <span x-text="authEmail" class="text-body"></span></p>
      <div class="flex gap-2 justify-center mb-4" id="otp-container">
        <input class="otp-input" maxlength="1" inputmode="numeric" pattern="[0-9]">
        <input class="otp-input" maxlength="1" inputmode="numeric" pattern="[0-9]">
        <input class="otp-input" maxlength="1" inputmode="numeric" pattern="[0-9]">
        <input class="otp-input" maxlength="1" inputmode="numeric" pattern="[0-9]">
        <input class="otp-input" maxlength="1" inputmode="numeric" pattern="[0-9]">
        <input class="otp-input" maxlength="1" inputmode="numeric" pattern="[0-9]">
      </div>
      <div class="space-y-2">
        <button @click="verifyOtp()" :disabled="authLoading"
          class="w-full bg-surface border border-dim text-sub text-xs rounded-md py-2 hover:text-white hover:border-sub transition-colors disabled:opacity-40">
          <span x-text="authLoading ? 'verifying...' : 'verify'"></span>
        </button>
        <button @click="authStep='email'; authCode=''" class="w-full text-xs text-muted py-1 hover:text-sub transition-colors">
          use different email
        </button>
      </div>
    </div>
  </div>
</div>

<!-- Hub -->
<div x-show="!loading && user" class="max-w-xl mx-auto px-6 py-8 pb-16">

  <!-- Nav -->
  <nav class="flex justify-between items-center pb-4 mb-6 border-b border-border">
    <span class="text-white font-light">unthinkmail</span>
    <div class="flex items-center gap-3">
      <span class="text-xs text-dim bg-surface border border-border px-3 py-1 rounded-full max-w-48 truncate" x-text="user?.email"></span>
      <button @click="signOut()" class="text-xs text-sub border border-border px-3 py-1 rounded-md hover:text-white hover:border-dim transition-colors">
        sign out
      </button>
    </div>
  </nav>

  <!-- Tabs -->
  <div class="flex border-b border-border mb-6">
    <template x-for="tab in ['email','keys','connect']">
      <button @click="setTab(tab)"
        :class="activeTab === tab ? 'tab-active' : 'tab-inactive'"
        class="px-4 py-2 text-xs uppercase tracking-widest transition-colors bg-transparent border-0"
        x-text="tab"></button>
    </template>
  </div>

  <!-- Email tab -->
  <div x-show="activeTab === 'email'">
    <p class="text-xs uppercase tracking-widest text-dim mb-4">email credentials</p>

    <!-- Status card -->
    <div class="bg-surface border border-border rounded-lg p-4 mb-3 flex items-center gap-2">
      <div :class="cred ? 'bg-green-900 shadow-[0_0_5px_#1a4a1a]' : 'bg-red-950'"
        class="w-2 h-2 rounded-full flex-shrink-0"></div>
      <span class="text-sm" :class="cred ? 'text-green-700' : 'text-sub'">
        <span x-show="credLoading">checking...</span>
        <span x-show="!credLoading && cred" x-text="cred ? (cred.imap_user + ' @ ' + cred.imap_host + ':' + cred.imap_port) : ''"></span>
        <span x-show="!credLoading && !cred">no email connected</span>
      </span>
    </div>

    <!-- Credential form -->
    <div class="bg-surface border border-border rounded-lg p-4 space-y-3">
      <p class="text-xs uppercase tracking-widest text-dim">imap &amp; smtp</p>
      <div class="grid grid-cols-[1fr_80px] gap-2">
        <input x-model="fields.imapHost" placeholder="imap host (e.g. imap.gmail.com)"
          class="bg-black border border-border text-body text-xs rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted">
        <input x-model="fields.imapPort" placeholder="993"
          class="bg-black border border-border text-body text-xs rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted">
      </div>
      <div class="grid grid-cols-[1fr_80px] gap-2">
        <input x-model="fields.smtpHost" placeholder="smtp host (e.g. smtp.gmail.com)"
          class="bg-black border border-border text-body text-xs rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted">
        <input x-model="fields.smtpPort" placeholder="465"
          class="bg-black border border-border text-body text-xs rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted">
      </div>
      <input x-model="fields.user" placeholder="email / username" autocomplete="off"
        class="w-full bg-black border border-border text-body text-xs rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted">
      <input x-model="fields.pass" type="password" placeholder="password or app password" autocomplete="new-password"
        class="w-full bg-black border border-border text-body text-xs rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted">
      <div class="flex gap-2">
        <button @click="saveCreds()"
          class="bg-surface border border-dim text-sub text-xs rounded-md px-4 py-2 hover:text-white hover:border-sub transition-colors">
          save
        </button>
        <button @click="deleteCreds()"
          class="border border-red-950 text-red-950 text-xs rounded-md px-3 py-2 hover:bg-red-950/20 hover:text-red-500 transition-colors">
          remove
        </button>
      </div>
    </div>

    <!-- Quick reference -->
    <div class="bg-surface border border-border/50 rounded-lg p-4 mt-3">
      <p class="text-xs uppercase tracking-widest text-dim mb-3">quick reference</p>
      <div class="text-xs text-muted leading-loose space-y-0.5">
        <div>gmail &nbsp;·&nbsp; imap.gmail.com:993 / smtp.gmail.com:465 &nbsp;·&nbsp; use app password</div>
        <div>outlook &nbsp;·&nbsp; outlook.office365.com:993 / smtp.office365.com:587</div>
        <div>fastmail &nbsp;·&nbsp; imap.fastmail.com:993 / smtp.fastmail.com:465</div>
        <div>purelymail &nbsp;·&nbsp; imap.purelymail.com:993 / smtp.purelymail.com:465</div>
        <div>protonmail &nbsp;·&nbsp; 127.0.0.1:1143 / 127.0.0.1:1025 &nbsp;·&nbsp; via bridge</div>
      </div>
    </div>
  </div>

  <!-- Keys tab -->
  <div x-show="activeTab === 'keys'">
    <p class="text-xs uppercase tracking-widest text-dim mb-4">api keys</p>

    <div class="bg-surface border border-border rounded-lg p-4 mb-3">
      <div class="grid grid-cols-[1fr_auto] gap-2">
        <input x-model="keyLabel" placeholder="label (optional)"
          class="bg-black border border-border text-body text-xs rounded-md px-3 py-2 outline-none focus:border-dim placeholder-muted">
        <button @click="createKey()"
          class="bg-surface border border-dim text-sub text-xs rounded-md px-4 py-2 hover:text-white hover:border-sub transition-colors whitespace-nowrap">
          generate
        </button>
      </div>
    </div>

    <!-- New key reveal -->
    <div x-show="newKey" class="bg-green-950/20 border border-green-950 rounded-lg p-4 mb-3">
      <div class="flex justify-between items-center mb-2">
        <span class="text-xs text-green-700">copy now — not shown again</span>
        <button @click="copy(newKey)" class="text-xs text-green-800 border border-green-950 px-2 py-1 rounded hover:text-green-600 transition-colors">copy</button>
      </div>
      <code class="text-green-800 text-xs break-all font-mono" x-text="newKey"></code>
    </div>

    <!-- Keys list -->
    <div x-show="keysLoading" class="text-xs text-dim py-4">loading...</div>
    <div x-show="!keysLoading && keys.length === 0" class="text-xs text-muted py-2">no keys yet — generate one above</div>
    <div class="divide-y divide-border/50">
      <template x-for="k in keys" :key="k.id">
        <div class="flex justify-between items-center py-3">
          <div>
            <div class="text-xs text-sub" x-text="k.label || 'unlabeled'"></div>
            <div class="text-xs font-mono text-muted" x-text="k.key_prefix"></div>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-xs text-muted" x-text="new Date(k.created_at).toLocaleDateString()"></span>
            <button @click="revokeKey(k.id)"
              class="text-xs border border-red-950 text-red-950 px-2 py-1 rounded hover:text-red-500 hover:bg-red-950/20 transition-colors">
              revoke
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>

  <!-- Connect tab -->
  <div x-show="activeTab === 'connect'">
    <p class="text-xs uppercase tracking-widest text-dim mb-4">connect your ai</p>

    <div class="space-y-3">
      <div class="bg-surface border border-border rounded-lg p-4">
        <p class="text-xs uppercase tracking-widest text-dim mb-3">endpoint</p>
        <div class="grid grid-cols-[1fr_auto] gap-2 items-start">
          <pre class="bg-black border border-border/50 rounded p-3 text-xs text-sub" x-text="endpoint"></pre>
          <button @click="copy(endpoint)" class="text-xs border border-border px-3 py-2 rounded text-sub hover:text-white transition-colors">copy</button>
        </div>
      </div>

      <div class="bg-surface border border-border rounded-lg p-4">
        <p class="text-xs uppercase tracking-widest text-dim mb-3">claude desktop / claude code</p>
        <div class="grid grid-cols-[1fr_auto] gap-2 items-start">
          <pre class="bg-black border border-border/50 rounded p-3 text-xs text-sub" x-text="claudeCfg"></pre>
          <button @click="copy(claudeCfg)" class="text-xs border border-border px-3 py-2 rounded text-sub hover:text-white transition-colors">copy</button>
        </div>
      </div>

      <div class="bg-surface border border-border rounded-lg p-4">
        <p class="text-xs uppercase tracking-widest text-dim mb-3">curl</p>
        <div class="grid grid-cols-[1fr_auto] gap-2 items-start">
          <pre class="bg-black border border-border/50 rounded p-3 text-xs text-sub" x-text="curlCfg"></pre>
          <button @click="copy(curlCfg)" class="text-xs border border-border px-3 py-2 rounded text-sub hover:text-white transition-colors">copy</button>
        </div>
      </div>

      <div class="bg-surface border border-border rounded-lg p-4">
        <p class="text-xs uppercase tracking-widest text-dim mb-3">tools</p>
        <div class="space-y-2 mt-2">
          <template x-for="t in [
            {name:'listfolders',desc:'list all imap folders'},
            {name:'searchmessages',desc:'search messages'},
            {name:'getmessage',desc:'fetch message by uid'},
            {name:'composedraft',desc:'compose a draft'},
            {name:'senddraft',desc:'send a draft'},
            {name:'deletemessage',desc:'delete a message'},
            {name:'movemessage',desc:'move to another folder'}
          ]">
            <div class="flex items-center gap-3">
              <code class="bg-black text-sub text-xs px-2 py-0.5 rounded font-mono" x-text="t.name"></code>
              <span class="text-xs text-muted" x-text="t.desc"></span>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>

  <footer class="mt-12 text-center space-x-3">
    <a href="https://buymeacoffee.com/undivisible" class="text-xs text-muted hover:text-sub transition-colors">buy me a coffee</a>
    <span class="text-border">·</span>
    <a href="/" class="text-xs text-muted hover:text-sub transition-colors">home</a>
  </footer>
</div>

<!-- Toast -->
<div x-show="toast.show" x-transition
  :class="toast.ok ? 'border-green-950 text-green-700 bg-green-950/20' : 'border-red-950 text-red-600 bg-red-950/20'"
  class="fixed top-4 right-4 border text-xs px-4 py-2 rounded-lg z-50 pointer-events-none"
  x-text="toast.msg">
</div>

<script>
${HUB_SCRIPT}

// OTP input wiring (outside Alpine since it needs DOM)
document.addEventListener('DOMContentLoaded', function() {
  function wireOtp() {
    var inputs = Array.from(document.querySelectorAll('.otp-input'));
    if (!inputs.length) { setTimeout(wireOtp, 100); return; }
    inputs.forEach(function(inp, i) {
      inp.addEventListener('input', function() {
        inp.value = inp.value.replace(/\\D/g,'').slice(0,1);
        if (inp.value && i < inputs.length - 1) inputs[i+1].focus();
        if (inputs.every(function(o){ return o.value; })) {
          var code = inputs.map(function(o){ return o.value; }).join('');
          document.querySelector('[x-data]').__x.$data.authCode = code;
          document.querySelector('[x-data]').__x.$data.verifyOtp();
        }
      });
      inp.addEventListener('keydown', function(e) {
        if (e.key === 'Backspace' && !inp.value && i > 0) { inputs[i-1].focus(); inputs[i-1].value = ''; }
      });
      inp.addEventListener('paste', function(e) {
        e.preventDefault();
        var text = (e.clipboardData || window.clipboardData).getData('text').replace(/\\D/g,'').slice(0,6);
        inputs.forEach(function(o, j){ o.value = text[j] || ''; });
        if (text.length === 6) {
          document.querySelector('[x-data]').__x.$data.authCode = text;
          document.querySelector('[x-data]').__x.$data.verifyOtp();
        }
      });
    });
  }
  wireOtp();
});
<\/script>
</body>
</html>`;
