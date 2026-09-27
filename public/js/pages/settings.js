import {
  api, store, html, raw, ic, $, on, fmt, toast, toastError, modal, confirmDialog, withBusy, loadMeta, copyText, download,
} from '../core.js';
import { card3dHtml, bindCard3d, cardData, withLuhn } from '../card.js';

const TABS = [
  ['rules', 'Program rules', 'percent'], ['tiers', 'Card tiers', 'crown'], ['users', 'Staff & access', 'users'],
  ['integration', 'POS integration', 'zap'], ['system', 'Backup & system', 'database'], ['golive', 'Go live', 'rocket'],
];
const ROLE_LABEL = { admin: 'Administrator', manager: 'Manager', cashier: 'Cashier' };

export default {
  title: 'Settings',
  sub: 'Program rules, tiers, staff, integrations and safety',
  async render(root, { params, navigate }) {
    const tab = TABS.some(([k]) => k === params[0]) ? params[0] : 'rules';
    root.innerHTML = String(html`
      <div class="tabs">${TABS.map(([k, l, i]) => html`<a href="#/settings/${k}" class="tab ${k === tab ? 'on' : ''}">${ic(i, 'i-sm')}${l}</a>`)}</div>
      <div id="tab-body" class="tab-body"><div class="page-loading"><span class="spinner"></span></div></div>`);
    const body = $('#tab-body', root);
    const renderers = { rules, tiers, users, integration, system, golive };
    try {
      return await renderers[tab](body, navigate);
    } catch (err) {
      toastError(err);
      return undefined;
    }
  },
};

