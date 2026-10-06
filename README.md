<div align="center">

# ▲ STRATOS

### The cloud that thinks at the edge.

A production-grade marketing site for a fictional AI-native edge cloud —
built as a showcase of what the modern web platform can do with **zero npm
dependencies** on the backend and **no build step** on the frontend.

WebGL · Web Audio · hand-rolled WebSockets · built-in SQLite · scroll cinema

</div>

---

## Why this exists

Most landing pages stop at HTML + CSS. STRATOS goes the distance: a real-time
backend, a WebGL planet, a procedural-audio engine, and a scroll-driven
narrative — all wired together and all runnable from a single `node` command.

It is deliberately **dependency-light**:

| Layer        | What powers it                                   | Dependencies |
| ------------ | ------------------------------------------------ | ------------ |
| HTTP server  | `node:http`                                      | 0            |
| WebSockets   | hand-written RFC 6455 (handshake + framing)      | 0            |
| Database     | built-in `node:sqlite`                           | 0            |
| 3D globe     | Three.js + custom GLSL (via CDN import map)      | 0 installed  |
| Scroll FX    | GSAP ScrollTrigger (via CDN import map)          | 0 installed  |
| Audio        | Web Audio API (fully synthesized, no files)      | 0            |

> **node_modules is empty by design.** The only third-party code is Three.js
> and GSAP, loaded straight from a CDN through an ES module import map — so
> there is nothing to install for the frontend either.

## Quick start

```bash
# Node 22.5+ required (for the built-in node:sqlite module)
node --version

# start the full stack (http + websocket + sqlite)
npm start
# → http://localhost:4173
```

That's it. No `npm install`. The SQLite database is created and seeded on
first boot at `server/data/stratos.db`.

```bash
npm run dev        # same, with --watch hot reload
npm run db:reset   # drop all tables (re-seeded on next start)
```

## What's live

- **Real-time metrics** — one shared server loop simulates a global cluster and
  broadcasts telemetry once per second to every connected client over WebSocket.
- **Presence** — the "N live" pill shows everyone currently on the page; move
  your mouse and other visitors see your cursor (and you see theirs).
- **Waitlist** — the form writes to SQLite and pushes a live signup event (plus
  confetti) to everyone watching.
- **Graceful fallback** — open the static files without the Node server (e.g.
  GitHub Pages) and the page detects the missing backend, then simulates the
  live data locally so nothing looks broken.

## Project structure

```
stratos/
├── server/                 # zero-dependency Node backend
│   ├── index.mjs           #   http + static + upgrade routing + telemetry loop
│   ├── ws.mjs              #   hand-rolled WebSocket hub (RFC 6455)
│   ├── db.mjs              #   node:sqlite persistence layer
│   ├── api.mjs             #   small JSON REST API
│   └── schema.sql          #   database schema (WAL mode)
├── public/                 # no-build frontend
│   ├── index.html
│   ├── styles/             #   reset · tokens · components · animations · responsive
│   ├── scripts/            #   main · globe · audio · scroll · realtime · terminal · pricing
│   ├── shaders/            #   globe.vert / globe.frag / atmosphere.frag (GLSL)
│   ├── data/               #   pricing · testimonials · regions (static fallback)
│   ├── assets/             #   svg logo / favicon / og image
│   ├── manifest.webmanifest
│   └── sw.js               #   offline-first service worker
└── docs/
    └── ARCHITECTURE.md
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the deep dive on the
WebSocket framing, the telemetry fan-out, and the globe shader.

## Accessibility & performance

- Full `prefers-reduced-motion` support — all animation, audio-reactive UI and
  the globe spin stand down when the user asks for less motion.
- Custom cursor and tilt effects disable themselves on touch / coarse pointers.
- Audio never autoplays; it waits for an explicit user gesture.
- Static assets are cache-controlled and served with `nosniff`; the WebGL loop
  pauses when the canvas scrolls offscreen.

## Deploying

- **Full stack (recommended):** any host that runs Node 22.5+ — `npm start`
  behind a reverse proxy. WebSockets and SQLite work out of the box.
- **Static only (GitHub Pages):** publish the `public/` directory. The live
  features fall back to the in-browser simulator automatically.

## License

MIT — see [LICENSE](LICENSE). STRATOS is a fictional company; all metrics,
logos and testimonials are illustrative.
