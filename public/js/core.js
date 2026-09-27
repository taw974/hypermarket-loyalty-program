// Shared helpers: safe HTML templating, API client, formatting, toasts,
// modals, sounds and celebration effects.
import { icon } from './icons.js';

// ---------------- HTML (auto-escaped tagged templates) ----------------
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s ?? ''));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
function toHtml(v) {
  if (v == null || v === false) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(toHtml).join('');
  return esc(v);
}
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += toHtml(vals[i]) + strings[i + 1];
  return new Safe(out);
}
export const ic = (name, cls) => raw(icon(name, cls));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export function on(root, type, selector, fn, opts) {
  const h = (e) => {
    const t = e.target.closest(selector);
    if (t && root.contains(t)) fn(e, t);
  };
  root.addEventListener(type, h, opts);
  return () => root.removeEventListener(type, h, opts);
}
export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------------- API ----------------
export async function api(path, { method = 'GET', body, query, signal } = {}) {
  let url = '/api' + path;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== '' && v != null) qs.set(k, v);
    const s = qs.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  const headers = { 'X-Requested-With': 'RoyalLoyalty' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method, signal, headers, credentials: 'same-origin', body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    const err = new Error('Cannot reach the Royal Loyalty server. Check the network connection.');
    err.status = 0;
    throw err;
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('rl:unauthorized'));
    throw err;
  }
  return data;
}
export function apiUrl(path, query) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) if (v !== '' && v != null) qs.set(k, v);
  const s = qs.toString();
  return '/api' + path + (s ? '?' + s : '');
}

// ---------------- App state ----------------
export const store = {
  user: null, settings: {}, branches: [], tiers: [], clockOffset: 0,
  branch(id) { return this.branches.find((b) => b.id === Number(id)); },
  tier(id) { return this.tiers.find((t) => t.id === Number(id)); },
  can(...roles) { return !!this.user && roles.includes(this.user.role); },
  get currency() { return this.settings.currency || 'QAR'; },
};
export async function loadMeta() {
  const m = await api('/meta');
  store.settings = m.settings;
  store.branches = m.branches;
  store.tiers = m.tiers;
  store.user = m.user;
  store.clockOffset = Date.parse(m.now.replace(' ', 'T') + 'Z') - Date.now();
  return m;
}
// Current Qatar wall-clock time as a Date whose UTC fields hold local values.
export const qatarNow = () => new Date(Date.now() + store.clockOffset);

// ---------------- Formatting ----------------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const n2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const parse = (s) => new Date(String(s).replace(' ', 'T') + (String(s).length <= 10 ? 'T00:00:00Z' : 'Z'));
export const fmt = {
  money: (v, cur = true) => (cur ? store.currency + ' ' : '') + n2.format(Number(v) || 0),
  amount: (v) => n2.format(Number(v) || 0),
  int: (v) => n0.format(Number(v) || 0),
  compact(v) {
    const n = Number(v) || 0;
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.0+$/, '') + 'M';
    if (a >= 1e4) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return n0.format(n);
  },
  moneyCompact: (v) => store.currency + ' ' + fmt.compact(v),
  pct: (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`),
  date(s) { if (!s) return '—'; const d = parse(s); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; },
  dateShort(s) { if (!s) return '—'; const d = parse(s); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; },
  dayName(s) { return DAYS[parse(s).getUTCDay()]; },
  time: (s) => (s ? String(s).slice(11, 16) : ''),
  dateTime(s) { if (!s) return '—'; return `${fmt.dateShort(s)}, ${fmt.time(s)}`; },
  monthName(ym) { const [y, m] = ym.split('-'); return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`; },
  rel(s) {
    if (!s) return 'never';
    const diff = (qatarNow() - parse(s)) / 1000;
    if (diff < 45) return 'just now';
    if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
    const days = Math.round(diff / 86400);
    if (days < 31) return `${days} day${days > 1 ? 's' : ''} ago`;
    return fmt.date(s);
  },
  mmyy: (ymd) => (ymd ? ymd.slice(5, 7) + '/' + ymd.slice(2, 4) : '--/--'),
  card: (n) => String(n || '').replace(/(\d{4})(?=\d)/g, '$1 '),
  mask: (n) => (n ? '•••• ' + String(n).slice(-4) : ''),
  phone(p) {
    const s = String(p || '');
    const m = s.match(/^\+974(\d{4})(\d{4})$/);
    return m ? `+974 ${m[1]} ${m[2]}` : s;
  },
  initials(name) {
    const parts = String(name || '').replace(/^(Al-|Al )/i, '').split(/\s+/).filter(Boolean);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1].replace(/^Al-/i, '')[0] : '')).toUpperCase();
  },
};

