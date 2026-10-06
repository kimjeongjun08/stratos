# STRATOS — architecture notes

A tour of the non-obvious parts. The guiding constraint throughout: **ship no
npm dependencies** and **no build step**, while still behaving like a real
real-time product.

## 1. The request lifecycle

```
            ┌──────────────────────────── node server/index.mjs ───────────────────────────┐
browser ──▶ │  http.createServer                                                           │
            │    ├─ /api/*   → api.mjs  ──▶ db.mjs (node:sqlite)                            │
            │    ├─ GET /    → static file from public/ (+ visit counter)                  │
            │    └─ upgrade  → ws.mjs  WebSocketHub.handleUpgrade()                         │
            │                                                                               │
            │  setInterval(1s): telemetry simulator ──▶ hub.broadcast({type:'metrics'})     │
            └───────────────────────────────────────────────────────────────────────────┘
```

A single Node process is the HTTP server, the static file server, the REST API
and the WebSocket hub. There is no framework in between.

## 2. Hand-rolled WebSockets (`server/ws.mjs`)

We implement enough of **RFC 6455** to run the live features without the `ws`
package:

- **Handshake** — on an HTTP `Upgrade: websocket` request we compute
  `Sec-WebSocket-Accept = base64(sha1(key + GUID))` with `node:crypto` and write
  the `101 Switching Protocols` response by hand.
- **Framing** — `FrameDecoder` is a small state machine fed raw TCP chunks. It
  parses the FIN bit, opcode, mask bit, the 7/16/64-bit payload length, applies
  the client→server XOR mask, and reassembles fragmented messages. Server→client
  frames are encoded unmasked.
- **Control frames** — ping/pong/close are handled; a heartbeat pings every
  client on an interval and reaps sockets that miss a pong.

### Connection efficiency

The brief asked to "use user connections efficiently." Concretely:

- **One broadcast, serialized once.** `hub.broadcast(obj)` does
  `JSON.stringify` + `encodeFrame` a single time, then writes the same `Buffer`
  to every socket — no per-client serialization.
- **One shared timer.** A single 1s `setInterval` drives telemetry for all
  clients instead of a timer per connection.
- **Back-pressure friendly.** Writes are gated on `socket.writable`.
- **Per-IP caps.** `WS_MAX_PER_IP` rejects connection floods from one address.
- **Throttled client input.** Cursor updates are rate-limited to ~16/s on the
  client before they ever hit the wire.

## 3. Persistence (`server/db.mjs` + `schema.sql`)

Uses the built-in `node:sqlite` `DatabaseSync` driver (Node 22.5+). WAL mode
keeps reads fast while the telemetry writer appends in the background. All
statements are prepared once and reused. The `metrics_log` table is trimmed to
its most recent rows so the file never grows unbounded.

Tables: `waitlist`, `regions` (seeded on boot), `metrics_log`, `counters`.

## 4. The globe (`public/scripts/globe.mjs` + `shaders/`)

- The planet is a sphere rendered with a **custom GLSL `ShaderMaterial`**. The
  fragment shader derives latitude/longitude from the surface position and
  draws a dot grid that brightens along a travelling terminator sweep, wrapped
  in a fresnel rim in the brand gradient. A second back-side sphere adds the
  atmosphere glow.
- **Region nodes** are placed by converting `(lat, lon)` to a 3D vector; each
  gets a pulsing halo ring.
- **Data arcs** are quadratic Bézier curves lifted off the surface, with a
  glowing pulse mesh travelling along each one.
- The render loop **pauses when the canvas is offscreen** (IntersectionObserver)
  and honors `prefers-reduced-motion`. A `pivot` group handles pointer parallax
  independently of the continuous spin on the inner `root` group.

GLSL is kept in real `.glsl` files and `fetch()`-ed at runtime (cached across
both globe instances) — no bundler needed.

## 5. Procedural audio (`public/scripts/audio.mjs`)

Every sound is synthesized with the Web Audio API, so the repo ships no audio
files. An ambient pad is a stack of detuned oscillators with slow gain LFOs plus
filtered noise; UI cues are short enveloped blips and arpeggios; the deploy
"whoosh" is a band-passed noise sweep. The context is created lazily inside the
sound-toggle click handler to satisfy autoplay policies.

## 6. Resilience & fallback (`public/scripts/realtime.mjs`)

The client tries to open `ws(s)://<host>/ws`. If the upgrade fails within
2.5s — which is exactly what happens when the static files are served without
the Node backend — it switches to a **local simulator** that emits the same
metric/presence events, so the page stays alive on GitHub Pages. When a live
connection drops, it reconnects with capped exponential backoff.

## 7. No-build frontend

Three.js and GSAP are resolved through a native **ES module import map** in
`index.html`, loaded from a CDN. The rest of the frontend is hand-authored ES
modules. The service worker (`sw.js`) caches the shell for offline loads while
always letting `/api/*` and cross-origin requests hit the network.
