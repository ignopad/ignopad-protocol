// Static build: src/ -> dist/ (dist/ is the only folder that gets deployed).
// Usage: node scripts/build.mjs [--register <file>] [--out <dir>] [--quiet]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

// Official marks. X: the current X logo. GitHub: Octicons mark-github (24).
const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
const ICON_GH = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 1C5.923 1 1 5.923 1 12c0 4.867 3.149 8.979 7.521 10.436.55.096.756-.233.756-.522 0-.262-.013-1.128-.013-2.049-2.764.509-3.479-.674-3.699-1.292-.124-.317-.66-1.293-1.127-1.554-.385-.207-.936-.715-.014-.729.866-.014 1.485.797 1.691 1.128.99 1.663 2.571 1.196 3.204.907.096-.715.385-1.196.701-1.471-2.448-.275-5.005-1.224-5.005-5.432 0-1.196.426-2.186 1.128-2.956-.111-.275-.496-1.402.11-2.915 0 0 .921-.288 3.024 1.128a10.193 10.193 0 0 1 2.75-.371c.936 0 1.871.123 2.75.371 2.104-1.43 3.025-1.128 3.025-1.128.605 1.513.221 2.64.111 2.915.701.77 1.127 1.747 1.127 2.956 0 4.222-2.571 5.157-5.019 5.432.399.344.743 1.004.743 2.035 0 1.471-.014 2.654-.014 3.025 0 .289.206.632.756.522C19.851 20.979 23 16.854 23 12c0-6.077-4.922-11-11-11Z"/></svg>';
const ICON_COPY = '<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M5.5 1A1.5 1.5 0 0 0 4 2.5V3H3.5A1.5 1.5 0 0 0 2 4.5v9A1.5 1.5 0 0 0 3.5 15h7a1.5 1.5 0 0 0 1.5-1.5V13h.5a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 12.5 1h-7ZM5 2.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-9ZM3.5 4H4v7.5A1.5 1.5 0 0 0 5.5 13H11v.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5Z"/></svg>';

const STATES = ['stated', 'absent', 'unconfirmed'];

export function validateRegister(reg) {
  const problems = [];
  for (const [id, r] of Object.entries(reg.records)) {
    if (!STATES.includes(r.state)) problems.push(`${id}: bad state ${r.state}`);
    if (r.state !== 'stated') {
      for (const k of ['value', 'url', 'pairs', 'rpc']) if (k in r) problems.push(`${id}: inert record carries ${k}`);
    } else if (!('value' in r) && !('url' in r)) problems.push(`${id}: stated record has neither value nor url`);
  }
  return problems;
}

// store URL, derive handle
export function handleOf(id, url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const seg = u.pathname.split('/').filter(Boolean)[0];
  if (!seg) return null;
  if (id === 'x' && !/^(www\.)?(x|twitter)\.com$/.test(u.hostname)) return null;
  if (id === 'github' && !/^(www\.)?github\.com$/.test(u.hostname)) return null;
  return id === 'x' ? '@' + seg : seg;
}

function publicRegister(reg) {
  const out = {};
  for (const [id, r] of Object.entries(reg.records)) {
    const p = { label: r.label, state: r.state };
    if (r.state === 'stated') {
      if (r.value !== undefined) p.value = r.value;
      if (r.url !== undefined) p.url = r.url;
      if (r.pairs !== undefined) p.pairs = r.pairs;
      if (id === 'x' || id === 'github') p.handle = handleOf(id, r.url);
    }
    out[id] = p;
  }
  return out;
}

const live = (r) => r && r.state === 'stated';

function renderCA(r) {
  const label = esc(r.label);
  if (live(r) && r.value) {
    return `<section class="ca" aria-label="${label}" data-ca-slot data-state="stated">
  <div class="wrap ca-in">
    <span class="ca-k">${label}</span>
    <button type="button" class="ca-btn" data-ca aria-label="Copy ${label.toLowerCase()}"><span class="ca-val">${esc(r.value)}</span>${ICON_COPY}<span class="ca-fb" data-fb aria-hidden="true"></span></button>
  </div>
</section>`;
  }
  return `<section class="ca" aria-label="${label}" data-ca-slot data-state="${esc(r.state)}">
  <div class="wrap ca-in">
    <span class="ca-k">${label}</span>
    <span class="ca-btn" data-ca-inert aria-disabled="true"><span class="ca-pend">Pending</span></span>
  </div>
</section>`;
}

function renderSocial(id, r, icon) {
  const name = id === 'x' ? 'X' : 'GitHub';
  const h = live(r) && r.url ? handleOf(id, r.url) : null;
  if (h) {
    return `      <a class="soc" data-social="${id}" data-state="stated" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="Ignopad on ${name}, ${esc(h)}">${icon}</a>`;
  }
  return `      <span class="soc is-inert" data-social="${id}" data-state="${esc(r.state)}" role="img" aria-disabled="true" aria-label="${name}, pending">${icon}</span>`;
}

