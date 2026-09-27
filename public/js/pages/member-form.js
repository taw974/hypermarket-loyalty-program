// Shared "enroll / edit member" dialog with a celebratory new-card reveal.
import { api, store, html, raw, ic, modal, toast, withBusy, fmt, memberLink, whatsappLink, confetti, sound } from '../core.js';
import { card3dHtml, bindCard3d, cardData } from '../card.js';
import { printCards } from '../print.js';

const NATIONALITIES = ['Qatar', 'India', 'Bangladesh', 'Pakistan', 'Philippines', 'Egypt', 'Nepal', 'Sri Lanka', 'Jordan', 'Sudan', 'Syria', 'Lebanon', 'Palestine', 'Kenya', 'Uganda', 'Indonesia', 'Other'];

export function openMemberForm({ member = null, prefill = {}, onSaved } = {}) {
  const u = store.user;
  const editing = !!member;
  const v = { ...prefill, ...(member || {}) };
  const localMobile = String(v.mobile || '').replace(/^\+974/, '');
  const branchLocked = !!u.branch_id && u.role !== 'admin';
  const tiers = store.tiers.filter((t) => t.active);
  const defaultTier = (tiers.find((t) => t.is_default) || tiers[0] || {}).id;

  const m = modal({
    title: editing ? 'Edit member' : 'Enroll a Royal member',
    sub: editing ? `${v.member_code} · card details stay the same` : 'A unique Royal card number, QR code and barcode are generated instantly',
    size: 'wide',
    body: html`<form id="mf" class="form-grid" autocomplete="off">
      <div class="field span-2"><label>Full name *</label><input class="input" name="full_name" value="${v.full_name || ''}" required maxlength="80" placeholder="As on QID / passport"></div>
      <div class="field"><label>Mobile number *</label>
        <div class="input-group"><span class="prefix">+974</span><input class="input has-prefix" name="mobile" value="${localMobile}" required inputmode="tel" placeholder="3058 5327"></div>
        <span class="hint">8-digit Qatar number, or full international number with +</span></div>
      <div class="field"><label>Email</label><input class="input" name="email" type="email" value="${v.email || ''}" placeholder="optional"></div>
      <div class="field"><label>QID / ID number</label><input class="input" name="qid" value="${v.qid || ''}" placeholder="optional"></div>
      <div class="field"><label>Nationality</label><input class="input" name="nationality" list="nat-list" value="${v.nationality || ''}" placeholder="optional">
        <datalist id="nat-list">${NATIONALITIES.map((n) => html`<option value="${n}"></option>`)}</datalist></div>
      <div class="field"><label>Gender</label><select class="select" name="gender">
        <option value="">—</option><option value="male" ${v.gender === 'male' ? 'selected' : ''}>Male</option><option value="female" ${v.gender === 'female' ? 'selected' : ''}>Female</option></select></div>
      <div class="field"><label>Date of birth</label><input class="input" name="birth_date" type="date" value="${v.birth_date || ''}"></div>
      <div class="field"><label>Home branch</label><select class="select" name="home_branch_id" ${branchLocked ? 'disabled' : ''}>
        ${store.branches.map((b) => html`<option value="${b.id}" ${(v.home_branch_id || u.branch_id) === b.id ? 'selected' : ''}>${b.code} · ${b.short_name}</option>`)}</select></div>
      ${editing ? '' : html`<div class="field"><label>Card tier</label><select class="select" name="tier_id" ${u.role === 'cashier' ? 'disabled' : ''}>
        ${tiers.map((t) => html`<option value="${t.id}" ${t.id === defaultTier ? 'selected' : ''}>${t.name} — ${t.discount_pct}% off</option>`)}</select></div>`}
      <div class="field span-2"><label>Notes</label><textarea class="textarea" name="notes" maxlength="500" placeholder="Anything the team should know (optional)">${v.notes || ''}</textarea></div>
      <div class="form-error hidden span-2" data-err></div>
    </form>`,
    foot: html`<button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" form="mf" type="submit" data-busy="${editing ? 'Saving…' : 'Creating card…'}">${ic(editing ? 'check' : 'crown')}${editing ? 'Save changes' : 'Create Royal card'}</button>`,
  });

  m.$('#mf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    if (branchLocked) body.home_branch_id = u.branch_id;
    if (u.role === 'cashier') delete body.tier_id;
    const err = m.$('[data-err]');
    err.classList.add('hidden');
    try {
      const out = await withBusy(m.$('.modal-foot .btn-primary'), () => (editing
        ? api(`/members/${member.id}`, { method: 'PUT', body })
        : api('/members', { method: 'POST', body })));
      if (editing) {
        m.close();
        toast('Member updated', out.member.full_name, 'good');
        onSaved && onSaved(out);
        return;
      }
      showNewCard(m, out, onSaved);
    } catch (ex) {
      err.innerHTML = String(html`${ic('alert', 'i-sm')}<span>${ex.message}</span>`);
      err.classList.remove('hidden');
    }
  });
  return m;
}

function showNewCard(m, out, onSaved) {
  const data = cardData({ member: out.member, card: out.card, tier: out.tier, branches: store.branches });
  const link = memberLink(out.member.public_token);
  const first = out.member.full_name.split(' ')[0];
  const msg = `Dear ${first}, welcome to the ${store.settings.program_name}! 👑\nYour card no: ${fmt.card(out.card.card_number)}\nEnjoy ${out.tier.discount_pct}% instant discount at all Welcome Friends & Al Madina Hypermarket branches.\nYour digital card: ${link}`;
  m.el.querySelector('.modal-title').textContent = 'Royal card created';
  m.el.querySelector('.modal-sub').textContent = `${out.member.member_code} · ${out.tier.name} · ${out.tier.discount_pct}% off at all branches`;
  m.el.querySelector('.modal-body').innerHTML = String(html`<div class="newcard">
    <div class="newcard-card">${raw(card3dHtml(data, { hint: true }))}</div>
    <div class="newcard-info">
      <div class="newcard-kicker">${ic('sparkles', 'i-sm')} Welcome to the royal family</div>
      <div class="newcard-name display">${out.member.full_name}</div>
      <div class="newcard-no">${fmt.card(out.card.card_number)}</div>
      <div class="muted">Valid thru ${fmt.mmyy(out.card.expires_at)} · ${fmt.phone(out.member.mobile)}</div>
      <div class="newcard-actions">
        <button class="btn btn-outline" data-act="print">${ic('printer')}Print card</button>
        <a class="btn btn-outline" href="${whatsappLink(out.member.mobile, msg)}" target="_blank" rel="noopener">${ic('whatsapp')}Send on WhatsApp</a>
        <a class="btn btn-ghost" href="${link}" target="_blank" rel="noopener">${ic('phoneSmall')}Digital card</a>
      </div>
    </div></div>`);
  m.el.querySelector('.modal-foot').innerHTML = String(html`<button class="btn btn-primary" data-done>${ic('check')}Done</button>`);
  const unbind = bindCard3d(m.el);
  confetti({ y: 0.35, count: 120 });
  sound.play('success');
  m.el.querySelector('[data-act=print]').addEventListener('click', () => {
    printCards([data], 'cr80');
    api('/cards/printed', { method: 'POST', body: { ids: [out.card.id] } }).catch(() => {});
  });
  m.el.querySelector('[data-done]').addEventListener('click', () => { unbind(); m.close(); });
  onSaved && onSaved(out);
}
