import {
  api, store, html, raw, ic, $, $$, on, fmt, toastError, countUp, deltaHtml, avatar, tierChip, debounce, hashQuery, setHashQuery, qatarNow, toast,
} from '../core.js';
import { lineChart, barChart, heatmap, sparkline, tableHtml } from '../charts.js';

const RANGES = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['mtd', 'This month'], ['ytd', 'This year']];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6);
const hLabel = (h) => `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`;
const INSIGHT_ICON = { 'trend-up': 'trend-up', 'trend-down': 'trend-down', clock: 'clock', store: 'store', crown: 'crown', alert: 'alert', moon: 'moon-star', printer: 'printer' };

function greeting() {
  const h = qatarNow().getUTCHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default {
  title: 'Dashboard',
  sub: 'Royal Loyalty performance across all branches',
  async render(root) {
    const q = hashQuery();
    const state = { range: RANGES.some(([k]) => k === q.range) ? q.range : '30d', branch: q.branch || '', metric: 'gross', table: {} };
    const lockBranch = store.user.role !== 'admin' && store.user.branch_id;
    if (lockBranch) state.branch = String(store.user.branch_id);
    const cleanups = [];
    let data = null;

    root.innerHTML = String(html`
    <div class="dash">
      <div class="dash-top">
        <div>
          <div class="hello-kicker">${greeting()}, ${store.user.full_name.split(' ')[0]}</div>
          <h2 class="hello-title display">The Royal Court at a glance</h2>
        </div>
        <div class="filters">
          <div class="seg" id="range-seg" role="tablist">${RANGES.map(([k, l]) => html`<button data-range="${k}" class="${state.range === k ? 'on' : ''}">${l}</button>`)}</div>
          ${lockBranch ? '' : html`<select class="select select-inline" id="branch-sel" aria-label="Branch">
            <option value="">All 5 branches</option>${store.branches.map((b) => html`<option value="${b.id}" ${String(b.id) === state.branch ? 'selected' : ''}>${b.code} · ${b.short_name}</option>`)}</select>`}
          <button class="btn btn-ghost btn-icon" id="refresh" aria-label="Refresh">${ic('refresh')}</button>
        </div>
      </div>
      <div id="dash-body" class="dash-body"><div class="page-loading"><span class="spinner"></span></div></div>
    </div>`);

    const body = $('#dash-body', root);

    async function load({ quiet = false } = {}) {
      body.classList.add('refetch');
      try {
        const r = await api('/stats/overview', { query: { range: state.range, branch_id: state.branch } });
        const first = !data;
        data = r;
        paint(first && !quiet);
      } catch (err) {
        toastError(err);
      } finally {
        body.classList.remove('refetch');
      }
    }

    function rangeLabel() {
      const r = data.range;
      if (r.preset === 'today') return 'today';
      return RANGES.find(([k]) => k === r.preset)?.[1].toLowerCase() || `${fmt.date(r.from)} – ${fmt.date(r.to)}`;
    }

    function paint(animate) {
      cleanups.splice(0).forEach((f) => f());
      const d = data;
      const cur = d.current;
      const prev = d.previous;
      const branchName = state.branch ? store.branch(state.branch)?.name : 'All 5 branches';
      body.innerHTML = String(html`
      <section class="hero panel glow">
        <div class="hero-main">
          <div class="hero-label">${ic('crown', 'i-sm')} Royal member spend · ${rangeLabel()} · ${branchName}</div>
          <div class="hero-value"><span class="cur">${store.currency}</span><span id="hero-num">${fmt.amount(cur.gross)}</span></div>
          <div class="hero-sub">${deltaHtml(cur.gross, prev.gross)}<span class="muted">vs previous ${d.range.days} day${d.range.days > 1 ? 's' : ''}</span>
            <span class="dot-sep"></span><span><b class="gold">${fmt.money(cur.discount)}</b> returned to members as Royal discount</span></div>
        </div>
        <div class="hero-side">
          <div><span>Royal members</span><b id="m-total">${fmt.int(d.members.total)}</b><small>${d.members.new_in_range} new this period</small></div>
          <div><span>Active cards</span><b>${fmt.int(d.members.active_cards)}</b><small>${d.members.expiring_30d} expiring in 30 days</small></div>
          <div><span>Net collected</span><b>${fmt.moneyCompact(cur.net)}</b><small>after discounts</small></div>
        </div>
      </section>

      <section class="kpis">
        ${[
    { k: 'txns', label: 'Royal transactions', val: fmt.int(cur.txns), cur: cur.txns, prev: prev.txns, sp: 'txns', icon: 'receipt' },
    { k: 'discount', label: 'Discount given', val: fmt.money(cur.discount), cur: cur.discount, prev: prev.discount, sp: 'discount', icon: 'percent', neutral: true },
    { k: 'avg', label: 'Average basket', val: fmt.money(cur.avg_basket), cur: cur.avg_basket, prev: prev.avg_basket, sp: 'gross', icon: 'bag' },
    { k: 'members', label: 'Members who shopped', val: fmt.int(cur.active_members), cur: cur.active_members, prev: prev.active_members, sp: 'txns', icon: 'users' },
  ].map((t) => html`<div class="kpi panel">
          <div class="kpi-top"><span class="kpi-label">${t.label}</span><span class="kpi-ic">${ic(t.icon, 'i-sm')}</span></div>
          <div class="kpi-value">${t.val}</div>
          <div class="kpi-foot">${deltaHtml(t.cur, t.prev)}<span class="muted small">vs prev.</span><span class="spacer"></span>${raw(sparkline(d.daily.map((x) => x[t.sp]).slice(-30)))}</div>
        </div>`)}
      </section>

      <section class="dash-grid g-2-1">
        <div class="panel">
          <div class="panel-head">
            <div><div class="panel-title">${ic('activity')}Daily Royal ${state.metric === 'gross' ? 'spend' : state.metric === 'discount' ? 'discounts' : 'transactions'}</div>
              <div class="panel-sub">${fmt.date(d.range.from)} – ${fmt.date(d.range.to)} · hover for the day's detail</div></div>
            <div class="row"><div class="seg seg-sm" id="metric-seg">
              ${[['gross', 'Spend'], ['discount', 'Discount'], ['txns', 'Transactions']].map(([k, l]) => html`<button data-metric="${k}" class="${state.metric === k ? 'on' : ''}">${l}</button>`)}</div>
              <button class="btn btn-ghost btn-sm" data-table="trend">${ic('list', 'i-sm')}Table</button></div>
          </div>
          <div class="panel-body"><div id="trend" class="chart-box" style="min-height:280px"></div></div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><div class="panel-title">${ic('cards')}Membership</div><div class="panel-sub">Current cards by tier</div></div>
            <a class="btn btn-ghost btn-sm" href="#/members">View all</a></div>
          <div class="panel-body">
            <div class="tier-list">${d.tiers.map((t) => {
    const share = d.members.active_cards ? (t.cards / d.members.active_cards) * 100 : 0;
    return html`<div class="tier-row">
                <div class="row">${tierChip(t.name, t.theme)}<span class="muted small">${t.discount_pct}% off</span><span class="spacer"></span><b class="tnum">${fmt.int(t.cards)}</b></div>
                <div class="meter"><span class="${t.theme}" style="width:${share.toFixed(1)}%"></span></div></div>`;
  })}</div>
            <div class="mini-stats">
              <a href="#/members?status=expiring"><span>${ic('clock', 'i-sm')}Expiring ≤ 30 days</span><b>${d.members.expiring_30d}</b></a>
              <a href="#/members?status=dormant"><span>${ic('moon-star', 'i-sm')}Inactive 30 days</span><b>${d.members.dormant_30d}</b></a>
              <a href="#/studio"><span>${ic('printer', 'i-sm')}Cards to print</span><b>${d.members.unprinted}</b></a>
            </div>
          </div>
        </div>
      </section>

      <section class="dash-grid g-1-1">
        <div class="panel">
          <div class="panel-head"><div><div class="panel-title">${ic(state.branch ? 'users' : 'store')}${state.branch ? 'Cashier performance' : 'Branch performance'}</div>
            <div class="panel-sub">${state.branch ? 'Royal spend processed per cashier' : 'Royal member spend by branch · click a bar to focus'}</div></div>
            <button class="btn btn-ghost btn-sm" data-table="branches">${ic('list', 'i-sm')}Table</button></div>
          <div class="panel-body"><div id="branches" class="chart-box"></div></div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><div class="panel-title">${ic('clock')}Peak hours</div><div class="panel-sub">When Royal members shop (Qatar time)</div></div>
            <button class="btn btn-ghost btn-sm" data-table="heat">${ic('list', 'i-sm')}Table</button></div>
          <div class="panel-body"><div id="heat" class="chart-box"></div></div>
        </div>
      </section>

      <section class="dash-grid g-3">
        <div class="panel">
          <div class="panel-head"><div><div class="panel-title"><span class="live-dot"></span>Live feed</div><div class="panel-sub">Discounts as they happen at every counter</div></div>
            <a class="btn btn-ghost btn-sm" href="#/transactions">All</a></div>
          <div class="panel-body feed" id="feed">${d.recent.map(feedItem)}</div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><div class="panel-title">${ic('award')}Top Royal members</div><div class="panel-sub">By spend in this period</div></div></div>
          <div class="panel-body leaders">${d.top.length ? d.top.map((m, i) => html`<a class="leader" href="#/members/${m.id}">
              <span class="rank r${i + 1}">${i === 0 ? ic('crown', 'i-sm') : i + 1}</span>
              ${avatar(m.full_name, m.tier_theme, 34)}
              <span class="grow"><b class="ellipsis">${m.full_name}</b><small>${m.txns} visits · saved ${fmt.money(m.saved)}</small></span>
              <b class="tnum">${fmt.moneyCompact(m.gross)}</b></a>`) : html`<div class="empty">${ic('users')}No purchases in this period</div>`}</div>
        </div>
        <div class="panel">
          <div class="panel-head"><div><div class="panel-title">${ic('sparkles')}Smart insights</div><div class="panel-sub">Generated from your live data</div></div></div>
          <div class="panel-body insights">${d.insights.length ? d.insights.map((x) => html`<div class="insight ${x.tone}">
              <span class="insight-ic">${ic(INSIGHT_ICON[x.icon] || 'info', 'i-sm')}</span><div><b>${x.title}</b><p>${x.text}</p></div></div>`)
    : html`<div class="empty">${ic('sparkles')}Insights appear once transactions come in.</div>`}</div>
        </div>
      </section>`);

      if (animate) countUp($('#hero-num', body), cur.gross, { from: 0, dur: 1300, format: fmt.amount });
      drawTrend();
      drawBranches();
      drawHeat();
      $$('[data-table]', body).forEach((b) => b.addEventListener('click', () => toggleTable(b.dataset.table, b)));
      on($('#metric-seg', body), 'click', '[data-metric]', (e, b) => {
        state.metric = b.dataset.metric;
        $$('#metric-seg button', body).forEach((x) => x.classList.toggle('on', x === b));
        $('.g-2-1 .panel-title', body).lastChild.textContent = `Daily Royal ${state.metric === 'gross' ? 'spend' : state.metric === 'discount' ? 'discounts' : 'transactions'}`;
        state.table.trend = false;
        drawTrend();
      });
    }

    function drawTrend() {
      const el = $('#trend', body);
      const m = state.metric;
      const fmtY = m === 'txns' ? fmt.compact : (v) => fmt.compact(v);
      if (state.table.trend) {
        el.innerHTML = tableHtml([{ label: 'Date' }, { label: 'Transactions', r: 1 }, { label: 'Spend', r: 1 }, { label: 'Discount', r: 1 }],
          data.daily.slice().reverse().map((p) => [fmt.date(p.date), fmt.int(p.txns), fmt.money(p.gross), fmt.money(p.discount)]));
        return;
      }
      if (data.daily.length === 1) {
        const p = data.daily[0];
        el.innerHTML = String(html`<div class="today-split"><div><span>Transactions</span><b>${fmt.int(p.txns)}</b></div><div><span>Spend</span><b>${fmt.money(p.gross)}</b></div><div><span>Discount</span><b>${fmt.money(p.discount)}</b></div></div>`);
        return;
      }
      cleanups.push(lineChart(el, {
        points: data.daily.map((p) => ({ x: p.date, y: p[m], p })),
        label: m === 'gross' ? 'Spend' : m === 'discount' ? 'Discount' : 'Transactions',
        yFormat: fmtY,
        tooltip: (pt) => ({
          head: `${fmt.dayName(pt.x)}, ${fmt.date(pt.x)}`,
          rows: [
            { label: 'Royal spend', value: fmt.money(pt.p.gross), key: m === 'gross' ? 'var(--series-1)' : '' },
            { label: 'Discount given', value: fmt.money(pt.p.discount), key: m === 'discount' ? 'var(--series-1)' : '' },
            { label: 'Transactions', value: fmt.int(pt.p.txns), key: m === 'txns' ? 'var(--series-1)' : '' },
          ],
        }),
      }));
    }

    function drawBranches() {
      const el = $('#branches', body);
      if (state.branch) {
        const rows = data.cashiers;
        if (state.table.branches) { el.innerHTML = tableHtml([{ label: 'Cashier' }, { label: 'Txns', r: 1 }, { label: 'Spend', r: 1 }, { label: 'Discount', r: 1 }], rows.map((c) => [c.name, fmt.int(c.txns), fmt.money(c.gross), fmt.money(c.discount)])); return; }
        if (!rows.length) { el.innerHTML = String(html`<div class="empty">${ic('users')}No transactions in this period</div>`); return; }
        cleanups.push(barChart(el, {
          items: rows.map((c) => ({ label: c.name, sub: `${c.txns} transactions`, value: c.gross, c })),
          valueFormat: fmt.compact,
          tooltip: (x) => ({ head: x.label, rows: [{ label: 'Royal spend', value: fmt.money(x.c.gross) }, { label: 'Discount', value: fmt.money(x.c.discount) }, { label: 'Transactions', value: fmt.int(x.c.txns) }] }),
        }));
        return;
      }
      const total = data.branches.reduce((s, b) => s + b.gross, 0) || 1;
      if (state.table.branches) {
        el.innerHTML = tableHtml([{ label: 'Branch' }, { label: 'Txns', r: 1 }, { label: 'Members', r: 1 }, { label: 'Spend', r: 1 }, { label: 'Discount', r: 1 }, { label: 'Share', r: 1 }],
          data.branches.map((b) => [`${b.code} · ${b.short_name}`, fmt.int(b.txns), fmt.int(b.members), fmt.money(b.gross), fmt.money(b.discount), `${((b.gross / total) * 100).toFixed(1)}%`]));
        return;
      }
      cleanups.push(barChart(el, {
        items: data.branches.map((b) => ({
          label: b.short_name, sub: `${b.brand === 'madina' ? 'Al Madina' : 'Welcome Friends'} · ${((b.gross / total) * 100).toFixed(0)}%`, value: b.gross, b,
          onClick: () => { if (!lockBranch) { state.branch = String(b.id); $('#branch-sel', root).value = state.branch; sync(); } },
        })),
        valueFormat: fmt.compact,
        tooltip: (x) => ({ head: x.b.name, rows: [{ label: 'Royal spend', value: fmt.money(x.b.gross) }, { label: 'Discount', value: fmt.money(x.b.discount) }, { label: 'Transactions', value: fmt.int(x.b.txns) }, { label: 'Members', value: fmt.int(x.b.members) }] }),
      }));
    }

    function drawHeat() {
      const el = $('#heat', body);
      const grid = DAY.map(() => HOURS.map(() => 0));
      for (const c of data.heat) { const hi = HOURS.indexOf(c.hr); if (hi >= 0) grid[c.dow][hi] = c.n; }
      if (state.table.heat) {
        el.innerHTML = tableHtml([{ label: 'Day' }, ...HOURS.map((h) => ({ label: hLabel(h), r: 1 }))], DAY.map((dn, r) => [dn, ...grid[r].map(String)]));
        return;
      }
      cleanups.push(heatmap(el, {
        cells: grid, rowLabels: DAY, colLabels: HOURS.map(hLabel),
        format: (v) => `${v} transaction${v === 1 ? '' : 's'}`,
        headFor: (r, c) => `${DAY[r]} · ${hLabel(HOURS[c])}–${hLabel((HOURS[c] + 1) % 24)}`,
      }));
    }

    function toggleTable(key, btn) {
      state.table[key] = !state.table[key];
      btn.innerHTML = String(html`${ic(state.table[key] ? 'chart' : 'list', 'i-sm')}${state.table[key] ? 'Chart' : 'Table'}`);
      if (key === 'trend') drawTrend();
      if (key === 'branches') drawBranches();
      if (key === 'heat') drawHeat();
    }

    function feedItem(t) {
      return html`<div class="feed-item ${t.status === 'void' ? 'void' : ''}" data-id="${t.id}">
        ${avatar(t.member_name, t.tier_theme, 34)}
        <div class="grow"><b class="ellipsis">${t.member_name}</b><small>${t.branch_short} · ${fmt.rel(t.created_at)}${t.status === 'void' ? ' · VOID' : ''}</small></div>
        <div class="feed-amt"><b>− ${fmt.money(t.discount_amount)}</b><small>on ${fmt.money(t.bill_amount)}</small></div></div>`;
    }

    function sync() {
      setHashQuery({ range: state.range, branch: lockBranch ? '' : state.branch });
      data = null;
      body.innerHTML = '<div class="page-loading"><span class="spinner"></span></div>';
      load();
    }

    on($('#range-seg', root), 'click', '[data-range]', (e, b) => {
      state.range = b.dataset.range;
      $$('#range-seg button', root).forEach((x) => x.classList.toggle('on', x === b));
      sync();
    });
    $('#branch-sel', root)?.addEventListener('change', (e) => { state.branch = e.target.value; sync(); });
    $('#refresh', root).addEventListener('click', () => load({ quiet: true }));

    const refreshSoon = debounce(() => load({ quiet: true }), 1500);
    const onTxn = (e) => {
      const { txn, type } = e.detail || {};
      if (!txn) return;
      if (state.branch && String(txn.branch_id) !== state.branch) return;
      if (type === 'created') {
        const feed = $('#feed', body);
        if (feed) {
          const wrap = document.createElement('div');
          wrap.innerHTML = String(feedItem(txn));
          const item = wrap.firstElementChild;
          item.classList.add('fresh');
          feed.prepend(item);
          while (feed.children.length > 12) feed.lastElementChild.remove();
        }
        toast(`${txn.member_name} saved ${fmt.money(txn.discount_amount)}`, `${txn.branch_name} · bill ${fmt.money(txn.bill_amount)}`, 'gold', 3500);
      }
      refreshSoon();
    };
    window.addEventListener('rl:txn', onTxn);
    await load();

    return () => {
      cleanups.forEach((f) => f());
      window.removeEventListener('rl:txn', onTxn);
    };
  },
};
