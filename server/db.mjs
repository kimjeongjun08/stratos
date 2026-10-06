// ORI — persistence layer
// Thin, synchronous wrapper around the built-in node:sqlite driver.
// Zero npm dependencies. WAL mode keeps reads fast while the live
// metrics writer appends in the background.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const HERE = import.meta.dirname;
const DB_PATH = resolve(HERE, process.env.DB_PATH ?? 'data/ori.db');

// Ensure the data directory exists before the driver opens the file.
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

// Apply schema idempotently.
const schema = readFileSync(resolve(HERE, 'schema.sql'), 'utf8');
db.exec(schema);

// --- Seed regions once (globe + status board data) ---------------------------
const REGIONS = [
  ['iad', 'US East · Virginia',   38.95, -77.45, 'core'],
  ['sfo', 'US West · California',  37.62, -122.37, 'core'],
  ['lhr', 'Europe · London',      51.47, -0.45,   'core'],
  ['fra', 'Europe · Frankfurt',   50.03, 8.57,    'core'],
  ['nrt', 'Asia · Tokyo',         35.55, 139.78,  'core'],
  ['sin', 'Asia · Singapore',     1.36,  103.99,  'core'],
  ['syd', 'Oceania · Sydney',    -33.95, 151.18,  'edge'],
  ['gru', 'South America · São Paulo', -23.43, -46.47, 'edge'],
  ['bom', 'Asia · Mumbai',        19.09, 72.87,   'edge'],
  ['cpt', 'Africa · Cape Town',  -33.97, 18.60,   'edge'],
  ['icn', 'Asia · Seoul',         37.46, 126.44,  'core'],
  ['yyz', 'Canada · Toronto',     43.68, -79.63,  'edge'],
];
const insertRegion = db.prepare(
  `INSERT OR IGNORE INTO regions (code, name, lat, lon, tier) VALUES (?, ?, ?, ?, ?)`
);
for (const r of REGIONS) insertRegion.run(...r);

// --- Prepared statements ------------------------------------------------------
const stmts = {
  addWaitlist: db.prepare(
    `INSERT INTO waitlist (email, company, use_case, region, ip_hash)
     VALUES (:email, :company, :use_case, :region, :ip_hash)`
  ),
  waitlistTotal: db.prepare(`SELECT COUNT(*) AS n FROM waitlist`),
  regions: db.prepare(`SELECT code, name, lat, lon, tier, status FROM regions`),
  logMetric: db.prepare(
    `INSERT INTO metrics_log (rps, p99_ms, edge_nodes, gpu_util)
     VALUES (:rps, :p99_ms, :edge_nodes, :gpu_util)`
  ),
  recentMetrics: db.prepare(
    `SELECT ts, rps, p99_ms, edge_nodes, gpu_util
     FROM metrics_log ORDER BY id DESC LIMIT :n`
  ),
  getCounter: db.prepare(`SELECT value FROM counters WHERE key = ?`),
  setCounter: db.prepare(`UPDATE counters SET value = :value WHERE key = :key`),
  bumpCounter: db.prepare(
    `UPDATE counters SET value = value + :by WHERE key = :key`
  ),
  // keep the time-series bounded so the file never grows unbounded
  trimMetrics: db.prepare(
    `DELETE FROM metrics_log WHERE id NOT IN
       (SELECT id FROM metrics_log ORDER BY id DESC LIMIT 2000)`
  ),
};

// --- Public API ---------------------------------------------------------------
export const Database = {
  raw: db,

  addToWaitlist({ email, company = null, use_case = null, region = null, ip_hash = null }) {
    const info = stmts.addWaitlist.run({ email, company, use_case, region, ip_hash });
    stmts.bumpCounter.run({ key: 'waitlist_total', by: 1 });
    return info.lastInsertRowid;
  },

  waitlistTotal() {
    return stmts.waitlistTotal.get().n;
  },

  regions() {
    return stmts.regions.all();
  },

  logMetric(m) {
    stmts.logMetric.run(m);
    // occasional trim to cap storage
    if (Math.random() < 0.02) stmts.trimMetrics.run();
  },

  recentMetrics(n = 60) {
    return stmts.recentMetrics.all({ n }).reverse();
  },

  counter(key) {
    return stmts.getCounter.get(key)?.value ?? 0;
  },

  bumpCounter(key, by = 1) {
    stmts.bumpCounter.run({ key, by });
    return this.counter(key);
  },

  setCounterMax(key, candidate) {
    const current = this.counter(key);
    if (candidate > current) stmts.setCounter.run({ key, value: candidate });
  },

  close() {
    db.close();
  },
};

// --- CLI: `node server/db.mjs --reset` ---------------------------------------
if (process.argv.includes('--reset')) {
  db.exec(`DROP TABLE IF EXISTS waitlist;
           DROP TABLE IF EXISTS metrics_log;
           DROP TABLE IF EXISTS counters;
           DROP TABLE IF EXISTS regions;`);
  console.log('[db] tables dropped — restart the server to re-seed.');
  db.close();
}

export default Database;
