const CSS = `*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;color:#e0e0e0;font-family:-apple-system,system-ui,sans-serif;min-height:100vh}
a{color:#555;text-decoration:none;border-bottom:1px solid #1a1a1a;transition:color .2s}a:hover{color:#fff}
h1{font-size:2.5rem;font-weight:200;letter-spacing:-.02em;color:#fff}
h2{font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;color:#333;margin-bottom:1rem}
h3{color:#fff;font-weight:500;font-size:.8rem;margin-bottom:.4rem;letter-spacing:.03em;text-transform:uppercase}
code{background:#111;color:#666;padding:.15em .4em;border-radius:3px;font-size:.72rem;word-break:break-all}
pre{background:#0a0a0a;border:1px solid #1a1a1a;border-radius:6px;padding:1rem;overflow-x:auto;font-size:.72rem;color:#555;line-height:1.6}
input,select{background:#0a0a0a;border:1px solid #1a1a1a;color:#ccc;padding:.5rem .75rem;border-radius:6px;font-size:.8rem;width:100%;outline:none;transition:border-color .2s}
input:focus,select:focus{border-color:#333}
button,.btn{background:#111;color:#888;border:1px solid #1a1a1a;padding:.45rem 1rem;border-radius:6px;font-size:.75rem;cursor:pointer;transition:all .2s;text-transform:uppercase;letter-spacing:.05em}
button:hover,.btn:hover{background:#1a1a1a;color:#fff;border-color:#333}
.btn-danger{color:#422;border-color:#311}
.btn-danger:hover{background:#200;color:#f66;border-color:#633}
.card{border:1px solid #1a1a1a;border-radius:8px;padding:1.25rem;background:#0a0a0a}
.card p{color:#555;font-size:.78rem;line-height:1.5}
.wrap{max-width:520px;width:100%;margin:0 auto;padding:3rem 1.5rem}
.center{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:100vh}
.grid{display:grid;gap:1rem}
.row{display:flex;gap:.5rem;align-items:center}
.sep{border:none;border-top:1px solid #111;margin:1.5rem 0}
.sub{color:#444;font-size:.8rem}
.mt{margin-top:1.5rem}.mb{margin-bottom:1rem}.mb2{margin-bottom:2rem}
.hide{display:none}
.msg{padding:.5rem .75rem;border-radius:6px;font-size:.75rem;margin-bottom:1rem}
.msg-ok{background:#021;color:#4a5;border:1px solid #132}
.msg-err{background:#200;color:#f66;border:1px solid #311}
footer{text-align:center;padding:2rem 0}
footer a{font-size:.7rem;color:#2a2a2a}footer a:hover{color:#555}
.dot{display:inline-block;width:5px;height:5px;background:#1a1a1a;border-radius:50%;margin:0 .5rem;vertical-align:middle}
.key-row{display:flex;justify-content:space-between;align-items:center;padding:.5rem 0;border-bottom:1px solid #0f0f0f}
.key-row:last-child{border:none}
.key-label{color:#666;font-size:.75rem}
.key-prefix{font-family:monospace;color:#444;font-size:.72rem}
.key-date{color:#333;font-size:.65rem;margin-right:.5rem}
.tab-bar{display:flex;gap:0;border-bottom:1px solid #1a1a1a;margin-bottom:1.5rem}
.tab{padding:.5rem 1rem;font-size:.72rem;color:#444;cursor:pointer;border-bottom:2px solid transparent;text-transform:uppercase;letter-spacing:.05em;transition:all .2s}
.tab:hover{color:#888}.tab.active{color:#fff;border-bottom-color:#fff}`;

