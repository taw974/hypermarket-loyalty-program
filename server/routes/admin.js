'use strict';
// Administration: branches, tiers, staff users, program rules, API keys,
// audit trail, backups and the demo → live switch-over.
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const sqlite = require('node:sqlite');
const { db, one, all, run, tx, getSettings, setSettings, DB_PATH, DATA_DIR } = require('../db');
const { HttpError, nowLocal, todayLocal, addDays, round2, vStr, vNum, vEnum, randomToken, sha256 } = require('../util');
const { ROLES, USER_SQL, hashPassword, checkPasswordStrength, requireAuth, requireRole, audit } = require('../auth');
const { wipeDemoData } = require('../seed');
const L = require('../logic');
const live = require('../live');

const r = express.Router();
const ADMIN = requireRole('admin');
const STAFF = requireRole('admin', 'manager');
const startedAt = Date.now();

// ---------------- Branches ----------------
r.get('/branches', requireAuth, (req, res) => {
  const tz = getSettings().timezone;
  const today = todayLocal(tz);
  const monthStart = today.slice(0, 8) + '01';
  const cashier = req.user.role === 'cashier';
  const rows = all('SELECT * FROM branches ORDER BY id').map((b) => {
    const members = one('SELECT COUNT(*) AS n FROM members WHERE home_branch_id = ?', b.id).n;
    const staff = one('SELECT COUNT(*) AS n FROM users WHERE branch_id = ? AND active = 1', b.id).n;
    if (cashier) return { ...b, members, staff }; // no sales figures for counter staff
    const t = L.kpis(today, today, b.id);
    const m = L.kpis(monthStart, today, b.id);
    const spark = all(`SELECT substr(created_at,1,10) AS d, SUM(bill_amount) AS gross FROM transactions
      WHERE branch_id = ? AND status = 'completed' AND created_at >= ? GROUP BY d`, b.id, L.dayStart(addDays(today, -13)));
    const map = new Map(spark.map((x) => [x.d, round2(x.gross)]));
    const trend = Array.from({ length: 14 }, (_, i) => map.get(addDays(today, i - 13)) || 0);
    return { ...b, today: t, month: m, trend, members, staff };
  });
  res.json({ rows });
});

