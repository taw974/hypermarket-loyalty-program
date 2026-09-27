'use strict';
// Auth, bootstrap metadata, POS terminal, members & cards.
const express = require('express');
const { one, all, run, tx, getSettings } = require('../db');
const {
  HttpError, nowLocal, todayLocal, addDays, addYears, round2, vStr, vEnum, normalizeMobile, toCsv, formatCardNumber, randomToken,
} = require('../util');
const {
  USER_SQL, verifyPassword, hashPassword, checkPasswordStrength, createSession, destroySession, requireAuth, requireRole,
  scopedBranch, throttleLogin, clearThrottle, clientIp, audit,
} = require('../auth');
const L = require('../logic');
const live = require('../live');

const r = express.Router();
const STAFF = ['admin', 'manager'];

const publicSettings = (s) => ({
  program_name: s.program_name, program_tagline: s.program_tagline, currency: s.currency, timezone: s.timezone,
  card_validity_years: s.card_validity_years, min_bill_amount: s.min_bill_amount, max_discount_per_txn: s.max_discount_per_txn,
  max_txn_per_card_per_day: s.max_txn_per_card_per_day, large_bill_warning: s.large_bill_warning,
  require_pos_invoice: s.require_pos_invoice, public_base_url: s.public_base_url, receipt_header: s.receipt_header,
  receipt_footer: s.receipt_footer, demo_mode: !!s.demo_mode, duplicate_window_sec: s.duplicate_window_sec,
});

// ---------------- Auth ----------------
r.get('/auth/me', (req, res) => {
  const s = getSettings();
  res.json({
    user: req.user || null,
    program: { name: s.program_name, tagline: s.program_tagline, demo_mode: !!s.demo_mode },
    demo_accounts: s.demo_mode ? all("SELECT username FROM users WHERE (is_demo = 1 OR username = 'admin') AND active = 1 ORDER BY id").map((u) => u.username) : [],
  });
});

r.post('/auth/login', (req, res) => {
  const username = vStr(req.body.username, 'Username', { required: true, max: 60 });
  const password = vStr(req.body.password, 'Password', { required: true, max: 200 });
  const key = clientIp(req) + '|' + username.toLowerCase();
  throttleLogin(key);
  const row = one('SELECT id, pass_hash, active FROM users WHERE username = ?', username);
  if (!row || !verifyPassword(password, row.pass_hash)) throw new HttpError(401, 'Incorrect username or password');
  if (!row.active) throw new HttpError(403, 'This account is disabled. Contact your administrator.');
  clearThrottle(key);
  createSession(req, res, row.id);
  run('UPDATE users SET last_login_at = ? WHERE id = ?', nowLocal(getSettings().timezone), row.id);
  req.user = one(`${USER_SQL} WHERE u.id = ?`, row.id);
  audit(req, 'auth.login', 'user', row.id);
  res.json({ user: req.user });
});

r.post('/auth/logout', (req, res) => {
  if (req.user) audit(req, 'auth.logout', 'user', req.user.id);
  destroySession(req, res);
  res.json({ ok: true });
});

r.post('/auth/password', requireAuth, (req, res) => {
  const row = one('SELECT pass_hash FROM users WHERE id = ?', req.user.id);
  if (!verifyPassword(String(req.body.current_password || ''), row.pass_hash)) throw new HttpError(400, 'Current password is incorrect');
  const pw = checkPasswordStrength(req.body.new_password);
  run('UPDATE users SET pass_hash = ? WHERE id = ?', hashPassword(pw), req.user.id);
  audit(req, 'user.password', 'user', req.user.id);
  res.json({ ok: true });
});

// ---------------- Bootstrap ----------------
r.get('/meta', requireAuth, (req, res) => {
  const s = getSettings();
  res.json({
    settings: publicSettings(s),
    branches: all('SELECT * FROM branches ORDER BY id'),
    tiers: all('SELECT * FROM tiers ORDER BY sort'),
    now: nowLocal(s.timezone),
    user: req.user,
  });
});

