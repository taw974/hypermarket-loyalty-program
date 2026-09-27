// Printing: 80 mm thermal discount slips, PVC cards (CR80) or A4 card sheets,
// and branded report pages. Uses a hidden iframe so the app keeps running.
import { store, fmt, esc } from './core.js';
import { renderCard, barcodeBits } from './card.js';
import { crownMark } from './icons.js';

function printDoc(body, css, title = 'Royal Loyalty') {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
    <link rel="stylesheet" href="/css/fonts.css"><style>${css}</style></head><body>${body}</body></html>`);
  doc.close();
  let fired = false;
  const go = async () => {
    if (fired) return;
    fired = true;
    try { await doc.fonts.ready; } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 300));
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => iframe.remove(), 90000);
  };
  iframe.addEventListener('load', go);
  setTimeout(go, 1500);
}

function barcodeSvg(text, h = 34) {
  const bits = barcodeBits(text);
  if (!bits) return '';
  let d = '';
  for (let i = 0; i < bits.length;) {
    if (bits[i] === '1') { let j = i; while (j < bits.length && bits[j] === '1') j++; d += `M${i} 0h${j - i}v${h}h${-(j - i)}z`; i = j; } else i++;
  }
  return `<svg viewBox="0 0 ${bits.length} ${h}" preserveAspectRatio="none" style="width:100%;height:${h / 3.2}mm"><path d="${d}" fill="#000" shape-rendering="crispEdges"/></svg>`;
}

// ---------- Thermal slip (80 mm) ----------
export function printReceipt(txn, { stats } = {}) {
  const s = store.settings;
  const b = store.branch(txn.branch_id) || {};
  const row = (k, v, cls = '') => `<div class="r ${cls}"><span>${esc(k)}</span><span>${esc(v)}</span></div>`;
  const body = `<div class="slip">
    <div class="c">${crownMark('#000', { size: 34, id: 'pc' })}</div>
    <div class="c h1">${esc(s.receipt_header || 'ROYAL LOYALTY CARD')}</div>
    <div class="c">${esc(b.name || txn.branch_name || '')}</div>
    <div class="c small">${esc(b.address || '')}${b.phone ? ' · Tel ' + esc(b.phone) : ''}</div>
    <div class="hr"></div>
    ${row('Receipt', txn.txn_no)}
    ${row('Date', `${fmt.date(txn.created_at)} ${fmt.time(txn.created_at)}`)}
    ${row('Cashier', txn.cashier_name || '—')}
    ${txn.pos_invoice ? row('POS invoice', txn.pos_invoice) : ''}
    <div class="hr"></div>
    ${row('Member', txn.member_name.toUpperCase())}
    ${row('Card', `${fmt.mask(txn.card_number)} · ${txn.tier_name || ''}`)}
    <div class="hr"></div>
    ${row('Bill amount', fmt.money(txn.bill_amount))}
    ${row(`Royal discount ${txn.discount_pct}%`, '- ' + fmt.money(txn.discount_amount))}
    <div class="hr dbl"></div>
    ${row('NET PAYABLE', fmt.money(txn.net_amount), 'big')}
    <div class="hr"></div>
    ${txn.status === 'void' ? '<div class="c big">*** VOID ***</div>' : ''}
    <div class="c save">You saved ${esc(fmt.money(txn.discount_amount))} today!</div>
    ${stats ? `<div class="c small">Lifetime Royal savings: ${esc(fmt.money(stats.saved))}</div>` : ''}
    <div class="bc">${barcodeSvg(txn.txn_no)}</div>
    <div class="c small">${esc(txn.txn_no)}</div>
    <div class="c foot">${esc(s.receipt_footer || '')}</div>
    <div class="c small">Welcome Friends · Al Madina Hypermarkets</div>
  </div>`;
  const css = `@page { size: 80mm auto; margin: 0; }
    body { margin: 0; font-family: 'JetBrains Mono', Consolas, monospace; font-size: 11.5px; color: #000; }
    .slip { width: 72mm; padding: 4mm 4mm 8mm; }
    .c { text-align: center; } .c svg { margin: 0 auto 2mm; display: block; }
    .h1 { font-family: Cinzel, serif; font-weight: 700; font-size: 15px; letter-spacing: 1.5px; margin-bottom: 1mm; }
    .small { font-size: 10px; } .big { font-size: 14px; font-weight: 700; }
    .r { display: flex; justify-content: space-between; gap: 3mm; margin: .6mm 0; } .r span:last-child { text-align: right; }
    .r.big { font-size: 14px; font-weight: 800; }
    .hr { border-top: 1px dashed #000; margin: 2mm 0; } .hr.dbl { border-top: 3px double #000; }
    .save { font-weight: 800; font-size: 13px; margin: 2mm 0 1mm; }
    .bc { margin: 3mm 4mm 1mm; } .foot { margin-top: 3mm; font-size: 10.5px; }`;
  printDoc(body, css, `Slip ${txn.txn_no}`);
}

// ---------- Cards ----------
// cards: array of cardData objects. mode 'cr80' → PVC card printer, 'a4' → paper sheet.
export function printCards(cards, mode = 'cr80') {
  if (mode === 'cr80') {
    const body = cards.map((d) => `<div class="pg">${renderCard(d, 'front')}</div><div class="pg">${renderCard(d, 'back')}</div>`).join('');
    const css = `@page { size: 85.6mm 53.98mm; margin: 0; } body { margin: 0; }
      .pg { width: 85.6mm; height: 53.98mm; overflow: hidden; page-break-after: always; break-after: page; }
      .pg:last-child { page-break-after: auto; } .pg svg { width: 100%; height: 100%; display: block; }`;
    printDoc(body, css, 'Royal cards');
    return;
  }
  const per = 10;
  const sheets = [];
  for (let i = 0; i < cards.length; i += per) sheets.push(cards.slice(i, i + per));
  const cell = (svg) => `<div class="cell">${svg}</div>`;
  let body = '';
  sheets.forEach((group, si) => {
    body += `<section class="sheet"><div class="hdr">Royal Loyalty cards · sheet ${si + 1}/${sheets.length} · FRONT · cut along the hairlines</div>
      <div class="grid">${group.map((d) => cell(renderCard(d, 'front'))).join('')}</div></section>`;
    // Backs are mirrored per row so a long-edge duplex print lines up with its front.
    const mirrored = [];
    for (let r = 0; r < group.length; r += 2) mirrored.push(group[r + 1] || null, group[r]);
    body += `<section class="sheet"><div class="hdr">Royal Loyalty cards · sheet ${si + 1}/${sheets.length} · BACK (mirrored for duplex)</div>
      <div class="grid">${mirrored.map((d) => (d ? cell(renderCard(d, 'back')) : '<div class="cell blank"></div>')).join('')}</div></section>`;
  });
  const css = `@page { size: A4; margin: 0; } body { margin: 0; font-family: Manrope, sans-serif; }
    .sheet { width: 210mm; height: 296mm; padding: 9mm 0 0; box-sizing: border-box; page-break-after: always; break-after: page; }
    .sheet:last-child { page-break-after: auto; }
    .hdr { text-align: center; font-size: 8pt; color: #777; margin-bottom: 3mm; letter-spacing: .5px; }
    .grid { display: grid; grid-template-columns: 85.6mm 85.6mm; grid-auto-rows: 53.98mm; gap: 3.5mm 6mm; justify-content: center; }
    .cell { outline: .1mm solid #bbb; outline-offset: 0; border-radius: 3.2mm; overflow: hidden; }
    .cell.blank { outline: none; } .cell svg { width: 100%; height: 100%; display: block; }`;
  printDoc(body, css, 'Royal cards (A4)');
}

// ---------- Report ----------
export function printReport({ title, subtitle, summary = [], headers, rows, footRow }) {
  const s = store.settings;
  const body = `<div class="rep">
    <header><div class="brand">${crownMark('#8a6714', { size: 44, id: 'rp' })}<div><div class="p">${esc(s.program_name)}</div><div class="t">${esc(s.program_tagline)}</div></div></div>
      <div class="meta"><div class="h">${esc(title)}</div><div>${esc(subtitle || '')}</div><div class="gen">Generated ${esc(fmt.dateTime(new Date(Date.now() + store.clockOffset).toISOString().slice(0, 19).replace('T', ' ')))} by ${esc(store.user?.full_name || '')}</div></div></header>
    <div class="sum">${summary.map((x) => `<div><span>${esc(x.label)}</span><b>${esc(x.value)}</b></div>`).join('')}</div>
    <table><thead><tr>${headers.map((h) => `<th class="${h.r ? 'r' : ''}">${esc(h.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((v, i) => `<td class="${headers[i].r ? 'r' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>
    ${footRow ? `<tfoot><tr>${footRow.map((v, i) => `<td class="${headers[i].r ? 'r' : ''}">${esc(v)}</td>`).join('')}</tr></tfoot>` : ''}</table>
    <div class="sign"><div>Prepared by</div><div>Checked by</div><div>Approved by</div></div>
  </div>`;
  const css = `@page { size: A4; margin: 14mm; } body { margin: 0; font-family: Manrope, sans-serif; color: #1c1810; font-size: 10pt; }
    header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #b08e2e; padding-bottom: 5mm; margin-bottom: 5mm; }
    .brand { display: flex; gap: 4mm; align-items: center; } .p { font-family: Cinzel, serif; font-weight: 700; font-size: 16pt; letter-spacing: 1px; }
    .t { color: #6b604a; font-size: 9pt; } .meta { text-align: right; font-size: 9pt; color: #555; } .meta .h { font-size: 13pt; font-weight: 800; color: #1c1810; }
    .gen { font-size: 8pt; margin-top: 1mm; }
    .sum { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin-bottom: 5mm; }
    .sum div { border: 1px solid #e3d9c2; border-radius: 3mm; padding: 3mm; background: #fbf8f0; } .sum span { display: block; font-size: 8pt; color: #7a6f58; } .sum b { font-size: 12pt; }
    table { width: 100%; border-collapse: collapse; } th { text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: .5px; color: #6b604a; border-bottom: 1.5px solid #b08e2e; padding: 2mm; }
    td { padding: 1.8mm 2mm; border-bottom: 1px solid #eee4cf; font-variant-numeric: tabular-nums; } .r { text-align: right; }
    tfoot td { font-weight: 800; border-top: 1.5px solid #b08e2e; background: #fbf8f0; }
    .sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12mm; margin-top: 18mm; } .sign div { border-top: 1px solid #999; padding-top: 2mm; font-size: 9pt; color: #555; text-align: center; }`;
  printDoc(body, css, title);
}
