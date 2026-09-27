'use strict';
// Base data (5 branches, card tiers, first admin) + a realistic demo dataset so the
// dashboard is alive on the very first run. The demo can be wiped later from
// Settings → Go Live, or regenerated with `npm run seed:demo`.
const { db, one, all, run, tx, getSettings, setSettings } = require('./db');
const { hashPassword } = require('./auth');
const { nowLocal, todayLocal, addDays, addYears, round2, luhnDigit, randomToken } = require('./util');

const BRANCHES = [
  { code: 'BR-01', brand: 'welcome', name: 'Welcome Friends Hypermarket', short_name: 'Muaither', address: 'Al Dome St, Muaither, Ar Rayyan', phone: '3058 5327', map_url: 'https://maps.app.goo.gl/8FwDkVsPj74fGNxZ7' },
  { code: 'BR-02', brand: 'welcome', name: 'Welcome Friends Hypermarket – H1', short_name: 'H1 Camp', address: 'Argentine Neighborhood Camp-H1', phone: '3058 5353', map_url: 'https://maps.app.goo.gl/58YyWfQhDXfJopsF6' },
  { code: 'BR-03', brand: 'welcome', name: 'Welcome Friends Hypermarket – F5', short_name: 'F5 Camp', address: 'Argentine Neighborhood Camp-F5', phone: '7774 5061', map_url: 'https://maps.app.goo.gl/EAEBdodDBVn61Qzv7' },
  { code: 'BR-04', brand: 'madina', name: 'Al Madina Hypermarket – 01', short_name: 'Service Hub-1', address: 'Service Hub-1, Birkat Al Awamer', phone: '3058 5317', map_url: 'https://maps.app.goo.gl/Ht5easErYVZtr9sg9' },
  { code: 'BR-05', brand: 'madina', name: 'Al Madina Hypermarket – 02', short_name: 'Logistic Park A', address: 'Logistic Park A, Birkat Al Awamer', phone: '3058 5310', map_url: 'https://maps.app.goo.gl/ag9ZTti3qomU2Wyu8' },
];

const TIERS = [
  { code: 'GOLD', name: 'Royal Gold', discount_pct: 15, theme: 'gold', sort: 1, is_default: 1 },
  { code: 'PLATINUM', name: 'Royal Platinum', discount_pct: 20, theme: 'platinum', sort: 2, is_default: 0 },
  { code: 'BLACK', name: 'Royal Black', discount_pct: 25, theme: 'black', sort: 3, is_default: 0 },
];

const DEMO_USERS = [
  { username: 'admin', full_name: 'System Administrator', role: 'admin', branch: null, password: 'Admin@123' },
  { username: 'manager', full_name: 'Operations Manager', role: 'manager', branch: null, password: 'Manager@123' },
  { username: 'cashier1', full_name: 'Rashed Ahmed', role: 'cashier', branch: 'BR-01', password: 'Cashier@123' },
  { username: 'cashier2', full_name: 'Joel Fernandes', role: 'cashier', branch: 'BR-02', password: 'Cashier@123' },
  { username: 'cashier3', full_name: 'Shahidul Islam', role: 'cashier', branch: 'BR-03', password: 'Cashier@123' },
  { username: 'cashier4', full_name: 'Anas Rahman', role: 'cashier', branch: 'BR-04', password: 'Cashier@123' },
  { username: 'cashier5', full_name: 'Bikash Thapa', role: 'cashier', branch: 'BR-05', password: 'Cashier@123' },
];

function ensureBase() {
  const tz = getSettings().timezone;
  const now = nowLocal(tz);
  tx(() => {
    if (!one('SELECT COUNT(*) AS n FROM branches').n) {
      for (const b of BRANCHES) {
        run('INSERT INTO branches(code, brand, name, short_name, address, phone, map_url, active, created_at) VALUES(?,?,?,?,?,?,?,1,?)',
          b.code, b.brand, b.name, b.short_name, b.address, b.phone, b.map_url, now);
      }
    }
    if (!one('SELECT COUNT(*) AS n FROM tiers').n) {
      for (const t of TIERS) {
        run('INSERT INTO tiers(code, name, discount_pct, theme, sort, is_default, active) VALUES(?,?,?,?,?,?,1)',
          t.code, t.name, t.discount_pct, t.theme, t.sort, t.is_default);
      }
    }
    if (!one('SELECT COUNT(*) AS n FROM users').n) {
      for (const u of DEMO_USERS) {
        const branch = u.branch ? one('SELECT id FROM branches WHERE code = ?', u.branch).id : null;
        run('INSERT INTO users(username, full_name, role, branch_id, pass_hash, active, is_demo, created_at) VALUES(?,?,?,?,?,1,?,?)',
          u.username, u.full_name, u.role, branch, hashPassword(u.password), u.username === 'admin' ? 0 : 1, now);
      }
    }
  });
}

