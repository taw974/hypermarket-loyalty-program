// App shell: session, navigation, router, live feed, command palette.
import {
  api, store, loadMeta, html, raw, ic, $, $$, on, fmt, toast, toastError, modal, theme, qatarNow, debounce, avatar, withBusy,
} from './core.js';
import { crownMark } from './icons.js';

const ALL = ['admin', 'manager', 'cashier'];
const STAFF = ['admin', 'manager'];

const NAV = [
  { group: 'Operations' },
  { id: 'pos', label: 'POS Terminal', icon: 'scan', roles: ALL, kbd: 'F2' },
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', roles: STAFF },
  { id: 'members', label: 'Members', icon: 'users', roles: ALL },
  { id: 'studio', label: 'Card Studio', icon: 'cards', roles: STAFF },
  { group: 'Insights' },
  { id: 'transactions', label: 'Transactions', icon: 'receipt', roles: STAFF },
  { id: 'reports', label: 'Reports', icon: 'chart', roles: STAFF },
  { id: 'branches', label: 'Branches', icon: 'store', roles: ALL },
  { group: 'Administration', roles: STAFF },
  { id: 'settings', label: 'Settings', icon: 'settings', roles: ['admin'] },
  { id: 'activity', label: 'Activity Log', icon: 'history', roles: STAFF },
];

const ROUTES = [
  { re: /^\/pos$/, page: 'pos', roles: ALL },
  { re: /^\/dashboard$/, page: 'dashboard', roles: STAFF },
  { re: /^\/members$/, page: 'members', roles: ALL },
  { re: /^\/members\/(\d+)$/, page: 'member', roles: ALL, nav: 'members' },
  { re: /^\/studio$/, page: 'studio', roles: STAFF },
  { re: /^\/transactions$/, page: 'transactions', roles: STAFF },
  { re: /^\/reports$/, page: 'reports', roles: STAFF },
  { re: /^\/branches$/, page: 'branches', roles: ALL },
  { re: /^\/settings(?:\/([a-z-]+))?$/, page: 'settings', roles: ['admin'] },
  { re: /^\/activity$/, page: 'activity', roles: STAFF },
  { re: /^\/display$/, page: 'display', roles: ALL, nav: 'pos' },
];

const homeFor = (role) => (role === 'cashier' ? '/pos' : '/dashboard');
const ROLE_LABEL = { admin: 'Administrator', manager: 'Manager', cashier: 'Cashier' };

let cleanup = null;
let renderSeq = 0;
let source = null;

// ---------------- Boot ----------------
async function boot() {
  theme.init();
  window.addEventListener('rl:unauthorized', () => showLogin('Your session has ended. Please sign in again.'));
  try {
    const me = await api('/auth/me');
    if (!me.user) return showLogin('', me);
    await startApp();
  } catch (err) {
    $('#app').innerHTML = String(html`<div class="boot"><div class="boot-text">Cannot reach the server</div><p class="muted">${err.message}</p>
      <button class="btn btn-outline" id="retry-btn">Retry</button></div>`);
    $('#retry-btn').addEventListener('click', () => location.reload());
  }
}

async function showLogin(message = '', me = null) {
  if (source) { source.close(); source = null; }
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const mod = await import('./pages/login.js');
  const info = me || await api('/auth/me').catch(() => ({}));
  mod.default.render($('#app'), { message, info, onLogin: startApp });
}

async function startApp() {
  await loadMeta();
  renderShell();
  connectLive();
  window.removeEventListener('hashchange', route);
  window.addEventListener('hashchange', route);
  if (!location.hash || location.hash === '#/' || location.hash === '#') location.hash = '#' + homeFor(store.user.role);
  else route();
}

