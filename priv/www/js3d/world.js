/* ==========================================================================
 * world.js —— 3D 霓虹夜街：市中心(0..1500) → 码头(1500..2900) → 工厂(2900..4400，Boss 区 3440+)
 *   坐标：three.x = 世界 x；three.z = 世界纵深 y（0 = 街道里侧，170 = 靠近镜头）；three.y = 高度 z
 *   场景模型由 Blender 脚本生成（tools/blender/scene/，输出 assets/scene/*.glb + 贴图集），
 *   本文件按种子随机摆放模块，再按「材质 × 区块」合并几何体，绘制调用保持在很少的数量。
 *   霓虹招牌文字、光斑、雾、天空仍是程序化生成（canvas）。
 * ========================================================================== */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonRamp } from './materials.js';

export const LEN = 4400;
const FACADE_Z = -120;       // 建筑立面（人行道里侧边缘）
const CURB_Z = 58;           // 路沿（人行道 / 车道分界）
const WALK_TOP = 3.0;        // 人行道顶面高度（与 Blender 人行道模块一致）
const KIT_URL = 'assets/scene/';
const KITS = ['props', 'town', 'docks', 'factory'];
const CHUNK = 900;           // 合并区块宽度（便于视锥剔除）
const X0 = -900, X1 = LEN + 1000;
const ZONES = [
  { id: 'down', x0: -620, x1: 1500 },
  { id: 'docks', x0: 1500, x1: 2900 },
  { id: 'fact', x0: 2900, x1: X1 },
];
const PAL = {
  down:  { sky: ['#07031a', '#2a0c3e', '#6a1a5c'], fog: '#1c0b2e', road: '#3a3346', win: ['#ffd27a', '#ff9de6', '#8ff0ff'], neon: ['#ff2bd6', '#22f3ff', '#ffe45c', '#ff5a3c', '#9d5cff'], facade: '#2d1c40' },
  docks: { sky: ['#020a18', '#0a2a40', '#11586a'], fog: '#0a1f2c', road: '#2e3a44', win: ['#a8f0ff', '#ffe08a'], neon: ['#22f3ff', '#4dff9a', '#ffd84a', '#5a8cff'], facade: '#1b3442' },
  fact:  { sky: ['#0e0304', '#3a0e0a', '#8a3410'], fog: '#2a0f0a', road: '#3c3230', win: ['#ffb04a', '#ff7a2a'], neon: ['#ff5a1a', '#ffcc33', '#ff2a4a', '#22f3ff'], facade: '#3a2420' },
};
const WORDS = {
  down: ['NOODLE', 'ARCADE', 'RAMEN', 'KARAOKE', 'HOTEL', '24H', 'VOLTEX', 'PACHI', 'BAR', 'SUSHI', '拉面', '电玩', '霓虹', '酒店', '烧烤'],
  docks: ['DOCK 7', 'CARGO', 'PIER', 'FISH', 'SHIP', '码头', '仓库', 'BAIT'],
  fact: ['VOLTEX', 'DANGER', 'POWER', 'FORGE', '工厂', '高压', 'OVERCLOCK'],
};
const VWORDS = ['拉面', '电玩', '霓虹', '酒店', '烧烤', '旅馆', '寿司', '24H', 'BAR'];
const ADS = [['VOLTEX', 'ENERGY DRINK'], ['NOODLE', 'HOT · FAST · 24H'], ['ARCADE', 'INSERT COIN'], ['RAMEN', 'SINCE 2049'], ['SUSHI', 'FRESH FROM DOCK 7']];
const zoneAt = (x) => (x < 1500 ? 'down' : x < 2900 ? 'docks' : 'fact');
const isCN = (t) => /[一-鿿]/.test(t);

function rng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + f() * (hi - lo);
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  return f;
}

function canvasTex(w, h, draw, repeat) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}

/** 径向光斑贴图（地面灯光池 / 光晕） */
let _glow = null;
export function glowTex() {
  if (_glow) return _glow;
  _glow = canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  _glow.colorSpace = THREE.NoColorSpace;
  return _glow;
}

/* --------------------------------------------------------------------------
 * 招牌贴图集：所有霓虹字 / 广告牌画进一张 canvas，合并成少量网格
 * -------------------------------------------------------------------------- */
