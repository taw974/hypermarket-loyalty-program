// Lightweight SVG charts following the house data-viz rules: thin marks,
// hairline grid, one axis, selective direct labels, hover tooltips, and a
// table-view twin for every chart.
import { esc, fmt } from './core.js';

const NS = 'http://www.w3.org/2000/svg';
let tipEl;
function tip() {
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl); }
  return tipEl;
}
export function showTip(x, y, head, rows) {
  const t = tip();
  t.innerHTML = `<div class="tip-head">${esc(head)}</div>` + rows.map((r) => `<div class="tip-row"><span class="k">${r.key ? `<span class="tip-key" style="background:${r.key}"></span>` : ''}${esc(r.label)}</span><span class="v">${esc(r.value)}</span></div>`).join('');
  t.classList.add('on');
  const w = t.offsetWidth;
  const h = t.offsetHeight;
  let left = x + 16;
  let top = y - h - 12;
  if (left + w > innerWidth - 8) left = x - w - 16;
  if (top < 8) top = y + 16;
  t.style.left = `${Math.max(8, left)}px`;
  t.style.top = `${top}px`;
}
export function hideTip() { if (tipEl) tipEl.classList.remove('on'); }

function niceMax(v) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * exp;
}
function ticks(max, n = 4) {
  const top = niceMax(max);
  const step = top / n;
  return Array.from({ length: n + 1 }, (_, i) => step * i);
}

// Re-render on container resize; returns cleanup.
function responsive(el, draw) {
  let w = 0;
  const ro = new ResizeObserver(() => {
    const nw = Math.floor(el.clientWidth);
    if (nw && Math.abs(nw - w) > 2) { w = nw; draw(nw); }
  });
  ro.observe(el);
  return () => { ro.disconnect(); hideTip(); };
}

// ---------------- Line / area over time ----------------
export function lineChart(el, { points, height = 280, yFormat = fmt.compact, label = 'value', tooltip, area = true, xLabel = (p) => fmt.dateShort(p.x) }) {
  const draw = (W) => {
    const H = height;
    const m = { l: 52, r: 18, t: 18, b: 30 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const max = Math.max(1, ...points.map((p) => p.y));
    const tk = ticks(max);
    const top = tk[tk.length - 1];
    const n = points.length;
    const x = (i) => m.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v) => m.t + ih - (v / top) * ih;
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.y).toFixed(1)}`).join('');
    const areaD = `${line}L${x(n - 1).toFixed(1)} ${y(0)}L${x(0).toFixed(1)} ${y(0)}Z`;
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 78))));
    const xLabels = points.map((p, i) => (i % every === 0 || i === n - 1) && !(i !== n - 1 && n - 1 - i < every * 0.6)
      ? `<text x="${x(i)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}" class="ch-axis-text">${esc(xLabel(p))}</text>` : '').join('');
    const last = points[n - 1];
    const peakI = points.reduce((b, p, i) => (p.y > points[b].y ? i : b), 0);
    const peak = points[peakI];
    el.innerHTML = `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" tabindex="0" role="img" aria-label="${esc(label)} trend">
      ${tk.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'ch-base' : 'ch-grid'}"/>
        <text x="${m.l - 10}" y="${y(v) + 4}" text-anchor="end" class="ch-axis-text">${esc(yFormat(v))}</text>`).join('')}
      ${xLabels}
      ${area ? `<path d="${areaD}" class="ch-area"/>` : ''}
      <path d="${line}" class="ch-line"/>
      ${peak && peak.y > 0 && peakI !== n - 1 ? `<circle cx="${x(peakI)}" cy="${y(peak.y)}" r="4" class="ch-dot"/><text x="${Math.min(Math.max(x(peakI), m.l + 30), W - m.r - 30)}" y="${y(peak.y) - 12}" text-anchor="middle" class="ch-label">Peak ${esc(yFormat(peak.y))}</text>` : ''}
      ${last ? `<circle cx="${x(n - 1)}" cy="${y(last.y)}" r="4.5" class="ch-dot"/>` : ''}
      <line class="ch-cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" style="opacity:0"/>
      <circle class="ch-hover" r="5" cx="0" cy="0" style="opacity:0"/>
      <rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" class="ch-hit"/>
    </svg>`;
    const svg = el.querySelector('svg');
    const cross = svg.querySelector('.ch-cross');
    const dot = svg.querySelector('.ch-hover');
    let cur = -1;
    const show = (i, cx, cy) => {
      cur = Math.max(0, Math.min(n - 1, i));
      const p = points[cur];
      cross.setAttribute('x1', x(cur)); cross.setAttribute('x2', x(cur)); cross.style.opacity = 1;
      dot.setAttribute('cx', x(cur)); dot.setAttribute('cy', y(p.y)); dot.style.opacity = 1;
      const r = svg.getBoundingClientRect();
      const t = tooltip ? tooltip(p) : { head: xLabel(p), rows: [{ label, value: yFormat(p.y) }] };
      showTip(cx ?? r.left + x(cur), cy ?? r.top + y(p.y), t.head, t.rows);
    };
    const hide = () => { cross.style.opacity = 0; dot.style.opacity = 0; hideTip(); };
    svg.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = e.clientX - r.left;
      const i = n <= 1 ? 0 : Math.round(((px - m.l) / iw) * (n - 1));
      show(i, e.clientX, e.clientY);
    });
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show(cur < 0 ? n - 1 : cur + (e.key === 'ArrowRight' ? 1 : -1)); }
      if (e.key === 'Escape') hide();
    });
  };
  return responsive(el, draw);
}

