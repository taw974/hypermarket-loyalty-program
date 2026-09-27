'use strict';
const crypto = require('node:crypto');

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// ---------- Time (all business time is stored as Qatar local wall-clock) ----------
const fmtCache = new Map();
function tzFormatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }));
  }
  return fmtCache.get(tz);
}
function localParts(date = new Date(), tz = 'Asia/Qatar') {
  const p = {};
  for (const { type, value } of tzFormatter(tz).formatToParts(date)) p[type] = value;
  return p;
}
function nowLocal(tz, date) {
  const p = localParts(date, tz);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
function todayLocal(tz, date) {
  return nowLocal(tz, date).slice(0, 10);
}
// Plain calendar arithmetic on 'YYYY-MM-DD' strings (timezone-free).
function addDays(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function addYears(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
function isYmd(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

// Resolve a date-range preset into inclusive local dates.
function resolveRange(q, tz) {
  const today = todayLocal(tz);
  const preset = q.range || '30d';
  let from, to = today;
  switch (preset) {
    case 'today': from = today; break;
    case 'yesterday': from = to = addDays(today, -1); break;
    case '7d': from = addDays(today, -6); break;
    case '30d': from = addDays(today, -29); break;
    case '90d': from = addDays(today, -89); break;
    case '365d': from = addDays(today, -364); break;
    case 'mtd': from = today.slice(0, 8) + '01'; break;
    case 'ytd': from = today.slice(0, 5) + '01-01'; break;
    case 'custom':
      if (!isYmd(q.from) || !isYmd(q.to)) throw new HttpError(400, 'Custom range needs valid from/to dates');
      from = q.from; to = q.to;
      if (from > to) [from, to] = [to, from];
      if (daysBetween(from, to) > 3660) throw new HttpError(400, 'Range too large');
      break;
    default: throw new HttpError(400, 'Unknown range');
  }
  const days = daysBetween(from, to) + 1;
  return { preset, from, to, days, prevFrom: addDays(from, -days), prevTo: addDays(from, -1) };
}

// ---------- Money ----------
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ---------- Card numbers (16 digits, Luhn-checked) ----------
function luhnDigit(payload) {
  let sum = 0;
  let dbl = true;
  for (let i = payload.length - 1; i >= 0; i--) {
    let d = payload.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return String((10 - (sum % 10)) % 10);
}
function luhnValid(num) {
  return /^\d{12,19}$/.test(num) && luhnDigit(num.slice(0, -1)) === num.slice(-1);
}
function randomDigits(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += crypto.randomInt(0, 10);
  return s;
}
function makeCardNumber(prefix) {
  const p = String(prefix || '9740').replace(/\D/g, '').slice(0, 6) || '9740';
  const payload = p + randomDigits(15 - p.length);
  return payload + luhnDigit(payload);
}
const formatCardNumber = (n) => String(n || '').replace(/(\d{4})(?=\d)/g, '$1 ');
const maskCardNumber = (n) => (n ? '•••• ' + String(n).slice(-4) : '');

function randomToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString('base64url');
}
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// ---------- Phone numbers (Qatar) ----------
// Stores as +974XXXXXXXX. Accepts 8-digit local numbers or full international numbers.
function normalizeMobile(input) {
  if (input == null) return null;
  let d = String(input).replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (/^\d{8}$/.test(d)) return '+974' + d;
  if (/^974\d{8}$/.test(d)) return '+' + d;
  if (/^\+\d{8,15}$/.test(d)) return d;
  return null;
}

// ---------- Validation ----------
function vStr(v, name, { required = false, max = 200, min = 0, pattern, patternMsg } = {}) {
  if (v == null || String(v).trim() === '') {
    if (required) throw new HttpError(400, `${name} is required`);
    return null;
  }
  const s = String(v).trim();
  if (s.length > max) throw new HttpError(400, `${name} is too long (max ${max})`);
  if (s.length < min) throw new HttpError(400, `${name} is too short (min ${min})`);
  if (pattern && !pattern.test(s)) throw new HttpError(400, patternMsg || `${name} is invalid`);
  return s;
}
function vNum(v, name, { required = false, min = -Infinity, max = Infinity, int = false } = {}) {
  if (v == null || v === '') {
    if (required) throw new HttpError(400, `${name} is required`);
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, `${name} must be a number`);
  if (int && !Number.isInteger(n)) throw new HttpError(400, `${name} must be a whole number`);
  if (n < min) throw new HttpError(400, `${name} must be at least ${min}`);
  if (n > max) throw new HttpError(400, `${name} must be at most ${max}`);
  return n;
}
function vEnum(v, name, allowed, { required = false } = {}) {
  if (v == null || v === '') {
    if (required) throw new HttpError(400, `${name} is required`);
    return null;
  }
  if (!allowed.includes(v)) throw new HttpError(400, `${name} must be one of: ${allowed.join(', ')}`);
  return v;
}

function csvEscape(v) {
  if (v == null) return '';
  let s = String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(headers, rows) {
  const lines = [headers.map((h) => csvEscape(h.label)).join(',')];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(typeof h.value === 'function' ? h.value(r) : r[h.key])).join(','));
  return '﻿' + lines.join('\r\n');
}

module.exports = {
  HttpError, localParts, nowLocal, todayLocal, addDays, addYears, daysBetween, isYmd, resolveRange,
  round2, luhnDigit, luhnValid, makeCardNumber, formatCardNumber, maskCardNumber, randomToken, sha256,
  normalizeMobile, vStr, vNum, vEnum, toCsv,
};
