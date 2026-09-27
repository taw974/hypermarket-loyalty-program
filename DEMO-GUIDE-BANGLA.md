# ক্লায়েন্টকে ডেমো দেখানোর গাইড (৭–১০ মিনিট)

ক্লায়েন্টের চাওয়া ছিল: ৫টা দোকানের (৩টা Welcome Friends + ২টা Al Madina) জন্য একটা **Royal Loyalty Card**, যেটা scan করলে বিলের উপর **15% discount** দেখাবে — ৩০০ রিয়ালে ৩০০-র 15%, ২০০ রিয়ালে ২০০-র 15%। এই সিস্টেম ঠিক সেটাই করে, সাথে আরও অনেক কিছু।

> **মূল কথা ক্লায়েন্টকে বোঝানোর জন্য:** প্রতিটা মেম্বারের কার্ডের নম্বর আলাদা (যাতে কে কত discount নিল হিসাব থাকে, হারালে block করা যায়), কিন্তু **একই কার্ড ৫টা দোকানেই চলে** — Welcome-এও, Muaither-এও, Al Madina-তেও।

---

## ডেমোর আগে (৫ মিনিট প্রস্তুতি)
1. `START.bat` চালান — browser খুলবে। Laptop-এর brightness বাড়িয়ে রাখুন।
2. সম্ভব হলে একটা USB barcode scanner লাগিয়ে রাখুন (না থাকলে card নম্বর টাইপ করলেও চলবে)।
3. নিজের মোবাইলে একটা মেম্বারের digital card খুলে রাখুন (Members → যেকোনো মেম্বার → **Digital card**)। একই Wi-Fi-তে থাকলে server window-এ দেখানো `http://192.168…:8974` ঠিকানা ব্যবহার করুন।

---

## ধাপ ১ — Login screen (৩০ সেকেন্ড)
- সোনালি ঘুরন্ত কার্ড আর "ROYAL LOYALTY" দেখান। বলুন: *"এটা আপনাদের নিজস্ব Royal card system — আরবি আর ইংরেজি দুই ভাষায়।"*
- `cashier1` চিপে ক্লিক করুন (Muaither-এর ক্যাশিয়ার হিসেবে ঢুকবে)।

## ধাপ ২ — POS Terminal: আসল কাজ (২ মিনিট) ⭐
- মোবাইলের digital card-এর QR scanner-এ ধরুন (বা কার্ড নম্বর টাইপ করে Enter)।
- মেম্বারের কার্ড 3D-তে চলে আসবে — নাম, ভিজিট, মোট কত বাঁচিয়েছে।
- Bill-এ **300** লিখুন → দেখান: *Royal discount (15%) − QAR 45.00, Net payable QAR 255.00*।
- **Enter** চাপুন → সোনালি confetti আর *"QAR 45.00 saved"*। **F9** চাপলে receipt প্রিন্ট।
- বলুন: *"ক্যাশিয়ারকে কোনো হিসাব করতে হবে না — scan করুন, বিল লিখুন, শেষ।"*

**Security দেখান:** Blocked মেম্বার Bikash Adhikari-র কার্ড নম্বর `9740874979079047` POS-এ টাইপ করে Enter দিন (বা Members → **Blocked / lost** ফিল্টারে তাকে পাবেন) → লাল **BLOCKED** stamp, discount বন্ধ। বলুন: *"কার্ড হারালে বা কেউ অপব্যবহার করলে এক ক্লিকে বন্ধ।"*

**Customer screen (বাড়তি চমক):** POS-এর উপরের **Customer screen** বাটনে ক্লিক করলে নতুন window খুলবে — এটা কাউন্টারে customer-এর দিকে রাখা দ্বিতীয় monitor-এর জন্য। Discount দিলেই সেখানে বড় করে দেখাবে *"Thank you, Abdul — You saved QAR 22.50"*, সাথে আরবিতে ধন্যবাদ। বলুন: *"Customer নিজের চোখে দেখবে সে কত টাকা বাঁচাল — আবার আসবে।"*