r.get('/live', requireAuth, (req, res) => live.subscribe(req, res));

// ---------------- POS terminal ----------------
function posBranch(req, requested) {
  const id = scopedBranch(req, requested);
  if (!id) throw new HttpError(400, 'Select the branch for this counter first');
  if (!one('SELECT id FROM branches WHERE id = ?', id)) throw new HttpError(400, 'Unknown branch');
  return id;
}

r.get('/pos/lookup', requireAuth, (req, res) => {
  const code = vStr(req.query.code, 'Card code', { required: true, max: 300 });
  const branchId = scopedBranch(req, req.query.branch_id);
  res.json(L.lookup(code, branchId));
});

r.post('/pos/redeem', requireAuth, (req, res) => {
  const branchId = posBranch(req, req.body.branch_id);
  const out = L.redeem({
    code: vStr(req.body.code, 'Card code', { required: true, max: 300 }),
    bill: req.body.bill_amount,
    invoice: req.body.pos_invoice,
    branchId,
    userId: req.user.id,
    confirmDuplicate: !!req.body.confirm_duplicate,
  });
  audit(req, 'txn.create', 'transaction', out.txn.id, { txn_no: out.txn.txn_no, bill: out.txn.bill_amount, discount: out.txn.discount_amount });
  live.publish('txn', { type: 'created', txn: out.txn }, out.txn.branch_id);
  res.status(201).json(out);
});

r.get('/pos/today', requireAuth, (req, res) => {
  const branchId = posBranch(req, req.query.branch_id);
  const tz = getSettings().timezone;
  const today = todayLocal(tz);
  const k = L.kpis(today, today, branchId);
  const recent = all(`${L.TXN_SELECT} WHERE t.branch_id = ? AND t.created_at >= ? ORDER BY t.id DESC LIMIT 8`, branchId, L.dayStart(today));
  res.json({ kpis: k, recent });
});

// ---------------- Members ----------------
const MEMBER_LIST_SQL = `
  SELECT m.id, m.member_code, m.full_name, m.mobile, m.email, m.nationality, m.created_at, m.home_branch_id, m.public_token,
         b.short_name AS home_branch,
         c.id AS card_id, c.card_number, c.status AS card_status, c.expires_at, c.printed_count,
         t.id AS tier_id, t.name AS tier_name, t.theme AS tier_theme, t.discount_pct,
         COALESCE(s.visits, 0) AS visits, COALESCE(s.spend, 0) AS spend, COALESCE(s.saved, 0) AS saved, s.last_visit
  FROM members m
  LEFT JOIN branches b ON b.id = m.home_branch_id
  LEFT JOIN cards c ON c.id = (SELECT MAX(id) FROM cards WHERE member_id = m.id)
  LEFT JOIN tiers t ON t.id = c.tier_id
  LEFT JOIN (SELECT member_id, COUNT(*) AS visits, SUM(bill_amount) AS spend, SUM(discount_amount) AS saved, MAX(created_at) AS last_visit
             FROM transactions WHERE status = 'completed' GROUP BY member_id) s ON s.member_id = m.id`;

