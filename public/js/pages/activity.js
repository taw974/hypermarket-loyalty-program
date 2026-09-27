import { api, html, ic, $, $$, on, fmt, toastError } from '../core.js';

const FILTERS = [['', 'Everything'], ['txn', 'Discounts'], ['member', 'Members'], ['card', 'Cards'], ['auth', 'Sign-ins'], ['settings', 'Settings'], ['user', 'Staff'], ['system', 'System']];
const LABELS = {
  'auth.login': ['Signed in', 'user'], 'auth.logout': ['Signed out', 'logout'],
  'txn.create': ['Royal discount applied', 'percent'], 'txn.void': ['Transaction voided', 'ban'], 'txn.export': ['Transactions exported', 'download'],
  'member.create': ['Member enrolled', 'user-plus'], 'member.update': ['Member updated', 'edit'], 'member.import': ['Member imported', 'upload'],
  'member.export': ['Members exported', 'download'], 'member.rotate_link': ['Digital-card link renewed', 'key'],
  'card.status': ['Card status changed', 'shield'], 'card.tier': ['Card tier changed', 'crown'], 'card.renew': ['Card renewed', 'refresh'],
  'card.replace': ['Card replaced', 'cards'], 'card.print': ['Cards printed', 'printer'], 'card.export': ['Print data exported', 'download'],
  'settings.update': ['Program rules changed', 'settings'], 'tier.update': ['Tier updated', 'crown'], 'tier.create': ['Tier created', 'crown'],
  'branch.update': ['Branch updated', 'store'], 'user.create': ['Staff account created', 'user-plus'], 'user.update': ['Staff account updated', 'user'],
  'user.password': ['Password changed', 'lock'], 'user.reset_password': ['Password reset', 'key'], 'apikey.create': ['API key created', 'key'],
  'apikey.revoke': ['API key revoked', 'ban'], 'system.backup': ['Backup downloaded', 'database'], 'system.go_live': ['System went live', 'rocket'],
  'report.export': ['Report exported', 'download'],
};

function describe(a) {
  let d = {};
  try { d = a.details ? JSON.parse(a.details) : {}; } catch { d = { text: a.details }; }
  const parts = [];
  if (d.name) parts.push(d.name);
  if (d.txn_no) parts.push(d.txn_no);
  if (d.bill != null) parts.push(`bill ${fmt.money(d.bill)}`);
  if (d.discount != null) parts.push(`discount ${fmt.money(d.discount)}`);
  if (d.reason) parts.push(`“${d.reason}”`);
  if (d.from && d.to && typeof d.from !== 'object') parts.push(`${d.from} → ${d.to}`);
  if (d.count != null) parts.push(`${d.count} item(s)`);
  if (d.username) parts.push('@' + d.username);
  if (d.api_key) parts.push(`via ${d.api_key}`);
  if (!parts.length && a.action === 'settings.update') parts.push(Object.keys(d).join(', ') || 'no changes');
  return parts.join(' · ');
}

export default {
  title: 'Activity Log',
  sub: 'Tamper-evident record of who did what, and when',
  async render(root) {
    const state = { action: '', page: 1, limit: 50 };
    root.innerHTML = String(html`<div class="chips-row" id="a-f">${FILTERS.map(([k, l]) => html`<button class="fchip ${k === '' ? 'on' : ''}" data-a="${k}">${l}</button>`)}</div>
      <section class="panel"><div id="a-list"><div class="page-loading"><span class="spinner"></span></div></div><div class="pager" id="a-pager"></div></section>`);
    async function load() {
      try {
        const r = await api('/audit', { query: state });
        $('#a-list', root).innerHTML = r.rows.length ? String(html`<div class="timeline">${r.rows.map((a) => {
          const [label, icon] = LABELS[a.action] || [a.action, 'activity'];
          return html`<div class="tl-item"><span class="tl-ic">${ic(icon, 'i-sm')}</span>
            <div class="grow"><div><b>${label}</b> <span class="muted">by ${a.full_name || 'POS integration / system'}</span></div><div class="cell-sub">${describe(a)}</div></div>
            <div class="tl-time"><b>${fmt.time(a.at)}</b><small>${fmt.date(a.at)}</small></div></div>`;
        })}</div>`) : String(html`<div class="empty">${ic('history')}No activity recorded yet</div>`);
        const pages = Math.max(1, Math.ceil(r.total / r.limit));
        $('#a-pager', root).innerHTML = String(html`<span class="muted">${fmt.int(r.total)} entries · page ${r.page} of ${pages}</span><span class="spacer"></span>
          <button class="btn btn-ghost btn-sm" data-page="${r.page - 1}" ${r.page <= 1 ? 'disabled' : ''}>${ic('chevron-left', 'i-sm')}Newer</button>
          <button class="btn btn-ghost btn-sm" data-page="${r.page + 1}" ${r.page >= pages ? 'disabled' : ''}>Older${ic('chevron-right', 'i-sm')}</button>`);
      } catch (err) { toastError(err); }
    }
    on($('#a-f', root), 'click', '[data-a]', (e, b) => {
      state.action = b.dataset.a; state.page = 1;
      $$('#a-f .fchip', root).forEach((x) => x.classList.toggle('on', x === b));
      load();
    });
    on($('#a-pager', root), 'click', '[data-page]', (e, b) => { state.page = Number(b.dataset.page); load(); });
    await load();
  },
};
