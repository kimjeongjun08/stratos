// ORI — REST API handlers.
// Small, dependency-free JSON endpoints backed by SQLite.

import { createHash } from 'node:crypto';
import Database from './db.mjs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

function hashIp(req) {
  const ip = req.socket.remoteAddress ?? '';
  return createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

/**
 * Route an /api/* request. Returns true if it handled the request.
 * `hub` is the WebSocket hub, used to push live events on signup.
 */
export async function handleApi(req, res, url, hub) {
  const { pathname } = url;

  // --- GET /api/regions ------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/regions') {
    return json(res, 200, { regions: Database.regions() });
  }

  // --- GET /api/stats --------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/stats') {
    return json(res, 200, {
      waitlist: Database.waitlistTotal(),
      visits: Database.counter('visits'),
      peakConcurrent: Database.counter('peak_concurrent'),
      live: hub.size,
      metrics: Database.recentMetrics(60),
    });
  }

  // --- POST /api/waitlist ----------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/waitlist') {
    let body;
    try { body = await readBody(req); }
    catch (e) { return json(res, 400, { error: e.message }); }

    const email = String(body.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return json(res, 422, { error: 'A valid email is required.' });
    }

    try {
      const id = Database.addToWaitlist({
        email,
        company: body.company ? String(body.company).slice(0, 120) : null,
        use_case: body.useCase ? String(body.useCase).slice(0, 400) : null,
        region: body.region ? String(body.region).slice(0, 12) : null,
        ip_hash: hashIp(req),
      });
      const total = Database.waitlistTotal();
      // Push a live celebratory event to everyone currently on the page.
      hub.broadcast({ type: 'signup', total });
      return json(res, 201, { ok: true, id, position: total });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return json(res, 200, { ok: true, duplicate: true, position: Database.waitlistTotal() });
      }
      return json(res, 500, { error: 'Could not join the waitlist.' });
    }
  }

  // --- GET /api/health -------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/health') {
    return json(res, 200, { status: 'operational', ts: new Date().toISOString() });
  }

  return false; // not an API route we recognize
}

export default handleApi;
