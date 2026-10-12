// Pure market logic. No DOM, no globals: the gates import this file in node.

export const POLL_MS = 60000;
export const BACKOFF_BASE_MS = 2000;
export const BACKOFF_CAP_MS = 300000;
export const BATCH = 30;
export const TOP_N = 10;

export function backoffDelay(failures) {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1), BACKOFF_CAP_MS);
}

export function solanaAddresses(boosts) {
  if (!Array.isArray(boosts)) throw new Error('unexpected boosts payload');
  const seen = new Set();
  for (const b of boosts) {
    if (b && b.chainId === 'solana' && typeof b.tokenAddress === 'string' && b.tokenAddress) seen.add(b.tokenAddress);
  }
  return [...seen];
}

export function chunk(list, size = BATCH) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
};

// One row per base token: the pair with the heaviest 24h volume wins.
export function topByVolume(pairs, n = TOP_N) {
  const best = new Map();
  for (const p of pairs) {
    if (!p || p.chainId !== 'solana' || !p.baseToken || !p.baseToken.address) continue;
    const vol = num(p.volume && p.volume.h24);
    if (vol === null) continue;
    const row = {
      address: p.baseToken.address,
      name: p.baseToken.name || p.baseToken.symbol || '',
      symbol: p.baseToken.symbol || '',
      imageUrl: (p.info && typeof p.info.imageUrl === 'string' && /^https:\/\//.test(p.info.imageUrl)) ? p.info.imageUrl : '',
      price: num(p.priceUsd),
      change: num(p.priceChange && p.priceChange.h24),
      volume: vol,
      liquidity: num(p.liquidity && p.liquidity.usd)
    };
    const cur = best.get(row.address);
    if (!cur || row.volume > cur.volume) best.set(row.address, row);
  }
  return [...best.values()].sort((a, b) => b.volume - a.volume).slice(0, n);
}

export function totals(rows) {
  const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  return { count: rows.length, volume: sum('volume'), liquidity: sum('liquidity') };
}

// ---- formatting ----
const SUB = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
export function fmtPrice(p) {
  if (p === null || p === undefined) return '—';
  if (p >= 1) return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  if (p >= 0.01) return '$' + p.toFixed(4);
  if (p <= 0) return '$0';
  const s = p.toFixed(20);
  const m = /^0\.(0*)(\d+)/.exec(s);
  const z = m[1].length;
  const digits = m[2].slice(0, 4).replace(/0+$/, '') || '0';
  return z >= 3 ? '$0.0' + String(z).split('').map((d) => SUB[+d]).join('') + digits : '$0.' + m[1] + digits;
}
export function fmtUsd(v) {
  if (v === null || v === undefined) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v.toFixed(0);
}
export function fmtPct(v) {
  if (v === null || v === undefined) return '—';
  const s = Math.abs(v) >= 1000 ? Math.round(Math.abs(v)).toLocaleString('en-US') : Math.abs(v).toFixed(2);
  return (v >= 0 ? '+' : '−') + s + '%';
}
export function fmtInt(v) {
  return v === null || v === undefined ? '—' : Math.round(v).toLocaleString('en-US');
}
export function shortAddr(a) {
  return a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : a;
}

// ---- controller: polling, backoff, last-good retention ----
// env: { fetchJson(url, signal), setTimer, clearTimer, isVisible(), onUpdate(state) }
export function createFeed(rec, env) {
  const state = { rows: [], status: 'loading', failures: 0, hasData: false };
  let timer = null;
  let running = false;
  let inflight = false;
  let stopped = true;

  async function load() {
    const boosts = await env.fetchJson(rec.url);
    const addrs = solanaAddresses(boosts);
    if (!addrs.length) throw new Error('no solana entries');
    const pairs = [];
    for (const group of chunk(addrs)) {
      const res = await env.fetchJson(rec.pairs.replace('{addresses}', group.join(',')));
      if (Array.isArray(res)) pairs.push(...res);
    }
    const rows = topByVolume(pairs);
    if (!rows.length) throw new Error('no pairs');
    return rows;
  }

  function schedule(ms) {
    if (stopped || !env.isVisible()) return;
    env.clearTimer(timer);
    timer = env.setTimer(tick, ms);
  }

  async function tick() {
    if (inflight || stopped) return;
    inflight = true;
    try {
      const rows = await load();
      state.rows = rows; state.hasData = true; state.failures = 0; state.status = 'live';
      env.onUpdate(state);
      inflight = false;
      schedule(POLL_MS);
    } catch (e) {
      state.failures += 1;
      state.status = state.hasData ? 'retrying' : 'error'; // rows left untouched: last good data stays
      env.onUpdate(state);
      inflight = false;
      schedule(backoffDelay(state.failures));
    }
  }

  return {
    state,
    start() { stopped = false; running = true; if (env.isVisible()) tick(); },
    stop() { stopped = true; env.clearTimer(timer); timer = null; },
    pause() { env.clearTimer(timer); timer = null; },
    resume() { if (!stopped) tick(); },
    tick
  };
}
