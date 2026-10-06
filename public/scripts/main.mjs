// ORI — application entry point.
// Orchestrates the preloader, custom cursor, navigation, live counters,
// presence, globe, terminal, pricing, quotes, and the waitlist flow.

import Audio from './audio.mjs';
import realtime from './realtime.mjs';
import { createGlobe } from './globe.mjs';
import { initTerminal } from './terminal.mjs';
import { initPricing } from './pricing.mjs';
import { initReveals, initMagnetic, initTilt, initGsap } from './scroll.mjs';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ───────────────────────── Preloader ─────────────────────────
function runPreloader() {
  const el = $('#preloader');
  const pct = $('[data-pct]');
  const fill = $('[data-barfill]');
  if (!el) return Promise.resolve();

  return new Promise((resolve) => {
    let p = 0;
    const tick = setInterval(() => {
      p = Math.min(100, p + Math.random() * 18);
      if (pct) pct.textContent = Math.floor(p) + '%';
      if (fill) fill.style.width = p + '%';
      if (p >= 100) {
        clearInterval(tick);
        setTimeout(() => {
          el.classList.add('done');
          document.body.classList.add('loaded');
          resolve();
        }, 350);
      }
    }, 140);
  });
}

// ───────────────────────── Custom cursor ─────────────────────────
function initCursor() {
  if (matchMedia('(pointer: coarse)').matches) { document.body.classList.add('no-custom-cursor'); return; }
  const ring = $('[data-cursor]');
  const dot = $('[data-cursor-dot]');
  let rx = 0, ry = 0, dx = 0, dy = 0;

  addEventListener('pointermove', (e) => {
    dx = e.clientX; dy = e.clientY;
    // feed normalized position to the presence layer
    realtime.sendCursor(e.clientX / innerWidth, e.clientY / innerHeight);
  }, { passive: true });

  function loop() {
    rx += (dx - rx) * 0.18; ry += (dy - ry) * 0.18;
    if (ring) ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%,-50%)`;
    if (dot) dot.style.transform = `translate(${dx}px, ${dy}px) translate(-50%,-50%)`;
    requestAnimationFrame(loop);
  }
  loop();

  const hoverables = 'a, button, input, select, [data-tilt], [data-magnetic]';
  document.addEventListener('pointerover', (e) => {
    if (e.target.closest(hoverables)) ring?.classList.add('is-hover');
  });
  document.addEventListener('pointerout', (e) => {
    if (e.target.closest(hoverables)) ring?.classList.remove('is-hover');
  });
}

// ───────────────────────── Nav + scroll rail ─────────────────────────
function initNavAndRail() {
  const nav = $('[data-nav]');
  const fill = $('[data-scrollfill]');
  const onScroll = () => {
    const y = scrollY;
    nav?.classList.toggle('scrolled', y > 40);
    const h = document.documentElement.scrollHeight - innerHeight;
    if (fill) fill.style.width = (h > 0 ? (y / h) * 100 : 0) + '%';
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// ───────────────────────── Sound toggle + SFX wiring ─────────────────────────
function initSound() {
  const btn = $('[data-sound-toggle]');
  const label = $('[data-sound-label]');
  btn?.addEventListener('click', async () => {
    const on = await Audio.toggle();
    btn.setAttribute('aria-pressed', String(on));
    if (label) label.textContent = on ? 'On' : 'Sound';
    if (on) Audio.play('confirm');
  });

  // UI cues on tagged elements
  document.addEventListener('pointerenter', (e) => {
    const t = e.target.closest?.('[data-sfx="hover"], a.btn, .nav__links a');
    if (t) Audio.play('hover');
  }, true);
  document.addEventListener('click', (e) => {
    const t = e.target.closest?.('[data-sfx="confirm"]');
    if (t) Audio.play('click');
  }, true);
}

// ───────────────────────── Live counters ─────────────────────────
const nf = new Intl.NumberFormat('en-US');
function compact(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k';
  return String(Math.round(n));
}

function initCounters() {
  // smooth-eased displayed values
  const state = { rps: 0, p99: 0, edge: 0, gpu: 0 };
  const target = { rps: 0, p99: 0, edge: 0, gpu: 0 };

  const bandEls = {
    rps: $('[data-counter="rps"]'), p99: $('[data-counter="p99"]'),
    edge: $('[data-counter="edge"]'), gpu: $('[data-counter="gpu"]'),
  };
  const heroEls = {
    rps: $('[data-metric="rps"]'), p99: $('[data-metric="p99"]'), edge: $('[data-metric="edge"]'),
  };

  realtime.addEventListener('metrics', (e) => {
    const d = e.detail;
    target.rps = d.rps;
    target.p99 = d.p99;
    target.edge = d.edgeNodes;
    target.gpu = (d.gpuUtil ?? 0) * 100;
  });

  function render() {
    for (const k of Object.keys(state)) {
      state[k] += (target[k] - state[k]) * 0.1;
    }
    if (bandEls.rps) bandEls.rps.textContent = nf.format(Math.round(state.rps));
    if (bandEls.p99) bandEls.p99.textContent = state.p99.toFixed(1);
    if (bandEls.edge) bandEls.edge.textContent = nf.format(Math.round(state.edge));
    if (bandEls.gpu) bandEls.gpu.textContent = state.gpu.toFixed(1);

    if (heroEls.rps) heroEls.rps.textContent = compact(state.rps);
    if (heroEls.p99) heroEls.p99.textContent = state.p99.toFixed(1) + 'ms';
    if (heroEls.edge) heroEls.edge.textContent = nf.format(Math.round(state.edge));
    requestAnimationFrame(render);
  }
  render();
}

// ───────────────────────── Presence + remote cursors ─────────────────────────
function initPresence() {
  const countEl = $('[data-live-count]');
  realtime.addEventListener('presence', (e) => {
    if (countEl) countEl.textContent = e.detail.count;
  });

  const layer = $('#remote-cursors');
  const myId = { value: null };
  const cursors = new Map();
  realtime.addEventListener('hello', (e) => { myId.value = e.detail.id; });
  realtime.addEventListener('cursor', (e) => {
    const { id, x, y } = e.detail;
    if (!layer || id === myId.value) return;
    let c = cursors.get(id);
    if (!c) { c = document.createElement('div'); c.className = 'remote-cursor'; layer.appendChild(c); cursors.set(id, c); }
    c.style.left = x * innerWidth + 'px';
    c.style.top = y * innerHeight + 'px';
    clearTimeout(c._t);
    c._t = setTimeout(() => { c.remove(); cursors.delete(id); }, 5000);
  });
}

// ───────────────────────── Globe + region list ─────────────────────────
async function initGlobes() {
  let regions = [];
  try {
    regions = (await fetch('/api/regions').then((r) => r.json())).regions;
  } catch {
    try { regions = (await fetch('/data/regions.json').then((r) => r.json())).regions; } catch { regions = []; }
  }

  // populate waitlist region <select>
  const select = $('.waitlist select[name="region"]');
  regions.forEach((rg) => {
    const o = document.createElement('option');
    o.value = rg.code; o.textContent = rg.name;
    select?.appendChild(o);
  });

  // populate region list
  const list = $('[data-region-list]');
  const readoutCode = $('.network__readout-code');
  const readoutName = $('.network__readout-name');
  let detailGlobe = null;

  regions.forEach((rg) => {
    const li = document.createElement('li');
    li.className = 'region-item';
    li.dataset.code = rg.code;
    li.innerHTML = `
      <span class="region-item__code">${rg.code}</span>
      <span class="region-item__name">${rg.name}</span>
      <span class="region-item__tier">${rg.tier}</span>
      <span class="region-item__dot"></span>`;
    li.addEventListener('pointerenter', () => {
      $$('.region-item').forEach((x) => x.classList.remove('active'));
      li.classList.add('active');
      if (readoutCode) readoutCode.textContent = rg.code.toUpperCase();
      if (readoutName) readoutName.textContent = rg.name + ' · operational';
      detailGlobe?.focusRegion(rg.code);
      Audio.play('hover');
    });
    list?.appendChild(li);
  });

  // hero background globe
  const heroCanvas = $('[data-globe]');
  if (heroCanvas) {
    createGlobe(heroCanvas, { regions, interactive: false, arcs: true }).catch(() => {});
  }
  // detail interactive globe
  const detailCanvas = $('[data-globe-detail]');
  if (detailCanvas) {
    detailGlobe = await createGlobe(detailCanvas, {
      regions, interactive: true, arcs: true,
      onRegionHover: (rg) => {
        if (!rg) return;
        if (readoutCode) readoutCode.textContent = rg.code.toUpperCase();
        if (readoutName) readoutName.textContent = rg.name + ' · operational';
      },
    }).catch(() => null);
  }
}

// ───────────────────────── Quotes ─────────────────────────
async function initQuotes() {
  const track = $('[data-quotes]');
  if (!track) return;
  let quotes = [];
  try { quotes = await fetch('/data/testimonials.json').then((r) => r.json()); } catch { return; }
  track.innerHTML = quotes.map((q) => `
    <figure class="quote">
      <blockquote class="quote__text">“${q.text}”</blockquote>
      <figcaption class="quote__who">
        <span class="quote__avatar">${q.initials}</span>
        <span><span class="quote__name">${q.name}</span><br>
        <span class="quote__role">${q.role}</span></span>
      </figcaption>
    </figure>`).join('');
}

// ───────────────────────── Waitlist + confetti ─────────────────────────
function initWaitlist() {
  const form = $('[data-waitlist]');
  const msg = $('[data-waitlist-msg]');
  const countEl = $('[data-waitlist-count]');
  const submitLabel = $('[data-submit-label]');

  // seed count from /api/stats
  fetch('/api/stats').then((r) => r.json()).then((s) => {
    if (countEl) countEl.textContent = nf.format(s.waitlist ?? 0);
  }).catch(() => { if (countEl) countEl.textContent = '2,800+'; });

  realtime.addEventListener('signup', (e) => {
    if (countEl) countEl.textContent = nf.format(e.detail.total);
    burstConfetti();
  });

  form?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email || '')) {
      setMsg('Please enter a valid email address.', 'err');
      return;
    }
    if (submitLabel) submitLabel.textContent = 'Joining…';
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: data.email, company: data.company, region: data.region }),
      });
      const body = await res.json();
      if (res.ok) {
        setMsg(body.duplicate
          ? `You're already on the list — position #${body.position}.`
          : `You're in! Position #${body.position}. We'll be in touch.`, 'ok');
        Audio.play('success');
        burstConfetti();
        form.reset();
      } else {
        setMsg(body.error || 'Something went wrong. Try again.', 'err');
      }
    } catch {
      // No backend (static host): simulate success locally.
      setMsg("You're in! (demo mode — no backend connected)", 'ok');
      Audio.play('success');
      burstConfetti();
      form.reset();
    } finally {
      if (submitLabel) submitLabel.textContent = 'Request access';
    }
  });

  function setMsg(text, kind) {
    if (!msg) return;
    msg.textContent = text;
    msg.className = 'waitlist__msg ' + kind;
  }
}

