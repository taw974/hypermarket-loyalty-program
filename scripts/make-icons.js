// Generates the PWA PNG icons from the SVG crest (dev-only; needs `sharp`).
const path = require('node:path');
const sharp = require('sharp');

const out = (f) => path.join(__dirname, '..', 'public', 'img', f);
const crest = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx=".3" cy=".2" r="1"><stop offset="0" stop-color="#2a2215"/><stop offset=".6" stop-color="#0e0c08"/><stop offset="1" stop-color="#050403"/></radialGradient>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7d5e1a"/><stop offset=".35" stop-color="#e9c860"/><stop offset=".55" stop-color="#fff2bf"/><stop offset=".75" stop-color="#d4af37"/><stop offset="1" stop-color="#8a6a1f"/></linearGradient>
  </defs>
  <rect width="512" height="512" rx="${pad ? 0 : 110}" fill="url(#bg)"/>
  ${pad ? '' : '<rect x="14" y="14" width="484" height="484" rx="98" fill="none" stroke="url(#g)" stroke-opacity=".55" stroke-width="6"/>'}
  <g transform="translate(${pad ? 136 : 96} ${pad ? 150 : 118}) scale(${pad ? 2.4 : 3.2})" fill="url(#g)">
    <path d="M11 62 5 25l12.5 17L27.5 17l11 23L50 7l11.5 33 11-23 10 25L95 25l-6 37Z"/>
    <rect x="11" y="66" width="78" height="11" rx="3"/>
    <circle cx="5" cy="22" r="5"/><circle cx="27.5" cy="14" r="4.5"/><circle cx="50" cy="5" r="5.5"/><circle cx="72.5" cy="14" r="4.5"/><circle cx="95" cy="22" r="5"/>
  </g>
</svg>`;

(async () => {
  await sharp(Buffer.from(crest(false))).resize(192, 192).png().toFile(out('icon-192.png'));
  await sharp(Buffer.from(crest(false))).resize(512, 512).png().toFile(out('icon-512.png'));
  await sharp(Buffer.from(crest(true))).resize(512, 512).png().toFile(out('icon-512-maskable.png'));
  await sharp(Buffer.from(crest(false))).resize(180, 180).png().toFile(out('apple-touch-icon.png'));
  console.log('Icons written to public/img');
})();
