/**
 * webConsole.js — minimal production web console for the CNR server
 * Split layout: console (left) + connected clients panel (right).
 * Zero npm dependencies. SSE for real-time log streaming.
 */

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const mapsDir = path.join(__dirname, 'maps');
if (!fs.existsSync(mapsDir)) fs.mkdirSync(mapsDir, { recursive: true });

// In-memory room → mapUrl registry (host POSTs on create, clients GET on join)
const roomMapUrls = {};

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MAX_BUFFER = 300;
const WEB_PORT   = parseInt(process.env.WEB_PORT || '1337', 10);

const logBuffer    = [];
const sseClients   = new Set();
let   statsGetter  = () => ({});
let   clientGetter = () => ({ master: [], game: [] });

function broadcast(line) {
  const data = `event: log\ndata: ${JSON.stringify(line)}\n\n`;
  for (const res of sseClients) {
    try { res.write(data); } catch (_) {}
  }
}

function colourize(raw) {
  let s = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const rules = [
    [/(\[Master\])/g,  '<span class="c-master">$1</span>'],
    [/(\[Game\])/g,    '<span class="c-game">$1</span>'],
    [/(\[Web\])/g,     '<span class="c-web">$1</span>'],
    [/(disconnected|left room|disconnect)/gi, '<span class="c-warn">$1</span>'],
    [/(connected|authenticated|creating|joining|joined|auth|Listening)/gi, '<span class="c-ok">$1</span>'],
    [/(error|Error|failed|unhandled)/gi, '<span class="c-err">$1</span>'],
    [/('[^']{1,40}')/g, '<span class="c-name">$1</span>'],
    [/(\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\b)/g, '<span class="c-ip">$1</span>'],
  ];
  for (const [rx, repl] of rules) s = s.replace(rx, repl);
  return s;
}

function pushLog(raw) {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  const entry = { ts, raw, html: colourize(raw) };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_BUFFER) logBuffer.shift();
  broadcast(entry);
}

const _origLog   = console.log.bind(console);
const _origError = console.error.bind(console);
const _origWarn  = console.warn.bind(console);

console.log   = (...a) => { const m = a.map(String).join(' '); _origLog(m); pushLog(m); };
console.error = (...a) => { const m = '[ERR] '+a.map(String).join(' '); _origError(m); pushLog(m); };
console.warn  = (...a) => { const m = '[WARN] '+a.map(String).join(' '); _origWarn(m); pushLog(m); };