// ---------------- Program rules ----------------
async function rules(el) {
  const { settings: s } = await api('/settings');
  const num = (name, label, hint, attrs = '') => html`<div class="field"><label>${label}</label><input class="input" name="${name}" type="number" step="any" min="0" value="${s[name]}" ${raw(attrs)}><span class="hint">${hint}</span></div>`;
  el.innerHTML = String(html`<div class="settings-grid">
    <form class="panel panel-pad stack-lg" id="rules-form">
      <div class="set-section"><h3>${ic('percent')}Discount rules</h3>
        <p class="muted">The discount % itself belongs to each card tier (Royal Gold = ${store.tiers.find((t) => t.is_default)?.discount_pct ?? 15}%). These rules protect every redemption.</p>
        <div class="form-grid">
          ${num('min_bill_amount', `Minimum bill (${store.currency})`, '0 = discount on any amount')}
          ${num('max_discount_per_txn', `Maximum discount per bill (${store.currency})`, '0 = no cap — full % on any bill')}
          ${num('max_txn_per_card_per_day', 'Uses per card per day', '0 = unlimited', 'step="1"')}
          ${num('large_bill_warning', `Confirm bills above (${store.currency})`, 'Cashier must re-confirm big amounts (typo guard)')}
          ${num('duplicate_window_sec', 'Duplicate guard (seconds)', 'Same card + same amount inside this window needs confirmation', 'step="1"')}
          <div class="field"><label>POS invoice number</label><label class="check"><span class="switch"><input type="checkbox" name="require_pos_invoice" ${s.require_pos_invoice ? 'checked' : ''}><span></span></span> Required at the counter</label>
            <span class="hint">Links every discount to a POS bill — blocks re-use of one invoice.</span></div>
        </div></div>
      <div class="set-section"><h3>${ic('card')}Cards &amp; links</h3>
        <div class="form-grid">
          ${num('card_validity_years', 'Card validity (years)', 'New and renewed cards', 'step="1" min="1" max="10"')}
          <div class="field"><label>Card number prefix</label><input class="input" name="card_prefix" value="${s.card_prefix}" pattern="\\d{3,6}"><span class="hint">First digits of new card numbers (existing cards unchanged)</span></div>
          <div class="field span-2"><label>Public address of this system</label><input class="input" name="public_base_url" value="${s.public_base_url}" placeholder="https://royal.yourdomain.com">
            <span class="hint">Used in WhatsApp messages and digital-card links. Leave blank to use the current address (${location.origin}).</span></div>
        </div></div>
      <div class="set-section"><h3>${ic('receipt')}Branding &amp; slip</h3>
        <div class="form-grid">
          <div class="field"><label>Program name</label><input class="input" name="program_name" value="${s.program_name}" required></div>
          <div class="field"><label>Tagline</label><input class="input" name="program_tagline" value="${s.program_tagline}"></div>
          <div class="field"><label>Slip header</label><input class="input" name="receipt_header" value="${s.receipt_header}"></div>
          <div class="field"><label>Slip footer</label><input class="input" name="receipt_footer" value="${s.receipt_footer}"></div>
        </div></div>
      <div class="form-error hidden" data-err></div>
      <div class="row"><span class="spacer"></span><button class="btn btn-primary btn-lg" type="submit" data-busy="Saving…">${ic('check')}Save rules</button></div>
    </form>
    <aside class="panel panel-pad calc-demo">
      <div class="hello-kicker">${ic('sparkles', 'i-sm')} Live example</div>
      <h3 class="display">How a bill is calculated</h3>
      <div class="field"><label>Bill amount (${store.currency})</label><input class="input input-xl" id="ex-bill" type="number" value="300" min="0"></div>
      <div class="field"><label>Tier</label><select class="select" id="ex-tier">${store.tiers.map((t) => html`<option value="${t.discount_pct}" ${t.is_default ? 'selected' : ''}>${t.name} · ${t.discount_pct}%</option>`)}</select></div>
      <div class="calc live" id="ex-out"></div>
      <p class="muted small">Exactly what the cashier sees at the counter.</p>
    </aside></div>`);

  const form = $('#rules-form', el);
  const calcEx = () => {
    const bill = Number($('#ex-bill', el).value) || 0;
    const pct = Number($('#ex-tier', el).value) || 0;
    const cap = Number(form.max_discount_per_txn.value) || 0;
    const min = Number(form.min_bill_amount.value) || 0;
    let disc = Math.round(bill * pct) / 100;
    const capped = cap > 0 && disc > cap;
    if (capped) disc = cap;
    const blocked = min > 0 && bill < min;
    if (blocked) disc = 0;
    $('#ex-out', el).innerHTML = String(html`<div class="calc-row"><span>Bill total</span><b>${fmt.money(bill)}</b></div>
      <div class="calc-row disc"><span>Royal discount (${pct}%)</span><b>− ${fmt.money(disc)}</b></div>
      <div class="calc-net"><span>NET PAYABLE</span><b>${fmt.money(bill - disc)}</b></div>
      <div class="calc-note">${blocked ? html`${ic('alert', 'i-sm')} Below the minimum bill — no discount` : capped ? html`${ic('info', 'i-sm')} Capped at ${fmt.money(cap)}` : html`${ic('sparkles', 'i-sm')} Customer saves ${fmt.money(disc)}`}</div>`);
  };
  on(el, 'input', 'input,select', calcEx);
  calcEx();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = Object.fromEntries(fd);
    body.require_pos_invoice = fd.get('require_pos_invoice') === 'on';
    const err = $('[data-err]', form);
    err.classList.add('hidden');
    try {
      await withBusy(form.querySelector('[type=submit]'), () => api('/settings', { method: 'PUT', body }));
      await loadMeta();
      toast('Rules saved', 'Applied to every counter immediately', 'good');
    } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
  });
}

