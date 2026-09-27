'use strict';
// Core business rules: card lookup, eligibility, discount calculation,
// redemption recording, card issuing, and analytics.
const { one, all, run, tx, getSettings } = require('./db');
const {
  HttpError, nowLocal, todayLocal, addDays, addYears, daysBetween, round2, makeCardNumber,
  randomToken, normalizeMobile, vNum, vStr, luhnValid,
} = require('./util');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const branchNo = (code) => String(code || '').replace(/\D/g, '').padStart(2, '0').slice(-2);
const dayStart = (ymd) => ymd + ' 00:00:00';

function effectiveStatus(card, today) {
  if (!card) return null;
  if (card.status === 'active' && card.expires_at < today) return 'expired';
  return card.status;
}

const CARD_SQL = `
  SELECT c.*, t.code AS tier_code, t.name AS tier_name, t.discount_pct, t.theme AS tier_theme, t.active AS tier_active
  FROM cards c JOIN tiers t ON t.id = c.tier_id`;

const MEMBER_SQL = `
  SELECT m.*, b.short_name AS home_branch_short, b.name AS home_branch_name
  FROM members m LEFT JOIN branches b ON b.id = m.home_branch_id`;

function currentCard(memberId) {
  return one(`${CARD_SQL} WHERE c.member_id = ? ORDER BY c.id DESC LIMIT 1`, memberId);
}

// Accepts anything a scanner or cashier might type: 16-digit card number (with or
// without spaces), a QR payload/URL containing it, an 8-digit Qatar mobile, or RM-xxxxx.
function findByCode(raw) {
  const input = String(raw || '').trim();
  if (!input) return null;
  let card = null;
  let member = null;
  let matchedBy = null;

  const digits = input.replace(/\D/g, '');
  const urlMatch = input.match(/(\d[\d\s-]{11,22}\d)/);
  const candidate = /^[\d\s-]+$/.test(input) ? digits : urlMatch ? urlMatch[1].replace(/\D/g, '') : '';

  if (candidate.length >= 12 && candidate.length <= 19) {
    card = one(`${CARD_SQL} WHERE c.card_number = ?`, candidate);
    if (card) matchedBy = 'card';
  }
  if (!card) {
    const rm = input.match(/^RM-?(\d{3,})$/i);
    if (rm) {
      member = one(`${MEMBER_SQL} WHERE m.member_code = ?`, 'RM-' + rm[1]);
      if (member) matchedBy = 'member_code';
    }
  }
  if (!card && !member && (digits.length === 8 || digits.length === 11 || input.startsWith('+'))) {
    const mobile = normalizeMobile(input);
    if (mobile) {
      member = one(`${MEMBER_SQL} WHERE m.mobile = ?`, mobile);
      if (member) matchedBy = 'mobile';
    }
  }
  if (card && !member) member = one(`${MEMBER_SQL} WHERE m.id = ?`, card.member_id);
  if (member && !card) card = currentCard(member.id);
  if (!card || !member) {
    return { notFound: true, luhnOk: candidate.length >= 12 ? luhnValid(candidate) : null };
  }
  return { card, member, matchedBy };
}

function statusMessage(status, reason) {
  const why = reason ? ` (${reason})` : '';
  switch (status) {
    case 'suspended': return `Card is temporarily SUSPENDED${why}`;
    case 'blocked': return `Card is BLOCKED${why} — do not apply the discount`;
    case 'lost': return `This card was reported LOST${why} — please retain the card`;
    case 'replaced': return `This card was REPLACED by a newer card${why}`;
    default: return `Card is not active (${status})`;
  }
}

function usageToday(cardId, tz) {
  const today = todayLocal(tz);
  return one(`SELECT COUNT(*) AS n, MAX(t.created_at) AS last_at,
      (SELECT b.short_name FROM transactions x JOIN branches b ON b.id = x.branch_id
        WHERE x.card_id = ? AND x.status = 'completed' AND x.created_at >= ? ORDER BY x.id DESC LIMIT 1) AS last_branch
    FROM transactions t WHERE t.card_id = ? AND t.status = 'completed' AND t.created_at >= ? AND t.created_at < ?`,
  cardId, dayStart(today), cardId, dayStart(today), dayStart(addDays(today, 1)));
}

