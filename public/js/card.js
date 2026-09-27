// Royal Loyalty card renderer — vector SVG at CR80 proportions (85.6 × 54 mm,
// 1 unit = 0.1 mm). Used on screen (3D), in print sheets and PNG export.
import qrcode from '../vendor/qrcode.mjs';
import { CROWN_PATH } from './icons.js';

export const CARD_W = 856;
export const CARD_H = 540;

export const THEMES = {
  gold: {
    label: 'Royal Gold',
    bg: ['#221c12', '#0e0c08', '#050403'],
    foil: [[0, '#7d5e1a'], [0.18, '#c9a13a'], [0.36, '#fff0b5'], [0.52, '#d4af37'], [0.7, '#f6e08f'], [0.86, '#a88223'], [1, '#6e5215']],
    ink: '#efd89a', soft: 'rgba(239,216,154,0.62)', faint: 'rgba(212,175,55,0.17)', onFoil: '#1c1508',
  },
  platinum: {
    label: 'Royal Platinum',
    bg: ['#2b2f36', '#15171b', '#08090b'],
    foil: [[0, '#6f747c'], [0.2, '#c9ced6'], [0.38, '#ffffff'], [0.55, '#aeb4bd'], [0.72, '#eef1f5'], [0.88, '#8d939c'], [1, '#5c6168']],
    ink: '#e8ebf0', soft: 'rgba(232,235,240,0.6)', faint: 'rgba(214,220,230,0.15)', onFoil: '#15171b',
  },
  black: {
    label: 'Royal Black',
    bg: ['#161212', '#070606', '#000000'],
    foil: [[0, '#7a4a3c'], [0.2, '#c98f76'], [0.38, '#ffe3d3'], [0.55, '#d49b82'], [0.72, '#f6cdb8'], [0.88, '#9c6250'], [1, '#6b3f33']],
    ink: '#f3cfbd', soft: 'rgba(243,207,189,0.6)', faint: 'rgba(214,160,138,0.16)', onFoil: '#1a0f0b',
  },
};

const FONT_UI = "Manrope, 'Segoe UI', sans-serif";
const FONT_DISPLAY = "Cinzel, 'Times New Roman', serif";
const FONT_AR = "Amiri, 'Traditional Arabic', serif";
const FONT_MONO = "'JetBrains Mono', Consolas, monospace";
const X = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let uidSeq = 0;

// ---------- Security pattern (guilloche) ----------
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
let GEOM = null;
function geometry() {
  if (GEOM) return GEOM;
  const rose = (R, r, d, scale, rot, cx, cy, steps) => {
    const k = (R - r) / r;
    const period = (2 * Math.PI * r) / gcd(R, r);
    let s = '';
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * period;
      const x = (R - r) * Math.cos(t) + d * Math.cos(k * t);
      const y = (R - r) * Math.sin(t) - d * Math.sin(k * t);
      const xr = x * Math.cos(rot) - y * Math.sin(rot);
      const yr = x * Math.sin(rot) + y * Math.cos(rot);
      s += (i ? 'L' : 'M') + (cx + xr * scale).toFixed(1) + ' ' + (cy + yr * scale).toFixed(1);
    }
    return s;
  };
  const rosettes = [
    rose(13, 7, 6, 17.5, 0, 690, 250, 1100),
    rose(13, 7, 6, 13.2, 0.13, 690, 250, 1000),
    rose(11, 5, 4.2, 20.5, 0.28, 690, 250, 900),
  ];
  const waves = [];
  for (let i = 0; i < 15; i++) {
    let s = '';
    for (let x = -12; x <= 868; x += 7) {
      const y = 404 + i * 8.6 + 15 * Math.sin(x / 66 + i * 0.33) + 5 * Math.sin(x / 21 + i * 0.95);
      s += (x === -12 ? 'M' : 'L') + x + ' ' + y.toFixed(1);
    }
    waves.push(s);
  }
  GEOM = { rosettes, waves };
  return GEOM;
}
function patternMarkup(color, which = 'front') {
  const g = geometry();
  if (which === 'front') {
    return `<g fill="none" stroke="${color}" stroke-width="0.9">${g.rosettes.map((d, i) => `<path d="${d}" stroke-opacity="${[1, 0.75, 0.55][i]}"/>`).join('')}</g>
      <g fill="none" stroke="${color}" stroke-width="0.7">${g.waves.map((d, i) => `<path d="${d}" stroke-opacity="${(0.95 - i * 0.045).toFixed(2)}"/>`).join('')}</g>`;
  }
  return `<g fill="none" stroke="${color}" stroke-width="0.8" transform="translate(-520 70) scale(1.2)">${g.rosettes.slice(0, 2).map((d) => `<path d="${d}"/>`).join('')}</g>`;
}

