'use strict';
// Transactions ledger, dashboard analytics and reports.
const express = require('express');
const { one, all, getSettings } = require('../db');
const { HttpError, resolveRange, round2, toCsv, addDays, formatCardNumber, maskCardNumber } = require('../util');
const { requireAuth, requireRole, scopedBranch, audit } = require('../auth');
const L = require('../logic');
const live = require('../live');
const { sendCsv } = require('./core');

const r = express.Router();
const STAFF = ['admin', 'manager'];

// ---------------- Transactions ----------------
function txnFilters(req) {
  const s = getSettings();
  const range = resolveRange(req.query, s.timezone);
  const where = ['t.created_at >= ?', 't.created_at < ?'];
  const params = [L.dayStart(range.from), L.dayStart(addDays(range.to, 1))];
  const branchId = scopedBranch(req, req.query.branch_id);
  if (branchId) { where.push('t.branch_id = ?'); params.push(branchId); }
  if (req.query.status === 'completed' || req.query.status === 'void') { where.push('t.status = ?'); params.push(req.query.status); }
  if (req.query.member_id) { where.push('t.member_id = ?'); params.push(Number(req.query.member_id)); }
  if (req.query.user_id) { where.push('t.user_id = ?'); params.push(Number(req.query.user_id)); }
  const q = String(req.query.q || '').trim();
  if (q) {
    const digits = q.replace(/\D/g, '');
    where.push(`(t.txn_no LIKE ? OR t.pos_invoice LIKE ? OR m.full_name LIKE ?${digits.length >= 4 ? ' OR c.card_number LIKE ? OR m.mobile LIKE ?' : ''})`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    if (digits.length >= 4) params.push(`%${digits}%`, `%${digits}%`);
  }
  return { range, branchId, where: 'WHERE ' + where.join(' AND '), params };
}

r.get('/transactions', requireRole(...STAFF), (req, res) => {
  const f = txnFilters(req);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 25));
  const page = Math.max(1, Number(req.query.page) || 1);
  const base = `FROM transactions t JOIN members m ON m.id = t.member_id JOIN cards c ON c.id = t.card_id ${f.where}`;
  const totals = one(`SELECT COUNT(*) AS n,
      COALESCE(SUM(CASE WHEN t.status='completed' THEN t.bill_amount END),0) AS gross,
      COALESCE(SUM(CASE WHEN t.status='completed' THEN t.discount_amount END),0) AS discount,
      COALESCE(SUM(CASE WHEN t.status='completed' THEN t.net_amount END),0) AS net,
      SUM(CASE WHEN t.status='void' THEN 1 ELSE 0 END) AS voided ${base}`, ...f.params);
  const rows = all(`${L.TXN_SELECT} ${f.where} ORDER BY t.id DESC LIMIT ? OFFSET ?`, ...f.params, limit, (page - 1) * limit);
  res.json({
    rows, page, limit, total: totals.n, range: f.range,
    totals: { gross: round2(totals.gross), discount: round2(totals.discount), net: round2(totals.net), voided: totals.voided || 0 },
  });
});

r.get('/transactions/export.csv', requireRole(...STAFF), (req, res) => {
  const f = txnFilters(req);
  const rows = all(`${L.TXN_SELECT} ${f.where} ORDER BY t.id DESC LIMIT 100000`, ...f.params);
  const csv = toCsv([
    { label: 'Txn No', key: 'txn_no' }, { label: 'Date & Time', key: 'created_at' }, { label: 'Branch', key: 'branch_name' },
    { label: 'Branch Code', key: 'branch_code' }, { label: 'Member', key: 'member_name' }, { label: 'Member Code', key: 'member_code' },
    { label: 'Card', value: (t) => formatCardNumber(t.card_number) }, { label: 'Tier', key: 'tier_name' },
    { label: 'Discount %', key: 'discount_pct' }, { label: 'Bill Amount', key: 'bill_amount' }, { label: 'Discount', key: 'discount_amount' },
    { label: 'Net Payable', key: 'net_amount' }, { label: 'POS Invoice', key: 'pos_invoice' },
    { label: 'Cashier', value: (t) => t.cashier_name || t.api_key_name || '' }, { label: 'Status', key: 'status' },
    { label: 'Void Reason', key: 'void_reason' }, { label: 'Voided By', key: 'voided_by_name' },
  ], rows);
  audit(req, 'txn.export', 'transaction', null, { count: rows.length, from: f.range.from, to: f.range.to });
  sendCsv(res, `royal-transactions-${f.range.from}_to_${f.range.to}.csv`, csv);
});

r.get('/transactions/:id', requireAuth, (req, res) => {
  const t = L.getTransaction(Number(req.params.id));
  if (!t) throw new HttpError(404, 'Transaction not found');
  if (req.user.role !== 'admin' && req.user.branch_id && t.branch_id !== req.user.branch_id) throw new HttpError(403, 'Not your branch');
  res.json({ txn: t, card_masked: maskCardNumber(t.card_number) });
});