// ── HTML (inline) ────────────────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CNR Server Console</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d1117;color:#c9d1d9;font-family:'Segoe UI',system-ui,sans-serif;height:100vh;display:flex;flex-direction:column;overflow:hidden}
header{background:#161b22;border-bottom:1px solid #30363d;padding:10px 20px;display:flex;align-items:center;gap:12px;flex-shrink:0}
.logo{font-size:16px;font-weight:700;color:#fff}.logo span{color:#3fb950}
.pill{font-size:11px;padding:2px 8px;border-radius:20px;font-weight:600}
.pill-run{background:#1a3a20;color:#3fb950;border:1px solid #2a6632}
.pill-port{background:#1a2a3a;color:#58a6ff;border:1px solid #264a6a}
.spacer{flex:1}
#uptime-display{font-size:12px;color:#6e7681}
.stats{display:flex;gap:8px;padding:10px 20px;background:#161b22;border-bottom:1px solid #30363d;flex-shrink:0;flex-wrap:wrap}
.sc{background:#21262d;border:1px solid #30363d;border-radius:8px;padding:8px 14px;flex:1;min-width:90px}
.sc .lbl{font-size:10px;color:#6e7681;text-transform:uppercase;letter-spacing:.6px}
.sc .val{font-size:20px;font-weight:700;color:#fff}
.sc .val.g{color:#3fb950}.sc .val.b{color:#58a6ff}.sc .val.y{color:#d29922}.sc .val.p{color:#bc8cff}
.main{flex:1;display:flex;min-height:0}
.console-panel{flex:1;min-width:0;display:flex;flex-direction:column;padding:12px 14px;gap:8px}
.con-bar{display:flex;align-items:center;gap:10px;flex-shrink:0}
.con-bar label{font-size:12px;color:#6e7681}
.con-bar input[type=checkbox]{accent-color:#3fb950}
.dot{width:8px;height:8px;border-radius:50%;background:#3fb950;display:inline-block;animation:pulse 2s infinite}
.dot.off{background:#f85149;animation:none}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.btn{background:#21262d;border:1px solid #30363d;color:#6e7681;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:12px}
.btn:hover{border-color:#f85149;color:#f85149}
#con{flex:1;background:#010409;border:1px solid #30363d;border-radius:8px;overflow-y:auto;padding:10px 12px;font-family:'Cascadia Code','Fira Code',Consolas,monospace;font-size:12.5px;line-height:1.65}
.ll{display:flex;gap:8px;padding:1px 0}
.ll:hover{background:rgba(255,255,255,.03);border-radius:3px}
.ts{color:#6e7681;flex-shrink:0;font-size:11px;padding-top:1px;user-select:none}
.lm{word-break:break-all}
.c-master{color:#39d0d9;font-weight:600}.c-game{color:#d29922;font-weight:600}.c-web{color:#bc8cff;font-weight:600}
.c-ok{color:#3fb950}.c-warn{color:#e3b341}.c-err{color:#f85149}.c-name{color:#58a6ff}.c-ip{color:#bc8cff}
/* clients panel */
.cp{width:300px;flex-shrink:0;border-left:1px solid #30363d;background:#161b22;display:flex;flex-direction:column;overflow:hidden}
.cp-head{padding:10px 14px;border-bottom:1px solid #30363d;display:flex;align-items:center;gap:8px;flex-shrink:0}
.cp-head h3{font-size:13px;font-weight:600}
.badge{background:#21262d;border:1px solid #30363d;border-radius:10px;font-size:10px;padding:1px 7px;color:#6e7681}
.cp-list{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:5px}
.cp-det{border-top:1px solid #30363d;padding:10px 14px;flex-shrink:0;max-height:220px;overflow-y:auto;font-size:12px}
.cp-det h4{font-size:10px;color:#6e7681;text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px}
.dr{display:flex;gap:6px;margin-bottom:3px}
.dk{color:#6e7681;width:72px;flex-shrink:0;font-size:11px}
.dv{color:#c9d1d9;word-break:break-all}
.ph{color:#6e7681;font-style:italic;font-size:12px;text-align:center;padding:16px 0}
.cc{background:#21262d;border:1px solid #30363d;border-radius:7px;padding:7px 10px;cursor:pointer;transition:border-color .15s}
.cc:hover{border-color:#58a6ff}.cc.sel{border-color:#3fb950}
.cc-name{font-size:13px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cc-sub{font-size:11px;color:#6e7681;display:flex;gap:5px;align-items:center;margin-top:2px}
.cc-room{font-size:11px;color:#6e7681;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tag{font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600}
.tag-m{background:#1a2a3a;color:#39d0d9}.tag-g{background:#3a2a0a;color:#d29922}
.sec-lbl{font-size:10px;color:#6e7681;text-transform:uppercase;letter-spacing:.6px;padding:4px 2px 2px}
</style>
</head>
<body>
<header>
  <div class="logo">CNR <span>Server</span></div>
  <span class="pill pill-run">● RUNNING</span>
  <span class="pill pill-port">:5055 MASTER</span>
  <span class="pill pill-port">:5056 GAME</span>
  <div class="spacer"></div>
  <div id="uptime-display">Uptime: --</div>
</header>
<div class="stats">
  <div class="sc"><div class="lbl">Master</div><div class="val b" id="s-master">0</div></div>
  <div class="sc"><div class="lbl">In-Game</div><div class="val y" id="s-game">0</div></div>
  <div class="sc"><div class="lbl">Rooms</div><div class="val p" id="s-rooms">0</div></div>
  <div class="sc"><div class="lbl">Players</div><div class="val g" id="s-players">0</div></div>
</div>
<div class="main">
  <div class="console-panel">
    <div class="con-bar">
      <span class="dot" id="sdot"></span>
      <span style="font-size:12px;color:#6e7681">Live</span>
      <label style="margin-left:auto"><input type="checkbox" id="asc" checked> Auto-scroll</label>
      <button class="btn" onclick="clearCon()">Clear</button>
    </div>
    <div id="con"></div>
  </div>
  <div class="cp">
    <div class="cp-head">
      <h3>Connected Clients</h3>
      <span class="badge" id="cnt">0</span>
    </div>
    <div class="cp-list" id="cp-list"></div>
    <div class="cp-det" id="cp-det"><div class="ph">Select a client to view details</div></div>
  </div>
</div>

<script>
  var con = document.getElementById('con');
  var selKey = null;
  var clientsData = { master: [], game: [] };

  // ── Console ───────────────────────────────────────────────────────────────
  function appendLine(e) {
    var el = document.createElement('div');
    el.className = 'll';
    el.innerHTML = '<span class="ts">' + e.ts + '</span><span class="lm">' + e.html + '</span>';
    con.appendChild(el);
    while (con.children.length > 500) con.removeChild(con.firstChild);
    if (document.getElementById('asc').checked) con.scrollTop = con.scrollHeight;
  }
  function clearCon() { con.innerHTML = ''; }

  // ── SSE ───────────────────────────────────────────────────────────────────
  var dot = document.getElementById('sdot');
  var evs = new EventSource('/events');
  evs.addEventListener('init', function(e) { JSON.parse(e.data).forEach(appendLine); });
  evs.addEventListener('log',  function(e) { appendLine(JSON.parse(e.data)); });
  evs.onopen  = function() { dot.classList.remove('off'); };
  evs.onerror = function() { dot.classList.add('off'); };

  // ── Stats ─────────────────────────────────────────────────────────────────
  function refreshStats() {
    fetch('/api/status').then(function(r) { return r.json(); }).then(function(d) {
      document.getElementById('s-master').textContent  = d.masterSessions;
      document.getElementById('s-game').textContent    = d.gameSessions;
      document.getElementById('s-rooms').textContent   = d.rooms;
      document.getElementById('s-players').textContent = d.players;
      var s = Math.floor(d.uptimeSeconds);
      var h = Math.floor(s/3600), m = Math.floor((s%3600)/60), ss = s%60;
      document.getElementById('uptime-display').textContent =
        'Uptime: ' + [h,m,ss].map(function(n){return String(n).padStart(2,'0');}).join(':');
    }).catch(function(){});
  }
  setInterval(refreshStats, 3000); refreshStats();

  // ── Clients ───────────────────────────────────────────────────────────────
  function elapsed(ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s/60) + 'm ' + (s%60) + 's ago';
    return Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'm ago';
  }

  function renderClients() {
    var list = document.getElementById('cp-list');
    var total = clientsData.master.length + clientsData.game.length;
    document.getElementById('cnt').textContent = total;
    if (total === 0) { list.innerHTML = '<div class="ph">No clients connected</div>'; return; }
    var html = '';
    if (clientsData.master.length) {
      html += '<div class="sec-lbl">Master (' + clientsData.master.length + ')</div>';
      for (var i = 0; i < clientsData.master.length; i++) {
        var c = clientsData.master[i];
        var key = 'm:' + c.id;
        var sel = selKey === key ? ' sel' : '';
        var ip = (c.ip || '').replace('::ffff:', '');
        html += '<div class="cc' + sel + '" data-key="' + key + '">'
              + '<div class="cc-name">' + (c.userId || '(anonymous)') + '</div>'
              + '<div class="cc-sub"><span class="tag tag-m">MASTER</span>' + ip + '</div>'
              + '</div>';
      }
    }
    if (clientsData.game.length) {
      html += '<div class="sec-lbl">Game (' + clientsData.game.length + ')</div>';
      for (var j = 0; j < clientsData.game.length; j++) {
        var g = clientsData.game[j];
        var gkey = 'g:' + g.id;
        var gsel = selKey === gkey ? ' sel' : '';
        var gip = (g.ip || '').replace('::ffff:', '');
        html += '<div class="cc' + gsel + '" data-key="' + gkey + '">'
              + '<div class="cc-name">' + (g.userId || '(anonymous)') + '</div>'
              + '<div class="cc-sub"><span class="tag tag-g">GAME</span>' + gip + '</div>'
              + (g.room ? '<div class="cc-room">Room: ' + g.room + '  ·  Actor ' + g.actorNr + '</div>' : '')
              + '</div>';
      }
    }
    list.innerHTML = html;
  }

  document.getElementById('cp-list').addEventListener('click', function(e) {
    var card = e.target.closest('.cc');
    if (!card) return;
    selKey = card.dataset.key;
    renderClients();
    renderDetail();
  });

  function renderDetail() {
    var det = document.getElementById('cp-det');
    if (!selKey) { det.innerHTML = '<div class="ph">Select a client to view details</div>'; return; }
    var parts = selKey.split(':');
    var type = parts[0];
    var id = parseInt(parts[1]);
    var list = type === 'm' ? clientsData.master : clientsData.game;
    var c = null;
    for (var k = 0; k < list.length; k++) { if (list[k].id === id) { c = list[k]; break; } }
    if (!c) { selKey = null; det.innerHTML = '<div class="ph">Client disconnected</div>'; renderClients(); return; }
    var ip = (c.ip || '').replace('::ffff:', '');
    var html = '<h4>Client Details</h4>';
    html += '<div class="dr"><span class="dk">Session</span><span class="dv">' + c.id + '</span></div>';
    html += '<div class="dr"><span class="dk">User ID</span><span class="dv">' + (c.userId || '—') + '</span></div>';
    html += '<div class="dr"><span class="dk">IP</span><span class="dv">' + ip + '</span></div>';
    html += '<div class="dr"><span class="dk">Type</span><span class="dv">' + (type === 'm' ? 'Master' : 'Game') + '</span></div>';
    html += '<div class="dr"><span class="dk">Auth</span><span class="dv">' + (c.authenticated ? 'Yes' : 'No') + '</span></div>';
    html += '<div class="dr"><span class="dk">Connected</span><span class="dv">' + elapsed(c.connectTime) + '</span></div>';
    if (type === 'g') {
      html += '<div class="dr"><span class="dk">Room</span><span class="dv">' + (c.room || '—') + '</span></div>';
      html += '<div class="dr"><span class="dk">Actor</span><span class="dv">' + (c.actorNr || '—') + '</span></div>';
    }
    det.innerHTML = html;
  }

  function fetchClients() {
    fetch('/api/clients').then(function(r) { return r.json(); }).then(function(d) {
      clientsData = d;
      renderClients();
      if (selKey) renderDetail();
    }).catch(function(){});
  }
  setInterval(fetchClients, 3000); fetchClients();
</script>
</body>
</html>`;

// ── HTTP server ───────────────────────────────────────────────────────────────
let httpServer = null;

function start(opts = {}) {
  if (opts.getStats)   statsGetter  = opts.getStats;
  if (opts.getClients) clientGetter = opts.getClients;

  httpServer = http.createServer((req, res) => {
    const url = req.url.split('?')[0];

    if (url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML);
      return;
    }

    if (url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ uptimeSeconds: process.uptime(), ...statsGetter() }));
      return;
    }

    if (url === '/api/clients') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(clientGetter()));
      return;
    }

    if (url === '/events') {
      res.writeHead(200, {
        'Content-Type':      'text/event-stream',
        'Cache-Control':     'no-cache',
        'Connection':        'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      res.write(`event: init\ndata: ${JSON.stringify(logBuffer.slice(-200))}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // ── Maps: GET/PUT /maps/<name>.json  (no new port — served from this console port) ──
    if (req.method === 'OPTIONS' && url.startsWith('/maps')) {
      res.writeHead(204, CORS); res.end(); return;
    }

    if (url === '/maps' || url === '/maps/') {
      if (req.method !== 'GET') { res.writeHead(405, CORS); res.end(); return; }
      try {
        const files = fs.readdirSync(mapsDir).filter(f => f.endsWith('.json'));
        res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(files));
      } catch (e) { res.writeHead(500, CORS); res.end('error'); }
      return;
    }

    const mapsMatch = url.match(/^\/maps\/([^/]+\.json)$/);
    if (mapsMatch) {
      const filename = mapsMatch[1].replace(/[^a-zA-Z0-9_.\-]/g, '_');
      const filepath  = path.join(mapsDir, filename);

      if (req.method === 'GET') {
        if (!fs.existsSync(filepath)) { res.writeHead(404, CORS); res.end('not found'); return; }
        const data = fs.readFileSync(filepath);
        res.writeHead(200, { ...CORS, 'Content-Type': 'application/json', 'Content-Length': data.length });
        res.end(data);

      } else if (req.method === 'PUT') {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            JSON.parse(body);  // reject non-JSON
            fs.writeFileSync(filepath, body, 'utf8');
            pushLog(`[Maps] uploaded ${filename} (${body.length} bytes)`);
            res.writeHead(200, CORS); res.end('ok');
          } catch (e) { res.writeHead(400, CORS); res.end('invalid JSON'); }
        });

      } else { res.writeHead(405, CORS); res.end(); }
      return;
    }

    // ── Room registry ─────────────────────────────────────────────────
    if (req.method === 'OPTIONS' && url.startsWith('/rooms')) {
      res.writeHead(204, CORS); res.end(); return;
    }

    // POST /rooms  body: {room, mapUrl}  — host registers its room’s map URL
    if (req.method === 'POST' && url === '/rooms') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const { room, mapUrl } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!room || !mapUrl) { res.writeHead(400, CORS); res.end('missing room or mapUrl'); return; }
          roomMapUrls[room] = mapUrl;
          pushLog(`[Rooms] registered '${room}' -> ${mapUrl}`);
          res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) { res.writeHead(400, CORS); res.end('invalid JSON'); }
      });
      return;
    }

    // GET /rooms/<name>  — client queries URL for a room by name
    const roomMatch = url.match(/^\/rooms\/(.+)$/);
    if (roomMatch && req.method === 'GET') {
      const name = decodeURIComponent(roomMatch[1]);
      const mapUrl = roomMapUrls[name] || null;
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ mapUrl }));
      return;
    }

    res.writeHead(404); res.end('Not found');
  });
  httpServer.listen(WEB_PORT, '0.0.0.0', () => {
    pushLog(`[Web] Console listening on http://0.0.0.0:${WEB_PORT}  →  open http://localhost:${WEB_PORT}`);
  });
}

function stop() {
  if (httpServer) httpServer.close();
}

module.exports = { start, stop, pushLog };
