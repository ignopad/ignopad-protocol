// Motion layer: damped spring solver, scroll reveal, parallax, spotlight, count-up, progress.
// Every export degrades to an instant, motionless result under prefers-reduced-motion.

const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
export const reduced = () => mq.matches;

// Damped harmonic oscillator, semi-implicit Euler on a fixed sub-step.
// x'' = -k (x - target) - c x'   (k=170, c=22: damping ratio ~0.84, settles with a slight overshoot)
export function spring({ from, to, k = 170, c = 22, onStep, onDone, eps = 0.0008 }) {
  if (reduced()) { onStep(to); if (onDone) onDone(); return () => {}; }
  let x = from, v = 0, last = performance.now(), raf = 0, dead = false;
  const h = 1 / 240;
  const frame = (now) => {
    if (dead) return;
    let dt = Math.min((now - last) / 1000, 0.064);
    last = now;
    while (dt > 0) {
      const s = Math.min(h, dt);
      v += (-k * (x - to) - c * v) * s;
      x += v * s;
      dt -= s;
    }
    if (Math.abs(x - to) < eps && Math.abs(v) < eps) { onStep(to); if (onDone) onDone(); return; }
    onStep(x);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => { dead = true; cancelAnimationFrame(raf); };
}

// ---- scroll reveal with stagger ----
export function initReveal(root = document) {
  const els = [...root.querySelectorAll('[data-reveal]:not([data-revealed])')];
  if (!els.length) return;
  const play = (el, delay) => {
    el.setAttribute('data-revealed', '');
    const dist = parseFloat(el.getAttribute('data-reveal-y') || '28');
    const run = () => spring({
      from: 0, to: 1,
      onStep: (t) => {
        const p = Math.min(Math.max(t, 0), 1.2);
        el.style.opacity = String(Math.min(p, 1));
        el.style.transform = 'translate3d(0,' + ((1 - p) * dist).toFixed(2) + 'px,0)';
      },
      onDone: () => { el.style.opacity = ''; el.style.transform = ''; el.classList.add('is-in'); }
    });
    if (reduced() || !delay) run(); else setTimeout(run, delay);
  };
  if (reduced() || !('IntersectionObserver' in window)) { els.forEach((el) => play(el, 0)); return; }
  els.forEach((el) => { el.style.opacity = '0'; });
  const io = new IntersectionObserver((entries) => {
    const batch = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    batch.forEach((e, i) => { io.unobserve(e.target); play(e.target, i * 70); });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  els.forEach((el) => io.observe(el));
}

// ---- progress bar + parallax (one rAF) ----
export function initScrollFx() {
  const bar = document.querySelector('[data-progress]');
  const layers = [...document.querySelectorAll('[data-depth]')];
  const hero = document.querySelector('[data-hero]');
  let px = 0, py = 0, tx = 0, ty = 0, sy = 0, ticking = false;

  const paint = () => {
    ticking = false;
    const doc = document.documentElement;
    const max = Math.max(1, doc.scrollHeight - window.innerHeight);
    if (bar) bar.style.transform = 'scaleX(' + Math.min(1, Math.max(0, window.scrollY / max)).toFixed(4) + ')';
    if (reduced()) return;
    sy = window.scrollY;
    px += (tx - px) * 0.12; py += (ty - py) * 0.12;
    for (const el of layers) {
      const d = parseFloat(el.getAttribute('data-depth'));
      el.style.transform = 'translate3d(' + (px * d * 26).toFixed(2) + 'px,' + (py * d * 18 - sy * d * 0.18).toFixed(2) + 'px,0)';
    }
    if (Math.abs(tx - px) > 0.002 || Math.abs(ty - py) > 0.002) request();
  };
  const request = () => { if (!ticking) { ticking = true; requestAnimationFrame(paint); } };
  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', request, { passive: true });
  if (hero && !reduced()) {
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width - 0.5;
      ty = (e.clientY - r.top) / r.height - 0.5;
      request();
    }, { passive: true });
    hero.addEventListener('pointerleave', () => { tx = 0; ty = 0; request(); });
  }
  request();
}

// ---- spotlight: pointer-tracked radial highlight on [data-spot] ----
export function initSpotlight() {
  if (reduced()) return;
  document.addEventListener('pointermove', (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-spot]') : null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--sx', (e.clientX - r.left).toFixed(1) + 'px');
    el.style.setProperty('--sy', (e.clientY - r.top).toFixed(1) + 'px');
  }, { passive: true });
}

// ---- count-up with flash ----
export function countTo(el, to, format) {
  const prev = el._val;
  el._val = to;
  if (el._stop) el._stop();
  if (to === null || to === undefined) { el.textContent = '—'; return; }
  if (prev === undefined || prev === null || reduced()) { el.textContent = format(to); return; }
  if (prev === to) { el.textContent = format(to); return; }
  const dir = to > prev ? 'up' : 'down';
  el.classList.remove('flash-up', 'flash-down');
  void el.offsetWidth;
  el.classList.add(dir === 'up' ? 'flash-up' : 'flash-down');
  el._stop = spring({
    from: 0, to: 1, k: 120, c: 20,
    onStep: (t) => { el.textContent = format(prev + (to - prev) * Math.min(Math.max(t, 0), 1)); },
    onDone: () => { el.textContent = format(to); }
  });
}

// first paint from zero for stat tiles
export function countFromZero(el, to, format) {
  if (to === null || to === undefined) { el.textContent = '—'; return; }
  if (reduced()) { el.textContent = format(to); el._val = to; return; }
  if (el._stop) el._stop();
  el._val = to;
  el._stop = spring({
    from: 0, to: 1, k: 90, c: 17,
    onStep: (t) => { el.textContent = format(to * Math.min(Math.max(t, 0), 1)); },
    onDone: () => { el.textContent = format(to); }
  });
}