// ---------------- Shell ----------------
function renderShell() {
  const u = store.user;
  const s = store.settings;
  const items = NAV.filter((n) => !n.roles || n.roles.includes(u.role));
  // drop empty group headers
  const nav = items.filter((n, i) => !n.group || (items[i + 1] && !items[i + 1].group));
  $('#app').innerHTML = String(html`
  <div class="shell">
    <aside class="sidebar" id="sidebar">
      <a class="brand" href="#${homeFor(u.role)}">
        <span class="brand-crest">${raw(crownMark('url(#sbFoil)', { id: 'sbFoil', size: 38 }))}</span>
        <span class="brand-text"><span class="brand-name">ROYAL</span><span class="brand-sub">LOYALTY PROGRAM</span></span>
      </a>
      <div class="brand-tagline">${s.program_tagline}</div>
      <nav class="nav" aria-label="Main">
        ${nav.map((n) => (n.group ? html`<div class="nav-label">${n.group}</div>`
    : html`<a class="nav-item" href="#/${n.id}" data-nav="${n.id}">${ic(n.icon)}<span>${n.label}</span>${n.kbd ? html`<span class="kbd">${n.kbd}</span>` : ''}</a>`))}
      </nav>
      <div class="side-foot">
        ${s.demo_mode ? html`<div class="demo-badge">${ic('sparkles', 'i-sm')} Demo mode · sample data</div>` : ''}
        <button class="user-card" id="user-menu" aria-haspopup="menu">
          ${avatar(u.full_name, 'gold', 36)}
          <span class="user-meta"><span class="user-name">${u.full_name}</span><span class="user-role">${ROLE_LABEL[u.role]}${u.branch_short ? ' · ' + u.branch_short : ' · All branches'}</span></span>
          ${ic('chevron-down', 'i-sm')}
        </button>
      </div>
    </aside>
    <div class="scrim" id="scrim"></div>
    <div class="main">
      <header class="topbar">
        <button class="btn btn-ghost btn-icon menu-btn" id="menu-btn" aria-label="Menu">${ic('menu')}</button>
        <div class="page-heading"><h1 class="page-title" id="page-title">&nbsp;</h1><div class="page-sub" id="page-sub"></div></div>
        <div class="spacer"></div>
        <button class="search-trigger" id="search-trigger">${ic('search')}<span>Search members, cards, pages…</span><span class="kbd">Ctrl K</span></button>
        <div class="live-pill" id="live-pill" title="Real-time connection"><span class="live-dot off"></span><span>LIVE</span></div>
        <div class="clock" id="clock"></div>
        <button class="btn btn-ghost btn-icon" id="theme-btn" aria-label="Toggle theme">${ic(theme.get() === 'light' ? 'moon' : 'sun')}</button>
        <button class="btn btn-ghost btn-icon hide-sm" id="fs-btn" aria-label="Full screen">${ic('maximize')}</button>
      </header>
      <main class="page" id="page" tabindex="-1"></main>
    </div>
  </div>`);

  $('#theme-btn').addEventListener('click', (e) => {
    const next = theme.get() === 'light' ? 'dark' : 'light';
    theme.set(next);
    e.currentTarget.innerHTML = String(ic(next === 'light' ? 'moon' : 'sun'));
  });
  $('#fs-btn').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });
  $('#menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
  $('#search-trigger').addEventListener('click', openPalette);
  $('#user-menu').addEventListener('click', openUserMenu);
  on($('#sidebar'), 'click', '.nav-item', () => document.body.classList.remove('nav-open'));

  const tick = () => {
    const d = qatarNow();
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const el = $('#clock');
    if (el) el.innerHTML = String(html`<b>${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}</b><span>${days[d.getUTCDay()]} ${fmt.dateShort(d.toISOString().slice(0, 10))} · Doha</span>`);
  };
  tick();
  clearInterval(window.__rlClock);
  window.__rlClock = setInterval(tick, 15000);
}