// ---------- QR & barcode geometry ----------
function qrMarkup(data, size, x, y, color = '#0b0906') {
  const qr = qrcode(0, 'Q');
  qr.addData(String(data), /^\d+$/.test(data) ? 'Numeric' : 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const cell = size / n;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      let e = c;
      while (e + 1 < n && qr.isDark(r, e + 1)) e++;
      const w = (e - c + 1) * cell;
      d += `M${(x + c * cell).toFixed(2)} ${(y + r * cell).toFixed(2)}h${w.toFixed(2)}v${cell.toFixed(2)}h${(-w).toFixed(2)}z`;
      c = e;
    }
  }
  return `<path d="${d}" fill="${color}" shape-rendering="crispEdges"/>`;
}
export function barcodeBits(text) {
  if (!window.JsBarcode) return null;
  const obj = {};
  window.JsBarcode(obj, String(text), { format: 'CODE128', margin: 0, displayValue: false });
  return (obj.encodings || []).map((e) => e.data).join('');
}
// Lays the bars out inside a white tile of width tileW, keeping the Code-128
// quiet zone (>= 10 modules) clear on both sides.
function barcodeMarkup(text, tileX, y, tileW, height, color = '#0b0906') {
  const bits = barcodeBits(text);
  if (!bits) return '';
  const quiet = 12;
  const m = tileW / (bits.length + quiet * 2);
  const x = tileX + quiet * m;
  let d = '';
  for (let i = 0; i < bits.length;) {
    if (bits[i] === '1') {
      let j = i;
      while (j < bits.length && bits[j] === '1') j++;
      d += `M${(x + i * m).toFixed(2)} ${y}h${((j - i) * m).toFixed(2)}v${height}h${(-(j - i) * m).toFixed(2)}z`;
      i = j;
    } else i++;
  }
  return `<path d="${d}" fill="${color}" shape-rendering="crispEdges"/>`;
}

