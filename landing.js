/* Cathay Student — cinematic landing page.
 * One scroll-driven camera move drawn on a canvas, no images needed:
 * jet at the gate on a bright day → into the cabin window → out above the clouds → flying into the light.
 * Add ?p=0.5 to the URL to freeze the story at that point (handy for screenshots and slides). */
(() => {
  'use strict';
  const canvas = document.getElementById('sky'), ctx = canvas.getContext('2d');
  const hero = document.querySelector('.hero');
  const scenes = [...document.querySelectorAll('.scene')];
  const counter = document.getElementById('counter'), counterLab = document.getElementById('counterLab');
  const railFill = document.getElementById('railFill'), hint = document.getElementById('hint');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t * t * (3 - 2 * t);
  const band = (p, a, b) => ease(clamp((p - a) / (b - a))); // 0 → 1 between a and b
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (c1, c2, t) => { const a = hex(c1), b = hex(c2); return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], t))).join(',')})`; };
  const fmt = (n) => Math.round(n).toLocaleString('en-US');

  /* Sky along the journey: [progress, top, middle, horizon]. */
  const SKY = [
    [0.0, '#5fa9d6', '#a9d6ea', '#eef8f6'],
    [0.35, '#4f9fd2', '#9fd1e8', '#ecf7f5'],
    [0.6, '#3f93cc', '#93cbe6', '#f0f9f7'],
    [1.0, '#4a9ad0', '#c4e4f0', '#ffffff'],
  ];
  function skyAt(p) {
    let i = 0;
    while (i < SKY.length - 2 && p > SKY[i + 1][0]) i++;
    const [p0, ...a] = SKY[i], [p1, ...b] = SKY[i + 1], t = ease(clamp((p - p0) / (p1 - p0)));
    return a.map((c, k) => mix(c, b[k], t));
  }

  /* ---------- scene pieces ---------- */
  let W = 0, H = 0, stars = [], clouds = [];
  const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  function cloudSprite(r) {
    const c = document.createElement('canvas'), w = 360, h = 160;
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    for (let i = 0; i < 46; i++) { // many soft, flat puffs read as cloud, not bubbles
      const x = 30 + r() * (w - 60), y = 92 + (r() - 0.5) * 34 * (1 - Math.abs(x / w - 0.5)), rad = 14 + r() * 30;
      const grd = g.createRadialGradient(x, y - rad * 0.3, 0, x, y, rad);
      grd.addColorStop(0, 'rgba(255,255,255,0.7)');
      grd.addColorStop(0.5, 'rgba(246,251,252,0.38)');
      grd.addColorStop(1, 'rgba(205,225,235,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    }
    return c;
  }

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = rng(7);
    stars = Array.from({ length: 110 }, () => [r() * W, r() * H * 0.5, r() * 1.3 + 0.3]);
    clouds = Array.from({ length: 60 }, () => ({ x: r() * 1.5 - 0.25, d: r(), sprite: cloudSprite(r) })).sort((a, b) => a.d - b.d);
  }

  function poly(pts, u) {
    ctx.beginPath();
    pts.forEach(([a, b], i) => (i ? ctx.lineTo(a * u, b * u) : ctx.moveTo(a * u, b * u)));
    ctx.closePath(); ctx.fill();
  }
  function glow(x, y, r, rgb, a = 1) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g; ctx.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
  }

  function drawSun(x, y, size, strength) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, size);
    g.addColorStop(0, `rgba(255,255,255,${Math.min(1, 0.95 * strength)})`);
    g.addColorStop(0.07, `rgba(255,253,240,${Math.min(1, 0.75 * strength)})`);
    g.addColorStop(0.32, `rgba(240,250,250,${Math.min(1, 0.3 * strength)})`);
    g.addColorStop(1, 'rgba(240,250,250,0)');
    ctx.fillStyle = g; ctx.fillRect(x - size, y - size, size * 2, size * 2);
  }

  /* Side view of a jet, centred on the fuselage, nose to the right. L = length in px. */
  function drawJet(x, y, L, o = {}) {
    const u = L;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(o.tilt || 0);
    ctx.globalAlpha *= o.alpha ?? 1;
    ctx.fillStyle = '#a9b6b7';
    poly([[0.06, 0.03], [-0.15, 0.12], [-0.23, 0.12], [-0.06, 0.03]], u); // far wing
    const g = ctx.createLinearGradient(0, -0.06 * u, 0, 0.06 * u);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#eef2f2'); g.addColorStop(1, '#a7b3b4');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0.5 * u, 0.012 * u);
    ctx.bezierCurveTo(0.49 * u, -0.035 * u, 0.44 * u, -0.056 * u, 0.36 * u, -0.056 * u);
    ctx.lineTo(-0.3 * u, -0.05 * u);
    ctx.bezierCurveTo(-0.42 * u, -0.048 * u, -0.48 * u, -0.03 * u, -0.53 * u, -0.022 * u);
    ctx.lineTo(-0.53 * u, 0);
    ctx.bezierCurveTo(-0.46 * u, 0.03 * u, -0.38 * u, 0.05 * u, -0.28 * u, 0.056 * u);
    ctx.lineTo(0.36 * u, 0.056 * u);
    ctx.bezierCurveTo(0.45 * u, 0.055 * u, 0.5 * u, 0.04 * u, 0.5 * u, 0.012 * u);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,101,100,.25)'; ctx.lineWidth = Math.max(1, 0.003 * u); ctx.stroke();
    ctx.fillStyle = '#006564'; ctx.fillRect(-0.3 * u, 0.018 * u, 0.66 * u, 0.008 * u); // green cheatline
    ctx.fillStyle = '#006564';
    poly([[-0.3, -0.048], [-0.43, -0.25], [-0.5, -0.25], [-0.49, -0.03]], u); // tail fin
    ctx.fillStyle = '#00504f';
    poly([[-0.42, -0.25], [-0.57, -0.27], [-0.58, -0.25], [-0.5, -0.236]], u); // T-tail
    ctx.fillStyle = '#e4eaea';
    ctx.beginPath(); ctx.ellipse(-0.3 * u, -0.072 * u, 0.085 * u, 0.03 * u, 0, 0, Math.PI * 2); ctx.fill(); // engine
    ctx.fillStyle = '#26232c';
    ctx.beginPath(); ctx.ellipse(-0.218 * u, -0.072 * u, 0.012 * u, 0.026 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d5dddd';
    poly([[0.1, 0.035], [-0.19, 0.19], [-0.26, 0.19], [-0.04, 0.035]], u); // near wing
    ctx.fillStyle = '#18202f';
    poly([[0.43, -0.031], [0.475, -0.012], [0.41, -0.012], [0.39, -0.031]], u); // cockpit
    ctx.save();
    ctx.fillStyle = '#2c4d50'; // daytime: dark cabin windows
    for (let i = 0; i < 9; i++) {
      ctx.beginPath(); ctx.roundRect((0.27 - i * 0.055) * u - 0.009 * u, -0.03 * u, 0.018 * u, 0.024 * u, 0.008 * u); ctx.fill();
    }
    if (o.door) {
      ctx.beginPath(); ctx.roundRect(0.315 * u, -0.038 * u, 0.034 * u, 0.074 * u, 0.006 * u); ctx.fill();
    }
    ctx.restore();
    if (o.door) { // airstair down to the ground
      const gy = o.ground;
      ctx.fillStyle = '#e9eeee';
      poly([[0.315, 0.036], [0.349, 0.036], [0.44, gy], [0.395, gy]], u);
      ctx.strokeStyle = 'rgba(0,101,100,.7)'; ctx.lineWidth = Math.max(1, 0.002 * u);
      for (let k = 1; k < 7; k++) {
        const t = k / 7;
        ctx.beginPath(); ctx.moveTo(lerp(0.315, 0.395, t) * u, lerp(0.036, gy, t) * u); ctx.lineTo(lerp(0.349, 0.44, t) * u, lerp(0.036, gy, t) * u); ctx.stroke();
      }
    }
    if (o.gear) {
      ctx.fillStyle = '#2a3436'; ctx.strokeStyle = '#7d8a8c'; ctx.lineWidth = Math.max(1, 0.006 * u);
      for (const gx of [0.3, -0.12]) {
        ctx.beginPath(); ctx.moveTo(gx * u, 0.05 * u); ctx.lineTo(gx * u, (o.ground - 0.018) * u); ctx.stroke();
        ctx.beginPath(); ctx.arc(gx * u, (o.ground - 0.018) * u, 0.018 * u, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawGround(hy, a, push) {
    ctx.save(); ctx.globalAlpha = a;
    const g = ctx.createLinearGradient(0, hy, 0, H);
    g.addColorStop(0, '#dfe7e6'); g.addColorStop(0.15, '#c5d0cf'); g.addColorStop(1, '#97a6a5');
    ctx.fillStyle = g; ctx.fillRect(-W, hy, W * 3, H * 2);
    const sx = W * 0.7, r = ctx.createLinearGradient(0, hy, 0, H); // shine on the tarmac
    r.addColorStop(0, 'rgba(255,255,255,.7)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = r;
    ctx.beginPath(); ctx.moveTo(sx - 30, hy); ctx.lineTo(sx + 30, hy); ctx.lineTo(sx + 260, H * 1.3); ctx.lineTo(sx - 260, H * 1.3); ctx.fill();
    const vx = W * 0.42; // taxiway lights converging to the horizon
    for (const side of [-1, 1]) {
      for (let k = 1; k < 15; k++) {
        const t = k / 15, y = hy + t * t * (H - hy) * 1.2, x = vx + side * (14 + t * t * W * 0.75);
        glow(x, y, (0.8 + t * 3) / push, side < 0 ? '0,140,120' : '0,101,100', 0.55);
      }
    }
    ctx.restore();
  }

  function drawClouds(hy, a, t) {
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = a;
    const base = ctx.createLinearGradient(0, hy, 0, H);
    base.addColorStop(0, '#ffffff'); base.addColorStop(0.4, '#eef5f8'); base.addColorStop(1, '#cfe1ea');
    ctx.fillStyle = base; ctx.fillRect(0, hy, W, H - hy);
    const unit = Math.max(W, 900) / 1200;
    for (const c of clouds) {
      const d = c.d, y = hy + Math.pow(d, 1.6) * (H - hy) * 1.05;
      const s = (0.3 + d * 1.25) * unit, w = 360 * s * 1.3, h = 160 * s * 0.8;
      const x = (((c.x + t * 0.000012 * (0.4 + d)) % 1.5) + 1.5) % 1.5 - 0.25;
      ctx.drawImage(c.sprite, x * W - w / 2, y - h * 0.62, w, h);
    }
    ctx.restore();
  }

  /* Cabin wall with a window that grows until the camera passes through it. */
  function drawCabin(a, grow) {
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha = a;
    const ww = Math.min(W * 0.24, H * 0.36) * grow, wh = ww * 1.45, cx = W * lerp(0.34, 0.5, clamp((grow - 1) / 3)), cy = H * 0.5, rad = ww * 0.45;
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.roundRect(cx - ww / 2, cy - wh / 2, ww, wh, rad);
    const g = ctx.createRadialGradient(cx, cy, ww * 0.5, cx, cy, Math.max(W, H) * 0.75);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#eef2f1'); g.addColorStop(1, '#c9d3d1');
    ctx.fillStyle = g; ctx.fill('evenodd');
    ctx.lineWidth = Math.max(6, ww * 0.075); ctx.strokeStyle = 'rgba(200,212,210,.95)';
    ctx.beginPath(); ctx.roundRect(cx - ww / 2, cy - wh / 2, ww, wh, rad); ctx.stroke();
    ctx.lineWidth = Math.max(2, ww * 0.016); ctx.strokeStyle = 'rgba(0,101,100,.45)';
    ctx.beginPath(); ctx.roundRect(cx - ww * 0.62, cy - wh / 2 - ww * 0.12, ww * 1.24, wh + ww * 0.24, rad * 1.25); ctx.stroke();
    glow(cx - ww * 1.6, cy + wh * 0.9, ww * 0.35, '0,140,120', 0.18); // soft jade cabin light
    ctx.restore();
  }

  function draw(p, t) {
    const [top, mid, hor] = skyAt(p);
    const flying = band(p, 0.3, 0.46); // gate → above the clouds (hidden behind the cabin wall)
    const hy = H * lerp(0.64, 0.55, flying);
    const sky = ctx.createLinearGradient(0, 0, 0, hy);
    sky.addColorStop(0, top); sky.addColorStop(0.6, mid); sky.addColorStop(1, hor);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

    const sa = 0; // daylight: no stars
    if (sa > 0.01) {
      ctx.fillStyle = '#fff';
      for (const [x, y, r] of stars) { ctx.globalAlpha = sa * (0.55 + 0.45 * Math.sin(t * 0.0015 + x)); ctx.fillRect(x, y, r, r); }
      ctx.globalAlpha = 1;
    }
    const light = band(p, 0.7, 1);
    drawSun(W * lerp(0.72, 0.6, light), hy, Math.max(W, H) * lerp(0.42, 0.85, light), lerp(0.85, 1.2, light));

    if (flying < 1) { // at the gate, camera slowly pushing in
      const push = 1 + 0.5 * band(p, 0, 0.42), L = Math.min(W * 0.5, H * 0.95), jx = W * 0.66, gy = hy + L * 0.13, jy = gy - 0.13 * L;
      ctx.save();
      ctx.translate(W * 0.62, hy); ctx.scale(push, push); ctx.translate(-W * 0.62, -hy);
      ctx.globalAlpha = 1 - flying;
      drawGround(hy, 1 - flying, push);
      const cg = ctx.createLinearGradient(0, gy, 0, H); // green carpet
      cg.addColorStop(0, '#00807a'); cg.addColorStop(1, '#004d4a');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.moveTo(jx + 0.39 * L, gy); ctx.lineTo(jx + 0.45 * L, gy); ctx.lineTo(jx + 0.95 * L, H * 1.25); ctx.lineTo(jx + 0.55 * L, H * 1.25); ctx.fill();
      ctx.save(); // mirrored jet on the wet tarmac
      ctx.globalAlpha = 0.18 * (1 - flying); ctx.filter = 'blur(3px)';
      ctx.translate(0, 2 * gy); ctx.scale(1, -1);
      drawJet(jx, jy, L, { gear: true, ground: 0.13 });
      ctx.restore();
      drawJet(jx, jy, L, { door: true, gear: true, ground: 0.13 });
      ctx.restore();
    }

    drawClouds(hy, flying, reduce ? 0 : t);

    const fly = band(p, 0.6, 0.7); // the jet flying above the clouds, into the light
    if (fly > 0) {
      const k = band(p, 0.6, 1), far = band(p, 0.8, 1);
      const L = lerp(Math.min(W * 0.62, H * 1.15), W * 0.1, far);
      const x = lerp(-W * 0.25, W * 0.8, ease(k)), y = lerp(H * 0.42, H * 0.24, far) + Math.sin(t * 0.001) * H * 0.006 * (reduce ? 0 : 1);
      ctx.save(); ctx.globalAlpha = fly; drawJet(x, y, L, { tilt: -0.05 }); ctx.restore();
    }

    drawCabin(band(p, 0.27, 0.35) * (1 - band(p, 0.56, 0.63)), lerp(1, 9, band(p, 0.44, 0.63)));

    const flare = band(p, 0.88, 1);
    if (flare > 0) { ctx.globalAlpha = 0.35 * flare; drawSun(W * 0.6, hy, Math.max(W, H) * 1.2, 1); ctx.globalAlpha = 1; }
  }

  /* ---------- headlines, counter, progress ---------- */
  function hud(p) {
    for (const s of scenes) s.classList.toggle('on', p >= +s.dataset.from && p < +s.dataset.to);
    railFill.style.height = (p * 100).toFixed(1) + '%';
    hint.style.opacity = p > 0.03 ? 0 : 1;
    let lab, val;
    if (p < 0.22) { lab = 'Welcome points'; val = fmt(lerp(0, 1500, band(p, 0.02, 0.16))); }
    else if (p < 0.42) { lab = 'Students on nearby dates'; val = '3+ · 5+ · 10+'; }
    else if (p < 0.62) { lab = 'Students on your flight'; val = '8 · seated side by side'; }
    else if (p < 0.82) { lab = 'Student points'; val = fmt(lerp(0, 3330, band(p, 0.63, 0.76))); }
    else { lab = 'Altitude'; val = fmt(lerp(28000, 41000, band(p, 0.82, 1))) + ' ft'; }
    if (counterLab.textContent !== lab) counterLab.textContent = lab;
    if (counter.textContent !== val) counter.textContent = val;
  }

  /* ---------- loop ---------- */
  let target = 0, prog = 0;
  const span = () => Math.max(1, hero.offsetHeight - innerHeight);
  const frozen = parseFloat(new URLSearchParams(location.search).get('p'));
  const readScroll = () => { target = Number.isNaN(frozen) ? clamp((scrollY - hero.offsetTop) / span()) : clamp(frozen); };
  function frame(t) {
    prog = reduce ? target : prog + (target - prog) * 0.08;
    if (Math.abs(target - prog) < 0.0004) prog = target;
    if (scrollY < hero.offsetTop + hero.offsetHeight) { draw(prog, t); hud(prog); }
    requestAnimationFrame(frame);
  }

  resize();
  addEventListener('resize', () => { resize(); readScroll(); });
  addEventListener('scroll', readScroll, { passive: true });
  readScroll();
  prog = target;
  requestAnimationFrame(frame);
})();