// ---------------- Tiers ----------------
async function tiers(el) {
  const { rows } = await api('/tiers');
  const sample = (t) => cardData({ member: { full_name: 'Royal Member', member_code: 'RM-10001' }, card: { card_number: withLuhn('974000000000' + String(t.id).padStart(3, '0')), issued_at: '2026-09-01', expires_at: '2028-09-01' }, tier: t, branches: store.branches });
  el.innerHTML = String(html`<p class="muted" style="margin-bottom:16px">The client brief asks for one Royal card at <b class="gold">15%</b>. Extra tiers are optional — keep them disabled until you need VIP cards.</p>
    <div class="tier-edit-grid">${rows.map((t) => html`<form class="panel panel-pad tier-edit" data-id="${t.id}">
      <div class="tier-edit-card">${raw(card3dHtml(sample(t), { flippable: false }))}</div>
      <div class="form-grid">
        <div class="field span-2"><label>Tier name</label><input class="input" name="name" value="${t.name}" required></div>
        <div class="field"><label>Discount %</label><input class="input" name="discount_pct" type="number" step="0.5" min="0" max="90" value="${t.discount_pct}" required></div>
        <div class="field"><label>Card design</label><select class="select" name="theme">${['gold', 'platinum', 'black'].map((th) => html`<option value="${th}" ${t.theme === th ? 'selected' : ''}>${th[0].toUpperCase() + th.slice(1)}</option>`)}</select></div>
        <label class="check"><span class="switch"><input type="checkbox" name="active" ${t.active ? 'checked' : ''}><span></span></span>Active</label>
        <label class="check"><input type="radio" name="is_default" ${t.is_default ? 'checked' : ''}>Default for new members</label>
      </div>
      <div class="row"><span class="muted small">${fmt.int(t.active_cards)} active card${t.active_cards === 1 ? '' : 's'}</span><span class="spacer"></span><button class="btn btn-outline btn-sm" type="submit">${ic('check', 'i-sm')}Save</button></div>
    </form>`)}</div>`);
  const unbind = bindCard3d(el);
  on(el, 'submit', 'form.tier-edit', async (e, form) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = { name: fd.get('name'), discount_pct: Number(fd.get('discount_pct')), theme: fd.get('theme'), active: fd.get('active') === 'on', is_default: form.querySelector('[name=is_default]').checked };
    try {
      await withBusy(form.querySelector('[type=submit]'), () => api(`/tiers/${form.dataset.id}`, { method: 'PUT', body }));
      await loadMeta();
      toast('Tier saved', `${body.name} · ${body.discount_pct}%`, 'good');
      unbind();
      tiers(el);
    } catch (err) { toastError(err); }
  });
  return unbind;
}