function setActiveNav(id) {
  $$('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.nav === id));
}

export function setTitle(title, sub = '') {
  const t = $('#page-title');
  if (t) t.textContent = title;
  const s = $('#page-sub');
  if (s) s.textContent = sub;
  document.title = `${title} · Royal Loyalty`;
}

// ---------------- Router ----------------
async function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path] = hash.split('?');
  const match = ROUTES.map((r) => ({ r, m: path.match(r.re) })).find((x) => x.m);
  if (!match) { location.hash = '#' + homeFor(store.user.role); return; }
  if (!match.r.roles.includes(store.user.role)) {
    toast('Not available for your role', 'Taking you to your home screen.', 'info');
    location.hash = '#' + homeFor(store.user.role);
    return;
  }
  const seq = ++renderSeq;
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  setActiveNav(match.r.nav || match.r.page);
  const pageEl = $('#page');
  pageEl.className = `page page-${match.r.page}`;
  pageEl.innerHTML = '<div class="page-loading"><span class="spinner"></span></div>';
  try {
    const mod = await import(`./pages/${match.r.page}.js`);
    if (seq !== renderSeq) return;
    const page = mod.default;
    setTitle(page.title || '', page.sub || '');
    pageEl.innerHTML = '';
    const out = await page.render(pageEl, { params: match.m.slice(1), navigate: (p) => { location.hash = '#' + p; }, setTitle });
    if (seq !== renderSeq) { if (typeof out === 'function') out(); return; }
    cleanup = typeof out === 'function' ? out : null;
    pageEl.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (err) {
    if (seq !== renderSeq) return;
    console.error(err);
    pageEl.innerHTML = String(html`<div class="panel panel-pad empty">${ic('alert')}<div><b>Could not open this page</b></div><div>${err.message}</div>
      <button class="btn btn-outline" id="reload-btn">Reload</button></div>`);
    $('#reload-btn').addEventListener('click', () => location.reload());
  }
}

// ---------------- Live (Server-Sent Events) ----------------
function connectLive() {
  if (source) source.close();
  source = new EventSource('/api/live');
  const dot = () => $('#live-pill .live-dot');
  source.addEventListener('open', () => { dot()?.classList.remove('off'); $('#live-pill')?.setAttribute('title', 'Live — updates arrive instantly'); });
  source.addEventListener('error', () => { dot()?.classList.add('off'); $('#live-pill')?.setAttribute('title', 'Reconnecting…'); });
  source.addEventListener('txn', (e) => {
    try { window.dispatchEvent(new CustomEvent('rl:txn', { detail: JSON.parse(e.data) })); } catch { /* ignore */ }
  });
  source.addEventListener('member', (e) => {
    try { window.dispatchEvent(new CustomEvent('rl:member', { detail: JSON.parse(e.data) })); } catch { /* ignore */ }
  });
}

// ---------------- User menu ----------------
function openUserMenu() {
  const u = store.user;
  const m = modal({
    title: u.full_name,
    sub: `${ROLE_LABEL[u.role]} · @${u.username}${u.branch_name ? ' · ' + u.branch_name : ''}`,
    body: html`<div class="menu-list">
      <button class="menu-row" data-act="password">${ic('lock')}<span><b>Change password</b><small>Keep your account secure</small></span></button>
      <button class="menu-row" data-act="shortcuts">${ic('keyboard')}<span><b>Keyboard shortcuts</b><small>Work faster at the counter</small></span></button>
      <button class="menu-row danger" data-act="logout">${ic('logout')}<span><b>Sign out</b><small>End this session on this device</small></span></button>
    </div>`,
  });
  on(m.el, 'click', '[data-act]', async (e, b) => {
    const act = b.dataset.act;
    if (act === 'logout') { await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {}); m.close(); showLogin('You have signed out.'); }
    if (act === 'password') { m.close(); changePassword(); }
    if (act === 'shortcuts') { m.close(); showShortcuts(); }
  });
}

function changePassword() {
  const m = modal({
    title: 'Change password',
    body: html`<form class="stack" id="pw-form">
      <div class="field"><label>Current password</label><input class="input" type="password" name="current_password" autocomplete="current-password" required></div>
      <div class="field"><label>New password</label><input class="input" type="password" name="new_password" autocomplete="new-password" minlength="8" required>
        <span class="hint">At least 8 characters with letters and numbers.</span></div>
      <div class="form-error hidden" data-err></div></form>`,
    foot: html`<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" form="pw-form" type="submit">Update password</button>`,
  });
  m.$('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      await withBusy(m.$('.modal-foot .btn-primary'), () => api('/auth/password', { method: 'POST', body: fd }));
      m.close();
      toast('Password updated', '', 'good');
    } catch (err) {
      const el = m.$('[data-err]');
      el.textContent = err.message;
      el.classList.remove('hidden');
    }
  });
}