// ---------- helpers ----------
export function withLuhn(payload) {
  let sum = 0;
  let dbl = true;
  for (let i = payload.length - 1; i >= 0; i--) {
    let d = payload.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return payload + ((10 - (sum % 10)) % 10);
}
const fmtNo = (n) => String(n || '').replace(/(\d{4})(?=\d)/g, '$1 ');
const mmyy = (ymd) => (ymd ? ymd.slice(5, 7) + '/' + ymd.slice(2, 4) : '--/--');
function fit(text, fs, ls, maxW, em = 0.62) {
  const est = text.length * (fs * em + ls);
  return est > maxW ? ` textLength="${maxW}" lengthAdjust="spacingAndGlyphs"` : '';
}
function defs(u, t) {
  const stops = t.foil.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
  return `<defs>
    <linearGradient id="${u}f" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient>
    <linearGradient id="${u}h" x1="0" y1="0" x2="1" y2="0.35">${stops}</linearGradient>
    <radialGradient id="${u}bg" cx="0.22" cy="0.12" r="1.15">
      <stop offset="0" stop-color="${t.bg[0]}"/><stop offset="0.55" stop-color="${t.bg[1]}"/><stop offset="1" stop-color="${t.bg[2]}"/></radialGradient>
    <linearGradient id="${u}sh" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0.3" stop-color="#fff" stop-opacity="0"/><stop offset="0.47" stop-color="#fff" stop-opacity="0.07"/>
      <stop offset="0.5" stop-color="#fff" stop-opacity="0.11"/><stop offset="0.53" stop-color="#fff" stop-opacity="0.05"/><stop offset="0.7" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="${u}holo" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#b8f3ff"/><stop offset="0.25" stop-color="#ffd6f6"/><stop offset="0.5" stop-color="#fff6c2"/>
      <stop offset="0.75" stop-color="#c8ffd9"/><stop offset="1" stop-color="#c9d4ff"/></linearGradient>
    <clipPath id="${u}clip"><rect width="${CARD_W}" height="${CARD_H}" rx="34"/></clipPath>
  </defs>`;
}
const crown = (fill, x, y, s, extra = '') => `<g transform="translate(${x} ${y}) scale(${s})" fill="${fill}" ${extra}>
  <path d="${CROWN_PATH}"/><rect x="11" y="66" width="78" height="11" rx="3"/>
  <circle cx="5" cy="22" r="4.5"/><circle cx="27.5" cy="14" r="4"/><circle cx="50" cy="5" r="5"/><circle cx="72.5" cy="14" r="4"/><circle cx="95" cy="22" r="4.5"/></g>`;

// Normalised input for the renderer.
export function cardData({ member = {}, card = {}, tier = {}, branches = [] } = {}) {
  return {
    name: member.full_name || 'YOUR NAME',
    number: card.card_number || '9740000000000000',
    since: card.issued_at || (member.created_at || '').slice(0, 10),
    expires: card.expires_at || '',
    theme: tier.theme || 'gold',
    tierName: tier.name || THEMES[tier.theme || 'gold'].label,
    pct: tier.discount_pct ?? 15,
    memberCode: member.member_code || '',
    branches,
  };
}

export function renderCard(data, side = 'front') {
  const t = THEMES[data.theme] || THEMES.gold;
  const u = 'rc' + ++uidSeq + '_';
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${CARD_H}" role="img" aria-label="${X(data.tierName)} card ${side}">${defs(u, t)}`;
  const base = `<g clip-path="url(#${u}clip)"><rect width="${CARD_W}" height="${CARD_H}" fill="url(#${u}bg)"/>`;
  const frame = `<rect x="16" y="16" width="${CARD_W - 32}" height="${CARD_H - 32}" rx="24" fill="none" stroke="url(#${u}f)" stroke-opacity="0.5" stroke-width="1.6"/>
    <rect x="24" y="24" width="${CARD_W - 48}" height="${CARD_H - 48}" rx="18" fill="none" stroke="url(#${u}f)" stroke-opacity="0.18" stroke-width="1"/>`;
  return side === 'back' ? open + base + back(data, t, u, frame) + '</svg>' : open + base + front(data, t, u, frame) + '</svg>';
}

function front(d, t, u, frame) {
  const name = X(String(d.name).toUpperCase());
  const num = X(fmtNo(d.number));
  const ringR = 76;
  const ringLen = (2 * Math.PI * ringR - 6).toFixed(1);
  const pct = Number(d.pct);
  const pctTxt = (Number.isInteger(pct) ? pct : pct.toFixed(1)) + '%';
  return `${patternMarkup(t.faint, 'front')}
    <rect width="${CARD_W}" height="${CARD_H}" fill="url(#${u}sh)"/>
    ${frame}</g>
    ${crown(`url(#${u}f)`, 54, 44, 0.74)}
    <text x="142" y="88" font-family="${FONT_DISPLAY}" font-weight="700" font-size="48" letter-spacing="10" fill="url(#${u}h)">ROYAL</text>
    <text x="145" y="116" font-family="${FONT_UI}" font-weight="700" font-size="14.5" letter-spacing="7.6" fill="${t.soft}">LOYALTY CARD</text>
    <text x="802" y="86" text-anchor="end" font-family="${FONT_AR}" font-weight="700" font-size="31" fill="url(#${u}h)">بطاقة الولاء الملكية</text>
    <text x="802" y="113" text-anchor="end" font-family="${FONT_UI}" font-weight="700" font-size="11.5" letter-spacing="4" fill="${t.soft}">PRIVILEGE · QATAR</text>

    <g transform="translate(62 170)">
      <rect width="94" height="72" rx="13" fill="url(#${u}f)"/>
      <g fill="none" stroke="${t.onFoil}" stroke-opacity="0.45" stroke-width="1.6">
        <rect x="31" y="15" width="32" height="42" rx="7"/>
        <path d="M0 26h31M0 46h31M63 26h31M63 46h31M47 0v15M47 57v15"/>
      </g>
    </g>
    <g transform="translate(182 206)" fill="none" stroke="url(#${u}f)" stroke-width="3" stroke-linecap="round" opacity="0.8">
      <path d="M0 -14a20 20 0 0 1 0 28"/><path d="M11 -24a34 34 0 0 1 0 48"/><path d="M22 -33a48 48 0 0 1 0 66"/>
    </g>

    <g transform="translate(690 250)">
      <circle r="98" fill="none" stroke="url(#${u}f)" stroke-width="2.6"/>
      <circle r="90" fill="none" stroke="url(#${u}f)" stroke-width="1" stroke-opacity="0.6"/>
      <path id="${u}ring" d="M -${ringR} 0 A ${ringR} ${ringR} 0 1 1 ${ringR} 0 A ${ringR} ${ringR} 0 1 1 -${ringR} 0" fill="none"/>
      <text font-family="${FONT_UI}" font-weight="800" font-size="12.5" letter-spacing="2" fill="${t.soft}">
        <textPath href="#${u}ring" textLength="${ringLen}" lengthAdjust="spacing">ROYAL PRIVILEGE ✦ ALL BRANCHES ✦ ROYAL PRIVILEGE ✦ INSTANT DISCOUNT ✦</textPath></text>
      <circle r="62" fill="url(#${u}f)"/>
      <circle r="56" fill="none" stroke="${t.onFoil}" stroke-opacity="0.35" stroke-width="1.2"/>
      <text y="12" text-anchor="middle" font-family="${FONT_DISPLAY}" font-weight="700" font-size="${pctTxt.length > 3 ? 36 : 44}" fill="${t.onFoil}">${pctTxt}</text>
      <text y="36" text-anchor="middle" font-family="${FONT_UI}" font-weight="800" font-size="12.5" letter-spacing="5" fill="${t.onFoil}">OFF</text>
      <text y="-28" text-anchor="middle" font-family="${FONT_UI}" font-weight="800" font-size="9.5" letter-spacing="3" fill="${t.onFoil}" fill-opacity="0.7">ALWAYS</text>
    </g>

    <text x="64" y="342" font-family="${FONT_UI}" font-weight="700" font-size="40" letter-spacing="5" fill="rgba(0,0,0,0.55)" transform="translate(1.6 2.2)" style="font-variant-numeric: tabular-nums">${num}</text>
    <text x="64" y="342" font-family="${FONT_UI}" font-weight="700" font-size="40" letter-spacing="5" fill="url(#${u}h)" style="font-variant-numeric: tabular-nums">${num}</text>

    <text x="64" y="384" font-family="${FONT_UI}" font-weight="700" font-size="10.5" letter-spacing="2.4" fill="${t.soft}">MEMBER SINCE</text>
    <text x="64" y="408" font-family="${FONT_UI}" font-weight="700" font-size="19" letter-spacing="2" fill="${t.ink}">${X(mmyy(d.since))}</text>
    <text x="222" y="384" font-family="${FONT_UI}" font-weight="700" font-size="10.5" letter-spacing="2.4" fill="${t.soft}">VALID THRU</text>
    <text x="222" y="408" font-family="${FONT_UI}" font-weight="700" font-size="19" letter-spacing="2" fill="${t.ink}">${X(mmyy(d.expires))}</text>

    <text x="64" y="458" font-family="${FONT_DISPLAY}" font-weight="600" font-size="27" letter-spacing="2.6" fill="${t.ink}"${fit(name, 27, 2.6, 470, 0.74)}>${name}</text>
    <text x="794" y="458" text-anchor="end" font-family="${FONT_DISPLAY}" font-weight="700" font-size="16.5" letter-spacing="4.5" fill="url(#${u}h)">${X(String(d.tierName).toUpperCase())}</text>
    <line x1="64" x2="794" y1="480" y2="480" stroke="url(#${u}h)" stroke-opacity="0.45" stroke-width="1.2"/>
    <text x="429" y="507" text-anchor="middle" font-family="${FONT_UI}" font-weight="700" font-size="12.2" letter-spacing="3" fill="${t.soft}">WELCOME FRIENDS HYPERMARKET  ◆  AL MADINA HYPERMARKET</text>`;
}

function back(d, t, u, frame) {
  const pct = Number(d.pct);
  const pctTxt = (Number.isInteger(pct) ? pct : pct.toFixed(1)) + '%';
  const welcome = d.branches.filter((b) => b.brand === 'welcome');
  const madina = d.branches.filter((b) => b.brand === 'madina');
  const line = (b, x, y) => `<text x="${x}" y="${y}" font-family="${FONT_UI}" font-weight="600" font-size="12.2" fill="${t.ink}" fill-opacity="0.92">
      <tspan font-weight="800" fill="${t.soft}">${X(b.code.replace('BR-', 'B'))}</tspan>  ${X(b.short_name)}<tspan fill="${t.soft}">  ·  ${X(b.phone || '')}</tspan></text>`;
  return `${patternMarkup(t.faint, 'back')}
    <rect width="${CARD_W}" height="${CARD_H}" fill="url(#${u}sh)"/>
    ${frame}</g>
    <rect x="52" y="52" width="244" height="244" rx="22" fill="#fffdf6"/>
    <rect x="52" y="52" width="244" height="244" rx="22" fill="none" stroke="url(#${u}f)" stroke-width="3"/>
    ${qrMarkup(d.number, 180, 84, 84)}
    <text x="174" y="330" text-anchor="middle" font-family="${FONT_UI}" font-weight="800" font-size="11.5" letter-spacing="3.2" fill="${t.soft}">SCAN AT CHECKOUT</text>

    <text x="332" y="88" font-family="${FONT_DISPLAY}" font-weight="700" font-size="25" letter-spacing="3" fill="url(#${u}h)">ROYAL PRIVILEGES</text>
    <g font-family="${FONT_UI}" font-size="14.2" font-weight="600" fill="${t.ink}">
      <text x="332" y="122"><tspan fill="${t.soft}">✦ </tspan><tspan font-weight="800">${pctTxt} instant discount</tspan> on your total bill</text>
      <text x="332" y="146"><tspan fill="${t.soft}">✦ </tspan>Valid at all 5 Welcome Friends &amp; Al Madina branches</text>
      <text x="332" y="170"><tspan fill="${t.soft}">✦ </tspan>Show this card or your digital card before paying</text>
    </g>
    <rect x="332" y="194" width="470" height="102" rx="16" fill="#fffdf6"/>
    ${barcodeMarkup(d.number, 332, 206, 470, 60)}
    <text x="567" y="288" text-anchor="middle" font-family="${FONT_MONO}" font-weight="500" font-size="15" letter-spacing="3.5" fill="#1a150c">${X(fmtNo(d.number))}</text>
    <text x="802" y="330" text-anchor="end" font-family="${FONT_UI}" font-weight="700" font-size="11" letter-spacing="2.4" fill="${t.soft}">${X(d.memberCode)}</text>

    <line x1="52" x2="804" y1="350" y2="350" stroke="url(#${u}h)" stroke-opacity="0.35"/>
    <text x="52" y="378" font-family="${FONT_UI}" font-weight="800" font-size="11" letter-spacing="2.6" fill="url(#${u}h)">WELCOME FRIENDS HYPERMARKET</text>
    ${welcome.map((b, i) => line(b, 52, 402 + i * 22)).join('')}
    <text x="452" y="378" font-family="${FONT_UI}" font-weight="800" font-size="11" letter-spacing="2.6" fill="url(#${u}h)">AL MADINA HYPERMARKET</text>
    ${madina.map((b, i) => line(b, 452, 402 + i * 22)).join('')}

    <g transform="translate(772 440)">
      <circle r="30" fill="url(#${u}holo)" opacity="0.9"/>
      <circle r="30" fill="none" stroke="#fff" stroke-opacity="0.6"/>
      ${crown('rgba(40,30,60,0.55)', -15, -14, 0.3)}
      <text y="20" text-anchor="middle" font-family="${FONT_UI}" font-weight="800" font-size="6.5" letter-spacing="1.4" fill="rgba(40,30,60,0.6)">GENUINE</text>
    </g>
    <text x="52" y="492" font-family="${FONT_UI}" font-weight="500" font-size="10.8" fill="${t.soft}">This card remains the property of the issuer, is non-transferable and may be withdrawn at any time.</text>
    <text x="52" y="510" font-family="${FONT_UI}" font-weight="500" font-size="10.8" fill="${t.soft}">If found, please return it to any Welcome Friends or Al Madina Hypermarket branch.</text>`;
}

// ---------- 3D interactive card ----------
export function card3dHtml(data, { flippable = true, floating = false, hint = false, startBack = false } = {}) {
  return `<div class="card3d${floating ? ' floating' : ''}${startBack ? ' flipped' : ''}" data-card3d ${flippable ? 'data-flippable' : ''} tabindex="0" role="button" aria-label="Royal card — press to flip">
    <div class="card3d-inner">
      <div class="card3d-face front">${renderCard(data, 'front')}<div class="card3d-shine"></div><div class="card3d-glare"></div></div>
      <div class="card3d-face back">${renderCard(data, 'back')}<div class="card3d-glare"></div></div>
    </div>
    ${hint ? '<div class="card3d-hint">Tap to flip · move to tilt</div>' : ''}
  </div>`;
}

export function bindCard3d(root) {
  const cards = root.matches?.('[data-card3d]') ? [root] : Array.from(root.querySelectorAll('[data-card3d]'));
  const offs = cards.map((el) => {
    const inner = el.querySelector('.card3d-inner');
    let raf = 0;
    const move = (e) => {
      if (el.classList.contains('floating')) return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.classList.add('tracking');
        inner.style.setProperty('--rx', `${(0.5 - py) * 16}deg`);
        inner.style.setProperty('--ry', `${(px - 0.5) * 22}deg`);
        el.querySelectorAll('.card3d-glare').forEach((g) => {
          g.style.setProperty('--gx', `${px * 100}%`);
          g.style.setProperty('--gy', `${py * 100}%`);
          g.style.setProperty('--glare', '0.55');
        });
      });
    };
    const leave = () => {
      cancelAnimationFrame(raf);
      el.classList.remove('tracking');
      inner.style.setProperty('--rx', '0deg');
      inner.style.setProperty('--ry', '0deg');
      el.querySelectorAll('.card3d-glare').forEach((g) => g.style.setProperty('--glare', '0'));
    };
    const flip = () => { if (el.hasAttribute('data-flippable')) el.classList.toggle('flipped'); };
    const key = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('click', flip);
    el.addEventListener('keydown', key);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('click', flip);
      el.removeEventListener('keydown', key);
    };
  });
  return () => offs.forEach((f) => f());
}

// ---------- Standalone export (fonts embedded) ----------
const FONT_FILES = [
  ['Cinzel', 600, 'cinzel-600.woff2'], ['Cinzel', 700, 'cinzel-700.woff2'],
  ['Manrope', '200 800', 'manrope-latin.woff2'], ['Amiri', 700, 'amiri-arabic-700.woff2'], ['JetBrains Mono', 500, 'jetbrains-mono-500.woff2'],
];
let fontCss = null;
async function embeddedFontCss() {
  if (!fontCss) {
    fontCss = Promise.all(FONT_FILES.map(async ([fam, w, file]) => {
      const buf = await (await fetch(`/vendor/fonts/${file}`)).arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return `@font-face{font-family:'${fam}';font-weight:${w};src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2');}`;
    })).then((a) => a.join(''));
  }
  return fontCss;
}

export async function standaloneSvg(data, side) {
  const css = await embeddedFontCss();
  return renderCard(data, side).replace('<defs>', `<defs><style>${css}</style>`);
}

export async function cardPngBlob(data, side = 'front', width = 2022) {
  const svg = await standaloneSvg(data, side);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const h = Math.round((width * CARD_H) / CARD_W);
    const c = document.createElement('canvas');
    c.width = width; c.height = h;
    const ctx = c.getContext('2d');
    // Give the browser a beat to apply embedded fonts inside the SVG image.
    await new Promise((r) => setTimeout(r, 120));
    ctx.drawImage(img, 0, 0, width, h);
    return await new Promise((res) => c.toBlob(res, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
