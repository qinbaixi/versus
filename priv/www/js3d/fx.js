/* ==========================================================================
 * fx.js —— 3D 特效：命中火花（星芒 + 飞散粒子 + 冲击环）、Boss 冲撞尘土
 * ========================================================================== */
import * as THREE from 'three';

function tex(draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  draw(cv.getContext('2d'));
  const t = new THREE.CanvasTexture(cv);
  return t;
}
const STAR = tex((g) => {
  g.translate(64, 64);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,240,180,0.9)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = gr;
  g.beginPath();
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2, r = i % 2 ? 18 : 62 - (i % 4) * 10;
    i ? g.lineTo(Math.cos(a) * r, Math.sin(a) * r) : g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath(); g.fill();
});
const RING = tex((g) => {
  g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
});
const DOT = tex((g) => {
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
});

const MAXP = 400;

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.sprites = [];
    this.live = [];
    // 粒子
    this.pg = new THREE.BufferGeometry();
    this.pp = new Float32Array(MAXP * 3);
    this.pc = new Float32Array(MAXP * 3);
    this.pg.setAttribute('position', new THREE.BufferAttribute(this.pp, 3));
    this.pg.setAttribute('color', new THREE.BufferAttribute(this.pc, 3));
    this.points = new THREE.Points(this.pg, new THREE.PointsMaterial({ size: 7, map: DOT, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.parts = [];
  }

  sprite(map, color) {
    let s = this.sprites.pop();
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ map, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true }));
      this.scene.add(s);
    }
    s.material.map = map; s.material.color.set(color); s.material.opacity = 1; s.material.rotation = Math.random() * 6;
    s.visible = true;
    return s;
  }

  /** 命中：p = THREE.Vector3（three 坐标），big = 重击 */
  hit(p, big) {
    const now = performance.now();
    const st = this.sprite(STAR, big ? '#ffd23f' : '#fff2c0');
    st.position.copy(p);
    this.live.push({ s: st, t0: now, dur: big ? 300 : 220, s0: big ? 40 : 24, s1: big ? 90 : 52, kind: 'star' });
    if (big) {
      const rg = this.sprite(RING, '#ff7a3a');
      rg.position.copy(p);
      this.live.push({ s: rg, t0: now, dur: 360, s0: 20, s1: 140, kind: 'ring' });
    }
    const n = big ? 22 : 10;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * 1.4;
      const v = (big ? 260 : 170) * (0.4 + Math.random());
      this.parts.push({ x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * v, vy: Math.sin(e) * v + 60, vz: Math.sin(a) * v * 0.5, life: 0, max: 0.25 + Math.random() * 0.3,
        c: big ? (Math.random() < 0.5 ? [1, 0.85, 0.3] : [1, 0.4, 0.15]) : [1, 0.95, 0.75] });
    }
    if (this.parts.length > MAXP) this.parts.splice(0, this.parts.length - MAXP);
  }

  /** 小火花（机器人报废时的电火花） */
  zap(p) {
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2, v = 80 + Math.random() * 90;
      this.parts.push({ x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * v, vy: Math.random() * 120, vz: Math.sin(a) * v * 0.4, life: 0, max: 0.3, c: [0.4, 0.9, 1] });
    }
  }

  dust(p) {
    for (let i = 0; i < 2; i++) {
      this.parts.push({ x: p.x + (Math.random() - 0.5) * 30, y: 3, z: p.z + (Math.random() - 0.5) * 20, vx: (Math.random() - 0.5) * 40, vy: 30 + Math.random() * 30, vz: 0, life: 0, max: 0.45, c: [0.5, 0.45, 0.6], g: 0 });
    }
  }

  update(dt) {
    const now = performance.now();
    this.live = this.live.filter((l) => {
      const k = (now - l.t0) / l.dur;
      if (k >= 1) { l.s.visible = false; this.sprites.push(l.s); return false; }
      const sc = l.s0 + (l.s1 - l.s0) * (l.kind === 'ring' ? Math.sqrt(k) : k);
      l.s.scale.set(sc, sc, 1);
      l.s.material.opacity = 1 - k * k;
      return true;
    });
    let n = 0;
    this.parts = this.parts.filter((p) => (p.life += dt) < p.max);
    for (const p of this.parts) {
      p.vy -= (p.g == null ? 520 : p.g) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 1) { p.y = 1; p.vy *= -0.3; }
      const f = 1 - p.life / p.max;
      this.pp[n * 3] = p.x; this.pp[n * 3 + 1] = p.y; this.pp[n * 3 + 2] = p.z;
      this.pc[n * 3] = p.c[0] * f; this.pc[n * 3 + 1] = p.c[1] * f; this.pc[n * 3 + 2] = p.c[2] * f;
      n++;
    }
    this.pg.setDrawRange(0, n);
    this.pg.attributes.position.needsUpdate = true;
    this.pg.attributes.color.needsUpdate = true;
  }
}
