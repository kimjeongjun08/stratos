// STRATOS — scroll & micro-interaction layer.
// IntersectionObserver drives the core reveals (works with zero deps); GSAP +
// ScrollTrigger, loaded from CDN, layer on parallax and the horizontal quote
// rail. Everything degrades gracefully if GSAP or motion is unavailable.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Wrap each character of a [data-split] heading for the rise-in effect. */
export function splitText(el) {
  if (!el || el.dataset.splitDone) return;
  el.dataset.splitDone = '1';
  const html = el.innerHTML;
  // split on <br> into lines, then characters
  const lines = html.split(/<br\s*\/?>/i);
  el.innerHTML = lines.map((lineHtml) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = lineHtml;
    const text = tmp.textContent;
    // preserve any <em> by re-detecting it crudely: keep emphasis spans
    const chars = [...text].map((c) =>
      c === ' ' ? ' ' : `<span class="char">${c}</span>`
    ).join('');
    return `<span class="line">${chars}</span>`;
  }).join('');
  // stagger
  el.querySelectorAll('.char').forEach((c, i) => {
    c.style.transitionDelay = `${i * 22}ms`;
  });
}

/** Reveal elements as they enter the viewport. */
export function initReveals() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });

  document.querySelectorAll('[data-reveal], [data-split]').forEach((el) => {
    if (el.hasAttribute('data-split')) splitText(el);
    if (reduce) { el.classList.add('in'); return; }
    io.observe(el);
  });
}

/** Magnetic buttons that lean toward the cursor. */
export function initMagnetic() {
  if (reduce || matchMedia('(pointer: coarse)').matches) return;
  document.querySelectorAll('[data-magnetic]').forEach((el) => {
    const strength = 0.4;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2);
      const y = e.clientY - (r.top + r.height / 2);
      el.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  });
}

/** 3D tilt + spotlight on feature cards. */
export function initTilt() {
  if (reduce || matchMedia('(pointer: coarse)').matches) return;
  document.querySelectorAll('[data-tilt]').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      el.style.setProperty('--mx', `${px * 100}%`);
      el.style.setProperty('--my', `${py * 100}%`);
      const rx = (py - 0.5) * -6;
      const ry = (px - 0.5) * 6;
      el.style.transform = `perspective(800px) rotateX(${rx}deg) rotateY(${ry}deg)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  });
}

/** Optional GSAP layer: hero parallax + horizontal quotes. */
export async function initGsap() {
  if (reduce) return;
  let gsap, ScrollTrigger;
  try {
    ({ gsap } = await import('gsap'));
    ({ ScrollTrigger } = await import('gsap/ScrollTrigger'));
    gsap.registerPlugin(ScrollTrigger);
  } catch {
    return; // offline / blocked — IntersectionObserver reveals still run
  }

  // hero copy drifts up slightly as you scroll past
  gsap.to('.hero__inner', {
    yPercent: -12, opacity: 0.6, ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
  });

  // metric values gently rise as the band enters
  gsap.from('.metric', {
    yPercent: 30, opacity: 0, stagger: 0.08, ease: 'power3.out',
    scrollTrigger: { trigger: '.metrics', start: 'top 80%' },
  });

  // horizontal scroll for the quotes rail
  const track = document.querySelector('[data-quotes]');
  if (track && track.children.length) {
    const scrollLen = () => track.scrollWidth - window.innerWidth + 120;
    gsap.to(track, {
      x: () => -scrollLen(),
      ease: 'none',
      scrollTrigger: {
        trigger: '.quotes',
        start: 'top top',
        end: () => `+=${scrollLen()}`,
        pin: true, scrub: 1, invalidateOnRefresh: true,
      },
    });
  }

  window.addEventListener('load', () => ScrollTrigger.refresh());
}

export default { initReveals, initMagnetic, initTilt, initGsap, splitText };
