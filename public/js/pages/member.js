import {
  api, store, html, raw, ic, $, on, fmt, toast, toastError, confirmDialog, statusChip, tierChip, avatar, copyText, memberLink,
  whatsappLink, downloadBlob, qatarNow,
} from '../core.js';
import { card3dHtml, bindCard3d, cardData, cardPngBlob } from '../card.js';
import { columnChart, tableHtml } from '../charts.js';
import { printCards, printReceipt } from '../print.js';
import { openMemberForm } from './member-form.js';

export default {
  title: 'Member profile',
  async render(root, { params, setTitle }) {
    const id = Number(params[0]);
    const staff = store.can('admin', 'manager');
    const cleanups = [];
    let d = null;
    let tableMode = false;

    async function load() {
      d = await api(`/members/${id}`);
      paint();
    }

    function paint() {
      cleanups.splice(0).forEach((f) => f());
      const m = d.member;
      const card = d.cards[0];
      const tier = card.tier;
      const s = d.stats;
      const data = cardData({ member: m, card, tier, branches: store.branches });
      const eff = card.effective_status;
      setTitle(m.full_name, `${m.member_code} · ${tier.name}`);
      const link = memberLink(m.public_token);
      const waMsg = `Dear ${m.full_name.split(' ')[0]}, here is your ${store.settings.program_name} 👑\nCard: ${fmt.card(card.card_number)} · ${tier.discount_pct}% off at all Welcome Friends & Al Madina branches.\nOpen your digital card: ${link}`;

      root.innerHTML = String(html`
      <a class="back-link" href="#/members">${ic('arrow-left', 'i-sm')}All members</a>
      <section class="profile panel glow">
        <div class="profile-card">
          ${raw(card3dHtml(data, { hint: true }))}
          <div class="profile-card-actions">
            ${staff ? html`<button class="btn btn-outline btn-sm" data-act="print">${ic('printer', 'i-sm')}Print card</button>` : ''}
            <button class="btn btn-ghost btn-sm" data-act="png-front">${ic('image', 'i-sm')}PNG front</button>
            <button class="btn btn-ghost btn-sm" data-act="png-back">${ic('image', 'i-sm')}PNG back</button>
          </div>
        </div>
        <div class="profile-main">
          <div class="profile-head">
            ${avatar(m.full_name, tier.theme, 64)}
            <div class="grow">
              <h2 class="profile-name display">${m.full_name}</h2>
              <div class="row row-wrap">${tierChip(`${tier.name} · ${tier.discount_pct}%`, tier.theme)}${statusChip(eff)}
                ${card.printed_count ? html`<span class="chip chip-muted">${ic('printer')}Printed ${card.printed_count}×</span>` : html`<span class="chip chip-gold">${ic('printer')}Not printed yet</span>`}</div>
            </div>
          </div>
          <div class="profile-meta">
            <div><span>Card number</span><b class="mono">${fmt.card(card.card_number)}</b></div>
            <div><span>Mobile</span><b><a href="tel:${m.mobile}">${fmt.phone(m.mobile)}</a></b></div>
            <div><span>Member code</span><b>${m.member_code}</b></div>
            <div><span>Valid</span><b>${fmt.date(card.issued_at)} → ${fmt.date(card.expires_at)}</b></div>
            <div><span>Home branch</span><b>${m.home_branch || '—'}</b></div>
            <div><span>Member since</span><b>${fmt.date(m.created_at)}</b></div>
            ${m.email ? html`<div><span>Email</span><b><a href="mailto:${m.email}">${m.email}</a></b></div>` : ''}
            ${m.qid ? html`<div><span>QID</span><b>${m.qid}</b></div>` : ''}
            ${m.nationality ? html`<div><span>Nationality</span><b>${m.nationality}</b></div>` : ''}
            ${m.birth_date ? html`<div><span>Birthday</span><b>${fmt.dateShort(m.birth_date)}</b></div>` : ''}
          </div>
          ${card.status_reason ? html`<div class="alert ${eff === 'active' ? 'alert-info' : 'alert-warn'}">${ic('info')}<div>${card.status_reason}</div></div>` : ''}
          ${m.notes ? html`<div class="alert alert-info">${ic('file')}<div>${m.notes}</div></div>` : ''}
          <div class="profile-actions">
            <a class="btn btn-primary btn-sm" href="${whatsappLink(m.mobile, waMsg)}" target="_blank" rel="noopener">${ic('whatsapp', 'i-sm')}Send card on WhatsApp</a>
            <a class="btn btn-outline btn-sm" href="${link}" target="_blank" rel="noopener">${ic('phoneSmall', 'i-sm')}Digital card</a>
            <button class="btn btn-ghost btn-sm" data-act="copy">${ic('link', 'i-sm')}Copy link</button>
            ${staff ? html`<button class="btn btn-ghost btn-sm" data-act="edit">${ic('edit', 'i-sm')}Edit</button>` : ''}
          </div>
          ${staff ? html`<div class="profile-actions admin">
            <button class="btn btn-ghost btn-sm" data-act="tier">${ic('crown', 'i-sm')}Change tier</button>
            <button class="btn btn-ghost btn-sm" data-act="renew">${ic('refresh', 'i-sm')}Renew</button>
            ${eff === 'suspended' || eff === 'blocked' ? html`<button class="btn btn-success btn-sm" data-act="activate">${ic('unlock', 'i-sm')}Re-activate</button>`
    : html`<button class="btn btn-ghost btn-sm" data-act="suspend">${ic('lock', 'i-sm')}Suspend</button>`}
            ${eff !== 'blocked' ? html`<button class="btn btn-danger btn-sm" data-act="block">${ic('ban', 'i-sm')}Block</button>` : ''}
            <button class="btn btn-ghost btn-sm" data-act="replace">${ic('cards', 'i-sm')}Replace card</button>
            <button class="btn btn-ghost btn-sm" data-act="rotate" title="Invalidate the old digital-card link">${ic('key', 'i-sm')}New link</button>
          </div>` : ''}
        </div>
      </section>

      <section class="stat-strip">
        <div class="panel"><span>Visits</span><b>${fmt.int(s.visits)}</b></div>
        <div class="panel"><span>Total spend</span><b>${fmt.money(s.spend)}</b></div>
        <div class="panel highlight"><span>Total saved</span><b class="gold">${fmt.money(s.saved)}</b></div>
        <div class="panel"><span>Avg basket</span><b>${fmt.money(s.avg_basket)}</b></div>
        <div class="panel"><span>Favourite branch</span><b>${s.favorite_branch || '—'}</b></div>
        <div class="panel"><span>Last visit</span><b>${s.last_visit ? fmt.rel(s.last_visit) : '—'}</b></div>
      </section>

      <section class="dash-grid g-2-1">
        <div class="panel">
          <div class="panel-head"><div><div class="panel-title">${ic('chart')}Monthly spend</div><div class="panel-sub">Last 12 months · Royal purchases</div></div>
            <button class="btn btn-ghost btn-sm" id="tbl-toggle">${ic(tableMode ? 'chart' : 'list', 'i-sm')}${tableMode ? 'Chart' : 'Table'}</button></div>
          <div class="panel-body"><div id="monthly" class="chart-box"></div></div>
        </div>
        <div class="panel">
          <div class="panel-head"><div class="panel-title">${ic('store')}Branches visited</div></div>
          <div class="panel-body">
            ${d.branches_used.length ? html`<div class="visit-list">${d.branches_used.map((b) => html`<div class="row"><span class="grow">${b.short_name}</span><b class="tnum">${b.n}</b><span class="muted small">visits</span></div>`)}</div>` : html`<div class="muted">No visits yet.</div>`}
            <div class="divider"></div>
            <div class="panel-title small-title">${ic('cards', 'i-sm')}Card history</div>
            <div class="visit-list">${d.cards.map((c) => html`<div class="row"><span class="mono grow">${fmt.mask(c.card_number)}</span>${tierChip(c.tier.name, c.tier.theme)}${statusChip(c.effective_status)}</div>
              <div class="cell-sub">Issued ${fmt.date(c.issued_at)}${c.status_reason ? ' · ' + c.status_reason : ''}</div>`)}</div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><div><div class="panel-title">${ic('receipt')}Transactions</div><div class="panel-sub">Latest 60 Royal discounts</div></div></div>
        ${d.transactions.length ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th>Date</th><th>Receipt</th><th>Branch</th><th class="r">Bill</th><th class="r">Discount</th><th class="r">Net</th><th>Cashier</th><th>Status</th><th></th></tr></thead>
          <tbody>${d.transactions.map((t) => html`<tr class="${t.status === 'void' ? 'void' : ''}">
            <td>${fmt.dateTime(t.created_at)}</td><td class="mono small">${t.txn_no}</td><td>${t.branch_short}</td>
            <td class="r">${fmt.money(t.bill_amount)}</td><td class="r gold">− ${fmt.amount(t.discount_amount)}</td><td class="r"><b>${fmt.money(t.net_amount)}</b></td>
            <td>${t.cashier_name || t.api_key_name || '—'}</td><td>${statusChip(t.status)}${t.void_reason ? html`<div class="cell-sub">${t.void_reason}</div>` : ''}</td>
            <td class="r nowrap"><button class="btn btn-ghost btn-sm" data-slip="${t.id}" title="Print slip">${ic('printer', 'i-sm')}</button>
              ${staff && t.status !== 'void' ? html`<button class="btn btn-ghost btn-sm" data-void="${t.id}" title="Void">${ic('ban', 'i-sm')}</button>` : ''}</td></tr>`)}</tbody></table></div>`
    : html`<div class="empty">${ic('receipt')}No transactions yet — the first Royal discount will appear here.</div>`}
      </section>`);

      cleanups.push(bindCard3d(root));
      drawMonthly();
      $('#tbl-toggle', root).addEventListener('click', (e) => {
        tableMode = !tableMode;
        e.currentTarget.innerHTML = String(html`${ic(tableMode ? 'chart' : 'list', 'i-sm')}${tableMode ? 'Chart' : 'Table'}`);
        drawMonthly();
      });
    }

    function drawMonthly() {
      const el = $('#monthly', root);
      const byMonth = new Map(d.monthly.map((x) => [x.month, x]));
      const months = [];
      const now = new Date(Date.now() + store.clockOffset);
      for (let i = 11; i >= 0; i--) {
        const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        const key = dt.toISOString().slice(0, 7);
        const r = byMonth.get(key);
        months.push({ key, label: fmt.monthName(key).split(' ')[0], value: r ? r.gross : 0, r });
      }
      if (tableMode) {
        el.innerHTML = tableHtml([{ label: 'Month' }, { label: 'Visits', r: 1 }, { label: 'Spend', r: 1 }, { label: 'Saved', r: 1 }],
          months.slice().reverse().map((x) => [fmt.monthName(x.key), fmt.int(x.r?.txns || 0), fmt.money(x.value), fmt.money(x.r?.saved || 0)]));
        return;
      }
      cleanups.push(columnChart(el, {
        items: months,
        tooltip: (x) => ({ head: fmt.monthName(x.key), rows: [{ label: 'Spend', value: fmt.money(x.value) }, { label: 'Saved', value: fmt.money(x.r?.saved || 0) }, { label: 'Visits', value: fmt.int(x.r?.txns || 0) }] }),
      }));
    }

    async function act(name) {
      const card = d.cards[0];
      const data = cardData({ member: d.member, card, tier: card.tier, branches: store.branches });
      try {
        switch (name) {
          case 'print':
            printCards([data], 'cr80');
            await api('/cards/printed', { method: 'POST', body: { ids: [card.id] } });
            setTimeout(load, 1500);
            break;
          case 'png-front':
          case 'png-back': {
            const side = name.endsWith('front') ? 'front' : 'back';
            toast('Rendering high-resolution PNG…', '', 'info', 1800);
            const blob = await cardPngBlob(data, side);
            downloadBlob(blob, `royal-card-${d.member.member_code}-${side}.png`);
            break;
          }
          case 'copy': await copyText(memberLink(d.member.public_token), 'Digital card link copied'); break;
          case 'edit': openMemberForm({ member: d.member, onSaved: load }); break;
          case 'tier': {
            const v = await confirmDialog({ title: 'Change card tier', text: 'The new discount applies from the next scan. The card number stays the same.', confirmText: 'Change tier', icon: 'crown',
              input: { label: 'New tier', options: store.tiers.filter((t) => t.active).map((t) => ({ value: t.id, label: `${t.name} — ${t.discount_pct}% off` })) } });
            if (!v) return;
            await api(`/cards/${card.id}/tier`, { method: 'PUT', body: { tier_id: Number(v) } });
            toast('Tier updated', '', 'good');
            break;
          }
          case 'renew': {
            const today = qatarNow().toISOString().slice(0, 10);
            if (!await confirmDialog({ title: 'Renew card', text: `Extend validity by ${store.settings.card_validity_years} year(s) from ${fmt.date(card.expires_at > today ? card.expires_at : today)}?`, confirmText: 'Renew', icon: 'refresh' })) return;
            const r = await api(`/cards/${card.id}/renew`, { method: 'POST', body: {} });
            toast('Card renewed', `Valid until ${fmt.date(r.card.expires_at)}`, 'good');
            break;
          }
          case 'suspend':
          case 'block': {
            const reason = await confirmDialog({
              title: name === 'block' ? 'Block this card' : 'Suspend this card', danger: name === 'block',
              text: name === 'block' ? 'A blocked card is refused at every counter. Only an administrator can unblock it.' : 'The card is refused until you re-activate it.',
              confirmText: name === 'block' ? 'Block card' : 'Suspend card', input: { label: 'Reason', placeholder: 'e.g. Card shared with non-member', required: true, min: 3 },
            });
            if (!reason) return;
            await api(`/cards/${card.id}/status`, { method: 'PUT', body: { status: name === 'block' ? 'blocked' : 'suspended', reason } });
            toast(name === 'block' ? 'Card blocked' : 'Card suspended', '', 'info');
            break;
          }
          case 'activate':
            await api(`/cards/${card.id}/status`, { method: 'PUT', body: { status: 'active' } });
            toast('Card re-activated', '', 'good');
            break;
          case 'replace': {
            const reason = await confirmDialog({ title: 'Replace card', text: 'The old card stops working immediately and a new card number is issued. History and savings are kept.', confirmText: 'Issue new card', icon: 'cards',
              input: { label: 'Reason', options: [{ value: 'lost', label: 'Lost' }, { value: 'stolen', label: 'Stolen' }, { value: 'damaged', label: 'Damaged' }, { value: 'upgrade', label: 'Upgrade / redesign' }] } });
            if (!reason) return;
            const r = await api(`/members/${id}/replace-card`, { method: 'POST', body: { reason } });
            toast('New card issued', `Card ${fmt.card(r.card.card_number)}`, 'gold', 6000);
            break;
          }
          case 'rotate': {
            if (!await confirmDialog({ title: 'Create a new digital-card link?', text: 'The old link will stop working. Send the new one to the member.', confirmText: 'Create new link', icon: 'key' })) return;
            await api(`/members/${id}/rotate-link`, { method: 'POST', body: {} });
            toast('New link created', 'Send it again via WhatsApp', 'good');
            break;
          }
          default: return;
        }
        if (!['copy', 'edit', 'png-front', 'png-back', 'print'].includes(name)) await load();
      } catch (err) { toastError(err); }
    }

    on(root, 'click', '[data-act]', (e, b) => act(b.dataset.act));
    on(root, 'click', '[data-slip]', async (e, b) => {
      const t = d.transactions.find((x) => x.id === Number(b.dataset.slip));
      if (t) printReceipt(t, { stats: d.stats });
    });
    on(root, 'click', '[data-void]', async (e, b) => {
      const t = d.transactions.find((x) => x.id === Number(b.dataset.void));
      const reason = await confirmDialog({ title: `Void ${t.txn_no}?`, danger: true, text: `Bill ${fmt.money(t.bill_amount)} · discount ${fmt.money(t.discount_amount)}. The discount will be reversed in all reports.`,
        confirmText: 'Void transaction', input: { label: 'Reason', placeholder: 'e.g. Customer returned items', required: true, min: 3 } });
      if (!reason) return;
      try {
        await api(`/transactions/${t.id}/void`, { method: 'POST', body: { reason } });
        toast('Transaction voided', t.txn_no, 'info');
        await load();
      } catch (err) { toastError(err); }
    });

    await load();
    return () => cleanups.forEach((f) => f());
  },
};