function memberFilters(req) {
  const tz = getSettings().timezone;
  const today = todayLocal(tz);
  const where = [];
  const params = [];
  const q = String(req.query.q || '').trim();
  if (q) {
    const digits = q.replace(/\D/g, '');
    where.push(`(m.full_name LIKE ? OR m.member_code LIKE ? OR m.email LIKE ? OR m.qid LIKE ?${digits.length >= 3 ? ' OR m.mobile LIKE ? OR c.card_number LIKE ?' : ''})`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    if (digits.length >= 3) params.push(`%${digits}%`, `%${digits}%`);
  }
  if (req.query.tier_id) { where.push('t.id = ?'); params.push(Number(req.query.tier_id)); }
  if (req.query.branch_id) { where.push('m.home_branch_id = ?'); params.push(Number(req.query.branch_id)); }
  switch (req.query.status) {
    case 'active': where.push("c.status = 'active' AND c.expires_at >= ?"); params.push(today); break;
    case 'expired': where.push("c.status = 'active' AND c.expires_at < ?"); params.push(today); break;
    case 'expiring': where.push("c.status = 'active' AND c.expires_at >= ? AND c.expires_at <= ?"); params.push(today, addDays(today, 30)); break;
    case 'inactive': where.push("c.status IN ('suspended','blocked','lost','replaced')"); break;
    case 'unprinted': where.push("c.printed_count = 0 AND c.status = 'active'"); break;
    case 'dormant': where.push('(s.last_visit IS NULL OR s.last_visit < ?)'); params.push(L.dayStart(addDays(today, -29))); break;
    default: break;
  }
  const sorts = {
    recent: 'm.id DESC', name: 'm.full_name COLLATE NOCASE ASC', spend: 'spend DESC', visits: 'visits DESC',
    saved: 'saved DESC', last_visit: 's.last_visit DESC', expiry: 'c.expires_at ASC',
  };
  return { where: where.length ? 'WHERE ' + where.join(' AND ') : '', params, order: sorts[req.query.sort] || sorts.recent };
}

function decorateMember(row, today) {
  return { ...row, spend: round2(row.spend), saved: round2(row.saved), card_effective_status: L.effectiveStatus({ status: row.card_status, expires_at: row.expires_at }, today) };
}

r.get('/members', requireAuth, (req, res) => {
  const f = memberFilters(req);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 25));
  const page = Math.max(1, Number(req.query.page) || 1);
  const total = one(`SELECT COUNT(*) AS n FROM (${MEMBER_LIST_SQL} ${f.where})`, ...f.params).n;
  const today = todayLocal(getSettings().timezone);
  const rows = all(`${MEMBER_LIST_SQL} ${f.where} ORDER BY ${f.order} LIMIT ? OFFSET ?`, ...f.params, limit, (page - 1) * limit)
    .map((m) => decorateMember(m, today));
  res.json({ rows, total, page, limit });
});

r.get('/members/export.csv', requireRole(...STAFF), (req, res) => {
  const f = memberFilters(req);
  const today = todayLocal(getSettings().timezone);
  const rows = all(`${MEMBER_LIST_SQL} ${f.where} ORDER BY ${f.order}`, ...f.params).map((m) => decorateMember(m, today));
  const csv = toCsv([
    { label: 'Member Code', key: 'member_code' }, { label: 'Full Name', key: 'full_name' }, { label: 'Mobile', key: 'mobile' },
    { label: 'Email', key: 'email' }, { label: 'Nationality', key: 'nationality' }, { label: 'Home Branch', key: 'home_branch' },
    { label: 'Card Number', value: (m) => formatCardNumber(m.card_number) }, { label: 'Tier', key: 'tier_name' },
    { label: 'Discount %', key: 'discount_pct' }, { label: 'Card Status', key: 'card_effective_status' }, { label: 'Expires', key: 'expires_at' },
    { label: 'Visits', key: 'visits' }, { label: 'Total Spend', key: 'spend' }, { label: 'Total Saved', key: 'saved' },
    { label: 'Last Visit', key: 'last_visit' }, { label: 'Joined', key: 'created_at' },
  ], rows);
  audit(req, 'member.export', 'member', null, { count: rows.length });
  sendCsv(res, `royal-members-${today}.csv`, csv);
});

r.post('/members', requireAuth, (req, res) => {
  const input = { ...req.body };
  if (req.user.role === 'cashier') {
    delete input.tier_id; // cashiers always issue the default Royal tier
    input.home_branch_id = req.user.branch_id;
  }
  const branchId = req.user.branch_id || Number(input.home_branch_id) || null;
  const { member, card } = L.createMember(input, { userId: req.user.id, branchId });
  audit(req, 'member.create', 'member', member.id, { name: member.full_name, card: card.card_number.slice(-4) });
  live.publish('member', { type: 'created', member: { id: member.id, full_name: member.full_name } }, member.home_branch_id);
  res.status(201).json({ member: L.publicMember(member), card: L.publicCard(card), tier: L.publicTier(card) });
});

