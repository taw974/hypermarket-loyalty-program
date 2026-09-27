'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.RL_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'royal-loyalty.db');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS branches (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  brand      TEXT NOT NULL,              -- 'welcome' | 'madina'
  name       TEXT NOT NULL,
  short_name TEXT NOT NULL,
  address    TEXT,
  phone      TEXT,
  map_url    TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tiers (
  id           INTEGER PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  discount_pct REAL NOT NULL,
  theme        TEXT NOT NULL,            -- 'gold' | 'platinum' | 'black'
  sort         INTEGER NOT NULL DEFAULT 0,
  is_default   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL,           -- 'admin' | 'manager' | 'cashier'
  branch_id     INTEGER REFERENCES branches(id),
  pass_hash     TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,           -- epoch ms
  ip         TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS members (
  id             INTEGER PRIMARY KEY,
  member_code    TEXT NOT NULL UNIQUE,
  full_name      TEXT NOT NULL,
  mobile         TEXT NOT NULL UNIQUE,
  email          TEXT,
  qid            TEXT,
  gender         TEXT,
  birth_date     TEXT,
  nationality    TEXT,
  notes          TEXT,
  home_branch_id INTEGER REFERENCES branches(id),
  public_token   TEXT NOT NULL UNIQUE,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id               INTEGER PRIMARY KEY,
  card_number      TEXT NOT NULL UNIQUE,
  member_id        INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  tier_id          INTEGER NOT NULL REFERENCES tiers(id),
  status           TEXT NOT NULL DEFAULT 'active', -- active | suspended | blocked | lost | replaced
  status_reason    TEXT,
  issued_at        TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  issued_branch_id INTEGER REFERENCES branches(id),
  issued_by        INTEGER REFERENCES users(id),
  printed_count    INTEGER NOT NULL DEFAULT 0,
  last_printed_at  TEXT,
  last_used_at     TEXT
);
CREATE INDEX IF NOT EXISTS cards_member ON cards(member_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  key_prefix   TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  branch_id    INTEGER REFERENCES branches(id),
  active       INTEGER NOT NULL DEFAULT 1,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id              INTEGER PRIMARY KEY,
  txn_no          TEXT NOT NULL UNIQUE,
  card_id         INTEGER NOT NULL REFERENCES cards(id),
  member_id       INTEGER NOT NULL REFERENCES members(id),
  branch_id       INTEGER NOT NULL REFERENCES branches(id),
  user_id         INTEGER REFERENCES users(id),
  api_key_id      INTEGER REFERENCES api_keys(id),
  tier_id         INTEGER REFERENCES tiers(id),
  discount_pct    REAL NOT NULL,
  bill_amount     REAL NOT NULL,
  discount_amount REAL NOT NULL,
  net_amount      REAL NOT NULL,
  pos_invoice     TEXT,
  status          TEXT NOT NULL DEFAULT 'completed', -- completed | void
  void_reason     TEXT,
  voided_by       INTEGER REFERENCES users(id),
  voided_at       TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS txn_created ON transactions(created_at);
CREATE INDEX IF NOT EXISTS txn_branch_created ON transactions(branch_id, created_at);
CREATE INDEX IF NOT EXISTS txn_card ON transactions(card_id, created_at);
CREATE INDEX IF NOT EXISTS txn_member ON transactions(member_id, created_at);
CREATE INDEX IF NOT EXISTS txn_invoice ON transactions(branch_id, pos_invoice);

CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY,
  at        TEXT NOT NULL,
  user_id   INTEGER,
  branch_id INTEGER,
  action    TEXT NOT NULL,
  entity    TEXT,
  entity_id INTEGER,
  details   TEXT,
  ip        TEXT
);
CREATE INDEX IF NOT EXISTS audit_at ON audit_log(at);
`);

// ---------- Query helpers ----------
const stmtCache = new Map();
function stmt(sql) {
  let s = stmtCache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
}
const clean = (params) => params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
const one = (sql, ...p) => stmt(sql).get(...clean(p));
const all = (sql, ...p) => stmt(sql).all(...clean(p));
const run = (sql, ...p) => stmt(sql).run(...clean(p));

let txDepth = 0;
function tx(fn) {
  if (txDepth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  txDepth++;
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    txDepth--;
  }
}

// ---------- Settings ----------
const DEFAULT_SETTINGS = {
  program_name: 'Royal Loyalty Card',
  program_tagline: 'Welcome Friends & Al Madina Hypermarkets',
  currency: 'QAR',
  timezone: 'Asia/Qatar',
  card_prefix: '9740',
  card_validity_years: 2,
  min_bill_amount: 0,
  max_discount_per_txn: 0,
  max_txn_per_card_per_day: 0,
  large_bill_warning: 2000,
  duplicate_window_sec: 90,
  require_pos_invoice: false,
  public_base_url: '',
  receipt_header: 'ROYAL LOYALTY CARD',
  receipt_footer: 'Thank you for shopping with us. Your royalty, our privilege.',
  demo_mode: true,
};

let settingsCache = null;
function getSettings() {
  if (!settingsCache) {
    const s = { ...DEFAULT_SETTINGS };
    for (const row of all('SELECT key, value FROM settings')) {
      try { s[row.key] = JSON.parse(row.value); } catch { /* ignore corrupt value */ }
    }
    settingsCache = s;
  }
  return settingsCache;
}
function setSettings(patch) {
  tx(() => {
    for (const [k, v] of Object.entries(patch)) {
      run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, JSON.stringify(v));
    }
  });
  settingsCache = null;
  return getSettings();
}

module.exports = { db, DB_PATH, DATA_DIR, one, all, run, tx, getSettings, setSettings, DEFAULT_SETTINGS };