export const STATUS = {
  active: { label: 'Active', cls: 'chip-good', icon: 'check-circle' },
  expired: { label: 'Expired', cls: 'chip-warn', icon: 'clock' },
  suspended: { label: 'Suspended', cls: 'chip-serious', icon: 'alert' },
  blocked: { label: 'Blocked', cls: 'chip-critical', icon: 'ban' },
  lost: { label: 'Lost', cls: 'chip-critical', icon: 'x-circle' },
  replaced: { label: 'Replaced', cls: 'chip-muted', icon: 'refresh' },
  completed: { label: 'Completed', cls: 'chip-good', icon: 'check' },
  void: { label: 'Void', cls: 'chip-critical', icon: 'ban' },
};
export const statusChip = (s) => {
  const st = STATUS[s] || { label: s || '—', cls: 'chip-muted', icon: 'info' };
  return html`<span class="chip ${st.cls}">${ic(st.icon)}${st.label}</span>`;
};
export const tierChip = (name, theme) => html`<span class="chip tier-chip"><span class="swatch ${theme || 'gold'}"></span>${name || 'Royal'}</span>`;
export const avatar = (name, theme = 'gold', size = 38) => html`<span class="avatar ${theme}" style="--size:${size}px">${fmt.initials(name)}</span>`;
export function deltaHtml(cur, prev, { goodWhenUp = true } = {}) {
  if (!prev) return cur ? html`<span class="delta up">${ic('sparkles', 'i-sm')} new</span>` : html`<span class="delta">—</span>`;
  const p = ((cur - prev) / prev) * 100;
  const up = p >= 0;
  const good = up === goodWhenUp;
  return html`<span class="delta ${good ? 'good' : 'bad'}">${ic(up ? 'trend-up' : 'trend-down', 'i-sm')}${fmt.pct(p)}</span>`;
}

// ---------------- Toasts ----------------
function toastRoot() {
  let r = $('.toasts');
  if (!r) { r = document.createElement('div'); r.className = 'toasts'; r.setAttribute('role', 'status'); document.body.appendChild(r); }
  return r;
}
export function toast(title, text = '', type = 'info', ms = 4200) {
  const icons = { good: 'check-circle', bad: 'alert', gold: 'crown', info: 'info' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = String(html`${ic(icons[type] || 'info')}<div><div class="toast-title">${title}</div>${text ? html`<div class="toast-text">${text}</div>` : ''}</div>`);
  toastRoot().appendChild(el);
  const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 320); };
  const t = setTimeout(kill, ms);
  el.addEventListener('click', () => { clearTimeout(t); kill(); });
  return el;
}
export const toastError = (err) => toast(err?.message || 'Something went wrong', '', 'bad', 5500);

// ---------------- Modals ----------------
export function modal({ title, sub = '', body = '', foot = '', size = '', dismissible = true, onClose } = {}) {
  const root = document.createElement('div');
  root.className = 'modal-root';
  root.innerHTML = String(html`
    <div class="modal-backdrop"></div>
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${typeof title === 'string' ? title : 'Dialog'}">
      <div class="modal-head">
        <div><div class="modal-title">${title}</div>${sub ? html`<div class="modal-sub">${sub}</div>` : ''}</div>
        ${dismissible ? html`<button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="Close">${ic('x')}</button>` : ''}
      </div>
      <div class="modal-body">${body}</div>
      ${foot ? html`<div class="modal-foot">${foot}</div>` : ''}
    </div>`);
  const prevFocus = document.activeElement;
  document.body.appendChild(root);
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    if (prevFocus && prevFocus.isConnected && prevFocus.focus) prevFocus.focus({ preventScroll: true });
    onClose && onClose(result);
  };
  const onKey = (e) => { if (e.key === 'Escape' && dismissible) { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  if (dismissible) {
    root.querySelector('.modal-backdrop').addEventListener('click', () => close());
    root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close()));
  }
  setTimeout(() => {
    const f = root.querySelector('[autofocus], .modal-body input:not([type=hidden]), .modal-body select, .modal-foot .btn-primary');
    if (f) f.focus();
  }, 30);
  return { root, el: root.querySelector('.modal'), close, $: (s) => root.querySelector(s), $$: (s) => Array.from(root.querySelectorAll(s)) };
}

export function confirmDialog({ title, text = '', confirmText = 'Confirm', danger = false, input = null, icon: iconName = danger ? 'alert' : 'info' }) {
  return new Promise((resolve) => {
    const m = modal({
      title,
      body: html`<div class="confirm-body">
        <div class="confirm-icon ${danger ? 'danger' : ''}">${ic(iconName, 'i-lg')}</div>
        <div class="grow"><p class="soft">${text}</p>
        ${input ? html`<div class="field" style="margin-top:14px"><label>${input.label}</label>
          ${input.options ? html`<select class="select" data-input>${input.options.map((o) => html`<option value="${o.value}">${o.label}</option>`)}</select>`
    : html`<input class="input" data-input placeholder="${input.placeholder || ''}" value="${input.value || ''}" autofocus>`}</div>` : ''}
        <div class="form-error hidden" data-err></div></div></div>`,
      foot: html`<button class="btn btn-ghost" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${confirmText}</button>`,
      onClose: (r) => resolve(r ?? false),
    });
    const ok = () => {
      if (input) {
        const v = m.$('[data-input]').value.trim();
        if (input.required && v.length < (input.min || 1)) {
          const e = m.$('[data-err]');
          e.textContent = input.requiredMsg || 'This field is required';
          e.classList.remove('hidden');
          return;
        }
        m.close(v);
      } else m.close(true);
    };
    m.$('[data-ok]').addEventListener('click', ok);
    m.root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); ok(); } });
  });
}