// ---------- Deterministic random ----------
function mulberry32(seed) {
  return function rand() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = {
  Qatar: { w: 18, code: '634', m: ['Mohammed', 'Ahmed', 'Abdullah', 'Khalid', 'Hamad', 'Ali', 'Jassim', 'Nasser', 'Fahad', 'Saad', 'Salem', 'Rashid', 'Majid', 'Faisal'], f: ['Fatima', 'Aisha', 'Maryam', 'Noora', 'Hessa', 'Al Anoud', 'Sara', 'Reem', 'Moza', 'Amna', 'Dana', 'Latifa'], l: ['Al-Kuwari', 'Al-Marri', 'Al-Mohannadi', 'Al-Sulaiti', 'Al-Naimi', 'Al-Emadi', 'Al-Hajri', 'Al-Kaabi', 'Al-Dosari', 'Al-Ansari', 'Al-Mannai', 'Al-Khater', 'Al-Muraikhi', 'Al-Hitmi'] },
  India: { w: 20, code: '356', m: ['Arjun', 'Rahul', 'Suresh', 'Rajesh', 'Vijay', 'Anil', 'Sanjay', 'Abdul', 'Shameer', 'Nizar', 'Jithin', 'Praveen', 'Sreejith', 'Faizal'], f: ['Priya', 'Anjali', 'Divya', 'Lakshmi', 'Shabna', 'Reshma', 'Neha', 'Meera'], l: ['Nair', 'Menon', 'Kumar', 'Pillai', 'Thomas', 'Varghese', 'Sharma', 'Reddy', 'Kunhi', 'Joseph', 'Mathew', 'Iyer'] },
  Bangladesh: { w: 16, code: '050', m: ['Rahim', 'Karim', 'Kamal', 'Jamal', 'Shafiqul', 'Mizanur', 'Anwar', 'Rafiq', 'Habib', 'Sohel', 'Rubel', 'Mamun', 'Jahangir', 'Nurul', 'Sabbir', 'Tanvir'], f: ['Nasrin', 'Shirin', 'Taslima', 'Rokeya', 'Sumaiya', 'Farzana'], l: ['Uddin', 'Hossain', 'Islam', 'Rahman', 'Ahmed', 'Miah', 'Chowdhury', 'Sarker', 'Alam', 'Hasan', 'Molla', 'Sheikh'] },
  Pakistan: { w: 10, code: '586', m: ['Imran', 'Asif', 'Bilal', 'Usman', 'Zubair', 'Kashif', 'Adnan', 'Waqas', 'Shahid', 'Tariq'], f: ['Ayesha', 'Hina', 'Sana', 'Mehwish', 'Rabia'], l: ['Khan', 'Iqbal', 'Butt', 'Malik', 'Qureshi', 'Chaudhry', 'Raza', 'Javed', 'Siddiqui', 'Mirza'] },
  Philippines: { w: 10, code: '608', m: ['Jose', 'Mark', 'John Paul', 'Christian', 'Ramon', 'Jerome', 'Ryan', 'Carlo'], f: ['Maria', 'Angelica', 'Jennifer', 'Kristine', 'Joy', 'Rowena', 'Mary Grace', 'Liza'], l: ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Garcia', 'Mendoza', 'Dela Cruz', 'Villanueva', 'Ramos', 'Aquino'] },
  Egypt: { w: 8, code: '818', m: ['Mahmoud', 'Mostafa', 'Amr', 'Karim', 'Hany', 'Tarek', 'Sherif', 'Walid', 'Islam'], f: ['Mona', 'Dina', 'Rania', 'Heba', 'Yasmin', 'Nourhan'], l: ['Hassan', 'Adel', 'Samir', 'Farouk', 'Mansour', 'Abdelrahman', 'Salah', 'Fathy', 'Gamal', 'Hamdy'] },
  Nepal: { w: 8, code: '524', m: ['Nabin', 'Prakash', 'Suman', 'Bikash', 'Ramesh', 'Dipak', 'Sujan', 'Anil'], f: ['Sita', 'Gita', 'Anita', 'Sunita', 'Puja'], l: ['Thapa', 'Gurung', 'Shrestha', 'Rai', 'Tamang', 'Magar', 'Karki', 'Adhikari', 'Bhandari'] },
  'Sri Lanka': { w: 5, code: '144', m: ['Nuwan', 'Kasun', 'Chaminda', 'Ruwan', 'Fazil', 'Rizwan'], f: ['Dilani', 'Nadeesha', 'Chathurika', 'Fathima'], l: ['Perera', 'Fernando', 'Silva', 'Jayasuriya', 'Bandara', 'Wickramasinghe'] },
  Jordan: { w: 5, code: '400', m: ['Omar', 'Yousef', 'Ibrahim', 'Hassan', 'Khaled', 'Mazen', 'Sami', 'Hisham'], f: ['Layla', 'Rana', 'Lina', 'Huda', 'Samar'], l: ['Haddad', 'Nasser', 'Saleh', 'Othman', 'Barakat', 'Khalil', 'Awad'] },
};

const VOID_REASONS = ['Wrong amount entered', 'Customer returned items', 'Duplicate scan at counter', 'Bill cancelled by customer'];
const HOUR_W = { 7: 1, 8: 2, 9: 3, 10: 5, 11: 6, 12: 5, 13: 4, 14: 3, 15: 3, 16: 4, 17: 6, 18: 8, 19: 10, 20: 11, 21: 10, 22: 7, 23: 3 };
const DOW_W = [0.95, 0.85, 0.85, 0.9, 1.15, 1.4, 1.25]; // Sun..Sat — Thu/Fri/Sat busiest in Qatar

function seedDemo({ memberCount = 180, days = 150, seed = 974 } = {}) {
  const rand = mulberry32(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const weighted = (entries) => {
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total;
    for (const [v, w] of entries) { if ((r -= w) <= 0) return v; }
    return entries[entries.length - 1][0];
  };
  const gauss = () => { let u = 0; let v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const pad = (n, l = 2) => String(n).padStart(l, '0');

  const settings = getSettings();
  const tz = settings.timezone;
  const nowStr = nowLocal(tz);
  const today = nowStr.slice(0, 10);
  const nowHour = Number(nowStr.slice(11, 13));

  const branches = all('SELECT * FROM branches ORDER BY id');
  const tiers = all('SELECT * FROM tiers ORDER BY sort');
  const users = all('SELECT * FROM users');
  const admin = users.find((u) => u.role === 'admin');
  const manager = users.find((u) => u.role === 'manager') || admin;
  const cashierOf = new Map(branches.map((b) => [b.id, users.find((u) => u.role === 'cashier' && u.branch_id === b.id) || manager]));
  const branchW = [30, 20, 15, 20, 15];

  const usedMobiles = new Set(all('SELECT mobile FROM members').map((r) => r.mobile));
  const usedCards = new Set(all('SELECT card_number FROM cards').map((r) => r.card_number));
  const cardNo = () => {
    for (;;) {
      let p = String(settings.card_prefix || '9740');
      while (p.length < 15) p += Math.floor(rand() * 10);
      const n = p + luhnDigit(p);
      if (!usedCards.has(n)) { usedCards.add(n); return n; }
    }
  };
  const years = Math.max(1, Number(settings.card_validity_years) || 2);

  tx(() => {
    const insMember = db.prepare(`INSERT INTO members(member_code, full_name, mobile, email, qid, gender, birth_date, nationality, notes,
        home_branch_id, public_token, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insCard = db.prepare(`INSERT INTO cards(card_number, member_id, tier_id, status, status_reason, issued_at, expires_at,
        issued_branch_id, issued_by, printed_count, last_printed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    const insTxn = db.prepare(`INSERT INTO transactions(txn_no, card_id, member_id, branch_id, user_id, tier_id, discount_pct,
        bill_amount, discount_amount, net_amount, pos_invoice, status, void_reason, voided_by, voided_at, created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insAudit = db.prepare('INSERT INTO audit_log(at, user_id, branch_id, action, entity, entity_id, details, ip) VALUES(?,?,?,?,?,?,?,?)');

    const plans = [];
    for (let i = 0; i < memberCount; i++) {
      const nat = weighted(Object.entries(NAMES).map(([k, v]) => [k, v.w]));
      const pool = NAMES[nat];
      const female = rand() < 0.3;
      const first = pick(female ? pool.f : pool.m);
      const last = pick(pool.l);
      const fullName = nat === 'Qatar' || nat === 'Jordan'
        ? `${first} ${rand() < 0.5 ? pick(pool.m) + ' ' : ''}${last}`
        : `${first} ${last}`;
      let mobile;
      do { mobile = '+974' + pick(['3', '5', '6', '7']) + pad(Math.floor(rand() * 1e7), 7); } while (usedMobiles.has(mobile));
      usedMobiles.add(mobile);
      const age = 22 + Math.floor(rand() * 42);
      const by = Number(today.slice(0, 4)) - age;
      const birth = `${by}-${pad(1 + Math.floor(rand() * 12))}-${pad(1 + Math.floor(rand() * 28))}`;
      const qid = rand() < 0.75 ? `${by < 2000 ? 2 : 3}${String(by).slice(2)}${pool.code}${pad(Math.floor(rand() * 1e5), 5)}` : null;
      const email = rand() < 0.4 ? `${first.split(' ')[0]}.${last.replace(/^Al-/, '')}${Math.floor(rand() * 90) + 10}@gmail.com`.toLowerCase() : null;
      const home = branches[weighted(branchW.map((w, idx) => [idx, w]))];

      // Join date: a launch wave ~5-8 months ago, then steady growth, plus a few this week.
      let joinDaysAgo;
      if (i < 5) joinDaysAgo = 365 * years - 8 - Math.floor(rand() * 20); // cards about to expire
      else if (i >= memberCount - 7) joinDaysAgo = Math.floor(rand() * 6);
      else if (rand() < 0.55) joinDaysAgo = days + Math.floor(rand() * 90);
      else joinDaysAgo = 7 + Math.floor(rand() * (days - 7));
      const joined = addDays(today, -joinDaysAgo);
      const tier = i % 29 === 3 ? tiers[2] : i % 11 === 5 ? tiers[1] : tiers[0];

      plans.push({
        fullName, mobile, email, qid, gender: female ? 'female' : 'male', birth, nat, home, joined, tier,
        freq: 0.035 + rand() * rand() * 0.32, loyalty: 0.72 + rand() * 0.2,
        spend: 95 + rand() * 120 + (tier.theme !== 'gold' ? 90 : 0),
        status: 'active', statusAt: null, replacedAt: null,
      });
    }
    // A few realistic exceptions for the demo.
    const tweak = (idx, fn) => { if (plans[idx]) fn(plans[idx]); };
    tweak(20, (p) => { p.status = 'suspended'; p.statusAt = addDays(today, -12); p.reason = 'Verification pending'; });
    tweak(41, (p) => { p.status = 'blocked'; p.statusAt = addDays(today, -26); p.reason = 'Card shared with non-member'; });
    tweak(63, (p) => { p.replacedAt = addDays(today, -33); p.replaceStatus = 'lost'; });
    tweak(88, (p) => { p.replacedAt = addDays(today, -9); p.replaceStatus = 'replaced'; p.replaceReason = 'Damaged card'; });

    const txns = [];
    const memberIds = [];
    for (const p of plans) {
      const createdAt = `${p.joined} ${pad(9 + Math.floor(rand() * 12))}:${pad(Math.floor(rand() * 60))}:${pad(Math.floor(rand() * 60))}`;
      const creator = rand() < 0.6 ? admin : manager;
      const r = insMember.run('TMP-' + randomToken(8), p.fullName, p.mobile, p.email, p.qid, p.gender, p.birth, p.nat, null,
        p.home.id, randomToken(15), creator.id, createdAt, createdAt);
      const memberId = Number(r.lastInsertRowid);
      run('UPDATE members SET member_code = ? WHERE id = ?', 'RM-' + (10000 + memberId), memberId);
      memberIds.push(memberId);
      insAudit.run(createdAt, creator.id, null, 'member.create', 'member', memberId, JSON.stringify({ name: p.fullName }), '10.0.0.' + (10 + Math.floor(rand() * 40)));

      const printed = p.joined < addDays(today, -4) ? 1 : 0;
      const cards = [];
      const firstStatus = p.replacedAt ? p.replaceStatus : p.status;
      const c1 = insCard.run(cardNo(), memberId, p.tier.id, firstStatus, p.replacedAt ? (p.replaceReason || 'Reported lost by member') : (p.reason || null),
        p.joined, addYears(p.joined, years), p.home.id, creator.id, printed, printed ? `${addDays(p.joined, 1)} 11:20:00` : null);
      cards.push({ id: Number(c1.lastInsertRowid), from: '0000', to: p.replacedAt || '9999' });
      if (p.replacedAt) {
        const c2 = insCard.run(cardNo(), memberId, p.tier.id, 'active', null, p.replacedAt, addYears(p.replacedAt, years), p.home.id, admin.id, 1, `${p.replacedAt} 16:05:00`);
        cards.push({ id: Number(c2.lastInsertRowid), from: p.replacedAt, to: '9999' });
      }

      // Visits
      const stopAt = p.statusAt || '9999';
      for (let d = days - 1; d >= 0; d--) {
        const day = addDays(today, -d);
        if (day <= p.joined || day >= stopAt) continue;
        const dow = new Date(day + 'T00:00:00Z').getUTCDay();
        const ramp = 0.75 + 0.35 * (1 - d / days); // gentle program growth
        if (rand() > p.freq * DOW_W[dow] * ramp) continue;
        let hourW = Object.entries(HOUR_W).map(([h, w]) => [Number(h), dow === 5 && Number(h) >= 11 && Number(h) <= 13 ? w * 0.3 : w]);
        if (d === 0) hourW = hourW.filter(([h]) => h < nowHour);
        if (!hourW.length) continue;
        const hr = weighted(hourW);
        const at = `${day} ${pad(hr)}:${pad(Math.floor(rand() * 60))}:${pad(Math.floor(rand() * 60))}`;
        const branch = rand() < p.loyalty ? p.home : weighted(branches.map((b) => [b, b.brand === p.home.brand ? 3 : 1]));
        let bill = Math.exp(Math.log(p.spend) + gauss() * 0.55) * (dow === 5 ? 1.18 : 1);
        bill = Math.min(1850, Math.max(14, bill));
        bill = round2(Math.round(bill * 4) / 4);
        const card = cards.find((c) => day >= c.from && day < c.to) || cards[cards.length - 1];
        txns.push({ at, memberId, cardId: card.id, branch, tier: p.tier, bill });
      }
    }

    txns.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const seqs = new Map();
    const invoiceSeq = new Map();
    for (const t of txns) {
      const day = t.at.slice(0, 10);
      const key = t.branch.id + '|' + day;
      const seq = (seqs.get(key) || 0) + 1;
      seqs.set(key, seq);
      const inv = (invoiceSeq.get(t.branch.id) || 480000 + t.branch.id * 11000) + 1 + Math.floor(rand() * 40);
      invoiceSeq.set(t.branch.id, inv);
      const discount = round2((t.bill * t.tier.discount_pct) / 100);
      const isVoid = rand() < 0.012;
      const cashier = rand() < 0.85 ? cashierOf.get(t.branch.id) : manager;
      const voidAt = isVoid ? t.at.slice(0, 11) + pad(Math.min(23, Number(t.at.slice(11, 13)) + 0)) + ':' + pad(Math.min(59, Number(t.at.slice(14, 16)) + 4)) + ':10' : null;
      const r = insTxn.run(`RL${day.slice(2).replace(/-/g, '')}-${t.branch.code.slice(-2)}-${pad(seq, 4)}`, t.cardId, t.memberId, t.branch.id,
        cashier.id, t.tier.id, t.tier.discount_pct, t.bill, discount, round2(t.bill - discount), `INV-${t.branch.code.slice(-2)}-${inv}`,
        isVoid ? 'void' : 'completed', isVoid ? pick(VOID_REASONS) : null, isVoid ? manager.id : null, voidAt, t.at);
      if (isVoid) insAudit.run(voidAt, manager.id, t.branch.id, 'txn.void', 'transaction', Number(r.lastInsertRowid), JSON.stringify({ bill: t.bill }), '10.0.0.21');
    }
    run(`UPDATE cards SET last_used_at = (SELECT MAX(created_at) FROM transactions t WHERE t.card_id = cards.id AND t.status = 'completed')`);
  });
  return { members: memberCount, transactions: one('SELECT COUNT(*) AS n FROM transactions').n };
}

// Demo mode only: slide every demo date forward so "today" always has data,
// however many days pass between setting up the demo and showing it.
function refreshDemoDates() {
  const tz = getSettings().timezone;
  const now = nowLocal(tz);
  const today = now.slice(0, 10);
  const last = one("SELECT MAX(substr(created_at,1,10)) AS d FROM transactions").d;
  if (!last || last >= today) return 0;
  const gap = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(last + 'T00:00:00Z')) / 86400000);
  const shift = `+${gap} days`;
  tx(() => {
    run(`UPDATE transactions SET created_at = datetime(created_at, ?), voided_at = CASE WHEN voided_at IS NULL THEN NULL ELSE datetime(voided_at, ?) END`, shift, shift);
    // Two passes so the UNIQUE txn_no never collides mid-update.
    run(`UPDATE transactions SET txn_no = 'X' || substr(strftime('%Y%m%d', created_at), 3) || substr(txn_no, 9)`);
    run(`UPDATE transactions SET txn_no = 'RL' || substr(txn_no, 2)`);
    run('UPDATE members SET created_at = datetime(created_at, ?), updated_at = datetime(updated_at, ?)', shift, shift);
    run(`UPDATE cards SET issued_at = date(issued_at, ?), expires_at = date(expires_at, ?),
      last_used_at = CASE WHEN last_used_at IS NULL THEN NULL ELSE datetime(last_used_at, ?) END,
      last_printed_at = CASE WHEN last_printed_at IS NULL THEN NULL ELSE datetime(last_printed_at, ?) END`, shift, shift, shift, shift);
    run('UPDATE audit_log SET at = datetime(at, ?)', shift);
    // Nothing may sit in the future (e.g. demo opened earlier in the day than it was generated).
    run('DELETE FROM transactions WHERE created_at > ?', now);
    run(`UPDATE cards SET last_used_at = (SELECT MAX(created_at) FROM transactions t WHERE t.card_id = cards.id AND t.status = 'completed')`);
  });
  return gap;
}

function wipeDemoData() {
  tx(() => {
    run('DELETE FROM transactions');
    run('DELETE FROM cards');
    run('DELETE FROM members');
    run('DELETE FROM audit_log');
  });
}

module.exports = { ensureBase, seedDemo, wipeDemoData, refreshDemoDates, BRANCHES, TIERS, DEMO_USERS };

// ---------- CLI ----------
if (require.main === module) {
  const args = process.argv.slice(2);
  ensureBase();
  if (args.includes('--reset')) {
    tx(() => {
      wipeDemoData();
      run('DELETE FROM sessions');
      run('DELETE FROM api_keys');
      run('DELETE FROM users');
      run('DELETE FROM tiers');
      run('DELETE FROM branches');
      run('DELETE FROM settings');
    });
    setSettings({});
    ensureBase();
    const r = seedDemo();
    console.log(`Database reset. Demo data: ${r.members} members, ${r.transactions} transactions.`);
  } else if (args.includes('--demo')) {
    wipeDemoData();
    setSettings({ demo_mode: true });
    const r = seedDemo();
    console.log(`Demo data regenerated: ${r.members} members, ${r.transactions} transactions.`);
  } else {
    console.log('Usage: node server/seed.js --demo | --reset');
  }
}
