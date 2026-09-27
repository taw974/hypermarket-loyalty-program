// POS terminal — the counter screen. Scan → verify → enter bill → 15% applied.
import {
  api, store, html, raw, ic, $, $$, on, fmt, toast, toastError, confirmDialog, statusChip, tierChip, avatar,
  sound, confetti, countUp,
} from '../core.js';
import { card3dHtml, bindCard3d, cardData } from '../card.js';
import { listenForScanner, cameraScan } from '../scanner.js';
import { printReceipt } from '../print.js';
import { openMemberForm } from './member-form.js';

const BRANCH_KEY = 'rl.posBranch';

export default {
  title: 'POS Terminal',
  sub: 'Scan · verify · apply the Royal discount',
  async render(root) {
    const u = store.user;
    const lockedBranch = u.role !== 'admin' && u.branch_id ? u.branch_id : null;
    let branchId = lockedBranch || Number(localStorage.getItem(BRANCH_KEY)) || null;
    if (branchId && !store.branch(branchId)) branchId = null;

    let hit = null; // lookup result
    let lastTxn = null;
    let lastStats = null;
    let resetTimer = null;
    let unbindCard = null;
    let busy = false;

    root.innerHTML = String(html`
    <div class="pos">
      <div class="pos-bar panel">
        <div class="pos-branch">
          <span class="pos-branch-ic">${ic('store')}</span>
          ${lockedBranch ? html`<div><div class="cell-main">${store.branch(lockedBranch).name}</div><div class="cell-sub">${store.branch(lockedBranch).code} · Counter: ${u.full_name}</div></div>`
    : html`<div><label class="label" for="pos-branch">Counter branch</label>
            <select class="select select-inline" id="pos-branch">
              <option value="">Select branch…</option>
              ${store.branches.filter((b) => b.active).map((b) => html`<option value="${b.id}" ${b.id === branchId ? 'selected' : ''}>${b.code} · ${b.name}</option>`)}
            </select></div>`}
        </div>
        <div class="pos-today" id="pos-today"></div>
        <div class="row">
          <button class="btn btn-ghost btn-icon" id="pos-sound" aria-label="Sound">${ic(sound.enabled ? 'volume' : 'volume-x')}</button>
          <button class="btn btn-ghost btn-sm" id="pos-display" title="Open the customer-facing screen (for a second monitor)">${ic('maximize')}Customer screen</button>
          <button class="btn btn-outline btn-sm" id="pos-enroll">${ic('user-plus')}New member</button>
        </div>
      </div>
      <div class="pos-grid" id="pos-grid">
        <section class="panel pos-left" id="pos-left"></section>
        <section class="panel pos-right" id="pos-right"></section>
      </div>
      <section class="panel pos-recent">
        <div class="panel-head"><div><div class="panel-title">${ic('history')}Recent at this counter</div><div class="panel-sub">Today's Royal discounts at the selected branch — reprint a slip any time</div></div></div>
        <div id="pos-recent" class="panel-body"></div>
      </section>
    </div>`);

    const left = $('#pos-left', root);
    const right = $('#pos-right', root);

    // ---------- Left side ----------
    function renderIdle(message = '') {
      hit = null;
      if (unbindCard) { unbindCard(); unbindCard = null; }
      left.innerHTML = String(html`<div class="scan-zone">
        <div class="scan-orb" aria-hidden="true"><span class="ring r1"></span><span class="ring r2"></span><span class="ring r3"></span>
          <span class="orb-core">${ic('scan', 'i-xl')}</span><span class="laser"></span></div>
        <h2 class="display scan-title">Scan Royal Card</h2>
        <p class="muted scan-help">Scanner, camera or keyboard — card number, QR, barcode or member mobile</p>
        <form class="scan-form" id="scan-form" data-scan-input>
          <div class="input-group scan-input">${ic('card')}<input class="input input-xl" id="scan-input" placeholder="Scan or type card no. / mobile" autocomplete="off" spellcheck="false" inputmode="numeric" aria-label="Card number or mobile"></div>
          <button class="btn btn-primary btn-lg" type="submit">${ic('search')}Find</button>
        </form>
        ${message ? html`<div class="scan-msg">${ic('alert', 'i-sm')}${message}</div>` : ''}
        <div class="scan-alt">
          <button class="btn btn-ghost" id="cam-btn">${ic('camera')}Camera scan <span class="kbd">F4</span></button>
          <span class="muted">·</span>
          <span class="muted row">${ic('zap', 'i-sm')} USB scanners work anywhere on this screen</span>
        </div>
      </div>`);
      $('#scan-form', left).addEventListener('submit', (e) => {
        e.preventDefault();
        const v = $('#scan-input', left).value.trim();
        if (v) lookup(v);
      });
      $('#cam-btn', left).addEventListener('click', openCamera);
      setTimeout(() => $('#scan-input', left)?.focus(), 30);
      renderBill();
    }

    function renderLoading(code) {
      left.innerHTML = String(html`<div class="scan-zone"><div class="scan-orb loading"><span class="ring r1"></span><span class="ring r2"></span><span class="orb-core"><span class="spinner"></span></span></div>
        <h2 class="display scan-title">Verifying…</h2><p class="muted mono">${code}</p></div>`);
    }

    function renderHit() {
      const { card, member, tier, stats, eligibility: ev } = hit;
      const data = cardData({ member, card, tier, branches: store.branches });
      if (unbindCard) unbindCard();
      const stamp = ev.ok ? '' : (ev.blocks[0].code === 'daily_limit' ? 'LIMIT REACHED' : String(ev.status || 'invalid').toUpperCase());
      left.innerHTML = String(html`<div class="hit ${ev.ok ? 'ok' : 'blocked'} rise">
        <div class="hit-card">${raw(card3dHtml(data, { hint: true }))}${stamp ? html`<div class="hit-stamp">${ic('ban')}${stamp}</div>` : ''}</div>
        <div class="hit-body">
          <div class="hit-person">
            ${avatar(member.full_name, tier.theme, 50)}
            <div class="grow">
              <div class="hit-name display">${member.full_name}</div>
              <div class="cell-sub">${member.member_code} · ${fmt.phone(member.mobile)}${member.home_branch ? ' · Home: ' + member.home_branch : ''}</div>
              <div class="hit-chips">${tierChip(tier.name, tier.theme)}${statusChip(card.effective_status)}</div>
            </div>
          </div>
          ${ev.blocks.map((b) => html`<div class="alert alert-critical">${ic('ban')}<div><b>Do not apply discount</b><div>${b.message}</div>
            ${hit.newer_card ? html`<div class="cell-sub">Member's current card ends in ${hit.newer_card.last4}</div>` : ''}</div></div>`)}
          <div class="hit-stats">
            <div><span>Visits</span><b>${fmt.int(stats.visits)}</b></div>
            <div><span>Total saved</span><b>${fmt.money(stats.saved)}</b></div>
            <div><span>Avg basket</span><b>${fmt.money(stats.avg_basket)}</b></div>
            <div><span>Last visit</span><b>${stats.last_visit ? fmt.rel(stats.last_visit) : 'First visit!'}</b></div>
          </div>
          ${ev.warnings.map((w) => html`<div class="alert alert-warn">${ic(w.code === 'expiring' ? 'clock' : 'info')}<div>${w.message}</div></div>`)}
          ${ev.ok && hit.matched_by !== 'card' ? html`<div class="alert alert-info">${ic('info')}<div>Found by ${hit.matched_by === 'mobile' ? 'mobile number' : 'member code'} — please check the physical or digital card.</div></div>` : ''}
          <div class="hit-actions">
            <a class="btn btn-ghost btn-sm" href="#/members/${member.id}">${ic('user')}Profile</a>
            <button class="btn btn-ghost btn-sm" id="hit-clear">${ic('x')}Clear <span class="kbd">Esc</span></button>
          </div>
        </div></div>`);
      unbindCard = bindCard3d(left);
      $('#hit-clear', left).addEventListener('click', () => renderIdle());
      renderBill();
      if (ev.ok) {
        sound.play('scan');
        setTimeout(() => $('#bill-input', right)?.focus(), 60);
      } else {
        sound.play('error');
        left.querySelector('.hit').classList.add('shake');
      }
    }

    // ---------- Right side: bill ----------
    function renderBill() {
      const ready = hit && hit.eligibility.ok;
      const pct = hit ? hit.tier.discount_pct : (store.tiers.find((t) => t.is_default)?.discount_pct ?? 15);
      right.innerHTML = String(html`<div class="bill ${ready ? '' : 'locked'}">
        <div class="bill-head"><span class="label">Bill amount</span><span class="chip chip-gold">${ic('percent')}Royal ${pct}% off</span></div>
        <div class="bill-amount"><span class="cur">${store.currency}</span>
          <input id="bill-input" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-label="Bill amount" ${ready ? '' : 'disabled'}></div>
        <div class="keypad" id="keypad">
          ${['7', '8', '9', 'del', '4', '5', '6', '.', '1', '2', '3', '0'].map((k) => html`<button type="button" data-k="${k}" ${ready ? '' : 'disabled'}>${k === 'del' ? ic('delete') : k}</button>`)}
        </div>
        <div class="field bill-inv"><label for="inv-input">POS invoice no.${store.settings.require_pos_invoice ? ' *' : ' (optional)'}</label>
          <input class="input" id="inv-input" autocomplete="off" placeholder="e.g. INV-01-482311" ${ready ? '' : 'disabled'}></div>
        <div class="calc" id="calc">
          <div class="calc-row"><span>Bill total</span><b id="c-bill">${fmt.money(0)}</b></div>
          <div class="calc-row disc"><span>Royal discount (${pct}%)</span><b id="c-disc">− ${fmt.money(0)}</b></div>
          <div class="calc-net"><span>NET PAYABLE</span><b id="c-net">${fmt.money(0)}</b></div>
          <div class="calc-note" id="c-note"></div>
        </div>
        <button class="btn btn-primary btn-xl btn-block" id="apply-btn" ${ready ? '' : 'disabled'}>${ic('crown')}Apply Royal Discount <span class="kbd">Enter</span></button>
        ${ready ? '' : html`<div class="bill-lock">${ic(hit ? 'ban' : 'lock', 'i-lg')}<span>${hit ? 'Discount not available for this card' : 'Scan a Royal card to begin'}</span></div>`}
      </div>`);
      if (!ready) return;
      const input = $('#bill-input', right);
      input.addEventListener('input', () => { sanitize(input); recalc(); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
      $('#inv-input', right).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
      on($('#keypad', right), 'click', 'button', (e, b) => {
        const k = b.dataset.k;
        if (k === 'del') input.value = input.value.slice(0, -1);
        else input.value += k;
        sanitize(input);
        recalc();
        input.focus();
      });
      $('#apply-btn', right).addEventListener('click', apply);
      recalc();
    }

    function sanitize(input) {
      let v = input.value.replace(/[^\d.]/g, '');
      const i = v.indexOf('.');
      if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '').slice(0, 2);
      const [a, b] = v.split('.');
      v = (a || '').replace(/^0+(?=\d)/, '').slice(0, 7) + (b !== undefined ? '.' + b : '');
      if (v !== input.value) input.value = v;
    }

    function calc(bill) {
      const pct = hit.tier.discount_pct;
      let disc = Math.round(bill * pct) / 100;
      disc = Math.round((disc + Number.EPSILON) * 100) / 100;
      const cap = Number(hit.rules.max_discount_per_txn) || 0;
      const capped = cap > 0 && disc > cap;
      if (capped) disc = cap;
      return { disc, net: Math.round((bill - disc) * 100) / 100, capped };
    }

    function recalc() {
      const bill = Number($('#bill-input', right)?.value) || 0;
      const { disc, net, capped } = calc(bill);
      $('#c-bill', right).textContent = fmt.money(bill);
      $('#c-disc', right).textContent = '− ' + fmt.money(disc);
      $('#c-net', right).textContent = fmt.money(net);
      const note = $('#c-note', right);
      const min = Number(hit.rules.min_bill_amount) || 0;
      if (bill > 0 && min > 0 && bill < min) note.innerHTML = String(html`${ic('alert', 'i-sm')} Minimum bill for the Royal discount is ${fmt.money(min)}`);
      else if (capped) note.innerHTML = String(html`${ic('info', 'i-sm')} Discount capped at ${fmt.money(hit.rules.max_discount_per_txn)} per bill`);
      else note.innerHTML = bill > 0 ? String(html`${ic('sparkles', 'i-sm')} ${hit.member.full_name.split(' ')[0]} saves <b>${fmt.money(disc)}</b> on this bill`) : '';
      $('#calc', right).classList.toggle('live', bill > 0);
    }

    // ---------- Actions ----------
    async function lookup(code) {
      if (busy) return;
      if (!branchId) { toast('Select the counter branch first', 'Choose which branch this terminal is at.', 'bad'); $('#pos-branch', root)?.focus(); return; }
      clearTimeout(resetTimer);
      closeSuccess();
      busy = true;
      renderLoading(code);
      try {
        hit = await api('/pos/lookup', { query: { code, branch_id: branchId } });
        renderHit();
      } catch (err) {
        sound.play('error');
        const digits = code.replace(/\D/g, '');
        renderIdle(err.message);
        if (err.status === 404 && (digits.length === 8 || code.trim().startsWith('+'))) {
          const ok = await confirmDialog({ title: 'No member with this mobile', text: `Would you like to enroll ${code} as a new Royal member now?`, confirmText: 'Enroll member', icon: 'user-plus' });
          if (ok) enroll({ mobile: code });
        }
      } finally {
        busy = false;
      }
    }

    async function apply(confirmDuplicate = false) {
      if (busy || !hit || !hit.eligibility.ok) return;
      const input = $('#bill-input', right);
      const bill = Number(input.value);
      if (!bill || bill <= 0) { input.focus(); input.closest('.bill-amount').classList.add('shake'); setTimeout(() => input.closest('.bill-amount')?.classList.remove('shake'), 500); return; }
      const inv = $('#inv-input', right).value.trim();
      if (store.settings.require_pos_invoice && !inv) { toast('POS invoice number is required', '', 'bad'); $('#inv-input', right).focus(); return; }
      const warnAt = Number(hit.rules.large_bill_warning) || 0;
      if (!confirmDuplicate && warnAt > 0 && bill >= warnAt) {
        const ok = await confirmDialog({ title: 'Large bill — please confirm', text: `The bill amount is ${fmt.money(bill)}. Is this correct?`, confirmText: 'Yes, apply discount', icon: 'alert' });
        if (!ok) { input.focus(); return; }
      }
      busy = true;
      const btn = $('#apply-btn', right);
      btn.classList.add('is-loading');
      try {
        const out = await api('/pos/redeem', { method: 'POST', body: { code: hit.card.card_number, bill_amount: bill, pos_invoice: inv, branch_id: branchId, confirm_duplicate: confirmDuplicate } });
        lastTxn = out.txn;
        lastStats = out.stats;
        showSuccess(out);
        loadToday();
      } catch (err) {
        if (err.status === 409 && err.data?.code === 'duplicate') {
          busy = false;
          btn.classList.remove('is-loading');
          const ok = await confirmDialog({ title: 'Possible duplicate', text: err.message + ' Apply the discount again anyway?', confirmText: 'Apply anyway', danger: true });
          if (ok) return apply(true);
          return;
        }
        sound.play('error');
        toastError(err);
        if (err.status === 422) lookup(hit.card.card_number);
      } finally {
        busy = false;
        btn?.classList.remove('is-loading');
      }
    }

    function showSuccess({ txn, stats }) {
      sound.play('success');
      confetti({ x: 0.5, y: 0.42 });
      const grid = $('#pos-grid', root);
      const ov = document.createElement('div');
      ov.className = 'pos-success';
      ov.innerHTML = String(html`<div class="success-inner">
        <div class="success-badge"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg></div>
        <div class="success-kicker">ROYAL DISCOUNT APPLIED · ${txn.discount_pct}%</div>
        <div class="success-amount"><span class="cur">${store.currency}</span><span id="sx-amt">0.00</span></div>
        <div class="success-who">saved by <b>${txn.member_name}</b></div>
        <div class="success-net">
          <div><span>Bill</span><b>${fmt.money(txn.bill_amount)}</b></div>
          <div class="collect"><span>Collect from customer</span><b>${fmt.money(txn.net_amount)}</b></div>
          <div><span>Lifetime savings</span><b>${fmt.money(stats.saved)}</b></div>
        </div>
        <div class="muted small">Receipt ${txn.txn_no} · ${fmt.time(txn.created_at)} · ${txn.branch_short}</div>
        <div class="success-actions">
          <button class="btn btn-outline btn-lg" id="sx-print">${ic('printer')}Print slip <span class="kbd">F9</span></button>
          <button class="btn btn-primary btn-lg" id="sx-next">${ic('arrow-right')}Next customer <span class="kbd">Enter</span></button>
        </div>
        <div class="auto-reset"><span></span></div>
      </div>`);
      grid.appendChild(ov);
      countUp(ov.querySelector('#sx-amt'), txn.discount_amount, { dur: 1100, from: 0, format: (v) => fmt.amount(v) });
      ov.querySelector('#sx-print').addEventListener('click', () => printReceipt(txn, { stats }));
      ov.querySelector('#sx-next').addEventListener('click', () => { closeSuccess(); renderIdle(); });
      setTimeout(() => ov.querySelector('#sx-next')?.focus(), 50);
      resetTimer = setTimeout(() => { closeSuccess(); renderIdle(); }, 15000);
    }
    function closeSuccess() {
      clearTimeout(resetTimer);
      $$('.pos-success', root).forEach((x) => x.remove());
    }

    async function openCamera() {
      const code = await cameraScan();
      if (code) lookup(code);
    }

    function enroll(prefill = {}) {
      openMemberForm({
        prefill,
        onSaved: (out) => { if (out.card) setTimeout(() => lookup(out.card.card_number), 400); },
      });
    }

    // ---------- Today / recent ----------
    async function loadToday() {
      const box = $('#pos-recent', root);
      const today = $('#pos-today', root);
      if (!branchId) {
        today.innerHTML = String(html`<span class="muted">${ic('info', 'i-sm')} Select a branch to start</span>`);
        box.innerHTML = String(html`<div class="empty">${ic('store')}Choose the counter branch above.</div>`);
        return;
      }
      try {
        const r = await api('/pos/today', { query: { branch_id: branchId } });
        today.innerHTML = String(html`<div><span>Today</span><b>${fmt.int(r.kpis.txns)}</b><small>discounts</small></div>
          <div><span>Customers saved</span><b>${fmt.money(r.kpis.discount)}</b></div>
          <div><span>Royal sales</span><b>${fmt.money(r.kpis.gross)}</b></div>`);
        box.innerHTML = r.recent.length ? String(html`<div class="table-wrap"><table class="table">
          <thead><tr><th>Time</th><th>Receipt</th><th>Member</th><th class="r">Bill</th><th class="r">Discount</th><th class="r">Net</th><th>Status</th><th></th></tr></thead>
          <tbody>${r.recent.map((t) => html`<tr class="${t.status === 'void' ? 'void' : ''}">
            <td class="tnum">${fmt.time(t.created_at)}</td><td class="mono small">${t.txn_no}</td>
            <td><div class="cell-main">${t.member_name}</div><div class="cell-sub">${fmt.mask(t.card_number)} · ${t.cashier_name || t.api_key_name || ''}</div></td>
            <td class="r">${fmt.money(t.bill_amount)}</td><td class="r gold">− ${fmt.amount(t.discount_amount)}</td><td class="r"><b>${fmt.money(t.net_amount)}</b></td>
            <td>${statusChip(t.status)}</td>
            <td class="r"><button class="btn btn-ghost btn-sm" data-reprint="${t.id}">${ic('printer', 'i-sm')}Slip</button></td></tr>`)}</tbody></table></div>`)
          : String(html`<div class="empty">${ic('receipt')}No Royal discounts at this branch yet today.</div>`);
      } catch (err) {
        box.innerHTML = String(html`<div class="empty">${ic('alert')}${err.message}</div>`);
      }
    }
    on($('#pos-recent', root), 'click', '[data-reprint]', async (e, b) => {
      try {
        const r = await api(`/transactions/${b.dataset.reprint}`);
        printReceipt(r.txn);
      } catch (err) { toastError(err); }
    });

    // ---------- Wiring ----------
    $('#pos-branch', root)?.addEventListener('change', (e) => {
      branchId = Number(e.target.value) || null;
      if (branchId) localStorage.setItem(BRANCH_KEY, String(branchId));
      renderIdle();
      loadToday();
    });
    $('#pos-sound', root).addEventListener('click', (e) => {
      sound.enabled = !sound.enabled;
      e.currentTarget.innerHTML = String(ic(sound.enabled ? 'volume' : 'volume-x'));
      if (sound.enabled) sound.play('scan');
    });
    $('#pos-enroll', root).addEventListener('click', () => enroll());
    $('#pos-display', root).addEventListener('click', () => {
      if (!branchId) { toast('Select the counter branch first', '', 'bad'); return; }
      window.open(`/#/display?branch=${branchId}`, 'royal-customer-display', 'popup,width=1280,height=760');
    });

    const stopScanner = listenForScanner((code) => lookup(code));
    const onKey = (e) => {
      if (document.querySelector('.modal-root')) return;
      if (e.key === 'F2') { e.preventDefault(); closeSuccess(); renderIdle(); }
      else if (e.key === 'F4') { e.preventDefault(); openCamera(); }
      else if (e.key === 'F9') { e.preventDefault(); if (lastTxn) printReceipt(lastTxn, { stats: lastStats }); }
      else if (e.key === 'Escape') { if ($('.pos-success', root)) { closeSuccess(); renderIdle(); } else if (hit) renderIdle(); }
      else if (e.key === 'Enter' && $('.pos-success', root) && document.activeElement?.id !== 'sx-print') { e.preventDefault(); closeSuccess(); renderIdle(); }
      else if (/^[0-9.]$/.test(e.key) && !e.ctrlKey && !e.altKey && hit?.eligibility.ok && !$('.pos-success', root)
        && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        // Cashier started typing the amount without clicking the box first.
        $('#bill-input', right)?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const onTxn = (e) => { if (e.detail?.txn?.branch_id === branchId) loadToday(); };
    window.addEventListener('rl:txn', onTxn);

    renderIdle();
    loadToday();

    return () => {
      stopScanner();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('rl:txn', onTxn);
      clearTimeout(resetTimer);
      if (unbindCard) unbindCard();
    };
  },
};
