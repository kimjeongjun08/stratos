// STRATOS — entry point.
// A single Node process that serves the static site, a small JSON API,
// and a hand-rolled WebSocket hub that streams live telemetry.
//
//   node server/index.mjs        # start
//   npm run dev                  # start with --watch
//
// Zero npm dependencies: http, fs, path, crypto, node:sqlite only.

import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { resolve, extname, normalize, join } from 'node:path';
import Database from './db.mjs';
import WebSocketHub from './ws.mjs';
import handleApi from './api.mjs';

const HERE = import.meta.dirname;
const PUBLIC = resolve(HERE, '..', 'public');
const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.glsl': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const hub = new WebSocketHub();

// ---------------------------------------------------------------------------
// Static file serving with path-traversal protection.
// ---------------------------------------------------------------------------
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  // Normalize and confine inside PUBLIC.
  const filePath = normalize(join(PUBLIC, rel));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  let target = filePath;
  if (!existsSync(target) || statSync(target).isDirectory()) {
    // SPA-style fallback: unknown non-asset routes get index.html.
    if (!extname(rel)) target = join(PUBLIC, 'index.html');
    else { res.writeHead(404).end('Not found'); return; }
  }

  const ext = extname(target).toLowerCase();
  const type = MIME[ext] ?? 'application/octet-stream';
  const { size, mtime } = statSync(target);

  const headers = {
    'content-type': type,
    'content-length': size,
    'last-modified': mtime.toUTCString(),
    'x-content-type-options': 'nosniff',
  };
  // Long cache for fingerprintable assets, revalidate HTML.
  headers['cache-control'] = ext === '.html'
    ? 'no-cache'
    : 'public, max-age=3600';

  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(target).pipe(res);
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  // basic hardening headers
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');

  // CORS: allow the static frontend (e.g. GitHub Pages) to reach this API
  // cross-origin so live metrics / presence / waitlist work from anywhere.
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-max-age', '86400');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (url.pathname.startsWith('/api/')) {
    try {
      const handled = await handleApi(req, res, url, hub);
      if (handled === false) res.writeHead(404, { 'content-type': 'application/json' })
        .end('{"error":"not found"}');
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: 'internal error' }));
    }
    return;
  }

  // Count a visit on the root document request.
  if (url.pathname === '/' || url.pathname === '/index.html') {
    Database.bumpCounter('visits', 1);
  }

  serveStatic(req, res, url.pathname);
});

// ---------------------------------------------------------------------------
// WebSocket upgrade handling
// ---------------------------------------------------------------------------
server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname === '/ws') {
    hub.handleUpgrade(req, socket);
    // Track the concurrent peak for the stats endpoint.
    Database.setCounterMax('peak_concurrent', hub.size);
  } else {
    socket.destroy();
  }
});

// ---------------------------------------------------------------------------
// Live telemetry simulator — ONE shared loop drives every connected client.
// Models a global cluster with a plausible diurnal traffic curve + jitter.
// ---------------------------------------------------------------------------
let tick = 0;
const telemetry = setInterval(() => {
  tick++;
  const t = Date.now() / 1000;
  // smooth base wave + brownian-ish jitter
  const base = 820_000 + Math.sin(t / 40) * 180_000 + Math.sin(t / 7) * 40_000;
  const rps = Math.max(120_000, Math.round(base + (Math.random() - 0.5) * 60_000));
  const p99 = +(8 + Math.sin(t / 11) * 2.4 + Math.random() * 1.8).toFixed(2);
  const edgeNodes = 3200 + Math.round(Math.sin(t / 90) * 120 + Math.random() * 40);
  const gpuUtil = +(0.62 + Math.sin(t / 23) * 0.12 + Math.random() * 0.06).toFixed(3);

  const sample = { rps, p99_ms: p99, edge_nodes: edgeNodes, gpu_util: gpuUtil };
  Database.logMetric(sample);
  Database.setCounterMax('peak_concurrent', hub.size);

  hub.broadcast({
    type: 'metrics',
    ts: Date.now(),
    rps,
    p99,
    edgeNodes,
    gpuUtil,
    live: hub.size,
  });
}, 1000);
telemetry.unref?.();

// Relay live cursors between clients for a subtle "others are here" effect.
hub.onMessage((client, msg) => {
  if (msg.type === 'cursor') {
    hub.broadcast({ type: 'cursor', id: client.id, x: msg.x, y: msg.y });
  }
});

// ---------------------------------------------------------------------------
// Boot + graceful shutdown
// ---------------------------------------------------------------------------
server.listen(PORT, HOST, () => {
  console.log(`\n  ▲ STRATOS control plane online`);
  console.log(`  ├─ http      http://localhost:${PORT}`);
  console.log(`  ├─ websocket ws://localhost:${PORT}/ws`);
  console.log(`  ├─ sqlite    ${process.env.DB_PATH ?? 'data/stratos.db'}`);
  console.log(`  └─ deps      0 (http · crypto · node:sqlite)\n`);
});

function shutdown() {
  console.log('\n  ◼ shutting down…');
  clearInterval(telemetry);
  hub.stop();
  server.close(() => { Database.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 1500).unref?.();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
