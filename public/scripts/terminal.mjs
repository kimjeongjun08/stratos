// ORI — scripted terminal demo.
// Types out a realistic `ori deploy` session with colored output, then
// loops. Starts when scrolled into view; respects reduced-motion.

const SCRIPT = [
  { t: 'cmd', text: '$ ori deploy', after: 400 },
  { t: 'dim', text: '→ detecting project… Node 22 · 3 functions · 1 static site', after: 350 },
  { t: 'cyan', text: '→ building image  [████████████████████]  2.1s', after: 500 },
  { t: 'dim', text: '→ streaming weights to edge cache (1.2 GB)…', after: 450 },
  { t: 'cyan', text: '→ pushing to 12 regions simultaneously', after: 600 },
  { t: 'ok', text: '  ✓ iad  ✓ sfo  ✓ lhr  ✓ fra  ✓ nrt  ✓ sin', after: 250 },
  { t: 'ok', text: '  ✓ syd  ✓ gru  ✓ bom  ✓ cpt  ✓ icn  ✓ yyz', after: 450 },
  { t: 'dim', text: '→ running health checks · mTLS handshake · anycast warm-up', after: 500 },
  { t: 'violet', text: '→ promoting to production with instant rollback armed', after: 500 },
  { t: 'ok', text: '✓ live in 4.8s — https://acme.ori.app', after: 700 },
  { t: 'dim', text: '  p99 11ms · cold-start 184ms · 0 ops required', after: 1600 },
];

function line(cls, text) {
  const span = document.createElement('span');
  span.className = `t-${cls}`;
  span.textContent = text;
  return span;
}

export function initTerminal(el, { onDeploy } = {}) {
  if (!el) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let started = false;

  const cursor = document.createElement('span');
  cursor.className = 'terminal__cursor';

  async function typeLine(entry) {
    const span = line(entry.t, '');
    el.appendChild(span);
    el.appendChild(document.createTextNode('\n'));
    if (reduce) { span.textContent = entry.text; return; }
    const speed = entry.t === 'cmd' ? 38 : 6;
    for (let i = 0; i < entry.text.length; i++) {
      span.textContent += entry.text[i];
      el.appendChild(cursor);
      await sleep(speed + (entry.t === 'cmd' ? Math.random() * 40 : 0));
    }
  }

  async function run() {
    el.innerHTML = '';
    for (const entry of SCRIPT) {
      await typeLine(entry);
      if (entry.t === 'ok' && entry.text.includes('live in')) onDeploy?.();
      await sleep(reduce ? 60 : entry.after);
    }
    el.appendChild(cursor);
    await sleep(3200);
    run(); // loop
  }

  const io = new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !started) { started = true; run(); }
  }, { threshold: 0.3 });
  io.observe(el);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export default initTerminal;