r.post('/members/import', requireRole(...STAFF), (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 2000) : [];
  if (!rows.length) throw new HttpError(400, 'No rows to import');
  const tiers = all('SELECT id, code, name FROM tiers');
  const branches = all('SELECT id, code, short_name FROM branches');
  const result = { created: 0, skipped: [] };
  rows.forEach((row, i) => {
    try {
      const tierKey = String(row.tier || '').trim().toLowerCase();
      const tier = tiers.find((t) => t.code.toLowerCase() === tierKey || t.name.toLowerCase() === tierKey || t.name.toLowerCase().endsWith(tierKey));
      const brKey = String(row.branch || '').trim().toLowerCase();
      const branch = branches.find((b) => b.code.toLowerCase() === brKey || b.short_name.toLowerCase() === brKey);
      const { member } = L.createMember({ ...row, tier_id: tier ? tier.id : null, home_branch_id: branch ? branch.id : null },
        { userId: req.user.id, branchId: req.user.branch_id || null });
      result.created++;
      audit(req, 'member.import', 'member', member.id, { name: member.full_name });
    } catch (err) {
      result.skipped.push({ row: i + 2, name: row.full_name || '', reason: err.message });
    }
  });
  res.json(result);
});

r.get('/members/:id', requireAuth, (req, res) => {
  const m = one(`${L.MEMBER_SQL} WHERE m.id = ?`, Number(req.params.id));
  if (!m) throw new HttpError(404, 'Member not found');
  const today = todayLocal(getSettings().timezone);
  const cards = all(`${L.CARD_SQL} WHERE c.member_id = ? ORDER BY c.id DESC`, m.id)
    .map((c) => ({ ...L.publicCard(c), tier: L.publicTier(c), effective_status: L.effectiveStatus(c, today) }));
  const txns = all(`${L.TXN_SELECT} WHERE t.member_id = ? ORDER BY t.id DESC LIMIT 60`, m.id);
  const monthly = all(`SELECT substr(created_at,1,7) AS month, COUNT(*) AS txns, SUM(bill_amount) AS gross, SUM(discount_amount) AS saved
    FROM transactions WHERE member_id = ? AND status = 'completed' AND created_at >= ? GROUP BY month ORDER BY month`,
  m.id, addDays(today, -365).slice(0, 7) + '-01 00:00:00').map((x) => ({ ...x, gross: round2(x.gross), saved: round2(x.saved) }));
  const branchesUsed = all(`SELECT b.short_name, COUNT(*) AS n FROM transactions t JOIN branches b ON b.id = t.branch_id
    WHERE t.member_id = ? AND t.status = 'completed' GROUP BY b.id ORDER BY n DESC`, m.id);
  res.json({ member: L.publicMember(m), cards, stats: L.memberStats(m.id), transactions: txns, monthly, branches_used: branchesUsed });
});

r.put('/members/:id', requireRole(...STAFF), (req, res) => {
  const id = Number(req.params.id);
  const m = one('SELECT * FROM members WHERE id = ?', id);
  if (!m) throw new HttpError(404, 'Member not found');
  const b = req.body;
  const mobile = b.mobile !== undefined ? normalizeMobile(b.mobile) : m.mobile;
  if (!mobile) throw new HttpError(400, 'Enter a valid mobile number');
  if (mobile !== m.mobile && one('SELECT id FROM members WHERE mobile = ? AND id <> ?', mobile, id)) throw new HttpError(409, 'Mobile already registered to another member');
  const next = {
    full_name: vStr(b.full_name ?? m.full_name, 'Full name', { required: true, min: 2, max: 80 }),
    mobile,
    email: vStr(b.email !== undefined ? b.email : m.email, 'Email', { max: 120, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, patternMsg: 'Enter a valid email address' }),
    qid: vStr(b.qid !== undefined ? b.qid : m.qid, 'QID', { max: 30 }),
    gender: ['male', 'female'].includes(b.gender) ? b.gender : b.gender === '' ? null : m.gender,
    birth_date: vStr(b.birth_date !== undefined ? b.birth_date : m.birth_date, 'Birth date', { max: 10, pattern: /^\d{4}-\d{2}-\d{2}$/ }),
    nationality: vStr(b.nationality !== undefined ? b.nationality : m.nationality, 'Nationality', { max: 60 }),
    notes: vStr(b.notes !== undefined ? b.notes : m.notes, 'Notes', { max: 500 }),
    home_branch_id: b.home_branch_id !== undefined ? (Number(b.home_branch_id) || null) : m.home_branch_id,
  };
  run(`UPDATE members SET full_name=?, mobile=?, email=?, qid=?, gender=?, birth_date=?, nationality=?, notes=?, home_branch_id=?, updated_at=? WHERE id=?`,
    next.full_name, next.mobile, next.email, next.qid, next.gender, next.birth_date, next.nationality, next.notes, next.home_branch_id,
    nowLocal(getSettings().timezone), id);
  audit(req, 'member.update', 'member', id, { name: next.full_name });
  res.json({ member: L.publicMember(one(`${L.MEMBER_SQL} WHERE m.id = ?`, id)) });
});

