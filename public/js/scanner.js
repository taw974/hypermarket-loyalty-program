// Barcode/QR input: USB "keyboard-wedge" scanners anywhere on the page,
// and phone/tablet camera scanning (html5-qrcode, loaded on demand).
import { html, ic, modal } from './core.js';

// Scanners type very fast and finish with Enter. Detect that burst even when the
// cursor sits in another field (e.g. the bill amount) and route it to onScan.
export function listenForScanner(onScan, { minLength = 8, maxAvgGap = 40 } = {}) {
  let buf = '';
  let first = 0;
  let last = 0;
  let snapshot = null;
  const onKey = (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const now = performance.now();
    const active = document.activeElement;
    if (active && active.closest && active.closest('[data-scan-input], .modal-root')) { buf = ''; return; }
    if (e.key === 'Enter') {
      const avg = (last - first) / Math.max(1, buf.length - 1);
      if (buf.length >= minLength && avg <= maxAvgGap && now - last < 120) {
        e.preventDefault();
        e.stopPropagation();
        if (snapshot && snapshot.el && 'value' in snapshot.el) {
          snapshot.el.value = snapshot.value;
          snapshot.el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const code = buf;
        buf = '';
        onScan(code);
        return;
      }
      buf = '';
      return;
    }
    if (e.key.length !== 1) return;
    if (now - last > 90) {
      buf = '';
      first = now;
      snapshot = { el: active, value: active && 'value' in active ? active.value : null };
    }
    buf += e.key;
    last = now;
  };
  document.addEventListener('keydown', onKey, true);
  return () => document.removeEventListener('keydown', onKey, true);
}

let libPromise = null;
function loadLib() {
  if (window.__Html5QrcodeLibrary__) return Promise.resolve(window.__Html5QrcodeLibrary__);
  libPromise = libPromise || new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/html5-qrcode.min.js';
    s.onload = () => resolve(window.__Html5QrcodeLibrary__);
    s.onerror = () => { libPromise = null; reject(new Error('Camera scanner could not be loaded')); };
    document.head.appendChild(s);
  });
  return libPromise;
}

export function cameraScan() {
  return new Promise((resolve) => {
    let scanner = null;
    let done = false;
    const m = modal({
      title: 'Scan with camera',
      sub: 'Point the camera at the QR code or barcode on the Royal card',
      body: html`<div class="cam-wrap"><div id="rl-cam" class="cam-view"></div><div class="cam-frame"><i></i><i></i><i></i><i></i><span class="cam-laser"></span></div></div>
        <p class="cam-status muted" data-status>${ic('camera', 'i-sm')} Starting camera…</p>`,
      foot: html`<button class="btn btn-ghost" data-close>Cancel</button>`,
      onClose: () => {
        if (scanner) scanner.stop().catch(() => {}).finally(() => { try { scanner.clear(); } catch { /* ignore */ } });
        if (!done) resolve(null);
      },
    });
    const status = m.$('[data-status]');
    if (!window.isSecureContext) {
      status.innerHTML = String(html`${ic('alert', 'i-sm')} Camera needs a secure connection (https:// or localhost). Use a USB/Bluetooth scanner, or open the system over HTTPS.`);
      return;
    }
    loadLib().then(async (lib) => {
      const F = lib.Html5QrcodeSupportedFormats;
      scanner = new lib.Html5Qrcode('rl-cam', { formatsToSupport: [F.QR_CODE, F.CODE_128], verbose: false });
      await scanner.start({ facingMode: 'environment' }, {
        fps: 12,
        qrbox: (w, h) => ({ width: Math.floor(Math.min(w * 0.82, 340)), height: Math.floor(Math.min(h * 0.62, 230)) }),
      }, (text) => {
        if (done) return;
        done = true;
        resolve(text);
        m.close();
      }, () => {});
      status.innerHTML = String(html`${ic('scan', 'i-sm')} Hold steady — reading automatically`);
    }).catch((err) => {
      status.innerHTML = String(html`${ic('alert', 'i-sm')} ${err && err.message ? err.message : 'No camera available'}`);
    });
  });
}