function renderChannels(recs) {
  const li = [];
  for (const id of ['x', 'github']) {
    const r = recs[id]; const name = esc(r.label);
    const h = live(r) && r.url ? handleOf(id, r.url) : null;
    li.push(h
      ? `        <li><a class="chip" data-chip="${id}" data-state="stated" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer"><span class="k">${name}</span><span class="v">${esc(h)}</span></a></li>`
      : `        <li><div class="chip is-inert" data-chip="${id}" data-state="${esc(r.state)}" aria-disabled="true"><span class="k">${name}</span><span class="v">Pending</span></div></li>`);
  }
  const ca = recs.ca;
  li.push(live(ca) && ca.value
    ? `        <li><button type="button" class="chip" data-chip="ca" data-state="stated" data-ca aria-label="Copy ${esc(ca.label.toLowerCase())}"><span class="k">${esc(ca.label)}</span><span class="v"><span class="chip-fb" data-fb>Copy</span></span></button></li>`
    : `        <li><div class="chip is-inert" data-chip="ca" data-state="${esc(ca.state)}" aria-disabled="true"><span class="k">${esc(ca.label)}</span><span class="v">Pending</span></div></li>`);
  li.push(`        <li><div class="chip is-fact" data-chip="chain"><span class="k">${esc(recs.chain.label)}</span><span class="v">${esc(recs.chain.value)}</span></div></li>`);
  li.push(`        <li><div class="chip is-fact" data-chip="domain"><span class="k">${esc(recs.domain.label)}</span><span class="v">${esc(recs.domain.value)}</span></div></li>`);
  return li.join('\n');
}

function skelCards() {
  const one = `        <article class="card skel-card" aria-hidden="true"><div class="row"><i class="skel-bar sq"></i><div class="grow"><i class="skel-bar ln"></i><i class="skel-bar ln s"></i></div></div><div class="tri"><i class="skel-bar"></i><i class="skel-bar"></i><i class="skel-bar"></i></div></article>`;
  return Array.from({ length: 10 }, () => one).join('\n');
}
const tickerSkel = () => Array.from({ length: 8 }, () => '          <span class="tk-skel" aria-hidden="true"><i></i><i></i><i></i></span>').join('\n');

export function build({ registerPath = path.join(SRC, 'register.json'), outDir = path.join(ROOT, 'dist'), quiet = false } = {}) {
  const reg = readJson(registerPath);
  const problems = validateRegister(reg);
  if (problems.length) throw new Error('register invalid: ' + problems.join('; '));
  const tokens = readJson(path.join(SRC, 'tokens.json'));
  const recs = reg.records;

  fs.rmSync(outDir, { recursive: true, force: true });
  for (const d of ['css', 'js']) fs.mkdirSync(path.join(outDir, d), { recursive: true });

  const vars = Object.entries(tokens.colors).map(([k, v]) => `  --${k}: ${v.hex};`).join('\n');
  const mot = Object.entries(tokens.motion).filter(([k]) => !k.startsWith('_')).map(([k, v]) => `  --${k}: ${v};`).join('\n');
  fs.writeFileSync(path.join(outDir, 'css', 'tokens.css'), `:root {\n${vars}\n${mot}\n}\n`);
  fs.copyFileSync(path.join(SRC, 'css', 'site.css'), path.join(outDir, 'css', 'site.css'));
  for (const f of fs.readdirSync(path.join(SRC, 'js'))) fs.copyFileSync(path.join(SRC, 'js', f), path.join(outDir, 'js', f));

  const mark = readJson(path.join(SRC, 'assets', 'mark.json'));
  const fav = fs.readFileSync(path.join(SRC, 'assets', 'favicon.svg.tpl'), 'utf8')
    .replace('{{bg}}', tokens.colors['ink-deep'].hex).replace('{{fg}}', tokens.colors.mark.hex);
  fs.writeFileSync(path.join(outDir, 'favicon.svg'), fav);
  for (const f of ['apple-touch-icon.png', 'og.jpg']) fs.copyFileSync(path.join(SRC, 'assets', f), path.join(outDir, f));

  const pub = publicRegister(reg);
  const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8')
    .replace('{{THEME}}', tokens.colors.paper.hex)
    .replace('{{CA}}', renderCA(recs.ca))
    .replace('{{MARK_VB}}', mark.viewBox).replace('{{MARK_D}}', mark.d)
    .replace('{{SOCIAL}}', renderSocial('x', recs.x, ICON_X) + '\n' + renderSocial('github', recs.github, ICON_GH))
    .replace('{{CHAIN}}', esc(recs.chain.value))
    .replace('{{TICKER_SKEL}}', tickerSkel())
    .replace('{{SKEL_CARDS}}', skelCards())
    .replace('{{CHANNELS}}', renderChannels(recs))
    .replace('{{DOMAIN}}', esc(recs.domain.value))
    .replace('{{REG}}', JSON.stringify(pub).replace(/</g, '\\u003c'));
  fs.writeFileSync(path.join(outDir, 'index.html'), html);

  fs.writeFileSync(path.join(outDir, '_headers'), [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    "  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self' https://api.dexscreener.com; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
    '/js/*',
    '  Cache-Control: public, max-age=300',
    '/css/*',
    '  Cache-Control: public, max-age=300',
    ''
  ].join('\n'));

  if (!quiet) {
    const n = (d) => fs.readdirSync(d, { recursive: true }).filter((f) => fs.statSync(path.join(d, f)).isFile()).length;
    console.log(`build ok -> ${path.relative(ROOT, outDir) || '.'} (${n(outDir)} files)`);
  }
  return { outDir, pub };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const arg = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  try {
    build({ registerPath: arg('--register') && path.resolve(arg('--register')), outDir: arg('--out') && path.resolve(arg('--out')), quiet: a.includes('--quiet') });
  } catch (e) { console.error('build failed:', e.message); process.exit(1); }
}