function showShortcuts() {
  const rows = [['Ctrl + K', 'Search members, cards and pages'], ['F2', 'Open POS terminal / focus the scan box'], ['F4', 'Scan with camera (POS)'],
    ['Enter', 'Apply Royal discount (POS)'], ['F9', 'Print last discount slip (POS)'], ['Esc', 'Clear / next customer (POS)']];
  modal({
    title: 'Keyboard shortcuts',
    body: html`<div class="shortcut-list">${rows.map(([k, v]) => html`<div><span class="kbd">${k}</span><span>${v}</span></div>`)}</div>
      <p class="muted" style="margin-top:14px">USB & Bluetooth barcode scanners work anywhere on the POS screen — no need to click the scan box first.</p>`,
  });
}

// ---------------- Command palette ----------------
function openPalette() {
  if ($('.palette')) return;
  const pages = NAV.filter((n) => n.id && n.roles.includes(store.user.role));
  const m = modal({
    title: 'Search',
    body: html`<div class="palette">
      <div class="input-group">${ic('search')}<input class="input" id="pal-q" placeholder="Member name, mobile, card number or page…" autocomplete="off" autofocus></div>
      <div class="pal-results" id="pal-results"></div></div>`,
    size: 'wide',
  });
  const res = m.$('#pal-results');
  let items = [];
  let sel = 0;
  const paint = () => {
    res.innerHTML = items.length ? String(html`${items.map((it, i) => html`<button class="pal-item ${i === sel ? 'on' : ''}" data-i="${i}">
      ${it.avatar ? avatar(it.label, it.theme, 30) : html`<span class="pal-ic">${ic(it.icon)}</span>`}
      <span class="grow"><b>${it.label}</b>${it.sub ? html`<small>${it.sub}</small>` : ''}</span>
      <span class="pal-kind">${it.kind}</span></button>`)}`) : String(html`<div class="empty">${ic('search')}No matches</div>`);
  };
  const setItems = (list) => { items = list; sel = 0; paint(); };
  const pageItems = (q) => pages.filter((p) => !q || p.label.toLowerCase().includes(q.toLowerCase()))
    .map((p) => ({ kind: 'Page', label: p.label, icon: p.icon, go: '/' + p.id }));
  setItems(pageItems(''));
  let ctrl;
  const search = debounce(async (q) => {
    const base = pageItems(q);
    if (q.trim().length < 2) return setItems(base);
    ctrl?.abort();
    ctrl = new AbortController();
    try {
      const r = await api('/members', { query: { q, limit: 8 }, signal: ctrl.signal });
      setItems([...r.rows.map((x) => ({
        kind: x.tier_name || 'Member', label: x.full_name, avatar: true, theme: x.tier_theme,
        sub: `${fmt.phone(x.mobile)} · ${fmt.mask(x.card_number)} · ${x.member_code}`, go: '/members/' + x.id,
      })), ...base]);
    } catch (err) { if (err.name !== 'AbortError') setItems(base); }
  }, 180);
  const input = m.$('#pal-q');
  input.addEventListener('input', () => search(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); paint(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); }
    if (e.key === 'Enter' && items[sel]) { e.preventDefault(); m.close(); location.hash = '#' + items[sel].go; }
  });
  on(res, 'click', '.pal-item', (e, b) => { const it = items[Number(b.dataset.i)]; m.close(); location.hash = '#' + it.go; });
}

// ---------------- Global keys ----------------
document.addEventListener('keydown', (e) => {
  if (!store.user) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  if (e.key === 'F2' && !location.hash.startsWith('#/pos')) { e.preventDefault(); location.hash = '#/pos'; }
});

boot().catch(toastError);
