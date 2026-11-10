/* ==========================================================================
 * effects.js —— 粒子类特效的统一入口（占位实现）
 *   每种特效只有一个函数，所有调用方（main.js / supers.js）都经由这里生成特效，
 *   之后可整体替换为 Blender 模拟的序列帧（flipbook）而不改动调用方。
 *   一次性特效（spawn）：hitSpark / dustPuff / sparks / deathSmoke / superFlash / kaiBurst / miraSlash /
 *                        quakeRing / quakeDust / crackDecal / zedThrustFlash
 *   持续特效（每帧驱动，某帧未调用即隐藏）：kaiSpiral / miraTornado / brunoCharge / zedWhirlDisc / zedThrust
 *   坐标均为 three 坐标（x, 高度, y*K）。
 *   序列帧：若 flipbook.js 与 assets/vfx/vfx.json 可用（动态加载，缺失时不报错），
 *   有对应序列帧的特效改用 Blender 预渲染的 sprite sheet，否则回退到下面的代码占位实现。
 * ========================================================================== */
import * as THREE from 'three';

const ADD = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide };

function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const GLOW = canvasTex(128, 128, (g) => {
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
});
/** 柔边圆环（冲击波、风环） */
const RINGT = canvasTex(256, 256, (g) => {
  const gr = g.createRadialGradient(128, 128, 80, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.88, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
});
/** 横向光迹：左透明 → 右亮 */
const STREAK = canvasTex(256, 32, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, w, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.75, 'rgba(255,255,255,0.6)'); gr.addColorStop(0.97, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  const v = g.createLinearGradient(0, 0, 0, h);
  v.addColorStop(0, 'rgba(0,0,0,1)'); v.addColorStop(0.5, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out'; g.fillStyle = v; g.fillRect(0, 0, w, h);
});
/** 长棍残影圆盘：中心透明，外缘一圈亮，若干扇形“棍影” */
const DISC = canvasTex(256, 256, (g) => {
  g.translate(128, 128);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    g.fillStyle = `rgba(255,255,255,${0.05 + 0.25 * Math.pow(1 - i / 14, 2)})`;
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 124, a, a + 0.32); g.closePath(); g.fill();
  }
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 128);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.25, 'rgba(0,0,0,0.8)'); gr.addColorStop(0.8, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-out'; g.fillStyle = gr; g.fillRect(-128, -128, 256, 256);
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 5; g.beginPath(); g.arc(0, 0, 120, 0, Math.PI * 2); g.stroke();
});
/** 地裂贴花：放射状裂纹 + 熔岩般的内发光 */
const CRACK = canvasTex(512, 512, (g) => {
  g.translate(256, 256);
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, 120);
  glow.addColorStop(0, 'rgba(40,20,10,0.85)'); glow.addColorStop(1, 'rgba(40,20,10,0)');
  g.fillStyle = glow; g.fillRect(-256, -256, 512, 512);
  const crack = (x, y, a, len, w, depth) => {
    let px = x, py = y;
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      a += (rnd() - 0.5) * 0.7;
      const nx = px + Math.cos(a) * (len / steps), ny = py + Math.sin(a) * (len / steps);
      g.strokeStyle = 'rgba(14,8,6,0.95)'; g.lineWidth = w * (1 - i / steps) + 1;
      g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke();
      g.strokeStyle = 'rgba(255,150,60,0.55)'; g.lineWidth = Math.max(0.6, w * 0.35 * (1 - i / steps));
      g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke();
      if (depth > 0 && rnd() < 0.35) crack(nx, ny, a + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.6), len * 0.45, w * 0.6, depth - 1);
      px = nx; py = ny;
    }
  };
  g.lineCap = 'round';
  for (let i = 0; i < 11; i++) crack(0, 0, (i / 11) * Math.PI * 2 + rnd() * 0.4, 150 + rnd() * 90, 15, 2);
  g.fillStyle = 'rgba(10,6,4,0.9)'; g.beginPath(); g.arc(0, 0, 26, 0, Math.PI * 2); g.fill();
});

