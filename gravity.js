// Gravity's Rainbow – 2D N-body sandbox.
// Units: distance = AU, time = years, mass = solar masses  =>  G = 4π².
(() => {
  'use strict';

  const G = 4 * Math.PI * Math.PI;
  const SUN_MASS = 1;
  const EARTH_MASS = 3.003e-6;
  const MIN_MASS = 1.66e-7;   // ~Mercury
  const MAX_MASS = 9.55e-4;   // ~Jupiter
  const VIEW_AU = 40;         // screen edge ≈ just beyond Neptune (30 AU)
  const ESCAPE_AU = 200;      // planets beyond this are discarded
  const SOFTENING2 = 1e-6;
  // Masses in Earth masses; semimajor axes in AU.
  const SOLAR_SYSTEM = [
    { mass: 0.0553, axis: 0.3871, eccentricity: 0.2056 },
    { mass: 0.815, axis: 0.7233, eccentricity: 0.0068 },
    { mass: 1, axis: 1.0000, eccentricity: 0.0167 },
    { mass: 0.1074, axis: 1.5237, eccentricity: 0.0934 },
    { mass: 317.83, axis: 5.2028, eccentricity: 0.0489 },
    { mass: 95.16, axis: 9.5388, eccentricity: 0.0565 },
    { mass: 14.54, axis: 19.1914, eccentricity: 0.0472 },
    { mass: 17.15, axis: 30.0611, eccentricity: 0.0086 },
  ];
  let trailMax = 300;     // trail points per planet (user adjustable)

  const canvas = document.getElementById('sky');
  const ctx = canvas.getContext('2d');
  const statsEl = document.getElementById('stats');

  let W, H, DPR, CX, CY, R, SUN_PX, REF_DRAG_PX, stars = [];

  const sun = { x: 0, y: 0, vx: 0, vy: 0, m: SUN_MASS, ax: 0, ay: 0, sun: true };
  let planetMult = 1;     // gravitational mass multiplier for planets (sizes unchanged)
  let mergeOnCollision = false;
  let planets = [];
  let flashes = [];
  let paused = false;
  let speed = 1;          // years of simulated time per real second
  let simTime = 0;
  let drag = null;

  // ---------- Compressed view mapping (sqrt radial compression) ----------
  function toScreen(x, y) {
    const dx = x - sun.x, dy = y - sun.y;
    const r = Math.hypot(dx, dy);
    if (r === 0) return [CX, CY];
    const s = R * Math.sqrt(r / VIEW_AU);
    return [CX + (dx / r) * s, CY + (dy / r) * s];
  }
  function relToScreen(dx, dy) {
    const r = Math.hypot(dx, dy);
    if (r === 0) return [CX, CY];
    const s = R * Math.sqrt(r / VIEW_AU);
    return [CX + (dx / r) * s, CY + (dy / r) * s];
  }
  function toWorld(sx, sy) {
    const dx = sx - CX, dy = sy - CY;
    const d = Math.hypot(dx, dy);
    if (d === 0) return [sun.x, sun.y];
    const r = VIEW_AU * (d / R) * (d / R);
    return [sun.x + (dx / d) * r, sun.y + (dy / d) * r];
  }

  function planetRadiusPx(m) {
    const t = Math.min(1.3, Math.log(m / MIN_MASS) / Math.log(MAX_MASS / MIN_MASS));
    return Math.max(2.5, SUN_PX * (0.18 + 0.42 * t));
  }

  // ---------- Setup ----------
  function resize() {
    DPR = window.devicePixelRatio || 1;
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    CX = W / 2; CY = H / 2;
    R = Math.hypot(W, H) / 2 * 0.92;   // corners ≈ 40 AU, edges ≈ Neptune
    SUN_PX = Math.max(10, Math.min(W, H) * 0.025);
    REF_DRAG_PX = Math.max(60, Math.min(W, H) * 0.12);
    planets.forEach(p => { p.rpx = planetRadiusPx(p.baseM); });
    stars = [];
    const n = Math.floor(W * H / 2500);
    for (let i = 0; i < n; i++) {
      stars.push({ x: Math.random() * W, y: Math.random() * H, a: Math.random() * 0.6 + 0.1, s: Math.random() < 0.1 ? 1.5 : 1 });
    }
  }
  window.addEventListener('resize', resize);
  resize();

  // Golden-angle hue stepping (plus jitter) keeps consecutive colors well apart.
  let lastHue = Math.random() * 360;
  function randomHsl() {
    lastHue = (lastHue + 137.508 + (Math.random() - 0.5) * 30) % 360;
    return [lastHue, 70 + Math.random() * 25, 55 + Math.random() * 15];
  }
  const hslStr = ([h, s, l]) => `hsl(${h.toFixed(0)}, ${s.toFixed(0)}%, ${l.toFixed(0)}%)`;
  // Even blend of two colors; hue is averaged around the color wheel (shortest way).
  function blendHsl(a, b) {
    const ra = a[0] * Math.PI / 180, rb = b[0] * Math.PI / 180;
    let h = Math.atan2(Math.sin(ra) + Math.sin(rb), Math.cos(ra) + Math.cos(rb)) * 180 / Math.PI;
    if (h < 0) h += 360;
    return [h, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  }

  // ---------- Physics ----------
  function computeAccelerations(bodies) {
    for (const b of bodies) { b.ax = 0; b.ay = 0; }
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy + SOFTENING2;
        const inv = 1 / (d2 * Math.sqrt(d2));
        const fx = G * dx * inv, fy = G * dy * inv;
        a.ax += fx * b.m; a.ay += fy * b.m;
        b.ax -= fx * a.m; b.ay -= fy * a.m;
      }
    }
  }

  function chooseDt() {
    // Fraction of the shortest local orbital timescale around the sun.
    let minT = Infinity;
    for (const p of planets) {
      const r = Math.hypot(p.x - sun.x, p.y - sun.y);
      minT = Math.min(minT, Math.sqrt(r * r * r / (G * sun.m)));
    }
    return Math.min(0.002, 0.01 * minT);
  }

  function step(dt) {
    const bodies = [sun, ...planets];
    for (const b of bodies) {         // velocity Verlet (kick-drift-kick)
      b.vx += 0.5 * dt * b.ax; b.vy += 0.5 * dt * b.ay;
      b.x += dt * b.vx; b.y += dt * b.vy;
    }
    computeAccelerations(bodies);
    for (const b of bodies) {
      b.vx += 0.5 * dt * b.ax; b.vy += 0.5 * dt * b.ay;
    }
    detectCollisions();
  }

  function mergePlanets(a, b) {
    const m = a.m + b.m;
    const big = a.m >= b.m ? a : b;
    const hsl = blendHsl(a.hsl, b.hsl);
    const merged = {
      x: (a.x * a.m + b.x * b.m) / m, y: (a.y * a.m + b.y * b.m) / m,
      vx: (a.vx * a.m + b.vx * b.m) / m, vy: (a.vy * a.m + b.vy * b.m) / m,   // momentum conserved
      baseM: a.baseM + b.baseM, m, hsl, color: hslStr(hsl), ax: 0, ay: 0, trail: big.trail,
    };
    merged.rpx = planetRadiusPx(merged.baseM);
    flashes.push({ x: merged.x - sun.x, y: merged.y - sun.y, color: merged.color, t: 0, r: merged.rpx });
    return merged;
  }

  function detectCollisions() {
    const dead = new Set();
    const born = [];
    const pos = planets.map(p => toScreen(p.x, p.y));
    for (let i = 0; i < planets.length; i++) {
      const p = planets[i];
      if (dead.has(p)) continue;
      const [sx, sy] = pos[i];
      if (Math.hypot(sx - CX, sy - CY) < SUN_PX + p.rpx * 0.5) { dead.add(p); continue; }
      if (Math.hypot(p.x - sun.x, p.y - sun.y) > ESCAPE_AU) { p.escaped = true; dead.add(p); continue; }
      for (let j = i + 1; j < planets.length; j++) {
        const q = planets[j];
        if (dead.has(q)) continue;
        if (Math.hypot(sx - pos[j][0], sy - pos[j][1]) < p.rpx + q.rpx) {
          if (mergeOnCollision) {
            p.merged = q.merged = true;
            born.push(mergePlanets(p, q));
          }
          dead.add(p); dead.add(q);
          break;
        }
      }
    }
    if (dead.size) {
      for (const p of dead) {
        if (!p.escaped && !p.merged) flashes.push({ x: p.x - sun.x, y: p.y - sun.y, color: p.color, t: 0, r: p.rpx });
      }
      planets = planets.filter(p => !dead.has(p)).concat(born);
      computeAccelerations([sun, ...planets]);
    }
  }

  function advance(realDt) {
    let remaining = speed * realDt;
    let guard = 0;
    while (remaining > 1e-12 && guard++ < 4000) {
      const dt = Math.min(chooseDt(), remaining);
      step(dt);
      recordTrails();
      remaining -= dt;
      simTime += dt;
    }
  }

  // ---------- Launching ----------
  function launchVelocity(d) {
    // Slingshot: planet launches opposite to the pull direction.
    const dxs = d.sx - d.ex, dys = d.sy - d.ey;
    const len = Math.hypot(dxs, dys);
    const [wx, wy] = toWorld(d.sx, d.sy);
    if (len < 3) return { x: wx, y: wy, vx: sun.vx, vy: sun.vy };
    const ux = dxs / len, uy = dys / len;
    // Map the screen direction through the (non-linear) view into world space.
    const [wx2, wy2] = toWorld(d.sx + ux * 2, d.sy + uy * 2);
    let dwx = wx2 - wx, dwy = wy2 - wy;
    const dl = Math.hypot(dwx, dwy) || 1;
    dwx /= dl; dwy /= dl;
    const r = Math.max(1e-3, Math.hypot(wx - sun.x, wy - sun.y));
    const vcirc = Math.sqrt(G * sun.m / r);
    const v = vcirc * (len / REF_DRAG_PX);   // REF_DRAG_PX of drag ≈ circular speed
    return { x: wx, y: wy, vx: sun.vx + dwx * v, vy: sun.vy + dwy * v, v, vcirc };
  }

  function createSolarSystem() {
    SOLAR_SYSTEM.forEach(({ mass, axis, eccentricity }, i) => {
      const baseM = mass * EARTH_MASS;
      const m = baseM * planetMult;
      const angle = i * 2 * Math.PI / SOLAR_SYSTEM.length;
      const radius = axis * (1 - eccentricity);
      const v = Math.sqrt(G * (sun.m + m) * (1 + eccentricity) / radius);
      const hsl = randomHsl();
      planets.push({
        x: sun.x + radius * Math.cos(angle), y: sun.y + radius * Math.sin(angle),
        vx: sun.vx - v * Math.sin(angle), vy: sun.vy + v * Math.cos(angle),
        baseM, m, hsl, color: hslStr(hsl), rpx: planetRadiusPx(baseM),
        ax: 0, ay: 0, trail: [],
      });
    });
    computeAccelerations([sun, ...planets]);
  }

  function predictOrbit(state) {
    // Two-body (sun-only) estimate, adaptive leapfrog, relative to sun.
    let x = state.x - sun.x, y = state.y - sun.y;
    let vx = state.vx - sun.vx, vy = state.vy - sun.vy;
    const pts = [[x, y]];
    const mu = G * (sun.m + state.m);
    let swept = 0, prevAng = Math.atan2(y, x);
    const acc = (x, y) => { const r2 = x * x + y * y + SOFTENING2; const k = -mu / (r2 * Math.sqrt(r2)); return [k * x, k * y]; };
    let [ax, ay] = acc(x, y);
    for (let i = 0; i < 6000; i++) {
      const r = Math.hypot(x, y);
      const dt = 0.004 * Math.sqrt(r * r * r / mu) * 2 * Math.PI;
      vx += 0.5 * dt * ax; vy += 0.5 * dt * ay;
      x += dt * vx; y += dt * vy;
      [ax, ay] = acc(x, y);
      vx += 0.5 * dt * ax; vy += 0.5 * dt * ay;
      pts.push([x, y]);
      const ang = Math.atan2(y, x);
      let da = ang - prevAng;
      if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
      swept += da; prevAng = ang;
      if (Math.abs(swept) >= 2 * Math.PI) break;
      const [sx, sy] = relToScreen(x, y);
      if (Math.hypot(sx - CX, sy - CY) < SUN_PX) break;
      if (r > ESCAPE_AU) break;
    }
    return pts;
  }

  // While held, mass "throbs" smoothly through the full range (log scale).
  const THROB_PERIOD_MS = 2500;
  function updateDragSize(now) {
    const ph = drag.phase + (now - drag.t0) / THROB_PERIOD_MS;
    const t = 0.5 - 0.5 * Math.cos(2 * Math.PI * ph);
    drag.m = MIN_MASS * Math.pow(MAX_MASS / MIN_MASS, t);
    drag.rpx = planetRadiusPx(drag.m);
  }

  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  canvas.addEventListener('pointerdown', e => {
    if (drag) return;
    const [x, y] = pointerPos(e);
    if (Math.hypot(x - CX, y - CY) < SUN_PX * 1.5) return;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic/stale pointer */ }
    // Random starting phase: quick flicks give a random size; holding lets you time it.
    drag = { id: e.pointerId, sx: x, sy: y, ex: x, ey: y, t0: performance.now(), phase: Math.random(), hsl: randomHsl() };
    drag.color = hslStr(drag.hsl);
    updateDragSize(drag.t0);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    [drag.ex, drag.ey] = pointerPos(e);
  });
  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!cancelled) {
      updateDragSize(performance.now());
      const s = launchVelocity(drag);
      const p = { x: s.x, y: s.y, vx: s.vx, vy: s.vy, baseM: drag.m, m: drag.m * planetMult, hsl: drag.hsl, color: drag.color, rpx: drag.rpx, ax: 0, ay: 0, trail: [] };
      planets.push(p);
      if (++launchCount === 3) { document.body.classList.add('compact'); helpEl.classList.add('hidden'); }
      computeAccelerations([sun, ...planets]);
    }
    drag = null;
  }
  canvas.addEventListener('pointerup', e => endDrag(e, false));
  canvas.addEventListener('pointercancel', e => endDrag(e, true));

  function clearPlanets() {
    planets = [];
    flashes = [];
    computeAccelerations([sun]);
  }

  window.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement && e.code !== 'Space') return;
    if (e.code === 'Space') { paused = !paused; e.preventDefault(); }
    else if (e.key === '+' || e.key === '=') setSpeed(speed * 2);
    else if (e.key === '-' || e.key === '_') setSpeed(speed / 2);
    else if (e.key === 'c' || e.key === 'C') clearPlanets();
    else if (e.key === 'f' || e.key === 'F') {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    }
  });

  // ---------- Settings menu ----------
  const fmtMult = v => (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2)) + '×';
  const sunSlider = document.getElementById('sunMass');
  const planetSlider = document.getElementById('planetMass');
  const speedSlider = document.getElementById('speed');
  const sunVal = document.getElementById('sunMassVal');
  const planetVal = document.getElementById('planetMassVal');
  const speedVal = document.getElementById('speedVal');

  function setSpeed(v) {
    speed = Math.min(64, Math.max(1 / 16, v));
    speedSlider.value = Math.log2(speed);
    speedVal.textContent = (speed >= 1 ? speed.toFixed(speed < 10 ? 1 : 0) : speed.toFixed(2)) + ' yr/s';
  }
  sunSlider.addEventListener('input', () => {
    const v = Math.pow(10, +sunSlider.value);
    sun.m = SUN_MASS * v;
    sunVal.textContent = fmtMult(v);
  });
  planetSlider.addEventListener('input', () => {
    planetMult = Math.pow(10, +planetSlider.value);
    for (const p of planets) p.m = p.baseM * planetMult;
    planetVal.textContent = fmtMult(planetMult);
  });
  speedSlider.addEventListener('input', () => setSpeed(Math.pow(2, +speedSlider.value)));
  const trailSlider = document.getElementById('trailLen');
  const trailVal = document.getElementById('trailLenVal');
  trailSlider.addEventListener('input', () => {
    trailMax = +trailSlider.value;
    trailVal.textContent = trailMax ? trailMax : 'Off';
    for (const p of planets) if (p.trail.length > trailMax) p.trail.splice(0, p.trail.length - trailMax);
  });
  const helpEl = document.getElementById('help');
  const mergeToggle = document.getElementById('mergeToggle');
  mergeToggle.addEventListener('change', () => { mergeOnCollision = mergeToggle.checked; });
  let launchCount = 0;
  document.getElementById('infoBtn').addEventListener('click', () => helpEl.classList.toggle('hidden'));
  document.getElementById('resetSettings').addEventListener('click', () => {
    mergeToggle.checked = false; mergeOnCollision = false;
    trailSlider.value = 300; trailSlider.dispatchEvent(new Event('input'));
    sunSlider.value = 0; planetSlider.value = 0;
    sunSlider.dispatchEvent(new Event('input'));
    planetSlider.dispatchEvent(new Event('input'));
    setSpeed(1);
  });
  const menu = document.getElementById('menu');
  document.getElementById('menuBtn').addEventListener('click', () => menu.classList.toggle('open'));
  document.getElementById('createSolarSystem').addEventListener('click', createSolarSystem);
  document.getElementById('clearPlanets').addEventListener('click', clearPlanets);
  setSpeed(speed);

  // ---------- Rendering ----------
  function recordTrails() {
    for (const p of planets) {
      const rx = p.x - sun.x, ry = p.y - sun.y;
      const last = p.trail[p.trail.length - 1];
      if (last) {
        const [a, b] = relToScreen(last[0], last[1]);
        const [c, d] = relToScreen(rx, ry);
        if (Math.hypot(a - c, b - d) < 2) continue;
      }
      p.trail.push([rx, ry]);
      while (p.trail.length > trailMax) p.trail.shift();
    }
  }

  function drawBackground() {
    ctx.fillStyle = '#02030a';
    ctx.fillRect(0, 0, W, H);
    for (const s of stars) {
      ctx.fillStyle = `rgba(255,255,255,${s.a})`;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    // Faint reference rings for real planet distances (Mercury … Neptune).
    ctx.strokeStyle = 'rgba(120,140,255,0.08)';
    ctx.lineWidth = 1;
    for (const au of [0.39, 0.72, 1, 1.52, 5.2, 9.58, 19.2, 30.05]) {
      ctx.beginPath();
      ctx.arc(CX, CY, R * Math.sqrt(au / VIEW_AU), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawSun() {
    const g = ctx.createRadialGradient(CX, CY, 0, CX, CY, SUN_PX * 4);
    g.addColorStop(0, 'rgba(255,220,120,0.55)');
    g.addColorStop(0.3, 'rgba(255,160,40,0.15)');
    g.addColorStop(1, 'rgba(255,120,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(CX, CY, SUN_PX * 4, 0, Math.PI * 2); ctx.fill();
    const core = ctx.createRadialGradient(CX - SUN_PX * 0.3, CY - SUN_PX * 0.3, 0, CX, CY, SUN_PX);
    core.addColorStop(0, '#fffbe0'); core.addColorStop(0.6, '#ffd34d'); core.addColorStop(1, '#ff9a1f');
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(CX, CY, SUN_PX, 0, Math.PI * 2); ctx.fill();
  }

  function drawTrails() {
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    for (const p of planets) {
      const t = p.trail;
      if (t.length < 2) continue;
      const pts = t.map(([x, y]) => relToScreen(x, y));
      pts.push(toScreen(p.x, p.y));
      ctx.strokeStyle = p.color;
      ctx.lineWidth = Math.max(0.75, p.rpx * 0.25);
      const n = pts.length;
      // Batch segments into alpha buckets so long trails stay cheap to draw.
      const BUCKETS = 24;
      for (let b = 0; b < BUCKETS; b++) {
        const i0 = Math.floor(b * n / BUCKETS), i1 = Math.min(n - 1, Math.floor((b + 1) * n / BUCKETS));
        if (i1 <= i0) continue;
        ctx.globalAlpha = ((b + 1) / BUCKETS) * 0.8;
        ctx.beginPath();
        ctx.moveTo(pts[i0][0], pts[i0][1]);
        for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawPlanet(sx, sy, r, color) {
    ctx.fillStyle = color;
    ctx.shadowColor = color; ctx.shadowBlur = r * 1.5;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawPlanets() {
    for (const p of planets) {
      const [sx, sy] = toScreen(p.x, p.y);
      drawPlanet(sx, sy, p.rpx, p.color);
    }
  }

  function drawFlashes(realDt) {
    flashes = flashes.filter(f => (f.t += realDt) < 0.6);
    for (const f of flashes) {
      const [sx, sy] = relToScreen(f.x, f.y);
      const k = f.t / 0.6;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = f.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, f.r + k * 30, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawDrag() {
    if (!drag) return;
    updateDragSize(performance.now());
    const s = launchVelocity(drag);
    const pts = predictOrbit({ ...s, m: drag.m * planetMult });
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = drag.color; ctx.globalAlpha = 0.75; ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const [sx, sy] = relToScreen(x, y);
      i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    // Velocity arrow
    ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(drag.sx, drag.sy); ctx.lineTo(drag.ex, drag.ey); ctx.stroke();
    // Faint guide rings at the min/max size so the throb reads as a scale.
    const maxR = planetRadiusPx(MAX_MASS);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(drag.sx, drag.sy, maxR, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(drag.sx, drag.sy, planetRadiusPx(MIN_MASS), 0, Math.PI * 2); ctx.stroke();
    drawPlanet(drag.sx, drag.sy, drag.rpx, drag.color);
    // Info label
    const r = Math.hypot(s.x - sun.x, s.y - sun.y);
    const me = drag.m * planetMult / EARTH_MASS;
    const label = `${me.toFixed(me < 10 ? 2 : 0)} M⊕ · ${r.toFixed(2)} AU` +
      (s.vcirc ? ` · ${(s.v / s.vcirc).toFixed(2)}× v_circ` : '');
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(label, drag.sx + maxR + 6, drag.sy - maxR - 6);
  }

  function updateHud() {
    statsEl.innerHTML = `Planets: <b>${planets.length}</b> · Time: <b>${simTime.toFixed(1)} yr</b> · ` +
      `Speed: <b>${speedVal.textContent}</b>${paused ? ' · <b>PAUSED</b>' : ''}`;
  }

  // ---------- Main loop ----------
  let lastT = performance.now();
  function frame(now) {
    const realDt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    if (!paused) advance(realDt);
    drawBackground();
    drawTrails();
    drawSun();
    drawPlanets();
    drawFlashes(realDt);
    drawDrag();
    updateHud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
