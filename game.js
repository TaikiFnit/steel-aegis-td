// ═══════════════════════════════════════════════════════════
// STEEL AEGIS v2 — TowerDefence x Battleship
// Full rewrite: manual aiming, multi-touch, realistic flight
// patterns, turret rotation limits, level-up system
// ═══════════════════════════════════════════════════════════

'use strict';

const PI = Math.PI, TAU = PI * 2, DEG = PI / 180;
const TICK = 1000 / 60;

// ─── UTILITIES ──────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (lo, hi) => Math.random() * (hi - lo) + lo;
const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const ang = (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1);
function angleDiff(a, b) { let d = ((b - a) % TAU + TAU + PI) % TAU - PI; return d; }
function shortAngle(from, to, maxStep) {
  const d = angleDiff(from, to);
  return from + clamp(d, -maxStep, maxStep);
}
// Color lerp: parse hex, blend toward target
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
}
function lerpColor(hex1, hex2, t) {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  const r = Math.round(lerp(r1, r2, t));
  const g = Math.round(lerp(g1, g2, t));
  const b = Math.round(lerp(b1, b2, t));
  return `rgb(${r},${g},${b})`;
}

// ─── CANVAS ─────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let W, H, CX, CY;
function resize() {
  const dpr = Math.min(devicePixelRatio, 2);
  W = innerWidth; H = innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  CX = W / 2; CY = H / 2;
}
addEventListener('resize', resize); resize();

// ─── TOUCH / POINTER SYSTEM ────────────────────────────
// Tracks all active pointers (mouse + touches) for multi-aim
const pointers = new Map(); // id -> {x, y, startTime}

canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startTime: Date.now() });
  if (!audioCtx) initAudio();
  if (G.phase === 'title') { startGame(); return; }
  if (G.phase === 'sinking') return; // block input during sinking
  if (G.phase === 'gameover') { resetGame(); return; }
});
canvas.addEventListener('pointermove', e => {
  if (pointers.has(e.pointerId)) {
    const p = pointers.get(e.pointerId);
    p.x = e.clientX; p.y = e.clientY;
  }
});
canvas.addEventListener('pointerup', e => {
  pointers.delete(e.pointerId);
});
canvas.addEventListener('pointercancel', e => {
  pointers.delete(e.pointerId);
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

// Convert screen coords to world coords
function screenToWorld(sx, sy) {
  return { x: sx - CX + G.ship.x - shakeOx, y: sy - CY + G.ship.y - shakeOy };
}

// Keyboard (for build UI shortcuts)
const keys = {};
addEventListener('keydown', e => { keys[e.code] = true; });
addEventListener('keyup', e => { keys[e.code] = false; });

// ─── AUDIO ──────────────────────────────────────────────
let audioCtx = null;
function initAudio() {
  if (audioCtx) return;
  audioCtx = new (AudioContext || webkitAudioContext)();
}
function sfx(type) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.connect(g); g.connect(audioCtx.destination);
  switch (type) {
    case 'mg': {
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(180 + Math.random() * 120, t);
      o.frequency.exponentialRampToValueAtTime(60, t + 0.06);
      g.gain.setValueAtTime(0.07, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      o.start(t); o.stop(t + 0.06);
      // noise
      const n = audioCtx.createBufferSource();
      const b = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.04, audioCtx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.4;
      n.buffer = b;
      const ng = audioCtx.createGain();
      ng.gain.setValueAtTime(0.08, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      n.connect(ng); ng.connect(audioCtx.destination);
      n.start(t); n.stop(t + 0.04);
      break;
    }
    case 'flak': {
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(100, t);
      o.frequency.exponentialRampToValueAtTime(30, t + 0.25);
      g.gain.setValueAtTime(0.14, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.start(t); o.stop(t + 0.25);
      break;
    }
    case 'explode': {
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(70, t);
      o.frequency.exponentialRampToValueAtTime(15, t + 0.4);
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.start(t); o.stop(t + 0.4);
      const eb = audioCtx.createBufferSource();
      const ebuf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.3, audioCtx.sampleRate);
      const ed = ebuf.getChannelData(0);
      for (let i = 0; i < ed.length; i++) ed[i] = (Math.random() * 2 - 1) * Math.exp(-i / (audioCtx.sampleRate * 0.07));
      eb.buffer = ebuf;
      const eg = audioCtx.createGain();
      eg.gain.setValueAtTime(0.18, t);
      eg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      eb.connect(eg); eg.connect(audioCtx.destination);
      eb.start(t); eb.stop(t + 0.3);
      break;
    }
    case 'missile': {
      o.type = 'sine';
      o.frequency.setValueAtTime(500, t);
      o.frequency.exponentialRampToValueAtTime(1100, t + 0.15);
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      o.start(t); o.stop(t + 0.15);
      break;
    }
    case 'jammer': {
      o.type = 'sine';
      o.frequency.setValueAtTime(1800, t);
      o.frequency.setValueAtTime(2200, t + 0.05);
      o.frequency.setValueAtTime(1600, t + 0.1);
      g.gain.setValueAtTime(0.04, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.start(t); o.stop(t + 0.2);
      break;
    }
    case 'pickup': {
      o.type = 'sine';
      o.frequency.setValueAtTime(700, t);
      o.frequency.exponentialRampToValueAtTime(1400, t + 0.08);
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      o.start(t); o.stop(t + 0.08);
      break;
    }
    case 'build': {
      o.type = 'triangle';
      o.frequency.setValueAtTime(400, t);
      o.frequency.exponentialRampToValueAtTime(800, t + 0.15);
      g.gain.setValueAtTime(0.08, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.start(t); o.stop(t + 0.3);
      break;
    }
    case 'wave': {
      o.type = 'sine';
      o.frequency.setValueAtTime(300, t);
      o.frequency.exponentialRampToValueAtTime(600, t + 0.2);
      o.frequency.setValueAtTime(600, t + 0.3);
      o.frequency.exponentialRampToValueAtTime(900, t + 0.5);
      g.gain.setValueAtTime(0.1, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.start(t); o.stop(t + 0.5);
      break;
    }
    case 'hit': {
      o.type = 'square';
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(50, t + 0.08);
      g.gain.setValueAtTime(0.1, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      o.start(t); o.stop(t + 0.08);
      break;
    }
    case 'torpedo': {
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(200, t);
      o.frequency.exponentialRampToValueAtTime(50, t + 0.5);
      g.gain.setValueAtTime(0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.start(t); o.stop(t + 0.5);
      // splash
      const sb = audioCtx.createBufferSource();
      const sbuf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.4, audioCtx.sampleRate);
      const sd = sbuf.getChannelData(0);
      for (let i = 0; i < sd.length; i++) sd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (audioCtx.sampleRate * 0.1));
      sb.buffer = sbuf;
      const sg = audioCtx.createGain();
      sg.gain.setValueAtTime(0.15, t + 0.1);
      sg.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      sb.connect(sg); sg.connect(audioCtx.destination);
      sb.start(t + 0.1); sb.stop(t + 0.5);
      break;
    }
    default: {
      o.type = 'square'; o.frequency.value = 440;
      g.gain.setValueAtTime(0.04, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.start(t); o.stop(t + 0.1);
    }
  }
}

// ─── PARTICLES ──────────────────────────────────────────
const particles = [];
const MAX_PARTICLES = 3000;

function emitP(x, y, count, cfg) {
  for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
    const a = cfg.angle != null ? cfg.angle + rand(-(cfg.spread || PI), cfg.spread || PI) : rand(0, TAU);
    const spd = rand(cfg.spdMin || 50, cfg.spdMax || 200);
    particles.push({
      x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      life: rand(cfg.lifeMin || 0.2, cfg.lifeMax || 0.8),
      maxLife: 0, // set below
      size: rand(cfg.szMin || 2, cfg.szMax || 5),
      color: Array.isArray(cfg.colors) ? cfg.colors[randInt(0, cfg.colors.length - 1)] : (cfg.color || '#fff'),
      type: cfg.type || 'circle',
      rot: rand(0, TAU), rotSpd: rand(-5, 5),
      gravity: cfg.gravity ?? 40,
    });
    particles[particles.length - 1].maxLife = particles[particles.length - 1].life;
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += p.gravity * dt;
    p.life -= dt; p.rot += p.rotSpd * dt;
    if (p.life <= 0) { particles.splice(i, 1); }
  }
}

function drawParticles() {
  for (const p of particles) {
    const alpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    if (p.type === 'debris') {
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
    } else if (p.type === 'spark') {
      ctx.strokeStyle = p.color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-p.size, 0); ctx.lineTo(p.size, 0); ctx.stroke();
    } else if (p.type === 'ring') {
      ctx.strokeStyle = p.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, p.size * (1 - alpha) * 3 + 5, 0, TAU); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(0, 0, p.size * alpha, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}

// ─── SCREEN SHAKE ───────────────────────────────────────
let shakeAmt = 0, shakeOx = 0, shakeOy = 0;
function addShake(v) { shakeAmt = Math.min(shakeAmt + v, 18); }
function updateShake() {
  if (shakeAmt > 0.4) {
    shakeOx = (Math.random() - 0.5) * shakeAmt * 2;
    shakeOy = (Math.random() - 0.5) * shakeAmt * 2;
    shakeAmt *= 0.9;
  } else { shakeAmt = 0; shakeOx = shakeOy = 0; }
}

// ─── TURRET DEFINITIONS ────────────────────────────────
// Stats scale by level: base * (1 + 0.3 * (lv - 1))
const TURRET_DEFS = {
  machineGun: {
    name: '機銃', desc: '高速連射 — 小型敵・魚雷迎撃に最適',
    range: 220, fireRate: 0.07, damage: 4, bulletSpeed: 900,
    barrels: 2, spread: 3 * DEG, tracerCol: '#ffcc33',
    cost: { iron: 8, gunpowder: 4 },
    upgradeCost: { iron: 6, gunpowder: 3 }, // per level
    burstSize: 5, burstDelay: 0.04, burstCooldown: 0.35,
    rotSpeed: 2.2 * DEG,
    arcLimit: 150 * DEG,
  },
  flak: {
    name: '高射砲', desc: '炸裂弾 — 大型敵に有効、範囲ダメージ',
    range: 320, fireRate: 1.0, damage: 80, bulletSpeed: 500,
    barrels: 1, spread: 0, tracerCol: '#ff6622',
    cost: { iron: 18, gunpowder: 12, brass: 4 },
    upgradeCost: { iron: 12, gunpowder: 8, brass: 3 },
    aoe: 70, burstSize: 1, burstDelay: 0, burstCooldown: 1.0,
    rotSpeed: 1.5 * DEG,
    arcLimit: 160 * DEG,
  },
  jammer: {
    name: 'ジャマー', desc: '電子妨害 — 敵を減速（複数配置推奨）',
    range: 250, fireRate: 2.0, damage: 0, bulletSpeed: 0,
    barrels: 0, spread: 0, tracerCol: '#b088ff',
    cost: { iron: 12, electronics: 15 },
    upgradeCost: { iron: 8, electronics: 10 },
    slowFactor: 0.35, slowDuration: 2.0,
    burstSize: 1, burstDelay: 0, burstCooldown: 6.0,
    rotSpeed: 3.0 * DEG,
    arcLimit: 180 * DEG, // full rotation
  },
  launcher: {
    name: 'ミサイル', desc: '追尾ミサイル — 高火力',
    range: 400, fireRate: 2.5, damage: 85, bulletSpeed: 300,
    barrels: 1, spread: 0, tracerCol: '#ff4466',
    cost: { iron: 22, gunpowder: 18, electronics: 8, brass: 4 },
    upgradeCost: { iron: 15, gunpowder: 12, electronics: 6, brass: 3 },
    homing: true, burstSize: 1, burstDelay: 0, burstCooldown: 2.8,
    rotSpeed: 1.8 * DEG,
    arcLimit: 140 * DEG,
  },
};

function turretStat(def, lv, stat) {
  const base = def[stat];
  if (stat === 'damage' || stat === 'range') return base * (1 + 0.3 * (lv - 1));
  if (stat === 'burstCooldown') return base / (1 + 0.15 * (lv - 1));
  return base;
}

// ─── ENEMY DEFINITIONS ─────────────────────────────────
// behavior: 'orbit' = circles the ship N times then attacks
//           'strafe' = flies across the ship
//           'dive'   = dives straight at ship
const ENEMY_DEFS = {
  scoutDrone: {
    name: '偵察ドローン', hp: 35, speed: 80, torpedoDmg: 12, score: 10, size: 10,
    color: '#44aacc', drop: { iron: 1, gunpowder: 1 },
    behavior: 'orbit', orbits: 2, orbitRadius: 180,
  },
  fastDrone: {
    name: '高速ドローン', hp: 15, speed: 130, torpedoDmg: 15, score: 15, size: 9,
    color: '#55cc88', drop: { iron: 1, electronics: 1 },
    behavior: 'strafe', strafeOffset: 100,
  },
  bomber: {
    name: '爆撃機', hp: 120, speed: 50, torpedoDmg: 40, score: 35, size: 18,
    color: '#6688cc', drop: { iron: 3, gunpowder: 2, brass: 1 },
    behavior: 'orbit', orbits: 1, orbitRadius: 140,
  },
  heavyDrone: {
    name: '重装ドローン', hp: 200, speed: 40, torpedoDmg: 50, score: 55, size: 22,
    color: '#7766bb', drop: { iron: 4, gunpowder: 3, electronics: 2, brass: 1 },
    behavior: 'orbit', orbits: 2, orbitRadius: 120,
  },
  stealthDrone: {
    name: 'ステルス', hp: 30, speed: 110, torpedoDmg: 25, score: 30, size: 9,
    color: '#4488aa', drop: { electronics: 3, brass: 1 },
    behavior: 'strafe', strafeOffset: 80, stealth: true,
  },
  // ── Jammer-Resistant variants (W20+) ──
  scoutDrone_jr: {
    name: '耐妨偵察機', hp: 45, speed: 85, torpedoDmg: 14, score: 18, size: 10,
    color: '#ccaa33', drop: { iron: 1, gunpowder: 1, brass: 1 },
    behavior: 'orbit', orbits: 2, orbitRadius: 180,
    jammerResist: 0.8,
  },
  fastDrone_jr: {
    name: '耐妨高速機', hp: 20, speed: 135, torpedoDmg: 17, score: 25, size: 9,
    color: '#ddbb44', drop: { iron: 1, electronics: 1, brass: 1 },
    behavior: 'strafe', strafeOffset: 100,
    jammerResist: 0.85,
  },
  bomber_jr: {
    name: '耐妨爆撃機', hp: 140, speed: 55, torpedoDmg: 45, score: 50, size: 18,
    color: '#bb9933', drop: { iron: 3, gunpowder: 2, brass: 1 },
    behavior: 'orbit', orbits: 1, orbitRadius: 140,
    jammerResist: 0.9,
  },
  heavyDrone_jr: {
    name: '耐妨重装機', hp: 240, speed: 42, torpedoDmg: 55, score: 70, size: 22,
    color: '#aa8822', drop: { iron: 5, gunpowder: 3, electronics: 2, brass: 1 },
    behavior: 'orbit', orbits: 2, orbitRadius: 120,
    jammerResist: 0.9,
  },
  // ── Boss enemy (W5, 10, 15, 20...) ──
  boss: {
    name: 'ドレッドノート', hp: 2000, speed: 30, torpedoDmg: 80, score: 200, size: 32,
    color: '#eeeeee', drop: { iron: 10, gunpowder: 6, electronics: 5, brass: 3 },
    behavior: 'orbit', orbits: 3, orbitRadius: 160,
    isBoss: true,
  },
};

// ─── GAME STATE ─────────────────────────────────────────
const G = {
  phase: 'title', // title | playing | building | sinking | gameover
  time: 0,
  wave: 0,
  score: 0,
  kills: 0,
  ship: {
    x: 0, y: 0,
    hp: 120, maxHp: 120,
    w: 120, h: 40,
    slots: [],
  },
  res: { iron: 0, gunpowder: 0, electronics: 0, brass: 0 },
  enemies: [],
  bullets: [],
  scraps: [],
  torpedoes: [],   // incoming torpedoes/bombs
  spawnQueues: [],
  waveActive: false,
  dmgFlash: 0,
  notifications: [],
  announce: null,
  buildUI: { selectedType: null, selectedSlot: null, mode: 'main', demolishConfirm: null }, // main | slot; demolishConfirm = slotId awaiting confirm
};

const RES_NAME = { iron: '鉄塊', gunpowder: '火薬', electronics: '電子機器', brass: '真鍮' };
const RES_COL = { iron: '#7ec8e3', gunpowder: '#ff8844', electronics: '#b088ff', brass: '#ffd700' };

// ─── SHIP SLOTS ─────────────────────────────────────────
// baseFacing: the "natural" direction each turret faces (radians)
// Turrets can rotate arcLimit from this base facing
function initSlots() {
  const s = G.ship;
  s.slots = [
    { rx: 48, ry: 0,   baseFacing: 0,       turret: null, id: 0 },        // bow
    { rx: 25, ry: -16,  baseFacing: -PI/4,   turret: null, id: 1 },        // fwd-port
    { rx: 25, ry: 16,   baseFacing: PI/4,    turret: null, id: 2 },        // fwd-star
    { rx: 0,  ry: -20,  baseFacing: -PI/2,   turret: null, id: 3 },        // mid-port
    { rx: 0,  ry: 20,   baseFacing: PI/2,    turret: null, id: 4 },        // mid-star
    { rx: -28, ry: -16, baseFacing: -3*PI/4, turret: null, id: 5 },        // aft-port
    { rx: -28, ry: 16,  baseFacing: 3*PI/4,  turret: null, id: 6 },        // aft-star
    { rx: -48, ry: 0,   baseFacing: PI,      turret: null, id: 7 },        // stern
  ];
}

function placeTurret(slotId, type) {
  const slot = G.ship.slots[slotId];
  if (!slot || slot.turret) return false;
  const def = TURRET_DEFS[type];
  slot.turret = {
    type, level: 1,
    angle: slot.baseFacing, // starts facing its base direction
    targetAngle: slot.baseFacing,
    cooldown: 0, burstCount: 0, burstTimer: 0,
    recoil: 0,
    buildAnim: 1.0,
  };
  return true;
}

function upgradeTurret(slotId) {
  const slot = G.ship.slots[slotId];
  if (!slot || !slot.turret) return false;
  const t = slot.turret;
  const def = TURRET_DEFS[t.type];
  const cost = {};
  for (const [k, v] of Object.entries(def.upgradeCost)) cost[k] = Math.ceil(v * (1 + (t.level - 1) * 0.5));
  if (!canAfford(cost)) return false;
  spend(cost);
  t.level++;
  sfx('build');
  return true;
}

function canAfford(cost) {
  for (const [k, v] of Object.entries(cost)) if ((G.res[k] || 0) < v) return false;
  return true;
}
function spend(cost) {
  for (const [k, v] of Object.entries(cost)) G.res[k] -= v;
}
function upgradeCostFor(slot) {
  const t = slot.turret;
  const def = TURRET_DEFS[t.type];
  const cost = {};
  for (const [k, v] of Object.entries(def.upgradeCost)) cost[k] = Math.ceil(v * (1 + (t.level - 1) * 0.5));
  return cost;
}

// Calculate total resources invested in a turret (base cost + all upgrade costs)
function totalInvestedCost(slot) {
  const t = slot.turret;
  if (!t) return {};
  const def = TURRET_DEFS[t.type];
  const total = {};
  // Base build cost
  for (const [k, v] of Object.entries(def.cost)) total[k] = (total[k] || 0) + v;
  // Upgrade costs for each level gained (Lv1→Lv2, Lv2→Lv3, etc.)
  for (let lv = 1; lv < t.level; lv++) {
    for (const [k, v] of Object.entries(def.upgradeCost)) {
      total[k] = (total[k] || 0) + Math.ceil(v * (1 + (lv - 1) * 0.5));
    }
  }
  return total;
}

// Refund = half of total invested (rounded down)
function demolishRefund(slot) {
  const total = totalInvestedCost(slot);
  const refund = {};
  for (const [k, v] of Object.entries(total)) refund[k] = Math.floor(v / 2);
  return refund;
}

function demolishTurret(slotId) {
  const slot = G.ship.slots[slotId];
  if (!slot || !slot.turret) return false;
  const refund = demolishRefund(slot);
  // Add refund to resources
  for (const [k, v] of Object.entries(refund)) G.res[k] = (G.res[k] || 0) + v;
  const name = TURRET_DEFS[slot.turret.type].name;
  slot.turret = null;
  G.buildUI.demolishConfirm = null; // clear confirmation
  sfx('hit');
  notify(`${name}を解体 — 資材回収`);
  return true;
}

// ─── ENEMY SPAWN ────────────────────────────────────────
function spawnEnemy(type) {
  const def = ENEMY_DEFS[type];
  if (!def) return;
  // Spawn from random edge
  const spawnAngle = rand(0, TAU);
  const spawnDist = 550 + rand(0, 100);
  const ex = G.ship.x + Math.cos(spawnAngle) * spawnDist;
  const ey = G.ship.y + Math.sin(spawnAngle) * spawnDist;

  const orbitDir = Math.random() < 0.5 ? 1 : -1; // clockwise or counter
  const orbitAngle = ang(G.ship.x, G.ship.y, ex, ey); // angle FROM ship TO enemy

  const hpScale = G.waveHpScale || 1;
  // Orbit-type enemies get extra HP from W10+ (they're easier to kill)
  // Strafe/dive types keep base scaling so torpedoes remain avoidable
  const waveNum = (G.wave || 0) + 1;
  const orbitHpBonus = (def.behavior === 'orbit' && !def.isBoss && waveNum >= 10)
    ? 1 + (waveNum - 9) * 0.15  // +15% per wave past W9
    : 1;
  const scaledHp = Math.round(def.hp * hpScale * orbitHpBonus);
  const enemy = {
    type, x: ex, y: ey,
    hp: scaledHp, maxHp: scaledHp,
    speed: def.speed,
    torpedoDmg: def.torpedoDmg,
    size: def.size, color: def.color,
    drop: { ...def.drop }, score: def.score,
    stealth: def.stealth || false,
    stealthAlpha: def.stealth ? 0.15 : 1.0,
    slowTimer: 0, slowFactor: 1.0,
    jammerResist: def.jammerResist || 0,
    isBoss: def.isBoss || false,
    hitFlash: 0,
    angle: ang(ex, ey, G.ship.x, G.ship.y), // facing ship
    // Flight behavior state
    behavior: def.behavior,
    phase: 'approach', // approach | orbit | strafe | attack | retreat | dead
    orbitDir,
    orbitAngle,
    orbitsRemaining: def.orbits || 1,
    orbitRadius: def.orbitRadius || 160,
    strafeOffset: def.strafeOffset || 100,
    strafeTarget: null,
    phaseTimer: 0,
    torpedoReady: false,
    torpedoDropped: false,
    retreatAngle: 0,
    threatLevel: 0, // 0=safe, 1=about to fire
    bossLabel: def.isBoss ? 'BOSS' : null,
  };

  // Boss phase shield system
  if (def.isBoss) {
    const shieldHp = Math.round(scaledHp * 0.3); // each shield = 30% of boss HP
    enemy.shields = [
      { hp: shieldHp, maxHp: shieldHp, color: '#4488ff', label: 'PHASE 1' }, // blue
      { hp: shieldHp, maxHp: shieldHp, color: '#44cc66', label: 'PHASE 2' }, // green
      { hp: shieldHp, maxHp: shieldHp, color: '#ddbb33', label: 'PHASE 3' }, // yellow
    ];
    enemy.shieldIdx = 0;        // current shield being damaged
    enemy.phaseAttackTimer = 0; // timer until forced attack
    enemy.phaseAttackInterval = 12; // seconds to break each shield
    enemy.phaseBreakFlash = 0;  // visual feedback on shield break
    enemy.totalShieldHp = shieldHp * 3;
  }

  G.enemies.push(enemy);
}

// ─── BOSS PHASE DAMAGE SYSTEM ───────────────────────────
function applyDamageToEnemy(e, dmg) {
  if (e.shields && e.shieldIdx < e.shields.length) {
    // Damage current shield first
    const shield = e.shields[e.shieldIdx];
    const absorbed = Math.min(shield.hp, dmg);
    shield.hp -= absorbed;
    dmg -= absorbed;
    if (shield.hp <= 0) {
      // Shield broken! Reset attack timer, spawn reinforcements
      e.shieldIdx++;
      e.phaseAttackTimer = 0;
      e.phaseBreakFlash = 1.0;
      sfx('explode');
      addShake(4);
      // Spawn reinforcement enemies on shield break
      const waveNum = (G.wave || 0) + 1;
      const reinforceTypes = waveNum >= 20
        ? ['scoutDrone_jr', 'scoutDrone_jr', 'fastDrone_jr']
        : ['scoutDrone', 'scoutDrone', 'fastDrone'];
      for (const rType of reinforceTypes) {
        spawnEnemy(rType);
      }
      // Visual burst
      emitP(e.x, e.y, 30, {
        colors: [shield.color, '#ffffff'],
        spdMin: 80, spdMax: 250, szMin: 3, szMax: 8,
        lifeMin: 0.3, lifeMax: 0.8, type: 'spark',
      });
      // Announce — no phase labels, just short feedback
      if (e.shieldIdx < e.shields.length) {
        G.announce = { text: '◆ SHIELD BREAK', timer: 1.5 };
      } else {
        G.announce = { text: '☢ CORE EXPOSED', timer: 2.0 };
      }
    }
  }
  // Remaining damage goes to HP
  if (dmg > 0) e.hp -= dmg;
}

function updateBossPhase(e, dt) {
  if (!e.shields) return;
  if (e.phaseBreakFlash > 0) e.phaseBreakFlash -= dt * 2;
  if (e.shieldIdx >= e.shields.length) return; // all shields broken, core exposed

  // Timer counts up; if it reaches interval, boss fires a punishing torpedo barrage
  e.phaseAttackTimer += dt;
  if (e.phaseAttackTimer >= e.phaseAttackInterval) {
    e.phaseAttackTimer = 0;
    // Punishing attack: fire 5 spread torpedoes
    for (let i = 0; i < 5; i++) {
      const spread = (i - 2) * 50;
      const tgtX = G.ship.x + spread + rand(-20, 20);
      const tgtY = G.ship.y + rand(-15, 15);
      G.torpedoes.push({
        x: e.x, y: e.y,
        tx: tgtX, ty: tgtY,
        speed: 100,
        damage: Math.round(e.torpedoDmg / 3),
        hp: 25, maxHp: 25,
        life: 6.0, trail: [], hitFlash: 0,
      });
    }
    sfx('torpedo');
    addShake(5);
    G.announce = { text: '⚠ BOSS BARRAGE!', timer: 1.5 };
  }
}

// ─── TORPEDO (enemy attack) ─────────────────────────────
function dropTorpedo(enemy) {
  // Boss fires a spread of 3 torpedoes
  const torpCount = enemy.isBoss ? 3 : 1;
  for (let i = 0; i < torpCount; i++) {
    const spread = enemy.isBoss ? (i - 1) * 40 : 0; // -40, 0, +40
    const tgtX = G.ship.x + rand(-30, 30) + spread;
    const tgtY = G.ship.y + rand(-15, 15);
    // Slow torpedoes for interception window; heavier torpedoes faster
    const baseTorpSpeed = enemy.isBoss ? 100 : (enemy.torpedoDmg >= 40 ? 90 : 55);
    // Normal torpedo: 1 MG bullet kill; heavy (bomber): 1 burst; boss: tough
    const torpHp = enemy.isBoss ? 25 : (enemy.torpedoDmg >= 40 ? 15 : 4);
    G.torpedoes.push({
      x: enemy.x, y: enemy.y,
      tx: tgtX, ty: tgtY,
      speed: baseTorpSpeed,
      damage: enemy.isBoss ? Math.round(enemy.torpedoDmg / torpCount) : enemy.torpedoDmg,
      hp: torpHp,
      maxHp: torpHp,
      life: 6.0,
      trail: [],
      hitFlash: 0,
    });
  }
  sfx('torpedo');
  enemy.torpedoDropped = true;
}

// ─── BULLETS ────────────────────────────────────────────
function spawnBullet(x, y, angle, speed, damage, color, opts = {}) {
  G.bullets.push({
    x, y, angle, speed, damage, color,
    aoe: opts.aoe || 0,
    homing: opts.homing || false,
    target: opts.target || null,
    life: 2.0,
    trail: [],
  });
}

// ─── SCRAP ──────────────────────────────────────────────
function spawnScrap(x, y, resources) {
  for (const [key, amount] of Object.entries(resources)) {
    if (amount <= 0) continue;
    for (let i = 0; i < amount; i++) {
      G.scraps.push({
        x: x + rand(-25, 25), y: y + rand(-25, 25),
        vx: rand(-50, 50), vy: rand(-50, 50),
        type: key, value: 1,
        life: 20,
        size: rand(3, 6),
        rot: rand(0, TAU), rotSpd: rand(-3, 3),
      });
    }
  }
}

// ─── WAVES ──────────────────────────────────────────────
function genWaves() {
  return [
    // W1: gentle intro
    { groups: [{ type: 'scoutDrone', count: 6, interval: 1.8 }] },
    // W2: more scouts
    { groups: [{ type: 'scoutDrone', count: 10, interval: 1.2 }] },
    // W3: scouts + fast strafers
    { groups: [{ type: 'scoutDrone', count: 8, interval: 1.5 }, { type: 'fastDrone', count: 4, interval: 2.5 }] },
    // W4: fast drone swarm
    { groups: [{ type: 'fastDrone', count: 12, interval: 0.8 }] },
    // W5: BOSS + escorts
    { groups: [{ type: 'boss', count: 1, interval: 3.0 }, { type: 'scoutDrone', count: 6, interval: 1.5 }] },
    // W6: bombers intro — more scouts flooding in
    { groups: [{ type: 'fastDrone', count: 14, interval: 0.7 }, { type: 'bomber', count: 4, interval: 3.0 }, { type: 'scoutDrone', count: 8, interval: 0.9 }] },
    // W7: heavy drones + scout swarm
    { groups: [{ type: 'heavyDrone', count: 4, interval: 3.5 }, { type: 'scoutDrone', count: 18, interval: 0.5 }] },
    // W8: stealth + bombers + scouts
    { groups: [{ type: 'stealthDrone', count: 6, interval: 2.0 }, { type: 'bomber', count: 6, interval: 1.8 }, { type: 'scoutDrone', count: 10, interval: 0.7 }] },
    // W9: everything ramp — dense
    { groups: [{ type: 'fastDrone', count: 18, interval: 0.4 }, { type: 'heavyDrone', count: 5, interval: 2.5 }, { type: 'bomber', count: 5, interval: 2.0 }, { type: 'scoutDrone', count: 12, interval: 0.5 }] },
    // W10: BOSS + heavy escorts
    { groups: [{ type: 'boss', count: 1, interval: 3.0 }, { type: 'heavyDrone', count: 5, interval: 2.5 }, { type: 'bomber', count: 5, interval: 2.0 }, { type: 'scoutDrone', count: 10, interval: 0.6 }] },
    // W11: stealth swarm + orbit wall
    { groups: [{ type: 'stealthDrone', count: 12, interval: 1.0 }, { type: 'fastDrone', count: 10, interval: 0.8 }, { type: 'scoutDrone', count: 14, interval: 0.5 }] },
    // W12: bomber wave + scout flood
    { groups: [{ type: 'bomber', count: 10, interval: 1.5 }, { type: 'scoutDrone', count: 18, interval: 0.4 }] },
    // W13: heavy + stealth combo
    { groups: [{ type: 'heavyDrone', count: 8, interval: 2.0 }, { type: 'stealthDrone', count: 10, interval: 1.2 }, { type: 'scoutDrone', count: 12, interval: 0.5 }] },
    // W14: everything dense
    { groups: [{ type: 'scoutDrone', count: 22, interval: 0.3 }, { type: 'bomber', count: 8, interval: 1.5 }, { type: 'heavyDrone', count: 5, interval: 2.5 }] },
    // W15: BOSS + full mix
    { groups: [{ type: 'boss', count: 1, interval: 3.0 }, { type: 'fastDrone', count: 15, interval: 0.5 }, { type: 'bomber', count: 7, interval: 2.0 }, { type: 'stealthDrone', count: 6, interval: 2.5 }, { type: 'scoutDrone', count: 10, interval: 0.6 }] },
    // W16: fast chaos
    { groups: [{ type: 'fastDrone', count: 25, interval: 0.3 }, { type: 'bomber', count: 5, interval: 3.0 }, { type: 'scoutDrone', count: 15, interval: 0.4 }] },
    // W17: stealth bombers
    { groups: [{ type: 'stealthDrone', count: 15, interval: 0.8 }, { type: 'bomber', count: 10, interval: 1.5 }, { type: 'scoutDrone', count: 12, interval: 0.5 }] },
    // W18: heavy assault
    { groups: [{ type: 'heavyDrone', count: 10, interval: 1.5 }, { type: 'fastDrone', count: 14, interval: 0.6 }, { type: 'scoutDrone', count: 16, interval: 0.4 }] },
    // W19: calm before storm — scout flood
    { groups: [{ type: 'scoutDrone', count: 30, interval: 0.2 }, { type: 'stealthDrone', count: 10, interval: 1.2 }] },
    // W20: BOSS + jammer-resist debut!
    { groups: [{ type: 'boss', count: 1, interval: 3.0 }, { type: 'scoutDrone_jr', count: 10, interval: 1.5 }, { type: 'fastDrone_jr', count: 6, interval: 2.0 }, { type: 'bomber', count: 6, interval: 2.5 }, { type: 'scoutDrone', count: 12, interval: 0.5 }] },
    // W21: jammer-resist scouts mix
    { groups: [{ type: 'scoutDrone_jr', count: 14, interval: 0.7 }, { type: 'scoutDrone', count: 16, interval: 0.5 }, { type: 'fastDrone', count: 8, interval: 1.0 }] },
    // W22: fast JR rush
    { groups: [{ type: 'fastDrone_jr', count: 16, interval: 0.5 }, { type: 'bomber', count: 6, interval: 2.5 }, { type: 'stealthDrone', count: 8, interval: 1.5 }, { type: 'scoutDrone_jr', count: 10, interval: 0.6 }] },
    // W23: heavy JR + regulars
    { groups: [{ type: 'heavyDrone_jr', count: 5, interval: 3.0 }, { type: 'heavyDrone', count: 6, interval: 2.5 }, { type: 'scoutDrone_jr', count: 14, interval: 0.6 }] },
    // W24: bomber JR assault
    { groups: [{ type: 'bomber_jr', count: 8, interval: 1.5 }, { type: 'fastDrone_jr', count: 12, interval: 0.6 }, { type: 'stealthDrone', count: 8, interval: 1.2 }, { type: 'scoutDrone', count: 12, interval: 0.5 }] },
    // W25: BOSS + JR full mix
    { groups: [{ type: 'boss', count: 1, interval: 3.0 }, { type: 'scoutDrone_jr', count: 12, interval: 0.8 }, { type: 'bomber_jr', count: 6, interval: 2.0 }, { type: 'heavyDrone_jr', count: 5, interval: 2.5 }, { type: 'fastDrone_jr', count: 8, interval: 0.8 }] },
    // W26+: late-game templates (cycle with scaling)
    { groups: [{ type: 'fastDrone_jr', count: 20, interval: 0.4 }, { type: 'bomber_jr', count: 10, interval: 1.2 }, { type: 'heavyDrone', count: 8, interval: 2.0 }, { type: 'scoutDrone', count: 15, interval: 0.4 }] },
    { groups: [{ type: 'scoutDrone_jr', count: 20, interval: 0.3 }, { type: 'stealthDrone', count: 14, interval: 0.8 }, { type: 'bomber', count: 8, interval: 1.5 }, { type: 'heavyDrone_jr', count: 5, interval: 2.5 }] },
    { groups: [{ type: 'heavyDrone_jr', count: 8, interval: 1.5 }, { type: 'fastDrone_jr', count: 18, interval: 0.4 }, { type: 'bomber_jr', count: 8, interval: 1.5 }, { type: 'scoutDrone_jr', count: 15, interval: 0.4 }] },
  ];
}
const WAVES = genWaves();

function startWave(idx) {
  G.wave = idx;
  G.waveActive = true;
  G.spawnQueues = [];
  const w = WAVES[Math.min(idx, WAVES.length - 1)];
  const scale = idx >= WAVES.length ? 1 + (idx - WAVES.length + 1) * 0.3 : 1;
  // HP scales with wave index
  G.waveHpScale = 1 + idx * 0.1;

  // Build spawn queues from wave definition
  const groups = [...w.groups];

  // Inject boss on every 5th wave if not already in wave def
  const waveNum = idx + 1; // 1-indexed for display
  const isBossWave = waveNum % 5 === 0 && waveNum > 0;
  if (isBossWave && !groups.some(g => g.type === 'boss')) {
    groups.unshift({ type: 'boss', count: 1, interval: 3.0 });
  }

  for (const g of groups) {
    G.spawnQueues.push({
      type: g.type, remaining: Math.ceil(g.count * scale),
      interval: g.interval / Math.sqrt(scale), timer: rand(0.2, 1.0),
    });
  }

  // Boss announcement
  if (isBossWave || groups.some(g => g.type === 'boss')) {
    G.announce = { text: `⚠ WAVE ${waveNum} — BOSS`, timer: 3.0 };
  } else {
    G.announce = { text: `WAVE ${waveNum}`, timer: 2.5 };
  }
  sfx('wave');
}

// ─── MAIN UPDATE ────────────────────────────────────────
function update(dt) {
  G.time += dt;
  if (G.phase === 'title') return;
  // During gameover, only update particles (smoke/fire continues behind overlay)
  if (G.phase === 'gameover') {
    updateParticles(dt);
    return;
  }
  if (G.phase === 'building') {
    updateScraps(dt);
    updateParticles(dt); updateShake();
    return;
  }

  // === PLAYING / SINKING ===
  const isSinking = G.phase === 'sinking';
  if (!isSinking) {
    updateSpawns(dt);
    updateEnemyAI(dt);
    updateTurretAiming(dt);
    updateTurretFiring(dt);
    updateBullets(dt);
  }
  updateTorpedoes(dt);
  updateScraps(dt);
  updateParticles(dt);
  updateShake();
  if (G.dmgFlash > 0) G.dmgFlash -= dt;

  // Check ship death — enter sinking phase
  if (G.ship.hp <= 0 && G.phase === 'playing') {
    G.phase = 'sinking';
    G.sink = {
      timer: 0,           // seconds since death
      duration: 5.0,      // total sinking time before game over
      tilt: 0,            // roll angle (radians)
      yOffset: 0,         // how far ship has sunk
      opacity: 1.0,       // ship fade
      fireTimer: 0,       // fire particle timer
      smokeTimer: 0,      // smoke particle timer
      bubbleTimer: 0,     // bubble timer
      phase: 'explode',   // explode -> burn -> submerge
    };
    addShake(15);
    sfx('explode');
    G.announce = { text: '大 破', timer: 2.5, style: 'critical' };
    // Big initial explosion
    emitP(G.ship.x, G.ship.y, 150, {
      colors: ['#ff4444', '#ff8844', '#ffcc44', '#333', '#111'],
      spdMin: 40, spdMax: 400, szMin: 3, szMax: 14,
      lifeMin: 0.5, lifeMax: 2.5, type: 'debris',
    });
    emitP(G.ship.x, G.ship.y, 60, {
      colors: ['#ffcc44', '#fff', '#ff8844'],
      spdMin: 80, spdMax: 300, szMin: 2, szMax: 6,
      lifeMin: 0.2, lifeMax: 0.8, type: 'spark',
    });
  }

  // Sinking phase update
  if (G.phase === 'sinking' && G.sink) {
    const sk = G.sink;
    sk.timer += dt;

    // Phase transitions
    if (sk.timer < 1.0) {
      sk.phase = 'explode';
    } else if (sk.timer < 3.0) {
      sk.phase = 'burn';
    } else {
      sk.phase = 'submerge';
    }

    // Tilt: slowly roll to starboard
    const maxTilt = 0.25; // ~14 degrees
    sk.tilt = Math.min(sk.timer * 0.06, maxTilt);

    // Sink: accelerating downward (moderate pace so ship stays visible)
    const sinkSpeed = sk.timer < 1.5 ? 5 : 5 + (sk.timer - 1.5) * 14;
    sk.yOffset += sinkSpeed * dt;

    // Fade near the end — keep minimum visible for gameover background
    if (sk.timer > 3.5) {
      sk.opacity = Math.max(0.15, 1.0 - (sk.timer - 3.5) / 1.5);
    }

    // Fire particles during burn phase
    sk.fireTimer += dt;
    if (sk.phase === 'explode' || sk.phase === 'burn') {
      if (sk.fireTimer > 0.06) {
        sk.fireTimer = 0;
        const fx = G.ship.x + rand(-40, 30);
        const fy = G.ship.y + sk.yOffset + rand(-12, 8);
        emitP(fx, fy, rand(3, 8), {
          colors: ['#ff6622', '#ff9944', '#ffcc44'],
          spdMin: 15, spdMax: 60, szMin: 2, szMax: 6,
          lifeMin: 0.3, lifeMax: 0.9, type: 'spark', gravity: -40,
        });
      }
    }

    // Smoke
    sk.smokeTimer += dt;
    if (sk.smokeTimer > 0.1) {
      sk.smokeTimer = 0;
      const sx2 = G.ship.x + rand(-35, 25);
      const sy2 = G.ship.y + sk.yOffset + rand(-10, 5);
      emitP(sx2, sy2, rand(2, 5), {
        colors: ['#222', '#444', '#333'],
        spdMin: 10, spdMax: 40, szMin: 4, szMax: 12,
        lifeMin: 0.8, lifeMax: 2.5, gravity: -20,
      });
    }

    // Bubbles during submerge
    if (sk.phase === 'submerge') {
      sk.bubbleTimer += dt;
      if (sk.bubbleTimer > 0.08) {
        sk.bubbleTimer = 0;
        const bx = G.ship.x + rand(-50, 40);
        const bubbleY = G.ship.y + sk.yOffset + rand(-5, 15);
        emitP(bx, bubbleY, rand(1, 4), {
          colors: ['rgba(120,180,220,0.5)', 'rgba(150,200,240,0.3)'],
          spdMin: 15, spdMax: 50, szMin: 2, szMax: 7,
          lifeMin: 0.4, lifeMax: 1.2, gravity: -60,
        });
      }
      // Waterline foam — splash at the ship's original Y (surface)
      if (Math.random() < 0.3) {
        const foamX = G.ship.x + rand(-55, 45);
        emitP(foamX, G.ship.y, rand(2, 5), {
          colors: ['rgba(180,220,255,0.4)', 'rgba(200,240,255,0.25)', 'rgba(140,190,230,0.3)'],
          spdMin: 8, spdMax: 35, szMin: 2, szMax: 5,
          lifeMin: 0.3, lifeMax: 0.8, gravity: -15,
        });
      }
    }

    // Secondary explosions during explode phase
    if (sk.phase === 'explode' && Math.random() < 0.15) {
      const ex = G.ship.x + rand(-45, 35);
      const ey = G.ship.y + sk.yOffset + rand(-15, 15);
      emitP(ex, ey, rand(10, 25), {
        colors: ['#ff4444', '#ff8844', '#ffcc44'],
        spdMin: 30, spdMax: 150, szMin: 2, szMax: 8,
        lifeMin: 0.2, lifeMax: 0.7, type: 'spark',
      });
      addShake(rand(2, 5));
      sfx('explode');
    }

    // Transition to gameover
    if (sk.timer >= sk.duration) {
      G.phase = 'gameover';
      G.announce = null; // clear sinking announce
      // Keep sink data for background rendering
    }
  }

  // Check wave complete
  if (G.waveActive) {
    const allSpawned = G.spawnQueues.every(q => q.remaining <= 0);
    if (allSpawned && G.enemies.length === 0 && G.torpedoes.length === 0) {
      G.waveActive = false;
      setTimeout(() => {
        if (G.phase === 'playing') {
          G.phase = 'building';
          G.buildUI = { selectedType: null, selectedSlot: null, mode: 'main', demolishConfirm: null };
          notify('改修フェーズ — 砲台を設置・強化せよ');
        }
      }, 1200);
    }
  }
}

function updateSpawns(dt) {
  for (const q of G.spawnQueues) {
    if (q.remaining <= 0) continue;
    q.timer -= dt;
    if (q.timer <= 0) {
      spawnEnemy(q.type);
      q.remaining--;
      q.timer = q.interval;
    }
  }
}

// ─── ENEMY AI: Realistic flight patterns ────────────────
function updateEnemyAI(dt) {
  const sx = G.ship.x, sy = G.ship.y;

  for (let i = G.enemies.length - 1; i >= 0; i--) {
    const e = G.enemies[i];
    const spd = e.speed * e.slowFactor;

    // Slow timer
    if (e.slowTimer > 0) { e.slowTimer -= dt; if (e.slowTimer <= 0) e.slowFactor = 1.0; }
    if (e.hitFlash > 0) e.hitFlash -= dt * 5;

    // Stealth
    if (e.stealth) {
      const d = dist(e.x, e.y, sx, sy);
      e.stealthAlpha = d < 200 ? lerp(0.15, 1.0, 1 - d / 200) : 0.15;
    }

    const dToShip = dist(e.x, e.y, sx, sy);

    // ── Threat level computation (0=safe, 1=imminent torpedo) ──
    if (e.phase === 'attack') {
      e.threatLevel = 1.0;
    } else if (e.phase === 'orbit') {
      const def = ENEMY_DEFS[e.type];
      const totalOrbits = def.orbits || 1;
      const progress = (totalOrbits - e.orbitsRemaining) / totalOrbits;
      // Also factor in phaseTimer within current orbit
      const spd2 = e.speed * e.slowFactor;
      const orbitPeriod = (TAU * e.orbitRadius) / Math.max(spd2, 1);
      const orbitFrac = orbitPeriod > 0 ? e.phaseTimer / orbitPeriod : 0;
      e.threatLevel = clamp(progress + orbitFrac / totalOrbits, 0, 0.95);
    } else if (e.phase === 'strafe') {
      // Threat rises as phaseTimer approaches 1.5s and drone nears ship
      const timeThreat = clamp(e.phaseTimer / 1.5, 0, 1);
      const distThreat = clamp(1 - dToShip / (e.strafeOffset + 150), 0, 1);
      e.threatLevel = clamp(Math.max(timeThreat, distThreat), 0, e.torpedoDropped ? 0.2 : 1.0);
    } else if (e.phase === 'retreat' || e.phase === 'approach') {
      // Slowly decay threat when retreating/approaching
      e.threatLevel = Math.max(0, e.threatLevel - dt * 0.8);
    }

    // State machine
    switch (e.phase) {
      case 'approach': {
        // Fly toward orbit radius
        const targetDist = e.behavior === 'orbit' ? e.orbitRadius + 40 : e.strafeOffset + 80;
        if (dToShip > targetDist) {
          // Fly toward ship
          const toShip = ang(e.x, e.y, sx, sy);
          e.angle = shortAngle(e.angle, toShip, 3.0 * dt);
          e.x += Math.cos(e.angle) * spd * dt;
          e.y += Math.sin(e.angle) * spd * dt;
        } else {
          // Arrived — transition
          if (e.behavior === 'orbit') {
            e.phase = 'orbit';
            e.orbitAngle = ang(sx, sy, e.x, e.y);
          } else {
            e.phase = 'strafe';
            e.phaseTimer = 0; // reset timer for torpedo delay
            // Pick a strafe line across the ship
            const crossAngle = ang(e.x, e.y, sx, sy) + rand(-0.3, 0.3);
            e.angle = crossAngle;
            e.strafeTarget = {
              x: sx + Math.cos(crossAngle) * 600,
              y: sy + Math.sin(crossAngle) * 600,
            };
          }
        }
        break;
      }

      case 'orbit': {
        // Circle around the ship
        const orbitSpd = (spd / e.orbitRadius) * e.orbitDir;
        e.orbitAngle += orbitSpd * dt;
        const tx = sx + Math.cos(e.orbitAngle) * e.orbitRadius;
        const ty = sy + Math.sin(e.orbitAngle) * e.orbitRadius;
        const toTarget = ang(e.x, e.y, tx, ty);
        e.angle = shortAngle(e.angle, toTarget, 4.0 * dt);
        e.x += Math.cos(e.angle) * spd * dt;
        e.y += Math.sin(e.angle) * spd * dt;

        e.phaseTimer += dt;
        const orbitPeriod = (TAU * e.orbitRadius) / spd;
        if (e.phaseTimer >= orbitPeriod) {
          e.orbitsRemaining--;
          e.phaseTimer = 0;
          if (e.orbitsRemaining <= 0) {
            e.phase = 'attack';
            e.torpedoReady = true;
          }
        }
        break;
      }

      case 'strafe': {
        // Fly across the ship in a line
        if (e.strafeTarget) {
          const toT = ang(e.x, e.y, e.strafeTarget.x, e.strafeTarget.y);
          e.angle = shortAngle(e.angle, toT, 3.0 * dt);
        }
        e.x += Math.cos(e.angle) * spd * 1.3 * dt;
        e.y += Math.sin(e.angle) * spd * 1.3 * dt;

        e.phaseTimer += dt;
        // Drop torpedo early (distance-based) so player has interception window
        // regardless of jammer slow. Fires when within 250px of ship.
        if (!e.torpedoDropped && dToShip < 250 && e.phaseTimer > 0.3) {
          dropTorpedo(e);
        }

        // After passing through, retreat
        if (dToShip > 500 && e.torpedoDropped) {
          // Circle back for another pass
          e.phase = 'approach';
          e.torpedoDropped = false;
        } else if (dist(e.x, e.y, e.strafeTarget?.x || 0, e.strafeTarget?.y || 0) < 60) {
          e.phase = 'retreat';
          e.retreatAngle = e.angle;
          e.phaseTimer = 0;
        }
        break;
      }

      case 'attack': {
        // Dive toward ship to drop torpedo
        const toShip = ang(e.x, e.y, sx, sy);
        e.angle = shortAngle(e.angle, toShip, 3.0 * dt);
        e.x += Math.cos(e.angle) * spd * 1.5 * dt;
        e.y += Math.sin(e.angle) * spd * 1.5 * dt;

        if (dToShip < 80 && e.torpedoReady && !e.torpedoDropped) {
          dropTorpedo(e);
          e.torpedoReady = false;
        }

        // After dropping or getting close, retreat
        if (e.torpedoDropped || dToShip < 40) {
          e.phase = 'retreat';
          e.retreatAngle = ang(sx, sy, e.x, e.y); // away from ship
          e.phaseTimer = 0;
        }
        break;
      }

      case 'retreat': {
        // Fly away then loop back
        e.angle = shortAngle(e.angle, e.retreatAngle, 2.5 * dt);
        e.x += Math.cos(e.angle) * spd * dt;
        e.y += Math.sin(e.angle) * spd * dt;
        e.phaseTimer += dt;

        if (e.phaseTimer > 3.0 || dToShip > 600) {
          // Come back for another pass
          e.phase = 'approach';
          e.orbitsRemaining = 1;
          e.torpedoDropped = false;
          e.torpedoReady = false;
          e.phaseTimer = 0;
        }
        break;
      }
    }

    // Boss phase system
    if (e.isBoss) updateBossPhase(e, dt);

    // Remove if dead
    if (e.hp <= 0) {
      G.score += e.score; G.kills++;
      emitP(e.x, e.y, 35, {
        colors: ['#ff6644', '#ffaa44', '#ffdd66', '#444', '#666'],
        spdMin: 50, spdMax: 220, szMin: 2, szMax: 9,
        lifeMin: 0.3, lifeMax: 1.4, type: 'debris',
      });
      emitP(e.x, e.y, 15, {
        colors: ['#ffcc44', '#fff'],
        spdMin: 100, spdMax: 350, szMin: 1, szMax: 3,
        lifeMin: 0.1, lifeMax: 0.4, type: 'spark',
      });
      sfx('explode'); addShake(3);
      spawnScrap(e.x, e.y, e.drop);
      G.enemies.splice(i, 1);
    }
  }
}

// ─── TURRET AIMING (pointer-driven) ─────────────────────
function updateTurretAiming(dt) {
  const ship = G.ship;
  const activePointers = [...pointers.values()];

  // Collect world positions of pointers
  const ptrWorld = activePointers.map(p => screenToWorld(p.x, p.y));

  // Collect active turrets with world positions
  const turretInfos = [];
  for (const slot of ship.slots) {
    if (!slot.turret || slot.turret.buildAnim > 0) continue;
    const wx = ship.x + slot.rx;
    const wy = ship.y + slot.ry;
    turretInfos.push({ slot, turret: slot.turret, wx, wy, def: TURRET_DEFS[slot.turret.type] });
  }
  if (turretInfos.length === 0) return;

  if (ptrWorld.length === 0) {
    // No input — turrets hold their current angle (no auto-aim)
    return;
  }

  // Assign pointers to turrets
  // Rule: each pointer claims the closest turrets that can aim at it.
  // If more turrets than pointers, excess turrets aim at nearest pointer.
  // If more pointers than turrets, turrets aim at earliest (first) pointer.

  // For each turret, check which pointers are within its arc
  // Then assign greedily: earliest pointer first

  // Simple approach: sort pointers by startTime (earliest first)
  const sortedPtrs = [...activePointers].sort((a, b) => a.startTime - b.startTime);
  const sortedPtrWorld = sortedPtrs.map(p => screenToWorld(p.x, p.y));

  // Track which turrets have been assigned
  const assigned = new Set();

  for (let pi = 0; pi < sortedPtrWorld.length; pi++) {
    const pw = sortedPtrWorld[pi];

    // Find closest unassigned turrets that can aim at this pointer
    const candidates = turretInfos
      .filter(t => !assigned.has(t.slot.id))
      .map(t => {
        const wantAngle = ang(t.wx, t.wy, pw.x, pw.y);
        const arcDiff = Math.abs(angleDiff(t.slot.baseFacing, wantAngle));
        const inArc = arcDiff <= t.def.arcLimit;
        const d = dist(t.wx, t.wy, pw.x, pw.y);
        return { ...t, wantAngle, inArc, d };
      })
      .filter(t => t.inArc)
      .sort((a, b) => a.d - b.d);

    if (candidates.length === 0) continue;

    // If this is the only pointer, all reachable turrets aim here
    if (sortedPtrWorld.length === 1) {
      for (const c of candidates) {
        c.turret.targetAngle = c.wantAngle;
        assigned.add(c.slot.id);
      }
    } else {
      // Multi-pointer: assign closest turret(s) to this pointer
      // Assign at least one; try to split evenly
      const share = Math.max(1, Math.ceil(turretInfos.length / sortedPtrWorld.length));
      let count = 0;
      for (const c of candidates) {
        if (count >= share) break;
        c.turret.targetAngle = c.wantAngle;
        assigned.add(c.slot.id);
        count++;
      }
    }
  }

  // Unassigned turrets: aim at nearest pointer within arc
  for (const t of turretInfos) {
    if (assigned.has(t.slot.id)) continue;
    let best = null, bestD = Infinity;
    for (const pw of sortedPtrWorld) {
      const wa = ang(t.wx, t.wy, pw.x, pw.y);
      const arcDiff = Math.abs(angleDiff(t.slot.baseFacing, wa));
      if (arcDiff > t.def.arcLimit) continue;
      const d = dist(t.wx, t.wy, pw.x, pw.y);
      if (d < bestD) { bestD = d; best = wa; }
    }
    if (best !== null) t.turret.targetAngle = best;
    // Otherwise hold current angle
  }

  // Rotate turrets toward target angle (slow rotation!)
  for (const t of turretInfos) {
    const rotSpeed = t.def.rotSpeed * 60; // per-second
    // Clamp target within arc
    const arcDiff = angleDiff(t.slot.baseFacing, t.turret.targetAngle);
    const clampedTarget = t.slot.baseFacing + clamp(arcDiff, -t.def.arcLimit, t.def.arcLimit);
    t.turret.targetAngle = clampedTarget;

    t.turret.angle = shortAngle(t.turret.angle, t.turret.targetAngle, rotSpeed * dt);

    // Recoil recovery
    if (t.turret.recoil > 0) t.turret.recoil -= dt * 10;
  }
}

// ─── TURRET FIRING ──────────────────────────────────────
function updateTurretFiring(dt) {
  const ship = G.ship;
  const activePointers = [...pointers.values()];
  const hasTouchInput = activePointers.length > 0;

  for (const slot of ship.slots) {
    const t = slot.turret;
    if (!t || t.buildAnim > 0) {
      if (t) { t.buildAnim -= dt * 2; if (t.buildAnim < 0) t.buildAnim = 0; }
      continue;
    }
    const def = TURRET_DEFS[t.type];
    const lv = t.level;
    const wx = ship.x + slot.rx;
    const wy = ship.y + slot.ry;

    t.cooldown -= dt;
    t.burstTimer -= dt;

    // Only fire if pointer is active (player is aiming)
    if (!hasTouchInput) continue;

    // Check if any enemy is in the direction we're actually facing and in range
    const range = turretStat(def, lv, 'range');
    const dmg = turretStat(def, lv, 'damage');
    const cd = turretStat(def, lv, 'burstCooldown');

    // Find a target in the direction we're aiming (within a cone)
    let targetInCone = false;
    for (const e of G.enemies) {
      if (e.stealth && e.stealthAlpha < 0.4) continue;
      const d = dist(wx, wy, e.x, e.y);
      if (d > range) continue;
      const toEnemy = ang(wx, wy, e.x, e.y);
      const diff = Math.abs(angleDiff(t.angle, toEnemy));
      if (diff < 20 * DEG) { targetInCone = true; break; }
    }
    // Also check if any torpedo is in the aiming cone (shootable torpedoes)
    if (!targetInCone) {
      for (const torp of G.torpedoes) {
        const d = dist(wx, wy, torp.x, torp.y);
        if (d > range) continue;
        const toTorp = ang(wx, wy, torp.x, torp.y);
        const diff = Math.abs(angleDiff(t.angle, toTorp));
        if (diff < 20 * DEG) { targetInCone = true; break; }
      }
    }

    // Jammer: AoE slow
    if (t.type === 'jammer') {
      if (t.cooldown <= 0 && hasTouchInput) {
        let hit = false;
        for (const e of G.enemies) {
          const d = dist(wx, wy, e.x, e.y);
          if (d < range) {
            // Jammer resistance: reduce slow effectiveness
            const resist = e.jammerResist || 0;
            const effectiveSlow = lerp(def.slowFactor, 1.0, resist);
            const effectiveDuration = def.slowDuration * (1 - resist);
            if (effectiveDuration > 0.2) { // skip if almost fully resisted
              e.slowFactor = effectiveSlow;
              e.slowTimer = effectiveDuration;
            }
            hit = true;
          }
        }
        if (hit) {
          emitP(wx, wy, 10, {
            colors: ['#b088ff', '#8866dd'],
            spdMin: 80, spdMax: 200, szMin: 2, szMax: 4,
            lifeMin: 0.3, lifeMax: 0.6, gravity: 0,
          });
          // Pulse ring
          emitP(wx, wy, 1, {
            color: '#b088ff', spdMin: 0, spdMax: 0,
            szMin: range * 0.8, szMax: range, lifeMin: 0.5, lifeMax: 0.5,
            type: 'ring', gravity: 0,
          });
          sfx('jammer');
        }
        t.cooldown = cd;
      }
      continue;
    }

    // Only fire when aiming close enough to an enemy
    if (!targetInCone) continue;

    // Burst fire
    if (t.cooldown <= 0) {
      if (t.burstCount < def.burstSize) {
        if (t.burstTimer <= 0) {
          const a = t.angle + rand(-def.spread, def.spread);
          t.recoil = 1.0;

          if (def.homing) {
            // Find closest enemy for homing
            let closest = null, cd2 = Infinity;
            for (const e of G.enemies) {
              const d = dist(wx, wy, e.x, e.y);
              if (d < range && d < cd2) { cd2 = d; closest = e; }
            }
            spawnBullet(wx, wy, a, def.bulletSpeed, dmg, def.tracerCol, { homing: true, target: closest });
            sfx('missile');
          } else {
            spawnBullet(wx, wy, a, def.bulletSpeed, dmg, def.tracerCol, { aoe: def.aoe || 0 });
            emitP(wx + Math.cos(a) * 12, wy + Math.sin(a) * 12, 3, {
              angle: a, spread: 0.3,
              colors: ['#ffdd44', '#ffaa22', '#fff'],
              spdMin: 150, spdMax: 300, szMin: 1, szMax: 3,
              lifeMin: 0.04, lifeMax: 0.1, type: 'spark', gravity: 0,
            });
            sfx(t.type === 'flak' ? 'flak' : 'mg');
          }

          t.burstCount++;
          t.burstTimer = def.burstDelay;
        }
      } else {
        t.burstCount = 0;
        t.cooldown = cd;
      }
    }
  }
}

// ─── BULLETS ────────────────────────────────────────────
function updateBullets(dt) {
  for (let i = G.bullets.length - 1; i >= 0; i--) {
    const b = G.bullets[i];
    if (b.homing && b.target && b.target.hp > 0) {
      const ta = ang(b.x, b.y, b.target.x, b.target.y);
      b.angle = shortAngle(b.angle, ta, 6 * dt);
    }
    b.x += Math.cos(b.angle) * b.speed * dt;
    b.y += Math.sin(b.angle) * b.speed * dt;
    b.life -= dt;
    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > 8) b.trail.shift();

    if (b.life <= 0) { G.bullets.splice(i, 1); continue; }

    let hit = false;

    // Check bullet vs torpedoes (shootable torpedoes!)
    for (const torp of G.torpedoes) {
      if (dist(b.x, b.y, torp.x, torp.y) < 18) {
        torp.hp -= b.damage;
        torp.hitFlash = 0.5;
        hit = true;
        emitP(b.x, b.y, 4, {
          angle: b.angle + PI, spread: 1.0,
          colors: ['#ff8844', '#ffcc44'], spdMin: 40, spdMax: 100,
          szMin: 1, szMax: 2, lifeMin: 0.05, lifeMax: 0.15, type: 'spark', gravity: 0,
        });
        break;
      }
    }

    // Check bullet vs enemies
    if (!hit) {
      for (const e of G.enemies) {
        if (dist(b.x, b.y, e.x, e.y) < e.size + 4) {
          applyDamageToEnemy(e, b.damage);
          e.hitFlash = 1.0;
          hit = true;
          emitP(b.x, b.y, 5, {
            angle: b.angle + PI, spread: 0.8,
            colors: ['#ffcc44', '#ff8844'], spdMin: 50, spdMax: 150,
            szMin: 1, szMax: 3, lifeMin: 0.08, lifeMax: 0.25, type: 'spark', gravity: 0,
          });
          if (b.aoe > 0) {
            for (const e2 of G.enemies) {
              if (e2 === e) continue;
              const d2 = dist(b.x, b.y, e2.x, e2.y);
              if (d2 < b.aoe) { applyDamageToEnemy(e2, b.damage * (1 - d2 / b.aoe) * 0.5); e2.hitFlash = 0.5; }
            }
            emitP(b.x, b.y, 20, {
              colors: ['#ff6644', '#ffaa44', '#ffdd66'],
              spdMin: 40, spdMax: 120, szMin: 3, szMax: 8,
              lifeMin: 0.2, lifeMax: 0.5, gravity: 0,
            });
            addShake(2); sfx('explode');
          }
          break;
        }
      }
    }
    if (hit) G.bullets.splice(i, 1);
  }
}

// ─── TORPEDOES ──────────────────────────────────────────
function updateTorpedoes(dt) {
  for (let i = G.torpedoes.length - 1; i >= 0; i--) {
    const t = G.torpedoes[i];
    if (t.hitFlash > 0) t.hitFlash -= dt * 5;

    // Torpedo shot down by player!
    if (t.hp <= 0) {
      emitP(t.x, t.y, 20, {
        colors: ['#ff8844', '#ffcc44', '#ffdd66', '#fff'],
        spdMin: 60, spdMax: 200, szMin: 2, szMax: 6,
        lifeMin: 0.2, lifeMax: 0.6, type: 'debris', gravity: 0,
      });
      emitP(t.x, t.y, 10, {
        colors: ['#4488cc', '#66aaee'],
        spdMin: 30, spdMax: 100, szMin: 1, szMax: 4,
        lifeMin: 0.1, lifeMax: 0.3, type: 'circle',
      });
      sfx('explode');
      addShake(1.5);
      G.score += 5; // small reward for shooting down torpedoes
      G.torpedoes.splice(i, 1);
      continue;
    }

    const a = ang(t.x, t.y, t.tx, t.ty);
    t.x += Math.cos(a) * t.speed * dt;
    t.y += Math.sin(a) * t.speed * dt;
    t.life -= dt;
    t.trail.push({ x: t.x, y: t.y });
    if (t.trail.length > 12) t.trail.shift();

    const d = dist(t.x, t.y, t.tx, t.ty);
    if (d < 20 || t.life <= 0) {
      // Impact!
      if (d < 80) {
        G.ship.hp -= t.damage;
        G.dmgFlash = 0.4;
        addShake(6);
        sfx('hit');
        emitP(t.x, t.y, 30, {
          colors: ['#ff4444', '#ff8844', '#ffcc44', '#4488ff'],
          spdMin: 80, spdMax: 280, szMin: 2, szMax: 8,
          lifeMin: 0.3, lifeMax: 1.0, type: 'circle', gravity: 0,
        });
        // Water splash
        emitP(t.x, t.y, 15, {
          colors: ['#4488cc', '#66aaee', '#88ccff'],
          spdMin: 60, spdMax: 200, szMin: 2, szMax: 6,
          lifeMin: 0.2, lifeMax: 0.6, type: 'circle',
        });
      }
      G.torpedoes.splice(i, 1);
    }
  }
}

// ─── SCRAPS (auto-collect) ──────────────────────────────
function updateScraps(dt) {
  for (let i = G.scraps.length - 1; i >= 0; i--) {
    const s = G.scraps[i];
    s.life -= dt;
    s.rot += s.rotSpd * dt;
    if (s.life <= 0) { G.scraps.splice(i, 1); continue; }

    // Always pull toward ship (auto-collect)
    const d = dist(s.x, s.y, G.ship.x, G.ship.y);
    const a = ang(s.x, s.y, G.ship.x, G.ship.y);
    // Gentle pull that increases as scrap ages (so it gets collected)
    const age = 20 - s.life; // 0 at spawn, 20 at max age
    const pull = 150 + age * 40 + (d < 120 ? (120 - d) * 8 : 0);
    s.vx += Math.cos(a) * pull * dt;
    s.vy += Math.sin(a) * pull * dt;
    s.vx *= 0.95; s.vy *= 0.95;
    s.x += s.vx * dt; s.y += s.vy * dt;

    if (d < 30) {
      G.res[s.type] = (G.res[s.type] || 0) + s.value;
      G.scraps.splice(i, 1);
      sfx('pickup');
    }
  }
}

// ─── NOTIFICATIONS ──────────────────────────────────────
function notify(text) { G.notifications.push({ text, timer: 3.5 }); }

// ─── RENDER ─────────────────────────────────────────────
function render() {
  ctx.clearRect(0, 0, W, H);
  if (G.phase === 'title') { renderTitle(); return; }

  ctx.save();
  ctx.translate(CX - G.ship.x + shakeOx, CY - G.ship.y + shakeOy);

  renderOcean();
  renderScraps();
  renderTorpedoes();
  renderShip();
  renderEnemies();
  renderBullets();
  drawParticles();

  // ─── VISUAL AIM FEEDBACK ──────────────────────────────
  if (pointers.size > 0 && G.phase === 'playing') {
    const activePointers = [...pointers.values()];
    const sortedPtrs = [...activePointers].sort((a, b) => a.startTime - b.startTime);
    const ptrWorlds = sortedPtrs.map(p => screenToWorld(p.x, p.y));

    for (const slot of G.ship.slots) {
      if (!slot.turret || slot.turret.buildAnim > 0) continue;
      const t = slot.turret;
      const def = TURRET_DEFS[t.type];
      const wx = G.ship.x + slot.rx;
      const wy = G.ship.y + slot.ry;
      const range = turretStat(def, t.level, 'range');

      // — (A) Fan-shaped firing arc (turret's movable range) —
      const arcStart = slot.baseFacing - def.arcLimit;
      const arcEnd = slot.baseFacing + def.arcLimit;
      const arcR = range * 0.45; // compact arc hint
      ctx.save();
      ctx.globalAlpha = 0.025;
      ctx.fillStyle = '#4af0c0';
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.arc(wx, wy, arcR, arcStart, arcEnd);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // Arc outline
      ctx.strokeStyle = 'rgba(74,240,192,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(wx, wy, arcR, arcStart, arcEnd);
      ctx.stroke();
      // Radial lines at arc edges
      ctx.strokeStyle = 'rgba(74,240,192,0.08)';
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.lineTo(wx + Math.cos(arcStart) * arcR, wy + Math.sin(arcStart) * arcR);
      ctx.moveTo(wx, wy);
      ctx.lineTo(wx + Math.cos(arcEnd) * arcR, wy + Math.sin(arcEnd) * arcR);
      ctx.stroke();

      // — Find which pointer this turret is tracking —
      let assignedPtr = null;
      let bestD = Infinity;
      for (const pw of ptrWorlds) {
        const wantAngle = ang(wx, wy, pw.x, pw.y);
        const arcDiff = Math.abs(angleDiff(slot.baseFacing, wantAngle));
        if (arcDiff > def.arcLimit) continue;
        const d = dist(wx, wy, pw.x, pw.y);
        if (d < bestD) { bestD = d; assignedPtr = pw; }
      }

      if (assignedPtr) {
        const wantAngle = ang(wx, wy, assignedPtr.x, assignedPtr.y);
        const aimDiff = Math.abs(angleDiff(t.angle, wantAngle));
        // Convergence factor: 1 when misaligned, 0 when aligned
        const convergence = clamp(aimDiff / (15 * DEG), 0, 1);

        // — (B) Thin line from tap position to turret ("desire line") —
        const lineAlpha = 0.12 + convergence * 0.18; // brighter when misaligned
        ctx.save();
        ctx.strokeStyle = `rgba(74,240,192,${lineAlpha})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(wx, wy);
        ctx.lineTo(assignedPtr.x, assignedPtr.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // Small reticle at tap position
        ctx.save();
        ctx.strokeStyle = `rgba(74,240,192,${lineAlpha})`;
        ctx.lineWidth = 1;
        const retSz = 5;
        ctx.beginPath();
        ctx.moveTo(assignedPtr.x - retSz, assignedPtr.y);
        ctx.lineTo(assignedPtr.x + retSz, assignedPtr.y);
        ctx.moveTo(assignedPtr.x, assignedPtr.y - retSz);
        ctx.lineTo(assignedPtr.x, assignedPtr.y + retSz);
        ctx.stroke();
        ctx.restore();

        // — (C) Current aim direction indicator (short solid line from turret) —
        const aimLen = 28 + convergence * 12; // slightly longer when tracking
        const aimAlpha = 0.2 + convergence * 0.35;
        ctx.strokeStyle = `rgba(74,240,192,${aimAlpha})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(wx, wy);
        ctx.lineTo(wx + Math.cos(t.angle) * aimLen, wy + Math.sin(t.angle) * aimLen);
        ctx.stroke();

        // Small dot at the tip of aim direction
        if (convergence > 0.15) {
          ctx.fillStyle = `rgba(74,240,192,${aimAlpha * 0.7})`;
          ctx.beginPath();
          ctx.arc(wx + Math.cos(t.angle) * aimLen, wy + Math.sin(t.angle) * aimLen, 2, 0, TAU);
          ctx.fill();
        }
      } else {
        // Turret can't reach any pointer — show it's out of arc
        // Dim the turret area slightly and show a subtle 'X' or no-go indicator
        ctx.save();
        ctx.globalAlpha = 0.15;
        ctx.strokeStyle = '#ff6644';
        ctx.lineWidth = 1.5;
        const xSz = 6;
        ctx.beginPath();
        ctx.moveTo(wx - xSz, wy - xSz); ctx.lineTo(wx + xSz, wy + xSz);
        ctx.moveTo(wx + xSz, wy - xSz); ctx.lineTo(wx - xSz, wy + xSz);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  ctx.restore();

  // Overlays
  if (G.dmgFlash > 0) {
    ctx.fillStyle = `rgba(255,40,40,${G.dmgFlash * 0.3})`;
    ctx.fillRect(0, 0, W, H);
  }
  renderHUD();
  if (G.phase === 'building') renderBuildUI();
  if (G.phase === 'gameover') renderGameOver();
  renderAnnounce();
  renderNotifs();
  renderDebug();
}

function renderOcean() {
  const l = G.ship.x - CX - 80, t2 = G.ship.y - CY - 80;
  const r = G.ship.x + CX + 80, b = G.ship.y + CY + 80;
  ctx.fillStyle = '#0a1628';
  ctx.fillRect(l, t2, r - l, b - t2);
  // Waves
  const time = G.time;
  ctx.strokeStyle = 'rgba(120,180,255,0.06)';
  ctx.lineWidth = 1;
  const gs = 50;
  const sx = Math.floor(l / gs) * gs;
  for (let y = Math.floor(t2 / gs) * gs; y < b; y += gs) {
    ctx.beginPath();
    for (let x = sx; x < r; x += 4) {
      const w = Math.sin(x * 0.018 + time * 0.7) * 5 + Math.sin(x * 0.008 + y * 0.005 + time * 0.4) * 7;
      x === sx ? ctx.moveTo(x, y + w) : ctx.lineTo(x, y + w);
    }
    ctx.stroke();
  }
  // Grid
  ctx.strokeStyle = 'rgba(60,100,160,0.04)';
  ctx.lineWidth = 0.5;
  for (let x = sx; x < r; x += gs * 3) { ctx.beginPath(); ctx.moveTo(x, t2); ctx.lineTo(x, b); ctx.stroke(); }
  for (let y = Math.floor(t2 / gs) * gs; y < b; y += gs * 3) { ctx.beginPath(); ctx.moveTo(l, y); ctx.lineTo(r, y); ctx.stroke(); }
}

function renderShip() {
  const s = G.ship;
  const sk = G.sink;
  const sinking = (G.phase === 'sinking' || G.phase === 'gameover') && sk;

  ctx.save();

  // Sinking transformations
  if (sinking) {
    ctx.globalAlpha = sk.opacity;
    ctx.translate(s.x, s.y + sk.yOffset);
    ctx.rotate(sk.tilt);
  } else {
    ctx.translate(s.x, s.y);
  }

  // Wake (hide when sinking)
  if (!sinking) {
    ctx.fillStyle = 'rgba(150,200,255,0.025)';
    for (let i = 0; i < 5; i++) {
      const off = -i * 22 - 60, sp = 10 + i * 6;
      ctx.beginPath(); ctx.moveTo(off, 0); ctx.lineTo(off - 28, -sp); ctx.lineTo(off - 28, sp); ctx.closePath(); ctx.fill();
    }
  }

  // Hull shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); shipPath(ctx, 3, 3, s.w, s.h); ctx.fill();
  // Hull
  const hg = ctx.createLinearGradient(0, -s.h / 2, 0, s.h / 2);
  hg.addColorStop(0, '#4a5a6e'); hg.addColorStop(0.5, '#3a4a5c'); hg.addColorStop(1, '#2a3a4c');
  ctx.fillStyle = hg;
  ctx.beginPath(); shipPath(ctx, 0, 0, s.w, s.h); ctx.fill();
  ctx.strokeStyle = 'rgba(100,140,180,0.25)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); shipPath(ctx, 0, 0, s.w, s.h); ctx.stroke();

  // Deck
  ctx.fillStyle = 'rgba(80,100,120,0.4)'; ctx.fillRect(-22, -8, 50, 16);
  ctx.fillStyle = '#5a6a7e'; ctx.fillRect(-10, -6, 20, 12);
  ctx.fillStyle = '#6a7a8e'; ctx.fillRect(-8, -5, 16, 10);

  // Reactor pulse (disabled when sinking)
  if (!sinking) {
    const rp = 0.5 + Math.sin(G.time * 3) * 0.2;
    ctx.fillStyle = `rgba(74,240,192,${rp * 0.25})`; ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill();
    ctx.fillStyle = `rgba(74,240,192,${rp * 0.5})`; ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill();
  } else {
    // Dead reactor — dim red glow
    const rp2 = 0.2 + Math.sin(G.time * 1.5) * 0.1;
    ctx.fillStyle = `rgba(255,60,30,${rp2 * 0.15})`; ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill();
  }

  // Turrets
  for (const slot of s.slots) {
    if (!slot.turret) {
      // Empty slot
      ctx.fillStyle = 'rgba(100,150,200,0.12)';
      ctx.beginPath(); ctx.arc(slot.rx, slot.ry, 7, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(100,150,200,0.25)'; ctx.lineWidth = 1; ctx.stroke();
      // + icon
      ctx.strokeStyle = 'rgba(100,150,200,0.35)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(slot.rx - 3, slot.ry); ctx.lineTo(slot.rx + 3, slot.ry); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(slot.rx, slot.ry - 3); ctx.lineTo(slot.rx, slot.ry + 3); ctx.stroke();
      continue;
    }
    renderTurret(slot);
  }

  // Underwater wash overlay — darkening tint simulating submersion
  if (sinking && sk.phase === 'submerge') {
    const submergeAlpha = clamp((sk.timer - 3.0) / 2.0, 0, 0.4);
    ctx.fillStyle = `rgba(10,25,50,${submergeAlpha})`;
    ctx.fillRect(-s.w, -s.h, s.w * 2, s.h * 2);
  }

  ctx.restore();

  // Ship HP bar (hide when sinking)
  if (sinking) return; // skip HP bar when sinking
  const bw = 90, bh = 5, bx = s.x - bw / 2, by = s.y - s.h / 2 - 18;
  const hp = clamp(s.hp / s.maxHp, 0, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; rr(ctx, bx, by, bw, bh, 2); ctx.fill();
  ctx.fillStyle = hp > 0.5 ? '#44ee88' : hp > 0.25 ? '#ffaa22' : '#ff4466';
  rr(ctx, bx, by, bw * hp, bh, 2); ctx.fill();
}

function shipPath(c, ox, oy, w, h) {
  const hw = w / 2, hh = h / 2;
  c.moveTo(ox + hw + 15, oy);
  c.quadraticCurveTo(ox + hw, oy - hh * 0.8, ox + hw * 0.3, oy - hh);
  c.lineTo(ox - hw * 0.7, oy - hh);
  c.quadraticCurveTo(ox - hw - 5, oy - hh * 0.5, ox - hw - 5, oy);
  c.quadraticCurveTo(ox - hw - 5, oy + hh * 0.5, ox - hw * 0.7, oy + hh);
  c.lineTo(ox + hw * 0.3, oy + hh);
  c.quadraticCurveTo(ox + hw, oy + hh * 0.8, ox + hw + 15, oy);
}

function renderTurret(slot) {
  const t = slot.turret;
  const def = TURRET_DEFS[t.type];
  ctx.save();
  ctx.translate(slot.rx, slot.ry);

  if (t.buildAnim > 0) {
    ctx.globalAlpha = 1 - t.buildAnim;
    ctx.scale(1 - t.buildAnim * 0.3, 1 - t.buildAnim * 0.3);
  }

  // Base
  const bs = t.type === 'jammer' ? 7 : t.type === 'launcher' ? 8 : 6;
  ctx.fillStyle = '#445566'; ctx.beginPath(); ctx.arc(0, 0, bs, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(100,140,180,0.35)'; ctx.lineWidth = 1; ctx.stroke();

  // Level pips
  if (t.level > 1) {
    for (let i = 0; i < Math.min(t.level - 1, 5); i++) {
      const pa = -PI / 2 + (i - (Math.min(t.level - 1, 5) - 1) / 2) * 0.5;
      ctx.fillStyle = '#4af0c0';
      ctx.beginPath();
      ctx.arc(Math.cos(pa) * (bs + 3), Math.sin(pa) * (bs + 3), 1.5, 0, TAU);
      ctx.fill();
    }
  }

  ctx.rotate(t.angle);

  if (t.type === 'jammer') {
    ctx.strokeStyle = '#8866cc'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 10, -0.8, 0.8); ctx.stroke();
    ctx.strokeStyle = '#aa88ee'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(12, 0); ctx.stroke();
    const pulse = (Math.sin(G.time * 4) + 1) * 0.5;
    ctx.fillStyle = `rgba(176,136,255,${pulse * 0.25})`;
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, TAU); ctx.fill();
  } else if (t.type === 'launcher') {
    ctx.fillStyle = '#556677'; ctx.fillRect(-4, -5, 14, 10);
    for (let j = -2; j <= 2; j += 2) { ctx.fillStyle = '#334455'; ctx.fillRect(2, j - 1, 8, 2); }
  } else {
    const blen = t.type === 'flak' ? 14 : 10;
    const bw2 = t.type === 'flak' ? 2.5 : 1.5;
    const rc = t.recoil * 3;
    if (def.barrels >= 2) {
      for (const yo of [-2.5, 2.5]) { ctx.fillStyle = '#889aab'; ctx.fillRect(-rc, yo - bw2 / 2, blen, bw2); }
    } else {
      ctx.fillStyle = '#889aab'; ctx.fillRect(-rc, -bw2 / 2, blen, bw2);
    }
    if (t.recoil > 0.6) {
      ctx.fillStyle = `rgba(255,220,68,${(t.recoil - 0.6) * 2.5})`;
      ctx.beginPath(); ctx.arc(blen - rc + 2, 0, 4, 0, TAU); ctx.fill();
    }
  }
  ctx.restore();
}

function renderEnemies() {
  for (const e of G.enemies) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);
    if (e.stealth) ctx.globalAlpha = e.stealthAlpha;
    if (e.hitFlash > 0) ctx.globalAlpha = Math.max(ctx.globalAlpha, 0.8);

    const sz = e.size;
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath(); ctx.ellipse(2, 2, sz * 1.2, sz * 0.6, 0, 0, TAU); ctx.fill();

    // Threat-based color: lerp from base color toward warning red
    const threat = e.threatLevel || 0;
    const baseCol = e.color;
    const threatCol = threat > 0.05 ? lerpColor(baseCol, '#ff2222', threat * 0.8) : baseCol;
    const col = e.hitFlash > 0 ? '#ffffff' : threatCol;
    ctx.fillStyle = col;

    // Threat glow aura (intensifies as threat rises)
    if (threat > 0.15) {
      const pulse = (Math.sin(G.time * (4 + threat * 8)) + 1) * 0.5;
      const glowAlpha = threat * 0.25 * (0.6 + pulse * 0.4);
      ctx.fillStyle = `rgba(255,50,30,${glowAlpha})`;
      ctx.beginPath(); ctx.arc(0, 0, sz + 3 + threat * 4, 0, TAU); ctx.fill();
      ctx.fillStyle = col; // restore body color
    }

    if (e.isBoss) {
      // Boss: large hexagonal shape with armor plates
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * TAU / 6 - PI / 6;
        const px = Math.cos(a) * sz, py = Math.sin(a) * sz;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      // Inner armor ring
      ctx.strokeStyle = e.hitFlash > 0 ? '#fff' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, sz * 0.6, 0, TAU); ctx.stroke();
      // Core
      ctx.fillStyle = e.hitFlash > 0 ? '#fff' : `rgba(255,${Math.round(180 - threat * 140)},${Math.round(80 - threat * 60)},0.8)`;
      ctx.beginPath(); ctx.arc(0, 0, sz * 0.3, 0, TAU); ctx.fill();
      // Rotating armor segments
      const ra = G.time * 0.8;
      ctx.strokeStyle = `rgba(255,255,255,${0.15 + threat * 0.2})`; ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const sa = ra + i * TAU / 3;
        ctx.beginPath(); ctx.arc(0, 0, sz * 0.8, sa, sa + 0.8); ctx.stroke();
      }
    } else if (e.type === 'bomber' || e.type === 'heavyDrone' || e.type === 'bomber_jr' || e.type === 'heavyDrone_jr') {
      ctx.beginPath();
      ctx.moveTo(sz, 0); ctx.lineTo(-sz * 0.5, -sz * 0.8);
      ctx.lineTo(-sz, 0); ctx.lineTo(-sz * 0.5, sz * 0.8); ctx.closePath(); ctx.fill();
      const wingCol = e.hitFlash > 0 ? '#ddd' : (threat > 0.05 ? lerpColor(baseCol, '#ff2222', threat * 0.5) : baseCol);
      ctx.globalAlpha = (e.stealth ? e.stealthAlpha : 1) * 0.5;
      ctx.fillStyle = wingCol;
      ctx.fillRect(-sz * 0.3, -sz * 1.2, sz * 0.6, sz * 0.4);
      ctx.fillRect(-sz * 0.3, sz * 0.8, sz * 0.6, sz * 0.4);
      ctx.globalAlpha = e.stealth ? e.stealthAlpha : 1;
    } else {
      ctx.beginPath();
      ctx.moveTo(sz, 0); ctx.lineTo(0, -sz * 0.6);
      ctx.lineTo(-sz * 0.7, 0); ctx.lineTo(0, sz * 0.6); ctx.closePath(); ctx.fill();
      // Propeller
      const pa = G.time * 20;
      ctx.strokeStyle = e.hitFlash > 0 ? '#ccc' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 0.5;
      for (const py of [-sz * 0.5, sz * 0.5]) {
        ctx.beginPath(); ctx.arc(-sz * 0.2, py, sz * 0.3, pa, pa + PI); ctx.stroke();
      }
    }

    // Jammer-resist shield indicator (golden ring with shield icon)
    if (e.jammerResist > 0) {
      const shPulse = (Math.sin(G.time * 3) + 1) * 0.5;
      ctx.strokeStyle = `rgba(204,170,51,${0.35 + shPulse * 0.25})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(0, 0, sz + 5, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Warning icon at high threat
    if (threat > 0.8) {
      const pulse = (Math.sin(G.time * 10) + 1) * 0.5;
      ctx.fillStyle = `rgba(255,68,68,${0.5 + pulse * 0.5})`;
      ctx.font = `bold ${Math.round(sz * 0.9)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('!', 0, -sz - 5);
    }

    // Slow ring
    if (e.slowTimer > 0) {
      ctx.strokeStyle = 'rgba(176,136,255,0.5)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, sz + 4, 0, TAU * (e.slowTimer / 3)); ctx.stroke();
    }

    // Engine (brighter when high threat)
    const engAlpha = e.stealth ? 0.3 : (0.4 + threat * 0.4);
    const engR = e.stealth ? 100 : Math.round(lerp(255, 255, threat));
    const engG = e.stealth ? 100 : Math.round(lerp(130, 40, threat));
    const engB = e.stealth ? 200 : Math.round(lerp(50, 20, threat));
    ctx.fillStyle = `rgba(${engR},${engG},${engB},${engAlpha})`;
    ctx.beginPath(); ctx.arc(-sz * 0.6, 0, sz * 0.2 + Math.sin(G.time * 15), 0, TAU); ctx.fill();

    ctx.restore();

    // HP bar for tough enemies / boss stacked single bar
    if (e.isBoss && e.shields) {
      // ── Boss single stacked HP bar ──
      // One bar. Each layer covers the full bar width. Layers are painted
      // back-to-front: core(red) → shield2(yellow) → shield1(green) → shield0(blue).
      // A layer's visible width = (its remaining HP / its maxHP) * barWidth.
      // When shield0 (blue) is at 60%, you see blue covering 60% and green
      // peeking out for the remaining 40%. When blue is gone, the full green bar
      // is revealed underneath.
      const bw = e.size * 3;
      const bh = 5;
      const bx = e.x - bw / 2;
      const by = e.y - e.size - 14;

      // Phase break flash
      if (e.phaseBreakFlash > 0) {
        ctx.save();
        ctx.globalAlpha = e.phaseBreakFlash * 0.5;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
        ctx.restore();
      }

      // Background
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx, by, bw, bh);

      // Draw back-to-front: core first, then shields in reverse order
      // Core: fraction of core HP
      const coreFrac = e.hp / e.maxHp;
      if (coreFrac > 0) {
        ctx.fillStyle = '#ff4466';
        ctx.fillRect(bx, by, bw * coreFrac, bh);
      }
      // Shields back-to-front (2→1→0)
      for (let si = e.shields.length - 1; si >= 0; si--) {
        const sh = e.shields[si];
        if (sh.hp > 0) {
          const frac = sh.hp / sh.maxHp;
          ctx.fillStyle = sh.color;
          ctx.fillRect(bx, by, bw * frac, bh);
        }
      }

      // Shimmer highlight on top half of the visible fill
      const activeSh = e.shieldIdx < e.shields.length ? e.shields[e.shieldIdx] : null;
      const topFrac = activeSh ? activeSh.hp / activeSh.maxHp : coreFrac;
      if (topFrac > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(bx, by, bw * topFrac, bh / 2);
      }

      // Border color = active layer color
      const activeColor = e.shieldIdx < e.shields.length
        ? e.shields[e.shieldIdx].color
        : '#ff4466';
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = 0.8;
      ctx.strokeRect(bx, by, bw, bh);

      // Phase attack timer arc around boss
      if (e.shieldIdx < e.shields.length) {
        const timerFrac = e.phaseAttackTimer / e.phaseAttackInterval;
        const timerAngle = TAU * timerFrac;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.size + 6, -PI / 2, -PI / 2 + timerAngle);
        ctx.strokeStyle = timerFrac > 0.75
          ? `rgba(255,${Math.floor(80 * (1 - timerFrac))},50,${0.6 + timerFrac * 0.4})`
          : 'rgba(255,180,50,0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    } else if (e.isBoss) {
      // Fallback boss bar (no shield data)
      const bw = e.size * 3;
      const bh = 5;
      const by = e.y - e.size - 14;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(e.x - bw / 2, by, bw, bh);
      ctx.fillStyle = '#ff4466'; ctx.fillRect(e.x - bw / 2, by, bw * (e.hp / e.maxHp), bh);
      ctx.strokeStyle = 'rgba(255,68,102,0.4)'; ctx.lineWidth = 0.5;
      ctx.strokeRect(e.x - bw / 2, by, bw, bh);
    } else if (e.maxHp > 50 && e.hp < e.maxHp) {
      const bw = e.size * 2;
      const bh = 2;
      const by = e.y - e.size - 6;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(e.x - bw / 2, by, bw, bh);
      ctx.fillStyle = '#ff4466'; ctx.fillRect(e.x - bw / 2, by, bw * (e.hp / e.maxHp), bh);
    }

    // Boss label — just "BOSS", no phase text
    if (e.isBoss) {
      ctx.font = "bold 10px 'Satoshi',sans-serif";
      ctx.fillStyle = '#ffcc44';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('BOSS', e.x, e.y - e.size - 16);
    }

    // Jammer-resist indicator label
    if (e.jammerResist > 0 && !e.isBoss) {
      ctx.font = "bold 7px sans-serif"; ctx.fillStyle = 'rgba(204,170,51,0.7)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('◈', e.x, e.y - e.size - (e.maxHp > 50 && e.hp < e.maxHp ? 9 : 3));
    }
  }
}

function renderBullets() {
  for (const b of G.bullets) {
    ctx.save();
    if (b.trail.length > 1) {
      ctx.strokeStyle = b.color; ctx.lineWidth = b.homing ? 2 : 1; ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(b.trail[0].x, b.trail[0].y);
      for (let j = 1; j < b.trail.length; j++) ctx.lineTo(b.trail[j].x, b.trail[j].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (b.homing) {
      ctx.translate(b.x, b.y); ctx.rotate(b.angle);
      ctx.fillStyle = '#ccddee'; ctx.fillRect(-5, -1.5, 10, 3);
      ctx.fillStyle = '#ff4466'; ctx.fillRect(-5, -1, 3, 2);
      ctx.fillStyle = `rgba(255,150,50,${0.5 + Math.random() * 0.5})`;
      ctx.beginPath(); ctx.arc(-7, 0, 2, 0, TAU); ctx.fill();
    } else if (b.aoe > 0) {
      ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,120,50,0.25)'; ctx.beginPath(); ctx.arc(b.x, b.y, 6, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(b.x, b.y, 1.5, 0, TAU); ctx.fill();
      ctx.fillStyle = `${b.color}44`; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}

function renderTorpedoes() {
  for (const t of G.torpedoes) {
    // Trail
    ctx.strokeStyle = 'rgba(255,100,50,0.25)'; ctx.lineWidth = 2;
    if (t.trail.length > 1) {
      ctx.beginPath(); ctx.moveTo(t.trail[0].x, t.trail[0].y);
      for (let j = 1; j < t.trail.length; j++) ctx.lineTo(t.trail[j].x, t.trail[j].y);
      ctx.stroke();
    }
    // Body
    const a = ang(t.x, t.y, t.tx, t.ty);
    ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(a);
    const bodyCol = t.hitFlash > 0 ? '#ffffff' : '#ff6644';
    ctx.fillStyle = bodyCol; ctx.fillRect(-6, -2, 12, 4);
    ctx.fillStyle = t.hitFlash > 0 ? '#ffeecc' : '#ffaa44';
    ctx.beginPath(); ctx.arc(-6, 0, 3, 0, TAU); ctx.fill();
    ctx.restore();

    // HP bar (only when damaged)
    if (t.hp < t.maxHp) {
      const bw = 16, bh = 3;
      const bx = t.x - bw / 2, by = t.y - 8;
      const hp = clamp(t.hp / t.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; rr(ctx, bx, by, bw, bh, 1); ctx.fill();
      ctx.fillStyle = hp > 0.5 ? '#ffaa44' : '#ff4466';
      rr(ctx, bx, by, bw * hp, bh, 1); ctx.fill();
    }

    // Target reticle
    const pulse = (Math.sin(G.time * 6) + 1) * 0.5;
    ctx.strokeStyle = `rgba(255,68,68,${0.2 + pulse * 0.3})`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(t.tx, t.ty, 15 + pulse * 5, 0, TAU); ctx.stroke();
  }
}

function renderScraps() {
  for (const s of G.scraps) {
    const alpha = s.life < 3 ? s.life / 3 : 1;
    const col = RES_COL[s.type] || '#fff';
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(s.x, s.y); ctx.rotate(s.rot);
    ctx.fillStyle = `${col}33`; ctx.beginPath(); ctx.arc(0, 0, s.size + 3, 0, TAU); ctx.fill();
    ctx.fillStyle = col; ctx.fillRect(-s.size / 2, -s.size / 2, s.size, s.size);
    ctx.restore();
  }
}

function renderHUD() {
  if (G.phase === 'title' || G.phase === 'gameover' || G.phase === 'sinking') return;
  ctx.save();
  const mobile = W < 600;
  // Top bar
  ctx.fillStyle = 'rgba(10,14,20,0.85)'; ctx.fillRect(0, 0, W, mobile ? 68 : 48);
  ctx.fillStyle = 'rgba(100,150,200,0.08)'; ctx.fillRect(0, mobile ? 67 : 47, W, 1);

  ctx.font = `700 ${mobile ? 13 : 15}px 'Cabinet Grotesk',sans-serif`; ctx.fillStyle = '#fff';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(`WAVE ${G.wave + 1}`, 14, mobile ? 16 : 24);

  ctx.font = `500 ${mobile ? 11 : 13}px 'Satoshi',sans-serif`; ctx.fillStyle = '#aabbcc';
  ctx.fillText(`SCORE: ${G.score}`, mobile ? 100 : 110, mobile ? 16 : 24);

  if (G.waveActive) {
    ctx.fillStyle = '#ff6666';
    ctx.fillText(`敵: ${G.enemies.length}`, mobile ? 195 : 240, mobile ? 16 : 24);
    const tCount = G.torpedoes.length;
    if (tCount > 0) {
      ctx.fillStyle = '#ff4444';
      ctx.fillText(`⚠ 魚雷: ${tCount}`, mobile ? 240 : 310, mobile ? 16 : 24);
    }
  }

  // Resources — second row on mobile
  const resY = mobile ? 48 : 24;
  const RES_SHORT = { iron: '鉄', gunpowder: '火', electronics: '電', brass: '真' };
  ctx.textAlign = 'right'; ctx.font = `600 ${mobile ? 10 : 12}px 'Satoshi',sans-serif`;
  let rx = W - 10;
  for (const key of ['brass', 'electronics', 'gunpowder', 'iron']) {
    const v = G.res[key] || 0;
    const label = mobile ? RES_SHORT[key] : RES_NAME[key];
    const text = `${label}: ${v}`;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = RES_COL[key]; ctx.fillRect(rx - tw - 10, resY - 3, 6, 6);
    ctx.fillStyle = '#ccddee'; ctx.fillText(text, rx, resY);
    rx -= tw + (mobile ? 18 : 28);
  }

  // HP bar
  const bw = Math.min(200, W - 60), bh = 8, bx = CX - bw / 2, by = H - 28;
  const hp = clamp(G.ship.hp / G.ship.maxHp, 0, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; rr(ctx, bx - 2, by - 2, bw + 4, bh + 4, 4); ctx.fill();
  ctx.fillStyle = '#1a2233'; rr(ctx, bx, by, bw, bh, 3); ctx.fill();
  ctx.fillStyle = hp > 0.5 ? '#44ee88' : hp > 0.25 ? '#ffaa22' : '#ff4466';
  rr(ctx, bx, by, bw * hp, bh, 3); ctx.fill();
  ctx.font = "600 11px 'Satoshi',sans-serif"; ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(`HP: ${Math.max(0, Math.ceil(G.ship.hp))} / ${G.ship.maxHp}`, CX, by + bh + 13);

  // Aim hint
  if (G.phase === 'playing' && pointers.size === 0 && G.waveActive) {
    const pulse = 0.5 + Math.sin(G.time * 3) * 0.3;
    ctx.globalAlpha = pulse;
    ctx.font = `500 ${mobile ? 13 : 16}px 'Satoshi',sans-serif`;
    ctx.fillStyle = '#4af0c0';
    ctx.fillText(mobile ? 'タップして照準' : 'タップして照準 — 長押しで射撃', CX, H - 60);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

// ─── BUILD UI (redesigned — separate panel, not overlapping ship) ──
function renderBuildUI() {
  ctx.save();
  ctx.fillStyle = 'rgba(5,10,20,0.4)'; ctx.fillRect(0, 0, W, H);

  if (G.buildUI.mode === 'main') renderBuildMain();
  else if (G.buildUI.mode === 'slot') renderBuildSlot();

  ctx.restore();

  handleBuildClick();
}

function renderBuildMain() {
  const mobile = W < 600;

  if (mobile) {
    renderBuildMobile();
    return;
  }

  // Left panel: turret list. Right side: ship view with slots
  const panelW = Math.min(340, W * 0.4);
  const panelH = H - 80;
  const panelX = 20, panelY = 60;

  // Panel bg
  ctx.fillStyle = 'rgba(15,20,35,0.95)';
  rr(ctx, panelX, panelY, panelW, panelH, 12); ctx.fill();
  ctx.strokeStyle = 'rgba(100,150,200,0.15)'; ctx.lineWidth = 1;
  rr(ctx, panelX, panelY, panelW, panelH, 12); ctx.stroke();

  ctx.font = "800 20px 'Cabinet Grotesk',sans-serif"; ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText('改修フェーズ', panelX + panelW / 2, panelY + 30);
  ctx.font = "400 12px 'Satoshi',sans-serif"; ctx.fillStyle = '#6a7a8e';
  ctx.fillText('砲台を選んでスロットをタップ', panelX + panelW / 2, panelY + 50);

  // Turret options
  const types = Object.keys(TURRET_DEFS);
  const optH = 54;
  let oy = panelY + 65;

  for (const type of types) {
    const def = TURRET_DEFS[type];
    const sel = G.buildUI.selectedType === type;
    const afford = canAfford(def.cost);
    ctx.fillStyle = sel ? 'rgba(74,240,192,0.12)' : 'rgba(255,255,255,0.03)';
    rr(ctx, panelX + 10, oy, panelW - 20, optH, 6); ctx.fill();
    if (sel) { ctx.strokeStyle = 'rgba(74,240,192,0.4)'; ctx.lineWidth = 1; rr(ctx, panelX + 10, oy, panelW - 20, optH, 6); ctx.stroke(); }

    ctx.textAlign = 'left';
    ctx.font = "700 14px 'Satoshi',sans-serif";
    ctx.fillStyle = afford ? '#fff' : '#445';
    ctx.fillText(def.name, panelX + 22, oy + 19);
    ctx.font = "400 11px 'Satoshi',sans-serif"; ctx.fillStyle = '#6a7a8e';
    ctx.fillText(def.desc, panelX + 22, oy + 36);

    // Cost
    ctx.textAlign = 'right'; ctx.font = "500 10px 'Satoshi',sans-serif";
    let cx2 = panelX + panelW - 18;
    for (const [res, amt] of Object.entries(def.cost)) {
      const has = (G.res[res] || 0) >= amt;
      ctx.fillStyle = has ? RES_COL[res] : '#443333';
      const txt = `${RES_NAME[res]}${amt}`;
      ctx.fillText(txt, cx2, oy + 19);
      cx2 -= ctx.measureText(txt).width + 8;
    }

    ctx.textAlign = 'right'; ctx.font = "400 10px 'Satoshi',sans-serif"; ctx.fillStyle = '#556';
    if (def.damage > 0) ctx.fillText(`DMG:${def.damage} RNG:${def.range}`, panelX + panelW - 18, oy + 45);
    else if (def.slowFactor) ctx.fillText(`SLOW:${Math.round((1 - def.slowFactor) * 100)}% RNG:${def.range}`, panelX + panelW - 18, oy + 45);

    oy += optH + 6;
  }

  // Existing turrets — upgrade & demolish section
  oy += 10;
  ctx.font = "700 14px 'Satoshi',sans-serif"; ctx.fillStyle = '#aabbcc';
  ctx.textAlign = 'center';
  ctx.fillText('— 既存砲台の管理 —', panelX + panelW / 2, oy);
  oy += 20;

  for (const slot of G.ship.slots) {
    if (!slot.turret) continue;
    const t = slot.turret;
    const def = TURRET_DEFS[t.type];
    const cost = upgradeCostFor(slot);
    const afford = canAfford(cost);
    const isConfirming = G.buildUI.demolishConfirm === slot.id;
    const rowH = isConfirming ? 60 : 36;
    const y2 = oy;

    ctx.fillStyle = isConfirming ? 'rgba(180,40,40,0.08)' : 'rgba(255,255,255,0.03)';
    rr(ctx, panelX + 10, y2, panelW - 20, rowH, 4); ctx.fill();
    if (isConfirming) {
      ctx.strokeStyle = 'rgba(255,80,60,0.3)'; ctx.lineWidth = 1;
      rr(ctx, panelX + 10, y2, panelW - 20, rowH, 4); ctx.stroke();
    }

    ctx.textAlign = 'left'; ctx.font = "600 12px 'Satoshi',sans-serif";
    ctx.fillStyle = '#ccc';
    ctx.fillText(`${def.name} Lv.${t.level}`, panelX + 22, y2 + 14);

    ctx.textAlign = 'left'; ctx.font = "400 10px 'Satoshi',sans-serif"; ctx.fillStyle = '#888';
    const dmg = Math.round(turretStat(def, t.level, 'damage'));
    const rng = Math.round(turretStat(def, t.level, 'range'));
    ctx.fillText(`DMG:${dmg} RNG:${rng}`, panelX + 22, y2 + 28);

    if (!isConfirming) {
      // Upgrade button
      const btnW = 54, btnH = 24, btnX = panelX + panelW - 100, btnY = y2 + 6;
      ctx.fillStyle = afford ? '#01696f' : '#334';
      rr(ctx, btnX, btnY, btnW, btnH, 4); ctx.fill();
      ctx.font = "600 10px 'Satoshi',sans-serif"; ctx.fillStyle = afford ? '#fff' : '#555';
      ctx.textAlign = 'center';
      ctx.fillText('強化', btnX + btnW / 2, btnY + btnH / 2 + 1);

      // Demolish trigger button (small, separated)
      const dBtnW = 28, dBtnH = 24, dBtnX = panelX + panelW - 40, dBtnY = y2 + 6;
      ctx.fillStyle = 'rgba(120,40,40,0.4)';
      rr(ctx, dBtnX, dBtnY, dBtnW, dBtnH, 4); ctx.fill();
      ctx.font = "600 12px sans-serif"; ctx.fillStyle = '#aa5555';
      ctx.textAlign = 'center';
      ctx.fillText('×', dBtnX + dBtnW / 2, dBtnY + dBtnH / 2 + 1);
    } else {
      // Confirmation row: show refund + confirm/cancel
      const refund = demolishRefund(slot);
      ctx.font = "400 10px 'Satoshi',sans-serif"; ctx.fillStyle = '#cc8866';
      ctx.textAlign = 'left';
      const refundText = '回収: ' + Object.entries(refund).filter(([,v]) => v > 0).map(([k,v]) => `${RES_NAME[k]}${v}`).join(' ');
      ctx.fillText(refundText, panelX + 22, y2 + 44);

      // Confirm button (red)
      const cBtnW = 48, cBtnH = 20, cBtnX = panelX + panelW - 112, cBtnY = y2 + 36;
      ctx.fillStyle = '#882222';
      rr(ctx, cBtnX, cBtnY, cBtnW, cBtnH, 3); ctx.fill();
      ctx.font = "600 10px 'Satoshi',sans-serif"; ctx.fillStyle = '#ff8888';
      ctx.textAlign = 'center';
      ctx.fillText('解体', cBtnX + cBtnW / 2, cBtnY + cBtnH / 2 + 1);

      // Cancel button
      const xBtnW = 48, xBtnH = 20, xBtnX = panelX + panelW - 58, xBtnY = y2 + 36;
      ctx.fillStyle = '#334';
      rr(ctx, xBtnX, xBtnY, xBtnW, xBtnH, 3); ctx.fill();
      ctx.font = "600 10px 'Satoshi',sans-serif"; ctx.fillStyle = '#888';
      ctx.textAlign = 'center';
      ctx.fillText('取消', xBtnX + xBtnW / 2, xBtnY + xBtnH / 2 + 1);
    }

    oy += rowH + 4;
  }

  // Next wave button
  const nbw = panelW - 40, nbh = 44, nbx = panelX + 20, nby = panelY + panelH - 60;
  ctx.fillStyle = '#01696f'; rr(ctx, nbx, nby, nbw, nbh, 8); ctx.fill();
  ctx.font = "700 16px 'Cabinet Grotesk',sans-serif"; ctx.fillStyle = '#fff';
  ctx.textAlign = 'center'; ctx.fillText('次のWaveへ ▶', panelX + panelW / 2, nby + nbh / 2 + 1);

  // === RIGHT SIDE: Ship with clickable slots ===
  const shipCX = panelX + panelW + (W - panelX - panelW) / 2;
  const shipCY = CY;

  ctx.save();
  ctx.translate(shipCX, shipCY);
  const scale = 2.5;
  ctx.scale(scale, scale);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); shipPath(ctx, 1, 1, G.ship.w, G.ship.h); ctx.fill();
  const hg = ctx.createLinearGradient(0, -G.ship.h / 2, 0, G.ship.h / 2);
  hg.addColorStop(0, '#4a5a6e'); hg.addColorStop(0.5, '#3a4a5c'); hg.addColorStop(1, '#2a3a4c');
  ctx.fillStyle = hg; ctx.beginPath(); shipPath(ctx, 0, 0, G.ship.w, G.ship.h); ctx.fill();
  ctx.strokeStyle = 'rgba(100,140,180,0.3)'; ctx.lineWidth = 0.5;
  ctx.beginPath(); shipPath(ctx, 0, 0, G.ship.w, G.ship.h); ctx.stroke();

  // Slots
  for (const slot of G.ship.slots) {
    if (slot.turret) {
      renderTurret(slot);
      ctx.font = "bold 5px sans-serif"; ctx.fillStyle = '#4af0c0';
      ctx.textAlign = 'center'; ctx.fillText(`Lv${slot.turret.level}`, slot.rx, slot.ry + 12);
    } else {
      const highlight = G.buildUI.selectedType !== null;
      ctx.fillStyle = highlight ? 'rgba(74,240,192,0.25)' : 'rgba(100,150,200,0.15)';
      ctx.beginPath(); ctx.arc(slot.rx, slot.ry, 8, 0, TAU); ctx.fill();
      ctx.strokeStyle = highlight ? 'rgba(74,240,192,0.6)' : 'rgba(100,150,200,0.3)';
      ctx.lineWidth = highlight ? 1 : 0.5; ctx.stroke();
      ctx.fillStyle = highlight ? '#4af0c0' : 'rgba(100,150,200,0.5)';
      ctx.font = "bold 8px sans-serif"; ctx.textAlign = 'center';
      ctx.fillText('+', slot.rx, slot.ry + 3);
    }
  }
  ctx.restore();

  ctx.font = "400 12px 'Satoshi',sans-serif"; ctx.fillStyle = '#6a7a8e';
  ctx.textAlign = 'center';
  ctx.fillText('空きスロット (+) をクリックして設置', shipCX, shipCY + G.ship.h * scale / 2 + 30);
}

// Mobile build UI: vertical layout, ship on top, options below
function renderBuildMobile() {
  // Ship at top
  const shipCX = CX;
  const shipCY = 140;
  const scale = 1.8;

  ctx.save();
  ctx.translate(shipCX, shipCY);
  ctx.scale(scale, scale);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); shipPath(ctx, 1, 1, G.ship.w, G.ship.h); ctx.fill();
  const hg = ctx.createLinearGradient(0, -G.ship.h / 2, 0, G.ship.h / 2);
  hg.addColorStop(0, '#4a5a6e'); hg.addColorStop(0.5, '#3a4a5c'); hg.addColorStop(1, '#2a3a4c');
  ctx.fillStyle = hg; ctx.beginPath(); shipPath(ctx, 0, 0, G.ship.w, G.ship.h); ctx.fill();
  ctx.strokeStyle = 'rgba(100,140,180,0.3)'; ctx.lineWidth = 0.5;
  ctx.beginPath(); shipPath(ctx, 0, 0, G.ship.w, G.ship.h); ctx.stroke();
  for (const slot of G.ship.slots) {
    if (slot.turret) {
      renderTurret(slot);
      ctx.font = "bold 4px sans-serif"; ctx.fillStyle = '#4af0c0';
      ctx.textAlign = 'center'; ctx.fillText(`Lv${slot.turret.level}`, slot.rx, slot.ry + 10);
    } else {
      const highlight = G.buildUI.selectedType !== null;
      ctx.fillStyle = highlight ? 'rgba(74,240,192,0.25)' : 'rgba(100,150,200,0.15)';
      ctx.beginPath(); ctx.arc(slot.rx, slot.ry, 7, 0, TAU); ctx.fill();
      ctx.strokeStyle = highlight ? 'rgba(74,240,192,0.6)' : 'rgba(100,150,200,0.3)';
      ctx.lineWidth = highlight ? 0.8 : 0.4; ctx.stroke();
      ctx.fillStyle = highlight ? '#4af0c0' : 'rgba(100,150,200,0.5)';
      ctx.font = "bold 7px sans-serif"; ctx.textAlign = 'center';
      ctx.fillText('+', slot.rx, slot.ry + 2.5);
    }
  }
  ctx.restore();

  ctx.font = "400 10px 'Satoshi',sans-serif"; ctx.fillStyle = '#6a7a8e';
  ctx.textAlign = 'center';
  ctx.fillText('空きスロット(+)をタップして設置', shipCX, shipCY + G.ship.h * scale / 2 + 18);

  // Panel below ship
  const panelX = 10, panelW = W - 20;
  const panelY = shipCY + G.ship.h * scale / 2 + 32;

  ctx.fillStyle = 'rgba(15,20,35,0.95)';
  rr(ctx, panelX, panelY, panelW, H - panelY - 10, 10); ctx.fill();

  ctx.font = "700 16px 'Cabinet Grotesk',sans-serif"; ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText('改修フェーズ', CX, panelY + 20);

  // Turret options in 2-column grid
  const types = Object.keys(TURRET_DEFS);
  const colW = (panelW - 30) / 2;
  const optH = 44;
  let row = 0;
  for (let i = 0; i < types.length; i++) {
    const col = i % 2;
    if (col === 0 && i > 0) row++;
    const type = types[i];
    const def = TURRET_DEFS[type];
    const sel = G.buildUI.selectedType === type;
    const afford = canAfford(def.cost);
    const ox = panelX + 10 + col * (colW + 10);
    const oy2 = panelY + 35 + row * (optH + 6);

    ctx.fillStyle = sel ? 'rgba(74,240,192,0.12)' : 'rgba(255,255,255,0.03)';
    rr(ctx, ox, oy2, colW, optH, 5); ctx.fill();
    if (sel) { ctx.strokeStyle = 'rgba(74,240,192,0.4)'; ctx.lineWidth = 1; rr(ctx, ox, oy2, colW, optH, 5); ctx.stroke(); }

    ctx.textAlign = 'left'; ctx.font = "700 12px 'Satoshi',sans-serif";
    ctx.fillStyle = afford ? '#fff' : '#445';
    ctx.fillText(def.name, ox + 8, oy2 + 16);
    ctx.font = "400 9px 'Satoshi',sans-serif"; ctx.fillStyle = '#6a7a8e';
    ctx.fillText(def.desc.substring(0, 10), ox + 8, oy2 + 30);

    ctx.textAlign = 'right'; ctx.font = "500 9px 'Satoshi',sans-serif";
    let cx2 = ox + colW - 6;
    for (const [res, amt] of Object.entries(def.cost)) {
      const has = (G.res[res] || 0) >= amt;
      ctx.fillStyle = has ? RES_COL[res] : '#443333';
      const RES_S = { iron: '鉄', gunpowder: '火', electronics: '電', brass: '真' };
      const txt = `${RES_S[res]}${amt}`;
      ctx.fillText(txt, cx2, oy2 + 16);
      cx2 -= ctx.measureText(txt).width + 5;
    }
  }

  // Existing turrets upgrade & demolish row
  const upgY = panelY + 35 + (Math.ceil(types.length / 2)) * (optH + 6) + 6;
  const existingTurrets = G.ship.slots.filter(s => s.turret);
  if (existingTurrets.length > 0) {
    ctx.font = "600 11px 'Satoshi',sans-serif"; ctx.fillStyle = '#aabbcc';
    ctx.textAlign = 'center';
    ctx.fillText('— 管理 —', CX, upgY);
    let uy = upgY + 14;
    for (const slot of existingTurrets) {
      const t = slot.turret;
      const def = TURRET_DEFS[t.type];
      const cost = upgradeCostFor(slot);
      const afford = canAfford(cost);
      const isConfirming = G.buildUI.demolishConfirm === slot.id;
      const rowH = isConfirming ? 52 : 28;

      ctx.fillStyle = isConfirming ? 'rgba(180,40,40,0.08)' : 'rgba(255,255,255,0.03)';
      rr(ctx, panelX + 10, uy, panelW - 20, rowH, 4); ctx.fill();
      if (isConfirming) {
        ctx.strokeStyle = 'rgba(255,80,60,0.3)'; ctx.lineWidth = 1;
        rr(ctx, panelX + 10, uy, panelW - 20, rowH, 4); ctx.stroke();
      }
      ctx.textAlign = 'left'; ctx.font = "600 10px 'Satoshi',sans-serif"; ctx.fillStyle = '#ccc';
      ctx.fillText(`${def.name} Lv.${t.level}`, panelX + 18, uy + 17);

      if (!isConfirming) {
        // Upgrade button
        const btnW = 42, btnH = 20, btnX = panelX + panelW - 80, btnY2 = uy + 4;
        ctx.fillStyle = afford ? '#01696f' : '#334';
        rr(ctx, btnX, btnY2, btnW, btnH, 3); ctx.fill();
        ctx.font = "600 9px 'Satoshi',sans-serif"; ctx.fillStyle = afford ? '#fff' : '#555';
        ctx.textAlign = 'center';
        ctx.fillText('強化', btnX + btnW / 2, btnY2 + btnH / 2 + 1);

        // Demolish trigger (×)
        const dBtnW = 24, dBtnH = 20, dBtnX = panelX + panelW - 34, dBtnY = uy + 4;
        ctx.fillStyle = 'rgba(120,40,40,0.4)';
        rr(ctx, dBtnX, dBtnY, dBtnW, dBtnH, 3); ctx.fill();
        ctx.font = "600 11px sans-serif"; ctx.fillStyle = '#aa5555';
        ctx.textAlign = 'center';
        ctx.fillText('×', dBtnX + dBtnW / 2, dBtnY + dBtnH / 2 + 1);
      } else {
        // Confirmation: refund info + confirm/cancel
        const refund = demolishRefund(slot);
        ctx.font = "400 9px 'Satoshi',sans-serif"; ctx.fillStyle = '#cc8866';
        ctx.textAlign = 'left';
        const refundText = '回収: ' + Object.entries(refund).filter(([,v]) => v > 0).map(([k,v]) => `${RES_NAME[k]}${v}`).join(' ');
        ctx.fillText(refundText, panelX + 18, uy + 36);

        // Confirm demolish
        const cBtnW = 42, cBtnH = 18, cBtnX = panelX + panelW - 96, cBtnY = uy + 30;
        ctx.fillStyle = '#882222';
        rr(ctx, cBtnX, cBtnY, cBtnW, cBtnH, 3); ctx.fill();
        ctx.font = "600 9px 'Satoshi',sans-serif"; ctx.fillStyle = '#ff8888';
        ctx.textAlign = 'center';
        ctx.fillText('解体', cBtnX + cBtnW / 2, cBtnY + cBtnH / 2 + 1);

        // Cancel
        const xBtnW = 42, xBtnH = 18, xBtnX = panelX + panelW - 48, xBtnY = uy + 30;
        ctx.fillStyle = '#334';
        rr(ctx, xBtnX, xBtnY, xBtnW, xBtnH, 3); ctx.fill();
        ctx.font = "600 9px 'Satoshi',sans-serif"; ctx.fillStyle = '#888';
        ctx.textAlign = 'center';
        ctx.fillText('取消', xBtnX + xBtnW / 2, xBtnY + xBtnH / 2 + 1);
      }
      uy += rowH + 4;
    }
  }

  // Next wave button at very bottom
  const nbw = panelW - 20, nbh = 38, nbx = panelX + 10, nby = H - 55;
  ctx.fillStyle = '#01696f'; rr(ctx, nbx, nby, nbw, nbh, 6); ctx.fill();
  ctx.font = "700 14px 'Cabinet Grotesk',sans-serif"; ctx.fillStyle = '#fff';
  ctx.textAlign = 'center'; ctx.fillText('次のWaveへ ▶', CX, nby + nbh / 2 + 1);
}

function renderBuildSlot() { /* currently unused — all in main */ }

function handleBuildClick() {
  // We process clicks via pointer events
  if (pointers.size === 0) return;
  const ptr = [...pointers.values()][0]; // Use first pointer
  const mx = ptr.x, my = ptr.y;

  // Debounce: only process on initial press
  if (Date.now() - ptr.startTime > 100) return;
  ptr.startTime = 0; // consume

  const mobile = W < 600;
  if (mobile) {
    handleBuildClickMobile(mx, my);
    return;
  }

  const panelW = Math.min(340, W * 0.4);
  const panelX = 20, panelY = 60;

  // Check turret type selection
  const types = Object.keys(TURRET_DEFS);
  const optH = 54;
  let oy = panelY + 65;
  for (const type of types) {
    if (mx > panelX + 10 && mx < panelX + panelW - 10 && my > oy && my < oy + optH) {
      if (canAfford(TURRET_DEFS[type].cost)) {
        G.buildUI.selectedType = type;
        sfx('build');
      }
      return;
    }
    oy += optH + 6;
  }

  // Check upgrade / demolish buttons
  oy += 30; // skip header
  for (const slot of G.ship.slots) {
    if (!slot.turret) continue;
    const isConfirming = G.buildUI.demolishConfirm === slot.id;
    const rowH = isConfirming ? 60 : 36;

    if (!isConfirming) {
      // Upgrade button
      const btnW = 54, btnX = panelX + panelW - 100, btnY = oy + 6;
      if (mx > btnX && mx < btnX + btnW && my > btnY && my < btnY + 24) {
        upgradeTurret(slot.id);
        return;
      }
      // Demolish trigger (× button)
      const dBtnW = 28, dBtnX = panelX + panelW - 40, dBtnY = oy + 6;
      if (mx > dBtnX && mx < dBtnX + dBtnW && my > dBtnY && my < dBtnY + 24) {
        G.buildUI.demolishConfirm = slot.id;
        return;
      }
    } else {
      // Confirm demolish button
      const cBtnW = 48, cBtnX = panelX + panelW - 112, cBtnY = oy + 36;
      if (mx > cBtnX && mx < cBtnX + cBtnW && my > cBtnY && my < cBtnY + 20) {
        demolishTurret(slot.id);
        return;
      }
      // Cancel button
      const xBtnW = 48, xBtnX = panelX + panelW - 58, xBtnY = oy + 36;
      if (mx > xBtnX && mx < xBtnX + xBtnW && my > xBtnY && my < xBtnY + 20) {
        G.buildUI.demolishConfirm = null;
        return;
      }
    }
    oy += rowH + 4;
  }

  // Check next wave button
  const nbw = panelW - 40, nbh = 44, nbx = panelX + 20, nby = panelY + (H - 80) - 60;
  if (mx > nbx && mx < nbx + nbw && my > nby && my < nby + nbh) {
    G.phase = 'playing';
    startWave(G.wave + 1);
    G.buildUI.selectedType = null;
    G.buildUI.demolishConfirm = null;
    return;
  }

  // Check ship slot clicks (right side)
  if (G.buildUI.selectedType) {
    const shipCX = panelX + panelW + (W - panelX - panelW) / 2;
    const shipCY = CY;
    const scale = 2.5;

    for (const slot of G.ship.slots) {
      if (slot.turret) continue;
      const sx = shipCX + slot.rx * scale;
      const sy = shipCY + slot.ry * scale;
      if (dist(mx, my, sx, sy) < 22) {
        const cost = TURRET_DEFS[G.buildUI.selectedType].cost;
        if (canAfford(cost)) {
          spend(cost);
          placeTurret(slot.id, G.buildUI.selectedType);
          sfx('build');
          notify(`${TURRET_DEFS[G.buildUI.selectedType].name}を設置`);
        }
        return;
      }
    }
  }
}

function handleBuildClickMobile(mx, my) {
  const shipCX = CX;
  const shipCY = 140;
  const scale = 1.8;

  // Check ship slot clicks (top area)
  if (G.buildUI.selectedType) {
    for (const slot of G.ship.slots) {
      if (slot.turret) continue;
      const sx = shipCX + slot.rx * scale;
      const sy = shipCY + slot.ry * scale;
      if (dist(mx, my, sx, sy) < 18) {
        const cost = TURRET_DEFS[G.buildUI.selectedType].cost;
        if (canAfford(cost)) {
          spend(cost);
          placeTurret(slot.id, G.buildUI.selectedType);
          sfx('build');
          notify(`${TURRET_DEFS[G.buildUI.selectedType].name}を設置`);
        }
        return;
      }
    }
  }

  const panelX = 10, panelW = W - 20;
  const panelY = shipCY + G.ship.h * scale / 2 + 32;

  // Turret type selection (2-col grid)
  const types = Object.keys(TURRET_DEFS);
  const colW = (panelW - 30) / 2;
  const optH = 44;
  let row = 0;
  for (let i = 0; i < types.length; i++) {
    const col = i % 2;
    if (col === 0 && i > 0) row++;
    const ox = panelX + 10 + col * (colW + 10);
    const oy2 = panelY + 35 + row * (optH + 6);
    if (mx > ox && mx < ox + colW && my > oy2 && my < oy2 + optH) {
      if (canAfford(TURRET_DEFS[types[i]].cost)) {
        G.buildUI.selectedType = types[i];
        sfx('build');
      }
      return;
    }
  }

  // Upgrade / demolish buttons
  const upgY = panelY + 35 + (Math.ceil(types.length / 2)) * (optH + 6) + 6;
  const existingTurrets = G.ship.slots.filter(s => s.turret);
  let uy = upgY + 14;
  for (const slot of existingTurrets) {
    const isConfirming = G.buildUI.demolishConfirm === slot.id;
    const rowH = isConfirming ? 52 : 28;

    if (!isConfirming) {
      // Upgrade button
      const btnW = 42, btnX = panelX + panelW - 80, btnY2 = uy + 4;
      if (mx > btnX && mx < btnX + btnW && my > btnY2 && my < btnY2 + 20) {
        upgradeTurret(slot.id);
        return;
      }
      // Demolish trigger (×)
      const dBtnW = 24, dBtnX = panelX + panelW - 34, dBtnY = uy + 4;
      if (mx > dBtnX && mx < dBtnX + dBtnW && my > dBtnY && my < dBtnY + 20) {
        G.buildUI.demolishConfirm = slot.id;
        return;
      }
    } else {
      // Confirm demolish
      const cBtnW = 42, cBtnX = panelX + panelW - 96, cBtnY = uy + 30;
      if (mx > cBtnX && mx < cBtnX + cBtnW && my > cBtnY && my < cBtnY + 18) {
        demolishTurret(slot.id);
        return;
      }
      // Cancel
      const xBtnW = 42, xBtnX = panelX + panelW - 48, xBtnY = uy + 30;
      if (mx > xBtnX && mx < xBtnX + xBtnW && my > xBtnY && my < xBtnY + 18) {
        G.buildUI.demolishConfirm = null;
        return;
      }
    }
    uy += rowH + 4;
  }

  // Next wave button
  const nbw = panelW - 20, nbh = 38, nbx = panelX + 10, nby = H - 55;
  if (mx > nbx && mx < nbx + nbw && my > nby && my < nby + nbh) {
    G.phase = 'playing';
    startWave(G.wave + 1);
    G.buildUI.selectedType = null;
    G.buildUI.demolishConfirm = null;
    return;
  }
}

function renderTitle() {
  ctx.fillStyle = '#0a1628'; ctx.fillRect(0, 0, W, H);
  const t = G.time;
  const mobile = W < 600;
  ctx.strokeStyle = 'rgba(60,100,180,0.12)'; ctx.lineWidth = 1;
  for (let row = 0; row < H; row += 40) {
    ctx.beginPath();
    for (let x = 0; x < W; x += 3) {
      const w = Math.sin(x * 0.01 + t * 0.5 + row * 0.01) * 8;
      x === 0 ? ctx.moveTo(x, row + w) : ctx.lineTo(x, row + w);
    }
    ctx.stroke();
  }
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(74,240,192,0.35)'; ctx.shadowBlur = 40;
  ctx.font = `800 ${mobile ? 38 : 60}px 'Cabinet Grotesk',sans-serif`; ctx.fillStyle = '#fff';
  ctx.fillText('STEEL AEGIS', CX, CY - 75); ctx.shadowBlur = 0;
  ctx.font = `500 ${mobile ? 14 : 18}px 'Satoshi',sans-serif`; ctx.fillStyle = '#4af0c0';
  ctx.fillText('TowerDefence × Battleship', CX, CY - 30);
  ctx.font = `400 ${mobile ? 11 : 14}px 'Satoshi',sans-serif`; ctx.fillStyle = '#6a8aaa';
  if (mobile) {
    ctx.fillText('タップで砲台を操作。', CX, CY + 5);
    ctx.fillText('敵を撃墜し、スクラップで戦艦を強化せよ。', CX, CY + 22);
  } else {
    ctx.fillText('タップで砲台を操作。敵を撃墜し、スクラップで戦艦を強化せよ。', CX, CY + 10);
  }
  const pulse = 0.6 + Math.sin(t * 3) * 0.4;
  ctx.font = `700 ${mobile ? 16 : 20}px 'Cabinet Grotesk',sans-serif`;
  ctx.fillStyle = `rgba(255,255,255,${pulse})`;
  ctx.fillText('TAP TO START', CX, CY + (mobile ? 60 : 65));
  ctx.font = `400 ${mobile ? 10 : 12}px 'Satoshi',sans-serif`; ctx.fillStyle = '#445566';
  ctx.fillText(mobile ? 'マルチタッチで分散砲火' : 'タップ位置に砲台が向く — マルチタッチで分散砲火', CX, CY + (mobile ? 90 : 110));
  if (!mobile) { ctx.fillText('M: ミュート', CX, CY + 130); }
  ctx.restore();
}

function renderGameOver() {
  ctx.save();
  // Semi-transparent overlay so sinking ship shows through
  ctx.fillStyle = 'rgba(5,10,20,0.55)'; ctx.fillRect(0, 0, W, H);
  // Vignette — darker at edges, lighter in center where ship is
  const vig = ctx.createRadialGradient(CX, CY + 40, 50, CX, CY + 40, Math.max(W, H) * 0.6);
  vig.addColorStop(0, 'rgba(5,10,20,0)');
  vig.addColorStop(1, 'rgba(5,10,20,0.35)');
  ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // SUNK title — positioned higher so ship sinking area is visible
  ctx.shadowColor = 'rgba(255,68,102,0.6)'; ctx.shadowBlur = 40;
  ctx.font = "800 56px 'Cabinet Grotesk',sans-serif"; ctx.fillStyle = '#ff4466';
  ctx.fillText('SUNK', CX, CY - 80); ctx.shadowBlur = 0;
  ctx.font = "500 17px 'Satoshi',sans-serif"; ctx.fillStyle = '#aabbcc';
  ctx.fillText(`Wave ${G.wave + 1} まで到達`, CX, CY - 30);
  ctx.fillText(`スコア: ${G.score}  撃墜: ${G.kills}`, CX, CY);
  const pulse = 0.6 + Math.sin(G.time * 3) * 0.4;
  ctx.font = "700 18px 'Cabinet Grotesk',sans-serif";
  ctx.fillStyle = `rgba(255,255,255,${pulse})`;
  ctx.fillText('TAP TO RETRY', CX, CY + 60);
  ctx.restore();
}

function renderAnnounce() {
  if (!G.announce) return;
  G.announce.timer -= 1 / 60;
  if (G.announce.timer <= 0) { G.announce = null; return; }
  const dur = G.announce.style === 'critical' ? 2.5 : 2.5;
  const progress = 1 - G.announce.timer / dur;
  const alpha = progress < 0.1 ? progress / 0.1 : progress > 0.8 ? (1 - progress) / 0.2 : 1;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  if (G.announce.style === 'critical') {
    // Heavy red treatment — same weight as SUNK
    ctx.shadowColor = 'rgba(255,68,102,0.7)'; ctx.shadowBlur = 40;
    ctx.font = "800 56px 'Cabinet Grotesk',sans-serif";
    ctx.fillStyle = '#ff4466';
    ctx.fillText(G.announce.text, CX, CY - 55);
    // Secondary subtle outline pass for extra weight
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,68,102,0.3)'; ctx.lineWidth = 1.5;
    ctx.strokeText(G.announce.text, CX, CY - 55);
  } else {
    ctx.font = "800 44px 'Cabinet Grotesk',sans-serif"; ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 20;
    ctx.fillText(G.announce.text, CX, CY - 50);
  }
  ctx.restore();
}

function renderNotifs() {
  let y = H - 70;
  for (let i = G.notifications.length - 1; i >= 0; i--) {
    const n = G.notifications[i];
    n.timer -= 1 / 60;
    if (n.timer <= 0) { G.notifications.splice(i, 1); continue; }
    ctx.save();
    ctx.globalAlpha = Math.min(n.timer, 1);
    ctx.font = "500 14px 'Satoshi',sans-serif"; ctx.textAlign = 'center';
    ctx.fillStyle = '#4af0c0'; ctx.fillText(n.text, CX, y);
    ctx.restore();
    y -= 22;
  }
}

function renderDebug() {
  ctx.save();
  const dbg = `FPS:${fps.toFixed(0)} E:${G.enemies.length} B:${G.bullets.length} T:${G.torpedoes.length} P:${particles.length}`;
  ctx.font = '9px monospace';
  const tw = ctx.measureText(dbg).width + 8;
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(W - tw, H - 14, tw, 14);
  ctx.fillStyle = fps < 30 ? '#f44' : '#0f0';
  ctx.textAlign = 'right';
  ctx.fillText(dbg, W - 4, H - 3);
  ctx.restore();
}

function rr(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y);
  c.arcTo(x + w, y, x + w, y + r, r); c.lineTo(x + w, y + h - r);
  c.arcTo(x + w, y + h, x + w - r, y + h, r); c.lineTo(x + r, y + h);
  c.arcTo(x, y + h, x, y + h - r, r); c.lineTo(x, y + r);
  c.arcTo(x, y, x + r, y, r); c.closePath();
}

// ─── GAME LIFECYCLE ─────────────────────────────────────
function startGame() {
  G.phase = 'playing';
  G.ship.hp = G.ship.maxHp;
  G.res = { iron: 10, gunpowder: 5, electronics: 1, brass: 1 };
  initSlots();
  placeTurret(0, 'machineGun'); // bow
  placeTurret(7, 'machineGun'); // stern
  startWave(0);
}

function resetGame() {
  G.phase = 'playing';
  G.wave = 0; G.score = 0; G.kills = 0;
  G.enemies = []; G.bullets = []; G.scraps = []; G.torpedoes = [];
  G.spawnQueues = []; G.notifications = [];
  G.dmgFlash = 0; shakeAmt = 0;
  G.sink = null; G.announce = null;
  particles.length = 0;
  G.ship.hp = G.ship.maxHp;
  G.res = { iron: 10, gunpowder: 5, electronics: 1, brass: 1 };
  initSlots();
  placeTurret(0, 'machineGun');
  placeTurret(7, 'machineGun');
  startWave(0);
}

// ─── GAME LOOP ──────────────────────────────────────────
let lastT = 0, accum = 0, fps = 60, frames = 0, fpsT = 0;

function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min((ts - lastT) / 1000, 0.1);
  lastT = ts; accum += dt * 1000;
  frames++;
  if (ts - fpsT >= 1000) { fps = frames * 1000 / (ts - fpsT); frames = 0; fpsT = ts; }
  while (accum >= TICK) { update(TICK / 1000); accum -= TICK; }
  render();
}
requestAnimationFrame(loop);

// ─── TEST HOOKS ─────────────────────────────────────────
window.advanceTime = ms => {
  const steps = Math.max(1, Math.round(ms / TICK));
  for (let i = 0; i < steps; i++) update(TICK / 1000);
  render();
};
window.render_game_to_text = () => JSON.stringify({
  phase: G.phase, wave: G.wave, score: G.score,
  shipHp: G.ship.hp, enemies: G.enemies.length,
  bullets: G.bullets.length, torpedoes: G.torpedoes.length,
  scraps: G.scraps.length, resources: G.res,
  sink: G.sink ? { timer: G.sink.timer.toFixed(2), phase: G.sink.phase, yOffset: G.sink.yOffset.toFixed(1) } : null,
  turrets: G.ship.slots.filter(s => s.turret).map(s => ({
    type: s.turret.type, slot: s.id, level: s.turret.level,
    angle: (s.turret.angle / DEG).toFixed(0) + '°',
  })),
  pointers: pointers.size,
});
// Test hook: force sinking animation for QA
window.testSinking = () => {
  if (G.phase !== 'playing' && G.phase !== 'building') return;
  G.ship.hp = 0;
  G.phase = 'playing'; // ensure death check triggers
};

// Mute
addEventListener('keydown', e => {
  if (e.code === 'KeyM' && audioCtx) {
    audioCtx.state === 'running' ? audioCtx.suspend() : audioCtx.resume();
  }
});

console.log('STEEL AEGIS v2 loaded — tap to aim, multi-touch for spread fire');
