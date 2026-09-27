import {
  api, apiUrl, store, html, ic, $, $$, on, fmt, toast, toastError, confirmDialog, statusChip, avatar, debounce, hashQuery, setHashQuery, download, modal,
} from '../core.js';
import { printReceipt } from '../print.js';

export const RANGES = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', '7 days'], ['30d', '30 days'], ['mtd', 'This month'], ['90d', '90 days'], ['custom', 'Custom']];

export function rangeControls(state) {
  return html`<div class="seg" data-range-seg>${RANGES.map(([k, l]) => html`<button data-range="${k}" class="${state.range === k ? 'on' : ''}">${l}</button>`)}</div>
    <span class="custom-range ${state.range === 'custom' ? '' : 'hidden'}" data-custom>
      <input class="input input-date" type="date" data-from value="${state.from || ''}" aria-label="From"><span class="muted">→</span>
      <input class="input input-date" type="date" data-to value="${state.to || ''}" aria-label="To"></span>`;
}
export function wireRange(root, state, onChange) {
  on(root, 'click', '[data-range]', (e, b) => {
    state.range = b.dataset.range;
    $$('[data-range-seg] button', root).forEach((x) => x.classList.toggle('on', x === b));
    const c = $('[data-custom]', root);
    c.classList.toggle('hidden', state.range !== 'custom');
    if (state.range === 'custom') {
      const today = new Date(Date.now() + store.clockOffset).toISOString().slice(0, 10);
      if (!state.from) { state.from = today.slice(0, 8) + '01'; $('[data-from]', root).value = state.from; }
      if (!state.to) { state.to = today; $('[data-to]', root).value = state.to; }
    }
    onChange();
  });
  on(root, 'change', '[data-from],[data-to]', () => {
    state.from = $('[data-from]', root).value;
    state.to = $('[data-to]', root).value;
    if (state.from && state.to) onChange();
  });
}