## ধাপ ৩ — Owner Dashboard, live (২ মিনিট)
- Sign out করে `admin` দিয়ে ঢুকুন → Dashboard।
- দেখান: মোট Royal sales, কত discount দেওয়া হয়েছে, কোন branch এগিয়ে, কোন সময় সবচেয়ে ভিড় (heatmap), top মেম্বার, Smart insights।
- **Wow মোমেন্ট:** একটা tab-এ Dashboard, আরেকটা tab-এ POS খুলে discount দিন → Dashboard-এর **Live feed**-এ সাথে সাথে চলে আসবে। বলুন: *"আপনি বাসায় বসে ৫টা দোকানের সব discount live দেখতে পারবেন।"*

## ধাপ ৪ — মেম্বার ও কার্ড (২ মিনিট)
- **Members → New member**: নাম আর মোবাইল দিন → সাথে সাথে নতুন কার্ড তৈরি (নম্বর, QR, barcode সহ)।
- **Send on WhatsApp** — মেম্বার তার মোবাইলে digital card পেয়ে যাবে।
- **Card Studio**: তিন রকম ডিজাইন (Gold 15%, Platinum 20%, Black 25%) দেখান। বলুন: *"আপনারা চাইলে শুধু Gold 15% রাখবেন, বাকিগুলো VIP-দের জন্য পরে চালু করা যাবে।"* PVC card printer বা A4 কাগজে প্রিন্ট, অথবা print shop-এর জন্য CSV।

## ধাপ ৫ — রিপোর্ট ও নিয়ন্ত্রণ (১ মিনিট)
- **Reports**: branch/দিন/মাস/ক্যাশিয়ার অনুযায়ী — Excel-এ export বা A4 প্রিন্ট।
- **Settings → Program rules**: discount-এর সীমা, সর্বনিম্ন বিল, দিনে কতবার ব্যবহার — ডানদিকে live হিসাব দেখায়।
- **Activity Log**: কে কখন কী করেছে, সব রেকর্ড।

---

## ক্লায়েন্টের সম্ভাব্য প্রশ্ন ও উত্তর

| প্রশ্ন | উত্তর |
|---|---|
| 15% কি পরে বদলানো যাবে? | হ্যাঁ, Settings → Card tiers থেকে যেকোনো সময়। |
| অন্য কেউ কার্ড ব্যবহার করলে? | Scan করলে স্ক্রিনে মালিকের নাম দেখায়; সন্দেহ হলে block, আর দিনে কতবার ব্যবহার — সীমা দেওয়া যায়। |
| কার্ড হারালে? | মেম্বারের প্রোফাইল → Replace card → পুরনোটা সাথে সাথে বন্ধ, নতুন নম্বর; আগের সব হিসাব থাকে। |
| একই বিলে দুইবার discount? | হবে না — একই কার্ড ও টাকার পরিমাণ ৯০ সেকেন্ডের মধ্যে আবার এলে সতর্কতা দেয়, আর একই POS invoice-এ দ্বিতীয়বার discount দেয় না। |
| আমাদের POS software-এর সাথে যুক্ত হবে? | এখন POS-এর পাশে আলাদা screen হিসেবে চলে। POS কোম্পানি চাইলে আমাদের API দিয়ে সরাসরি যুক্ত করতে পারবে (Settings → POS integration)। |
| ৫টা দোকান কীভাবে একসাথে? | একটা central server (cloud বা অফিসের PC) — সব দোকান internet দিয়ে সেখানে যুক্ত থাকে, সব data এক জায়গায়। |
| Data হারাবে না তো? | প্রতিদিন নিজে থেকে backup হয়; যেকোনো সময় backup download করা যায়। |
| কী কী hardware লাগবে? | প্রতি কাউন্টারে একটা 2D barcode scanner (QR + barcode পড়ে, মোবাইলের স্ক্রিনও), চাইলে 80 mm receipt printer, আর কার্ড ছাপার জন্য PVC card printer বা print shop। |

---

## ক্লায়েন্ট রাজি হলে (Go live)
1. Settings → **Go live** → `GO LIVE` লিখে নতুন admin password দিন (demo data মুছে যাবে, একটা backup থেকে যাবে)।
2. Settings → Staff & access → প্রতিটা branch-এর আসল cashier/manager account বানান।
3. Server cloud-এ বা অফিসের PC-তে বসান (README.md → *Going live with five branches*)।
4. মেম্বার লিস্ট Excel থেকে import করুন বা কাউন্টারে নতুন মেম্বার বানান, তারপর কার্ড প্রিন্ট করুন।