function evaluate(card, branchId, settings) {
  const tz = settings.timezone;
  const today = todayLocal(tz);
  const blocks = [];
  const warnings = [];
  const status = effectiveStatus(card, today);

  if (status === 'expired') blocks.push({ code: 'expired', message: `Card expired on ${card.expires_at} — renew to continue` });
  else if (status !== 'active') blocks.push({ code: status, message: statusMessage(status, card.status_reason) });
  if (!card.tier_active) blocks.push({ code: 'tier_inactive', message: `${card.tier_name} tier is currently disabled` });
  if (branchId) {
    const b = one('SELECT active FROM branches WHERE id = ?', branchId);
    if (!b || !b.active) blocks.push({ code: 'branch_inactive', message: 'This branch is not active in the program' });
  }

  const used = usageToday(card.id, tz);
  const limit = Number(settings.max_txn_per_card_per_day) || 0;
  if (limit > 0 && used.n >= limit) {
    blocks.push({ code: 'daily_limit', message: `Daily limit reached — used ${used.n} of ${limit} time(s) today` });
  } else if (used.n > 0) {
    warnings.push({ code: 'used_today', message: `Already used ${used.n}× today (last ${used.last_at.slice(11, 16)} at ${used.last_branch})` });
  }
  if (status === 'active') {
    const left = daysBetween(today, card.expires_at);
    if (left <= 30) warnings.push({ code: 'expiring', message: `Card expires in ${left} day(s) — offer a renewal` });
  }
  return { ok: blocks.length === 0, status, blocks, warnings, usedToday: used.n };
}

function computeDiscount(bill, pct, settings) {
  const amount = round2(bill);
  let discount = round2((amount * pct) / 100);
  let capped = false;
  const cap = Number(settings.max_discount_per_txn) || 0;
  if (cap > 0 && discount > cap) {
    discount = round2(cap);
    capped = true;
  }
  return { bill: amount, pct, discount, net: round2(amount - discount), capped };
}

function memberStats(memberId) {
  const s = one(`SELECT COUNT(*) AS visits, COALESCE(SUM(bill_amount),0) AS spend, COALESCE(SUM(discount_amount),0) AS saved,
      MIN(created_at) AS first_visit, MAX(created_at) AS last_visit
    FROM transactions WHERE member_id = ? AND status = 'completed'`, memberId);
  const fav = one(`SELECT b.short_name, b.name, COUNT(*) AS n FROM transactions t JOIN branches b ON b.id = t.branch_id
    WHERE t.member_id = ? AND t.status = 'completed' GROUP BY b.id ORDER BY n DESC LIMIT 1`, memberId);
  const last = one(`SELECT b.short_name FROM transactions t JOIN branches b ON b.id = t.branch_id
    WHERE t.member_id = ? AND t.status = 'completed' ORDER BY t.id DESC LIMIT 1`, memberId);
  return {
    visits: s.visits,
    spend: round2(s.spend),
    saved: round2(s.saved),
    avg_basket: s.visits ? round2(s.spend / s.visits) : 0,
    first_visit: s.first_visit,
    last_visit: s.last_visit,
    last_branch: last ? last.short_name : null,
    favorite_branch: fav ? fav.short_name : null,
  };
}

function publicCard(card) {
  return {
    id: card.id, card_number: card.card_number, status: card.status, status_reason: card.status_reason,
    issued_at: card.issued_at, expires_at: card.expires_at, printed_count: card.printed_count,
    last_printed_at: card.last_printed_at, last_used_at: card.last_used_at, tier_id: card.tier_id,
  };
}
const publicTier = (card) => ({ id: card.tier_id, code: card.tier_code, name: card.tier_name, discount_pct: card.discount_pct, theme: card.tier_theme, active: !!card.tier_active });
function publicMember(m) {
  return {
    id: m.id, member_code: m.member_code, full_name: m.full_name, mobile: m.mobile, email: m.email, qid: m.qid,
    gender: m.gender, birth_date: m.birth_date, nationality: m.nationality, notes: m.notes,
    home_branch_id: m.home_branch_id, home_branch: m.home_branch_short, public_token: m.public_token,
    created_at: m.created_at, updated_at: m.updated_at,
  };
}

