#!/usr/bin/env node
/**
 * Device Preview server (Node 18+, no dependencies).
 *
 * Serves the laptop + mobile preview page and proxies the target site through
 * the same origin, so the page can sync scroll and navigation between frames.
 * WebSocket upgrades are proxied as well, which keeps hot reload working.
 *
 * Usage: node preview.mjs [url | port] [--port <n>] [--open]
 */

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const PREFIX = '/__device-preview';
const DEFAULT_PORT = 4747;
const PORT_RANGE = 20;
const DEFAULT_TARGET = 'http://localhost:3000';
const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'preview.html');

const options = parseArgs(process.argv.slice(2));
const target = new URL(options.target);
const isHttps = target.protocol === 'https:';
const targetPort = Number(target.port) || (isHttps ? 443 : 80);
const startPath = target.pathname + target.search + target.hash;

function parseArgs(args) {
  const valueOf = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const fixedPort = Number(valueOf('--port')) || Number(process.env.PORT) || 0;
  const positional = args.find((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--port');
  return {
    target: normalizeTarget(positional || DEFAULT_TARGET),
    fixedPort,
    firstPort: fixedPort || DEFAULT_PORT,
    open: args.includes('--open'),
  };
}

function normalizeTarget(value) {
  if (/^\d+$/.test(value)) return `http://localhost:${value}`;
  if (!/^https?:\/\//i.test(value)) return `http://${value}`;
  return value;
}

function previewUrl(port) {
  return `http://localhost:${port}${startPath || '/'}`;
}

function openBrowser(url) {
  const commands = {
    darwin: ['open', [url]],
    win32: ['cmd', ['/c', 'start', '""', url]],
  };
  const [cmd, cmdArgs] = commands[process.platform] || ['xdg-open', [url]];
  const fail = () => console.warn(`Could not open a browser. Open this manually: ${url}`);
  try {
    const child = spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' });
    child.on('error', fail);
    child.unref();
  } catch {
    fail();
  }
}

async function ping(port) {
  try {
    const res = await fetch(`http://localhost:${port}${PREFIX}/ping`, { signal: AbortSignal.timeout(400) });
    const info = await res.json();
    return info?.app === 'device-preview' ? info : null;
  } catch {
    return null;
  }
}

/** On a fixed port, stop an older preview server so this one can take the port. */
async function replaceExisting(port) {
  if (!(await ping(port))) return;
  try {
    await fetch(`http://localhost:${port}${PREFIX}/shutdown`, { method: 'POST' });
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 400));
}

/** Returns the port of a preview server that already proxies the same target. */
async function findExisting() {
  for (let port = options.firstPort; port < options.firstPort + PORT_RANGE; port++) {
    const info = await ping(port);
    if (info?.target === target.origin) return port;
  }
  return null;
}

async function checkTarget() {
  try {
    const res = await fetch(target, { signal: AbortSignal.timeout(3000) });
    console.log(`${target.origin} responded (${res.status})`);
  } catch {
    console.warn(`${target.origin} did not respond. Is the dev server running? Starting the preview anyway.`);
  }
}

function forwardHeaders(headers) {
  const out = { ...headers, host: target.host };
  if (out.origin) out.origin = target.origin;
  if (out.referer) out.referer = out.referer.replace(/^https?:\/\/[^/]+/, target.origin);
  return out;
}

/** Lets the site load inside the preview frames. Only meant for local development. */
function frameableHeaders(headers) {
  const out = { ...headers };
  delete out['x-frame-options'];
  if (out['content-security-policy']) {
    out['content-security-policy'] = String(out['content-security-policy']).replace(/frame-ancestors[^;]*;?/gi, '');
  }
  if (out.location) out.location = String(out.location).replace(target.origin, '');
  return out;
}

function renderPage(res, path) {
  const config = { target: target.origin, path: path || startPath || '/' };
  const html = readFileSync(TEMPLATE, 'utf8').replace('"__PREVIEW_CONFIG__"', JSON.stringify(config));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}

function handleInternal(req, res) {
  const url = new URL(req.url, 'http://localhost');
  switch (url.pathname) {
    case `${PREFIX}/ping`:
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ app: 'device-preview', target: target.origin }));

    case `${PREFIX}/shutdown`:
      if (req.method !== 'POST') break;
      res.end('bye');
      console.log('Replaced by a newer Device Preview server. Stopping.');
      return setTimeout(() => process.exit(0), 50);

    case `${PREFIX}/open`: {
      const link = url.searchParams.get('url') || '';
      if (/^https?:\/\//i.test(link)) openBrowser(link);
      res.writeHead(204);
      return res.end();
    }
  }
  renderPage(res, url.searchParams.get('path'));
}

function proxyRequest(req, res) {
  const client = isHttps ? https : http;
  const upstream = client.request(
    {
      hostname: target.hostname,
      port: targetPort,
      method: req.method,
      path: req.url,
      headers: forwardHeaders(req.headers),
      rejectUnauthorized: false,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode, frameableHeaders(upstreamRes.headers));
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', (err) => {
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Device Preview: cannot reach ${target.origin} (${err.code}). Is the dev server running?`);
  });
  req.pipe(upstream);
}

function proxyUpgrade(req, socket, head) {
  const upstream = isHttps
    ? tls.connect({ host: target.hostname, port: targetPort, servername: target.hostname, rejectUnauthorized: false })
    : net.connect(targetPort, target.hostname);

  const lines = [`${req.method} ${req.url} HTTP/1.1`];
  for (const [name, value] of Object.entries(forwardHeaders(req.headers))) {
    for (const v of [].concat(value)) lines.push(`${name}: ${v}`);
  }
  upstream.write(lines.join('\r\n') + '\r\n\r\n');
  if (head?.length) upstream.write(head);

  upstream.pipe(socket);
  socket.pipe(upstream);
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
}

function createServer() {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith(PREFIX)) return handleInternal(req, res);
    // Top-level page loads get the preview page; frames and assets go to the site.
    if (req.method === 'GET' && req.headers['sec-fetch-dest'] === 'document') return renderPage(res, req.url);
    proxyRequest(req, res);
  });
  server.on('upgrade', proxyUpgrade);
  return server;
}

function listen(server, port) {
  server.once('error', (err) => {
    const canRetry = err.code === 'EADDRINUSE' && !options.fixedPort && port < options.firstPort + PORT_RANGE - 1;
    if (canRetry) return listen(server, port + 1);
    console.error(err.message);
    process.exit(1);
  });
  server.listen(port, () => {
    const url = previewUrl(port);
    console.log(`Device Preview running: ${url}`);
    console.log('Keep this process running while you preview. Press Ctrl+C to stop.');
    if (options.open) openBrowser(url);
  });
}

if (options.fixedPort) {
  await replaceExisting(options.fixedPort);
} else {
  const port = await findExisting();
  if (port) {
    const url = previewUrl(port);
    console.log(`Device Preview already running for ${target.origin}: ${url}`);
    if (options.open) openBrowser(url);
    process.exit(0);
  }
}

await checkTarget();
listen(createServer(), options.firstPort);
