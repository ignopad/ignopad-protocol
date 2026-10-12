// npm run gates: builds, then runs every gate. Exit 0 only if all pass.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { build, ROOT, validateRegister, handleOf } from './build.mjs';

const P = (...a) => path.join(ROOT, ...a);
const read = (f) => fs.readFileSync(f, 'utf8');
const readJson = (f) => JSON.parse(read(f));
const DIST = P('dist');
const REG_PATH = P('src', 'register.json');

const gates = [];
const gate = (id, name, fn) => gates.push({ id, name, fn });

// ---------- helpers ----------
function walk(dir, skip = []) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.includes(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(f, skip)); else out.push(f);
  }
  return out;
}
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

function visibleText(html) {
  let h = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, ' ');
  const attrs = [...html.matchAll(/\b(?:aria-label|title|alt|placeholder)="([^"]*)"/g)].map((m) => m[1])
    .concat([...html.matchAll(/<meta\s+(?:name|property)="(?:description|og:[a-z:]+|twitter:[a-z:]+)"\s+content="([^"]*)"/g)].map((m) => m[1]));
  h = h.replace(/<[^>]+>/g, ' ');
  return (h + ' ' + attrs.join(' ')).replace(/&mdash;/g, '-').replace(/&middot;/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
}
const BASE58 = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
const HEX40 = /0x[0-9a-fA-F]{40}/g;
function addressShaped(text) {
  const hex = text.match(HEX40) || [];
  const rest = text.replace(HEX40, ' ');
  return [...hex, ...(rest.match(BASE58) || [])];
}
// rule 3: match address-shaped strings against the stated registry. never blanket-reject 0x hex.
function scanAddresses(text, reg) {
  const allowed = new Set(Object.values(reg.records).filter((r) => r.state === 'stated' && typeof r.value === 'string').map((r) => r.value));
  return addressShaped(text).filter((s) => !allowed.has(s));
}
const stripCaSlot = (html) => html.replace(/<section class="ca"[\s\S]*?<\/section>/, '');

function seededBase58(seed, len = 44) {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let s = seed >>> 0; let out = '';
  for (let i = 0; i < len; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; out += A[(s >>> 8) % A.length]; }
  return out;
}

let built = null;
const html = () => read(path.join(DIST, 'index.html'));

// ---------- 1. structure ----------
gate('build-output', 'dist/ exists with index.html, css, js, favicon', () => {
  const need = ['index.html', 'css/site.css', 'css/tokens.css', 'js/main.js', 'js/motion.js', 'js/market-core.js', 'favicon.svg', 'apple-touch-icon.png', 'og.jpg'];
  const miss = need.filter((f) => !fs.existsSync(path.join(DIST, f)));
  return miss.length ? 'missing ' + miss.join(', ') : true;
});
gate('dist-clean', 'dist/ holds no repo docs (README, LICENSE, whitepaper, docs, md)', () => {
  const bad = walk(DIST).map(rel).filter((f) => /(^|\/)(README|LICENSE|whitepaper|docs)\b|\.md$/i.test(f));
  return bad.length ? 'found ' + bad.join(', ') : true;
});
gate('repo-files', 'README, whitepaper, LICENSE exist with required content', () => {
  const must = ['README.md', 'docs/whitepaper.md', 'LICENSE'];
  const miss = must.filter((f) => !fs.existsSync(P(f)));
  if (miss.length) return 'missing ' + miss.join(', ');
  const r = read(P('README.md')), w = read(P('docs/whitepaper.md')), l = read(P('LICENSE'));
  const errs = [];
  if (!/^# Ignopad/m.test(r)) errs.push('readme title');
  for (const h of ['Overview', 'Features', 'Links']) if (!new RegExp('^## ' + h, 'm').test(r)) errs.push('readme ' + h);
  if (!/shields\.io[^)]*ignopad\.fun/.test(r)) errs.push('live badge');
  if (!/Solana/.test(r)) errs.push('readme chain');
  if (!/Contract address/i.test(r)) errs.push('readme CA placeholder');
  for (const h of ['Vision and mission', 'Tokenomics', 'Roadmap', 'Team']) if (!new RegExp('^## ' + h, 'm').test(w)) errs.push('whitepaper ' + h);
  if ((w.match(/^\*\*Phase \d/gm) || []).length < 3) errs.push('whitepaper phases');
  if (!/^MIT License/.test(l) || !/Copyright \(c\) 2026 Ignopad/.test(l)) errs.push('license');
  return errs.length ? errs.join(', ') : true;
});
gate('repo-hygiene', 'no CLAUDE.md, no .claude/, no AI attribution in any repo file', () => {
  for (const f of ['CLAUDE.md', '.claude', 'AGENTS.md', '.cursorrules']) if (fs.existsSync(P(f))) return f + ' present';
  const w = ['cla' + 'ude', 'anth' + 'ropic', 'chat' + 'gpt', 'open' + 'ai', 'copi' + 'lot', 'gener' + 'ated by', 'gener' + 'ated with', 'co-auth' + 'ored', 'a' + 'i-gener', 'l' + 'lm'];
  const re = new RegExp('\\b(' + w.join('|') + ')\\b|\\bA' + 'I\\b', 'i');
  const reCase = new RegExp('\\bA' + 'I\\b');
  const hits = [];
  const self = path.resolve(P('scripts', 'gates.mjs'));
  for (const f of walk(ROOT, ['node_modules', '.git', 'brand', 'reference'])) {
    if (path.resolve(f) === self || /\.(png|jpe?g|ico)$/i.test(f) || f.endsWith('ref-corpus.txt')) continue;
    const t = read(f);
    if (re.test(t) || reCase.test(t)) hits.push(rel(f));
  }
  return hits.length ? 'attribution words in ' + hits.join(', ') : true;
});

// ---------- 2. register rules ----------
gate('register-shape', 'rule 1: every record has a valid state; inert records carry no value or url', () => {
  const reg = readJson(REG_PATH);
  const p = validateRegister(reg);
  const need = ['ca', 'x', 'github', 'chain', 'domain', 'market'];
  const miss = need.filter((k) => !reg.records[k]);
  if (miss.length) return 'missing records ' + miss.join(', ');
  const probe = structuredClone(reg); probe.records.ca = { label: 'Contract address', state: 'absent', value: 'x' };
  if (!validateRegister(probe).length) return 'validator accepts an inert record with a value';
  const probe2 = structuredClone(reg); probe2.records.x = { label: 'X', state: 'unconfirmed', url: 'https://x.com/a' };
  if (!validateRegister(probe2).length) return 'validator accepts an unconfirmed record with a url';
  return p.length ? p.join('; ') : true;
});
gate('register-client-statements', 'chain and market records match the client statement', () => {
  const r = readJson(REG_PATH).records;
  const errs = [];
  if (r.chain.value !== 'Solana' || r.chain.rpc !== 'https://solana-rpc.publicnode.com' || r.chain.source !== 'client statement' || r.chain.scope !== 'batch-level') errs.push('chain');
  if (r.market.url !== 'https://api.dexscreener.com/token-boosts/top/v1' || r.market.pairs !== 'https://api.dexscreener.com/tokens/v1/solana/{addresses}') errs.push('market');
  if (r.domain.value !== 'ignopad.fun') errs.push('domain');
  return errs.length ? 'mismatch: ' + errs.join(', ') : true;
});
gate('link-rule', 'rule 2: only stated records get an href; handle derived from url', () => {
  const reg = readJson(REG_PATH);
  const h = html();
  const errs = [];
  for (const id of ['x', 'github']) {
    const r = reg.records[id];
    const m = new RegExp('<(a|span)[^>]*data-social="' + id + '"[^>]*>').exec(h);
    if (!m) { errs.push(id + ' icon missing'); continue; }
    const hasHref = /\shref=/.test(m[0]);
    if (r.state === 'stated' && !hasHref) errs.push(id + ' stated but no href');
    if (r.state !== 'stated' && hasHref) errs.push(id + ' inert but has href');
    const chip = new RegExp('<(a|div)[^>]*data-chip="' + id + '"[^>]*>').exec(h);
    if (!chip) errs.push(id + ' chip missing'); else if (r.state !== 'stated' && /\shref=/.test(chip[0])) errs.push(id + ' chip href');
  }
  if (handleOf('x', 'https://x.com/ignopad_fixture') !== '@ignopad_fixture') errs.push('x handle derivation');
  if (handleOf('github', 'https://github.com/ignopad-fixture/ignopad') !== 'ignopad-fixture') errs.push('github handle derivation');
  if (handleOf('x', 'https://evil.example/x') !== null) errs.push('x host check');
  if (/href="https?:\/\/(x|twitter|github)\.com/.test(h) && (reg.records.x.state !== 'stated' || reg.records.github.state !== 'stated')) {
    const bad = [...h.matchAll(/href="(https?:\/\/(?:x|twitter|github)\.com[^"]*)"/g)].map((m) => m[1]);
    for (const u of bad) { const owner = reg.records.x.url === u || reg.records.github.url === u; if (!owner) errs.push('unregistered link ' + u); }
  }
  return errs.length ? errs.join('; ') : true;
});
gate('gate-warning', 'rule 3: address-shaped strings match the stated registry (0x hex not blanket-rejected)', () => {
  const reg = readJson(REG_PATH);
  const errs = [];
  const stray = [];
  for (const f of walk(DIST).filter((x) => /\.(html|js|css|svg|txt)$/.test(x))) {
    const t = f.endsWith('index.html') ? stripCaSlot(read(f)) : read(f);
    stray.push(...scanAddresses(t, reg).map((s) => rel(f) + ':' + s));
  }
  if (stray.length) errs.push('unregistered address-shaped strings: ' + stray.join(', '));
  // self-test the scanner both ways
  const evm = '0x' + 'ab12'.repeat(10);
  const sol = seededBase58(7);
  const regStated = { records: { evm: { state: 'stated', value: evm }, ca: { state: 'stated', value: sol } } };
  const regNone = { records: { evm: { state: 'absent' }, ca: { state: 'absent' } } };
  if (scanAddresses('x ' + evm + ' y', regStated).length) errs.push('scanner rejects a registered 0x address');
  if (scanAddresses('x ' + evm + ' y', regNone).length !== 1) errs.push('scanner misses an unregistered 0x address');
  if (scanAddresses('x ' + sol + ' y', regStated).length) errs.push('scanner rejects a registered base58 address');
  if (scanAddresses('x ' + sol + ' y', regNone).length !== 1) errs.push('scanner misses an unregistered base58 address');
  if (scanAddresses('plain words and 0x1 and 0xff', regNone).length) errs.push('scanner flags short hex');
  return errs.length ? errs.join('; ') : true;
});
gate('ca-slot', 'CA slot: first thing in body, large, full address when stated, inert + label/pending when not', () => {
  const reg = readJson(REG_PATH).records.ca;
  const h = html();
  const css = read(path.join(DIST, 'css/site.css'));
  const errs = [];
  const m = /<section class="ca"[\s\S]*?<\/section>/.exec(h);
  if (!m) return 'CA slot missing';
  const bodyStart = h.indexOf('<header');
  if (bodyStart < 0 || h.indexOf(m[0]) < bodyStart || h.indexOf(m[0]) > h.indexOf('class="bar')) errs.push('CA slot is not at the top of the header');
  if (!/\.ca-btn\s*\{[^}]*font-size:\s*clamp\(15px,[^}]*28px\)/.test(css)) errs.push('CA font is not large');
  if (!/overflow-wrap:\s*anywhere/.test(css)) errs.push('CA cannot wrap');
  if (reg.state === 'stated') {
    if (!m[0].includes('>' + reg.value + '<')) errs.push('full address missing');
    if (!/<button[^>]*data-ca/.test(m[0])) errs.push('no copy button');
    if (!/data-fb/.test(m[0])) errs.push('no copy feedback');
    if (/Pending/.test(m[0])) errs.push('pending text on stated slot');
    const js = read(path.join(DIST, 'js/main.js'));
    if (!/navigator\.clipboard\.writeText/.test(js) || !/flashLabel/.test(js)) errs.push('copy handler missing');
  } else {
    if (!/aria-disabled="true"/.test(m[0])) errs.push('slot not inert');
    if (!/Pending/.test(m[0]) || !m[0].includes(reg.label)) errs.push('inert slot lacks label + pending');
    if (/<button/.test(m[0])) errs.push('inert slot has a button');
    if (addressShaped(m[0]).length) errs.push('inert slot carries an address');
  }
  return errs.length ? errs.join('; ') : true;
});
gate('social', 'X and GitHub icons: top-right, icon only, present at every breakpoint, official marks', () => {
  const h = html(); const css = read(path.join(DIST, 'css/site.css')); const src = read(P('scripts/build.mjs'));
  const errs = [];
  const bar = /<div class="bar wrap">[\s\S]*?<\/header>/.exec(h);
  if (!bar) return 'header bar not found';
  const inGroup = /<div class="social"[\s\S]*?<\/div>/.exec(bar[0]);
  if (!inGroup || !/data-social="x"/.test(inGroup[0]) || !/data-social="github"/.test(inGroup[0])) errs.push('icons missing from header group');
  for (const id of ['x', 'github']) {
    const m = new RegExp('<(?:a|span)[^>]*data-social="' + id + '"[^>]*>([\\s\\S]*?)</(?:a|span)>').exec(h);
    if (!m) { errs.push(id + ' missing'); continue; }
    if (/>[^<\s][^<]*</.test(m[1].replace(/<svg[\s\S]*?<\/svg>/, ''))) errs.push(id + ' has a text label');
    if (!/<svg/.test(m[1])) errs.push(id + ' no svg');
  }
  if (!/\.social\s*\{[^}]*margin-left:\s*auto/.test(css)) errs.push('social not pushed right');
  if (/\.(soc|social)[^{]*\{[^}]*display:\s*none/.test(css)) errs.push('social hidden at a breakpoint');
  if (/@media[^{]*\{[^@]*\.soc[^{]*\{[^}]*display:\s*none/.test(css)) errs.push('social hidden in media query');
  if (!src.includes('M18.244 2.25h3.308l-7.227 8.26') || !src.includes('M12 1C5.923 1 1 5.923 1 12c0 4.867')) errs.push('official X or Octicon path missing');
  return errs.length ? errs.join('; ') : true;
});

// ---------- 3. palette / assets ----------
let verify = null;
function runVerify() {
  if (verify) return verify;
  const r = spawnSync('python', ['-I', P('scripts/verify_assets.py')], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('verify_assets failed: ' + (r.stderr || r.stdout));
  verify = JSON.parse(r.stdout);
  return verify;
}
gate('palette-pixels', 'rule 4: every token equals the real pixel at its recorded coordinate', () => {
  const v = runVerify();
  const bad = v.palette.filter((p) => !p.ok);
  return bad.length ? 'mismatch ' + bad.map((b) => `${b.name} ${b.hex} vs ${b.pixel}`).join(', ') : true;
});
gate('palette-literals', 'rule 4: colour literals live only in src/tokens.json (dist: tokens.css, favicon, theme-color)', () => {
  const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
  const fnRe = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/;
  const errs = [];
  for (const f of walk(P('src')).concat([P('scripts/build.mjs'), P('scripts/serve.mjs')])) {
    if (f.endsWith('tokens.json') || /\.(png|jpg)$/.test(f)) continue;
    const t = read(f);
    const hits = (t.match(hexRe) || []).filter((x) => !/^#(top|tape|method|channels)$/.test(x));
    if (hits.length) errs.push(rel(f) + ' ' + hits.slice(0, 3).join(','));
    if (fnRe.test(t)) errs.push(rel(f) + ' colour function');
    if (/\.(css)$/.test(f) && /:\s*(white|black|red|green|blue|gray|grey)\b/.test(t)) errs.push(rel(f) + ' named colour');
  }
  for (const f of walk(DIST)) {
    if (/\.(png|jpg)$/.test(f) || /tokens\.css$|favicon\.svg$/.test(f)) continue;
    let t = read(f);
    if (f.endsWith('index.html')) t = t.replace(/<meta name="theme-color" content="#[0-9a-f]+">/, '');
    const hits = t.match(hexRe) || [];
    if (hits.filter((x) => !/^#(top|tape|method|channels)$/.test(x)).length) errs.push('dist/' + path.relative(DIST, f) + ' literal');
  }
  const tk = readJson(P('src/tokens.json'));
  for (const [k, v] of Object.entries(tk.colors)) if (!v.file || v.x === undefined || v.y === undefined || !v.method) errs.push('no provenance for ' + k);
  return errs.length ? errs.join('; ') : true;
});
gate('favicon', 'favicon: SVG 32x32, no comments, no double hyphen, traced from the real pixel grid', () => {
  const s = read(path.join(DIST, 'favicon.svg'));
  const errs = [];
  if (!/^<svg[^>]*viewBox="0 0 32 32"/.test(s)) errs.push('viewBox');
  if (!/width="32"/.test(s) || !/height="32"/.test(s)) errs.push('size');
  if (/<!--/.test(s) || /<\?xml/.test(s) && /<!--/.test(s)) errs.push('comment');
  if (s.includes('--')) errs.push('double hyphen present');
  if (!/<\/svg>\s*$/.test(s)) errs.push('unterminated');
  const nums = (/ d="([^"]+)"/.exec(s) || [, ''])[1].match(/-?\d+\.?\d*/g) || [];
  if (!nums.length || nums.some((n) => +n < -0.5 || +n > 32.5)) errs.push('coords out of box');
  const v = runVerify().favicon;
  if (v.iou < 0.97) errs.push('trace IoU ' + v.iou.toFixed(3));
  if (v.subpaths !== 2) errs.push('expected two chevrons');
  if (!/rel="icon"[^>]*favicon\.svg|href="\/favicon\.svg"/.test(html())) errs.push('not linked');
  return errs.length ? errs.join('; ') : true;
});
gate('png-premultiplied', 'transparent logo has pure-black texels, so rasters are made with premultiplied resize', () => {
  const s = read(P('scripts/assets.py'));
  if (!/premul_resize/.test(s) || !/np\.unique\(a\[a\[\.\.\., 3\] == 0\]/.test(s)) return 'premultiplied path missing';
  const png = fs.readFileSync(P('brand', 'LOGO IGNOPAD PNG...png'));
  if (png[25] !== 6) return 'IHDR colour type is ' + png[25] + ', expected 6 (RGBA)';
  return true;
});

// ---------- 4. text rules ----------
gate('no-dates', 'zero dates, timestamps, clock strings or date wording on the page (text, attrs, aria, tooltips)', () => {
  const h = html();
  const text = visibleText(h);
  const reg = readJson(REG_PATH);
  const errs = [];
  const pats = [
    [/\b(19|20)\d{2}\b/, 'year'], [/\b\d{4}-\d{2}-\d{2}\b/, 'iso date'], [/\b\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}\b/, 'numeric date'],
    [/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i, 'month day'],
    [/\b\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?\b/i, 'clock'], [/\bas of\b/i, 'as of'], [/\bchecked\b/i, 'checked'],
    [/\b(updated|last seen|timestamp|ago)\b/i, 'recency word'], [/\b(today|yesterday|tomorrow)\b/i, 'relative day']
  ];
  for (const [re, n] of pats) if (re.test(text)) errs.push('html: ' + n);
  if (/"checked"/.test(h)) errs.push('register dates leaked into json');
  for (const r of Object.values(reg.records)) if (r.checked && h.includes(r.checked)) errs.push('register date string in page');
  for (const f of walk(DIST).filter((x) => /\.(js|css)$/.test(x))) {
    const t = read(f);
    if (/toLocale(Date|Time)String|DateTimeFormat|getHours|getMinutes|toISOString|toUTCString|new Date\b/.test(t)) errs.push(rel(f) + ': date api');
    if (/['"`][^'"`\n]*\b\d{4}-\d{2}-\d{2}\b[^'"`\n]*['"`]/.test(t)) errs.push(rel(f) + ': date literal');
  }
  return errs.length ? errs.join('; ') : true;
});
gate('copy-originality', 'zero shared 2-grams between page copy and the reference corpus', () => {
  const norm = (s) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
  const grams = (w, n) => { const o = new Set(); for (let i = 0; i + n <= w.length; i++) o.add(w.slice(i, i + n).join(' ')); return o; };
  const ref = norm(read(P('scripts/ref-corpus.txt')));
  const refG = grams(ref, 2);
  const ours = visibleText(html());
  const lines = ours.split(/\s{2,}/);
  const shared = new Set();
  for (const g of grams(norm(ours), 2)) if (refG.has(g)) shared.add(g);
  return shared.size ? 'shared 2-grams: ' + [...shared].join(' | ') : true;
});
gate('no-ch-units', 'no ch units anywhere in css, html or js', () => {
  const re = /(?<![\w-])\d*\.?\d+ch\b/;
  const bad = walk(DIST).filter((f) => /\.(css|html|js)$/.test(f) && re.test(read(f)));
  return bad.length ? 'ch unit in ' + bad.map(rel).join(', ') : true;
});

// ---------- 5. motion / visual ----------
gate('motion-features', 'spring solver, reveal stagger, parallax, mesh, spotlight, progress, pill, skeleton, count-up, marquee', () => {
  const css = read(path.join(DIST, 'css/site.css')); const mo = read(path.join(DIST, 'js/motion.js')); const h = html(); const main = read(path.join(DIST, 'js/main.js'));
  const checks = {
    'damped spring': /-k \* \(x - to\) - c \* v/.test(mo) && /export function spring/.test(mo),
    'reveal stagger': /IntersectionObserver/.test(mo) && /i \* 70/.test(mo) && (h.match(/data-reveal/g) || []).length >= 8,
    'parallax pointer+scroll': (h.match(/data-depth=/g) || []).length >= 4 && /pointermove/.test(mo) && /scrollY/.test(mo),
    'gradient mesh': /\.mesh/.test(css) && /@keyframes drift/.test(css) && /radial-gradient/.test(css),
    'spotlight': /\[data-spot\]::before/.test(css) && /--sx/.test(mo),
    'scroll progress': /data-progress/.test(h) && /\.progress\s*\{[^}]*position:\s*fixed/.test(css) && /scaleX/.test(mo),
    'live pill': /class="pill"/.test(h) && /@keyframes pulse-dot/.test(css) && /\.dot\s*\{[^}]*pulse-dot/.test(css),
    'skeleton to data fade': (h.match(/skel-card/g) || []).length >= 10 && /@keyframes shimmer/.test(css) && /is-ready/.test(css) && /--i/.test(css) && /is-enter/.test(main),
    'count-up + flash': /countTo/.test(mo) && /@keyframes flash-up/.test(css) && /@keyframes flash-down/.test(css),
    'marquee': /@keyframes marquee/.test(css) && /\.tk-track/.test(css) && /animation-play-state:\s*paused/.test(css),
    'reference easing measured': /--ease-standard:\s*cubic-bezier\(\.4, 0, \.2, 1\)/.test(read(path.join(DIST, 'css/tokens.css'))) && /--ease-pulse:\s*cubic-bezier\(\.4, 0, \.6, 1\)/.test(read(path.join(DIST, 'css/tokens.css'))),
    'no animated logo or coin': !/coin/i.test(h) && !/\.(brand|brand-mark)[^{]*\{[^}]*animation/.test(css)
  };
  const bad = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  return bad.length ? 'missing: ' + bad.join(', ') : true;
});
gate('reduced-motion', 'prefers-reduced-motion: CSS kills animation/transition, JS skips springs, ticker and parallax stop', () => {
  const css = read(path.join(DIST, 'css/site.css')); const mo = read(path.join(DIST, 'js/motion.js'));
  const blk = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}\s*$/.exec(css);
  const errs = [];
  if (!blk) return 'no reduced-motion block';
  if (!/animation:\s*none\s*!important/.test(blk[1]) || !/transition:\s*none\s*!important/.test(blk[1])) errs.push('animation/transition not zeroed');
  if (!/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(mo)) errs.push('js does not read the preference');
  const sp = /export function spring[\s\S]*?\n}\n/.exec(mo);
  if (!sp || !/if \(reduced\(\)\) \{ onStep\(to\)/.test(sp[0])) errs.push('spring not instant');
  if (!/\.layer\s*\{\s*transform:\s*none/.test(blk[1])) errs.push('parallax layers not frozen');
  if (!/tk-seg\[aria-hidden="true"\]\s*\{\s*display:\s*none/.test(blk[1])) errs.push('ticker duplicate not removed');
  return errs.length ? errs.join('; ') : true;
});
gate('tap-targets', 'every interactive control is at least 44x44 by rule (measured live in phase 5)', () => {
  const css = read(path.join(DIST, 'css/site.css'));
  if (!/--tap:\s*44px/.test(css)) return '--tap missing';
  const sels = ['.ca-btn', '.brand', '.nav a', '.nav-m a', '.soc', '.btn', '.tk', '.tabs [role="tab"]', '.copy', '.chip'];
  const bad = sels.filter((s) => {
    const esc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(esc + '\\s*\\{[^}]*(min-height|height):\\s*var\\(--tap\\)');
    return !re.test(css);
  });
  return bad.length ? 'no 44px rule on ' + bad.join(', ') : true;
});

// ---------- 6. market ----------
gate('market-logic', 'market core: solana-only, top 10 by 24h volume, best pair per token, letter fallback data', async () => {
  const core = await import(pathToFileURL(P('src/js/market-core.js')).href);
  const errs = [];
  const boosts = [];
  for (let i = 0; i < 14; i++) boosts.push({ chainId: 'solana', tokenAddress: 'T' + i });
  boosts.push({ chainId: 'ethereum', tokenAddress: 'E1' }, { chainId: 'solana', tokenAddress: 'T0' }, { chainId: 'bsc', tokenAddress: 'B1' });
  const addrs = core.solanaAddresses(boosts);
  if (addrs.length !== 14 || addrs.some((a) => !a.startsWith('T'))) errs.push('chain filter or dedupe');
  const pairs = [];
  addrs.forEach((a, i) => pairs.push({ chainId: 'solana', baseToken: { address: a, name: 'N' + i, symbol: 'S' + i }, priceUsd: '0.5', priceChange: { h24: i - 5 }, volume: { h24: 1000 + i * 10 }, liquidity: { usd: 500 + i }, info: i % 2 ? { imageUrl: 'https://cdn.example/a.png' } : undefined }));
  pairs.push({ chainId: 'solana', baseToken: { address: 'T3', name: 'N3', symbol: 'S3' }, priceUsd: '0.7', volume: { h24: 99999 }, liquidity: { usd: 1 } });
  pairs.push({ chainId: 'ethereum', baseToken: { address: 'X', symbol: 'X' }, volume: { h24: 1e12 } });
  const rows = core.topByVolume(pairs);
  if (rows.length !== 10) errs.push('not ten rows: ' + rows.length);
  if (rows[0].address !== 'T3' || rows[0].volume !== 99999) errs.push('best pair per token not chosen');
  for (let i = 1; i < rows.length; i++) if (rows[i - 1].volume < rows[i].volume) errs.push('not sorted by volume');
  if (rows.some((r) => r.address === 'X')) errs.push('non-solana pair leaked');
  if (!rows.some((r) => r.imageUrl === '') || !rows.some((r) => r.imageUrl)) errs.push('imageUrl handling');
  if (core.fmtPrice(null) !== '—' || core.fmtUsd(undefined) !== '—' || core.fmtPct(null) !== '—') errs.push('dash fallback');
  if (core.chunk(Array.from({ length: 65 }, (_, i) => i)).map((c) => c.length).join() !== '30,30,5') errs.push('batching');
  if (core.TOP_N !== 10 || core.POLL_MS !== 60000) errs.push('constants');
  return errs.length ? errs.join('; ') : true;
});
gate('market-feed', 'feed controller: 60s poll, exponential backoff, last good data kept, pause while hidden, immediate on visible', async () => {
  const core = await import(pathToFileURL(P('src/js/market-core.js')).href);
  const reg = readJson(REG_PATH).records.market;
  const errs = [];
  const delays = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(core.backoffDelay);
  if (delays.slice(0, 4).join() !== '2000,4000,8000,16000') errs.push('backoff is not exponential: ' + delays.slice(0, 4));
  if (Math.max(...delays) > core.BACKOFF_CAP_MS) errs.push('backoff uncapped');
  let visible = true, ok = true; const timers = []; const calls = []; let updates = 0;
  const env = {
    fetchJson: async (url) => {
      calls.push(url);
      if (!ok) throw new Error('down');
      if (url === reg.url) return [{ chainId: 'solana', tokenAddress: 'A1' }, { chainId: 'solana', tokenAddress: 'A2' }];
      return [{ chainId: 'solana', baseToken: { address: 'A1', symbol: 'A', name: 'A' }, priceUsd: '1', volume: { h24: 5 }, liquidity: { usd: 2 }, priceChange: { h24: 1 } }, { chainId: 'solana', baseToken: { address: 'A2', symbol: 'B', name: 'B' }, priceUsd: '2', volume: { h24: 9 }, liquidity: { usd: 3 }, priceChange: { h24: -1 } }];
    },
    setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.live = false; },
    isVisible: () => visible,
    onUpdate: () => { updates++; }
  };
  const feed = core.createFeed(reg, env);
  const live = () => timers.filter((t) => t.live);
  feed.start(); await new Promise((r) => setTimeout(r, 20));
  if (feed.state.rows.length !== 2 || feed.state.rows[0].address !== 'A2') errs.push('first load');
  if (!calls[1] || !calls[1].startsWith('https://api.dexscreener.com/tokens/v1/solana/A1,A2')) errs.push('pairs url');
  if (live().length !== 1 || live()[0].ms !== 60000) errs.push('poll is not 60s');
  const good = feed.state.rows;
  ok = false;
  await live()[0].fn(); await new Promise((r) => setTimeout(r, 5));
  if (feed.state.rows !== good || feed.state.status !== 'retrying') errs.push('last good data not kept');
  if (live()[0].ms !== 2000) errs.push('first retry not 2s');
  await live()[0].fn(); await new Promise((r) => setTimeout(r, 5));
  if (live()[0].ms !== 4000) errs.push('second retry not 4s');
  visible = false; feed.pause();
  if (live().length) errs.push('timer survives hidden tab');
  const before = calls.length; ok = true; visible = true; feed.resume(); await new Promise((r) => setTimeout(r, 20));
  if (calls.length === before) errs.push('no immediate fetch on visible');
  if (feed.state.status !== 'live' || live()[0].ms !== 60000 || feed.state.failures !== 0) errs.push('recovery');
  const cold = core.createFeed(reg, { ...env, fetchJson: async () => { throw new Error('x'); }, setTimer: (fn, ms) => ({ fn, ms, live: true }) });
  cold.start(); await new Promise((r) => setTimeout(r, 10));
  if (cold.state.status !== 'error' || cold.state.rows.length) errs.push('cold failure should show error with no rows');
  // hidden at start: no fetch
  const calls2 = []; visible = false;
  const hid = core.createFeed(reg, { ...env, fetchJson: async (u) => { calls2.push(u); return []; } });
  hid.start(); await new Promise((r) => setTimeout(r, 10));
  if (calls2.length) errs.push('fetches while hidden');
  return errs.length ? errs.join('; ') : true;
});
gate('market-wiring', 'market runs from the market record only and the page wires visibility, skeletons, dash, tabs, copy', () => {
  const main = read(path.join(DIST, 'js/main.js'));
  const m = /\(function market\(\) \{[\s\S]*?\n\}\)\(\);/.exec(main);
  const errs = [];
  if (!m) return 'market() not found';
  if (/REG\.ca|\.ca\b|'ca'/.test(m[0])) errs.push('market reads the CA record');
  if (!/REG\.market/.test(m[0]) || !/rec\.state !== 'stated'/.test(m[0])) errs.push('market ignores its own record');
  if (!/visibilitychange/.test(m[0]) || !/feed\.pause\(\)/.test(m[0]) || !/feed\.resume\(\)/.test(m[0])) errs.push('visibility handling');
  if (!/data-skel/.test(main) || !/\\u2014|—/.test(main) || !/data-error/.test(main)) errs.push('skeleton/dash/error');
  if (!/referrerPolicy/.test(main) || !/addEventListener\('error'/.test(main) || !/class="tile"|'tile'/.test(main)) errs.push('letter tile fallback');
  if (!/aria-label', 'Copy address for/.test(main)) errs.push('per-row copy button');
  if (!/role=tablist|\[role=tablist\]/.test(main) || !/ArrowRight/.test(main)) errs.push('tabs');
  const h = html();
  if (!/id="tape"/.test(h) || (h.match(/class="tk-skel"/g) || []).length < 6) errs.push('tape or ticker skeleton');
  return errs.length ? errs.join('; ') : true;
});
gate('network-allowlist', 'only registered hosts appear as network targets', () => {
  const reg = readJson(REG_PATH).records;
  const ok = new Set(['api.dexscreener.com', 'ignopad.fun', 'www.w3.org']);
  const errs = [];
  for (const f of walk(DIST).filter((x) => /\.(html|js|css|svg|_headers)$/.test(x) || x.endsWith('_headers'))) {
    for (const m of read(f).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) if (!ok.has(m[1])) {
      const h = reg.x.url ? new URL(reg.x.url).hostname : ''; const g = reg.github.url ? new URL(reg.github.url).hostname : '';
      if (m[1] !== h && m[1] !== g) errs.push(rel(f) + ' -> ' + m[1]);
    }
  }
  return errs.length ? [...new Set(errs)].join('; ') : true;
});
gate('local-refs', 'every local src/href in dist resolves to a file', () => {
  const h = html(); const bad = [];
  for (const m of h.matchAll(/(?:src|href)="(\/[^"#]*)"/g)) if (!fs.existsSync(path.join(DIST, m[1]))) bad.push(m[1]);
  for (const f of walk(path.join(DIST, 'css')).filter((x) => x.endsWith('.css'))) for (const m of read(f).matchAll(/url\(([^)]+)\)/g)) bad.push('css url ' + m[1]);
  return bad.length ? 'unresolved ' + bad.join(', ') : true;
});

// ---------- 7. mutation harness: state-independent anchors, both branches ----------
gate('mutation-harness', 'flip each gated record from its CURRENT state at runtime; both branches render correctly', () => {
  const base = readJson(REG_PATH);
  const errs = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ignopad-mut-'));
  const fixtures = {
    ca: { label: base.records.ca.label, state: 'stated', value: seededBase58(20260101) },
    x: { label: base.records.x.label, state: 'stated', kind: 'url', url: 'https://x.com/ignopad_fixture' },
    github: { label: base.records.github.label, state: 'stated', kind: 'url', url: 'https://github.com/ignopad-fixture/ignopad' }
  };
  const asAbsent = (r) => ({ label: r.label, state: 'absent', ...(r.kind ? { kind: r.kind } : {}) });
  const flip = (id) => (base.records[id].state === 'stated' ? asAbsent(base.records[id]) : fixtures[id]);
  const marketPart = (h) => {
    const a = h.indexOf('<dl class="stats"'); const b = h.indexOf('<section id="method"');
    const reg = JSON.parse(/<script type="application\/json" id="reg">([\s\S]*?)<\/script>/.exec(h)[1]);
    return h.slice(a, b) + JSON.stringify(reg.market);
  };
  const inspect = (outDir, id, expectStated, rec) => {
    const h = read(path.join(outDir, 'index.html'));
    const regJson = JSON.parse(/<script type="application\/json" id="reg">([\s\S]*?)<\/script>/.exec(h)[1]);
    if (id === 'ca') {
      const slot = /<section class="ca"[\s\S]*?<\/section>/.exec(h)[0];
      const st = /data-state="([a-z]+)"/.exec(slot)[1];
      if ((st === 'stated') !== expectStated) errs.push(`ca: slot state ${st}, expected ${expectStated ? 'stated' : 'inert'}`);
      if (expectStated) {
        if (!slot.includes('>' + rec.value + '<')) errs.push('ca stated: full address not shown');
        if (!/<button[^>]*data-ca/.test(slot)) errs.push('ca stated: copy button missing');
        if (regJson.ca.value !== rec.value) errs.push('ca stated: register not exposed to the copy handler');
      } else {
        if (/<button/.test(slot) || addressShaped(slot).length) errs.push('ca inert: slot carries a button or address');
        if (!/Pending/.test(slot) || !slot.includes(base.records.ca.label)) errs.push('ca inert: label + pending missing');
        if ('value' in regJson.ca || 'url' in regJson.ca) errs.push('ca inert: register leaks a value');
        if (base.records.ca.value && h.includes(base.records.ca.value)) errs.push('ca inert: old value still in page');
      }
      return;
    }
    const tag = new RegExp('<(?:a|span)[^>]*data-social="' + id + '"[^>]*>').exec(h)[0];
    const chip = new RegExp('<(?:a|div)[^>]*data-chip="' + id + '"[^>]*>').exec(h)[0];
    const hasHref = /\shref="/.test(tag);
    if (expectStated) {
      if (!hasHref || !tag.includes('href="' + rec.url + '"')) errs.push(id + ' stated: icon lacks the stored url');
      const hd = handleOf(id, rec.url);
      if (!tag.includes(hd)) errs.push(id + ' stated: handle not derived into the label');
      if (!/\shref=/.test(chip)) errs.push(id + ' stated: chip lacks href');
      if (regJson[id].handle !== hd) errs.push(id + ' stated: register handle');
    } else {
      if (hasHref || /\shref=/.test(chip)) errs.push(id + ' inert: href present');
      if (!/aria-disabled="true"/.test(tag)) errs.push(id + ' inert: icon not aria-disabled');
      if ('url' in regJson[id] || 'value' in regJson[id]) errs.push(id + ' inert: register leaks');
      const chipFull = new RegExp('<div class="chip is-inert"[^>]*data-chip="' + id + '"[\\s\\S]*?</div>').exec(h);
      if (!chipFull || !/Pending/.test(chipFull[0])) errs.push(id + ' inert: chip not label + pending');
    }
    if (!/<svg/.test(new RegExp('<(?:a|span)[^>]*data-social="' + id + '"[^>]*>[\\s\\S]*?</(?:a|span)>').exec(h)[0])) errs.push(id + ': icon missing in this branch');
  };
  const baseOut = path.join(tmp, 'base');
  build({ registerPath: REG_PATH, outDir: baseOut, quiet: true });
  const baseHtml = read(path.join(baseOut, 'index.html'));
  for (const id of ['ca', 'x', 'github']) {
    const cur = base.records[id];
    inspect(baseOut, id, cur.state === 'stated', cur);               // branch A: as committed
    const mut = structuredClone(base); mut.records[id] = flip(id);
    const regFile = path.join(tmp, id + '.json'); fs.writeFileSync(regFile, JSON.stringify(mut));
    const out = path.join(tmp, 'out-' + id);
    build({ registerPath: regFile, outDir: out, quiet: true });
    inspect(out, id, mut.records[id].state === 'stated', mut.records[id]);   // branch B: flipped
    // every gate that scans addresses must also pass in the flipped build
    const h2 = read(path.join(out, 'index.html'));
    if (scanAddresses(stripCaSlot(h2), mut).length) errs.push(id + ': flipped build trips the address scanner');
    if (!validateRegister(mut).length === false) errs.push(id + ': flipped register invalid');
    // market must not care
    if (marketPart(h2) !== marketPart(baseHtml)) errs.push(id + ': flipping this record changed the market block');
  }
  // all three at once, and unconfirmed carrying nothing
  const all = structuredClone(base); for (const id of ['ca', 'x', 'github']) all.records[id] = flip(id);
  const af = path.join(tmp, 'all.json'); fs.writeFileSync(af, JSON.stringify(all));
  build({ registerPath: af, outDir: path.join(tmp, 'all'), quiet: true });
  const un = structuredClone(base); for (const id of ['ca', 'x', 'github']) un.records[id] = { label: base.records[id].label, state: 'unconfirmed' };
  const uf = path.join(tmp, 'un.json'); fs.writeFileSync(uf, JSON.stringify(un));
  build({ registerPath: uf, outDir: path.join(tmp, 'un'), quiet: true });
  for (const id of ['ca', 'x', 'github']) inspect(path.join(tmp, 'un'), id, false, null);
  let threw = false;
  const bad = structuredClone(base); bad.records.ca = { label: 'Contract address', state: 'absent', value: seededBase58(3) };
  const bf = path.join(tmp, 'bad.json'); fs.writeFileSync(bf, JSON.stringify(bad));
  try { build({ registerPath: bf, outDir: path.join(tmp, 'bad'), quiet: true }); } catch { threw = true; }
  if (!threw) errs.push('build accepted an inert record carrying a value');
  fs.rmSync(tmp, { recursive: true, force: true });
  return errs.length ? errs.join('; ') : true;
});

// ---------- runner ----------
async function main() {
  try { build({ quiet: true }); } catch (e) { console.error('build failed:', e.message); process.exit(1); }
  const width = String(gates.length).length;
  let failed = 0;
  gates.forEach(() => {});
  for (const [i, g] of gates.entries()) {
    let res;
    try { res = await g.fn(); } catch (e) { res = 'threw: ' + e.message; }
    const ok = res === true;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${String(i + 1).padStart(width, '0')}/${gates.length} ${g.id}  ${g.name}${ok ? '' : '\n       -> ' + res}`);
  }
  console.log(`\n${gates.length - failed}/${gates.length} gates passed`);
  process.exit(failed ? 1 : 0);
}
main();
