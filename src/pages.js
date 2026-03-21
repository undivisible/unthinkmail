const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;color:#d0d0d0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;min-height:100vh;font-size:14px;line-height:1.5}
a{color:#555;text-decoration:none}a:hover{color:#ccc}
h1{font-size:2.4rem;font-weight:200;letter-spacing:-.03em;color:#fff}
h2{font-size:.65rem;text-transform:uppercase;letter-spacing:.15em;color:#2a2a2a;margin-bottom:1rem}
h3{color:#bbb;font-weight:500;font-size:.75rem;letter-spacing:.04em;text-transform:uppercase;margin-bottom:.5rem}
code{background:#0d0d0d;color:#555;padding:.1em .4em;border-radius:3px;font-size:.7rem;word-break:break-all;font-family:'SF Mono',Monaco,monospace}
pre{background:#050505;border:1px solid #161616;border-radius:6px;padding:.9rem 1rem;overflow-x:auto;font-size:.7rem;color:#444;line-height:1.7;font-family:'SF Mono',Monaco,monospace}
input,select,textarea{background:#080808;border:1px solid #1a1a1a;color:#ccc;padding:.5rem .7rem;border-radius:6px;font-size:.8rem;width:100%;outline:none;transition:border-color .15s}
input:focus,select:focus{border-color:#2a2a2a;background:#0d0d0d}
input::placeholder{color:#2a2a2a}
button{background:#111;color:#777;border:1px solid #1c1c1c;padding:.4rem .9rem;border-radius:6px;font-size:.72rem;cursor:pointer;transition:all .15s;letter-spacing:.04em;font-family:inherit}
button:hover{background:#181818;color:#ccc;border-color:#2a2a2a}
button:active{background:#1f1f1f}
button:disabled{opacity:.4;cursor:not-allowed}
.btn-danger{color:#4a2020;border-color:#2a1515}
.btn-danger:hover{background:#1a0a0a;color:#e05050;border-color:#5a2020}
.btn-sm{padding:.3rem .7rem;font-size:.68rem}
.btn-primary{background:#111;color:#aaa;border-color:#2a2a2a}
.btn-primary:hover{background:#1a1a1a;color:#fff;border-color:#444}
.card{border:1px solid #141414;border-radius:8px;padding:1.2rem;background:#050505}
.card+.card{margin-top:.75rem}
.wrap{max-width:560px;width:100%;margin:0 auto;padding:2rem 1.5rem 4rem}
.grid-2{display:grid;grid-template-columns:1fr auto;gap:.5rem;align-items:start}
.row{display:flex;gap:.5rem;align-items:center}
.row-sb{display:flex;justify-content:space-between;align-items:center}
.sub{color:#333;font-size:.75rem}
.dim{color:#2a2a2a;font-size:.68rem}
.mt{margin-top:1rem}.mt2{margin-top:1.5rem}.mb{margin-bottom:.75rem}.mb2{margin-bottom:1.5rem}
.gap{gap:.75rem}
.hidden{display:none!important}
.dot{width:6px;height:6px;border-radius:50%;display:inline-block;margin-right:.4rem;vertical-align:middle;flex-shrink:0}
.dot-green{background:#1a4a1a;box-shadow:0 0 4px #2a6a2a}
.dot-red{background:#4a1a1a}
.dot-dim{background:#1a1a1a}
.status-row{display:flex;align-items:center;gap:.5rem;font-size:.78rem}

/* nav */
nav{display:flex;justify-content:space-between;align-items:center;padding:.9rem 0;margin-bottom:1.5rem;border-bottom:1px solid #0e0e0e}
.logo{font-size:.95rem;font-weight:300;color:#fff;letter-spacing:-.01em}
.email-chip{font-size:.68rem;color:#2a2a2a;background:#070707;border:1px solid #111;padding:.25rem .6rem;border-radius:20px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* tabs */
.tab-bar{display:flex;gap:0;border-bottom:1px solid #111;margin-bottom:1.5rem}
.tab{padding:.5rem 1rem;font-size:.68rem;color:#333;cursor:pointer;border-bottom:2px solid transparent;letter-spacing:.06em;text-transform:uppercase;transition:color .15s;background:none;border-radius:0;border-left:none;border-top:none;border-right:none}
.tab:hover{color:#777;background:none;border-color:transparent}
.tab.active{color:#ccc;border-bottom-color:#ccc;background:none}

/* toast */
.toast{position:fixed;top:1.25rem;right:1.25rem;background:#111;border:1px solid #1c1c1c;color:#888;padding:.5rem 1rem;border-radius:6px;font-size:.72rem;opacity:0;transform:translateY(-4px);transition:all .2s;pointer-events:none;z-index:100;max-width:280px}
.toast.show{opacity:1;transform:translateY(0)}
.toast.ok{border-color:#1a3a1a;color:#4a7a4a}
.toast.err{border-color:#3a1a1a;color:#9a4a4a}

/* key rows */
.key-row{display:flex;justify-content:space-between;align-items:center;padding:.6rem 0;border-bottom:1px solid #0d0d0d}
.key-row:last-child{border:none}
.key-label{color:#555;font-size:.72rem}
.key-prefix{font-family:'SF Mono',Monaco,monospace;color:#2a2a2a;font-size:.68rem}
.key-date{color:#222;font-size:.62rem;margin-right:.5rem}

/* new key reveal */
.key-reveal{background:#030d03;border:1px solid #0d1f0d;border-radius:6px;padding:.8rem 1rem;margin-bottom:1rem}
.key-reveal code{color:#3a7a3a;font-size:.7rem;word-break:break-all;display:block;margin:.3rem 0}

/* connect */
.copy-row{display:flex;gap:.5rem;align-items:flex-start}
.copy-row pre{flex:1}
.copy-row button{flex-shrink:0;margin-top:0;align-self:stretch;padding:.4rem .7rem;font-size:.65rem}

/* landing */
.center{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:100vh}
.feature-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin:1.5rem 0}
@media(max-width:480px){.feature-grid{grid-template-columns:1fr}}
footer{text-align:center;padding:2rem 0}
footer a{font-size:.68rem;color:#1c1c1c}footer a:hover{color:#444}
.footer-dot{color:#111;margin:0 .5rem}

/* loading spinner */
.spinner{width:20px;height:20px;border:1px solid #1a1a1a;border-top-color:#333;border-radius:50%;animation:spin .8s linear infinite;margin:3rem auto}
@keyframes spin{to{transform:rotate(360deg)}}
`;

export const LANDING = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>unthinkmail — any email, any ai</title>
<style>${CSS}</style>
</head>
<body>
<div class="center">
<div class="wrap" style="text-align:center">
<h1>unthinkmail</h1>
<p class="sub mb2" style="font-size:.9rem;color:#333;margin-top:.4rem">connect any email to any ai via imap</p>

<div class="feature-grid mb2">
<div class="card" style="text-align:left">
<h3>any imap provider</h3>
<p class="sub">gmail, outlook, fastmail, purelymail, protonmail bridge — if it speaks imap, it works.</p>
</div>
<div class="card" style="text-align:left">
<h3>mcp protocol</h3>
<p class="sub">expose your inbox as tools for any ai. search, read, compose, send — all via json-rpc.</p>
</div>
<div class="card" style="text-align:left">
<h3>encrypted at rest</h3>
<p class="sub">aes-256-gcm with per-user key derivation. credentials are never stored in plaintext.</p>
</div>
<div class="card" style="text-align:left">
<h3>cloudflare access</h3>
<p class="sub">email otp login — no passwords. zero-trust auth baked in at the infrastructure layer.</p>
</div>
</div>

<div class="row" style="justify-content:center;gap:.75rem">
<a href="/hub" class="btn-primary" style="display:inline-block;padding:.5rem 1.25rem;border:1px solid #2a2a2a;border-radius:6px;font-size:.75rem;color:#aaa;letter-spacing:.04em">open hub</a>
</div>

<footer>
<a href="https://buymeacoffee.com/undivisible">buy me a coffee</a>
<span class="footer-dot">·</span>
<a href="https://github.com/undivisible/unthinkmail">source</a>
</footer>
</div>
</div>
</body>
</html>`;

export const HUB = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>unthinkmail hub</title>
<style>${CSS}</style>
</head>
<body>

<div id="loading" class="center"><div class="spinner"></div></div>

<div id="hub" class="hidden">
<div class="wrap">
<nav>
<span class="logo">unthinkmail</span>
<div class="row gap">
<span id="user-email" class="email-chip"></span>
<a href="/cdn-cgi/access/logout" class="btn btn-sm">sign out</a>
</div>
</nav>

<div class="tab-bar">
<button class="tab active" onclick="showTab('email')">email</button>
<button class="tab" onclick="showTab('keys')">api keys</button>
<button class="tab" onclick="showTab('connect')">connect</button>
</div>

<!-- Email Tab -->
<div id="tab-email">
<h2>email credentials</h2>

<div class="card mb" id="cred-status-card">
<div class="status-row">
<span class="dot dot-dim" id="cred-dot"></span>
<span id="cred-status-text" class="sub">checking...</span>
</div>
</div>

<div class="card">
<h3 style="margin-bottom:1rem">imap &amp; smtp</h3>
<div style="display:grid;gap:.6rem">
<div class="row gap">
<div style="flex:1"><input id="c-imap-host" placeholder="imap host  e.g. imap.gmail.com"></div>
<div style="width:80px"><input id="c-imap-port" placeholder="993"></div>
</div>
<div class="row gap">
<div style="flex:1"><input id="c-smtp-host" placeholder="smtp host  e.g. smtp.gmail.com"></div>
<div style="width:80px"><input id="c-smtp-port" placeholder="465"></div>
</div>
<input id="c-user" placeholder="email address / username">
<input id="c-pass" type="password" placeholder="password or app password">
<div class="row gap" style="margin-top:.25rem">
<button class="btn-primary" onclick="saveCreds()">save</button>
<button class="btn-danger btn-sm" onclick="deleteCreds()">remove</button>
</div>
</div>
</div>

<div class="card mt" style="border-color:#090909">
<h3>quick settings</h3>
<p class="dim" style="line-height:2">
gmail &nbsp;· imap.gmail.com:993 &nbsp;/ smtp.gmail.com:465 &nbsp;· use an app password<br>
outlook &nbsp;· outlook.office365.com:993 &nbsp;/ smtp.office365.com:587<br>
fastmail &nbsp;· imap.fastmail.com:993 &nbsp;/ smtp.fastmail.com:465<br>
purelymail &nbsp;· imap.purelymail.com:993 &nbsp;/ smtp.purelymail.com:465<br>
protonmail &nbsp;· 127.0.0.1:1143 &nbsp;/ 127.0.0.1:1025 &nbsp;· via bridge
</p>
</div>
</div>

<!-- API Keys Tab -->
<div id="tab-keys" class="hidden">
<h2>api keys</h2>

<div class="card mb grid-2" style="align-items:end">
<input id="key-label" placeholder="label (optional)">
<button class="btn-primary" onclick="createKey()">generate</button>
</div>

<div id="new-key-reveal" class="key-reveal hidden">
<div class="row-sb">
<span style="font-size:.7rem;color:#3a7a3a">new api key — copy now, not shown again</span>
<button class="btn-sm" onclick="copyKey()">copy</button>
</div>
<code id="new-key-value"></code>
</div>

<div id="keys-list"></div>
</div>

<!-- Connect Tab -->
<div id="tab-connect" class="hidden">
<h2>connect to your ai</h2>

<div class="card mb">
<h3>mcp endpoint</h3>
<div class="copy-row mt">
<pre id="endpoint-url" style="padding:.5rem .8rem"></pre>
<button class="btn-sm" onclick="copyEl('endpoint-url')">copy</button>
</div>
</div>

<div class="card mb">
<h3>claude desktop / claude code</h3>
<div class="copy-row mt">
<pre id="claude-cfg"></pre>
<button class="btn-sm" onclick="copyEl('claude-cfg')">copy</button>
</div>
</div>

<div class="card mb">
<h3>curl</h3>
<div class="copy-row mt">
<pre id="curl-cfg"></pre>
<button class="btn-sm" onclick="copyEl('curl-cfg')">copy</button>
</div>
</div>

<div class="card">
<h3>available tools</h3>
<div style="margin-top:.6rem;display:grid;gap:.3rem">
<div class="row gap"><code>listfolders</code><span class="dim">list all imap folders</span></div>
<div class="row gap"><code>searchmessages</code><span class="dim">search messages by query</span></div>
<div class="row gap"><code>getmessage</code><span class="dim">fetch full message by uid</span></div>
<div class="row gap"><code>composedraft</code><span class="dim">compose a draft email</span></div>
<div class="row gap"><code>senddraft</code><span class="dim">send a composed draft</span></div>
<div class="row gap"><code>deletemessage</code><span class="dim">delete a message</span></div>
<div class="row gap"><code>movemessage</code><span class="dim">move a message to a folder</span></div>
</div>
</div>
</div>

<footer>
<a href="https://buymeacoffee.com/undivisible">buy me a coffee</a>
<span class="footer-dot">·</span>
<a href="/">home</a>
</footer>

</div><!-- .wrap -->
</div><!-- #hub -->

<div id="error-screen" class="center hidden">
<div class="wrap" style="text-align:center">
<p class="sub" id="error-msg" style="color:#4a2020;font-size:.8rem;max-width:320px;margin:0 auto"></p>
</div>
</div>

<div id="toast" class="toast"></div>

<script>
var userEmail = '';
var userKeys = [];

function $(id){ return document.getElementById(id); }

function toast(msg, ok) {
  var el = $('toast');
  el.textContent = msg;
  el.className = 'toast show ' + (ok ? 'ok' : 'err');
  clearTimeout(el._t);
  el._t = setTimeout(function(){ el.className = 'toast'; }, 3500);
}

async function api(path, opts) {
  opts = opts || {};
  var h = { 'Content-Type': 'application/json' };
  var r = await fetch(path, Object.assign({}, opts, {
    headers: Object.assign(h, opts.headers || {}),
    credentials: 'same-origin'
  }));
  var d = await r.json().catch(function(){ return {}; });
  if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
  return d;
}

function showTab(name) {
  var tabs = ['email', 'keys', 'connect'];
  tabs.forEach(function(t) {
    $('tab-' + t).className = (t === name) ? '' : 'hidden';
  });
  document.querySelectorAll('.tab').forEach(function(el, i) {
    el.className = 'tab' + (tabs[i] === name ? ' active' : '');
  });
  if (name === 'keys') loadKeys();
  if (name === 'email') loadCreds();
  if (name === 'connect') renderConnect();
}

function renderConnect() {
  var origin = location.origin;
  var base = (origin.includes('workers.dev') && userKeys.length === 0)
    ? origin : 'https://unthinkmail.undivisible.dev';
  var endpoint = base + '/mcp';
  var key = userKeys.length > 0 ? userKeys[0].key_prefix.replace('...','') + '...' : 'pm_your_key_here';

  $('endpoint-url').textContent = endpoint;
  $('claude-cfg').textContent = JSON.stringify({
    mcpServers: {
      unthinkmail: {
        url: endpoint,
        headers: { Authorization: 'Bearer ' + key }
      }
    }
  }, null, 2);
  $('curl-cfg').textContent =
    'curl -X POST ' + endpoint + ' \\\n' +
    '  -H "Authorization: Bearer ' + key + '" \\\n' +
    '  -H "Content-Type: application/json" \\\n' +
    '  -d \'{"jsonrpc":"2.0","method":"tools/list","id":1}\'';
}

async function copyEl(id) {
  var text = $(id).textContent;
  try {
    await navigator.clipboard.writeText(text);
    toast('copied', true);
  } catch(e) {
    toast('copy failed', false);
  }
}

async function copyKey() {
  var text = $('new-key-value').textContent;
  try {
    await navigator.clipboard.writeText(text);
    toast('key copied', true);
  } catch(e) {
    toast('copy failed', false);
  }
}

async function loadCreds() {
  $('cred-dot').className = 'dot dot-dim';
  $('cred-status-text').textContent = 'checking...';
  $('cred-status-text').style.color = '';
  try {
    var d = await api('/api/credentials');
    $('cred-dot').className = 'dot dot-green';
    $('cred-status-text').textContent = d.imap_user + ' @ ' + d.imap_host + ':' + d.imap_port;
    $('cred-status-text').style.color = '#3a6a3a';
    $('c-imap-host').value = d.imap_host || '';
    $('c-imap-port').value = d.imap_port || '';
    $('c-smtp-host').value = d.smtp_host || '';
    $('c-smtp-port').value = d.smtp_port || '';
    $('c-user').value = d.imap_user || '';
    $('c-pass').value = '';
  } catch(e) {
    if (e.message === 'No credentials stored') {
      $('cred-dot').className = 'dot dot-red';
      $('cred-status-text').textContent = 'no email connected';
      $('cred-status-text').style.color = '#444';
    } else {
      $('cred-status-text').textContent = e.message;
    }
  }
}

async function saveCreds() {
  var imapHost = $('c-imap-host').value.trim();
  var imapPort = parseInt($('c-imap-port').value) || 993;
  var smtpHost = $('c-smtp-host').value.trim();
  var smtpPort = parseInt($('c-smtp-port').value) || 465;
  var user = $('c-user').value.trim();
  var pass = $('c-pass').value;
  if (!imapHost || !smtpHost || !user || !pass) {
    toast('all fields required', false);
    return;
  }
  try {
    await api('/api/credentials', {
      method: 'PUT',
      body: JSON.stringify({
        imap_host: imapHost, imap_port: imapPort,
        imap_user: user, imap_pass: pass,
        smtp_host: smtpHost, smtp_port: smtpPort
      })
    });
    toast('credentials saved', true);
    loadCreds();
  } catch(e) { toast(e.message, false); }
}

async function deleteCreds() {
  if (!confirm('remove stored credentials?')) return;
  try {
    await api('/api/credentials', { method: 'DELETE' });
    toast('credentials removed', true);
    $('c-imap-host').value = '';
    $('c-imap-port').value = '';
    $('c-smtp-host').value = '';
    $('c-smtp-port').value = '';
    $('c-user').value = '';
    $('c-pass').value = '';
    loadCreds();
  } catch(e) { toast(e.message, false); }
}

async function loadKeys() {
  try {
    var d = await api('/api/keys');
    userKeys = d.keys || [];
    var el = $('keys-list');
    el.textContent = '';
    if (!userKeys.length) {
      var p = document.createElement('p');
      p.className = 'sub';
      p.style.color = '#222';
      p.style.fontSize = '.72rem';
      p.textContent = 'no api keys yet — generate one above';
      el.appendChild(p);
      return;
    }
    userKeys.forEach(function(k) {
      var row = document.createElement('div');
      row.className = 'key-row';

      var left = document.createElement('div');
      var lbl = document.createElement('div');
      lbl.className = 'key-label';
      lbl.textContent = k.label || 'unlabeled';
      var pfx = document.createElement('div');
      pfx.className = 'key-prefix';
      pfx.textContent = k.key_prefix;
      left.appendChild(lbl);
      left.appendChild(pfx);

      var right = document.createElement('div');
      right.className = 'row';
      var dt = document.createElement('span');
      dt.className = 'key-date';
      dt.textContent = new Date(k.created_at).toLocaleDateString();
      var btn = document.createElement('button');
      btn.className = 'btn-danger btn-sm';
      btn.textContent = 'revoke';
      (function(id){ btn.onclick = function(){ revokeKey(id); }; })(k.id);
      right.appendChild(dt);
      right.appendChild(btn);

      row.appendChild(left);
      row.appendChild(right);
      el.appendChild(row);
    });
  } catch(e) {
    $('keys-list').textContent = e.message;
  }
}

async function createKey() {
  try {
    var label = $('key-label').value.trim() || null;
    var d = await api('/api/keys', {
      method: 'POST',
      body: JSON.stringify({ label: label })
    });
    $('new-key-value').textContent = d.key;
    $('new-key-reveal').className = 'key-reveal';
    $('key-label').value = '';
    loadKeys();
    toast('key created — copy it now', true);
  } catch(e) { toast(e.message, false); }
}

async function revokeKey(id) {
  if (!confirm('revoke this api key? this cannot be undone.')) return;
  try {
    await api('/api/keys/' + id, { method: 'DELETE' });
    toast('key revoked', true);
    $('new-key-reveal').className = 'key-reveal hidden';
    loadKeys();
  } catch(e) { toast(e.message, false); }
}

(async function init() {
  try {
    var me = await api('/api/me');
    userEmail = me.email;
    $('user-email').textContent = me.email;
    $('loading').className = 'hidden';
    $('hub').className = '';
    await loadCreds();
  } catch(e) {
    $('loading').className = 'hidden';
    $('error-screen').className = 'center';
    $('error-msg').textContent = e.message === 'Unauthenticated'
      ? 'Authentication required. Cloudflare Access must be configured for this route.'
      : 'Error: ' + e.message;
  }
})();
</script>
</body>
</html>`;