// ---------------- Horizontal bars ----------------
export function barChart(el, { items, valueFormat = fmt.compact, tooltip, rowHeight = 44, labelWidth = 150 }) {
  const draw = (W) => {
    const m = { l: Math.min(labelWidth, W * 0.38), r: 70, t: 4, b: 4 };
    const H = items.length * rowHeight + m.t + m.b;
    const iw = Math.max(40, W - m.l - m.r);
    const max = Math.max(1, ...items.map((d) => d.value));
    const thick = 16;
    const emphasis = items.some((d) => d.highlight);
    const rows = items.map((d, i) => {
      const y0 = m.t + i * rowHeight;
      const cy = y0 + rowHeight / 2;
      const w = Math.max(d.value > 0 ? 3 : 0, (d.value / max) * iw);
      const r = Math.min(4, w);
      const path = w > 0 ? `M${m.l} ${cy - thick / 2}h${w - r}a${r} ${r} 0 0 1 ${r} ${r}v${thick - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - r)}Z` : '';
      const cls = emphasis && !d.highlight ? 'ch-bar muted' : 'ch-bar';
      return `<g class="ch-row" data-i="${i}" tabindex="0">
        <rect x="0" y="${y0}" width="${W}" height="${rowHeight}" fill="transparent"/>
        <text x="0" y="${cy - (d.sub ? 3 : -4)}" class="ch-cat">${esc(d.label)}</text>
        ${d.sub ? `<text x="0" y="${cy + 13}" class="ch-cat-sub">${esc(d.sub)}</text>` : ''}
        <rect x="${m.l}" y="${cy - thick / 2}" width="${iw}" height="${thick}" rx="4" class="ch-track"/>
        ${path ? `<path d="${path}" class="${cls}"/>` : ''}
        <text x="${m.l + w + 10}" y="${cy + 4.5}" class="ch-value">${esc(valueFormat(d.value))}</text>
      </g>`;
    }).join('');
    el.innerHTML = `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart">${rows}</svg>`;
    el.querySelectorAll('.ch-row').forEach((g) => {
      const d = items[Number(g.dataset.i)];
      const t = tooltip ? tooltip(d) : { head: d.label, rows: [{ label: 'Value', value: valueFormat(d.value) }] };
      g.addEventListener('pointermove', (e) => { g.classList.add('hover'); showTip(e.clientX, e.clientY, t.head, t.rows); });
      g.addEventListener('pointerleave', () => { g.classList.remove('hover'); hideTip(); });
      g.addEventListener('focus', () => { const r = g.getBoundingClientRect(); showTip(r.left + r.width / 2, r.top, t.head, t.rows); });
      g.addEventListener('blur', hideTip);
      if (d.onClick) { g.style.cursor = 'pointer'; g.addEventListener('click', d.onClick); }
    });
  };
  return responsive(el, draw);
}

