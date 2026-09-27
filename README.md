# 👑 Royal Loyalty — Welcome Friends & Al Madina Hypermarkets

**One Royal card · five hypermarkets · an instant 15% discount on every bill.**

Royal Loyalty is a complete loyalty-card system for the five branches of Welcome Friends Hypermarket and Al Madina Hypermarket in Qatar. Cashiers scan a member's card (QR code or barcode) at any counter, type the bill amount, and the system works out the 15% Royal discount, records it, prints a slip and shows it live on the owner's dashboard.

| Branch | Code | Location | Phone |
|---|---|---|---|
| Welcome Friends Hypermarket | BR-01 | Al Dome St, Muaither, Ar Rayyan | 3058 5327 |
| Welcome Friends Hypermarket – H1 | BR-02 | Argentine Neighborhood Camp-H1 | 3058 5353 |
| Welcome Friends Hypermarket – F5 | BR-03 | Argentine Neighborhood Camp-F5 | 7774 5061 |
| Al Madina Hypermarket – 01 | BR-04 | Service Hub-1, Birkat Al Awamer | 3058 5317 |
| Al Madina Hypermarket – 02 | BR-05 | Logistic Park A, Birkat Al Awamer | 3058 5310 |

---

## Quick start (Windows)

1. Install **Node.js 22 LTS or newer** from <https://nodejs.org> (one time).
2. Double-click **`START.bat`**. The first run installs one small package (needs internet), then the browser opens by itself.
3. Sign in with a demo account:

| Username | Password | Role | Sees |
|---|---|---|---|
| `admin` | `Admin@123` | Administrator | Everything, including Settings |
| `manager` | `Manager@123` | Manager | Dashboard, reports, members, cards (all branches) |
| `cashier1` … `cashier5` | `Cashier@123` | Cashier of BR-01 … BR-05 | POS terminal, members, branches |