const NEON_FS = 64;
function neonSize(txt, vertical, cn) {
  const n = Array.from(txt).length;
  return vertical ? [96, n * 74 + 40] : [Math.max(160, Math.ceil(n * NEON_FS * (cn ? 1.05 : 0.72)) + 60), 120];
}
function drawNeon(g, x, y, w, h, txt, col, vertical, cn, frame = true) {
  g.save();
  g.translate(x, y);
  g.fillStyle = 'rgba(8,4,18,0.94)';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = col; g.lineWidth = 5; g.shadowColor = col; g.shadowBlur = 14;
  if (frame) g.strokeRect(8, 8, w - 16, h - 16);
  g.font = cn ? `900 ${NEON_FS}px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif` : `italic 900 ${NEON_FS}px "Arial Black",Impact,sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let pass = 0; pass < 2; pass++) {
    g.shadowBlur = pass ? 6 : 22;
    g.fillStyle = pass ? '#ffffff' : col;
    if (vertical) Array.from(txt).forEach((c, i) => g.fillText(c, w / 2, 56 + i * 74));
    else g.fillText(txt, w / 2, h / 2 + 4);
  }
  g.restore();
}
function drawAd(g, x, y, w, h, [big, small], cols) {
  g.save();
  g.translate(x, y);
  const gr = g.createLinearGradient(0, 0, w, h);
  gr.addColorStop(0, cols[0]); gr.addColorStop(1, cols[1]);
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.globalAlpha = 0.25; g.fillStyle = '#ffffff';
  for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(w * (0.15 + i * 0.16), h * 0.5, h * (0.2 + (i % 3) * 0.1), 0, Math.PI * 2); g.fill(); }
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, h * 0.72, w, h * 0.28);
  g.font = `italic 900 ${Math.round(h * 0.42)}px "Arial Black",Impact,sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 10;
  g.fillStyle = '#ffffff'; g.fillText(big, w / 2, h * 0.4);
  g.shadowBlur = 0;
  g.font = `700 ${Math.round(h * 0.15)}px Arial,sans-serif`;
  g.fillStyle = '#ffe9a8'; g.fillText(small, w / 2, h * 0.86);
  g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
  g.restore();
}
class SignAtlas {
  constructor(w = 2048, h = 2048) {
    this.cv = document.createElement('canvas');
    this.cv.width = w; this.cv.height = h;
    this.g = this.cv.getContext('2d');
    this.x = 2; this.y = 2; this.row = 0;
  }
  alloc(w, h) {
    if (this.x + w + 2 > this.cv.width) { this.x = 2; this.y += this.row + 4; this.row = 0; }
    if (this.y + h + 2 > this.cv.height) return null;
    const r = { x: this.x, y: this.y, w, h };
    this.x += w + 4; this.row = Math.max(this.row, h);
    return r;
  }
  uv(r) { const W = this.cv.width, H = this.cv.height; return [r.x / W, 1 - (r.y + r.h) / H, (r.x + r.w) / W, 1 - r.y / H]; }
  texture() {
    const t = new THREE.CanvasTexture(this.cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }
}

/** 面片（默认竖直朝 +z；horizontal = 朝上），UV 映射到 uv 矩形，可附顶点色 */
function quadGeo(w, h, uv, col, horizontal) {
  const g = new THREE.PlaneGeometry(w, h);
  if (horizontal) g.rotateX(-Math.PI / 2);
  if (uv) {
    const a = g.attributes.uv;
    for (let i = 0; i < a.count; i++) a.setXY(i, uv[0] + a.getX(i) * (uv[2] - uv[0]), uv[1] + a.getY(i) * (uv[3] - uv[1]));
  }
  if (col) {
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < c.length; i += 3) { c[i] = col.r; c[i + 1] = col.g; c[i + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  return g;
}

/** 积水：按平面范围重算 UV（使用独立的柔边贴图），并写入染色顶点色 */
function puddleUV(g, tint) {
  g.computeBoundingBox();
  const bb = g.boundingBox, p = g.attributes.position, uv = g.attributes.uv;
  const c = new THREE.Color(tint), cols = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    uv.setXY(i, (p.getX(i) - bb.min.x) / (bb.max.x - bb.min.x || 1), (p.getZ(i) - bb.min.z) / (bb.max.z - bb.min.z || 1));
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
}
let _puddle = null;
function puddleTex() {
  if (_puddle) return _puddle;
  const r = rng(99);
  _puddle = canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(64, 64, 10, 64, 64, 64);
    gr.addColorStop(0, 'rgba(14,16,30,0.85)'); gr.addColorStop(0.75, 'rgba(14,16,30,0.75)'); gr.addColorStop(1, 'rgba(14,16,30,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 7; i++) {             // 霓虹倒影：竖向光带（远端亮）
      const x = 10 + r() * 108, bw = 3 + r() * 9;
      const lg = g.createLinearGradient(0, 0, 0, h);
      lg.addColorStop(0, 'rgba(255,255,255,0.9)'); lg.addColorStop(0.6, 'rgba(255,255,255,0.25)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg; g.globalAlpha = 0.35 + r() * 0.5;
      g.fillRect(x, 0, bw, h);
    }
    g.globalAlpha = 0.5; g.fillStyle = '#ffffff';
    g.fillRect(20, 40, 88, 1.5);                 // 高光
  });
  _puddle.wrapS = _puddle.wrapT = THREE.ClampToEdgeWrapping;
  return _puddle;
}

export class World {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.root = new THREE.Group();        // 全部布景（?scenecam 调试时整体平移）
    this.scene.add(this.root);
    this.flickers = [];
    this.anim = [];
    this.buckets = new Map();
    const S = this.scene;
    S.fog = new THREE.Fog(PAL.down.fog, 3150, 6600);
    this.skyTex = {};
    for (const z of ['down', 'docks', 'fact']) {
      const P = PAL[z];
      this.skyTex[z] = canvasTex(4, 256, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, P.sky[0]); gr.addColorStop(0.55, P.sky[1]); gr.addColorStop(1, P.sky[2]);
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
      });
    }
    S.background = this.skyTex.down;
    this.zone = 'down';
    const q = new URLSearchParams(location.search).get('scenecam');
    this.debugCam = q != null && q !== '' && isFinite(+q) ? +q : null;