// ---------------- Vertical columns (e.g. monthly) ----------------
export function columnChart(el, { items, height = 220, valueFormat = fmt.compact, tooltip }) {
  const draw = (W) => {
    const H = height;
    const m = { l: 48, r: 10, t: 24, b: 28 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const tk = ticks(Math.max(1, ...items.map((d) => d.value)));
    const top = tk[tk.length - 1];
    const band = iw / Math.max(1, items.length);
    const bw = Math.min(24, band * 0.56);
    const y = (v) => m.t + ih - (v / top) * ih;
    const maxI = items.reduce((b, d, i) => (d.value > items[b].value ? i : b), 0);
    el.innerHTML = `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Column chart">
      ${tk.map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'ch-base' : 'ch-grid'}"/>
        <text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" class="ch-axis-text">${esc(valueFormat(v))}</text>`).join('')}
      ${items.map((d, i) => {
    const cx = m.l + band * i + band / 2;
    const h = Math.max(d.value > 0 ? 2 : 0, (d.value / top) * ih);
    const r = Math.min(4, h);
    const x0 = cx - bw / 2;
    const yb = y(0);
    const path = h > 0 ? `M${x0} ${yb}v${-(h - r)}a${r} ${r} 0 0 1 ${r} ${-r}h${bw - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - r}Z` : '';
    return `<g class="ch-col" data-i="${i}" tabindex="0"><rect x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}" fill="transparent"/>
          ${path ? `<path d="${path}" class="ch-bar"/>` : ''}
          ${i === maxI && d.value > 0 ? `<text x="${cx}" y="${yb - h - 8}" text-anchor="middle" class="ch-label">${esc(valueFormat(d.value))}</text>` : ''}
          <text x="${cx}" y="${H - 8}" text-anchor="middle" class="ch-axis-text">${esc(d.label)}</text></g>`;
  }).join('')}
    </svg>`;
    el.querySelectorAll('.ch-col').forEach((g) => {
      const d = items[Number(g.dataset.i)];
      const t = tooltip ? tooltip(d) : { head: d.label, rows: [{ label: 'Value', value: valueFormat(d.value) }] };
      g.addEventListener('pointermove', (e) => { g.classList.add('hover'); showTip(e.clientX, e.clientY, t.head, t.rows); });
      g.addEventListener('pointerleave', () => { g.classList.remove('hover'); hideTip(); });
      g.addEventListener('focus', () => { const r = g.getBoundingClientRect(); showTip(r.left + r.width / 2, r.top, t.head, t.rows); });
      g.addEventListener('blur', hideTip);
    });
  };
  return responsive(el, draw);
}

// ---------------- Heatmap (weekday × hour) ----------------
export function heatmap(el, { cells, rowLabels, colLabels, format = (v) => `${v} transactions`, headFor }) {
  const draw = (W) => {
    const m = { l: 44, r: 4, t: 4, b: 22 };
    const cols = colLabels.length;
    const rows = rowLabels.length;
    const gap = 2;
    const cw = (W - m.l - m.r) / cols;
    const ch = Math.max(16, Math.min(30, cw * 0.9));
    const H = m.t + rows * ch + m.b;
    const max = Math.max(1, ...cells.flat());
    const step = (v) => (v <= 0 ? 0 : Math.min(7, 1 + Math.floor((v / max) * 6.999)));
    let s = '';
    for (let r = 0; r < rows; r++) {
      s += `<text x="${m.l - 8}" y="${m.t + r * ch + ch / 2 + 4}" text-anchor="end" class="ch-axis-text">${esc(rowLabels[r])}</text>`;
      for (let c = 0; c < cols; c++) {
        const v = cells[r][c];
        s += `<rect class="ch-cell" data-r="${r}" data-c="${c}" x="${(m.l + c * cw + gap / 2).toFixed(1)}" y="${(m.t + r * ch + gap / 2).toFixed(1)}" width="${(cw - gap).toFixed(1)}" height="${(ch - gap).toFixed(1)}" rx="3" style="fill:var(--heat-${step(v)})"/>`;
      }
    }
    for (let c = 0; c < cols; c += cw < 22 ? 3 : 2) s += `<text x="${m.l + c * cw + cw / 2}" y="${H - 6}" text-anchor="middle" class="ch-axis-text">${esc(colLabels[c])}</text>`;
    el.innerHTML = `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Activity heatmap">${s}</svg>
      <div class="heat-legend"><span>Fewer</span>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<i style="background:var(--heat-${i})"></i>`).join('')}<span>More</span></div>`;
    el.querySelectorAll('.ch-cell').forEach((cell) => {
      const r = Number(cell.dataset.r);
      const c = Number(cell.dataset.c);
      cell.addEventListener('pointermove', (e) => { cell.classList.add('hover'); showTip(e.clientX, e.clientY, headFor ? headFor(r, c) : `${rowLabels[r]} ${colLabels[c]}`, [{ label: 'Activity', value: format(cells[r][c]) }]); });
      cell.addEventListener('pointerleave', () => { cell.classList.remove('hover'); hideTip(); });
    });
  };
  return responsive(el, draw);
}

// ---------------- Sparkline (string) ----------------
export function sparkline(values, { w = 120, h = 34 } = {}) {
  const n = values.length;
  if (!n) return '';
  const max = Math.max(1, ...values);
  const x = (i) => (n === 1 ? w / 2 : 2 + (i / (n - 1)) * (w - 6));
  const y = (v) => h - 3 - (v / max) * (h - 8);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <path d="${d}" class="spark-line"/><circle cx="${x(n - 1)}" cy="${y(values[n - 1])}" r="3" class="spark-dot"/></svg>`;
}

// ---------------- Table twin ----------------
export function tableHtml(headers, rows) {
  return `<div class="table-wrap chart-table"><table class="table"><thead><tr>${headers.map((h) => `<th class="${h.r ? 'r' : ''}">${esc(h.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${headers.map((h, i) => `<td class="${h.r ? 'r' : ''}">${esc(r[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export { NS };