export const LANDING = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>unthinkmail</title><style>${CSS}</style></head>
<body><div class="center"><div class="wrap">
<h1>unthinkmail</h1>
<p class="sub mb2">connect any email to any ai via imap</p>
<div class="grid mb2">
<div class="card"><h3>any imap provider</h3><p>gmail, outlook, protonmail, purelymail, fastmail, your own server. if it speaks imap, it works.</p></div>
<div class="card"><h3>mcp protocol</h3><p>expose your inbox as tools for any ai. search messages, read email, list folders — all via json-rpc.</p></div>
<div class="card"><h3>encrypted at rest</h3><p>credentials stored with aes-256-gcm, per-user key derivation. we never see your password in plaintext.</p></div>
</div>
<div class="row" style="justify-content:center;gap:1rem">
<a href="/hub" class="btn" style="text-decoration:none;border:1px solid #333">open hub</a>
</div>
<footer>
<a href="https://buymeacoffee.com/undivisible">buy me a coffee</a>
<span class="dot"></span>
<a href="https://github.com/undivisible/purelymail-mcp-server">source</a>
</footer>
</div></div></body></html>`;

export const HUB = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>unthinkmail hub</title><style>${CSS}
.logo{font-size:1rem;font-weight:200;color:#fff;letter-spacing:-.01em}
nav{display:flex;justify-content:space-between;align-items:center;padding:.75rem 0;margin-bottom:1rem;border-bottom:1px solid #111}
nav .sub{font-size:.7rem;cursor:pointer}
</style></head>
<body><div class="wrap">

<div id="auth" class="center" style="min-height:90vh">
<h1 style="font-size:1.8rem;margin-bottom:.25rem">unthinkmail</h1>
<p class="sub mb2">sign in or create an account</p>
<div id="auth-msg"></div>
<div class="grid" style="width:100%;max-width:320px">
<input id="auth-email" type="email" placeholder="email">
<input id="auth-pass" type="password" placeholder="password">
<div class="row">
<button onclick="doLogin()" style="flex:1">sign in</button>
<button onclick="doRegister()" style="flex:1">register</button>
</div>
</div>
</div>

<div id="hub" class="hide">
<nav>
<span class="logo">unthinkmail</span>
<span class="sub" onclick="doLogout()">sign out</span>
</nav>

<div class="tab-bar">
<div class="tab active" onclick="showTab('creds')">email</div>
<div class="tab" onclick="showTab('keys')">api keys</div>
<div class="tab" onclick="showTab('connect')">connect</div>
</div>

<div id="hub-msg"></div>

<div id="tab-creds">
<h2>imap / smtp credentials</h2>
<div id="creds-status" class="card mb"><p>loading...</p></div>
<div class="grid">
<div class="row"><input id="c-imap-host" placeholder="imap host (e.g. imap.gmail.com)"><input id="c-imap-port" placeholder="993" style="max-width:80px"></div>
<div class="row"><input id="c-smtp-host" placeholder="smtp host (e.g. smtp.gmail.com)"><input id="c-smtp-port" placeholder="465" style="max-width:80px"></div>
<input id="c-user" placeholder="email / username">
<input id="c-pass" type="password" placeholder="password or app password">
<div class="row">
<button onclick="saveCreds()">save credentials</button>
<button class="btn-danger" onclick="deleteCreds()">remove</button>
</div>
</div>
<div class="card mt" style="border-color:#0f0f0f">
<h3 style="font-size:.7rem;color:#333">common imap settings</h3>
<p style="font-size:.7rem;color:#2a2a2a;line-height:1.8">
gmail: imap.gmail.com:993 / smtp.gmail.com:465 (use app password)<br>
outlook: outlook.office365.com:993 / smtp.office365.com:587<br>
purelymail: imap.purelymail.com:993 / smtp.purelymail.com:465<br>
fastmail: imap.fastmail.com:993 / smtp.fastmail.com:465<br>
protonmail: 127.0.0.1:1143 / 127.0.0.1:1025 (via bridge)
</p>
</div>
</div>

<div id="tab-keys" class="hide">
<h2>api keys</h2>
<div class="row mb">
<input id="key-label" placeholder="label (optional)" style="flex:1">
<button onclick="createKey()">generate key</button>
</div>
<div id="new-key-display" class="hide msg msg-ok mb"></div>
<div id="keys-list"><p class="sub">loading...</p></div>
</div>

<div id="tab-connect" class="hide">
<h2>connect to your ai</h2>
<div class="card mb">
<h3>mcp endpoint</h3>
<p><code id="mcp-url"></code></p>
</div>
<div class="card mb">
<h3>authenticate</h3>
<p>add your api key as a bearer token:<br><code>Authorization: Bearer pm_your_key_here</code></p>
</div>
<div class="card mb">
<h3>claude desktop / claude code</h3>
<pre id="claude-cfg"></pre>
</div>
<div class="card mb">
<h3>curl example</h3>
<pre id="curl-cfg"></pre>
</div>
<div class="card">
<h3>available tools</h3>
<p style="line-height:1.8">
<code>listfolders</code> list all imap folders<br>
<code>searchmessages</code> search messages by query<br>
<code>getmessage</code> get full message content by uid<br>
<code>composedraft</code> compose a draft email<br>
<code>senddraft</code> send a composed draft<br>
<code>deletemessage</code> delete a message<br>
<code>movemessage</code> move a message to another folder
</p>
</div>
</div>

</div>

<footer>
<a href="https://buymeacoffee.com/undivisible">buy me a coffee</a>
<span class="dot"></span>
<a href="/">home</a>
</footer>
</div>

<script>
const API=location.origin;
let token=localStorage.getItem('um_token');

function $(id){return document.getElementById(id)}

function msg(target,text,ok){
  const el=$(target);
  el.className='msg '+(ok?'msg-ok':'msg-err');
  el.textContent=text;
  setTimeout(function(){el.className='';el.textContent=''},5000);
}

async function api(path,opts){
  opts=opts||{};
  const h={'Content-Type':'application/json'};
  if(token)h['Authorization']='Bearer '+token;
  const r=await fetch(API+path,Object.assign({},opts,{headers:Object.assign(h,opts.headers||{})}));
  const d=await r.json().catch(function(){return {}});
  if(!r.ok)throw new Error(d.error||'Request failed');
  return d;
}

function showTab(name){
  var tabs=['creds','keys','connect'];
  tabs.forEach(function(t){
    $('tab-'+t).style.display=(t===name)?'block':'none';
  });
  var tabEls=document.querySelectorAll('.tab');
  tabEls.forEach(function(el,i){
    if(tabs[i]===name){el.className='tab active'}else{el.className='tab'}
  });
  if(name==='keys')loadKeys();
  if(name==='creds')loadCreds();
  if(name==='connect'){
    $('mcp-url').textContent='POST '+location.origin+'/mcp';
    $('claude-cfg').textContent=JSON.stringify({"mcpServers":{"unthinkmail":{"url":location.origin+"/mcp","headers":{"Authorization":"Bearer pm_your_key_here"}}}},null,2);
    $('curl-cfg').textContent='curl -X POST '+location.origin+'/mcp \\\n  -H "Authorization: Bearer pm_your_key_here" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"jsonrpc":"2.0","method":"tools/list","id":1}\'';
  }
}

async function doRegister(){
  try{
    await api('/api/auth/register',{method:'POST',body:JSON.stringify({email:$('auth-email').value,password:$('auth-pass').value})});
    msg('auth-msg','account created',true);
    await doLogin();
  }catch(e){msg('auth-msg',e.message,false)}
}
async function doLogin(){
  try{
    var d=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:$('auth-email').value,password:$('auth-pass').value})});
    token=d.token;localStorage.setItem('um_token',token);
    enterHub();
  }catch(e){msg('auth-msg',e.message,false)}
}
function doLogout(){token=null;localStorage.removeItem('um_token');$('auth').style.display='';$('auth').className='center';$('hub').style.display='none'}

function enterHub(){
  $('auth').style.display='none';
  $('hub').style.display='block';
  $('hub').className='';
  loadCreds();
}

async function loadCreds(){
  try{
    var d=await api('/api/credentials');
    $('creds-status').textContent='';
    var p=document.createElement('p');
    p.style.color='#4a5';
    p.textContent='connected: '+d.imap_user+' @ '+d.imap_host+':'+d.imap_port;
    $('creds-status').appendChild(p);
    $('c-imap-host').value=d.imap_host||'';
    $('c-imap-port').value=d.imap_port||'';
    $('c-user').value=d.imap_user||'';
  }catch(e){
    $('creds-status').textContent='';
    var p=document.createElement('p');
    p.style.color='#555';
    p.textContent='no credentials stored yet';
    $('creds-status').appendChild(p);
  }
}
async function saveCreds(){
  try{
    await api('/api/credentials',{method:'PUT',body:JSON.stringify({
      imap_host:$('c-imap-host').value,imap_port:parseInt($('c-imap-port').value)||993,
      imap_user:$('c-user').value,imap_pass:$('c-pass').value,
      smtp_host:$('c-smtp-host').value,smtp_port:parseInt($('c-smtp-port').value)||465
    })});
    msg('hub-msg','credentials saved',true);loadCreds();$('c-pass').value='';
  }catch(e){msg('hub-msg',e.message,false)}
}
async function deleteCreds(){
  if(!confirm('remove stored credentials?'))return;
  try{await api('/api/credentials',{method:'DELETE'});msg('hub-msg','credentials removed',true);loadCreds()}catch(e){msg('hub-msg',e.message,false)}
}

async function loadKeys(){
  try{
    var d=await api('/api/keys');
    var el=$('keys-list');
    el.textContent='';
    if(!d.keys||!d.keys.length){var p=document.createElement('p');p.className='sub';p.textContent='no api keys yet';el.appendChild(p);return}
    d.keys.forEach(function(k){
      var row=document.createElement('div');row.className='key-row';
      var left=document.createElement('div');
      var lbl=document.createElement('span');lbl.className='key-label';lbl.textContent=k.label||'unlabeled';
      var br=document.createElement('br');
      var pfx=document.createElement('span');pfx.className='key-prefix';pfx.textContent=k.key_prefix;
      left.appendChild(lbl);left.appendChild(br);left.appendChild(pfx);
      var right=document.createElement('div');right.className='row';
      var dt=document.createElement('span');dt.className='key-date';dt.textContent=new Date(k.created_at).toLocaleDateString();
      var btn=document.createElement('button');btn.className='btn-danger';btn.textContent='revoke';
      btn.setAttribute('data-id',k.id);
      btn.onclick=function(){deleteKey(this.getAttribute('data-id'))};
      right.appendChild(dt);right.appendChild(btn);
      row.appendChild(left);row.appendChild(right);
      el.appendChild(row);
    });
  }catch(e){$('keys-list').textContent=e.message}
}
async function createKey(){
  try{
    var d=await api('/api/keys',{method:'POST',body:JSON.stringify({label:$('key-label').value||null})});
    var el=$('new-key-display');
    el.textContent='new key (copy now — shown once): '+d.key;
    el.className='msg msg-ok mb';
    $('key-label').value='';loadKeys();
  }catch(e){msg('hub-msg',e.message,false)}
}
async function deleteKey(id){
  if(!confirm('revoke this api key?'))return;
  try{await api('/api/keys/'+id,{method:'DELETE'});loadKeys();msg('hub-msg','key revoked',true)}catch(e){msg('hub-msg',e.message,false)}
}

if(token){enterHub()}
</script>
</body></html>`;
