#!/usr/bin/env node
// Device Preview server — zero dependencies (Node 18+).
//
// Serves the side-by-side laptop + mobile preview and proxies the target site
// through the same origin, so the preview can sync scroll and navigation
// between the two frames. WebSockets (hot reload) are proxied too.
//
// Usage: node preview.mjs [url|port] [--port 4747] [--no-open]

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const PREFIX = '/__device-preview';
const here = dirname(fileURLToPath(import.meta.url));
const templatePath = join(here, '..', 'assets', 'preview.html');

// ---------- args ----------
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const noOpen = args.includes('--no-open');
const firstPort = Number(flag('--port')) || 4747;
let raw = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--port') || 'http://localhost:3000';
if (/^\d+$/.test(raw)) raw = `http://localhost:${raw}`;
else if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
const target = new URL(raw);
const isHttps = target.protocol === 'https:';
const targetPort = Number(target.port) || (isHttps ? 443 : 80);
const startPath = target.pathname + target.search + target.hash;

function openBrowser(url) {
  if (noOpen) { console.log(`Open this in a browser: ${url}`); return; }
  const p = process.platform;
  const [cmd, cmdArgs] =
    p === 'darwin' ? ['open', [url]]
    : p === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' });
    child.on('error', () => console.warn(`Could not open a browser. Open this manually: ${url}`));
    child.unref();
  } catch {
    console.warn(`Could not open a browser. Open this manually: ${url}`);
  }
}
const uiUrl = (port, path) => `http://localhost:${port}${PREFIX}/?path=${encodeURIComponent(path)}`;

// ---------- reuse a preview server that already proxies this target ----------
for (let p = firstPort; p < firstPort + 20; p++) {
  try {
    const r = await fetch(`http://localhost:${p}${PREFIX}/ping`, { signal: AbortSignal.timeout(400) });
    const j = await r.json();
    if (j.app === 'device-preview' && j.target === target.origin) {
      console.log(`✓ Device Preview already running for ${target.origin} on port ${p}`);
      openBrowser(uiUrl(p, startPath));
      process.exit(0);
    }
  } catch {}
}

// ---------- check the target ----------
try {
  const res = await fetch(target, { signal: AbortSignal.timeout(3000) });
  console.log(`✓ ${target.origin} responded (${res.status})`);
} catch {
  console.warn(`⚠ ${target.origin} did not respond. Is the dev server running? Starting the preview anyway.`);
}

// ---------- proxy ----------
const rewriteHeaders = (h) => {
  const out = { ...h, host: target.host };
  if (out.origin) out.origin = target.origin;
  if (out.referer) out.referer = out.referer.replace(/^https?:\/\/[^/]+/, target.origin);
  return out;
};

function serveUi(req, res) {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === `${PREFIX}/ping`) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ app: 'device-preview', target: target.origin }));
  }
  const config = { target: target.origin, path: u.searchParams.get('path') || startPath || '/' };
  const html = readFileSync(templatePath, 'utf8').replace('"__PREVIEW_CONFIG__"', JSON.stringify(config));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith(PREFIX)) return serveUi(req, res);
  const upstream = (isHttps ? https : http).request(
    {
      hostname: target.hostname, port: targetPort, method: req.method, path: req.url,
      headers: rewriteHeaders(req.headers), rejectUnauthorized: false,
    },
    (pres) => {
      const h = { ...pres.headers };
      // Dev-only: let the site load inside the preview frames.
      delete h['x-frame-options'];
      if (h['content-security-policy']) {
        h['content-security-policy'] = String(h['content-security-policy']).replace(/frame-ancestors[^;]*;?/gi, '');
      }
      if (h.location) h.location = String(h.location).replace(target.origin, '');
      res.writeHead(pres.statusCode, h);
      pres.pipe(res);
    },
  );
  upstream.on('error', (e) => {
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Device Preview: cannot reach ${target.origin} (${e.code}). Is the dev server running?`);
  });
  req.pipe(upstream);
});

// WebSockets (Vite / Next / webpack hot reload).
server.on('upgrade', (req, socket, head) => {
  const up = isHttps
    ? tls.connect({ host: target.hostname, port: targetPort, servername: target.hostname, rejectUnauthorized: false })
    : net.connect(targetPort, target.hostname);
  let lines = `${req.method} ${req.url} HTTP/1.1\r\n`;
  for (const [k, v] of Object.entries(rewriteHeaders(req.headers))) {
    for (const vv of [].concat(v)) lines += `${k}: ${vv}\r\n`;
  }
  up.write(lines + '\r\n');
  if (head?.length) up.write(head);
  up.pipe(socket);
  socket.pipe(up);
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

// ---------- listen on the first free port ----------
function listen(port) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && port < firstPort + 20) listen(port + 1);
    else { console.error(e.message); process.exit(1); }
  });
  server.listen(port, () => {
    const url = uiUrl(port, startPath);
    console.log(`✓ Device Preview running: ${url}`);
    console.log('  Keep this process running while you preview. Ctrl+C to stop.');
    openBrowser(url);
  });
}
listen(firstPort);