// ---------------- Buttons ----------------
export async function withBusy(btn, fn) {
  if (!btn) return fn();
  const prev = btn.innerHTML;
  btn.classList.add('is-loading');
  btn.innerHTML = '<span class="spinner"></span>' + (btn.dataset.busy ? `<span>${esc(btn.dataset.busy)}</span>` : '');
  try { return await fn(); } finally { btn.classList.remove('is-loading'); btn.innerHTML = prev; }
}

// ---------------- Misc ----------------
export function download(url) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export async function copyText(text, label = 'Copied to clipboard') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
  }
  toast(label, '', 'good', 2200);
}
export function memberLink(token) {
  const base = (store.settings.public_base_url || location.origin).replace(/\/+$/, '');
  return `${base}/m/${token}`;
}
export function whatsappLink(mobile, text) {
  return `https://wa.me/${String(mobile || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

export function countUp(el, to, { dur = 900, format = (v) => fmt.int(v), from } = {}) {
  if (!el) return;
  const start = from ?? (Number(el.dataset.v) || 0);
  el.dataset.v = to;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || start === to) { el.textContent = format(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = format(start + (to - start) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Hash query helpers (#/page?x=1)
export function hashQuery() {
  const q = location.hash.split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(q));
}
export function setHashQuery(obj) {
  const [path] = location.hash.split('?');
  const qs = new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== '' && v != null)).toString();
  history.replaceState(null, '', path + (qs ? '?' + qs : ''));
}

// ---------------- Sound (WebAudio, no files) ----------------
let actx;
export const sound = {
  get enabled() { try { return localStorage.getItem('rl.sound') !== 'off'; } catch { return true; } },
  set enabled(v) { try { localStorage.setItem('rl.sound', v ? 'on' : 'off'); } catch { /* ignore */ } },
  play(kind) {
    if (!this.enabled) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const now = actx.currentTime;
      const tone = (freq, t, dur, type = 'sine', gain = 0.16) => {
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, now + t);
        g.gain.exponentialRampToValueAtTime(gain, now + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + t + dur);
        o.connect(g).connect(actx.destination);
        o.start(now + t); o.stop(now + t + dur + 0.05);
      };
      if (kind === 'success') { tone(1046.5, 0, 0.5); tone(1318.5, 0.09, 0.55); tone(1568, 0.18, 0.9, 'sine', 0.12); }
      else if (kind === 'scan') { tone(1760, 0, 0.12, 'triangle', 0.1); }
      else if (kind === 'error') { tone(220, 0, 0.25, 'sawtooth', 0.08); tone(174.6, 0.18, 0.35, 'sawtooth', 0.08); }
    } catch { /* audio unsupported */ }
  },
};

// ---------------- Gold confetti ----------------
export function confetti({ x = 0.5, y = 0.45, count = 150 } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'fx-canvas';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  document.body.appendChild(c);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const colors = ['#fff0b5', '#f6e08f', '#d4af37', '#c9a13a', '#a88223', '#ffffff'];
  const ps = Array.from({ length: count }, () => {
    const a = Math.random() * Math.PI * 2;
    const v = 6 + Math.random() * 10;
    return {
      x: innerWidth * x, y: innerHeight * y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 6,
      w: 5 + Math.random() * 7, h: 8 + Math.random() * 10, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      c: colors[(Math.random() * colors.length) | 0], life: 0, shape: Math.random() < 0.3 ? 'star' : 'rect',
    };
  });
  const t0 = performance.now();
  const frame = (t) => {
    const el = t - t0;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of ps) {
      p.vy += 0.32; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - el / 2600);
      ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      if (p.shape === 'star') {
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          ctx.lineTo(Math.cos((i * 4 * Math.PI) / 5) * p.w, Math.sin((i * 4 * Math.PI) / 5) * p.w);
        }
        ctx.closePath(); ctx.fill();
      } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
      ctx.restore();
    }
    if (el < 2700) requestAnimationFrame(frame); else c.remove();
  };
  requestAnimationFrame(frame);
}

// ---------------- Theme ----------------
export const theme = {
  get() { try { return localStorage.getItem('rl.theme') || 'dark'; } catch { return 'dark'; } },
  set(v) {
    document.documentElement.dataset.theme = v;
    try { localStorage.setItem('rl.theme', v); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('rl:theme', { detail: v }));
  },
  init() { document.documentElement.dataset.theme = this.get(); },
};
