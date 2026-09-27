import { api, store, html, raw, ic, on, fmt, toast, toastError, modal, withBusy, loadMeta } from '../core.js';
import { sparkline } from '../charts.js';

export default {
  title: 'Branches',
  sub: 'Five hypermarkets, one Royal card',
  async render(root) {
    const admin = store.can('admin');
    let rows = [];

    async function load() {
      rows = (await api('/branches')).rows;
      paint();
    }

    function paint() {
      const groups = [['welcome', 'Welcome Friends Hypermarket', 'WF'], ['madina', 'Al Madina Hypermarket', 'AM']];
      root.innerHTML = String(html`${groups.map(([brand, label, mono]) => html`
        <div class="brand-group">
          <div class="brand-group-head"><span class="monogram ${brand}">${mono}</span><div><h3 class="display">${label}</h3>
            <div class="muted">${rows.filter((b) => b.brand === brand).length} branches · Royal card accepted at every counter</div></div></div>
          <div class="branch-grid">${rows.filter((b) => b.brand === brand).map((b) => html`
            <article class="branch panel ${b.active ? '' : 'inactive'}">
              <div class="branch-top">
                <span class="branch-code">${b.code}</span>
                ${b.active ? html`<span class="chip chip-good">${ic('check')}Active</span>` : html`<span class="chip chip-muted">${ic('ban')}Inactive</span>`}
              </div>
              <h4 class="branch-name">${b.short_name}</h4>
              <div class="branch-full">${b.name}</div>
              <div class="branch-addr">${ic('pin', 'i-sm')}<span>${b.address || '—'}</span></div>
              ${b.today ? html`<div class="branch-kpis">
                <div><span>Today</span><b>${fmt.int(b.today.txns)}</b><small>${fmt.money(b.today.discount)} saved</small></div>
                <div><span>This month</span><b>${fmt.moneyCompact(b.month.gross)}</b><small>${fmt.int(b.month.txns)} discounts</small></div>
              </div>
              <div class="branch-trend"><span class="muted small">14-day Royal spend</span>${raw(sparkline(b.trend, { w: 150, h: 36 }))}</div>` : ''}
              <div class="branch-meta"><span>${ic('users', 'i-sm')}${fmt.int(b.members)} home members</span><span>${ic('user', 'i-sm')}${b.staff} staff</span></div>
              <div class="branch-actions">
                ${b.phone ? html`<a class="btn btn-ghost btn-sm" href="tel:+974${b.phone.replace(/\s/g, '')}">${ic('phone', 'i-sm')}${b.phone}</a>` : ''}
                ${b.map_url ? html`<a class="btn btn-ghost btn-sm" href="${b.map_url}" target="_blank" rel="noopener">${ic('pin', 'i-sm')}Map</a>` : ''}
                ${admin ? html`<button class="btn btn-ghost btn-sm" data-edit="${b.id}">${ic('edit', 'i-sm')}Edit</button>` : ''}
              </div>
            </article>`)}</div></div>`)}`);
    }

    function edit(b) {
      const m = modal({
        title: `Edit ${b.code}`,
        sub: b.name,
        size: 'wide',
        body: html`<form id="bf" class="form-grid">
          <div class="field span-2"><label>Branch name</label><input class="input" name="name" value="${b.name}" required></div>
          <div class="field"><label>Short name (shown on cards & screens)</label><input class="input" name="short_name" value="${b.short_name}" required maxlength="30"></div>
          <div class="field"><label>Brand</label><select class="select" name="brand"><option value="welcome" ${b.brand === 'welcome' ? 'selected' : ''}>Welcome Friends</option><option value="madina" ${b.brand === 'madina' ? 'selected' : ''}>Al Madina</option></select></div>
          <div class="field span-2"><label>Address</label><input class="input" name="address" value="${b.address || ''}"></div>
          <div class="field"><label>Phone</label><input class="input" name="phone" value="${b.phone || ''}"></div>
          <div class="field"><label>Google Maps link</label><input class="input" name="map_url" value="${b.map_url || ''}"></div>
          <label class="check span-2"><input type="checkbox" name="active" ${b.active ? 'checked' : ''}> Branch accepts Royal cards</label>
          <div class="form-error hidden span-2" data-err></div></form>`,
        foot: html`<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" form="bf" type="submit">${ic('check')}Save</button>`,
      });
      m.$('#bf').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const body = Object.fromEntries(fd);
        body.active = fd.get('active') === 'on';
        try {
          await withBusy(m.$('.modal-foot .btn-primary'), () => api(`/branches/${b.id}`, { method: 'PUT', body }));
          m.close();
          toast('Branch updated', body.name, 'good');
          await loadMeta();
          load();
        } catch (err) {
          const el = m.$('[data-err]'); el.textContent = err.message; el.classList.remove('hidden');
        }
      });
    }

    on(root, 'click', '[data-edit]', (e, btn) => edit(rows.find((b) => b.id === Number(btn.dataset.edit))));
    try { await load(); } catch (err) { toastError(err); }
  },
};
