// Customer-facing display for a second screen at the counter: an idle "join
// Royal" showcase, and a celebration of the customer's savings the moment the
// cashier applies the discount.
import { api, store, html, raw, ic, fmt, $, confetti, countUp, hashQuery } from '../core.js';
import { card3dHtml, bindCard3d, cardData, withLuhn } from '../card.js';

export default {
  title: 'Customer display',
  async render(root) {
    const q = hashQuery();
    const lockBranch = store.user.role !== 'admin' && store.user.branch_id ? store.user.branch_id : null;
    const branchId = lockBranch || Number(q.branch) || Number(localStorage.getItem('rl.posBranch')) || store.branches[0]?.id;
    const branch = store.branch(branchId) || store.branches[0];
    const tier = store.tiers.find((t) => t.is_default) || { name: 'Royal Gold', theme: 'gold', discount_pct: 15 };
    let timer = null;
    let unbind = null;

    const sample = cardData({
      member: { full_name: 'Your Name Here', member_code: 'RM-10000' },
      card: { card_number: withLuhn('974021552026000'), issued_at: '2026-09-01', expires_at: '2028-09-01' },
      tier, branches: store.branches,
    });

    async function idle() {
      clearTimeout(timer);
      if (unbind) unbind();
      let today = null;
      try { today = await api('/pos/today', { query: { branch_id: branchId } }); } catch { /* optional */ }
      root.innerHTML = String(html`<div class="cd">
        <div class="cd-glow"></div>
        <div class="cd-top">${ic('crown')}<span>${branch.name}</span></div>
        <div class="cd-idle">
          <div class="cd-card">${raw(card3dHtml(sample, { floating: true, flippable: false }))}</div>
          <div class="cd-copy">
            <div class="cd-kicker">ROYAL LOYALTY CARD</div>
            <h1 class="display">Save <span class="foil-text">${tier.discount_pct}%</span><br>on every bill</h1>
            <div class="arabic cd-ar">وفّر ${tier.discount_pct}٪ على كل فاتورة</div>
            <p>At all 5 Welcome Friends &amp; Al Madina hypermarkets. Ask the cashier to join — it takes one minute.</p>
            ${today && today.kpis.txns ? html`<div class="cd-today">${ic('sparkles')}<span>Royal members saved <b>${fmt.money(today.kpis.discount)}</b> here today</span></div>` : ''}
          </div>
        </div>
        <div class="cd-foot">Welcome Friends Hypermarket <span>◆</span> Al Madina Hypermarket</div>
      </div>`);
      unbind = bindCard3d(root);
    }

    function celebrate(txn) {
      clearTimeout(timer);
      if (unbind) { unbind(); unbind = null; }
      const first = String(txn.member_name || '').split(' ')[0];
      root.innerHTML = String(html`<div class="cd cd-win">
        <div class="cd-glow"></div>
        <div class="cd-top">${ic('crown')}<span>${branch.name}</span></div>
        <div class="cd-thanks">
          <div class="cd-kicker">THANK YOU, ${first.toUpperCase()}</div>
          <div class="cd-saved-label">You saved today</div>
          <div class="cd-saved"><span class="cur">${store.currency}</span><span id="cd-amt">0.00</span></div>
          <div class="cd-bill">
            <div><span>Bill</span><b>${fmt.money(txn.bill_amount)}</b></div>
            <div><span>Royal ${txn.discount_pct}%</span><b class="gold">− ${fmt.money(txn.discount_amount)}</b></div>
            <div class="pay"><span>You pay</span><b>${fmt.money(txn.net_amount)}</b></div>
          </div>
          <div class="arabic cd-ar">شكراً لتسوقكم معنا</div>
        </div>
        <div class="cd-foot">Welcome Friends Hypermarket <span>◆</span> Al Madina Hypermarket</div>
      </div>`);
      countUp($('#cd-amt', root), txn.discount_amount, { from: 0, dur: 1400, format: fmt.amount });
      confetti({ y: 0.4, count: 180 });
      timer = setTimeout(idle, 14000);
    }

    const onTxn = (e) => {
      const { txn, type } = e.detail || {};
      if (type === 'created' && txn && txn.branch_id === branchId) celebrate(txn);
    };
    window.addEventListener('rl:txn', onTxn);
    document.body.classList.add('bare');
    await idle();
    return () => {
      clearTimeout(timer);
      if (unbind) unbind();
      window.removeEventListener('rl:txn', onTxn);
      document.body.classList.remove('bare');
    };
  },
};