/** 螺旋带几何体（高度 0..1，半径随高度 0.75→1.25） */
function helixGeo(turns, width, phase) {
  const N = 96, pos = [], col = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, a = phase + u * turns * Math.PI * 2, r = 0.75 + 0.5 * u;
    const f = Math.sin(Math.PI * u);
    for (const dy of [-width / 2, width / 2]) {
      pos.push(Math.cos(a) * r, u + dy * (0.6 + u), Math.sin(a) * r);
      col.push(0.9 * f, f * (0.06 + 0.3 * u * u), f * (0.015 + 0.05 * u));   // 底部深红 → 顶部橙黄（线性色，叠加后不发白）
    }
    if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** 拖尾带：记录点的历史，生成竖直宽度的带状网格 */
class Trail {
  constructor(scene, color, n = 18, width = 9) {
    this.n = n; this.w = width; this.pts = [];
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3);
    this.col = new Float32Array(n * 2 * 3);
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo.setIndex(idx);
    this.c = new THREE.Color(color);
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ vertexColors: true, ...ADD }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
  }
  reset() { this.pts.length = 0; }
  push(p, k) {
    this.pts.unshift(p.clone());
    if (this.pts.length > this.n) this.pts.length = this.n;
    const m = this.pts.length;
    for (let i = 0; i < this.n; i++) {
      const q = this.pts[Math.min(i, m - 1)];
      const f = i < m ? Math.pow(1 - i / this.n, 1.5) * k : 0;
      const w = this.w * (0.3 + 0.7 * (1 - i / this.n));
      this.pos.set([q.x, q.y - w, q.z, q.x, q.y + w, q.z], i * 6);
      this.col.set([this.c.r * f, this.c.g * f, this.c.b * f, this.c.r * f, this.c.g * f, this.c.b * f], i * 6);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.computeBoundingSphere();
  }
}


const _p = new THREE.Vector3();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sm = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