function lookup(code, branchId) {
  const settings = getSettings();
  const found = findByCode(code);
  if (!found || found.notFound) {
    const hint = found && found.luhnOk === false ? ' The number failed its check digit — it may be mistyped or counterfeit.' : '';
    throw new HttpError(404, 'No Royal card or member matches this code.' + hint, { code: 'not_found' });
  }
  const { card, member, matchedBy } = found;
  const ev = evaluate(card, branchId, settings);
  const newer = ['lost', 'replaced'].includes(card.status) ? currentCard(member.id) : null;
  return {
    matched_by: matchedBy,
    card: { ...publicCard(card), effective_status: ev.status },
    tier: publicTier(card),
    member: publicMember(member),
    stats: memberStats(member.id),
    eligibility: ev,
    newer_card: newer && newer.id !== card.id ? { last4: newer.card_number.slice(-4), status: newer.status } : null,
    rules: {
      min_bill_amount: Number(settings.min_bill_amount) || 0,
      max_discount_per_txn: Number(settings.max_discount_per_txn) || 0,
      large_bill_warning: Number(settings.large_bill_warning) || 0,
      require_pos_invoice: !!settings.require_pos_invoice,
    },
  };
}

const TXN_SELECT = `
  SELECT t.*, m.full_name AS member_name, m.member_code, m.mobile AS member_mobile, c.card_number,
         b.code AS branch_code, b.short_name AS branch_short, b.name AS branch_name, b.brand AS branch_brand,
         tr.name AS tier_name, tr.theme AS tier_theme, u.full_name AS cashier_name, vu.full_name AS voided_by_name,
         k.name AS api_key_name
  FROM transactions t
  JOIN members m ON m.id = t.member_id
  JOIN cards c ON c.id = t.card_id
  JOIN branches b ON b.id = t.branch_id
  LEFT JOIN tiers tr ON tr.id = t.tier_id
  LEFT JOIN users u ON u.id = t.user_id
  LEFT JOIN users vu ON vu.id = t.voided_by
  LEFT JOIN api_keys k ON k.id = t.api_key_id`;

function getTransaction(id) {
  return one(`${TXN_SELECT} WHERE t.id = ?`, id);
}

