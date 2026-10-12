import { createFeed, fmtPrice, fmtUsd, fmtPct, fmtInt, shortAddr, totals } from './market-core.js';
import { initReveal, initScrollFx, initSpotlight, countTo, countFromZero, reduced } from './motion.js';

const REG = JSON.parse(document.getElementById('reg').textContent);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const NS = 'http://www.w3.org/2000/svg';

// ---------- copy ----------
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}
const live = $('[data-live-msg]');
function say(msg) { if (live) { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 20); } }

function flashLabel(btn, ok) {
  const out = btn.querySelector('[data-fb]');
  btn.classList.toggle('is-done', ok);
  btn.classList.toggle('is-fail', !ok);
  if (out) out.textContent = ok ? 'Copied' : 'Copy failed';
  say(ok ? 'Address copied' : 'Copy failed');
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { btn.classList.remove('is-done', 'is-fail'); if (out) out.textContent = ''; }, 1700);
}

// ---------- contract address slot: acts only when the record is stated ----------
(function ca() {
  const rec = REG.ca;
  if (!rec || rec.state !== 'stated' || !rec.value) return;
  $$('[data-ca]').forEach((btn) => btn.addEventListener('click', async () => flashLabel(btn, await copyText(rec.value))));
})();

// ---------- tabs ----------
let sortKey = 'volume';
const SORTS = {
  volume: (a, b) => b.volume - a.volume,
  gainers: (a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity),
  losers: (a, b) => (a.change ?? Infinity) - (b.change ?? Infinity),
  depth: (a, b) => (b.liquidity ?? -1) - (a.liquidity ?? -1)
};
(function tabs() {
  const list = $('[role=tablist]');
  if (!list) return;
  const tabEls = $$('[role=tab]', list);
  const select = (t, focus) => {
    tabEls.forEach((x) => { const on = x === t; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; });
    sortKey = t.dataset.sort;
    if (focus) t.focus();
    if (lastState) render(lastState);
    moveInk(t);
  };
  const ink = $('[data-tab-ink]', list);
  function moveInk(t) {
    if (!ink) return;
    ink.style.width = t.offsetWidth + 'px';
    ink.style.transform = 'translateX(' + t.offsetLeft + 'px)';
  }
  tabEls.forEach((t) => t.addEventListener('click', () => select(t)));
  list.addEventListener('keydown', (e) => {
    const i = tabEls.indexOf(document.activeElement);
    if (i < 0) return;
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % tabEls.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + tabEls.length) % tabEls.length;
    else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = tabEls.length - 1;
    if (n >= 0) { e.preventDefault(); select(tabEls[n], true); }
  });
  const cur = tabEls.find((x) => x.getAttribute('aria-selected') === 'true') || tabEls[0];
  requestAnimationFrame(() => moveInk(cur));
  window.addEventListener('resize', () => moveInk(tabEls.find((x) => x.getAttribute('aria-selected') === 'true')), { passive: true });
})();

// ---------- market DOM ----------
const grid = $('[data-grid]');
const tickerTrack = $('[data-ticker-track]');
const pill = $('[data-pill]');
const pillText = $('[data-pill-text]');
const errBox = $('[data-error]');
const cards = new Map();
let lastState = null;
let tickerKey = '';