r.post('/members/:id/rotate-link', requireRole(...STAFF), (req, res) => {
  const id = Number(req.params.id);
  if (!one('SELECT id FROM members WHERE id = ?', id)) throw new HttpError(404, 'Member not found');
  const token = randomToken(15);
  run('UPDATE members SET public_token = ? WHERE id = ?', token, id);
  audit(req, 'member.rotate_link', 'member', id);
  res.json({ public_token: token });
});

r.post('/members/:id/replace-card', requireRole(...STAFF), (req, res) => {
  const id = Number(req.params.id);
  const reason = vEnum(req.body.reason, 'Reason', ['lost', 'damaged', 'upgrade', 'stolen'], { required: true });
  const out = tx(() => {
    const cur = L.currentCard(id);
    if (!cur) throw new HttpError(404, 'Member has no card');
    if (cur.status === 'blocked' && req.user.role !== 'admin') throw new HttpError(403, 'Only an administrator can replace a blocked card');
    const newStatus = reason === 'lost' || reason === 'stolen' ? 'lost' : 'replaced';
    run('UPDATE cards SET status = ?, status_reason = ? WHERE id = ?', newStatus, `Replaced: ${reason}`, cur.id);
    const tierId = Number(req.body.tier_id) || cur.tier_id;
    const m = one('SELECT home_branch_id FROM members WHERE id = ?', id);
    return { old: cur, card: L.issueCard({ memberId: id, tierId, branchId: req.user.branch_id || m.home_branch_id, userId: req.user.id }) };
  });
  audit(req, 'card.replace', 'card', out.card.id, { member_id: id, reason, old: out.old.card_number.slice(-4), new: out.card.card_number.slice(-4) });
  res.json({ card: L.publicCard(out.card), tier: L.publicTier(out.card) });
});

// ---------------- Cards ----------------
function cardOr404(id) {
  const c = one(`${L.CARD_SQL} WHERE c.id = ?`, Number(id));
  if (!c) throw new HttpError(404, 'Card not found');
  return c;
}

r.put('/cards/:id/status', requireRole(...STAFF), (req, res) => {
  const c = cardOr404(req.params.id);
  const status = vEnum(req.body.status, 'Status', ['active', 'suspended', 'blocked'], { required: true });
  if (['lost', 'replaced'].includes(c.status)) throw new HttpError(409, 'This card has been replaced — manage the member’s current card instead');
  if (c.status === 'blocked' && req.user.role !== 'admin') throw new HttpError(403, 'Only an administrator can unblock a card');
  const reason = vStr(req.body.reason, 'Reason', { max: 200, required: status !== 'active' });
  run('UPDATE cards SET status = ?, status_reason = ? WHERE id = ?', status, status === 'active' ? null : reason, c.id);
  audit(req, 'card.status', 'card', c.id, { from: c.status, to: status, reason });
  res.json({ card: L.publicCard(cardOr404(c.id)) });
});