function redeem({ code, bill, invoice, branchId, userId = null, apiKeyId = null, confirmDuplicate = false }) {
  const settings = getSettings();
  const tz = settings.timezone;
  const billAmt = vNum(bill, 'Bill amount', { required: true, min: 0.01, max: 1000000 });
  const inv = vStr(invoice, 'POS invoice number', { max: 40 });
  if (settings.require_pos_invoice && !inv) throw new HttpError(400, 'POS invoice number is required');
  if (!branchId) throw new HttpError(400, 'Select the branch for this counter first');

  return tx(() => {
    const found = findByCode(code);
    if (!found || found.notFound) throw new HttpError(404, 'Card not found');
    const { card, member } = found;
    const ev = evaluate(card, branchId, settings);
    if (!ev.ok) throw new HttpError(422, ev.blocks[0].message, { blocks: ev.blocks });

    const minBill = Number(settings.min_bill_amount) || 0;
    if (minBill > 0 && billAmt < minBill) throw new HttpError(422, `Minimum bill for the Royal discount is ${settings.currency} ${minBill.toFixed(2)}`);

    if (inv) {
      const dup = one(`SELECT txn_no FROM transactions WHERE branch_id = ? AND pos_invoice = ? AND status = 'completed'`, branchId, inv);
      if (dup) throw new HttpError(409, `Invoice ${inv} already received a Royal discount (${dup.txn_no})`, { code: 'invoice_used' });
    }
    const windowSec = Number(settings.duplicate_window_sec) || 0;
    if (!confirmDuplicate && windowSec > 0) {
      const since = nowLocal(tz, new Date(Date.now() - windowSec * 1000));
      const recent = one(`SELECT txn_no, created_at FROM transactions
        WHERE card_id = ? AND status = 'completed' AND ABS(bill_amount - ?) < 0.005 AND created_at >= ?
        ORDER BY id DESC LIMIT 1`, card.id, billAmt, since);
      if (recent) {
        throw new HttpError(409, `Possible duplicate — the same card and amount were recorded at ${recent.created_at.slice(11, 16)} (${recent.txn_no}).`, { code: 'duplicate', txn_no: recent.txn_no });
      }
    }

    const calc = computeDiscount(billAmt, card.discount_pct, settings);
    const now = nowLocal(tz);
    const today = now.slice(0, 10);
    const branch = one('SELECT code FROM branches WHERE id = ?', branchId);
    let seq = one('SELECT COUNT(*) AS n FROM transactions WHERE branch_id = ? AND created_at >= ? AND created_at < ?',
      branchId, dayStart(today), dayStart(addDays(today, 1))).n + 1;
    const base = `RL${today.slice(2).replace(/-/g, '')}-${branchNo(branch.code)}-`;
    let txnNo = base + String(seq).padStart(4, '0');
    while (one('SELECT 1 AS x FROM transactions WHERE txn_no = ?', txnNo)) txnNo = base + String(++seq).padStart(4, '0');

    const r = run(`INSERT INTO transactions(txn_no, card_id, member_id, branch_id, user_id, api_key_id, tier_id, discount_pct,
        bill_amount, discount_amount, net_amount, pos_invoice, status, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'completed', ?)`,
    txnNo, card.id, member.id, branchId, userId, apiKeyId, card.tier_id, card.discount_pct,
    calc.bill, calc.discount, calc.net, inv, now);
    run('UPDATE cards SET last_used_at = ? WHERE id = ?', now, card.id);
    const txn = getTransaction(Number(r.lastInsertRowid));
    return { txn, calc, stats: memberStats(member.id) };
  });
}

function voidTransaction(id, reason, user) {
  const settings = getSettings();
  return tx(() => {
    const t = one('SELECT * FROM transactions WHERE id = ?', id);
    if (!t) throw new HttpError(404, 'Transaction not found');
    if (t.status === 'void') throw new HttpError(409, 'Transaction is already void');
    if (user.role !== 'admin' && user.branch_id && t.branch_id !== user.branch_id) throw new HttpError(403, 'You can only void transactions of your branch');
    const why = vStr(reason, 'Void reason', { required: true, min: 3, max: 200 });
    run(`UPDATE transactions SET status = 'void', void_reason = ?, voided_by = ?, voided_at = ? WHERE id = ?`, why, user.id, nowLocal(settings.timezone), id);
    return getTransaction(id);
  });
}

// ---------- Cards & members ----------
function uniqueCardNumber(prefix) {
  for (let i = 0; i < 50; i++) {
    const n = makeCardNumber(prefix);
    if (!one('SELECT 1 AS x FROM cards WHERE card_number = ?', n)) return n;
  }
  throw new HttpError(500, 'Could not generate a unique card number');
}

function issueCard({ memberId, tierId, branchId, userId, issuedAt }) {
  const settings = getSettings();
  const tier = one('SELECT * FROM tiers WHERE id = ?', tierId);
  if (!tier) throw new HttpError(400, 'Unknown card tier');
  const today = issuedAt || todayLocal(settings.timezone);
  const years = Math.max(1, Number(settings.card_validity_years) || 2);
  const r = run(`INSERT INTO cards(card_number, member_id, tier_id, status, issued_at, expires_at, issued_branch_id, issued_by)
    VALUES(?,?,?, 'active', ?,?,?,?)`,
  uniqueCardNumber(settings.card_prefix), memberId, tierId, today, addYears(today, years), branchId, userId);
  return one(`${CARD_SQL} WHERE c.id = ?`, Number(r.lastInsertRowid));
}

