// STRATOS — realtime client.
// Connects to the hand-rolled WebSocket hub for live metrics + presence.
// Targets the configured backend (config.mjs) when set; otherwise same-origin.
// If no backend is reachable (e.g. served statically on GitHub Pages with no
// backendUrl), it transparently falls back to a local simulator.

import { wsUrl } from './config.mjs';

class Realtime extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.connected = false;
    this.backoff = 1000;
    this.simTimer = null;
    this.lastCursorSent = 0;
    this.mode = 'connecting';
    this.simPresence = 0;
  }

  connect() {
    let url;
    try { url = wsUrl(); } catch { this._simulate(); return; }

    try {
      this.ws = new WebSocket(url);
    } catch {
      this._simulate();
      return;
    }

    const failTimer = setTimeout(() => {
      if (!this.connected) { try { this.ws.close(); } catch {} this._simulate(); }
    }, 2500);

    this.ws.addEventListener('open', () => {
      clearTimeout(failTimer);
      this.connected = true;
      this.mode = 'live';
      this.backoff = 1000;
      this._stopSimulate();
      this.dispatchEvent(new CustomEvent('status', { detail: { mode: 'live' } }));
    });

    this.ws.addEventListener('message', (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }));
    });

    this.ws.addEventListener('close', () => {
      clearTimeout(failTimer);
      if (this.connected) {
        this.connected = false;
        // try to reconnect with capped backoff
        setTimeout(() => this.connect(), this.backoff);
        this.backoff = Math.min(this.backoff * 1.8, 15000);
      } else {
        this._simulate();
      }
    });

    this.ws.addEventListener('error', () => { try { this.ws.close(); } catch {} });
  }

  send(obj) {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  sendCursor(x, y) {
    const now = performance.now();
    if (now - this.lastCursorSent < 60) return; // throttle to ~16/s
    this.lastCursorSent = now;
    this.send({ type: 'cursor', x: +x.toFixed(3), y: +y.toFixed(3) });
  }

  // --- local fallback simulator -------------------------------------------
  // Used only when no backend is reachable. Presence does a slow random walk so
  // it feels alive; metrics follow a diurnal wave. (Real presence requires the
  // Node backend — set backendUrl in config.js to make it genuine.)
  _simulate() {
    if (this.simTimer) return;
    this.mode = 'demo';
    this.simPresence = 12 + Math.floor(Math.random() * 30);
    this.dispatchEvent(new CustomEvent('status', { detail: { mode: 'demo' } }));
    this.dispatchEvent(new CustomEvent('presence', { detail: { count: this.simPresence } }));

    let tick = 0;
    this.simTimer = setInterval(() => {
      tick++;
      const t = Date.now() / 1000;
      const rps = Math.round(820000 + Math.sin(t / 40) * 180000 + (Math.random() - 0.5) * 60000);
      this.dispatchEvent(new CustomEvent('metrics', { detail: {
        type: 'metrics', ts: Date.now(), rps,
        p99: +(9 + Math.sin(t / 11) * 2 + Math.random() * 1.5).toFixed(2),
        edgeNodes: 3200 + Math.round(Math.sin(t / 90) * 120),
        gpuUtil: +(0.64 + Math.sin(t / 23) * 0.1).toFixed(3),
        live: this.simPresence,
      }}));
      // random-walk the presence count every ~4s
      if (tick % 4 === 0) {
        this.simPresence = Math.max(3, this.simPresence + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 3)));
        this.dispatchEvent(new CustomEvent('presence', { detail: { count: this.simPresence } }));
      }
    }, 1000);
  }

  _stopSimulate() {
    if (this.simTimer) { clearInterval(this.simTimer); this.simTimer = null; }
  }
}

export const realtime = new Realtime();
export default realtime;