    // ---- 灯光
    this.hemi = new THREE.HemisphereLight('#8a7cff', '#2a1530', 1.25);
    S.add(this.hemi);
    this.key = new THREE.DirectionalLight('#ffe6f2', 2.2);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 1024);
    const sc = this.key.shadow.camera;
    Object.assign(sc, { left: -760, right: 760, top: 420, bottom: -420, near: 10, far: 2000 });
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.6;
    S.add(this.key); S.add(this.key.target);
    this.rimA = new THREE.DirectionalLight('#ff3fd0', 1.1); S.add(this.rimA); S.add(this.rimA.target);
    this.rimB = new THREE.DirectionalLight('#22d8ff', 1.0); S.add(this.rimB); S.add(this.rimB.target);
    // Boss 核心灯（常驻，避免光源数量变化导致着色器重编译）
    this.bossLight = new THREE.PointLight(0xff2040, 0, 320, 1.4);
    S.add(this.bossLight);

    this.buildBase();
    this.ready = this.loadKits()
      .then((k) => this.buildSet(k))
      .catch((e) => { console.warn('[world] 场景模型加载失败，使用简化街道', e); this.buildPlain(); });
  }

  /* ======================================================================
   * 不依赖模型的部分：路面、远景天际线、月亮、水面
   * ====================================================================== */
  buildBase() {
    const R = this.root;
    const r = rng(4242);
    // 远景天际线（canvas 剪影）
    for (const zd of ZONES) {
      const P = PAL[zd.id];
      const x1 = Math.min(zd.x1, LEN + 500);
      const tex = canvasTex(1024, 256, (g, w, h) => {
        let x = 0;
        while (x < w) {
          const bw = 30 + r() * 70, bh = 60 + r() * (zd.id === 'docks' ? 90 : 180);
          g.fillStyle = P.facade; g.globalAlpha = 1;
          g.fillRect(x, h - bh, bw - 2, bh);
          g.fillStyle = r.pick(P.win);
          for (let yy = h - bh + 6; yy < h - 4; yy += 9) for (let xx = x + 3; xx < x + bw - 6; xx += 7) if (r() < 0.16) { g.globalAlpha = 0.5 + r() * 0.4; g.fillRect(xx, yy, 3, 3); }
          x += bw;
        }
        g.globalAlpha = 1;
        if (zd.id === 'docks') { g.fillStyle = '#0a1a26'; for (const cx of [200, 640]) { g.fillRect(cx, 40, 10, 216); g.fillRect(cx - 120, 40, 260, 8); g.fillRect(cx + 120, 48, 4, 60); } }
        if (zd.id === 'fact') { g.fillStyle = '#1e0a08'; for (const cx of [150, 420, 800]) g.fillRect(cx, 20, 26, 236); }
      });
      const w = x1 - zd.x0 + 400;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.4, w * 1.4 * 0.25), new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false, depthWrite: false }));
      m.position.set((zd.x0 + x1) / 2, w * 0.175 + 120, -1500);
      R.add(m);
    }
    // 月亮（跟随镜头，放在场景根下）
    const moon = new THREE.Mesh(new THREE.CircleGeometry(70, 32), new THREE.MeshBasicMaterial({ color: '#ffe6f6', fog: false }));
    moon.position.set(900, 760, -1700); this.scene.add(moon);
    this.moon = moon;
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), new THREE.MeshBasicMaterial({ map: glowTex(), color: '#ff7ae0', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    halo.position.set(900, 760, -1705); this.scene.add(halo);
    this.halo = halo;
    // 码头水面（动画贴图）
    const wt = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#081622'; g.fillRect(0, 0, w, h);
      const cols = ['#22f3ff', '#ff2bd6', '#ffe45c', '#5a8cff'];
      for (let i = 0; i < 160; i++) {
        g.globalAlpha = 0.1 + r() * 0.35;
        g.fillStyle = r() < 0.7 ? '#3a6a8a' : r.pick(cols);
        g.fillRect(r() * w, r() * h, 8 + r() * 40, 1 + r() * 1.5);
      }
    }, true);
    wt.repeat.set(10, 6);
    this.waterTex = wt;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(2200, 2400), new THREE.MeshBasicMaterial({ map: wt, color: '#9ab8d0' }));
    water.rotation.x = -Math.PI / 2; water.position.set(2200, -24, -340 - 1200);
    R.add(water);
  }

  /** 加载 Blender 生成的模型包与贴图集 */
  async loadKits() {
    const tl = new THREE.TextureLoader();
    const gl = new GLTFLoader();
    const [atlas, atlasE, asphalt, ...gltfs] = await Promise.all([
      tl.loadAsync(KIT_URL + 'atlas.png'), tl.loadAsync(KIT_URL + 'atlas_e.png'), tl.loadAsync(KIT_URL + 'asphalt.png'),
      ...KITS.map((k) => gl.loadAsync(KIT_URL + k + '.glb')),
    ]);
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    for (const t of [atlas, atlasE]) { t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.needsUpdate = true; }
    asphalt.colorSpace = THREE.SRGBColorSpace; asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping; asphalt.anisotropy = aniso;
    const mods = {};
    for (const g of gltfs) {
      g.scene.updateMatrixWorld(true);
      for (const node of g.scene.children) {
        const m = { name: node.name, d: node.userData || {}, parts: [], anchors: [] };
        node.traverse((o) => {
          if (o.isMesh) m.parts.push({ geo: o.geometry, mat: o.material.name, mtx: o.matrixWorld.clone() });
          else if (o.userData && o.userData.anchor) m.anchors.push({ kind: o.userData.anchor, d: o.userData, pos: o.getWorldPosition(new THREE.Vector3()) });
        });
        mods[node.name] = m;
      }
    }
    return { atlas, atlasE, asphalt, mods };
  }

  /* ======================================================================
   * 摆放与合并
   * ====================================================================== */
  /** 放置一个模块（原点 = 底面中心 / 立面前沿中心），返回变换后的锚点 */
  place(name, x, y, z, o = {}) {
    const m = this.mods[name];
    if (!m) { console.warn('[world] 缺少模块', name); return []; }
    const M = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.ry || 0),
      new THREE.Vector3(o.sx || 1, o.sy || 1, o.sz || 1));
    const T = new THREE.Matrix4();
    for (const p of m.parts) {
      const g = p.geo.clone().applyMatrix4(T.multiplyMatrices(M, p.mtx));
      let mat = p.mat;
      if (mat === 'atlas' && o.cast) mat = 'props';
      if (mat === 'puddle') puddleUV(g, o.tint || '#ffffff');
      this.addGeo(o.bucket || mat, x, g);
    }
    return m.anchors.map((a) => ({ kind: a.kind, d: a.d, pos: a.pos.clone().applyMatrix4(M) }));
  }

  addGeo(mat, x, g) {
    const key = mat + '|' + Math.floor((x - X0) / CHUNK);
    let b = this.buckets.get(key);
    if (!b) { b = { mat, list: [] }; this.buckets.set(key, b); }
    b.list.push(g);
  }

  flush() {
    for (const b of this.buckets.values()) {
      const geo = mergeGeometries(b.list, false);
      for (const g of b.list) g.dispose();
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, this.mats[b.mat]);
      mesh.matrixAutoUpdate = false;
      if (b.mat === 'props') { mesh.castShadow = true; mesh.receiveShadow = true; }
      else if (b.mat === 'atlas' || b.mat === 'fence') mesh.receiveShadow = true;
      if (b.mat === 'fx' || b.mat === 'cone' || b.mat === 'puddle') mesh.renderOrder = 1;
      this.root.add(mesh);
    }
    this.buckets.clear();
  }

  /** 地面光池（合并） */
  pool(x, z, w, d, col, op, y = WALK_TOP + 0.25) {
    const c = new THREE.Color(col).multiplyScalar(op);
    const g = quadGeo(w, d, null, c, true); g.translate(x, y, z);
    this.addGeo('fx', x, g);
  }
  /** 立面光晕（合并，面向镜头） */
  glow(x, y, z, w, h, col, op) {
    const c = new THREE.Color(col).multiplyScalar(op);
    const g = quadGeo(w, h, null, c); g.translate(x, y, z);
    this.addGeo('fx', x, g);
  }

  buildSet(k) {
    this.mods = k.mods;
    const ramp = toonRamp();
    const base = { map: k.atlas, emissiveMap: k.atlasE, emissive: 0xffffff, gradientMap: ramp };
    const atlasMat = new THREE.MeshToonMaterial({ ...base, emissiveIntensity: 0.9 });
    this.mats = {
      atlas: atlasMat,
      props: atlasMat,
      far: new THREE.MeshLambertMaterial({ map: k.atlas, emissiveMap: k.atlasE, emissive: 0xffffff, emissiveIntensity: 0.38, color: '#7a7494' }),
      fence: new THREE.MeshToonMaterial({ map: k.atlas, gradientMap: ramp, alphaTest: 0.5, side: THREE.DoubleSide }),
      puddle: new THREE.MeshBasicMaterial({ map: puddleTex(), vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      fx: new THREE.MeshBasicMaterial({ map: glowTex(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      cone: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    };
    this.signAtlas = new SignAtlas();
    this.signQuads = [];   // 等贴图集画完再生成网格
    const r = rng(20240611);
    this.buildRoad(k.asphalt, r);
    this.buildDowntown(r);
    this.buildDocks(r);
    this.buildFactory(r);
    this.buildLamps(r);
    this.buildStreetProps(r);
    this.buildSigns();
    this.flush();
  }

  /* ---------------------------------------------------------------- 地面 */
  buildRoad(asphalt, r) {
    const R = this.root;
    for (const z of ZONES) {
      const x0 = Math.max(X0, z.x0 - (z.id === 'down' ? 300 : 0)), x1 = z.id === 'fact' ? X1 : z.x1;
      const w = x1 - x0;
      const t = asphalt.clone(); t.needsUpdate = true; t.repeat.set(w / 260, 900 / 260);
      const road = new THREE.Mesh(new THREE.PlaneGeometry(w, 900), new THREE.MeshLambertMaterial({ color: PAL[z.id].road, map: t }));
      road.rotation.x = -Math.PI / 2; road.position.set((x0 + x1) / 2, 0, CURB_Z + 450);
      road.receiveShadow = true; R.add(road);
    }
    // 人行道模块（每 200 一段）
    for (let x = X0 + 100; x < X1; x += 200) {
      const z = zoneAt(x);
      this.place(z === 'down' ? 'walk_town' : z === 'docks' ? 'walk_dock' : 'walk_fact', x, 0, FACADE_Z);
    }
    // 立面后的窄条地面（建筑退线 / 缝隙处不露底）
    const back = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, 60), new THREE.MeshLambertMaterial({ color: '#2a2434' }));
    back.rotation.x = -Math.PI / 2; back.position.set((X0 + X1) / 2, WALK_TOP - 0.2, FACADE_Z - 30);
    R.add(back);
    // 车道线、斑马线、井盖、雨水口
    for (let x = X0; x < X1; x += 130) {
      this.place('dash', x, 0.2, 420);
      this.place('dash', x + 40, 0.2, 700);
    }
    for (const cx of [700, 2250, 3300]) this.place('zebra', cx, 0.25, CURB_Z + 170);
    for (let x = X0 + 200; x < X1; x += r.range(380, 620)) this.place('manhole', x, 0.05, r.range(140, 320));
    for (let x = X0 + 80; x < X1; x += 300) this.place('drain', x, 0.1, CURB_Z + 8);
    // 积水（倒映霓虹）
    for (let x = X0 + 150; x < X1; x += r.range(260, 520)) {
      const onWalk = r() < 0.25;
      const s = r.range(0.6, 1.3);
      this.place('puddle' + Math.floor(r() * 3), x, onWalk ? WALK_TOP + 0.15 : 0.3, onWalk ? r.range(-80, 20) : r.range(80, 330),
        { sx: s * 1.3, sz: s * r.range(1.2, 1.8), ry: r() < 0.5 ? 0 : Math.PI, tint: r.pick(PAL[zoneAt(x)].neon) });
    }
  }

  /* ---------------------------------------------------------------- 立面锚点 → 招牌 / 光 */
  dress(anchors, zone, r) {
    for (const a of anchors) {
      const p = a.pos, d = a.d;
      switch (a.kind) {
        case 'sign_h': {
          if (!d.small && r() < 0.12) break;
          const txt = d.small ? r.pick(['DANGER', '高压', 'NO ENTRY']) : r.pick(WORDS[zone]);
          this.addSign(txt, r.pick(PAL[zone].neon), false, p, d.w, d.h, r);
          break;
        }
        case 'sign_v': {
          if (r() < 0.25) break;
          this.place('signframe_v', p.x, p.y, p.z - 8, { sx: d.w / 40, sy: d.h / 100 });
          this.addSign(r.pick(VWORDS), r.pick(PAL[zone].neon), true, new THREE.Vector3(p.x, p.y, p.z + 0.8), d.w * 0.86, d.h * 0.9, r);
          break;
        }
        case 'billboard': {
          const ad = r.pick(ADS);
          const cols = r.pick([['#ff2bd6', '#5a1aa0'], ['#22c8ff', '#1a2a80'], ['#ffb02a', '#c02a4a']]);
          this.signQuads.push({ ad, cols, x: p.x, y: p.y, z: p.z + 0.3, w: d.w, h: d.h });
          this.glow(p.x, p.y, p.z + 2, d.w * 1.3, d.h * 1.6, cols[0], 0.22);
          break;
        }
        case 'shoplight':
          this.pool(p.x, FACADE_Z + 44, d.w * 1.1, 90, d.col, 0.24);
          this.glow(p.x, p.y, p.z + 3, d.w * 1.2, 120, d.col, 0.12);
          break;
        case 'walllight':
          this.glow(p.x, p.y - 2, p.z + 2, 46, 34, d.col, 0.55);
          if (p.z > FACADE_Z - 30) this.pool(p.x, FACADE_Z + 30, 110, 70, d.col, 0.2);
          break;
        case 'furnace':
          this.glowPanel(p.x, p.y, p.z, d.w, d.h, d.col);
          this.pool(p.x, FACADE_Z + 40, d.w * 2, 90, d.col, 0.3);
          break;
        case 'blink': case 'beacon': this.blinker(p, d.col, a.kind === 'beacon' ? 70 : 36, a.kind === 'beacon' ? 3 : r.range(0.6, 1.2), r() * 6); break;
        case 'flood':
          this.glow(p.x, p.y, p.z + 4, 120, 50, d.col, 0.7);
          this.pool(p.x, p.z + 120, 360, 240, d.col, 0.25, WALK_TOP + 0.3);
          break;
        default: break;
      }
    }
  }

  addSign(txt, col, vertical, p, maxW, maxH, r) {
    const cn = isCN(txt);
    const [tw, th] = neonSize(txt, vertical, cn);
    const ar = tw / th;
    let h = Math.min(maxH, maxW / ar), w = h * ar;
    if (!vertical) { h = Math.min(maxH, Math.max(16, maxW / ar)); w = Math.min(maxW, h * ar); }
    this.signQuads.push({ txt, col, vertical, cn, tw, th, x: p.x, y: p.y, z: p.z + 0.4, w, h, flick: r() < 0.25, ph: r() * 10, sp: r.range(0.6, 2.5) });
    this.glow(p.x, p.y, p.z + 1.2, w * 1.6, h * 2.2, col, 0.32);
    this.pool(p.x, FACADE_Z + 36, w * 1.3, 70, col, 0.13);
  }

  buildSigns() {
    const A = this.signAtlas;
    for (const s of this.signQuads) {
      if (s.ad) {
        s.rect = A.alloc(512, Math.round(512 * s.h / s.w));
        if (s.rect) drawAd(A.g, s.rect.x, s.rect.y, s.rect.w, s.rect.h, s.ad, s.cols);
      } else {
        s.rect = A.alloc(s.tw, s.th);
        if (s.rect) drawNeon(A.g, s.rect.x, s.rect.y, s.tw, s.th, s.txt, s.col, s.vertical, s.cn);
      }
    }
    const tex = A.texture();
    this.signMat = new THREE.MeshBasicMaterial({ map: tex });
    this.mats.sign = this.signMat;
    for (const s of this.signQuads) {
      if (!s.rect) continue;
      const g = quadGeo(s.w, s.h, A.uv(s.rect));
      g.translate(s.x, s.y, s.z);
      if (s.flick) {
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex }));
        const gl = new THREE.Mesh(new THREE.PlaneGeometry(s.w * 1.7, s.h * 2.2), new THREE.MeshBasicMaterial({ map: glowTex(), color: s.col, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
        gl.position.set(s.x, s.y, s.z + 1);
        this.root.add(m, gl);
        this.flickers.push({ m, glow: gl, ph: s.ph, sp: s.sp, base: 0.45 });
      } else this.addGeo('sign', s.x, g);
    }
  }

  glowPanel(x, y, z, w, h, col) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(w * 2.2, h * 2.2), new THREE.MeshBasicMaterial({ map: glowTex(), color: col, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.position.set(x, y, z + 1); this.root.add(g);
    this.anim.push({ kind: 'furnace', m: g, ph: x * 0.01 });
  }

  blinker(p, col, size, sp, ph) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.position.copy(p); s.scale.set(size, size, 1);
    this.root.add(s);
    this.anim.push({ kind: 'blink', m: s, sp, ph });
  }

  /** 依次摆放立面模块，返回 [{name, x0, x1, wz}] */
  row(seq, x, xEnd, r, zone) {
    const out = [];
    for (const item of seq) {
      if (x >= xEnd) break;
      const name = typeof item === 'string' ? item : item.name;
      const m = this.mods[name];
      if (!m) continue;
      const w = m.d.w;
      const setback = item.setback != null ? item.setback : (m.d.kind === 'facade' ? Math.round(r.range(0, 14)) : 0);
      const wz = FACADE_Z - setback;
      const anchors = this.place(name, x + w / 2, 0, wz);
      this.dress(anchors, zone, r);
      out.push({ name, x0: x, x1: x + w, wz, kind: m.d.kind });
      x += w;
    }
    return out;
  }

  /* ---------------------------------------------------------------- 市中心 */
  buildDowntown(r) {
    const types = ['town_a', 'town_b', 'town_c', 'town_d', 'town_e', 'town_f', 'town_g', 'town_h'];
    const seq = [];
    let bag = [], last = null, x = -640;
    while (x < 1500) {
      let name;
      if (last && last !== 'alley' && r() < 0.22) name = 'alley';
      else {
        if (!bag.length) bag = types.slice().sort(() => r() - 0.5);
        name = bag.pop();
        if (name === last && bag.length) { bag.unshift(name); name = bag.pop(); }
      }
      seq.push(name); last = name;
      x += this.mods[name] ? this.mods[name].d.w : 300;
    }
    const placed = this.row(seq, -640, 1500, r, 'down');
    // 中景高楼（从矮楼的楼顶上方露出）
    for (let tx = -700; tx < 1700; tx += r.range(230, 330)) {
      this.place(r.pick(['tower_a', 'tower_b', 'tower_c']), tx, 0, r.range(-470, -420), { bucket: 'far' });
    }
    // 建筑前的小物件
    for (const b of placed) {
      if (b.kind === 'alley') {
        this.place(r() < 0.5 ? 'dumpster_g' : 'dumpster_b', (b.x0 + b.x1) / 2, WALK_TOP, b.wz - 50, { cast: true, ry: Math.PI / 2, sx: 0.85, sz: 0.85 });
        this.place('boxes' + (1 + Math.floor(r() * 2)), (b.x0 + b.x1) / 2, WALK_TOP, b.wz - 10, { cast: true });
        continue;
      }
      for (const side of [0, 1]) {
        if (r() < 0.45) continue;
        const px = side ? b.x1 - r.range(26, 44) : b.x0 + r.range(26, 44);
        const k = r.pick(['vend_red', 'vend_blue', 'boxes1', 'boxes2', 'bin', 'dumpster_g', 'tree', 'bench', 'booth', 'vend_blue']);
        const depth = { vend_red: 15, vend_blue: 15, dumpster_g: 22, tree: 24, bench: 12, booth: 24 }[k] || 16;
        this.place(k, px, WALK_TOP, b.wz + depth + 1, { cast: true });
      }
    }
  }

  /* ---------------------------------------------------------------- 码头 */
  buildDocks(r) {
    const seq = ['wh_b', 'quay', 'wh_a', 'quay'];
    const placed = this.row(seq, 1500, 2900, r, 'docks');
    const ctype = ['ct_red', 'ct_blue', 'ct_yellow', 'ct_green'];
    for (const b of placed) {
      const cx = (b.x0 + b.x1) / 2;
      if (b.name === 'quay') {
        // 集装箱堆
        for (const [sx, sz, n] of [[b.x0 + 90, -190, 2], [b.x1 - 95, -270, 3]]) {
          for (let i = 0; i < n; i++) {
            const lvl = i < 2 ? 0 : 1;
            this.place(r.pick(ctype), sx + (lvl ? 30 : 0), WALK_TOP + lvl * 64, sz - (lvl ? 0 : i * 64), { cast: true, ry: r() < 0.5 ? 0 : Math.PI });
          }
        }
        this.dress(this.place('crane', cx + 10, WALK_TOP, -230), 'docks', r);
        this.dress(this.place('boat', cx - 40, -34, -470), 'docks', r);
        this.dress(this.place('stall', cx - 60, WALK_TOP, FACADE_Z + 36, { cast: true }), 'docks', r);
        this.dress(this.place('mast', b.x1 - 30, WALK_TOP, -150), 'docks', r);
        this.place('bollard', b.x0 + 40, WALK_TOP, FACADE_Z + 20, { cast: true });
      } else {
        for (const [px, k] of [[b.x0 + 40, r.pick(['crate34', 'pallet', 'drum_b'])], [b.x1 - 50, r.pick(['crate26', 'drum_r', 'boxes2'])]]) {
          this.place(k, px, WALK_TOP, b.wz + 24, { cast: true });
          if (k.startsWith('crate') && r() < 0.6) this.place('crate26', px + 4, WALK_TOP + (k === 'crate34' ? 34 : 26), b.wz + 24, { cast: true, ry: 0.3 });
        }
      }
    }
    // 远处的起重机剪影
    this.dress(this.place('crane', 2550, WALK_TOP, -900, { bucket: 'far' }), 'docks', r);
  }

  /* ---------------------------------------------------------------- 工厂 / Boss 门 */
  buildFactory(r) {
    const gx = 3920;
    const gate = this.mods.gate;
    const gw = gate ? gate.d.w : 620;
    const pre = this.row(['fw_b', 'fw_a'], 2900, gx - gw / 2 + 10, r, 'fact');
    const post = this.row(['yard', 'fw_a', 'fw_b', 'yard'], gx + gw / 2, X1, r, 'fact');
    for (const b of [...pre, ...post]) {
      if (b.name === 'yard') continue;
      for (const px of [b.x0 + 36, b.x1 - 40]) {
        if (r() < 0.35) continue;
        const k = r.pick(['drum_r', 'drum_y', 'pallet', 'crate34', 'elecbox', 'jersey_stripe']);
        this.place(k, px, WALK_TOP, b.wz + (k === 'jersey_stripe' ? 18 : 22), { cast: true });
        if (k.startsWith('drum')) this.place(r.pick(['drum_r', 'drum_y', 'drum_b']), px + 24, WALK_TOP, b.wz + 30, { cast: true });
      }
    }
    // Boss 大门：单独网格（招牌可闪烁）
    if (gate) {
      this.gateMat = this.mats.atlas.clone();
      for (const p of gate.parts) {
        const m = new THREE.Mesh(p.geo, p.mat === 'atlas' ? this.gateMat : this.mats[p.mat]);
        m.applyMatrix4(new THREE.Matrix4().makeTranslation(gx, 0, FACADE_Z + 2).multiply(p.mtx));
        m.receiveShadow = true;
        this.root.add(m);
      }
      for (const a of gate.anchors) {
        const p = a.pos.clone().add(new THREE.Vector3(gx, 0, FACADE_Z + 2));
        if (a.kind === 'gatesign') {
          const glow = new THREE.Mesh(new THREE.PlaneGeometry(a.d.w * 1.9, a.d.h * 3), new THREE.MeshBasicMaterial({ map: glowTex(), color: a.d.col, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
          glow.position.set(p.x, p.y, p.z + 3); this.root.add(glow);
          this.flickers.push({ mat: this.gateMat, glow, ph: 0, sp: 0.3, base: 0.5 });
          this.pool(gx, CURB_Z - 20, 640, 170, a.d.col, 0.24);
        } else this.dress([{ ...a, pos: p }], 'fact', r);
      }
      this.place('barrier', gx - 200, WALK_TOP, FACADE_Z + 40, { cast: true });
      this.place('cone', gx + 180, WALK_TOP, FACADE_Z + 36, { cast: true });
      this.place('cone', gx + 210, WALK_TOP, FACADE_Z + 46, { cast: true });
    }
    for (const sx of [3150, 3700, 4700]) this.dress(this.place('stack', sx, 0, r.range(-760, -620), { bucket: 'far' }), 'fact', r);
  }

  /* ---------------------------------------------------------------- 路灯 */
  buildLamps(r) {
    const pz = CURB_Z - 8;
    for (let x = 120; x < LEN + 800; x += 380) {
      const z = zoneAt(x);
      const anchors = this.place(z === 'down' ? 'lamp_town' : z === 'docks' ? 'lamp_dock' : 'lamp_fact', x, WALK_TOP, pz, { cast: true });
      for (const a of anchors) {
        if (a.kind !== 'light') continue;
        const p = a.pos, col = a.d.col;
        this.pool(p.x, p.z + 16, 180, 130, col, 0.5, 0.35);
        const cone = new THREE.ConeGeometry(68, p.y - 6, 20, 1, true);
        cone.deleteAttribute('uv'); cone.deleteAttribute('normal');
        const c = new THREE.Color(col), pa = cone.attributes.position, hh = (p.y - 6) / 2;
        const cols = new Float32Array(pa.count * 3);
        for (let i = 0; i < pa.count; i++) {        // 光锥：灯头处亮，往下渐隐
          const k = 0.012 + 0.05 * Math.pow((pa.getY(i) + hh) / (2 * hh), 1.6);
          cols[i * 3] = c.r * k; cols[i * 3 + 1] = c.g * k; cols[i * 3 + 2] = c.b * k;
        }
        cone.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        cone.translate(p.x, (p.y - 6) / 2, p.z + 2);
        this.addGeo('cone', p.x, cone);
        this.glow(p.x, p.y - 2, p.z + 3, 64, 40, col, 0.8);
      }
    }
  }

  /* ---------------------------------------------------------------- 路沿小物件 */
  buildStreetProps(r) {
    for (let x = 60; x < LEN + 600; x += r.range(170, 330)) {
      const dl = ((x - 120) % 380 + 380) % 380;
      if (dl < 40 || dl > 340) continue;   // 避开路灯
      const z = zoneAt(x);
      const k = z === 'down' ? r.pick(['hydrant', 'bin', 'hydrant', 'cone']) : z === 'docks' ? r.pick(['bollard', 'bollard', 'drum_b', 'cone']) : r.pick(['cone', 'drum_y', 'hydrant', 'cone']);
      if (x > 3600 && x < 4240) continue;   // Boss 大门前保持干净
      this.place(k, x, WALK_TOP, CURB_Z - 16, { cast: true });
      if (k === 'cone' && r() < 0.6) this.place('cone', x + 22, WALK_TOP, CURB_Z - 22, { cast: true });
    }
  }

  /** 模型加载失败时的简化街道（保证能玩） */
  buildPlain() {
    const walk = new THREE.Mesh(new THREE.BoxGeometry(X1 - X0, WALK_TOP, CURB_Z - FACADE_Z), new THREE.MeshLambertMaterial({ color: '#463c58' }));
    walk.position.set((X0 + X1) / 2, WALK_TOP / 2, (CURB_Z + FACADE_Z) / 2); walk.receiveShadow = true;
    const road = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, 900), new THREE.MeshLambertMaterial({ color: '#25202e' }));
    road.rotation.x = -Math.PI / 2; road.position.set((X0 + X1) / 2, 0, CURB_Z + 450); road.receiveShadow = true;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, 600), new THREE.MeshLambertMaterial({ color: '#2d1c40' }));
    wall.position.set((X0 + X1) / 2, 300, FACADE_Z);
    this.root.add(walk, road, wall);
  }

  /** 某纵深（three z）处的地面高度：人行道顶面 WALK_TOP，车道 0，路沿处平滑过渡 */
  groundAt(z) {
    const top = WALK_TOP, a = CURB_Z - 7, b = CURB_Z + 3;
    if (z <= a) return top;
    if (z >= b) return 0;
    const k = (z - a) / (b - a);
    return top * (1 - k * k * (3 - 2 * k));
  }

  /** 每帧：根据镜头位置调整光照 / 雾 / 天空，招牌闪烁 */
  update(camX, time) {
    const real = camX + 480;
    const view = this.debugCam != null ? this.debugCam : camX;
    this.root.position.x = camX - view;    // ?scenecam=<x>：把该处布景挪到镜头前（调试截图用）
    const cx = view + 480;
    // 阴影相机跟随（灯光在场景坐标系，跟随真实镜头）
    this.key.position.set(real - 260, 700, 760);
    this.key.target.position.set(real, 0, 180);
    this.rimA.position.set(real - 500, 260, -500); this.rimA.target.position.set(real, 40, 80);
    this.rimB.position.set(real + 500, 260, -400); this.rimB.target.position.set(real, 40, 80);
    const z = zoneAt(cx);
    if (z !== this.zone) { this.zone = z; this.scene.background = this.skyTex[z]; }
    const blend = (a, b, t) => new THREE.Color(PAL[a].fog).lerp(new THREE.Color(PAL[b].fog), t);
    let fc;
    if (cx < 1300) fc = new THREE.Color(PAL.down.fog);
    else if (cx < 1700) fc = blend('down', 'docks', (cx - 1300) / 400);
    else if (cx < 2700) fc = new THREE.Color(PAL.docks.fog);
    else if (cx < 3100) fc = blend('docks', 'fact', (cx - 2700) / 400);
    else fc = new THREE.Color(PAL.fact.fog);
    this.scene.fog.color.copy(fc);
    const hemiSky = { down: '#8a7cff', docks: '#6ab8ff', fact: '#ff9a6a' }[z];
    this.hemi.color.lerp(new THREE.Color(hemiSky), 0.05);
    this.moon.position.x = this.halo.position.x = real + 300;
    if (this.waterTex) { this.waterTex.offset.x = time * 0.004; this.waterTex.offset.y = Math.sin(time * 0.5) * 0.01; }
    for (const f of this.flickers) {
      const v = Math.sin(time * f.sp * 7 + f.ph) + Math.sin(time * f.sp * 13.1 + f.ph * 2);
      const on = v > -1.3 ? 1 : 0.25;
      if (f.m) f.m.material.color.setScalar(on);
      if (f.mat) f.mat.emissiveIntensity = 0.9 * on;
      f.glow.material.opacity = f.base * on;
    }
    for (const a of this.anim) {
      if (a.kind === 'blink') a.m.material.opacity = Math.sin(time * a.sp * 4 + a.ph) > 0.2 ? 0.95 : 0.12;
      else if (a.kind === 'furnace') a.m.material.opacity = 0.38 + 0.1 * Math.sin(time * 5 + a.ph) + 0.06 * Math.sin(time * 13 + a.ph * 3);
    }
  }
}