r.put('/branches/:id', ADMIN, (req, res) => {
  const id = Number(req.params.id);
  const b = one('SELECT * FROM branches WHERE id = ?', id);
  if (!b) throw new HttpError(404, 'Branch not found');
  const x = req.body;
  const next = {
    name: vStr(x.name ?? b.name, 'Branch name', { required: true, max: 80 }),
    short_name: vStr(x.short_name ?? b.short_name, 'Short name', { required: true, max: 30 }),
    address: vStr(x.address ?? b.address, 'Address', { max: 160 }),
    phone: vStr(x.phone ?? b.phone, 'Phone', { max: 30 }),
    map_url: vStr(x.map_url ?? b.map_url, 'Map link', { max: 300, pattern: /^https?:\/\//, patternMsg: 'Map link must start with http(s)://' }),
    brand: vEnum(x.brand ?? b.brand, 'Brand', ['welcome', 'madina'], { required: true }),
    active: x.active === undefined ? b.active : x.active ? 1 : 0,
  };
  run('UPDATE branches SET name=?, short_name=?, address=?, phone=?, map_url=?, brand=?, active=? WHERE id=?',
    next.name, next.short_name, next.address, next.phone, next.map_url, next.brand, next.active, id);
  audit(req, 'branch.update', 'branch', id, next);
  res.json({ branch: one('SELECT * FROM branches WHERE id = ?', id) });
});

// ---------------- Tiers ----------------
r.get('/tiers', requireAuth, (req, res) => {
  const today = todayLocal(getSettings().timezone);
  res.json({
    rows: all(`SELECT tr.*, (SELECT COUNT(*) FROM cards c WHERE c.tier_id = tr.id AND c.status = 'active' AND c.expires_at >= ?
      AND c.id = (SELECT MAX(id) FROM cards WHERE member_id = c.member_id)) AS active_cards FROM tiers tr ORDER BY sort`, today),
  });
});

function tierInput(x, prev = {}) {
  return {
    name: vStr(x.name ?? prev.name, 'Tier name', { required: true, max: 40 }),
    discount_pct: vNum(x.discount_pct ?? prev.discount_pct, 'Discount %', { required: true, min: 0, max: 90 }),
    theme: vEnum(x.theme ?? prev.theme, 'Card design', ['gold', 'platinum', 'black'], { required: true }),
    active: x.active === undefined ? (prev.active ?? 1) : x.active ? 1 : 0,
    is_default: x.is_default === undefined ? (prev.is_default ?? 0) : x.is_default ? 1 : 0,
  };
}

r.put('/tiers/:id', ADMIN, (req, res) => {
  const id = Number(req.params.id);
  const t = one('SELECT * FROM tiers WHERE id = ?', id);
  if (!t) throw new HttpError(404, 'Tier not found');
  const next = tierInput(req.body, t);
  if (!next.active && next.is_default) throw new HttpError(400, 'The default tier must stay active');
  tx(() => {
    if (next.is_default) run('UPDATE tiers SET is_default = 0');
    run('UPDATE tiers SET name=?, discount_pct=?, theme=?, active=?, is_default=? WHERE id=?', next.name, next.discount_pct, next.theme, next.active, next.is_default, id);
    if (!one('SELECT id FROM tiers WHERE is_default = 1')) run('UPDATE tiers SET is_default = 1 WHERE id = (SELECT id FROM tiers WHERE active = 1 ORDER BY sort LIMIT 1)');
  });
  audit(req, 'tier.update', 'tier', id, { from: { name: t.name, pct: t.discount_pct }, to: { name: next.name, pct: next.discount_pct } });
  res.json({ tier: one('SELECT * FROM tiers WHERE id = ?', id) });
});

r.post('/tiers', ADMIN, (req, res) => {
  const next = tierInput(req.body);
  const code = vStr(req.body.code, 'Tier code', { required: true, max: 20, pattern: /^[A-Z0-9_]+$/i, patternMsg: 'Tier code: letters, numbers and _ only' }).toUpperCase();
  if (one('SELECT id FROM tiers WHERE code = ?', code)) throw new HttpError(409, 'Tier code already exists');
  const sort = (one('SELECT MAX(sort) AS s FROM tiers').s || 0) + 1;
  const out = run('INSERT INTO tiers(code, name, discount_pct, theme, sort, is_default, active) VALUES(?,?,?,?,?,0,?)', code, next.name, next.discount_pct, next.theme, sort, next.active);
  audit(req, 'tier.create', 'tier', Number(out.lastInsertRowid), next);
  res.status(201).json({ tier: one('SELECT * FROM tiers WHERE id = ?', Number(out.lastInsertRowid)) });
});

// ---------------- Users ----------------
r.get('/users', ADMIN, (req, res) => {
  res.json({
    rows: all(`${USER_SQL} ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.username`).map((u) => ({
      ...u,
      txns_30d: one("SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND created_at >= ?", u.id, L.dayStart(addDays(todayLocal(getSettings().timezone), -29))).n,
    })),
  });
});

function userInput(x, prev = {}) {
  const role = vEnum(x.role ?? prev.role, 'Role', ROLES, { required: true });
  let branchId = x.branch_id !== undefined ? (Number(x.branch_id) || null) : prev.branch_id ?? null;
  if (role === 'admin') branchId = null;
  if (role === 'cashier' && !branchId) throw new HttpError(400, 'A cashier must be assigned to a branch');
  if (branchId && !one('SELECT id FROM branches WHERE id = ?', branchId)) throw new HttpError(400, 'Unknown branch');
  return {
    full_name: vStr(x.full_name ?? prev.full_name, 'Full name', { required: true, max: 80 }),
    role, branch_id: branchId,
    active: x.active === undefined ? (prev.active ?? 1) : x.active ? 1 : 0,
  };
}

r.post('/users', ADMIN, (req, res) => {
  const username = vStr(req.body.username, 'Username', { required: true, min: 3, max: 40, pattern: /^[a-z0-9._-]+$/i, patternMsg: 'Username: letters, numbers, dot, dash, underscore' });
  if (one('SELECT id FROM users WHERE username = ?', username)) throw new HttpError(409, 'Username already taken');
  const u = userInput(req.body);
  const pw = checkPasswordStrength(req.body.password);
  const out = run('INSERT INTO users(username, full_name, role, branch_id, pass_hash, active, is_demo, created_at) VALUES(?,?,?,?,?,?,0,?)',
    username, u.full_name, u.role, u.branch_id, hashPassword(pw), u.active, nowLocal(getSettings().timezone));
  audit(req, 'user.create', 'user', Number(out.lastInsertRowid), { username, role: u.role });
  res.status(201).json({ user: one(`${USER_SQL} WHERE u.id = ?`, Number(out.lastInsertRowid)) });
});

r.put('/users/:id', ADMIN, (req, res) => {
  const id = Number(req.params.id);
  const prev = one('SELECT * FROM users WHERE id = ?', id);
  if (!prev) throw new HttpError(404, 'User not found');
  const u = userInput(req.body, prev);
  if (prev.role === 'admin' && (u.role !== 'admin' || !u.active)) {
    const admins = one("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?", id).n;
    if (!admins) throw new HttpError(400, 'At least one active administrator is required');
  }
  run('UPDATE users SET full_name=?, role=?, branch_id=?, active=? WHERE id=?', u.full_name, u.role, u.branch_id, u.active, id);
  if (!u.active) run('DELETE FROM sessions WHERE user_id = ?', id);
  audit(req, 'user.update', 'user', id, u);
  res.json({ user: one(`${USER_SQL} WHERE u.id = ?`, id) });
});

r.post('/users/:id/password', ADMIN, (req, res) => {
  const id = Number(req.params.id);
  if (!one('SELECT id FROM users WHERE id = ?', id)) throw new HttpError(404, 'User not found');
  const pw = checkPasswordStrength(req.body.password);
  run('UPDATE users SET pass_hash = ?, is_demo = 0 WHERE id = ?', hashPassword(pw), id);
  run('DELETE FROM sessions WHERE user_id = ? AND user_id <> ?', id, req.user.id);
  audit(req, 'user.reset_password', 'user', id);
  res.json({ ok: true });
});

// ---------------- Settings ----------------
const SETTING_RULES = {
  program_name: (v) => vStr(v, 'Program name', { required: true, max: 60 }),
  program_tagline: (v) => vStr(v, 'Tagline', { max: 100 }) || '',
  card_prefix: (v) => vStr(v, 'Card prefix', { required: true, pattern: /^\d{3,6}$/, patternMsg: 'Card prefix must be 3–6 digits' }),
  card_validity_years: (v) => vNum(v, 'Card validity', { required: true, min: 1, max: 10, int: true }),
  min_bill_amount: (v) => vNum(v, 'Minimum bill', { required: true, min: 0, max: 100000 }),
  max_discount_per_txn: (v) => vNum(v, 'Max discount per bill', { required: true, min: 0, max: 100000 }),
  max_txn_per_card_per_day: (v) => vNum(v, 'Uses per card per day', { required: true, min: 0, max: 50, int: true }),
  large_bill_warning: (v) => vNum(v, 'Large bill warning', { required: true, min: 0, max: 1000000 }),
  duplicate_window_sec: (v) => vNum(v, 'Duplicate protection window', { required: true, min: 0, max: 3600, int: true }),
  require_pos_invoice: (v) => !!v,
  public_base_url: (v) => (vStr(v, 'Public URL', { max: 200, pattern: /^https?:\/\/[^\s]+$/, patternMsg: 'Public URL must start with http(s)://' }) || '').replace(/\/+$/, ''),
  receipt_header: (v) => vStr(v, 'Receipt header', { max: 60 }) || '',
  receipt_footer: (v) => vStr(v, 'Receipt footer', { max: 160 }) || '',
};

r.get('/settings', ADMIN, (req, res) => res.json({ settings: getSettings() }));

r.put('/settings', ADMIN, (req, res) => {
  const patch = {};
  for (const [k, fn] of Object.entries(SETTING_RULES)) if (req.body[k] !== undefined) patch[k] = fn(req.body[k]);
  if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update');
  const before = getSettings();
  const changed = Object.fromEntries(Object.entries(patch).filter(([k, v]) => JSON.stringify(before[k]) !== JSON.stringify(v)));
  const s = setSettings(patch);
  audit(req, 'settings.update', 'settings', null, changed);
  res.json({ settings: s });
});

// ---------------- API keys (POS integration) ----------------
r.get('/api-keys', ADMIN, (req, res) => {
  res.json({ rows: all(`SELECT k.id, k.name, k.key_prefix, k.branch_id, k.active, k.created_at, k.last_used_at, b.short_name AS branch
    FROM api_keys k LEFT JOIN branches b ON b.id = k.branch_id ORDER BY k.id DESC`) });
});

r.post('/api-keys', ADMIN, (req, res) => {
  const name = vStr(req.body.name, 'Key name', { required: true, max: 60 });
  const branchId = Number(req.body.branch_id) || null;
  if (!branchId || !one('SELECT id FROM branches WHERE id = ?', branchId)) throw new HttpError(400, 'Choose the branch this POS integration belongs to');
  const key = 'rlk_' + randomToken(24);
  const out = run('INSERT INTO api_keys(name, key_prefix, key_hash, branch_id, active, created_by, created_at) VALUES(?,?,?,?,1,?,?)',
    name, key.slice(0, 10), sha256(key), branchId, req.user.id, nowLocal(getSettings().timezone));
  audit(req, 'apikey.create', 'api_key', Number(out.lastInsertRowid), { name, branch_id: branchId });
  res.status(201).json({ id: Number(out.lastInsertRowid), key });
});

r.delete('/api-keys/:id', ADMIN, (req, res) => {
  const id = Number(req.params.id);
  run('UPDATE api_keys SET active = 0 WHERE id = ?', id);
  audit(req, 'apikey.revoke', 'api_key', id);
  res.json({ ok: true });
});

// ---------------- Audit trail ----------------
r.get('/audit', STAFF, (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const page = Math.max(1, Number(req.query.page) || 1);
  const where = [];
  const params = [];
  if (req.query.action) { where.push('a.action LIKE ?'); params.push(String(req.query.action) + '%'); }
  if (req.user.role !== 'admin' && req.user.branch_id) { where.push('(a.branch_id = ? OR a.user_id = ?)'); params.push(req.user.branch_id, req.user.id); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = one(`SELECT COUNT(*) AS n FROM audit_log a ${w}`, ...params).n;
  const rows = all(`SELECT a.*, u.username, u.full_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ${w}
    ORDER BY a.at DESC, a.id DESC LIMIT ? OFFSET ?`, ...params, limit, (page - 1) * limit);
  res.json({ rows, total, page, limit });
});

// ---------------- Backups & system ----------------
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
async function makeBackup(tag = 'auto') {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = nowLocal(getSettings().timezone).replace(/[-: ]/g, '').slice(0, 12);
  const file = path.join(BACKUP_DIR, `royal-loyalty-${stamp}-${tag}.db`);
  await sqlite.backup(db, file);
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort();
  while (files.length > 20) fs.rmSync(path.join(BACKUP_DIR, files.shift()), { force: true });
  return file;
}

r.get('/admin/backup', ADMIN, async (req, res) => {
  const file = await makeBackup('manual');
  audit(req, 'system.backup', 'system', null, { file: path.basename(file) });
  res.download(file, path.basename(file));
});

r.get('/admin/system', ADMIN, (req, res) => {
  const size = (p) => { try { return fs.statSync(p).size; } catch { return 0; } };
  const backups = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort().reverse() : [];
  res.json({
    node: process.version, uptime_sec: Math.round((Date.now() - startedAt) / 1000), db_bytes: size(DB_PATH) + size(DB_PATH + '-wal'),
    db_path: DB_PATH, live_clients: live.count(), backups: backups.slice(0, 8), backup_dir: BACKUP_DIR,
    counts: one(`SELECT (SELECT COUNT(*) FROM members) AS members, (SELECT COUNT(*) FROM cards) AS cards,
      (SELECT COUNT(*) FROM transactions) AS transactions, (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM audit_log) AS audit`),
  });
});

// Switch from demo to production: wipe demo members/cards/transactions, secure the admin.
r.post('/admin/go-live', ADMIN, async (req, res) => {
  if (String(req.body.confirm || '').trim().toUpperCase() !== 'GO LIVE') throw new HttpError(400, 'Type GO LIVE to confirm');
  const pw = checkPasswordStrength(req.body.admin_password);
  await makeBackup('before-go-live');
  tx(() => {
    wipeDemoData();
    if (req.body.remove_demo_users) {
      run('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE is_demo = 1)');
      run('DELETE FROM users WHERE is_demo = 1 AND id <> ?', req.user.id);
    }
    run('UPDATE users SET pass_hash = ?, is_demo = 0 WHERE id = ?', hashPassword(pw), req.user.id);
  });
  setSettings({ demo_mode: false });
  audit(req, 'system.go_live', 'system', null, { removed_demo_users: !!req.body.remove_demo_users });
  res.json({ ok: true });
});

module.exports = { router: r, makeBackup };