The system opens in **demo mode** with 180 sample members and about five months of transactions, so every chart is alive. The demo dates move forward automatically each time the server starts, so "today" always has data. When the client approves, use **Settings → Go live** to remove the demo data (see [Going live](#going-live-checklist)).

Other computers on the same network can open the address shown in the server window, for example `http://192.168.0.146:8974`.

---

## How it works at the counter

```
 Member shows card ─► Cashier scans ─► System verifies ─► Cashier types bill ─► 15% worked out ─► Slip printed
 (plastic or phone)   (USB/camera)     active? blocked?     e.g. QAR 300          QAR 45 off         dashboard
                                        expired? limits?                          pay QAR 255        updates live
```

1. **Scan** — a USB/Bluetooth 2D scanner works anywhere on the POS screen (no need to click the box first). The camera button works on phones and tablets. Cashiers can also type the card number or the member's mobile.
2. **Verify** — the member's card appears in 3D with name, tier, visits and total savings. Blocked, suspended, lost or expired cards are stamped in red and the discount is locked.
3. **Bill** — type the amount (keyboard or on-screen keypad). The discount and net payable update as you type.
4. **Apply** — press Enter. A gold confirmation shows the amount saved and the amount to collect. Print the 80 mm slip with F9.
5. The cashier gives the same discount in the shop's POS software. (Or connect the POS directly with the [integration API](#pos-integration-api).)
6. Optional: **Customer screen** (button on the POS bar) opens a full-screen page for a second monitor facing the customer. It celebrates each discount with the amount saved and the amount to pay, in English and Arabic.

**Keyboard shortcuts:** `F2` POS / new scan · `F4` camera · `Enter` apply · `F9` print slip · `Esc` next customer · `Ctrl+K` search anything.

### Built-in protection
- **Unique card numbers** (16 digits, prefix `9740`, Luhn check digit) — mistyped or made-up numbers are rejected.
- **Duplicate guard** — the same card and amount twice within 90 seconds needs confirmation.
- **Invoice guard** — one POS invoice number can only receive one Royal discount.
- **Large-bill confirmation**, optional **maximum discount per bill**, **minimum bill** and **uses per card per day**.
- **Card status control** — suspend, block, replace (lost / stolen / damaged), renew, change tier.
- **Void with reason** and a full **activity log** of who did what, when.
- Cashiers are locked to their own branch; only managers and admins see money totals.

---

## The Royal Card

- **Front:** gold-foil crown, ROYAL LOYALTY CARD, Arabic *بطاقة الولاء الملكية*, chip, a "15% OFF" seal, card number, member name, member-since / valid-thru, both store names, and a guilloche security pattern (like a banknote).
- **Back:** QR code (error level Q) and Code-128 barcode — both verified to decode at 300 and 600 dpi — card number, the five branches with phone numbers, and terms.
- **Tiers:** Royal Gold 15% (default, as requested by the client). Royal Platinum 20% and Royal Black 25% are ready for VIP cards and can be disabled or edited in Settings → Card tiers.
- **Digital card:** every member gets a private link (sent on WhatsApp in one click) that shows their card, a large QR/barcode to scan from the phone, total savings, recent visits and the branches with call / map buttons.

### Printing cards
Card Studio → select cards →
- **Print on card printer** — exact CR80 size (85.6 × 54 mm), front and back pages, for PVC card printers such as Evolis Primacy 2 or Zebra ZC300.
- **Print A4 sheet** — 10 cards per page with cut lines; backs are mirrored for double-sided printing.
- **Print-shop data (CSV)** — names, numbers and dates for a professional card printer (variable-data printing).
- **PNG** — 600 dpi artwork of front and back.

---

## What's inside

| Page | Highlights |
|---|---|
| **POS Terminal** | Scan zone, 3D member card, live 15% calculator, keypad, duplicate/invoice guards, success screen, 80 mm slip, today's counter list, quick enrolment |
| **Customer screen** | Second monitor facing the customer: an idle "Save 15%" showcase, then "Thank you, Abdul — you saved QAR 22.50" the moment the discount is applied |
| **Dashboard** | Royal spend hero figure, KPI tiles with trends, daily trend, branch comparison, peak-hours heatmap, live feed, top members, smart insights |
| **Members** | Search by name / mobile / card / QID, filters (expiring, blocked, not printed, inactive 30 days), Excel/CSV import & export |
| **Member profile** | Card in 3D, WhatsApp card, digital-card link, tier / renew / suspend / block / replace, monthly spend, full history, reprint slips, void |
| **Card Studio** | Tier showcase, print queue, card-printer / A4 printing, CSV for print shops, PNG export |
| **Transactions** | Date range, branch, status and text filters, totals, detail view, reprint, void, CSV export |
| **Reports** | Group by branch / day / month / weekday / hour / cashier / tier / member, chart + table, CSV and printable A4 report |
| **Branches** | The five branches with today / month figures, 14-day trend, call and map links |
| **Settings** | Discount rules with a live example, tiers, staff accounts, POS API keys, backups and system status, Go live |
| **Activity Log** | Every sign-in, discount, void, card and settings change |

Also: dark "Royal Night" and light "Ivory" themes, works on desktop, tablet and phone, real-time updates across all screens, and a Qatar-time clock.

---

## Going live with five branches

All five branches must reach **one central server**, so the data is shared.

**Option A — Cloud server (recommended).** Rent a small Windows or Linux server (1 vCPU, 1 GB RAM is plenty), copy this folder, run `npm install --omit=dev` and `npm start`, and put it behind a domain with HTTPS (for example with Caddy, Nginx or Cloudflare). Every branch opens `https://royal.yourdomain.com`.

**Option B — Head-office PC + Cloudflare Tunnel.** Run the server on an always-on PC and publish it with a free Cloudflare Tunnel. No port forwarding, and you get HTTPS automatically.

**Option C — One site only.** If all counters are on the same local network, open `http://<server-ip>:8974` from each counter.

After deployment set **Settings → Program rules → Public address** to the HTTPS address, so WhatsApp messages and digital-card links point to it. Phone-camera scanning needs HTTPS (USB scanners work everywhere).

**Run it automatically on Windows start-up:** use [NSSM](https://nssm.cc) (`nssm install RoyalLoyalty "C:\Program Files\nodejs\node.exe" server\server.js`, set the start folder to this folder) or a Task Scheduler "At startup" task running `START.bat`.

### Recommended hardware (per counter)
- **2D barcode scanner (USB, keyboard mode)** — reads the QR and barcode on plastic cards and on phone screens, e.g. Honeywell Voyager 1470g or Zebra DS2208.
- **80 mm thermal receipt printer** for the discount slip (any Windows-installed model).
- Any PC, tablet or touch-screen with Chrome or Edge. The on-screen keypad supports touch screens.

### Going live checklist
1. Show the demo to the client; agree on the rules (15%, any caps or limits).
2. Settings → **Go live**: type `GO LIVE`, set a new admin password, remove the demo staff accounts. A backup of the demo is kept automatically.
3. Settings → **Staff & access**: create real accounts for managers and cashiers of each branch.
4. Members → **Import** the client's member list (Excel → CSV), or enrol members at the counter.
5. Card Studio → print the cards (or send the CSV + artwork to a card printer).
6. Send every member their digital card on WhatsApp from their profile.

---

## POS integration API

For POS software that can call a web service. Create a key in **Settings → POS integration** (one key per branch / POS system) and send it in the `X-API-Key` header.

```http
GET /api/v1/cards/9740XXXXXXXXXXXX
→ { "valid": true, "member_name": "…", "tier": "Royal Gold", "discount_pct": 15, "messages": [] }

POST /api/v1/redemptions
{ "card_number": "9740XXXXXXXXXXXX", "bill_amount": 300.00, "invoice_no": "INV-01-482311" }
→ { "txn_no": "RL260926-01-0042", "discount_amount": 45.00, "net_amount": 255.00 }
```

The same protections (blocked cards, duplicate and invoice guards, rules) apply, and each API transaction appears live on the dashboard.

---

## Backup & restore

- Automatic backup one minute after start and then every 24 hours to `data/backups` (the last 20 are kept).
- **Settings → Backup & system → Download backup now** for an off-site copy (USB drive or cloud).
- To restore: stop the server, replace `data/royal-loyalty.db` with the backup file, start again.

---

## For developers

```bash
npm install          # dependencies (express) + dev tools
npm run dev          # start with auto-reload
npm test             # 12 end-to-end API tests on a throw-away database
npm run seed:demo    # regenerate the demo members and transactions
npm run reset        # factory reset: fresh database with demo data
```

- **Stack:** Node.js (built-in `node:sqlite`, no native builds), Express 5, vanilla JavaScript ES modules, hand-built SVG charts and card renderer. No CDN — fonts and libraries are served locally (`public/vendor`, refreshed with `npm run vendor`).
- **Server:** `server/` — `db.js` schema, `logic.js` business rules (lookup, eligibility, discount, analytics), `routes/` REST API, `seed.js` branches, tiers and demo data.
- **Frontend:** `public/` — `index.html` staff app, `m.html` member digital card, `js/card.js` card artwork, `js/charts.js` charts, `js/pages/*` screens.
- **Data:** everything lives in `data/royal-loyalty.db` (SQLite). Change the folder with the `RL_DATA_DIR` environment variable and the port with `PORT`.
- **Security:** scrypt password hashing, HTTP-only session cookies, CSRF header check, role and branch scoping on every endpoint, rate-limited login and public card links, strict Content-Security-Policy, and an audit log.

---

## বাংলায় সংক্ষেপে

- **চালু করা:** Node.js 22+ install করুন → `START.bat` এ double-click → browser নিজে খুলবে → `admin` / `Admin@123` দিয়ে login।
- **কাউন্টারে:** কার্ড scan (USB scanner / camera / নম্বর টাইপ) → মেম্বারের কার্ড দেখাবে → bill লিখুন → 15% discount আর net payable নিজে হিসাব হবে → Enter চাপলে রেকর্ড হবে, F9 দিয়ে slip প্রিন্ট।
- **মালিক:** Dashboard-এ ৫টা branch-এর সব discount live দেখা যায়; Reports থেকে Excel (CSV) বা প্রিন্ট।
- **কার্ড:** Card Studio থেকে PVC card printer বা A4 কাগজে প্রিন্ট, বা print shop-এর জন্য CSV। প্রতিটা মেম্বারকে WhatsApp-এ digital card link পাঠানো যায়।
- **Live করা:** ক্লায়েন্ট রাজি হলে Settings → Go live — demo data মুছে যাবে, আসল data শুরু হবে।
- ক্লায়েন্টকে দেখানোর ধাপগুলো `DEMO-GUIDE-BANGLA.md` ফাইলে দেওয়া আছে।