// lightweight canvas confetti burst
function burstConfetti() {
  if (reduce) return;
  const canvas = $('[data-confetti]');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(devicePixelRatio, 2);
  canvas.width = canvas.offsetWidth * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  const colors = ['#38e8ff', '#8b7bff', '#5bffab', '#ffffff'];
  const parts = Array.from({ length: 140 }, () => ({
    x: canvas.width / 2, y: canvas.height / 2,
    vx: (Math.random() - 0.5) * 18 * dpr,
    vy: (Math.random() - 1.2) * 16 * dpr,
    g: 0.4 * dpr, life: 1,
    size: (2 + Math.random() * 4) * dpr,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
  }));
  let raf;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of parts) {
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.life -= 0.012; p.rot += p.vr;
      if (p.life <= 0) continue;
      alive = true;
      ctx.save();
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (alive) raf = requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  cancelAnimationFrame(raf);
  draw();
}

// ───────────────────────── Boot ─────────────────────────
async function boot() {
  realtime.connect();
  initCursor();
  initNavAndRail();
  initSound();
  initCounters();
  initPresence();
  initQuotes();
  initWaitlist();
  initPricing($('[data-calc]'));
  initTerminal($('[data-terminal-body]'), { onDeploy: () => Audio.play('whoosh') });

  // reveals/magnetic/tilt after preloader so initial transforms are clean
  await runPreloader();
  initReveals();
  initMagnetic();
  initTilt();
  initGsap();
  initGlobes();

  // register service worker (progressive enhancement)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
