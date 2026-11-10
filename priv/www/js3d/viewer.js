/* ==========================================================================
 * viewer.js —— 调试用模型查看器：index.html?viewer=1
 *   参数：focus=kai|mira|bruno|zed|grunt|spark|brute|thrower|boss（特写某个角色）
 *         s=状态（如 attack）cb=连击段 t=状态内 tick  spin=0 关闭转台  ry=固定朝向(弧度)
 * ========================================================================== */
import * as THREE from 'three';
import { loadAll } from './assets.js';
import * as Chars from './chars.js';
import { SHARED } from './materials.js';
import { Anim, superZ } from './anim.js';

export async function runViewer() {
  const q = new URLSearchParams(location.search);
  document.body.classList.add('viewer');
  const W = () => window.innerWidth, H = () => window.innerHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W(), H());
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1a1430');
  scene.fog = new THREE.Fog('#1a1430', 600, 1400);
  const hemi = new THREE.HemisphereLight('#9a8cff', '#2a1838', 1.1);
  scene.add(hemi);
  const key = new THREE.DirectionalLight('#fff1e0', 2.4);
  key.position.set(-120, 260, 300);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -500, right: 500, top: 300, bottom: -100, near: 10, far: 1200 });
  scene.add(key);
  const rimL = new THREE.DirectionalLight('#ff3fd0', 1.6); rimL.position.set(-300, 120, -300); scene.add(rimL);
  const rimR = new THREE.DirectionalLight('#22d8ff', 1.4); rimR.position.set(300, 140, -250); scene.add(rimR);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 64), new THREE.MeshStandardMaterial({ color: '#2a2440', roughness: 0.8 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const grid = new THREE.GridHelper(1600, 40, '#5a3cff', '#3a2a70'); grid.position.y = 0.2; scene.add(grid);

  const info = document.createElement('div');
  info.style.cssText = 'position:fixed;left:10px;top:8px;color:#ffe45c;font:bold 14px sans-serif;text-shadow:1px 1px 0 #000;z-index:5';
  info.textContent = 'Neon Knuckles · 模型查看器 · 加载中…';
  document.body.appendChild(info);

  const A = await loadAll();
  Chars.init(A);
  const focus = q.get('focus');
  const sheet = q.get('sheet');
  if (sheet) return runSheet(scene, renderer, sheet, q, info);
  if (q.get('seq')) return runSeq(scene, renderer, q.get('seq'), q, info);
  if (q.get('clipsheet')) return runClipSheet(scene, renderer, q.get('clipsheet'), q, info, A);
  const list = focus ? [focus] : ['kai', 'mira', 'bruno', 'zed', 'grunt', 'spark', 'brute', 'thrower', 'boss'];
  const actors = [];
  const heroes = ['kai', 'mira', 'bruno', 'zed'];
  list.forEach((id, i) => {
    const isHero = heroes.includes(id);
    const a = isHero ? Chars.createHero(id, scene) : Chars.createRobot(id, scene);
    const brain = new Anim(a);
    let x = 0, z = 0;
    if (!focus) {
      if (isHero) { x = (i - 1.5) * 120; z = 60; } else { x = (i - 6) * 140 + (id === 'boss' ? 60 : 0); z = -120; }
    }
    a.root.position.set(x, 0, z);
    scene.add(a.root);
    actors.push({ a, brain, id, isHero });
  });

  const cam = new THREE.PerspectiveCamera(focus ? 24 : 34, W() / H(), 1, 3000);
  if (focus) {
    const h = heroes.includes(focus) ? Chars.HERO_H : Chars.ROBOT_DEFS[focus].h;
    const zoom = +(q.get('zoom') || 1);
    cam.position.set(0, h * 0.62, h * 3.1 / zoom);
    cam.lookAt(0, h * (zoom > 1.5 ? 0.82 : 0.5), 0);
  } else {
    cam.position.set(0, 260, 760);
    cam.lookAt(0, 50, -20);
  }
  const resize = () => {
    renderer.setSize(W(), H()); cam.aspect = W() / H(); cam.updateProjectionMatrix();
    SHARED.resolution.value.set(W() * renderer.getPixelRatio(), H() * renderer.getPixelRatio());
    SHARED.outlineWidth.value = 1.3 * renderer.getPixelRatio();
  };
  window.addEventListener('resize', resize); resize();
  info.textContent = 'Neon Knuckles · 模型查看器（?viewer=1&focus=kai&s=attack&cb=3&t=4）';

  const st = q.get('s') || 'idle', cb = +(q.get('cb') || 1), tfix = q.get('t');
  const spin = q.get('spin') !== '0';
  const ry = q.get('ry');
  const clock = new THREE.Clock();
  let time = 0;
  // 状态演示序列（不固定 t 时循环播放）
  const DEMO = ['idle', 'walk', 'attack:1', 'attack:2', 'attack:3', 'dash', 'jump', 'jattack', 'special', 'hurt', 'knockdown', 'down', 'getup', 'grab', 'throw'];
  function frame() {
    const dt = Math.min(0.05, clock.getDelta());
    time += dt;
    for (const it of actors) {
      let s = st, c = cb, t = tfix != null ? +tfix : (time * 30) % 40;
      if (q.get('demo')) {
        const k = DEMO[Math.floor(time / 1.4) % DEMO.length].split(':');
        s = k[0]; c = +(k[1] || 1); t = (time % 1.4) * 30;
      }
      if (!it.isHero) {
        const map = { attack: 'attack', jump: 'walk', jattack: 'charge', special: 'windup', grab: 'grabbed', throw: 'thrown', getup: 'getup' };
        if (s in map) s = map[s];
      }
      const o = { s, t, cb: c, a: s === 'grab' ? 'knee' : '', z: 0, f: 1, c: it.id, _spd: s === 'walk' ? 4 : 0 };
      it.brain.update(o, t, dt, time);
      if (ry != null) it.a.face(+ry, 1, 100);
      else if (spin) it.a.face(time * 0.6, 1, 100);
      it.a.updateStrands(dt);
    }
    renderer.render(scene, cam);
    window.done = true;
    requestAnimationFrame(frame);
  }
  frame();
  window.NKV = { scene, actors, cam, renderer };
}

/** 动作表：?viewer=1&sheet=kai —— 把各状态的关键帧并排渲染，便于检查动画 */
function runSheet(scene, renderer, id, q, info) {
  scene.fog = null;
  const heroes = ['kai', 'mira', 'bruno', 'zed'];
  const isHero = heroes.includes(id);
  const cells = isHero ? [
    ['idle', 0, 10], ['walk', 0, 8], ['attack', 1, 3], ['attack', 2, 3], ['attack', 3, 4], ['dash', 0, 5], ['jump', 0, 8], ['jattack', 0, 4],
    ['special', 0, 6], ['hurt', 0, 2], ['knockdown', 0, 8], ['down', 0, 10], ['getup', 0, 7], ['grab', 0, 5, 'knee'], ['throw', 0, 6],
  ] : [
    ['idle', 0, 10], ['walk', 0, 8], ['windup', 0, 8], ['attack', 0, 2], ['recover', 0, 4], ['hurt', 0, 1], ['grabbed', 0, 3],
    ['knockdown', 0, 8], ['thrown', 0, 5], ['down', 0, 10], ['getup', 0, 7], ['dying', 0, 3], ['cwind', 0, 8], ['charge', 0, 5],
  ];
  const H = isHero ? Chars.HERO_H : Chars.ROBOT_DEFS[id].h;
  const cols = cells.length, sp = H * 1.1;
  const items = cells.map((c, i) => {
    const a = isHero ? Chars.createHero(id, scene) : Chars.createRobot(id, scene);
    a.root.position.set((i % cols - (cols - 1) / 2) * sp, 0, 0);
    scene.add(a.root);
    return { a, b: new Anim(a), c };
  });
  const cam = new THREE.PerspectiveCamera(20, window.innerWidth / window.innerHeight, 1, 6000);
  const d = sp * cols * 1.62 * (window.innerHeight / window.innerWidth) * 1.9;
  cam.position.set(0, d * 0.12, d);
  cam.lookAt(0, H * 0.5, 0);
  SHARED.resolution.value.set(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio());
  const ry = q.get('ry') != null ? +q.get('ry') : 0.9;
  let n = 0;
  const step = () => {
    for (const it of items) {
      const [s, cb, t, aa] = it.c;
      // 从状态起点推进到目标 t，让淡入淡出完成
      const steps = 12;
      for (let k = 0; k <= steps; k++) {
        const tt = (t * k) / steps;
        it.b.update({ s, cb, t: tt, f: 1, a: aa || '', z: 0, i: 0, _spd: s === 'walk' ? 4 : 0 }, tt, 1 / 30, tt / 30);
        it.a.face(ry, 1, 100);
        it.a.updateStrands(1 / 30);
      }
      const lift = it.a.root.userData.lift || 0;
      it.a.root.position.y = lift + (s === 'jump' || s === 'jattack' ? 30 : s === 'knockdown' ? 20 : 0);
    }
    renderer.render(scene, cam);
    window.done = ++n > 1;
    requestAnimationFrame(step);
  };
  info.textContent = id + ' : ' + cells.map((c) => c[0] + (c[1] ? c[1] : '')).join(' · ');
  step();
}

/** 片段帧表：?viewer=1&clipsheet=kai&clip=Sword_Dash_RM&n=8 —— 原始动作片段按时间均分 n 帧并排渲染 */
function runClipSheet(scene, renderer, id, q, info, A) {
  scene.fog = null;
  const clip = q.get('clip'), n = +(q.get('n') || 8);
  const heroes = ['kai', 'mira', 'bruno', 'zed'];
  const isHero = heroes.includes(id);
  const clips = isHero ? A.clips : A.robotClips;
  const c = clips[clip];
  if (!c) { info.textContent = 'no clip ' + clip + ' : ' + Object.keys(clips).join(' '); window.done = true; return; }
  const H = isHero ? Chars.HERO_H : Chars.ROBOT_DEFS[id].h;
  const sp = H * 1.05;
  const t0 = +(q.get('t0') || 0), t1 = q.get('t1') != null ? +q.get('t1') : c.duration;
  const items = [];
  for (let i = 0; i < n; i++) {
    const a = isHero ? Chars.createHero(id, scene) : Chars.createRobot(id, scene);
    a.root.position.set((i - (n - 1) / 2) * sp, 0, 0);
    scene.add(a.root);
    a.play(clip, { fade: 0, time: t0 + (t1 - t0) * (i / Math.max(1, n - 1)) });
    a.face(q.get('ry') != null ? +q.get('ry') : 0.9, 1, 100);
    a.update(0.016);
    if (a.finish) a.finish(0);
    items.push(a);
  }
  const cam = new THREE.PerspectiveCamera(20, window.innerWidth / window.innerHeight, 1, 6000);
  const d = sp * n * 1.62 * (window.innerHeight / window.innerWidth) * 1.9;
  cam.position.set(0, d * 0.12, d); cam.lookAt(0, H * 0.5, 0);
  SHARED.resolution.value.set(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio());
  info.textContent = id + ' ' + clip + ' ' + t0.toFixed(2) + '→' + t1.toFixed(2) + 's (' + c.duration.toFixed(2) + ')';
  let k = 0;
  const step = () => { renderer.render(scene, cam); window.done = ++k > 1; requestAnimationFrame(step); };
  step();
}

/**
 * 动作序列帧表：?viewer=1&seq=kai&script=attack.1.7,attack.2.7,attack.3.15,idle.0.10&step=2
 *   按脚本（状态.连击段.持续tick[.hs命中停顿tick]）以 30fps 连续模拟，每 step tick 取一帧并排显示，
 *   用来检查状态之间的过渡是否连贯。
 */
function runSeq(scene, renderer, id, q, info) {
  scene.fog = null;
  // 状态名后加 ~ 表示接着上一段的状态内时间（如 jump.0.10,jump~.0.12.0.L 测空中转身）
  const script = (q.get('script') || 'idle.0.10').split(',').map((x) => { const [s0, cb, d, hs, f, mv] = x.split('.'); const cont = s0.endsWith('~'); return { s: cont ? s0.slice(0, -1) : s0, cont, cb: +cb || 0, d: +d, hs: +(hs || 0), f: f === 'L' ? -1 : 1, mv: mv || '' }; });
  const SPD = { kai: 4.2, mira: 5.2, bruno: 3.4, zed: 4.0 }[id] || 4;
  // 近似服务器的速度 / 高度（驱动步频、远跳判定与必杀离地高度）
  const kin = (s, t, long) => {
    if (s === 'walk') return { spd: SPD, vx: SPD, z: 0 };
    if (s === 'run') return { spd: SPD * 1.9, vx: SPD * 1.9, z: 0 };
    if (s === 'runatk') { const v = SPD * 2.4 * Math.pow(0.9, t); return { spd: v, vx: v, z: 0 }; }
    if (s === 'attack') return { spd: SPD * 0.4, vx: SPD * 0.4, z: 0 };
    if (s === 'special') return { spd: 0, vx: 0, z: superZ(id, t) };
    if (s === 'jump' || s === 'jattack') { const v = SPD * (long ? 1.9 : 1.1); return { spd: v, vx: v, z: Math.max(0, 12.5 * t - 0.55 * t * (t + 1)) }; }
    return { spd: 0, vx: 0, z: 0 };
  };
  const total = script.reduce((a, x) => a + x.d, 0);
  const step = +(q.get('step') || 2);
  const n = Math.min(24, Math.floor(total / step) + 1);
  const heroes = ['kai', 'mira', 'bruno', 'zed'];
  const isHero = heroes.includes(id);
  const H = isHero ? Chars.HERO_H : Chars.ROBOT_DEFS[id].h;
  const sp = H * (+(q.get('gap') || 0.75));
  const sub = 2;   // 每 tick 2 个子步（60fps）
  for (let i = 0; i < n; i++) {
    const a = isHero ? Chars.createHero(id, scene) : Chars.createRobot(id, scene);
    const b = new Anim(a);
    a.root.position.set((i - (n - 1) / 2) * sp, 0, 0);
    scene.add(a.root);
    const stopTick = i * step;
    let k = 0, done = false, base = 0, prev = '', z = 0, long = false;
    for (const seg of script) {
      if (!seg.cont) base = 0;
      if (seg.s === 'jump' && !seg.cont) long = prev === 'run';
      for (let tt = 0; tt < seg.d && !done; tt++) {
        for (let ss = 0; ss < sub; ss++) {
          const frz = tt >= 3 && tt < 3 + seg.hs;
          const t = base + (frz ? 3 : tt >= 3 + seg.hs ? tt - seg.hs + ss / sub : tt + ss / sub);
          const m = kin(seg.s, t, long);
          z = m.z;
          b.update({ s: seg.s, cb: seg.cb, t, f: seg.f, a: seg.mv || (seg.s === 'grab' ? 'knee' : ''), z, i: 0, _spd: frz ? 0 : m.spd, _vx: frz ? 0 : m.vx * seg.f, _vy: 0, _frozen: frz }, t, 1 / 30 / sub, k / 30);
          a.updateStrands(1 / 30 / sub);
        }
        if (++k > stopTick) done = true;
      }
      if (done) break;
      base += seg.d; prev = seg.s;
    }
    if (!q.get('keepyaw')) a.face(q.get('ry') != null ? +q.get('ry') : 1.0, 1, 100);
    a.root.position.y = q.get('noz') ? 0 : z;
    (window.SEQ = window.SEQ || []).push({ a, b });
    if (q.get('ghost') && i === n - 1) {
      // 残影测试：在最后一格角色身后放 3 个当前姿势的残影
      const gs = Chars.createGhosts(a, 3, '#ff4b4b', scene);
      gs.forEach((g, j) => { a.root.position.x -= 14; a.root.updateMatrixWorld(true); g.copyPose(a); g.root.visible = true; g.mat.opacity = 0.45 - j * 0.12; });
      a.root.position.x += 42;
    }
  }
  const cam = new THREE.PerspectiveCamera(20, window.innerWidth / window.innerHeight, 1, 6000);
  const d = sp * n * 1.62 * (window.innerHeight / window.innerWidth) * 1.9;
  cam.position.set(0, d * 0.12, d); cam.lookAt(0, H * 0.5, 0);
  SHARED.resolution.value.set(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio());
  info.textContent = id + ' : ' + script.map((x) => x.s + (x.cb || '') + (x.f < 0 ? '←' : '') + '×' + x.d).join(' → ') + '  （每格 ' + step + ' tick）';
  let c = 0;
  const loop = () => { renderer.render(scene, cam); window.done = ++c > 1; requestAnimationFrame(loop); };
  loop();
}