export class Effects {
  /** fx：fx.js 的 FX（火花 / 粒子）；shake(v)：震屏 */
  constructor(scene, fx, shake) {
    this.scene = scene; this.fx = fx; this.shake = shake || (() => {});
    this.all = [];
    this.flashes = [];
    this.seen = {};       // 本帧被驱动过的持续特效
    this.loops = new Map(); // 持续序列帧：key → 句柄
    this.fb = null;       // flipbook 模块（加载完成后）
    this.smokeAt = 0;
    import('./flipbook.js').then((m) => m.loadFlipbooks().then(() => {
      this.fb = m;
      // 预热：每张 sheet 先生成一次（在场景里建好网格，下一次渲染即编译着色器、上传贴图）
      for (const n of m.flipbookNames()) m.spawnFlipbook(scene, n, { x: -9000, y: -9000, z: 0, alpha: 0, duration: 0.01 });
    })).catch(() => { /* 没有序列帧：使用占位特效 */ });
    // 闪光精灵池
    this.spritePool = [];
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      s.renderOrder = 5; this.add(s); this.spritePool.push(s);
    }
    // 冲击波圆环 + 尘墙；地裂贴花
    const wallTex = canvasTex(4, 64, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    this.rings = [];
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: RINGT, color: '#ffc04a', ...ADD }));
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 48, 1, true).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ map: wallTex, color: '#d0905a', transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      ring.renderOrder = 4; wall.renderOrder = 4;
      this.add(ring); this.add(wall);
      this.rings.push({ ring, wall, live: false });
    }
    this.cracks = [];
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: CRACK, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.renderOrder = 3; this.add(m);
      this.cracks.push({ m, live: false });
    }
    // 碎石
    this.rocks = [];
    const rockGeo = new THREE.DodecahedronGeometry(1, 0), rockMat = new THREE.MeshBasicMaterial({ color: '#4a3a34' });
    for (let i = 0; i < 24; i++) { const m = new THREE.Mesh(rockGeo, rockMat); this.add(m); this.rocks.push({ m, live: false, v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0, gy: 0 }); }
    // 凯：火焰螺旋
    this.helix = new THREE.Group();
    for (const [turns, w, ph, op] of [[2.2, 0.055, 0, 0.9], [2.2, 0.055, Math.PI, 0.9], [1.5, 0.14, Math.PI / 2, 0.35]]) {
      const m = new THREE.Mesh(helixGeo(turns, w, ph), new THREE.MeshBasicMaterial({ vertexColors: true, ...ADD }));
      m.userData.op = op; m.renderOrder = 4; this.helix.add(m);
    }
    this.add(this.helix);
    // 米拉：风环 + 双脚拖尾
    this.windRings = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: RINGT, color: '#6ff2ff', ...ADD }));
      m.renderOrder = 4; this.add(m); this.windRings.push({ m, live: false, t0: 0, big: 1 });
    }
    this.trails = [new Trail(scene, '#7ff6ff'), new Trail(scene, '#bff9ff')];
    this.trails.forEach((t) => this.all.push(t.mesh));
    // 泽德：棍影圆盘 + 突刺光迹
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ map: DISC, color: '#9dffb0', ...ADD }));
    this.disc.renderOrder = 4; this.add(this.disc);
    this.streak = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(-0.5, 0, 0), new THREE.MeshBasicMaterial({ map: STREAK, color: '#c8ffd4', ...ADD }));
    this.streak.renderOrder = 5; this.add(this.streak);
    // 预热：首帧编译完着色器后由 main.js 调用 hideAll()
    this.all.forEach((o) => { o.position.set(-600, -400, 0); o.scale.setScalar(0.01); });
  }

  add(o) { this.scene.add(o); this.all.push(o); }

  /* ---- 序列帧辅助 ---- */
  has(name) { return !!(this.fb && this.fb.getFlipbookDef(name)); }
  spawn(name, o) { return this.fb ? this.fb.spawnFlipbook(this.scene, name, o) : null; }
  /** 持续（循环）序列帧：每帧调用以保持并更新位置 / 缩放 / 透明度；某帧未调用则淡出 */
  loopFx(key, name, o) {
    this.seen['L:' + key] = true;
    let h = this.loops.get(key);
    if (!h || !h.alive || h.name !== name) {
      h = this.spawn(name, { ...o, loop: true, duration: Infinity });
      if (!h) return null;
      this.loops.set(key, h);
      h._key = key;
    }
    const d = this.fb.getFlipbookDef(name);
    const sx = o.sx != null ? o.sx : o.scale != null ? o.scale : 1, sy = o.sy != null ? o.sy : o.scale != null ? o.scale : 1;
    h.x = o.x; h.y = o.y; h.z = o.z;
    h.w = d.size * sx * (o.flipX ? -1 : 1); h.h = (d.size / d.aspect) * sy;
    if (o.rotation != null) h.rot = o.rotation;
    if (o.alpha != null) h.alpha = o.alpha;
    return h;
  }
  hideAll() { this.all.forEach((o) => { o.visible = false; }); }
  parts(p) { this.fx.parts.push(p); }

  /* ================= 一次性特效 ================= */
  /** 命中火花（big = 重击） */
  hitSpark(p, big) {
    if (this.has('hit_spark')) {
      this.spawn(big ? 'hit_heavy' : 'hit_spark', { x: p.x, y: p.y, z: p.z + 6, rotation: Math.random() * 6.28, scale: big ? 1.1 : 1 });
      // 敌人是机器人：命中时附带一小簇电火花
      if (this.has('elec_spark') && Math.random() < 0.5) this.spawn('elec_spark', { x: p.x, y: p.y, z: p.z + 8, scale: big ? 0.7 : 0.45, rotation: Math.random() * 6.28 });
      return;
    }
    this.fx.hit(p, big);
  }
  /** 脚下尘土一团（n 团，沿 dx 方向排开） */
  dustPuff(p, n = 1, dx = 0) {
    const fb = this.has('dust_puff');
    for (let i = 0; i < n; i++) {
      if (fb) this.spawn('dust_puff', { x: p.x + dx * i + (Math.random() - 0.5) * 8, y: p.y, z: p.z + 4, scale: 0.7 + Math.random() * 0.4, flipX: Math.random() < 0.5 });
      else this.fx.dust(_p.set(p.x + dx * i, p.y, p.z));
    }
  }
  /** 电火花（机器人报废） */
  sparks(p) {
    if (this.has('elec_spark')) this.spawn('elec_spark', { x: p.x, y: p.y, z: p.z + 4, scale: 0.5 + Math.random() * 0.3, rotation: Math.random() * 6.28 });
    else this.fx.zap(p);
  }
  /** 报废黑烟（占位：暗色上升粒子） */
  deathSmoke(p) {
    if (this.has('smoke_puff')) {
      const now = performance.now();
      if (now - this.smokeAt < 350) return;      // 序列帧较大：限频
      this.smokeAt = now;
      this.spawn('smoke_puff', { x: p.x, y: p.y - 15, z: p.z + 4, scale: 0.6 + Math.random() * 0.3, flipX: Math.random() < 0.5 });
      return;
    }
    this.parts({ x: p.x + (Math.random() - 0.5) * 20, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 20, vy: 40 + Math.random() * 40, vz: 0, life: 0, max: 0.7, c: [0.25, 0.22, 0.3], g: -20 });
  }
  /** 必杀起手 / 终结的爆闪 */
  superFlash(p, color, s0 = 30, s1 = 230, dur = 320) {
    if (this.has('super_flash')) { this.spawn('super_flash', { x: p.x, y: p.y, z: p.z + 6, scale: s1 / 230, tint: color, rotation: Math.random() * 6.28 }); return; }
    const s = this.spritePool.find((x) => !x.visible) || this.spritePool[0];
    s.visible = true; s.position.copy(p); s.material.color.set(color);
    this.flashes = this.flashes.filter((f) => f.s !== s);
    this.flashes.push({ s, t0: performance.now(), s0, s1, dur });
  }
  /** 凯：终结一击的火焰爆发 */
  kaiBurst(p) {
    if (this.has('kai_fire_burst')) { this.spawn('kai_fire_burst', { x: p.x, y: p.y, z: p.z + 8, scale: 1.2 }); this.spawn('hit_heavy', { x: p.x, y: p.y, z: p.z + 10, scale: 1.3 }); return; }
    this.fx.hit(p, true);
    this.superFlash(p, '#ff5a2a', 40, 300, 380);
    this.superFlash(p, '#ffe08a', 20, 160, 240);
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2, v = 200 + Math.random() * 260;
      this.parts({ x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * Math.cos(e) * v, vy: Math.sin(e) * v + 80, vz: Math.sin(a) * v * 0.4, life: 0, max: 0.5 + Math.random() * 0.4, c: [1, 0.35 + Math.random() * 0.4, 0.1], g: 200 });
    }
  }
  /** 米拉：一圈扩散的风环（每段判定一次；big 为终结） */
  miraSlash(p, big = 1) {
    if (this.has('mira_wind_slash')) { this.spawn('mira_wind_slash', { x: p.x, y: p.y, z: p.z + 6, scale: 0.7 * big, rotation: Math.random() * 6.28, flipX: Math.random() < 0.5 }); return; }
    const w = this.windRings.find((r) => !r.live) || this.windRings[0];
    Object.assign(w, { live: true, t0: performance.now(), big });
    w.m.visible = true; w.m.position.copy(p);
    w.m.rotation.set((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3);
  }
  /** 布鲁诺：地面冲击波圆环（rx：横向半径，rz：纵深半径，均为 three 单位） */
  quakeRing(p, rx, rz, big) {
    // 序列帧圆环直径 = size：按判定半径拉伸成椭圆（横向 2rx，纵深 2rz）
    if (this.has('bruno_shockwave')) { const d = this.fb.getFlipbookDef('bruno_shockwave'); this.spawn('bruno_shockwave', { x: p.x, y: p.y + 1.5, z: p.z, sx: (2 * rx) / d.size, sy: (2 * rz) / d.size, billboard: false }); return; }
    const q = this.rings.find((x) => !x.live) || this.rings[0];
    Object.assign(q, { live: true, t0: performance.now(), rx, rz, big });
    q.ring.visible = q.wall.visible = true;
    q.ring.position.set(p.x, p.y + 1.5, p.z); q.wall.position.copy(p);
  }
  /** 布鲁诺：碎石 + 尘土飞溅（spread：起始散布半径） */
  quakeDust(p, spread, n) {
    const fb = this.has('bruno_dust_blast');
    if (fb) { this.spawn('bruno_dust_blast', { x: p.x, y: p.y, z: p.z + 8, scale: spread > 60 ? 1.5 : 1.1, flipX: Math.random() < 0.5 }); n = Math.ceil(n / 2); }
    for (let i = 0; i < n; i++) {
      const rk = this.rocks.find((x) => !x.live);
      if (!rk) break;
      const a = Math.random() * Math.PI * 2, d = spread + Math.random() * 50;
      rk.live = true; rk.life = 1.4; rk.gy = p.y; rk.m.visible = true;
      rk.m.position.set(p.x + Math.cos(a) * d, p.y + 4, p.z + Math.sin(a) * d * 0.5);
      rk.v.set(Math.cos(a) * (60 + Math.random() * 120), 260 + Math.random() * 260, Math.sin(a) * 50);
      rk.w.set(Math.random() * 12, Math.random() * 12, Math.random() * 12);
      rk.m.scale.setScalar(2.5 + Math.random() * 4.5);
    }
    for (let i = 0; i < (fb ? 0 : n * 3); i++) {
      const a = Math.random() * Math.PI * 2, rr = spread * Math.random(), v = 120 + Math.random() * 260;
      this.parts({ x: p.x + Math.cos(a) * rr, y: p.y + 3, z: p.z + Math.sin(a) * rr * 0.5, vx: Math.cos(a) * v, vy: 100 + Math.random() * 280, vz: Math.sin(a) * v * 0.4,
        life: 0, max: 0.5 + Math.random() * 0.5, c: Math.random() < 0.5 ? [0.75, 0.55, 0.35] : [1, 0.7, 0.25] });
    }
  }
  /** 布鲁诺：地裂贴花（约 2.8 秒后淡出） */
  crackDecal(p, sx, sz) {
    if (this.has('bruno_crack')) { const d = this.fb.getFlipbookDef('bruno_crack'); this.spawn('bruno_crack', { x: p.x, y: p.y + 0.6, z: p.z, sx: (2 * sx) / d.size, sy: (2 * sz) / d.size, billboard: false, duration: 2.8, fadeOut: 1.0 }); return; }
    const c = this.cracks.find((x) => !x.live) || this.cracks[0];
    Object.assign(c, { live: true, t0: performance.now() });
    c.m.visible = true; c.m.position.set(p.x, p.y + 0.6, p.z); c.m.scale.set(sx, 1, sz);
  }

  /* ================= 持续特效（每帧驱动） ================= */
  /** 凯：上升的火焰螺旋。p：脚下中心；h：高度；k：强度 0..1 */
  kaiSpiral(p, h, k, time, key = '') {
    if (this.has('kai_fire_spiral')) {
      const d = this.fb.getFlipbookDef('kai_fire_spiral');
      const sy = h / (d.size / d.aspect) * 1.05;
      this.loopFx('kai' + key, 'kai_fire_spiral', { x: p.x, y: p.y, z: p.z + 6, sx: Math.max(0.9, sy * 0.6), sy, alpha: k });
      return;
    }
    this.seen.helix = true;
    this.helix.visible = true;
    this.helix.position.copy(p);
    this.helix.scale.set(40 + 5 * Math.sin(time * 20), h, 32);
    this.helix.rotation.y = -time * 16;
    this.helix.children.forEach((m) => { m.material.opacity = k * m.userData.op; });
    if (Math.random() < 0.9 * k) {
      const a = Math.random() * Math.PI * 2, y = Math.random() * h;
      this.parts({ x: p.x + Math.cos(a) * 34, y: p.y + y, z: p.z + Math.sin(a) * 28, vx: -Math.sin(a) * 90, vy: 140 + Math.random() * 120, vz: Math.cos(a) * 50,
        life: 0, max: 0.4 + Math.random() * 0.3, c: Math.random() < 0.5 ? [1, 0.45, 0.1] : [1, 0.8, 0.3], g: -60 });
    }
  }
  /** 米拉：双脚的龙卷拖尾。fl/fr：左右脚尖位置；ground：脚下地面点 */
  miraTornado(fl, fr, ground, k, base, key = '') {
    if (this.has('mira_wind_ring')) {
      const b = base || ground;
      this.loopFx('mira' + key, 'mira_wind_ring', { x: b.x, y: b.y, z: b.z + 6, scale: 0.9, alpha: k });
      return;
    }
    this.seen.tornado = true;
    this.trails[0].push(fl, k); this.trails[1].push(fr, k);
    this.trails.forEach((tr) => { tr.mesh.visible = true; });
    if (Math.random() < 0.6 * k) this.parts({ x: ground.x + (Math.random() - 0.5) * 60, y: ground.y + 2, z: ground.z + (Math.random() - 0.5) * 30, vx: (Math.random() - 0.5) * 160, vy: 40 + Math.random() * 60, vz: 0, life: 0, max: 0.4, c: [0.4, 0.9, 1], g: 0 });
  }
  /** 布鲁诺：双拳蓄力光。p：两拳中点；k：强度 */
  brunoCharge(p, k, time) {
    this.seen.charge = true;
    if (!this.chargeS || !this.chargeS.visible) this.chargeS = this.spritePool.find((x) => !x.visible);
    const s = this.chargeS;
    if (s) {
      s.visible = true; s.position.copy(p);
      const sc = (24 + 30 * k) * (1 + 0.12 * Math.sin(time * 34));
      s.scale.set(sc, sc, 1); s.material.color.set('#ffb030'); s.material.opacity = k;
    }
    if (Math.random() < 0.8) {
      const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 30;
      this.parts({ x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, z: p.z, vx: -Math.cos(a) * d * 4, vy: -Math.sin(a) * d * 4, vz: 0, life: 0, max: 0.22, c: [1, 0.8, 0.3], g: 0 });
    }
  }
  /** 泽德：长棍残影圆盘。p：圆心（手）；r：半径；q：圆盘朝向（法线为局部 +z）；k：强度 */
  zedWhirlDisc(p, r, q, k, tip, f = 1, key = '') {
    if (this.has('zed_staff_disc')) {
      const d = this.fb.getFlipbookDef('zed_staff_disc');
      this.loopFx('zed' + key, 'zed_staff_disc', { x: p.x, y: p.y, z: p.z + 8, scale: (2 * r) / d.size, flipX: f < 0, alpha: k });
      return;
    }
    this.seen.disc = true;
    this.disc.visible = true;
    this.disc.position.copy(p); this.disc.scale.set(r, r, r); this.disc.quaternion.copy(q);
    this.disc.material.opacity = 0.85 * k;
    if (tip && Math.random() < 0.5 * k) this.parts({ x: tip.x, y: tip.y, z: tip.z, vx: (Math.random() - 0.5) * 80, vy: (Math.random() - 0.5) * 80, vz: 0, life: 0, max: 0.25, c: [0.6, 1, 0.7], g: 0 });
  }
  /** 泽德：突刺光迹。tip：棍尖；f：朝向 ±1；len：长度；k：强度 */
  zedThrust(tip, f, len, k, key = '') {
    if (this.has('zed_thrust')) {
      // 一次性：突刺开始时从棍尖射出，之后跟随棍尖
      let h = this.loops.get('thrust' + key);
      this.seen['T:' + key] = true;
      if (!h || !h.alive) { if (this.thrustDone && this.thrustDone[key]) return; h = this.spawn('zed_thrust', { x: tip.x, y: tip.y, z: tip.z + 6, flipX: f < 0, scale: 0.8 }); if (!h) return; this.loops.set('thrust' + key, h); (this.thrustDone = this.thrustDone || {})[key] = true; }
      h.x = tip.x - f * 20; h.y = tip.y; h.z = tip.z + 6;
      return;
    }
    this.seen.streak = true;
    this.streak.visible = true;
    this.streak.position.set(tip.x + f * 10, tip.y, tip.z + 2);
    this.streak.scale.set(len, 26, 1);
    this.streak.rotation.set(0, f > 0 ? 0 : Math.PI, 0);
    this.streak.material.opacity = k;
  }

  /** 疾走 / 冲锋的速度线（序列帧；没有序列帧时返回 false，由 HUD 画 2D 速度线） */
  speedLines(key, p, f, k) {
    if (!this.has('speed_lines')) return false;
    this.loopFx('sl' + key, 'speed_lines', { x: p.x - f * 40, y: p.y, z: p.z + 4, scale: 0.45, flipX: f < 0, alpha: k });
    return true;
  }

  /** 每帧末调用：推进一次性特效，隐藏本帧未驱动的持续特效 */
  update(dt) {
    const now = performance.now();
    for (const [key, h] of this.loops) {
      if (key.startsWith('thrust')) {
        const k2 = key.slice(6);
        if (!this.seen['T:' + k2]) { this.loops.delete(key); if (this.thrustDone) delete this.thrustDone[k2]; }
        continue;
      }
      if (!this.seen['L:' + key] || !h.alive) { if (h.alive) h.stop(0.2); this.loops.delete(key); }
    }
    if (this.fb) this.fb.updateFlipbooks(dt);
    if (!this.seen.helix) this.helix.visible = false;
    if (!this.seen.tornado) this.trails.forEach((tr) => { tr.reset(); tr.mesh.visible = false; });
    if (!this.seen.charge && this.chargeS) { this.chargeS.visible = false; this.chargeS = null; }
    if (!this.seen.disc) this.disc.visible = false;
    if (!this.seen.streak) this.streak.visible = false;
    this.seen = {};
    this.flashes = this.flashes.filter((f) => {
      const k = (now - f.t0) / f.dur;
      if (k >= 1) { f.s.visible = false; return false; }
      const sc = f.s0 + (f.s1 - f.s0) * Math.sqrt(k);
      f.s.scale.set(sc, sc, 1); f.s.material.opacity = 1 - k * k;
      return true;
    });
    for (const w of this.windRings) {
      if (!w.live) continue;
      const k = (now - w.t0) / 380;
      if (k >= 1) { w.live = false; w.m.visible = false; continue; }
      const r = (30 + 80 * Math.sqrt(k)) * w.big;
      w.m.scale.set(r, 1, r * 0.75); w.m.material.opacity = (1 - k) * 0.95;
    }
    for (const q of this.rings) {
      if (!q.live) continue;
      const age = (now - q.t0) / 1000;
      const k = clamp(age / 0.32, 0, 1), e = 1 - (1 - k) * (1 - k);
      q.ring.scale.set(q.rx * e + 10, 1, q.rz * e + 6);
      q.ring.material.opacity = 1 - sm((age - 0.25) / 0.5);
      q.wall.scale.set(q.rx * e + 8, (q.big ? 26 : 38) * (1 - 0.5 * k), q.rz * e + 5);
      q.wall.material.opacity = 0.55 * (1 - sm((age - 0.1) / 0.45));
      if (age > 0.8) { q.live = false; q.ring.visible = false; q.wall.visible = false; }
    }
    for (const c of this.cracks) {
      if (!c.live) continue;
      const age = (now - c.t0) / 1000;
      c.m.material.opacity = 1 - sm((age - 1.6) / 1.2);
      if (age > 2.8) { c.live = false; c.m.visible = false; }
    }
    for (const rk of this.rocks) {
      if (!rk.live) continue;
      rk.life -= dt;
      rk.v.y -= 900 * dt;
      rk.m.position.addScaledVector(rk.v, dt);
      rk.m.rotation.x += rk.w.x * dt; rk.m.rotation.y += rk.w.y * dt;
      if (rk.m.position.y < rk.gy + 2) { rk.m.position.y = rk.gy + 2; rk.v.y *= -0.35; rk.v.x *= 0.6; rk.v.z *= 0.6; }
      if (rk.life <= 0) { rk.live = false; rk.m.visible = false; }
      else if (rk.life < 0.3) rk.m.scale.multiplyScalar(Math.pow(0.02, dt / 0.3));
    }
  }
}