// ---------------- Users ----------------
async function users(el) {
  const { rows } = await api('/users');
  el.innerHTML = String(html`<div class="row" style="margin-bottom:14px"><p class="muted grow">Cashiers see only the POS and members of their branch. Managers get dashboards and reports. Administrators control everything.</p>
      <button class="btn btn-primary" id="u-new">${ic('user-plus')}Add staff</button></div>
    <section class="panel"><div class="table-wrap"><table class="table">
      <thead><tr><th>Staff member</th><th>Role</th><th>Branch</th><th>Status</th><th>Last sign-in</th><th class="r">Txns (30d)</th><th></th></tr></thead>
      <tbody>${rows.map((u) => html`<tr>
        <td><div class="cell-main">${u.full_name}${u.is_demo ? html` <span class="chip chip-gold">demo</span>` : ''}</div><div class="cell-sub">@${u.username}</div></td>
        <td>${ROLE_LABEL[u.role]}</td><td>${u.branch_short || html`<span class="muted">All branches</span>`}</td>
        <td>${u.active ? html`<span class="chip chip-good">${ic('check')}Active</span>` : html`<span class="chip chip-muted">${ic('ban')}Disabled</span>`}</td>
        <td>${u.last_login_at ? fmt.rel(u.last_login_at) : html`<span class="muted">never</span>`}</td><td class="r">${fmt.int(u.txns_30d)}</td>
        <td class="r nowrap"><button class="btn btn-ghost btn-sm" data-edit="${u.id}">${ic('edit', 'i-sm')}Edit</button><button class="btn btn-ghost btn-sm" data-pw="${u.id}">${ic('key', 'i-sm')}Password</button></td></tr>`)}</tbody></table></div></section>`);

  const form = (u = null) => {
    const m = modal({
      title: u ? `Edit ${u.full_name}` : 'Add staff member',
      size: 'wide',
      body: html`<form id="uf" class="form-grid">
        <div class="field"><label>Full name</label><input class="input" name="full_name" value="${u?.full_name || ''}" required></div>
        <div class="field"><label>Username</label><input class="input" name="username" value="${u?.username || ''}" ${u ? 'disabled' : 'required'} autocomplete="off"></div>
        <div class="field"><label>Role</label><select class="select" name="role">${Object.entries(ROLE_LABEL).map(([k, l]) => html`<option value="${k}" ${u?.role === k || (!u && k === 'cashier') ? 'selected' : ''}>${l}</option>`)}</select></div>
        <div class="field"><label>Branch</label><select class="select" name="branch_id"><option value="">All branches (HQ)</option>${store.branches.map((b) => html`<option value="${b.id}" ${u?.branch_id === b.id ? 'selected' : ''}>${b.code} · ${b.short_name}</option>`)}</select>
          <span class="hint">Cashiers must belong to a branch</span></div>
        ${u ? html`<label class="check span-2"><span class="switch"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}><span></span></span>Account active</label>`
    : html`<div class="field span-2"><label>Password</label><input class="input" name="password" type="password" minlength="8" required autocomplete="new-password"><span class="hint">8+ characters, letters and numbers</span></div>`}
        <div class="form-error hidden span-2" data-err></div></form>`,
      foot: html`<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" form="uf" type="submit">${ic('check')}${u ? 'Save' : 'Create account'}</button>`,
    });
    m.$('#uf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd);
      if (u) body.active = fd.get('active') === 'on';
      try {
        await withBusy(m.$('.modal-foot .btn-primary'), () => api(u ? `/users/${u.id}` : '/users', { method: u ? 'PUT' : 'POST', body }));
        m.close();
        toast(u ? 'Staff updated' : 'Staff account created', body.full_name, 'good');
        users(el);
      } catch (err) { const x = m.$('[data-err]'); x.textContent = err.message; x.classList.remove('hidden'); }
    });
  };
  $('#u-new', el).addEventListener('click', () => form());
  on(el, 'click', '[data-edit]', (e, b) => form(rows.find((x) => x.id === Number(b.dataset.edit))));
  on(el, 'click', '[data-pw]', async (e, b) => {
    const u = rows.find((x) => x.id === Number(b.dataset.pw));
    const pw = await confirmDialog({ title: `New password for ${u.full_name}`, text: 'They will be signed out of other devices.', confirmText: 'Set password', icon: 'key',
      input: { label: 'New password', placeholder: 'At least 8 characters, letters + numbers', required: true, min: 8, requiredMsg: 'Use at least 8 characters' } });
    if (!pw) return;
    try { await api(`/users/${u.id}/password`, { method: 'POST', body: { password: pw } }); toast('Password updated', u.full_name, 'good'); } catch (err) { toastError(err); }
  });
}