r.put('/cards/:id/tier', requireRole(...STAFF), (req, res) => {
  const c = cardOr404(req.params.id);
  const tier = one('SELECT * FROM tiers WHERE id = ? AND active = 1', Number(req.body.tier_id));
  if (!tier) throw new HttpError(400, 'Choose an active tier');
  run('UPDATE cards SET tier_id = ? WHERE id = ?', tier.id, c.id);
  audit(req, 'card.tier', 'card', c.id, { from: c.tier_name, to: tier.name });
  const updated = cardOr404(c.id);
  res.json({ card: L.publicCard(updated), tier: L.publicTier(updated) });
});

r.post('/cards/:id/renew', requireRole(...STAFF), (req, res) => {
  const c = cardOr404(req.params.id);
  const s = getSettings();
  const today = todayLocal(s.timezone);
  const base = c.expires_at > today ? c.expires_at : today;
  const expires = addYears(base, Math.max(1, Number(s.card_validity_years) || 2));
  run('UPDATE cards SET expires_at = ? WHERE id = ?', expires, c.id);
  audit(req, 'card.renew', 'card', c.id, { from: c.expires_at, to: expires });
  res.json({ card: L.publicCard(cardOr404(c.id)) });
});

r.get('/cards/print-queue', requireRole(...STAFF), (req, res) => {
  const today = todayLocal(getSettings().timezone);
  const rows = all(`SELECT c.id AS card_id, c.card_number, c.issued_at, c.expires_at, c.printed_count, c.status,
      m.id AS member_id, m.full_name, m.member_code, m.created_at, m.public_token, t.id AS tier_id, t.name AS tier_name, t.theme AS tier_theme, t.discount_pct
    FROM cards c JOIN members m ON m.id = c.member_id JOIN tiers t ON t.id = c.tier_id
    WHERE c.status = 'active' AND c.expires_at >= ? AND c.id = (SELECT MAX(id) FROM cards WHERE member_id = c.member_id)
    ORDER BY c.printed_count ASC, c.id DESC LIMIT 500`, today);
  res.json({ rows });
});

r.post('/cards/printed', requireRole(...STAFF), (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger).slice(0, 500);
  const now = nowLocal(getSettings().timezone);
  tx(() => ids.forEach((id) => run('UPDATE cards SET printed_count = printed_count + 1, last_printed_at = ? WHERE id = ?', now, id)));
  audit(req, 'card.print', 'card', ids.length === 1 ? ids[0] : null, { count: ids.length });
  res.json({ ok: true, count: ids.length });
});

r.get('/cards/export.csv', requireRole(...STAFF), (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 1000);
  if (!ids.length) throw new HttpError(400, 'Select cards to export');
  const rows = all(`SELECT c.card_number, c.issued_at, c.expires_at, m.full_name, m.member_code, t.name AS tier_name, t.discount_pct
    FROM cards c JOIN members m ON m.id = c.member_id JOIN tiers t ON t.id = c.tier_id
    WHERE c.id IN (${ids.map(() => '?').join(',')}) ORDER BY c.id`, ...ids);
  const mmYY = (d) => d.slice(5, 7) + '/' + d.slice(2, 4);
  const csv = toCsv([
    { label: 'Card Number (barcode/QR value)', key: 'card_number' },
    { label: 'Card Number (printed)', value: (x) => formatCardNumber(x.card_number) },
    { label: 'Member Name', value: (x) => x.full_name.toUpperCase() },
    { label: 'Member Code', key: 'member_code' }, { label: 'Tier', key: 'tier_name' }, { label: 'Discount %', key: 'discount_pct' },
    { label: 'Member Since', value: (x) => mmYY(x.issued_at) }, { label: 'Valid Thru', value: (x) => mmYY(x.expires_at) },
  ], rows);
  audit(req, 'card.export', 'card', null, { count: rows.length });
  sendCsv(res, `royal-cards-print-data-${todayLocal(getSettings().timezone)}.csv`, csv);
});

function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

module.exports = { router: r, sendCsv, publicSettings };
