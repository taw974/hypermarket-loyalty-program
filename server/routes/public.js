'use strict';
// Member-facing digital card (no login, secret link) and the POS integration API.
const express = require('express');
const { one, all, run, getSettings } = require('../db');
const { HttpError, nowLocal, todayLocal, sha256, vStr, formatCardNumber } = require('../util');
const { clientIp, audit } = require('../auth');
const L = require('../logic');
const live = require('../live');

// ---------------- tiny rate limiter ----------------
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = clientIp(req);
    const rec = hits.get(key) || { n: 0, t: now };
    if (now - rec.t > windowMs) { rec.n = 0; rec.t = now; }
    rec.n++;
    hits.set(key, rec);
    if (hits.size > 5000) hits.clear();
    if (rec.n > max) return next(new HttpError(429, 'Too many requests, slow down'));
    next();
  };
}

// ---------------- Digital card ----------------
const pub = express.Router();
pub.use(rateLimit({ windowMs: 60000, max: 90 }));

pub.get('/card/:token', (req, res) => {
  const token = String(req.params.token || '');
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) throw new HttpError(404, 'Card not found');
  const m = one('SELECT * FROM members WHERE public_token = ?', token);
  if (!m) throw new HttpError(404, 'Card not found');
  const s = getSettings();
  const today = todayLocal(s.timezone);
  const c = L.currentCard(m.id);
  const stats = L.memberStats(m.id);
  const visits = all(`SELECT t.created_at, t.bill_amount, t.discount_amount, b.short_name AS branch
    FROM transactions t JOIN branches b ON b.id = t.branch_id
    WHERE t.member_id = ? AND t.status = 'completed' ORDER BY t.id DESC LIMIT 6`, m.id);
  res.set('Cache-Control', 'no-store');
  res.json({
    program: { name: s.program_name, tagline: s.program_tagline, currency: s.currency },
    member: { first_name: m.full_name.split(' ')[0], full_name: m.full_name, member_code: m.member_code, since: m.created_at.slice(0, 10) },
    card: c ? {
      card_number: c.card_number, status: L.effectiveStatus(c, today), issued_at: c.issued_at, expires_at: c.expires_at,
      tier: { name: c.tier_name, theme: c.tier_theme, discount_pct: c.discount_pct },
    } : null,
    stats: { visits: stats.visits, saved: stats.saved, spend: stats.spend, favorite_branch: stats.favorite_branch },
    visits,
    branches: all('SELECT code, brand, name, short_name, address, phone, map_url FROM branches WHERE active = 1 ORDER BY id'),
  });
});

// ---------------- POS integration API (X-API-Key) ----------------
const v1 = express.Router();
v1.use(rateLimit({ windowMs: 60000, max: 600 }));
v1.use((req, res, next) => {
  const key = String(req.headers['x-api-key'] || '');
  if (!key.startsWith('rlk_')) return next(new HttpError(401, 'Missing or invalid X-API-Key header'));
  const k = one('SELECT * FROM api_keys WHERE key_hash = ? AND active = 1', sha256(key));
  if (!k) return next(new HttpError(401, 'Invalid or revoked API key'));
  run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', nowLocal(getSettings().timezone), k.id);
  req.apiKey = k;
  next();
});

v1.get('/health', (req, res) => res.json({ ok: true, key: req.apiKey.name, branch_id: req.apiKey.branch_id }));

// Verify a scanned card: returns whether the discount may be applied and at what rate.
v1.get('/cards/:code', (req, res) => {
  const info = L.lookup(req.params.code, req.apiKey.branch_id);
  res.json({
    valid: info.eligibility.ok,
    card_number: info.card.card_number,
    card_number_formatted: formatCardNumber(info.card.card_number),
    member_name: info.member.full_name,
    member_code: info.member.member_code,
    tier: info.tier.name,
    discount_pct: info.tier.discount_pct,
    status: info.card.effective_status,
    messages: [...info.eligibility.blocks, ...info.eligibility.warnings].map((x) => x.message),
    rules: info.rules,
  });
});

// Record the discount that the POS applied.
v1.post('/redemptions', (req, res) => {
  const out = L.redeem({
    code: vStr(req.body.card_number, 'card_number', { required: true, max: 64 }),
    bill: req.body.bill_amount,
    invoice: req.body.invoice_no,
    branchId: req.apiKey.branch_id,
    apiKeyId: req.apiKey.id,
    confirmDuplicate: !!req.body.confirm_duplicate,
  });
  audit(req, 'txn.create', 'transaction', out.txn.id, { txn_no: out.txn.txn_no, bill: out.txn.bill_amount, discount: out.txn.discount_amount, api_key: req.apiKey.name });
  live.publish('txn', { type: 'created', txn: out.txn }, out.txn.branch_id);
  res.status(201).json({
    txn_no: out.txn.txn_no, bill_amount: out.calc.bill, discount_pct: out.calc.pct, discount_amount: out.calc.discount,
    net_amount: out.calc.net, capped: out.calc.capped, member_name: out.txn.member_name, created_at: out.txn.created_at,
  });
});

module.exports = { publicRouter: pub, apiV1: v1 };