// ---------------- POS integration ----------------
async function integration(el) {
  const { rows } = await api('/api-keys');
  const base = (store.settings.public_base_url || location.origin).replace(/\/+$/, '');
  el.innerHTML = String(html`<div class="settings-grid">
    <section class="panel">
      <div class="panel-head"><div><div class="panel-title">${ic('zap')}Direct POS integration</div><div class="panel-sub">Let your POS software verify Royal cards and record discounts automatically</div></div>
        <button class="btn btn-primary btn-sm" id="k-new">${ic('plus', 'i-sm')}Create API key</button></div>
      <div class="panel-body">
        <p class="soft">Today, cashiers scan the Royal card on this terminal next to the POS. When your POS vendor is ready, they can connect directly with the API below — the card is scanned once, at the POS, and the 15% is applied automatically.</p>
        ${rows.length ? html`<div class="table-wrap" style="margin-top:14px"><table class="table"><thead><tr><th>Name</th><th>Key</th><th>Branch</th><th>Last used</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows.map((k) => html`<tr><td class="cell-main">${k.name}</td><td class="mono">${k.key_prefix}…</td><td>${k.branch || '—'}</td><td>${k.last_used_at ? fmt.rel(k.last_used_at) : 'never'}</td>
            <td>${k.active ? html`<span class="chip chip-good">${ic('check')}Active</span>` : html`<span class="chip chip-muted">Revoked</span>`}</td>
            <td class="r">${k.active ? html`<button class="btn btn-ghost btn-sm" data-revoke="${k.id}">${ic('ban', 'i-sm')}Revoke</button>` : ''}</td></tr>`)}</tbody></table></div>`
    : html`<div class="empty">${ic('key')}No API keys yet</div>`}
      </div>
    </section>
    <aside class="panel panel-pad api-docs">
      <h3>${ic('file')}API quick reference</h3>
      <p class="muted small">Send the key in the <code>X-API-Key</code> header. One key per branch / POS system.</p>
      <div class="code-label">1 · Verify a scanned card</div>
      <pre class="code">GET ${base}/api/v1/cards/9740XXXXXXXXXXXX

→ { "valid": true, "member_name": "…",
    "tier": "Royal Gold", "discount_pct": 15 }</pre>
      <div class="code-label">2 · Record the discount</div>
      <pre class="code">POST ${base}/api/v1/redemptions
{ "card_number": "9740XXXXXXXXXXXX",
  "bill_amount": 300.00,
  "invoice_no": "INV-01-482311" }

→ { "discount_amount": 45.00,
    "net_amount": 255.00, "txn_no": "RL…" }</pre>
    </aside></div>`);
  $('#k-new', el).addEventListener('click', () => {
    const m = modal({
      title: 'Create API key',
      body: html`<form id="kf" class="stack"><div class="field"><label>Name</label><input class="input" name="name" placeholder="e.g. Muaither POS server" required></div>
        <div class="field"><label>Branch</label><select class="select" name="branch_id" required>${store.branches.map((b) => html`<option value="${b.id}">${b.code} · ${b.short_name}</option>`)}</select></div></form>`,
      foot: html`<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" form="kf" type="submit">${ic('key')}Create</button>`,
    });
    m.$('#kf').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await api('/api-keys', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
        m.el.querySelector('.modal-body').innerHTML = String(html`<div class="alert alert-warn">${ic('alert')}<div><b>Copy this key now.</b> For security it is shown only once.</div></div>
          <pre class="code big-key">${r.key}</pre>`);
        m.el.querySelector('.modal-foot').innerHTML = String(html`<button class="btn btn-outline" data-copy>${ic('copy')}Copy key</button><button class="btn btn-primary" data-close>Done</button>`);
        m.el.querySelector('[data-copy]').addEventListener('click', () => copyText(r.key, 'API key copied'));
        m.el.querySelector('.modal-foot [data-close]').addEventListener('click', () => { m.close(); integration(el); });
      } catch (err) { toastError(err); }
    });
  });
  on(el, 'click', '[data-revoke]', async (e, b) => {
    if (!await confirmDialog({ title: 'Revoke this key?', text: 'The POS using it will immediately stop verifying cards.', confirmText: 'Revoke', danger: true })) return;
    try { await api(`/api-keys/${b.dataset.revoke}`, { method: 'DELETE' }); toast('Key revoked', '', 'info'); integration(el); } catch (err) { toastError(err); }
  });
}

