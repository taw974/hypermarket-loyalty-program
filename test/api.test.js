// End-to-end API tests: boots a real server on a throw-away database.
// Run with:  npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 19000 + Math.floor(Math.random() * 800);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'royal-test-'));
let server;

function client() {
  let cookie = '';
  return async function call(method, url, body, headers = {}) {
    const res = await fetch(BASE + url, {
      method,
      headers: { 'X-Requested-With': 'RoyalLoyalty', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : await res.text() };
  };
}
const luhnOk = (n) => {
  let sum = 0;
  for (let i = 0; i < n.length; i++) {
    let d = Number(n[n.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
};

const admin = client();
const cashier = client();
let goldCard;
let blockedCard;

before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', RL_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errOut = '';
  server.stderr.on('data', (d) => { errOut += d; });
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${BASE}/api/auth/me`); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Server did not start: ' + errOut);
});

after(async () => {
  if (server && server.exitCode === null) {
    const exited = new Promise((r) => server.once('exit', r));
    server.kill();
    await exited;
  }
  // Windows keeps the SQLite file locked for a moment after exit.
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test('rejects a wrong password and accepts the admin', async () => {
  assert.equal((await admin('POST', '/api/auth/login', { username: 'admin', password: 'nope' })).status, 401);
  const r = await admin('POST', '/api/auth/login', { username: 'admin', password: 'Admin@123' });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.role, 'admin');
});

test('blocks state-changing requests without the app header (CSRF guard)', async () => {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
});

test('ships the five branches from the brief and a 15% default tier', async () => {
  const { body } = await admin('GET', '/api/meta');
  assert.equal(body.branches.length, 5);
  assert.deepEqual(body.branches.map((b) => b.phone), ['3058 5327', '3058 5353', '7774 5061', '3058 5317', '3058 5310']);
  const def = body.tiers.find((t) => t.is_default);
  assert.equal(def.name, 'Royal Gold');
  assert.equal(def.discount_pct, 15);
});

test('demo data is loaded', async () => {
  const { body } = await admin('GET', '/api/members', null);
  assert.ok(body.total >= 150);
  const all = (await admin('GET', '/api/members?limit=200')).body.rows;
  goldCard = all.find((m) => m.tier_theme === 'gold' && m.card_effective_status === 'active').card_number;
  blockedCard = all.find((m) => m.card_effective_status === 'blocked').card_number;
  assert.ok(goldCard && blockedCard);
});

test('scanning a Royal Gold card at any branch gives exactly 15% off', async () => {
  const look = await admin('GET', `/api/pos/lookup?code=${goldCard}&branch_id=4`);
  assert.equal(look.status, 200);
  assert.equal(look.body.eligibility.ok, true);
  assert.equal(look.body.tier.discount_pct, 15);
  const r = await admin('POST', '/api/pos/redeem', { code: goldCard, bill_amount: 300, branch_id: 4, pos_invoice: 'T-300' });
  assert.equal(r.status, 201);
  assert.equal(r.body.txn.discount_amount, 45);
  assert.equal(r.body.txn.net_amount, 255);
  assert.match(r.body.txn.txn_no, /^RL\d{6}-04-\d{4}$/);
  const r2 = await admin('POST', '/api/pos/redeem', { code: goldCard, bill_amount: 200, branch_id: 2 });
  assert.equal(r2.body.txn.discount_amount, 30);
  const r3 = await admin('POST', '/api/pos/redeem', { code: `  ${goldCard.replace(/(\d{4})/g, '$1 ')}`, bill_amount: 86.37, branch_id: 1 });
  assert.equal(r3.body.txn.discount_amount, 12.96);
  assert.equal(r3.body.txn.net_amount, 73.41);
});

test('guards against double-scans and re-used invoices', async () => {
  const dup = await admin('POST', '/api/pos/redeem', { code: goldCard, bill_amount: 200, branch_id: 2 });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'duplicate');
  const ok = await admin('POST', '/api/pos/redeem', { code: goldCard, bill_amount: 200, branch_id: 2, confirm_duplicate: true });
  assert.equal(ok.status, 201);
  const inv = await admin('POST', '/api/pos/redeem', { code: goldCard, bill_amount: 10, branch_id: 4, pos_invoice: 'T-300' });
  assert.equal(inv.status, 409);
  assert.equal(inv.body.code, 'invoice_used');
});

test('refuses blocked cards and unknown or counterfeit numbers', async () => {
  const look = await admin('GET', `/api/pos/lookup?code=${blockedCard}&branch_id=1`);
  assert.equal(look.body.eligibility.ok, false);
  const r = await admin('POST', '/api/pos/redeem', { code: blockedCard, bill_amount: 100, branch_id: 1 });
  assert.equal(r.status, 422);
  const fake = await admin('GET', '/api/pos/lookup?code=9740123412341234&branch_id=1');
  assert.equal(fake.status, 404);
});

test('enrolling a member issues a unique, check-digit-valid card', async () => {
  const r = await admin('POST', '/api/members', { full_name: 'Test Member', mobile: '33445566', home_branch_id: 3 });
  assert.equal(r.status, 201);
  assert.match(r.body.card.card_number, /^9740\d{12}$/);
  assert.ok(luhnOk(r.body.card.card_number));
  assert.equal(r.body.member.mobile, '+97433445566');
  const again = await admin('POST', '/api/members', { full_name: 'Someone Else', mobile: '3344 5566' });
  assert.equal(again.status, 409);
  const byMobile = await admin('GET', '/api/pos/lookup?code=33445566&branch_id=3');
  assert.equal(byMobile.body.matched_by, 'mobile');
  const pub = await fetch(`${BASE}/api/public/card/${r.body.member.public_token}`).then((x) => x.json());
  assert.equal(pub.card.card_number, r.body.card.card_number);
  assert.equal((await fetch(`${BASE}/api/public/card/not-a-real-token-123`)).status, 404);
});

test('program rules: cap, minimum bill and daily limit', async () => {
  await admin('PUT', '/api/settings', { max_discount_per_txn: 20, min_bill_amount: 50, max_txn_per_card_per_day: 0 });
  const capped = await admin('POST', '/api/pos/redeem', { code: goldCard, bill_amount: 400, branch_id: 5 });
  assert.equal(capped.body.txn.discount_amount, 20);
  const small = await admin('POST', '/api/pos/redeem', { code: goldCard, bill_amount: 30, branch_id: 5 });
  assert.equal(small.status, 422);
  await admin('PUT', '/api/settings', { max_discount_per_txn: 0, min_bill_amount: 0, max_txn_per_card_per_day: 1 });
  const limited = await admin('POST', '/api/pos/redeem', { code: goldCard, bill_amount: 99, branch_id: 5 });
  assert.equal(limited.status, 422);
  await admin('PUT', '/api/settings', { max_txn_per_card_per_day: 0 });
});

test('voiding reverses a discount in the totals', async () => {
  const r = await admin('POST', '/api/pos/redeem', { code: goldCard, bill_amount: 1000, branch_id: 3, confirm_duplicate: true });
  const before = (await admin('GET', '/api/stats/overview?range=today&branch_id=3')).body.current.discount;
  const v = await admin('POST', `/api/transactions/${r.body.txn.id}/void`, { reason: 'Customer returned items' });
  assert.equal(v.body.txn.status, 'void');
  const after = (await admin('GET', '/api/stats/overview?range=today&branch_id=3')).body.current.discount;
  assert.equal(Math.round((before - after) * 100) / 100, 150);
});

test('cashiers are locked to their own branch and cannot see analytics', async () => {
  assert.equal((await cashier('POST', '/api/auth/login', { username: 'cashier2', password: 'Cashier@123' })).status, 200);
  assert.equal((await cashier('GET', '/api/stats/overview')).status, 403);
  assert.equal((await cashier('GET', '/api/users')).status, 403);
  const r = await cashier('POST', '/api/pos/redeem', { code: goldCard, bill_amount: 57.5, branch_id: 5, confirm_duplicate: true });
  assert.equal(r.status, 201);
  assert.equal(r.body.txn.branch_code, 'BR-02');
  // A cashier cannot hand out a VIP tier or another branch's membership, even by crafting the request.
  const black = (await admin('GET', '/api/tiers')).body.rows.find((t) => t.code === 'BLACK');
  const m = await cashier('POST', '/api/members', { full_name: 'Counter Signup', mobile: '66778899', tier_id: black.id, home_branch_id: 5 });
  assert.equal(m.status, 201);
  assert.equal(m.body.tier.discount_pct, 15);
  assert.equal(m.body.member.home_branch_id, 2);
  const branches = (await cashier('GET', '/api/branches')).body.rows;
  assert.equal(branches.length, 5);
  assert.equal(branches[0].month, undefined);
});

test('POS integration API verifies and records with an API key', async () => {
  const k = await admin('POST', '/api/api-keys', { name: 'Test POS', branch_id: 1 });
  const key = k.body.key;
  const verify = await fetch(`${BASE}/api/v1/cards/${goldCard}`, { headers: { 'X-API-Key': key } }).then((x) => x.json());
  assert.equal(verify.valid, true);
  assert.equal(verify.discount_pct, 15);
  const rec = await fetch(`${BASE}/api/v1/redemptions`, {
    method: 'POST', headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ card_number: goldCard, bill_amount: 250, invoice_no: 'API-1' }),
  }).then((x) => x.json());
  assert.equal(rec.discount_amount, 37.5);
  assert.equal(rec.net_amount, 212.5);
  assert.equal((await fetch(`${BASE}/api/v1/cards/${goldCard}`, { headers: { 'X-API-Key': 'rlk_wrong' } })).status, 401);
});