export default {
  title: 'Transactions',
  sub: 'Every Royal discount, with full audit trail',
  async render(root) {
    const q = hashQuery();
    const lockBranch = store.user.role !== 'admin' && store.user.branch_id;
    const state = { range: q.range || '7d', from: q.from || '', to: q.to || '', branch_id: lockBranch ? '' : (q.branch_id || ''), status: q.status || '', q: q.q || '', page: 1, limit: 30 };

    root.innerHTML = String(html`
    <div class="toolbar">
      ${rangeControls(state)}
      ${lockBranch ? '' : html`<select class="select select-inline" id="t-branch"><option value="">All branches</option>${store.branches.map((b) => html`<option value="${b.id}" ${String(b.id) === state.branch_id ? 'selected' : ''}>${b.code} · ${b.short_name}</option>`)}</select>`}
      <select class="select select-inline" id="t-status"><option value="">All statuses</option><option value="completed" ${state.status === 'completed' ? 'selected' : ''}>Completed</option><option value="void" ${state.status === 'void' ? 'selected' : ''}>Void</option></select>
      <div class="input-group">${ic('search')}<input class="input" id="t-q" placeholder="Receipt, invoice, member, card…" value="${state.q}" style="width:240px"></div>
      <span class="spacer"></span>
      <button class="btn btn-ghost" id="t-export" title="Export to Excel (CSV)">${ic('download')}<span class="lbl">Export CSV</span></button>
    </div>
    <section class="sum-strip" id="t-sum"></section>
    <section class="panel"><div id="t-table"><div class="page-loading"><span class="spinner"></span></div></div><div class="pager" id="t-pager"></div></section>`);

    const tableEl = $('#t-table', root);
    let last = null;

    const query = () => ({ range: state.range, from: state.range === 'custom' ? state.from : '', to: state.range === 'custom' ? state.to : '', branch_id: state.branch_id, status: state.status, q: state.q });

    async function load() {
      setHashQuery({ ...query(), range: state.range === '7d' ? '' : state.range });
      tableEl.classList.add('refetch');
      try {
        last = await api('/transactions', { query: { ...query(), page: state.page, limit: state.limit } });
        paint();
      } catch (err) { toastError(err); } finally { tableEl.classList.remove('refetch'); }
    }

    function paint() {
      const r = last;
      $('#t-sum', root).innerHTML = String(html`
        <div class="panel"><span>Transactions</span><b>${fmt.int(r.total)}</b><small>${fmt.date(r.range.from)} – ${fmt.date(r.range.to)}</small></div>
        <div class="panel"><span>Gross bills</span><b>${fmt.money(r.totals.gross)}</b><small>completed only</small></div>
        <div class="panel highlight"><span>Royal discount</span><b class="gold">${fmt.money(r.totals.discount)}</b><small>${r.totals.gross ? ((r.totals.discount / r.totals.gross) * 100).toFixed(1) : '0.0'}% of gross</small></div>
        <div class="panel"><span>Net collected</span><b>${fmt.money(r.totals.net)}</b><small>after discount</small></div>
        <div class="panel"><span>Voided</span><b>${fmt.int(r.totals.voided)}</b><small>reversed</small></div>`);
      if (!r.rows.length) {
        tableEl.innerHTML = String(html`<div class="empty">${ic('receipt')}<b>No transactions in this view</b><span>Change the date range or filters.</span></div>`);
        $('#t-pager', root).innerHTML = '';
        return;
      }
      tableEl.innerHTML = String(html`<div class="table-wrap"><table class="table">
        <thead><tr><th>Date & time</th><th>Receipt</th><th>Member</th><th>Branch</th><th class="r">Bill</th><th class="r">Discount</th><th class="r">Net</th></tr></thead>
        <tbody>${r.rows.map((t) => html`<tr class="clickable ${t.status === 'void' ? 'void' : ''}" data-id="${t.id}">
          <td>${fmt.dateTime(t.created_at)}</td>
          <td><div class="mono small">${t.txn_no}${t.status === 'void' ? html` <span class="chip chip-critical chip-xs">VOID</span>` : ''}</div>${t.pos_invoice ? html`<div class="cell-sub">${t.pos_invoice}</div>` : ''}</td>
          <td><div class="person">${avatar(t.member_name, t.tier_theme, 30)}<div><div class="cell-main">${t.member_name}</div><div class="cell-sub mono">${fmt.mask(t.card_number)}</div></div></div></td>
          <td><div>${t.branch_short}</div><div class="cell-sub">${t.cashier_name || (t.api_key_name ? '⚡ ' + t.api_key_name : '—')}</div></td>
          <td class="r">${fmt.money(t.bill_amount)}</td>
          <td class="r gold"><div class="strike">− ${fmt.amount(t.discount_amount)}</div><div class="cell-sub">${t.discount_pct}%</div></td>
          <td class="r"><b>${fmt.money(t.net_amount)}</b></td></tr>`)}</tbody></table></div>`);
      const pages = Math.max(1, Math.ceil(r.total / r.limit));
      $('#t-pager', root).innerHTML = String(html`<span class="muted">Page ${r.page} of ${pages}</span><span class="spacer"></span>
        <button class="btn btn-ghost btn-sm" data-page="${r.page - 1}" ${r.page <= 1 ? 'disabled' : ''}>${ic('chevron-left', 'i-sm')}Prev</button>
        <button class="btn btn-ghost btn-sm" data-page="${r.page + 1}" ${r.page >= pages ? 'disabled' : ''}>Next${ic('chevron-right', 'i-sm')}</button>`);
    }

    function openTxn(t) {
      const m = modal({
        title: t.txn_no,
        sub: `${fmt.date(t.created_at)} at ${fmt.time(t.created_at)} · ${t.branch_name}`,
        body: html`<div class="txn-detail">
          <div class="txn-amounts">
            <div><span>Bill</span><b>${fmt.money(t.bill_amount)}</b></div>
            <div class="gold"><span>Royal discount ${t.discount_pct}%</span><b>− ${fmt.money(t.discount_amount)}</b></div>
            <div class="net"><span>Net payable</span><b>${fmt.money(t.net_amount)}</b></div>
          </div>
          <div class="kv">
            <div><span>Member</span><b><a href="#/members/${t.member_id}">${t.member_name}</a> · ${t.member_code}</b></div>
            <div><span>Card</span><b class="mono">${fmt.card(t.card_number)} · ${t.tier_name || ''}</b></div>
            <div><span>Processed by</span><b>${t.cashier_name || t.api_key_name || '—'}</b></div>
            <div><span>POS invoice</span><b>${t.pos_invoice || '—'}</b></div>
            <div><span>Status</span><b>${statusChip(t.status)}</b></div>
            ${t.status === 'void' ? html`<div><span>Voided</span><b>${fmt.dateTime(t.voided_at)} by ${t.voided_by_name || '—'} — ${t.void_reason}</b></div>` : ''}
          </div></div>`,
        foot: html`${t.status !== 'void' ? html`<button class="btn btn-danger" data-void>${ic('ban')}Void</button>` : ''}<span class="spacer"></span>
          <button class="btn btn-ghost" data-close>Close</button><button class="btn btn-primary" data-print>${ic('printer')}Print slip</button>`,
      });
      m.$('[data-print]').addEventListener('click', () => printReceipt(t));
      m.$('[data-void]')?.addEventListener('click', async () => {
        const reason = await confirmDialog({ title: `Void ${t.txn_no}?`, danger: true, text: 'The discount will be reversed in all totals and reports. This is recorded in the audit log.',
          confirmText: 'Void transaction', input: { label: 'Reason', placeholder: 'e.g. Wrong amount entered', required: true, min: 3 } });
        if (!reason) return;
        try {
          await api(`/transactions/${t.id}/void`, { method: 'POST', body: { reason } });
          m.close();
          toast('Transaction voided', t.txn_no, 'info');
          load();
        } catch (err) { toastError(err); }
      });
    }

    on(tableEl, 'click', 'tr[data-id]', (e, tr) => { const t = last.rows.find((x) => x.id === Number(tr.dataset.id)); if (t) openTxn(t); });
    on($('#t-pager', root), 'click', '[data-page]', (e, b) => { state.page = Number(b.dataset.page); load(); });
    wireRange(root, state, () => { state.page = 1; load(); });
    $('#t-branch', root)?.addEventListener('change', (e) => { state.branch_id = e.target.value; state.page = 1; load(); });
    $('#t-status', root).addEventListener('change', (e) => { state.status = e.target.value; state.page = 1; load(); });
    $('#t-q', root).addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); state.page = 1; load(); }, 280));
    $('#t-export', root).addEventListener('click', () => { download(apiUrl('/transactions/export.csv', query())); toast('Export started', 'CSV opens in Excel', 'good'); });
    const onTxn = debounce(() => { if (state.page === 1) load(); }, 1200);
    window.addEventListener('rl:txn', onTxn);
    await load();
    return () => window.removeEventListener('rl:txn', onTxn);
  },
};
