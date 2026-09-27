import { api, html, raw, ic, $, on, withBusy } from '../core.js';
import { crownMark } from '../icons.js';
import { card3dHtml, bindCard3d, cardData, withLuhn } from '../card.js';

const DEMO_PW = { admin: 'Admin@123', manager: 'Manager@123' };
const demoPassword = (u) => DEMO_PW[u] || 'Cashier@123';

function goldDust(canvas) {
  const ctx = canvas.getContext('2d');
  let w = 0; let h = 0; let raf = 0;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const resize = () => {
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  const ps = Array.from({ length: 90 }, () => ({
    x: Math.random() * w, y: Math.random() * h, r: 0.4 + Math.random() * 1.8,
    vy: -0.08 - Math.random() * 0.35, vx: (Math.random() - 0.5) * 0.15, tw: Math.random() * Math.PI * 2,
  }));
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const frame = () => {
    ctx.clearRect(0, 0, w, h);
    for (const p of ps) {
      if (!still) { p.x += p.vx; p.y += p.vy; p.tw += 0.03; }
      if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
      const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(p.tw));
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
      g.addColorStop(0, `rgba(255,236,170,${a})`);
      g.addColorStop(1, 'rgba(212,175,55,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2); ctx.fill();
    }
    raf = requestAnimationFrame(frame);
  };
  frame();
  addEventListener('resize', resize);
  return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize); };
}

export default {
  render(root, { message = '', info = {}, onLogin }) {
    document.title = 'Sign in · Royal Loyalty';
    const demo = info.demo_accounts || [];
    const program = info.program || {};
    const sample = cardData({
      member: { full_name: 'Your Name Here', member_code: 'RM-10000' },
      card: { card_number: withLuhn('974021552026000'), issued_at: '2026-09-01', expires_at: '2028-09-01' },
      tier: { theme: 'gold', name: 'Royal Gold', discount_pct: 15 },
    });
    root.innerHTML = String(html`
    <div class="login">
      <canvas class="login-dust"></canvas>
      <div class="login-glow"></div>
      <section class="login-hero">
        <div class="login-kicker">${ic('crown', 'i-sm')} Welcome Friends · Al Madina Hypermarkets</div>
        <h1 class="login-title"><span class="foil-text">ROYAL</span> LOYALTY</h1>
        <div class="login-arabic arabic">برنامج الولاء الملكي</div>
        <p class="login-lead">One royal card. Five hypermarkets. <b class="gold">Instant 15% savings</b> on every bill — scanned in a second at any counter.</p>
        <div class="login-card">${raw(card3dHtml(sample, { floating: true, flippable: false }))}</div>
        <div class="login-feats">
          <div>${ic('scan')}<span><b>Scan &amp; save</b><small>QR + barcode at every till</small></span></div>
          <div>${ic('store')}<span><b>5 branches</b><small>One card works everywhere</small></span></div>
          <div>${ic('activity')}<span><b>Live insights</b><small>Every discount, in real time</small></span></div>
        </div>
      </section>
      <section class="login-panel-wrap">
        <form class="login-panel" id="login-form" autocomplete="on">
          <div class="login-crest">${raw(crownMark('url(#lgFoil)', { id: 'lgFoil', size: 58 }))}</div>
          <h2 class="display">Welcome back</h2>
          <p class="muted">Sign in to the ${program.name || 'Royal Loyalty'} console</p>
          ${message ? html`<div class="login-msg">${ic('info', 'i-sm')}${message}</div>` : ''}
          <div class="field"><label for="lg-user">Username</label>
            <div class="input-group">${ic('user')}<input class="input" id="lg-user" name="username" autocomplete="username" required autofocus></div></div>
          <div class="field"><label for="lg-pass">Password</label>
            <div class="input-group">${ic('lock')}<input class="input" id="lg-pass" name="password" type="password" autocomplete="current-password" required>
              <button type="button" class="btn btn-ghost btn-icon btn-sm addon" id="lg-eye" aria-label="Show password">${ic('eye')}</button></div></div>
          <div class="form-error hidden" id="lg-err"></div>
          <button class="btn btn-primary btn-lg btn-block" type="submit" data-busy="Signing in…">${ic('crown')}Sign in</button>
          ${demo.length ? html`<div class="demo-box"><div class="demo-title">${ic('sparkles', 'i-sm')} Demo accounts — tap to fill</div>
            <div class="demo-chips">${demo.map((u) => html`<button type="button" class="chip chip-gold" data-demo="${u}">${u}</button>`)}</div></div>` : ''}
          <div class="login-foot">Secured session · Qatar time (AST)</div>
        </form>
      </section>
    </div>`);

    const stopDust = goldDust($('.login-dust', root));
    const unbind = bindCard3d(root);
    const form = $('#login-form', root);
    $('#lg-eye', root).addEventListener('click', () => {
      const p = $('#lg-pass', root);
      p.type = p.type === 'password' ? 'text' : 'password';
    });
    on(root, 'click', '[data-demo]', (e, b) => {
      $('#lg-user', root).value = b.dataset.demo;
      $('#lg-pass', root).value = demoPassword(b.dataset.demo);
      form.requestSubmit();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#lg-err', root);
      err.classList.add('hidden');
      const body = Object.fromEntries(new FormData(form));
      try {
        await withBusy(form.querySelector('button[type=submit]'), () => api('/auth/login', { method: 'POST', body }));
        stopDust();
        unbind();
        await onLogin();
      } catch (ex) {
        err.textContent = ex.message;
        err.classList.remove('hidden');
        form.classList.remove('shake');
        void form.offsetWidth;
        form.classList.add('shake');
      }
    });
  },
};
