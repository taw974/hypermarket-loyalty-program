import { api, apiUrl, store, html, ic, $, $$, on, fmt, toast, toastError, hashQuery, setHashQuery, download } from '../core.js';
import { barChart, columnChart, lineChart } from '../charts.js';
import { printReport } from '../print.js';
import { rangeControls, wireRange } from './transactions.js';

const GROUPS = [['branch', 'Branch', 'store'], ['day', 'Day', 'calendar'], ['month', 'Month', 'calendar'], ['weekday', 'Weekday', 'clock'], ['hour', 'Hour', 'clock'], ['cashier', 'Cashier', 'user'], ['tier', 'Tier', 'crown'], ['member', 'Top members', 'award']];

export default {
  title: 'Reports',
  sub: 'Slice Royal performance any way you need — export or print',
  async render(root) {
    const q = hashQuery();
    const lockBranch = store.user.role !== 'admin' && store.user.branch_id;
    const state = { range: q.range || '30d', from: q.from || '', to: q.to || '', branch_id: lockBranch ? '' : (q.branch_id || ''), group: q.group || 'branch', metric: 'gross' };
    let rep = null;
    let cleanup = null;

    root.innerHTML = String(html`
    <div class="toolbar">
      ${rangeControls(state)}
      ${lockBranch ? '' : html`<select class="select select-inline" id="r-branch"><option value="">All branches</option>${store.branches.map((b) => html`<option value="${b.id}" ${String(b.id) === state.branch_id ? 'selected' : ''}>${b.code} · ${b.short_name}</option>`)}</select>`}
      <span class="spacer"></span>
      <button class="btn btn-ghost" id="r-csv">${ic('download')}Export CSV</button>
      <button class="btn btn-outline" id="r-print">${ic('printer')}Print report</button>
    </div>
    <div class="group-tabs" id="r-groups">${GROUPS.map(([k, l, i]) => html`<button data-group="${k}" class="${state.group === k ? 'on' : ''}">${ic(i, 'i-sm')}${l}</button>`)}</div>
    <section class="sum-strip" id="r-sum"></section>
    <section class="panel">
      <div class="panel-head"><div><div class="panel-title" id="r-title">${ic('chart')}Report</div><div class="panel-sub" id="r-sub"></div></div>
        <div class="seg seg-sm" id="r-metric"><button data-metric="gross" class="on">Spend</button><button data-metric="discount">Discount</button><button data-metric="txns">Transactions</button></div></div>
      <div class="panel-body"><div id="r-chart" class="chart-box"></div></div>
    </section>
    <section class="panel"><div id="r-table"></div></section>`);

    const query = () => ({ range: state.range, from: state.range === 'custom' ? state.from : '', to: state.range === 'custom' ? state.to : '', branch_id: state.branch_id, group: state.group });

    async function load() {
      setHashQuery(query());
      root.classList.add('refetch-soft');
      try {
        rep = await api('/reports', { query: query() });
        paint();
      } catch (err) { toastError(err); } finally { root.classList.remove('refetch-soft'); }
    }

    const groupLabel = () => GROUPS.find(([k]) => k === state.group)[1];
    const scopeLabel = () => (rep.branch ? `${rep.branch.code} · ${rep.branch.name}` : 'All branches');

    function paint() {
      const t = rep.totals;
      $('#r-sum', root).innerHTML = String(html`
        <div class="panel"><span>Transactions</span><b>${fmt.int(t.txns)}</b><small>${fmt.date(rep.range.from)} – ${fmt.date(rep.range.to)}</small></div>
        <div class="panel"><span>Members served</span><b>${fmt.int(t.active_members)}</b><small>unique card holders</small></div>
        <div class="panel"><span>Gross spend</span><b>${fmt.money(t.gross)}</b><small>avg ${fmt.money(t.avg_basket)}</small></div>
        <div class="panel highlight"><span>Royal discount</span><b class="gold">${fmt.money(t.discount)}</b><small>${t.gross ? ((t.discount / t.gross) * 100).toFixed(1) : '0.0'}% effective</small></div>
        <div class="panel"><span>Net collected</span><b>${fmt.money(t.net)}</b><small>${rep.voids.count} voids (${fmt.money(rep.voids.amount)})</small></div>`);
      $('#r-title', root).innerHTML = String(html`${ic('chart')}By ${groupLabel().toLowerCase()}`);
      $('#r-sub', root).textContent = `${scopeLabel()} · ${fmt.date(rep.range.from)} – ${fmt.date(rep.range.to)}`;
      drawChart();
      const heads = [rep.group_label, 'Transactions', 'Members', 'Gross', 'Discount', 'Net', 'Avg basket'];
      $('#r-table', root).innerHTML = rep.rows.length ? String(html`<div class="table-wrap"><table class="table">
        <thead><tr>${heads.map((h, i) => html`<th class="${i ? 'r' : ''}">${h}</th>`)}</tr></thead>
        <tbody>${rep.rows.map((r) => html`<tr><td class="cell-main">${r.group}</td><td class="r">${fmt.int(r.txns)}</td><td class="r">${fmt.int(r.members)}</td>
          <td class="r">${fmt.money(r.gross)}</td><td class="r gold">${fmt.money(r.discount)}</td><td class="r">${fmt.money(r.net)}</td><td class="r">${fmt.money(r.avg_basket)}</td></tr>`)}</tbody>
        <tfoot><tr><td>Total</td><td class="r">${fmt.int(t.txns)}</td><td class="r">${fmt.int(t.active_members)}</td><td class="r">${fmt.money(t.gross)}</td>
          <td class="r">${fmt.money(t.discount)}</td><td class="r">${fmt.money(t.net)}</td><td class="r">${fmt.money(t.avg_basket)}</td></tr></tfoot></table></div>`)
        : String(html`<div class="empty">${ic('chart')}No data for this selection</div>`);
    }

    function drawChart() {
      if (cleanup) { cleanup(); cleanup = null; }
      const el = $('#r-chart', root);
      const key = state.metric;
      const fmtV = key === 'txns' ? fmt.int : fmt.compact;
      const rows = rep.rows;
      if (!rows.length) { el.innerHTML = String(html`<div class="empty">${ic('chart')}Nothing to chart</div>`); return; }
      const tip = (r) => ({ head: String(r.group), rows: [{ label: 'Spend', value: fmt.money(r.gross) }, { label: 'Discount', value: fmt.money(r.discount) }, { label: 'Transactions', value: fmt.int(r.txns) }, { label: 'Members', value: fmt.int(r.members) }] });
      if (state.group === 'day' && rows.length > 1) {
        cleanup = lineChart(el, { points: rows.map((r) => ({ x: r.group, y: r[key], r })), yFormat: fmtV, label: key, tooltip: (p) => ({ ...tip(p.r), head: `${fmt.dayName(p.x)}, ${fmt.date(p.x)}` }) });
      } else if (['month', 'weekday', 'hour', 'day'].includes(state.group)) {
        cleanup = columnChart(el, {
          items: rows.map((r) => ({ label: state.group === 'month' ? fmt.monthName(r.group) : state.group === 'weekday' ? r.group.slice(0, 3) : state.group === 'hour' ? r.group.slice(0, 2) : fmt.dateShort(r.group), value: r[key], r })),
          valueFormat: fmtV, tooltip: (x) => tip(x.r), height: 260,
        });
      } else {
        const list = rows.slice(0, 12);
        cleanup = barChart(el, { items: list.map((r) => ({ label: String(r.group).replace(/ \(RM-\d+\)$/, ''), sub: `${fmt.int(r.txns)} txns · ${fmt.money(r.discount)} discount`, value: r[key], r })), valueFormat: fmtV, tooltip: (x) => tip(x.r), labelWidth: 190 });
      }
    }

    on($('#r-groups', root), 'click', '[data-group]', (e, b) => {
      state.group = b.dataset.group;
      $$('#r-groups button', root).forEach((x) => x.classList.toggle('on', x === b));
      load();
    });
    on($('#r-metric', root), 'click', '[data-metric]', (e, b) => {
      state.metric = b.dataset.metric;
      $$('#r-metric button', root).forEach((x) => x.classList.toggle('on', x === b));
      drawChart();
    });
    wireRange(root, state, load);
    $('#r-branch', root)?.addEventListener('change', (e) => { state.branch_id = e.target.value; load(); });
    $('#r-csv', root).addEventListener('click', () => { download(apiUrl('/reports/export.csv', query())); toast('Export started', '', 'good'); });
    $('#r-print', root).addEventListener('click', () => {
      if (!rep) return;
      const t = rep.totals;
      printReport({
        title: `Royal Loyalty report — by ${groupLabel().toLowerCase()}`,
        subtitle: `${scopeLabel()} · ${fmt.date(rep.range.from)} to ${fmt.date(rep.range.to)}`,
        summary: [{ label: 'Transactions', value: fmt.int(t.txns) }, { label: 'Gross spend', value: fmt.money(t.gross) }, { label: 'Royal discount', value: fmt.money(t.discount) }, { label: 'Net collected', value: fmt.money(t.net) }],
        headers: [{ label: rep.group_label }, { label: 'Txns', r: 1 }, { label: 'Members', r: 1 }, { label: 'Gross', r: 1 }, { label: 'Discount', r: 1 }, { label: 'Net', r: 1 }, { label: 'Avg', r: 1 }],
        rows: rep.rows.map((r) => [r.group, fmt.int(r.txns), fmt.int(r.members), fmt.amount(r.gross), fmt.amount(r.discount), fmt.amount(r.net), fmt.amount(r.avg_basket)]),
        footRow: ['Total', fmt.int(t.txns), fmt.int(t.active_members), fmt.amount(t.gross), fmt.amount(t.discount), fmt.amount(t.net), fmt.amount(t.avg_basket)],
      });
    });
    await load();
    return () => { if (cleanup) cleanup(); };
  },
};