r.post('/transactions/:id/void', requireRole(...STAFF), (req, res) => {
  const t = L.voidTransaction(Number(req.params.id), req.body.reason, req.user);
  audit(req, 'txn.void', 'transaction', t.id, { txn_no: t.txn_no, reason: t.void_reason, bill: t.bill_amount });
  live.publish('txn', { type: 'voided', txn: t }, t.branch_id);
  res.json({ txn: t });
});

// ---------------- Dashboard ----------------
r.get('/stats/overview', requireRole(...STAFF), (req, res) => {
  const s = getSettings();
  const range = resolveRange(req.query, s.timezone);
  const branchId = scopedBranch(req, req.query.branch_id);
  res.json({ ...L.overview(range, branchId), branch_id: branchId, live_clients: live.count() });
});

// ---------------- Reports ----------------
const GROUPS = {
  branch: { label: 'Branch', key: "b.code || ' · ' || b.short_name", join: 'JOIN branches b ON b.id = t.branch_id', order: 'MIN(b.id)' },
  day: { label: 'Date', key: 'substr(t.created_at,1,10)', join: '', order: 'grp' },
  month: { label: 'Month', key: 'substr(t.created_at,1,7)', join: '', order: 'grp' },
  weekday: { label: 'Weekday', key: "CAST(strftime('%w', t.created_at) AS INTEGER)", join: '', order: 'grp' },
  hour: { label: 'Hour', key: "CAST(strftime('%H', t.created_at) AS INTEGER)", join: '', order: 'grp' },
  cashier: { label: 'Cashier', key: "COALESCE(u.full_name, 'POS integration')", join: 'LEFT JOIN users u ON u.id = t.user_id', order: 'gross DESC' },
  tier: { label: 'Tier', key: 'tr.name', join: 'LEFT JOIN tiers tr ON tr.id = t.tier_id', order: 'MIN(tr.sort)' },
  member: { label: 'Member', key: "m.full_name || ' (' || m.member_code || ')'", join: 'JOIN members m ON m.id = t.member_id', order: 'gross DESC' },
};

function buildReport(req) {
  const s = getSettings();
  const range = resolveRange(req.query, s.timezone);
  const branchId = scopedBranch(req, req.query.branch_id);
  const group = GROUPS[req.query.group] ? req.query.group : 'branch';
  const g = GROUPS[group];
  const w = L.whereRange(range.from, range.to, branchId, 't');
  let rows = all(`SELECT ${g.key} AS grp, COUNT(*) AS txns, COUNT(DISTINCT t.member_id) AS members,
      SUM(t.bill_amount) AS gross, SUM(t.discount_amount) AS discount, SUM(t.net_amount) AS net
    FROM transactions t ${g.join} WHERE ${w.sql} GROUP BY grp ORDER BY ${g.order} LIMIT 1000`, ...w.params);
  rows = rows.map((x) => ({
    group: group === 'weekday' ? L.DAY_NAMES[x.grp] : group === 'hour' ? `${String(x.grp).padStart(2, '0')}:00–${String((x.grp + 1) % 24).padStart(2, '0')}:00` : x.grp,
    txns: x.txns, members: x.members, gross: round2(x.gross), discount: round2(x.discount), net: round2(x.net),
    avg_basket: x.txns ? round2(x.gross / x.txns) : 0,
  }));
  const totals = L.kpis(range.from, range.to, branchId);
  const voids = one(`SELECT COUNT(*) AS n, COALESCE(SUM(bill_amount),0) AS amt FROM transactions t
    WHERE t.status = 'void' AND t.created_at >= ? AND t.created_at < ?${branchId ? ' AND t.branch_id = ?' : ''}`,
  w.params[0], w.params[1], ...(branchId ? [branchId] : []));
  const branch = branchId ? one('SELECT code, name, short_name FROM branches WHERE id = ?', branchId) : null;
  return { range, group, group_label: g.label, branch, rows, totals, voids: { count: voids.n, amount: round2(voids.amt) } };
}

r.get('/reports', requireRole(...STAFF), (req, res) => res.json(buildReport(req)));

r.get('/reports/export.csv', requireRole(...STAFF), (req, res) => {
  const rep = buildReport(req);
  const csv = toCsv([
    { label: rep.group_label, key: 'group' }, { label: 'Transactions', key: 'txns' }, { label: 'Unique Members', key: 'members' },
    { label: 'Gross Bill', key: 'gross' }, { label: 'Royal Discount', key: 'discount' }, { label: 'Net Collected', key: 'net' },
    { label: 'Avg Basket', key: 'avg_basket' },
  ], rep.rows);
  audit(req, 'report.export', 'report', null, { group: rep.group, from: rep.range.from, to: rep.range.to });
  sendCsv(res, `royal-report-by-${rep.group}-${rep.range.from}_to_${rep.range.to}.csv`, csv);
});

module.exports = { router: r };