// ---------------- Backup & system ----------------
async function system(el) {
  const s = await api('/admin/system');
  const mb = (b) => (b / 1048576).toFixed(2) + ' MB';
  const up = (x) => (x > 86400 ? `${Math.floor(x / 86400)}d ${Math.floor((x % 86400) / 3600)}h` : x > 3600 ? `${Math.floor(x / 3600)}h ${Math.floor((x % 3600) / 60)}m` : `${Math.floor(x / 60)}m`);
  el.innerHTML = String(html`<div class="settings-grid">
    <section class="panel panel-pad stack-lg">
      <h3>${ic('database')}Database</h3>
      <div class="spec-grid">
        <div><span>Members</span><b>${fmt.int(s.counts.members)}</b></div><div><span>Cards</span><b>${fmt.int(s.counts.cards)}</b></div>
        <div><span>Transactions</span><b>${fmt.int(s.counts.transactions)}</b></div><div><span>Audit entries</span><b>${fmt.int(s.counts.audit)}</b></div>
        <div><span>Database size</span><b>${mb(s.db_bytes)}</b></div><div><span>Staff accounts</span><b>${fmt.int(s.counts.users)}</b></div>
      </div>
      <div class="row row-wrap"><button class="btn btn-primary" id="bk">${ic('download')}Download backup now</button>
        <span class="muted small">Automatic backup every 24 h · last 20 kept on the server</span></div>
      <div><div class="label" style="margin-bottom:8px">Recent automatic backups</div>
        ${s.backups.length ? html`<div class="visit-list">${s.backups.map((b) => html`<div class="row mono small">${ic('database', 'i-sm')}${b}</div>`)}</div>` : html`<div class="muted small">First automatic backup runs 1 minute after the server starts.</div>`}
        <div class="muted small" style="margin-top:6px">Folder: <span class="mono">${s.backup_dir}</span></div></div>
    </section>
    <aside class="panel panel-pad stack-lg">
      <h3>${ic('server')}Server</h3>
      <div class="kv">
        <div><span>Status</span><b><span class="chip chip-good">${ic('check')}Online</span></b></div>
        <div><span>Uptime</span><b>${up(s.uptime_sec)}</b></div>
        <div><span>Live connections</span><b>${s.live_clients} screen${s.live_clients === 1 ? '' : 's'}</b></div>
        <div><span>Runtime</span><b>Node.js ${s.node} · SQLite</b></div>
        <div><span>Data file</span><b class="mono small">${s.db_path}</b></div>
      </div>
      <div class="alert alert-info">${ic('info')}<div><b>Restore a backup:</b> stop the server, replace <span class="mono">data/royal-loyalty.db</span> with the backup file, start again.</div></div>
    </aside></div>`);
  $('#bk', el).addEventListener('click', () => { download('/api/admin/backup'); toast('Backup downloading', 'Keep it somewhere safe (USB / cloud drive)', 'good'); });
}

// ---------------- Go live ----------------
async function golive(el) {
  if (!store.settings.demo_mode) {
    el.innerHTML = String(html`<section class="panel panel-pad golive done">${ic('rocket', 'i-xl')}<h3 class="display">The system is LIVE</h3>
      <p class="muted">Demo data has been removed. Every card, discount and report is real.</p></section>`);
    return;
  }
  el.innerHTML = String(html`<section class="panel panel-pad golive">
    <div class="golive-head">${ic('rocket', 'i-xl')}<div><h3 class="display">Switch from demo to live</h3>
      <p class="muted">Right now the system contains <b>sample members and transactions</b> so the client can see it working. When the client approves, go live:</p></div></div>
    <ol class="checklist">
      <li>${ic('check-circle')}A safety backup of the demo database is taken automatically</li>
      <li>${ic('check-circle')}All demo members, cards, transactions and logs are removed</li>
      <li>${ic('check-circle')}Branches, tiers (15% Royal Gold) and rules are kept</li>
      <li>${ic('check-circle')}Your admin password is changed; demo staff accounts can be removed</li>
    </ol>
    <form id="gl" class="form-grid">
      <div class="field"><label>New administrator password</label><input class="input" type="password" name="admin_password" minlength="8" required autocomplete="new-password"></div>
      <div class="field"><label>Type <b>GO LIVE</b> to confirm</label><input class="input" name="confirm" required autocomplete="off" placeholder="GO LIVE"></div>
      <label class="check span-2"><input type="checkbox" name="remove_demo_users" checked> Remove demo staff accounts (manager, cashier1–5) — create real staff afterwards</label>
      <div class="form-error hidden span-2" data-err></div>
      <div class="span-2 row"><span class="spacer"></span><button class="btn btn-danger btn-lg" type="submit" data-busy="Going live…">${ic('rocket')}Go live now</button></div>
    </form></section>`);
  $('#gl', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = { admin_password: fd.get('admin_password'), confirm: fd.get('confirm'), remove_demo_users: fd.get('remove_demo_users') === 'on' };
    try {
      await withBusy(e.target.querySelector('[type=submit]'), () => api('/admin/go-live', { method: 'POST', body }));
      toast('The Royal Loyalty system is LIVE', 'Demo data removed · admin password updated', 'gold', 8000);
      setTimeout(() => location.reload(), 1600);
    } catch (err) { const x = $('[data-err]', el); x.textContent = err.message; x.classList.remove('hidden'); }
  });
}