function mk(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}
function iconCopy() {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('width', '16'); s.setAttribute('height', '16'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<path fill="currentColor" d="M5.5 1A1.5 1.5 0 0 0 4 2.5V3H3.5A1.5 1.5 0 0 0 2 4.5v9A1.5 1.5 0 0 0 3.5 15h7a1.5 1.5 0 0 0 1.5-1.5V13h.5a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 12.5 1h-7ZM5 2.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-9ZM3.5 4H4v7.5A1.5 1.5 0 0 0 5.5 13H11v.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5Z"/>';
  return s;
}

function logo(row) {
  const wrap = mk('span', 'logo');
  const tile = mk('span', 'tile', (row.symbol || row.name || '?').trim().charAt(0).toUpperCase() || '?');
  tile.setAttribute('aria-hidden', 'true');
  tile.dataset.tone = String(row.address.charCodeAt(0) % 3);
  wrap.appendChild(tile);
  if (row.imageUrl) {
    const img = new Image();
    img.alt = ''; img.decoding = 'async'; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    img.addEventListener('load', () => { img.classList.add('ok'); });
    img.addEventListener('error', () => img.remove());
    img.src = row.imageUrl;
    wrap.appendChild(img);
  }
  return wrap;
}

function stat(label, key) {
  const d = mk('div');
  d.appendChild(mk('dt', null, label));
  const dd = mk('dd', 'mono num'); dd.dataset.f = key; dd.textContent = '—';
  d.appendChild(dd);
  return d;
}

function buildCard(row) {
  const c = mk('article', 'card tok');
  c.dataset.spot = ''; c.dataset.addr = row.address;
  const head = mk('div', 'tok-head');
  head.appendChild(logo(row));
  const id = mk('div', 'tok-id');
  const top = mk('div', 'tok-top');
  top.appendChild(mk('span', 'tok-name', row.name || row.symbol));
  const chg = mk('span', 'chg mono num'); chg.dataset.f = 'change';
  top.appendChild(chg);
  id.appendChild(top);
  id.appendChild(mk('span', 'tok-sym mono', '$' + row.symbol));
  head.appendChild(id);
  c.appendChild(head);
  const dl = mk('dl', 'stats3');
  dl.appendChild(stat('Price', 'price')); dl.appendChild(stat('Volume', 'volume')); dl.appendChild(stat('Liquidity', 'liquidity'));
  c.appendChild(dl);
  const foot = mk('div', 'tok-foot');
  foot.appendChild(mk('span', 'addr mono', shortAddr(row.address)));
  const b = mk('button', 'copy'); b.type = 'button';
  b.setAttribute('aria-label', 'Copy address for ' + (row.symbol || row.name));
  b.appendChild(iconCopy());
  const fb = mk('span', 'copy-fb'); fb.dataset.fb = ''; fb.setAttribute('aria-hidden', 'true');
  b.appendChild(fb);
  b.addEventListener('click', async () => flashLabel(b, await copyText(row.address)));
  foot.appendChild(b);
  c.appendChild(foot);
  c.appendChild(mk('span', 'rank mono', ''));
  return c;
}

const fmtChange = (v) => fmtPct(v);
function paintChange(el, v) {
  el.classList.toggle('is-up', v !== null && v >= 0);
  el.classList.toggle('is-down', v !== null && v < 0);
  const arrow = v === null ? '' : v >= 0 ? '▲ ' : '▼ ';
  const had = el._val;
  countTo(el, v, (x) => arrow + fmtChange(x));
  if (had === undefined) el.textContent = arrow + fmtChange(v);
}

function fill(card, row, rank, first) {
  const q = (k) => card.querySelector('[data-f=' + k + ']');
  const cmp = (k, fmt, v) => {
    const el = q(k);
    if (first) { el._val = v; el.textContent = fmt(v); } else countTo(el, v, fmt);
  };
  cmp('price', fmtPrice, row.price);
  cmp('volume', fmtUsd, row.volume);
  cmp('liquidity', fmtUsd, row.liquidity);
  const ch = q('change');
  if (first) {
    ch._val = row.change;
    const arrow = row.change === null ? '' : row.change >= 0 ? '▲ ' : '▼ ';
    ch.textContent = arrow + fmtChange(row.change);
    ch.classList.toggle('is-up', row.change !== null && row.change >= 0);
    ch.classList.toggle('is-down', row.change !== null && row.change < 0);
  } else paintChange(ch, row.change);
  card.querySelector('.rank').textContent = String(rank).padStart(2, '0');
}

function renderGrid(state) {
  const rows = [...state.rows].sort(SORTS[sortKey]);
  const keep = new Set(rows.map((r) => r.address));
  const firstPaint = grid.getAttribute('data-skel') === 'on';
  if (firstPaint) {
    grid.setAttribute('data-skel', 'off');
    $$('.skel-card', grid).forEach((n) => n.remove());
  }
  for (const [addr, el] of cards) if (!keep.has(addr)) { el.remove(); cards.delete(addr); }
  rows.forEach((row, i) => {
    let el = cards.get(row.address);
    const isNew = !el;
    if (isNew) {
      el = buildCard(row); cards.set(row.address, el);
      el.classList.add('is-enter');
      el.style.setProperty('--i', String(i));
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-ready')));
    }
    fill(el, row, i + 1, isNew);
    grid.appendChild(el);
  });
}

function tickerItem(row) {
  const a = mk('span', 'tk');
  a.dataset.addr = row.address;
  a.appendChild(mk('span', 'tk-sym mono', '$' + row.symbol));
  a.appendChild(mk('span', 'tk-px mono num', ''));
  a.appendChild(mk('span', 'tk-ch mono num', ''));
  return a;
}
function renderTicker(state) {
  const rows = state.rows;
  const key = rows.map((r) => r.address).join();
  if (key !== tickerKey) {
    tickerKey = key;
    tickerTrack.textContent = '';
    for (let copy = 0; copy < 2; copy++) {
      const seg = mk('div', 'tk-seg');
      if (copy) seg.setAttribute('aria-hidden', 'true');
      rows.forEach((r) => seg.appendChild(tickerItem(r)));
      tickerTrack.appendChild(seg);
    }
    tickerTrack.style.setProperty('--tk-time', Math.max(24, rows.length * 5) + 's');
    tickerTrack.closest('[data-ticker]').setAttribute('data-skel', 'off');
  }
  rows.forEach((r) => {
    $$('[data-addr="' + r.address + '"]', tickerTrack).forEach((n) => {
      n.querySelector('.tk-px').textContent = fmtPrice(r.price);
      const c = n.querySelector('.tk-ch');
      c.textContent = (r.change === null ? '' : r.change >= 0 ? '▲ ' : '▼ ') + fmtChange(r.change);
      c.classList.toggle('is-up', r.change !== null && r.change >= 0);
      c.classList.toggle('is-down', r.change !== null && r.change < 0);
    });
  });
}

const tiles = { count: $('[data-t=count]'), volume: $('[data-t=volume]'), liquidity: $('[data-t=liquidity]') };
let tilesSeeded = false;
function renderTiles(state) {
  const t = totals(state.rows);
  const fns = { count: fmtInt, volume: fmtUsd, liquidity: fmtUsd };
  for (const k of Object.keys(tiles)) {
    if (!tiles[k]) continue;
    if (!tilesSeeded) countFromZero(tiles[k], t[k], fns[k]); else countTo(tiles[k], t[k], fns[k]);
    tiles[k].closest('.tile-stat')?.setAttribute('data-skel', 'off');
  }
  tilesSeeded = true;
}

function renderLead(state) {
  const el = $('[data-lead]');
  if (!el || !state.rows.length) return;
  const r = [...state.rows].sort(SORTS.volume)[0];
  $('[data-lead-sym]', el).textContent = '$' + r.symbol;
  $('[data-lead-px]', el).textContent = fmtPrice(r.price);
  const c = $('[data-lead-ch]', el);
  c.textContent = (r.change === null ? '' : r.change >= 0 ? '▲ ' : '▼ ') + fmtChange(r.change);
  c.classList.toggle('is-up', r.change !== null && r.change >= 0);
  c.classList.toggle('is-down', r.change !== null && r.change < 0);
  el.setAttribute('data-skel', 'off');
}

const PILL = {
  loading: ['Connecting', 'connecting'],
  live: ['Live feed', 'live'],
  retrying: ['Retrying', 'retry'],
  error: ['Feed down', 'down']
};
function renderStatus(state) {
  const [text, mode] = PILL[state.status] || PILL.loading;
  if (pillText) pillText.textContent = text;
  if (pill) pill.setAttribute('data-mode', mode);
  if (errBox) {
    const show = state.status === 'error';
    errBox.hidden = !show;
    if (show) grid.setAttribute('data-empty', 'on'); else grid.removeAttribute('data-empty');
  }
  if (state.status === 'error' && !state.hasData) {
    Object.values(tiles).forEach((t) => { if (t && t._val === undefined) t.textContent = '—'; });
    $$('.tile-stat').forEach((n) => n.setAttribute('data-skel', 'off'));
    $$('.skel-card', grid).forEach((n) => n.classList.add('is-halt'));
    $('[data-lead]')?.setAttribute('data-skel', 'off');
    const lv = $('[data-lead-px]'); if (lv) lv.textContent = '—';
  }
}

function render(state) {
  lastState = state;
  renderStatus(state);
  if (!state.hasData) return;
  renderGrid(state); renderTicker(state); renderTiles(state); renderLead(state);
}

// ---------- feed: follows the market record only ----------
(function market() {
  const rec = REG.market;
  if (!rec || rec.state !== 'stated' || !rec.url || !rec.pairs) {
    render({ rows: [], status: 'error', failures: 0, hasData: false });
    return;
  }
  const feed = createFeed(rec, {
    fetchJson: async (url) => {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 12000);
      try {
        const res = await fetch(url, { signal: ctl.signal, cache: 'no-store', headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error('http ' + res.status);
        return await res.json();
      } finally { clearTimeout(to); }
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t),
    isVisible: () => document.visibilityState === 'visible',
    onUpdate: render
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') feed.resume(); else feed.pause();
  });
  feed.start();
})();

// ---------- boot ----------
initReveal();
initScrollFx();
initSpotlight();
document.documentElement.classList.add('ready');
