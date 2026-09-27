import {
  api, apiUrl, store, html, ic, $, $$, on, fmt, toast, toastError, modal, debounce, statusChip, tierChip, avatar, hashQuery, setHashQuery, download, withBusy,
} from '../core.js';
import { openMemberForm } from './member-form.js';

const STATUSES = [['', 'All'], ['active', 'Active'], ['expiring', 'Expiring'], ['expired', 'Expired'], ['inactive', 'Blocked / lost'], ['unprinted', 'Not printed'], ['dormant', 'Inactive 30d']];
const SORTS = [['recent', 'Newest first'], ['name', 'Name A–Z'], ['spend', 'Top spenders'], ['visits', 'Most visits'], ['saved', 'Most saved'], ['last_visit', 'Recently seen'], ['expiry', 'Expiring soonest']];

export default {
  title: 'Members',
  sub: 'Every Royal card holder, their card and their savings',
  async render(root, { navigate }) {
    const q = hashQuery();
    const state = { q: q.q || '', status: q.status || '', tier_id: q.tier_id || '', branch_id: q.branch_id || '', sort: q.sort || 'recent', page: Number(q.page) || 1, limit: 25 };
    const staff = store.can('admin', 'manager');

    root.innerHTML = String(html`
    <div class="toolbar">
      <div class="input-group search-box">${ic('search')}<input class="input" id="m-q" placeholder="Search name, mobile, card no., member code, QID…" value="${state.q}" autocomplete="off"></div>
      <select class="select select-inline" id="m-tier"><option value="">All tiers</option>${store.tiers.map((t) => html`<option value="${t.id}" ${String(t.id) === state.tier_id ? 'selected' : ''}>${t.name}</option>`)}</select>
      <select class="select select-inline" id="m-branch"><option value="">All branches</option>${store.branches.map((b) => html`<option value="${b.id}" ${String(b.id) === state.branch_id ? 'selected' : ''}>${b.code} · ${b.short_name}</option>`)}</select>
      <span class="spacer"></span>
      ${staff ? html`<button class="btn btn-ghost" id="m-import" title="Import from Excel / CSV">${ic('upload')}<span class="lbl">Import</span></button><button class="btn btn-ghost" id="m-export" title="Export to Excel (CSV)">${ic('download')}<span class="lbl">Export</span></button>` : ''}
      <button class="btn btn-primary" id="m-new">${ic('user-plus')}New member</button>
    </div>
    <div class="chips-row" id="m-status">${STATUSES.map(([k, l]) => html`<button class="fchip ${state.status === k ? 'on' : ''}" data-status="${k}">${l}</button>`)}
      <span class="spacer"></span>
      <label class="sort-label">${ic('filter', 'i-sm')}<select class="select select-inline select-sm" id="m-sort">${SORTS.map(([k, l]) => html`<option value="${k}" ${k === state.sort ? 'selected' : ''}>${l}</option>`)}</select></label></div>
    <section class="panel">
      <div id="m-table"><div class="page-loading"><span class="spinner"></span></div></div>
      <div class="pager" id="m-pager"></div>
    </section>`);

    const tableEl = $('#m-table', root);
    let ctrl = null;

    async function load() {
      setHashQuery({ q: state.q, status: state.status, tier_id: state.tier_id, branch_id: state.branch_id, sort: state.sort === 'recent' ? '' : state.sort, page: state.page > 1 ? state.page : '' });
      ctrl?.abort();
      ctrl = new AbortController();
      tableEl.classList.add('refetch');
      try {
        const r = await api('/members', { query: { ...state }, signal: ctrl.signal });
        paint(r);
      } catch (err) {
        if (err.name !== 'AbortError') toastError(err);
      } finally {
        tableEl.classList.remove('refetch');
      }
    }

    function paint(r) {
      if (!r.rows.length) {
        tableEl.innerHTML = String(html`<div class="empty">${ic('users')}<b>No members found</b><span>Try another search or filter — or enroll a new Royal member.</span></div>`);
        $('#m-pager', root).innerHTML = '';
        return;
      }
      tableEl.innerHTML = String(html`<div class="table-wrap"><table class="table">
        <thead><tr><th>Member</th><th>Mobile</th><th>Card</th><th>Status</th><th class="r">Visits</th><th class="r">Spend</th><th class="r">Saved</th><th>Last visit</th></tr></thead>
        <tbody>${r.rows.map((m) => html`<tr class="clickable" data-id="${m.id}">
          <td><div class="person">${avatar(m.full_name, m.tier_theme)}<div><div class="cell-main">${m.full_name}</div><div class="cell-sub">${m.member_code}${m.home_branch ? ' · ' + m.home_branch : ''}</div></div></div></td>
          <td class="tnum">${fmt.phone(m.mobile)}</td>
          <td><div class="cell-main mono">${fmt.mask(m.card_number)}</div><div class="cell-sub">${tierChip(m.tier_name, m.tier_theme)}</div></td>
          <td>${statusChip(m.card_effective_status)}${m.printed_count === 0 && m.card_status === 'active' ? html`<div class="cell-sub gold">${ic('printer', 'i-sm')} not printed</div>` : ''}</td>
          <td class="r">${fmt.int(m.visits)}</td><td class="r">${fmt.money(m.spend)}</td><td class="r gold">${fmt.money(m.saved)}</td>
          <td>${m.last_visit ? fmt.rel(m.last_visit) : html`<span class="muted">—</span>`}</td></tr>`)}</tbody></table></div>`);
      const pages = Math.max(1, Math.ceil(r.total / r.limit));
      $('#m-pager', root).innerHTML = String(html`<span class="muted">${fmt.int(r.total)} member${r.total === 1 ? '' : 's'} · page ${r.page} of ${pages}</span><span class="spacer"></span>
        <button class="btn btn-ghost btn-sm" data-page="${r.page - 1}" ${r.page <= 1 ? 'disabled' : ''}>${ic('chevron-left', 'i-sm')}Prev</button>
        <button class="btn btn-ghost btn-sm" data-page="${r.page + 1}" ${r.page >= pages ? 'disabled' : ''}>Next${ic('chevron-right', 'i-sm')}</button>`);
    }

    on(tableEl, 'click', 'tr[data-id]', (e, tr) => navigate('/members/' + tr.dataset.id));
    on($('#m-pager', root), 'click', '[data-page]', (e, b) => { state.page = Number(b.dataset.page); load(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    on($('#m-status', root), 'click', '[data-status]', (e, b) => {
      state.status = b.dataset.status; state.page = 1;
      $$('#m-status .fchip', root).forEach((x) => x.classList.toggle('on', x === b));
      load();
    });
    const qInput = $('#m-q', root);
    qInput.addEventListener('input', debounce(() => { state.q = qInput.value.trim(); state.page = 1; load(); }, 250));
    for (const [id, key] of [['#m-tier', 'tier_id'], ['#m-branch', 'branch_id'], ['#m-sort', 'sort']]) {
      $(id, root).addEventListener('change', (e) => { state[key] = e.target.value; state.page = 1; load(); });
    }
    $('#m-new', root).addEventListener('click', () => openMemberForm({ onSaved: () => load() }));
    $('#m-export', root)?.addEventListener('click', () => {
      download(apiUrl('/members/export.csv', { q: state.q, status: state.status, tier_id: state.tier_id, branch_id: state.branch_id, sort: state.sort }));
      toast('Export started', 'CSV opens in Excel', 'good');
    });
    $('#m-import', root)?.addEventListener('click', () => importDialog(load));

    await load();
  },
};

// ---------------- CSV import ----------------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
const HEAD_MAP = { name: 'full_name', 'full name': 'full_name', full_name: 'full_name', mobile: 'mobile', phone: 'mobile', 'mobile number': 'mobile', email: 'email', qid: 'qid', 'qid number': 'qid', nationality: 'nationality', gender: 'gender', tier: 'tier', branch: 'branch', 'home branch': 'branch', notes: 'notes', 'birth date': 'birth_date', dob: 'birth_date' };

function importDialog(onDone) {
  const sample = 'Full Name,Mobile,Email,QID,Nationality,Tier,Branch\nMohammed Al-Kuwari,33445566,m.kuwari@example.com,28463400123,Qatar,Gold,BR-01\nRahim Uddin,55112233,,,Bangladesh,Gold,BR-04';
  const m = modal({
    title: 'Import members from Excel / CSV',
    sub: 'Save your Excel sheet as CSV. Each member gets a unique Royal card automatically.',
    size: 'wide',
    body: html`<div class="stack">
      <label class="dropzone" id="dz">${ic('upload', 'i-xl')}<b>Choose a CSV file</b><span class="muted">or drag & drop it here</span><input type="file" accept=".csv,.txt" hidden id="dz-file"></label>
      <div class="muted small">Columns (first row = headers): <b>Full Name, Mobile</b> (required), Email, QID, Nationality, Gender, Tier (Gold / Platinum / Black), Branch (BR-01…BR-05), Notes.</div>
      <button class="btn btn-ghost btn-sm" id="dz-sample" style="align-self:flex-start">${ic('download', 'i-sm')}Download sample file</button>
      <div id="dz-preview"></div></div>`,
    foot: html`<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="dz-go" disabled data-busy="Importing…">${ic('upload')}Import</button>`,
  });
  let rows = [];
  const preview = m.$('#dz-preview');
  const handle = async (file) => {
    const text = await file.text();
    const grid = parseCsv(text.replace(/^﻿/, ''));
    if (grid.length < 2) { preview.innerHTML = String(html`<div class="alert alert-warn">${ic('alert')}<div>No data rows found in this file.</div></div>`); return; }
    const keys = grid[0].map((h) => HEAD_MAP[h.trim().toLowerCase()] || null);
    if (!keys.includes('full_name') || !keys.includes('mobile')) { preview.innerHTML = String(html`<div class="alert alert-warn">${ic('alert')}<div>The header row needs at least <b>Full Name</b> and <b>Mobile</b> columns.</div></div>`); return; }
    rows = grid.slice(1).map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] || '').trim()]).filter(([k]) => k)));
    preview.innerHTML = String(html`<div class="alert alert-info">${ic('check-circle')}<div><b>${rows.length} member${rows.length === 1 ? '' : 's'}</b> ready to import from ${file.name}</div></div>
      <div class="table-wrap" style="max-height:220px"><table class="table"><thead><tr><th>Name</th><th>Mobile</th><th>Tier</th><th>Branch</th></tr></thead>
      <tbody>${rows.slice(0, 8).map((r) => html`<tr><td>${r.full_name}</td><td>${r.mobile}</td><td>${r.tier || 'default'}</td><td>${r.branch || '—'}</td></tr>`)}</tbody></table></div>
      ${rows.length > 8 ? html`<div class="muted small">…and ${rows.length - 8} more</div>` : ''}`);
    m.$('#dz-go').disabled = false;
  };
  const dz = m.$('#dz');
  m.$('#dz-file').addEventListener('change', (e) => e.target.files[0] && handle(e.target.files[0]));
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]); });
  m.$('#dz-sample').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob(['﻿' + sample], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'royal-members-sample.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  });
  m.$('#dz-go').addEventListener('click', async (e) => {
    try {
      const r = await withBusy(e.currentTarget, () => api('/members/import', { method: 'POST', body: { rows } }));
      preview.innerHTML = String(html`<div class="alert alert-info">${ic('check-circle')}<div><b>${r.created} member${r.created === 1 ? '' : 's'} imported</b> with new Royal cards.${r.skipped.length ? html` ${r.skipped.length} skipped:` : ''}</div></div>
        ${r.skipped.length ? html`<div class="table-wrap" style="max-height:220px"><table class="table"><thead><tr><th>Row</th><th>Name</th><th>Reason</th></tr></thead>
        <tbody>${r.skipped.map((s) => html`<tr><td>${s.row}</td><td>${s.name}</td><td class="muted">${s.reason}</td></tr>`)}</tbody></table></div>` : ''}`);
      m.$('#dz-go').disabled = true;
      toast('Import finished', `${r.created} created · ${r.skipped.length} skipped`, r.created ? 'good' : 'info');
      onDone();
    } catch (err) { toastError(err); }
  });
}
