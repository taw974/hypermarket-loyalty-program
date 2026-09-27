import { api, apiUrl, store, html, raw, ic, $, $$, on, fmt, toast, toastError, tierChip, avatar, download, downloadBlob, debounce } from '../core.js';
import { card3dHtml, bindCard3d, cardData, cardPngBlob, withLuhn } from '../card.js';
import { printCards } from '../print.js';

export default {
  title: 'Card Studio',
  sub: 'Design preview, print queue and print-shop export',
  async render(root) {
    const cleanups = [];
    let rows = [];
    let filter = 'pending';
    let search = '';
    const selected = new Set();
    let focusId = null;

    root.innerHTML = String(html`
    <section class="studio panel glow">
      <div class="studio-preview" id="st-preview"></div>
      <div class="studio-info">
        <div class="hello-kicker">${ic('sparkles', 'i-sm')} Print-ready vector artwork</div>
        <h2 class="display studio-title">The Royal Card</h2>
        <p class="soft">Every card carries a unique 16-digit number, a QR code and a Code-128 barcode — readable by any 2D counter scanner or phone camera, identical at all five branches.</p>
        <div class="spec-grid">
          <div><span>Format</span><b>CR80 · 85.6 × 54 mm</b></div>
          <div><span>Codes</span><b>QR (level Q) + Code-128</b></div>
          <div><span>Security</span><b>Guilloche + Luhn check digit</b></div>
          <div><span>Suggested finish</span><b>Matte black PVC, gold hot-foil</b></div>
        </div>
        <div class="studio-actions">
          <button class="btn btn-primary" data-act="cr80">${ic('printer')}Print on card printer</button>
          <button class="btn btn-outline" data-act="a4">${ic('file')}Print A4 sheet</button>
          <button class="btn btn-ghost" data-act="csv">${ic('download')}Print-shop data (CSV)</button>
          <button class="btn btn-ghost" data-act="png">${ic('image')}PNG (front + back)</button>
          <button class="btn btn-ghost" data-act="mark">${ic('check-circle')}Mark as printed</button>
        </div>
        <div class="muted small" id="st-selinfo"></div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><div><div class="panel-title">${ic('crown')}Tier designs</div><div class="panel-sub">One family, three finishes — the discount on each card follows its tier</div></div>
        ${store.can('admin') ? html`<a class="btn btn-ghost btn-sm" href="#/settings/tiers">${ic('settings', 'i-sm')}Manage tiers</a>` : ''}</div>
      <div class="panel-body tier-showcase" id="st-tiers"></div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div><div class="panel-title">${ic('printer')}Print queue</div><div class="panel-sub">Select cards to print, export or preview</div></div>
        <div class="row row-wrap">
          <div class="seg seg-sm" id="st-filter"><button data-f="pending" class="on">Not printed</button><button data-f="all">All active cards</button></div>
          <div class="input-group">${ic('search')}<input class="input" id="st-q" placeholder="Search…" style="width:200px"></div>
        </div>
      </div>
      <div id="st-table"><div class="page-loading"><span class="spinner"></span></div></div>
    </section>`);

    // Tier showcase
    $('#st-tiers', root).innerHTML = store.tiers.map((t) => {
      const data = cardData({
        member: { full_name: t.theme === 'black' ? 'Sheikha Al-Mannai' : t.theme === 'platinum' ? 'Khalid Al-Emadi' : 'Mohammed Al-Kuwari', member_code: 'RM-10001' },
        card: { card_number: withLuhn('9740' + String(t.id).padStart(2, '0') + '115202600'), issued_at: '2026-09-01', expires_at: '2028-09-01' },
        tier: t, branches: store.branches,
      });
      return String(html`<div class="tier-show"><div class="tier-show-card">${raw(card3dHtml(data))}</div>
        <div class="row">${tierChip(t.name, t.theme)}<span class="spacer"></span><b class="gold">${t.discount_pct}% off</b>${t.active ? '' : html`<span class="chip chip-muted">disabled</span>`}</div></div>`);
    }).join('');
    cleanups.push(bindCard3d($('#st-tiers', root)));

    function selectedRows() {
      const list = rows.filter((r) => selected.has(r.card_id));
      return list.length ? list : [];
    }
    function toData(r) {
      return cardData({
        member: { full_name: r.full_name, member_code: r.member_code, created_at: r.created_at },
        card: { card_number: r.card_number, issued_at: r.issued_at, expires_at: r.expires_at },
        tier: { theme: r.tier_theme, name: r.tier_name, discount_pct: r.discount_pct }, branches: store.branches,
      });
    }

    let unbindPreview = null;
    function paintPreview() {
      const r = rows.find((x) => x.card_id === focusId) || rows[0];
      const box = $('#st-preview', root);
      if (unbindPreview) unbindPreview();
      if (!r) { box.innerHTML = String(html`<div class="empty">${ic('cards')}No cards in the queue</div>`); return; }
      box.innerHTML = String(html`${raw(card3dHtml(toData(r), { hint: true }))}
        <div class="studio-caption">${avatar(r.full_name, r.tier_theme, 30)}<span><b>${r.full_name}</b><small>${fmt.card(r.card_number)} · ${r.tier_name}</small></span></div>`);
      unbindPreview = bindCard3d(box);
    }
    function paintSel() {
      const n = selected.size;
      $('#st-selinfo', root).innerHTML = String(n ? html`${ic('check', 'i-sm')} <b>${n}</b> card${n === 1 ? '' : 's'} selected — actions apply to the selection`
        : html`${ic('info', 'i-sm')} Nothing selected — actions apply to the card in the preview`);
    }

    function paintTable() {
      const q = search.toLowerCase();
      const list = rows.filter((r) => (filter === 'all' || r.printed_count === 0) && (!q || r.full_name.toLowerCase().includes(q) || r.card_number.includes(q.replace(/\s/g, '')) || r.member_code.toLowerCase().includes(q)));
      const el = $('#st-table', root);
      if (!list.length) {
        el.innerHTML = String(html`<div class="empty">${ic('check-circle')}<b>${filter === 'pending' ? 'All cards are printed' : 'No cards match'}</b><span>New members appear here automatically.</span></div>`);
        return;
      }
      const allOn = list.every((r) => selected.has(r.card_id));
      el.innerHTML = String(html`<div class="table-wrap" style="max-height:520px"><table class="table">
        <thead><tr><th class="c"><input type="checkbox" id="st-all" ${allOn ? 'checked' : ''} aria-label="Select all"></th><th>Member</th><th>Card number</th><th>Tier</th><th>Issued</th><th>Valid thru</th><th>Printed</th></tr></thead>
        <tbody>${list.map((r) => html`<tr class="clickable ${r.card_id === focusId ? 'focus' : ''}" data-id="${r.card_id}">
          <td class="c"><input type="checkbox" data-sel="${r.card_id}" ${selected.has(r.card_id) ? 'checked' : ''} aria-label="Select"></td>
          <td><div class="person">${avatar(r.full_name, r.tier_theme, 32)}<div><div class="cell-main">${r.full_name}</div><div class="cell-sub">${r.member_code}</div></div></div></td>
          <td class="mono">${fmt.card(r.card_number)}</td><td>${tierChip(r.tier_name, r.tier_theme)}</td>
          <td>${fmt.date(r.issued_at)}</td><td>${fmt.mmyy(r.expires_at)}</td>
          <td>${r.printed_count ? html`<span class="chip chip-good">${ic('check')}${r.printed_count}×</span>` : html`<span class="chip chip-gold">${ic('printer')}pending</span>`}</td></tr>`)}</tbody></table></div>`);
      $('#st-all', el)?.addEventListener('change', (e) => {
        list.forEach((r) => (e.target.checked ? selected.add(r.card_id) : selected.delete(r.card_id)));
        paintTable(); paintSel();
      });
    }

    async function load() {
      const r = await api('/cards/print-queue');
      rows = r.rows;
      if (!focusId || !rows.some((x) => x.card_id === focusId)) focusId = (rows.find((x) => x.printed_count === 0) || rows[0])?.card_id;
      paintTable();
      paintPreview();
      paintSel();
    }

    on($('#st-table', root), 'click', 'tr[data-id]', (e, tr) => {
      const id = Number(tr.dataset.id);
      if (e.target.matches('[data-sel]')) {
        if (e.target.checked) selected.add(id); else selected.delete(id);
        paintSel();
        return;
      }
      focusId = id;
      $$('#st-table tr.focus', root).forEach((x) => x.classList.remove('focus'));
      tr.classList.add('focus');
      paintPreview();
    });
    on($('#st-filter', root), 'click', '[data-f]', (e, b) => {
      filter = b.dataset.f;
      $$('#st-filter button', root).forEach((x) => x.classList.toggle('on', x === b));
      paintTable();
    });
    $('#st-q', root).addEventListener('input', debounce((e) => { search = e.target.value.trim(); paintTable(); }, 200));

    on(root, 'click', '[data-act]', async (e, b) => {
      let list = selectedRows();
      if (!list.length) { const f = rows.find((x) => x.card_id === focusId); list = f ? [f] : []; }
      if (!list.length) { toast('Nothing to work with yet', 'Enroll a member first', 'info'); return; }
      const ids = list.map((r) => r.card_id);
      try {
        switch (b.dataset.act) {
          case 'cr80': printCards(list.map(toData), 'cr80'); toast(`Sending ${list.length} card${list.length > 1 ? 's' : ''} to the printer`, 'Choose your PVC card printer in the dialog', 'gold'); break;
          case 'a4': printCards(list.map(toData), 'a4'); toast('A4 sheet ready', '10 cards per page with cut lines; backs are mirrored for duplex', 'gold'); break;
          case 'csv': download(apiUrl('/cards/export.csv', { ids: ids.join(',') })); toast('Print-shop file downloading', 'Send it to your card printing vendor with the artwork', 'good'); break;
          case 'png': {
            toast('Rendering 600-dpi artwork…', '', 'info', 2000);
            for (const r of list.slice(0, 10)) {
              for (const side of ['front', 'back']) downloadBlob(await cardPngBlob(toData(r), side), `royal-card-${r.member_code}-${side}.png`);
            }
            if (list.length > 10) toast('Only the first 10 cards were exported as PNG', 'Use print or CSV for large batches', 'info');
            break;
          }
          case 'mark':
            await api('/cards/printed', { method: 'POST', body: { ids } });
            toast(`${ids.length} card${ids.length > 1 ? 's' : ''} marked as printed`, '', 'good');
            selected.clear();
            await load();
            break;
          default: break;
        }
      } catch (err) { toastError(err); }
    });

    await load();
    return () => { cleanups.forEach((f) => f()); if (unbindPreview) unbindPreview(); };
  },
};