function createMember(input, { userId, branchId, createdAt } = {}) {
  const settings = getSettings();
  const now = createdAt || nowLocal(settings.timezone);
  const fullName = vStr(input.full_name, 'Full name', { required: true, min: 2, max: 80 });
  const mobile = normalizeMobile(input.mobile);
  if (!mobile) throw new HttpError(400, 'Enter a valid mobile number (8-digit Qatar number or +country code)');
  if (one('SELECT id FROM members WHERE mobile = ?', mobile)) throw new HttpError(409, `Mobile ${mobile} is already registered to another member`);
  const email = vStr(input.email, 'Email', { max: 120, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, patternMsg: 'Enter a valid email address' });
  const qid = vStr(input.qid, 'QID / ID number', { max: 30 });
  const gender = ['male', 'female'].includes(input.gender) ? input.gender : null;
  const birth = vStr(input.birth_date, 'Birth date', { max: 10, pattern: /^\d{4}-\d{2}-\d{2}$/ });
  const nationality = vStr(input.nationality, 'Nationality', { max: 60 });
  const notes = vStr(input.notes, 'Notes', { max: 500 });
  const home = Number(input.home_branch_id) || branchId || null;
  if (home && !one('SELECT id FROM branches WHERE id = ?', home)) throw new HttpError(400, 'Unknown home branch');
  let tierId = Number(input.tier_id);
  if (!tierId) tierId = (one('SELECT id FROM tiers WHERE is_default = 1 AND active = 1') || one('SELECT id FROM tiers WHERE active = 1 ORDER BY sort')).id;
  if (!one('SELECT id FROM tiers WHERE id = ? AND active = 1', tierId)) throw new HttpError(400, 'Choose an active card tier');

  return tx(() => {
    const r = run(`INSERT INTO members(member_code, full_name, mobile, email, qid, gender, birth_date, nationality, notes,
        home_branch_id, public_token, created_by, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    'TMP-' + randomToken(8), fullName, mobile, email, qid, gender, birth, nationality, notes, home, randomToken(15), userId, now, now);
    const id = Number(r.lastInsertRowid);
    run('UPDATE members SET member_code = ? WHERE id = ?', 'RM-' + (10000 + id), id);
    const card = issueCard({ memberId: id, tierId, branchId: home, userId, issuedAt: now.slice(0, 10) });
    return { member: one(`${MEMBER_SQL} WHERE m.id = ?`, id), card };
  });
}

// ---------- Analytics ----------
function whereRange(from, to, branchId, alias = '') {
  const a = alias ? alias + '.' : '';
  let sql = `${a}status = 'completed' AND ${a}created_at >= ? AND ${a}created_at < ?`;
  const params = [dayStart(from), dayStart(addDays(to, 1))];
  if (branchId) { sql += ` AND ${a}branch_id = ?`; params.push(branchId); }
  return { sql, params };
}

function kpis(from, to, branchId) {
  const w = whereRange(from, to, branchId);
  const r = one(`SELECT COUNT(*) AS txns, COALESCE(SUM(bill_amount),0) AS gross, COALESCE(SUM(discount_amount),0) AS discount,
      COALESCE(SUM(net_amount),0) AS net, COUNT(DISTINCT member_id) AS members FROM transactions WHERE ${w.sql}`, ...w.params);
  return {
    txns: r.txns, gross: round2(r.gross), discount: round2(r.discount), net: round2(r.net),
    active_members: r.members, avg_basket: r.txns ? round2(r.gross / r.txns) : 0,
  };
}

function overview(range, branchId) {
  const settings = getSettings();
  const tz = settings.timezone;
  const { from, to, prevFrom, prevTo, days } = range;
  const cur = kpis(from, to, branchId);
  const prev = kpis(prevFrom, prevTo, branchId);

  const w = whereRange(from, to, branchId);
  const dailyRows = all(`SELECT substr(created_at,1,10) AS d, COUNT(*) AS n, SUM(bill_amount) AS gross, SUM(discount_amount) AS discount
    FROM transactions WHERE ${w.sql} GROUP BY d`, ...w.params);
  const byDay = new Map(dailyRows.map((r) => [r.d, r]));
  const daily = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    const r = byDay.get(d);
    daily.push({ date: d, txns: r ? r.n : 0, gross: r ? round2(r.gross) : 0, discount: r ? round2(r.discount) : 0 });
  }

  const wb = whereRange(from, to, null, 't');
  const branches = all(`SELECT b.id, b.code, b.name, b.short_name, b.brand, COUNT(t.id) AS txns,
      COALESCE(SUM(t.bill_amount),0) AS gross, COALESCE(SUM(t.discount_amount),0) AS discount, COUNT(DISTINCT t.member_id) AS members
    FROM branches b LEFT JOIN transactions t ON t.branch_id = b.id AND ${wb.sql}
    ${branchId ? 'WHERE b.id = ?' : ''}
    GROUP BY b.id ORDER BY b.id`, ...wb.params, ...(branchId ? [branchId] : []))
    .map((b) => ({ ...b, gross: round2(b.gross), discount: round2(b.discount) }));

  const wc = whereRange(from, to, branchId, 't');
  const cashiers = branchId ? all(`SELECT COALESCE(u.full_name, 'POS integration') AS name, COUNT(*) AS txns,
      SUM(t.bill_amount) AS gross, SUM(t.discount_amount) AS discount
    FROM transactions t LEFT JOIN users u ON u.id = t.user_id WHERE ${wc.sql}
    GROUP BY t.user_id ORDER BY gross DESC LIMIT 8`, ...wc.params)
    .map((c) => ({ ...c, gross: round2(c.gross), discount: round2(c.discount) })) : [];

  const heat = all(`SELECT CAST(strftime('%w', created_at) AS INTEGER) AS dow, CAST(strftime('%H', created_at) AS INTEGER) AS hr, COUNT(*) AS n
    FROM transactions WHERE ${w.sql} GROUP BY dow, hr`, ...w.params);

  const top = all(`SELECT m.id, m.full_name, m.member_code, COUNT(*) AS txns, SUM(t.bill_amount) AS gross, SUM(t.discount_amount) AS saved,
      MAX(t.created_at) AS last_visit,
      (SELECT tr.theme FROM cards c JOIN tiers tr ON tr.id = c.tier_id WHERE c.member_id = m.id ORDER BY c.id DESC LIMIT 1) AS tier_theme,
      (SELECT tr.name FROM cards c JOIN tiers tr ON tr.id = c.tier_id WHERE c.member_id = m.id ORDER BY c.id DESC LIMIT 1) AS tier_name
    FROM transactions t JOIN members m ON m.id = t.member_id WHERE ${wc.sql}
    GROUP BY m.id ORDER BY gross DESC LIMIT 6`, ...wc.params)
    .map((r) => ({ ...r, gross: round2(r.gross), saved: round2(r.saved) }));

  const recent = all(`${TXN_SELECT} ${branchId ? 'WHERE t.branch_id = ?' : ''} ORDER BY t.id DESC LIMIT 12`, ...(branchId ? [branchId] : []));

  const today = todayLocal(tz);
  const members = one(`SELECT
      (SELECT COUNT(*) FROM members) AS total,
      (SELECT COUNT(*) FROM members WHERE created_at >= ? AND created_at < ?) AS new_in_range,
      (SELECT COUNT(*) FROM cards c WHERE c.status = 'active' AND c.expires_at >= ?
          AND c.id = (SELECT MAX(id) FROM cards WHERE member_id = c.member_id)) AS active_cards,
      (SELECT COUNT(*) FROM cards c WHERE c.status = 'active' AND c.expires_at >= ? AND c.expires_at <= ?
          AND c.id = (SELECT MAX(id) FROM cards WHERE member_id = c.member_id)) AS expiring_30d,
      (SELECT COUNT(*) FROM cards c WHERE c.printed_count = 0 AND c.status = 'active'
          AND c.id = (SELECT MAX(id) FROM cards WHERE member_id = c.member_id)) AS unprinted`,
  dayStart(from), dayStart(addDays(to, 1)), today, today, addDays(today, 30));
  const dormant = one(`SELECT COUNT(*) AS n FROM members m WHERE NOT EXISTS (
      SELECT 1 FROM transactions t WHERE t.member_id = m.id AND t.status = 'completed' AND t.created_at >= ?)`, dayStart(addDays(today, -29))).n;

  const tiers = all(`SELECT tr.id, tr.name, tr.theme, tr.discount_pct, COUNT(c.id) AS cards
    FROM tiers tr LEFT JOIN cards c ON c.tier_id = tr.id AND c.status = 'active' AND c.expires_at >= ?
      AND c.id = (SELECT MAX(id) FROM cards WHERE member_id = c.member_id)
    GROUP BY tr.id ORDER BY tr.sort`, today);

  return {
    range, current: cur, previous: prev, daily, branches, cashiers, heat, top, recent,
    members: { ...members, dormant_30d: dormant }, tiers,
    insights: buildInsights({ cur, prev, heat, branches, top, members: { ...members, dormant_30d: dormant }, branchId, settings }),
  };
}

function pctChange(a, b) {
  if (!b) return a ? null : 0;
  return ((a - b) / b) * 100;
}

function buildInsights({ cur, prev, heat, branches, top, members, branchId, settings }) {
  const out = [];
  const cur$ = settings.currency;
  const growth = pctChange(cur.gross, prev.gross);
  if (cur.txns && growth != null && Number.isFinite(growth)) {
    out.push({
      icon: growth >= 0 ? 'trend-up' : 'trend-down', tone: growth >= 0 ? 'good' : 'warn',
      title: `Royal spend ${growth >= 0 ? 'up' : 'down'} ${Math.abs(growth).toFixed(1)}%`,
      text: `Card-holders spent ${cur$} ${fmtMoney(cur.gross)} this period vs ${cur$} ${fmtMoney(prev.gross)} the period before.`,
    });
  }
  if (heat.length) {
    const best = heat.reduce((a, b) => (b.n > a.n ? b : a));
    const h = (x) => `${((x + 11) % 12) + 1}${x < 12 ? ' AM' : ' PM'}`;
    out.push({ icon: 'clock', tone: 'info', title: `Peak time: ${DAY_NAMES[best.dow]}, ${h(best.hr)}–${h((best.hr + 1) % 24)}`,
      text: `Plan extra counters at this hour — ${best.n} Royal transactions landed in this slot.` });
  }
  if (!branchId) {
    const total = branches.reduce((s, b) => s + b.gross, 0);
    const lead = branches.reduce((a, b) => (b.gross > a.gross ? b : a), branches[0] || { gross: 0 });
    if (total > 0) {
      out.push({ icon: 'store', tone: 'info', title: `${lead.short_name} leads the group`,
        text: `${((lead.gross / total) * 100).toFixed(0)}% of all Royal spend came through ${lead.name}.` });
    }
  }
  if (top[0]) {
    out.push({ icon: 'crown', tone: 'gold', title: `Top member: ${top[0].full_name}`,
      text: `${top[0].txns} visits, ${cur$} ${fmtMoney(top[0].gross)} spent, ${cur$} ${fmtMoney(top[0].saved)} saved. Consider a VIP upgrade.` });
  }
  if (members.expiring_30d > 0) {
    out.push({ icon: 'alert', tone: 'warn', title: `${members.expiring_30d} card(s) expire within 30 days`,
      text: 'Renew them from the Members page to keep these customers coming back.' });
  }
  if (members.dormant_30d > 0) {
    out.push({ icon: 'moon', tone: 'muted', title: `${members.dormant_30d} member(s) inactive for 30 days`,
      text: 'A WhatsApp reminder with their digital card link can bring them back.' });
  }
  if (members.unprinted > 0) {
    out.push({ icon: 'printer', tone: 'info', title: `${members.unprinted} card(s) waiting to be printed`,
      text: 'Open Card Studio to print them in one batch.' });
  }
  return out.slice(0, 6);
}

function fmtMoney(n) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

module.exports = {
  DAY_NAMES, effectiveStatus, findByCode, evaluate, computeDiscount, memberStats, lookup, redeem, voidTransaction,
  issueCard, createMember, currentCard, getTransaction, TXN_SELECT, CARD_SQL, MEMBER_SQL, publicCard, publicTier,
  publicMember, overview, kpis, whereRange, dayStart, branchNo,
};
