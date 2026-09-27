// Member-facing digital Royal card (opened from the WhatsApp link).
import qrcode from '../vendor/qrcode.mjs';
import { html, raw, ic, fmt, store } from './core.js';
import { card3dHtml, bindCard3d, cardData, barcodeBits } from './card.js';
import { crownMark } from './icons.js';

const root = document.getElementById('m-app');
const token = location.pathname.split('/').filter(Boolean).pop() || '';

function qrSvg(text, size = 220) {
  const qr = qrcode(0, 'Q');
  qr.addData(text, /^\d+$/.test(text) ? 'Numeric' : 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const q = 4;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      let e = c;
      while (e + 1 < n && qr.isDark(r, e + 1)) e++;
      d += `M${c + q} ${r + q}h${e - c + 1}v1h${-(e - c + 1)}z`;
      c = e;
    }
  }
  return `<svg viewBox="0 0 ${n + q * 2} ${n + q * 2}" width="${size}" height="${size}" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000" shape-rendering="crispEdges"/></svg>`;
}
function barcodeSvg(text) {
  const bits = barcodeBits(text);
  if (!bits) return '';
  let d = '';
  for (let i = 0; i < bits.length;) {
    if (bits[i] === '1') { let j = i; while (j < bits.length && bits[j] === '1') j++; d += `M${i + 10} 0h${j - i}v60h${-(j - i)}z`; i = j; } else i++;
  }
  return `<svg viewBox="0 0 ${bits.length + 20} 60" preserveAspectRatio="none" class="m-barcode" role="img" aria-label="Barcode"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000" shape-rendering="crispEdges"/></svg>`;
}

async function load() {
  let data;
  try {
    const res = await fetch(`/api/public/card/${encodeURIComponent(token)}`);
    if (!res.ok) throw new Error(res.status === 404 ? 'This card link is not valid any more.' : 'Could not load your card right now.');
    data = await res.json();
  } catch (err) {
    root.innerHTML = String(html`<div class="m-error">${raw(crownMark('url(#mE)', { id: 'mE', size: 64 }))}<h1 class="display">Royal Card</h1><p>${err.message}</p>
      <p class="muted">Please ask any Welcome Friends or Al Madina Hypermarket counter for a new link.</p></div>`);
    return;
  }
  store.settings = { currency: data.program.currency };
  const c = data.card;
  document.title = `${data.member.first_name}'s Royal Card`;
  const cd = cardData({ member: { full_name: data.member.full_name, member_code: data.member.member_code, created_at: data.member.since },
    card: { card_number: c.card_number, issued_at: c.issued_at, expires_at: c.expires_at }, tier: c.tier, branches: data.branches });
  const ok = c.status === 'active';
  const statusText = { active: 'Active', expired: 'Expired', suspended: 'Suspended', blocked: 'Blocked', lost: 'Replaced', replaced: 'Replaced' }[c.status] || c.status;

  root.innerHTML = String(html`
  <header class="m-head">
    <div class="m-brand">${raw(crownMark('url(#mH)', { id: 'mH', size: 30 }))}<span><b>ROYAL</b><small>LOYALTY CARD</small></span></div>
    <span class="chip ${ok ? 'chip-good' : 'chip-critical'}">${ic(ok ? 'check-circle' : 'alert')}${statusText}</span>
  </header>

  <section class="m-hello">
    <div class="m-kicker">${ic('crown', 'i-sm')} ${c.tier.name} member</div>
    <h1 class="display">Hello, ${data.member.first_name}</h1>
    <p class="soft">Enjoy <b class="gold">${c.tier.discount_pct}% instant discount</b> on every bill at all 5 Welcome Friends &amp; Al Madina hypermarkets.</p>
  </section>

  <section class="m-card">${raw(card3dHtml(cd, { hint: true }))}</section>

  <section class="m-scan panel ${ok ? '' : 'disabled'}">
    <div class="m-scan-title">${ic('scan', 'i-sm')} Show this at the counter</div>
    <div class="m-qr">${raw(qrSvg(c.card_number))}</div>
    <div class="m-bc">${raw(barcodeSvg(c.card_number))}</div>
    <div class="m-no">${fmt.card(c.card_number)}</div>
    <div class="muted small">Tip: turn your screen brightness up for faster scanning</div>
    ${ok ? '' : html`<div class="m-warn">${ic('alert', 'i-sm')} This card is ${statusText.toLowerCase()}. Please visit any branch counter.</div>`}
  </section>

  <section class="m-stats">
    <div class="panel highlight"><span>You have saved</span><b class="gold" id="m-saved">${fmt.money(0)}</b></div>
    <div class="panel"><span>Royal visits</span><b>${fmt.int(data.stats.visits)}</b></div>
    <div class="panel"><span>Valid thru</span><b>${fmt.mmyy(c.expires_at)}</b></div>
  </section>

  ${data.visits.length ? html`<section class="panel m-list">
    <h2>${ic('history', 'i-sm')} Recent savings</h2>
    ${data.visits.map((v) => html`<div class="m-row"><div><b>${v.branch}</b><small>${fmt.date(v.created_at)} · bill ${fmt.money(v.bill_amount)}</small></div><b class="gold">− ${fmt.money(v.discount_amount)}</b></div>`)}
  </section>` : ''}

  <section class="panel m-list">
    <h2>${ic('store', 'i-sm')} Use your card at</h2>
    ${data.branches.map((b) => html`<div class="m-row">
      <div><b>${b.name}</b><small>${b.address || ''}</small></div>
      <div class="m-actions">
        ${b.phone ? html`<a class="btn btn-ghost btn-icon btn-sm" href="tel:+974${b.phone.replace(/\s/g, '')}" aria-label="Call ${b.short_name}">${ic('phone', 'i-sm')}</a>` : ''}
        ${b.map_url ? html`<a class="btn btn-outline btn-icon btn-sm" href="${b.map_url}" target="_blank" rel="noopener" aria-label="Directions to ${b.short_name}">${ic('pin', 'i-sm')}</a>` : ''}
      </div></div>`)}
  </section>

  <section class="panel m-how">
    <h2>${ic('sparkles', 'i-sm')} How it works</h2>
    <ol><li><b>Shop</b> at any of our 5 hypermarkets</li><li><b>Show</b> this card (or the plastic card) before paying</li><li><b>Save ${c.tier.discount_pct}%</b> instantly on your total bill</li></ol>
  </section>

  <footer class="m-foot">
    <div class="arabic">بطاقة الولاء الملكية</div>
    <p>${data.program.tagline}</p>
    <p class="muted">Member ${data.member.member_code} · since ${fmt.date(data.member.since)} · This card is personal and non-transferable.</p>
  </footer>`);

  bindCard3d(root);
  const el = document.getElementById('m-saved');
  const target = Number(data.stats.saved) || 0;
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 1400);
    el.textContent = fmt.money(target * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// JsBarcode is a classic deferred script; make sure it is ready before rendering.
if (window.JsBarcode) load();
else window.addEventListener('load', load, { once: true });
