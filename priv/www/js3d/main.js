/* ==========================================================================
 * main.js —— 对战版主程序：选人大厅、连接管理、快照插值、格斗镜头、3D 渲染、特效、HUD
 *   依赖经典脚本（全局 NK）：js/util.js net.js input.js audio.js hud.js
 * ========================================================================== */
import * as THREE from 'three';
import { loadAll } from './assets.js';
import * as Chars from './chars.js';
import { Anim, SUPER_LEN, superZ } from './anim.js';
import { Supers } from './supers.js';
import { Effects } from './effects.js';
import { World, glowTex } from './world.js';
import { FX } from './fx.js';
import { SHARED } from './materials.js';
import { runViewer } from './viewer.js';

const NK = window.NK;
const W = NK.W, H = NK.H, TICK = NK.TICK_MS;
const RENDER_DELAY = 1.6;       // 渲染落后服务器约 1.6 tick：网络抖动时也总有两帧可插值
const TELEPORT = 160;           // 超过此距离不插值，直接跳
const FIGHT_Y = 100;            // 擂台所在的街道纵深（旧坐标系的 y；three z = y * K）
const $ = (id) => document.getElementById(id);

if (new URLSearchParams(location.search).get('viewer')) {
  document.getElementById('stage').style.display = 'none';
  runViewer();
} else {
  main();
}

function main() {
  // ======================================================================
  // 渲染器 / 画布布局：WebGL 画布按真实像素铺满 16:9 区域；HUD 2D 画布叠在上面
  // ======================================================================
  const glCanvas = $('gl');
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  const hud = $('game');
  const ctx = hud.getContext('2d');
  let scale = 1;

  const K = Chars.DEPTH_K;           // 纵深拉伸：旧 y → three z
  const Z3 = FIGHT_Y * K;            // 擂台所在的 three z
  const camera = new THREE.PerspectiveCamera(10, 16 / 9, 200, 9000);
  const CAM = { y: 400, z: 3000, ground: 0.2 };   // ground：地面线距画面底部的比例

  function fit() {
    const s = Math.min(window.innerWidth / W, window.innerHeight / H);
    scale = s;
    const ox = (window.innerWidth - W * s) / 2, oy = (window.innerHeight - H * s) / 2;
    $('stage').style.transform = `translate(${ox}px, ${oy}px) scale(${s})`;
    const pr = Math.min(2, window.devicePixelRatio || 1);
    renderer.setPixelRatio(pr);
    renderer.setSize(Math.round(W * s), Math.round(H * s), false);
    glCanvas.style.cssText = `position:absolute;left:${ox}px;top:${oy}px;width:${W * s}px;height:${H * s}px`;
    hud.width = Math.round(W * s * pr); hud.height = Math.round(H * s * pr);
    hud.style.width = W + 'px'; hud.style.height = H + 'px';
    SHARED.resolution.value.set(W * s * pr, H * s * pr);
    SHARED.outlineWidth.value = Math.max(1, 1.6 * s * pr);
  }
  window.addEventListener('resize', fit);
  fit();

  // ======================================================================
  // 全局状态
  // ======================================================================
  const G = {
    mode: 'loading',      // loading | lobby | game | error
    conns: [], seats: [], snaps: [], offset: null, lag: 0, slowUntil: 0,
    comics: [], shake: 0, evq: [], pings: [null, null], errorShown: false,
    actors: new Map(),    // 座位 → {actor, brain, shadow, type}
    stage: 0, room: '', flash: 0, cam: { x: 500, w: 760 },
  };

  const world = new World(renderer);
  const scene = world.scene;
  const fx = new FX(scene);
  let assets = null;
  const portraits = {};
  NK.portrait = (c) => portraits[c];
  const shake = (v) => { G.shake = Math.max(G.shake, v); };
  const vfx = new Effects(scene, fx, shake);
  const supers = new Supers({ vfx, K, groundAt: (z3) => world.groundAt(z3), shake, portrait: (c) => portraits[c] });

  // 脚下的圆形软阴影（帮助判断跳跃高度）
  const blobTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.7)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  })();
  const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  function makeBlob() {
    const m = new THREE.Mesh(blobGeo, new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.8 }));
    m.renderOrder = 2;
    scene.add(m);
    return m;
  }

  // 霓虹核心（场地道具）：发光八面体 + 光晕 + 落点光圈
  const core = new THREE.Group();
  {
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(9, 0), new THREE.MeshBasicMaterial({ color: '#bffcff' }));
    const shell = new THREE.Mesh(new THREE.OctahedronGeometry(12, 0), new THREE.MeshBasicMaterial({ color: '#22f3ff', wireframe: true, transparent: true, opacity: 0.9 }));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#22f3ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(90);
    const ring = new THREE.Mesh(new THREE.RingGeometry(16, 20, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#22f3ff', transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.add(gem, shell, halo, ring);
    core.userData = { gem, shell, halo, ring };
    core.visible = false;
    scene.add(core);
  }

  // ======================================================================
  // 大厅
  // ======================================================================
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('nkv_prefs') || '{}'); } catch (e) { return {}; } })();
  const sel = [NK.CHARS[prefs.c1] ? prefs.c1 : 'kai', NK.CHARS[prefs.c2] ? prefs.c2 : 'mira'];
  let lobbyMode = ['cpu', 'arc', 'local', 'net'].includes(prefs.mode) ? prefs.mode : 'cpu';
  if (prefs.n1) $('name1').value = prefs.n1;
  if (prefs.n2) $('name2').value = prefs.n2;
  if (prefs.room) $('room').value = prefs.room;
  if (prefs.lv) $('level').value = prefs.lv;
  $('rndCpu').checked = prefs.rnd !== false;

  const MODE_DESC = {
    cpu: '自选对手和难度，和 CPU 打一场三局两胜。',
    arc: '依次挑战其余三人和自己的镜像，最后迎战关底 Boss「OVERCLOCK」。CPU 一场比一场强，输了可以原地续关。',
    local: '同一台电脑两人对打：P1 用 WASD + J K L I U，P2 用方向键 + 小键盘 1 2 3 5 4（或 , . / \' ;）。',
    net: '和朋友输入相同的房间号进入同一擂台，先到的两人对打，之后进来的人观战。',
  };

  const cards = [];   // {cv, ch, slot, card, actor, brain}
  document.querySelectorAll('.chars').forEach((box) => {
    const slot = +box.dataset.player;
    NK.CHAR_ORDER.forEach((id) => {
      const c = NK.CHARS[id];
      const card = document.createElement('div');
      card.className = 'card';
      card.style.setProperty('--c', c.color);
      card.dataset.ch = id;
      const cv = document.createElement('canvas');
      cv.width = 280; cv.height = 256;
      card.appendChild(cv);
      card.insertAdjacentHTML('beforeend',
        `<div class="cname" style="color:${c.color}">${c.cn} <small style="color:#ccc;font-size:11px">${id.toUpperCase()}</small></div>` +
        `<div class="stat">${c.stat}</div><div class="cdesc">${c.desc}<br><b style="color:${c.color}">${c.sp5} · ${c.sp6} · ${c.sp2}</b></div>`);
      card.addEventListener('click', () => {
        sel[slot] = id;
        if (slot === 1) $('rndCpu').checked = false;
        refreshLobby(); NK.Audio.unlock(); NK.Audio.play('grab');
      });
      box.appendChild(card);
      cards.push({ cv, ch: id, slot, card });
    });
  });

  function refreshLobby() {
    document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === lobbyMode));
    const rnd = lobbyMode === 'cpu' && $('rndCpu').checked;
    cards.forEach((c) => {
      c.card.classList.toggle('sel', sel[c.slot] === c.ch && !(c.slot === 1 && rnd));
      c.card.classList.toggle('dim', c.slot === 1 && rnd);
    });
    $('prow2').classList.toggle('hidden', !(lobbyMode === 'cpu' || lobbyMode === 'local'));
    $('p2tag').textContent = lobbyMode === 'cpu' ? 'CPU' : 'P2';
    $('p2tag').classList.toggle('cpu', lobbyMode === 'cpu');
    $('name2wrap').classList.toggle('hidden', lobbyMode !== 'local');
    $('cpuOpts').classList.toggle('hidden', lobbyMode !== 'cpu');
    $('netRow').classList.toggle('hidden', lobbyMode !== 'net');
    $('modeDesc').textContent = MODE_DESC[lobbyMode];
  }
  document.querySelectorAll('#modes button').forEach((b) => b.addEventListener('click', () => { lobbyMode = b.dataset.mode; refreshLobby(); NK.Audio.unlock(); NK.Audio.play('grab'); }));
  $('rndCpu').addEventListener('change', refreshLobby);
  refreshLobby();

  // 卡片预览场景（在主画布上分区渲染后拷贝到卡片画布）
  const cardScene = new THREE.Scene();
  cardScene.add(new THREE.HemisphereLight('#b0a4ff', '#2a1838', 1.4));
  const ck = new THREE.DirectionalLight('#fff1e0', 2.4); ck.position.set(-80, 160, 220); cardScene.add(ck);
  const cr1 = new THREE.DirectionalLight('#ff3fd0', 1.8); cr1.position.set(-200, 100, -200); cardScene.add(cr1);
  const cr2 = new THREE.DirectionalLight('#22d8ff', 1.6); cr2.position.set(200, 120, -160); cardScene.add(cr2);
  const cardCam = new THREE.PerspectiveCamera(26, 280 / 256, 10, 2000);
  cardCam.position.set(30, 54, 268); cardCam.lookAt(30, 47, 0);

  // 选中的卡片循环演示招式：[状态, tick 数, 连段]
  const demoOf = (ch) => [['idle', 30], ['attack', 7, 1], ['attack', 7, 2], ['attack', 15, 3], ['idle', 10], ['launch', 22], ['idle', 8],
    ['crouch', 8], ['sweep', 20], ['idle', 8], ['cast', 24], ['idle', 8], [ch === 'kai' ? 'dash' : 'runatk', 18], ['idle', 12],
    ['special', SUPER_LEN[ch] || 36], ['idle', 8], ['block', 16], ['win', 40]];
  const DEMOS = {};

  function renderCards(time, dt) {
    const pr = renderer.getPixelRatio();
    const cw = 140, ch = 128;
    renderer.setScissorTest(true);
    for (const c of cards) {
      if (!c.actor) continue;
      if (c.card.offsetParent === null) continue;
      let s = 'idle', t = time * 30, cb = 0;
      const isSel = c.card.classList.contains('sel');
      if (isSel) {
        const D = DEMOS[c.ch] || (DEMOS[c.ch] = { list: demoOf(c.ch), len: demoOf(c.ch).reduce((a, d) => a + d[1], 0) });
        let m = (time * 30) % D.len;
        for (const d of D.list) { if (m < d[1]) { s = d[0]; t = m; cb = d[2] || 0; break; } m -= d[1]; }
      }
      let a = s === 'block' ? 's' : '', z = 0;
      const dbg = NK.demoState;   // 调试：NK.demoState = {s,t,cb,a,z} 可把所有卡片定格在某个动作帧
      if (dbg) { s = dbg.s; t = dbg.t || 0; cb = dbg.cb || 0; a = dbg.a || ''; z = dbg.z || 0; }
      c.brain.update({ s, t, cb, f: 1, a, z, i: c.slot, _spd: 0, _vx: 0 }, t, dt, time);
      c.actor.face(Math.PI / 2 - 0.75, 1, 100);
      c.actor.root.position.y = s === 'special' ? superZ(c.ch, t) * 0.32 : z * 0.32;
      for (const a of cards) { if (a.actor) { a.actor.root.visible = a === c; a.actor.strands.forEach((st) => st.setVisible(a === c)); } }
      c.actor.updateStrands(dt);
      renderer.setViewport(0, 0, cw, ch);
      renderer.setScissor(0, 0, cw, ch);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(cardScene, cardCam);
      const g = c.cv.getContext('2d');
      g.clearRect(0, 0, c.cv.width, c.cv.height);
      const grd = g.createLinearGradient(0, 0, 0, c.cv.height);
      grd.addColorStop(0, '#120a28'); grd.addColorStop(1, NK.shade(NK.CHARS[c.ch].color, isSel ? 0.45 : 0.25));
      g.fillStyle = grd; g.fillRect(0, 0, c.cv.width, c.cv.height);
      g.drawImage(glCanvas, 0, glCanvas.height - ch * pr, cw * pr, ch * pr, 0, 0, c.cv.width, c.cv.height);
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W * scale, H * scale);
  }

  /** 头像：一次性渲染头部特写（血条旁和必杀横幅用） */
  function renderPortraits() {
    const pr = renderer.getPixelRatio();
    const cam = new THREE.PerspectiveCamera(22, 1, 5, 1000);
    renderer.setScissorTest(true);
    for (const id of NK.CHAR_ORDER) {
      const c = cards.find((k) => k.ch === id && k.slot === 0);
      if (!c || !c.actor) continue;
      for (const a of cards) if (a.actor) { a.actor.root.visible = a === c; a.actor.strands.forEach((st) => st.setVisible(a === c)); }
      c.brain.update({ s: 'idle', t: 0, f: 1, z: 0, a: '' }, 0, 0.016, 0);
      c.actor.face(0.35, 1, 100);
      c.actor.root.position.y = 0;
      c.actor.updateStrands(0.016);
      const hp = c.actor.bones.Head.getWorldPosition(new THREE.Vector3());
      cam.position.set(hp.x + 8, hp.y + 4, hp.z + 70);
      cam.lookAt(hp.x, hp.y + 1, hp.z);
      renderer.setViewport(0, 0, 64, 64); renderer.setScissor(0, 0, 64, 64);
      renderer.setClearColor(0x000000, 0); renderer.clear();
      renderer.render(cardScene, cam);
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      cv.getContext('2d').drawImage(glCanvas, 0, glCanvas.height - 64 * pr, 64 * pr, 64 * pr, 0, 0, 128, 128);
      portraits[id] = cv;
    }
    // Boss 头像：临时建一台 OVERCLOCK 拍头部特写
    {
      for (const a of cards) if (a.actor) { a.actor.root.visible = false; a.actor.strands.forEach((st) => st.setVisible(false)); }
      const r = Chars.createRobot('boss', cardScene);
      cardScene.add(r.root);
      new Anim(r).update({ s: 'idle', t: 0, f: 1, z: 0, a: '' }, 0, 0.016, 0);
      r.face(0.35, 1, 100);
      const hp = r.bones.Head.getWorldPosition(new THREE.Vector3());
      cam.position.set(hp.x + 10, hp.y + 24, hp.z + 95);
      cam.lookAt(hp.x, hp.y + 20, hp.z);
      renderer.setViewport(0, 0, 64, 64); renderer.setScissor(0, 0, 64, 64);
      renderer.setClearColor(0x000000, 0); renderer.clear();
      renderer.render(cardScene, cam);
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      cv.getContext('2d').drawImage(glCanvas, 0, glCanvas.height - 64 * pr, 64 * pr, 64 * pr, 0, 0, 128, 128);
      portraits.boss = cv;
      r.dispose();
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W * scale, H * scale);
  }

  // ======================================================================
  // 连接管理
  // ======================================================================
  const ERR_TEXT = { connect_failed: '无法连接服务器。', room_closed: '房间已关闭。', bad_join: '加入房间失败。' };
  const rnd4 = () => Math.random().toString(36).slice(2, 8);

  function startGame() {
    if (G.mode !== 'lobby') return;
    NK.Audio.unlock();
    const names = [NK.cleanName($('name1').value, '玩家1'), NK.cleanName($('name2').value, '玩家2')];
    const code = NK.cleanName($('room').value, '1').slice(0, 16);
    const lv = $('level').value, rnd = $('rndCpu').checked;
    try { localStorage.setItem('nkv_prefs', JSON.stringify({ n1: $('name1').value, n2: $('name2').value, room: code, c1: sel[0], c2: sel[1], mode: lobbyMode, lv, rnd })); } catch (e) { /* 忽略 */ }
    resetGameState();
    G.mode = 'game';
    G.errorShown = false;
    $('lobby').classList.add('hidden');
    $('helpBtn').classList.remove('hidden');
    NK.HUD.reset();
    buildHelp();
    let seen = false;
    try { seen = localStorage.getItem('nkv_help_seen') === '1'; localStorage.setItem('nkv_help_seen', '1'); } catch (e) { /* 忽略 */ }
    if (!seen) setHelp(true);
    const two = lobbyMode === 'local';
    NK.Input.active = true;
    NK.Input.localTwo = two;
    const handlers = {
      welcome(slot, m) { G.seats[slot] = m.id; G.room = code; },
      snap(slot, m) { if (slot === 0) onSnapshot(m); },
      error(slot, msg) { showError(ERR_TEXT[msg] || ('服务器错误：' + msg)); },
      close(slot, wasOpen) { showError(wasOpen ? '与服务器的连接已断开。' : '无法连接服务器（' + NK.wsUrl() + '）。'); },
      ping(slot, ms) { G.pings[slot] = ms; },
    };
    const mk = (slot, room, mode, arg) => { const c = new NK.Conn(slot, names[slot], sel[slot], room, mode, arg, handlers); G.conns.push(c); c.connect(); };
    // 地址栏加 ?cpu=boss 可以在“对战 CPU”里直接练 Boss（调试 / 练习用）
    const forced = new URLSearchParams(location.search).get('cpu');
    if (lobbyMode === 'cpu') mk(0, 'c-' + rnd4(), 'cpu', `${forced || (rnd ? 'random' : sel[1])}:${lv}`);
    else if (lobbyMode === 'arc') mk(0, 'a-' + rnd4(), 'arc', '');
    else if (lobbyMode === 'local') { const r = 'l-' + rnd4(); mk(0, r, 'vs', ''); setTimeout(() => { if (G.mode === 'game' && G.conns.length === 1) mk(1, r, 'vs', ''); }, 150); }
    else mk(0, 'n-' + code, 'vs', '');
  }

  function resetGameState() {
    G.conns.forEach((c) => c.close());
    G.conns = []; G.seats = []; G.snaps = []; G.offset = null; G.lag = 0; G.slowUntil = 0;
    G.comics = []; G.shake = 0; G.pings = [null, null]; G.evq = []; G.flash = 0;
    for (const [, e] of G.actors) disposeEnt(e);
    G.actors.clear();
    core.visible = false;
  }

  function showError(msg) {
    if (G.errorShown || G.mode !== 'game') return;
    G.errorShown = true;
    G.mode = 'error';
    G.conns.forEach((c) => c.close());
    NK.Input.active = false;
    $('errorMsg').textContent = msg;
    $('errorBox').classList.remove('hidden');
  }

  function backToLobby() {
    resetGameState();
    G.mode = 'lobby';
    NK.Input.active = false;
    $('errorBox').classList.add('hidden');
    $('helpBtn').classList.add('hidden');
    setHelp(false);
    $('lobby').classList.remove('hidden');
  }

  // ---- 操作说明 / 出招表（H 键 / ? 按钮；首次进入对战自动显示一次）----
  function buildHelp() {
    const two = lobbyMode === 'local';
    const list = two ? [sel[0], sel[1]] : [sel[0]];
    const rows = list.map((id, i) => {
      const c = NK.CHARS[id];
      const L = two && i === 1 ? { p: '1', k: '2', s: '3', u: '4', t: '5' } : { p: 'J', k: 'K', s: 'L', u: 'U', t: 'I' };
      const kb = (s) => `<kbd>${s}</kbd>`;
      return `<tr><td style="color:${c.color}">${two ? 'P' + (i + 1) + ' ' : ''}${c.cn}</td>` +
        `<td>${kb(L.s)} ${c.sp5}</td><td>前+${kb(L.s)} ${c.sp6}</td><td>下+${kb(L.s)} ${c.sp2}</td><td>${kb(L.u)} ${c.sup}</td></tr>`;
    }).join('');
    $('moveRows').innerHTML = rows;
  }
  function setHelp(on) {
    $('helpBox').classList.toggle('hidden', !on);
    G.helpAt = on ? performance.now() : 0;
  }
  const helpOpen = () => !$('helpBox').classList.contains('hidden');
  $('helpBtn').addEventListener('click', (e) => { e.stopPropagation(); setHelp(!helpOpen()); });
  $('helpBox').addEventListener('click', () => setHelp(false));

  $('startBtn').addEventListener('click', startGame);
  $('backBtn').addEventListener('click', backToLobby);
  ['name1', 'name2', 'room'].forEach((id) => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') startGame(); }));
  window.addEventListener('pointerdown', () => NK.Audio.unlock());
  NK.Input.onKey((e) => {
    NK.Audio.unlock();
    if (e.code === 'KeyM') NK.Audio.toggleMusic();
    else if (e.code === 'KeyH' && G.mode === 'game' && !e.repeat) setHelp(!helpOpen());
    else if (e.code === 'Escape' && helpOpen()) setHelp(false);
    else if (e.code === 'Escape' && G.mode === 'game') backToLobby();
    else if (e.code === 'Enter' && G.mode === 'lobby') startGame();
    else if (G.mode === 'game') {
      if (helpOpen() && performance.now() - G.helpAt > 600 && /^(KeyJ|KeyK|KeyL|Numpad1|Numpad2|Comma|Period)$/.test(e.code)) setHelp(false);
      pollInput();
    }
  });

  // ======================================================================
  // 快照处理 / 插值
  // ======================================================================
  const nowTick = () => performance.now() / TICK;

  function onSnapshot(m) {
    if (typeof m.k !== 'number') return;
    const last = G.snaps[G.snaps.length - 1];
    if (last && m.k <= last.k) {
      if (last.k - m.k > 60) G.snaps = [];
      else return;
    }
    m.f = m.f || []; m.j = m.j || []; m.ev = m.ev || [];
    G.snaps.push(m);
    if (G.snaps.length > 48) G.snaps.shift();
    const sample = m.k - nowTick();
    if (G.offset == null || Math.abs(sample - G.offset) > 6) G.offset = sample;
    else G.offset += (sample - G.offset) * 0.06;
    // 事件按其 tick 排队，等渲染时间走到该 tick 再播放，火花/音效与画面上的出拳同步
    for (const ev of m.ev) G.evq.push({ k: m.k, ev });
    if (typeof m.stg === 'number') G.stage = m.stg % NK.STAGES.length;
  }

  function frames() {
    const S = G.snaps;
    if (!S.length) return null;
    const newest = S[S.length - 1];
    let rt = nowTick() + G.offset - RENDER_DELAY - G.lag;
    if (rt > newest.k) rt = newest.k;
    if (rt <= S[0].k || S.length === 1) {
      const s = rt <= S[0].k ? S[0] : newest;
      return { a: s, b: s, alpha: 0, rt: Math.max(rt, s.k - 1) };
    }
    for (let i = S.length - 1; i > 0; i--) {
      const a = S[i - 1], b = S[i];
      if (rt >= a.k) return { a, b, alpha: NK.clamp((rt - a.k) / (b.k - a.k), 0, 1), rt };
    }
    return { a: S[0], b: S[0], alpha: 0, rt };
  }

  /** 插值一名角色。附带 _t（状态内 tick，命中停顿时冻结）、_vx（单位/tick）、_frozen */
  function lerpFighter(listA, fb, alpha, dk) {
    const fa = listA.find((o) => o.i === fb.i);
    const o = { ...fb, y: FIGHT_Y, _vx: 0, _vy: 0, _frozen: false, _t: fb.t };
    if (!fa) return o;
    const jump = Math.abs(fa.x - fb.x) > TELEPORT || Math.abs(fa.z - fb.z) > TELEPORT;
    if (!jump) {
      o.x = NK.lerp(fa.x, fb.x, alpha); o.z = NK.lerp(fa.z, fb.z, alpha);
      o._vx = (fb.x - fa.x) / (dk > 0 ? dk : 1);
    }
    o._frozen = (fa.hs | 0) > 0 && (fb.hs | 0) > 0;
    const same = fa.s === fb.s && fa.cb === fb.cb && fa.t <= fb.t;
    o._t = same ? NK.lerp(fa.t, fb.t, alpha) : fb.t <= 2 ? fb.t * alpha : fb.t;
    return o;
  }

  // ======================================================================
  // 事件：火花 / 拟声字 / 震屏 / 必杀演出
  // ======================================================================
  const WORDS_HEAVY = ['KRA-KOOM!', 'WHAMMO!', 'KA-CHUNK!', 'BLAMMO!', 'ZAKK!', 'POW!'];
  const COMIC_COLS = [['#ffe45c', '#d4142a'], ['#22f3ff', '#3a0a80'], ['#ff7ae0', '#2a0050'], ['#ffffff', '#ff3a1a']];
  const X0 = () => NK.STAGES[G.stage].x0;
  const gy0 = () => world.groundAt(Z3);

  function flushEvents(rt) {
    if (!G.evq.length) return;
    const due = [];
    G.evq = G.evq.filter((q) => { if (q.k <= rt + 0.25 || q.k < rt - 8) { due.push(q.ev); return false; } return true; });
    if (due.length) handleEvents(due);
  }

  function handleEvents(list) {
    const now = performance.now();
    const hasSuper = list.some((ev) => ev && ev.k === 'fx' && ev.n === 'super');
    const x0 = X0(), gy = gy0();
    for (const ev of list) {
      if (!ev || !ev.k) continue;
      if (ev.k === 'fx') {
        const e = { ...ev, x: ev.x + x0, y: FIGHT_Y };
        if (ev.n === 'super') { supers.start(e, now); NK.Audio.play('super_' + (NK.CHARS[ev.c] ? ev.c : 'kai')); }
        else if (ev.n === 'quake') { supers.quake(e, now); NK.Audio.play('quake'); }
        else if (ev.n === 'launch') supers.launch(e);
        else if (ev.n === 'slam') supers.slam(e);
      } else if (ev.k === 'hit') {
        const big = ev.b === 1;
        vfx.hitSpark(new THREE.Vector3(ev.x + x0, gy + (ev.z || 0), Z3 + 12), big);
        if (big && Math.random() < 0.6) {
          const col = COMIC_COLS[(Math.random() * COMIC_COLS.length) | 0];
          G.comics.push({ x: ev.x + (Math.random() * 30 - 15), z: (ev.z || 0) + 44, txt: WORDS_HEAVY[(Math.random() * WORDS_HEAVY.length) | 0], col, t0: now, rot: (Math.random() - 0.5) * 0.5 });
        }
        shake(big ? 8 : 2.6);
      } else if (ev.k === 'block') {
        if (vfx.has('hit_spark')) vfx.spawn('hit_spark', { x: ev.x + x0, y: gy + (ev.z || 50), z: Z3 + 12, scale: 0.9, tint: '#6fd8ff', rotation: Math.random() * 6.28 });
        vfx.superFlash(new THREE.Vector3(ev.x + x0, gy + (ev.z || 50), Z3 + 12), '#6fd8ff', 10, 60, 140);
        shake(1.4);
      } else if (ev.k === 'ko') {
        G.slowUntil = now + 650;
        G.flash = now;
        vfx.superFlash(new THREE.Vector3(ev.x + x0, gy + (ev.z || 50), Z3 + 12), '#ffffff', 40, 320, 420);
        shake(14);
      } else if (ev.k === 'dust') {
        vfx.dustPuff(new THREE.Vector3(ev.x + x0 - 12, gy, Z3), 2, 24);
      } else if (ev.k === 'item') {
        const p = new THREE.Vector3(ev.x + x0, gy + (ev.n === 'take' ? 40 : 200), Z3);
        vfx.superFlash(p, '#22f3ff', 30, ev.n === 'take' ? 260 : 140, 360);
        if (ev.n === 'take' && vfx.has('elec_spark')) for (let i = 0; i < 3; i++) vfx.spawn('elec_spark', { x: p.x + (i - 1) * 16, y: p.y + i * 12, z: p.z + 8, scale: 0.8, rotation: Math.random() * 6.28 });
      } else if (ev.k === 'sfx') {
        if (ev.n === 'special' && hasSuper) continue;
        NK.Audio.play(ev.n);
      }
    }
    if (G.comics.length > 8) G.comics.splice(0, G.comics.length - 8);
  }

  // ======================================================================
  // 角色实体
  // ======================================================================
  function getEnt(seat, type) {
    let e = G.actors.get(seat);
    if (e && e.type !== type) { disposeEnt(e); G.actors.delete(seat); e = null; }
    if (!e) {
      const boss = type === 'boss';
      const actor = boss ? Chars.createRobot('boss', scene) : Chars.createHero(type, scene);
      scene.add(actor.root);
      e = { actor, brain: new Anim(actor), shadow: makeBlob(), type, h: boss ? Chars.HERO_H * 1.6 : Chars.HERO_H };
      G.actors.set(seat, e);
    }
    return e;
  }
  function disposeEnt(e) {
    if (e.ghosts) e.ghosts.forEach((g) => g.dispose());
    e.actor.dispose();
    e.shadow.removeFromParent();
    e.shadow.material.dispose();
  }

  const _v = new THREE.Vector3();
  /** 擂台坐标 → HUD 逻辑坐标（960x540） */
  function project(x, z) {
    _v.set(x + X0(), z + gy0(), Z3).project(camera);
    return [(_v.x + 1) * 0.5 * W, (1 - _v.y) * 0.5 * H];
  }

  /** 格斗镜头：cx 擂台内的中心，vw 画面横向能看到的世界宽度 */
  function placeCamera(cx, vw, sx, sy) {
    const vh = vw * 9 / 16;
    const lookY = vh * (0.5 - CAM.ground);
    const wx = X0() + cx;
    const d = Math.hypot(CAM.z - Z3, CAM.y - lookY);
    camera.fov = 2 * Math.atan(vh / (2 * d)) * 180 / Math.PI;
    camera.updateProjectionMatrix();
    camera.position.set(wx + sx, CAM.y + sy, CAM.z);
    camera.lookAt(wx + sx * 0.6, lookY + sy * 0.6, Z3);
    world.update(wx - 480, performance.now() / 1000);
  }

  const VICTIM = { hurt: 1, block: 1, air: 1, knockdown: 1, grabbed: 1 };
  const TRAIL = { dash: 10, runatk: 12, bstep: 8, slam: 99 };

  function spawnGhost(e) {
    if (!e.ghosts) e.ghosts = Chars.createGhosts(e.actor, 4, NK.CHARS[e.type] ? NK.CHARS[e.type].color : '#ffffff', scene);
    const g = e.ghosts.reduce((m, x) => (!m || (!x.live && m.live) || (x.live === m.live && x.life < m.life) ? x : m), null);
    g.copyPose(e.actor);
    g.live = true; g.life = 0.24; g.root.visible = true;
  }

  /** 脚下尘土、落地尘土、突进残影 */
  function stepFx(e, o, t, dt, wx, gy) {
    const f = o.f || 1;
    if (o.s === 'run' && !o._frozen) {
      if (e.prevS !== 'run') vfx.dustPuff(new THREE.Vector3(wx - f * 6, gy, Z3), 3, -f * 10);
      e.dustAcc = (e.dustAcc || 0) + Math.abs(o._vx) * dt * 30;
      if (e.dustAcc > 28) { e.dustAcc = 0; vfx.dustPuff(new THREE.Vector3(wx - f * 10, gy, Z3)); }
    }
    if (e.brain.skidPuff) { e.brain.skidPuff = false; vfx.dustPuff(new THREE.Vector3(wx + f * 8, gy, Z3), 2, f * 8); }
    if ((o.s === 'land' || o.s === 'slamland') && e.prevS !== o.s) { vfx.dustPuff(new THREE.Vector3(wx - 10, gy, Z3)); vfx.dustPuff(new THREE.Vector3(wx + 10, gy, Z3)); }
    if ((o.s === 'jump' || o.s === 'bstep') && e.prevS !== o.s) vfx.dustPuff(new THREE.Vector3(wx, gy, Z3), 2, -f * 10);
    if (o.s === 'sweep' && e.prevS !== 'sweep') vfx.dustPuff(new THREE.Vector3(wx + f * 20, gy, Z3), 3, f * 12);
    if (TRAIL[o.s]) {
      if (e.prevS !== o.s) { e.ghostK = -1; if (o.s !== 'slam') vfx.dustPuff(new THREE.Vector3(wx - f * 18, gy, Z3), 2, -f * 10); }
      const on = o.s === 'slam' ? (o.z || 0) > 6 : t < TRAIL[o.s];
      if (on && !o._frozen) {
        const gk = Math.floor(t / 1.5);
        if (gk !== e.ghostK) { e.ghostK = gk; spawnGhost(e); }
      }
    }
    // 凯的炎冲拳 / 炎勾拳：拳头带火
    if (o.c === 'kai' && ((o.s === 'dash' && o.a === 'sp6' && t > 1 && t < 10) || (o.s === 'launch' && o.a === 'dp' && t > 2 && t < 12)) && vfx.has('kai_fire_spiral')) {
      const hp = e.actor.bones.hand_r.getWorldPosition(_v);
      vfx.loopFx('kf' + o.i, 'kai_fire_spiral', { x: hp.x, y: hp.y - 8, z: hp.z + 4, scale: 0.34, rotation: o.s === 'dash' ? f * Math.PI / 2 : 0, alpha: 0.95 });
    }
    if (e.ghosts) for (const g of e.ghosts) {
      if (!g.live) continue;
      g.life -= dt;
      if (g.life <= 0) { g.live = false; g.root.visible = false; continue; }
      g.mat.opacity = 0.42 * (g.life / 0.24);
    }
  }

  /** 飞行道具：每个角色一种序列帧，跟随服务器位置 */
  function drawProjectiles(fr, gy) {
    const { a, b, alpha } = fr;
    const x0 = X0();
    for (const j of b.j) {
      const ja = a.j.find((q) => q.i === j.i);
      const x = (ja && Math.abs(ja.x - j.x) < 80 ? NK.lerp(ja.x, j.x, alpha) : j.x) + x0;
      const y = gy + j.z, f = j.vx >= 0 ? 1 : -1;
      const key = 'pj' + j.i;
      if (j.c === 'kai') {
        vfx.loopFx(key, 'kai_fire_spiral', { x: x - f * 12, y, z: Z3 + 6, scale: 0.42, rotation: f * Math.PI / 2 });
        vfx.loopFx(key + 'g', 'super_flash', { x, y, z: Z3 + 8, scale: 0.3, tint: '#ffb040' });
      } else if (j.c === 'mira') {
        vfx.loopFx(key, 'mira_wind_slash', { x, y, z: Z3 + 6, scale: 0.42, flipX: f < 0 });
        vfx.loopFx(key + 'g', 'mira_wind_ring', { x, y: y - 18, z: Z3 + 4, scale: 0.3 });
      } else if (j.c === 'zed') {
        vfx.loopFx(key, 'zed_thrust', { x: x - f * 60, y, z: Z3 + 6, scale: 0.42, flipX: f < 0 });
      } else if (j.c === 'boss') {
        // OVERCLOCK 的飞旋扳手：真实的 3D 扳手绕纵深轴高速旋转，带红色电光
        const w = wrenchFor(j.i);
        w.position.set(x, y, Z3 + 10);
        w.rotation.z = -f * performance.now() * 0.025;
        w.userData.seen = true;
        vfx.loopFx(key + 'g', 'super_flash', { x, y, z: Z3 + 8, scale: 0.26, tint: '#ff3040' });
      } else {
        vfx.loopFx(key, 'bruno_dust_blast', { x, y: gy, z: Z3 + 6, scale: 0.42 });
        if (Math.random() < 0.5) vfx.dustPuff(new THREE.Vector3(x - f * 14, gy, Z3), 1);
        vfx.loopFx(key + 'g', 'super_flash', { x, y: gy + 10, z: Z3 + 8, scale: 0.22, tint: '#ffb340' });
      }
    }
  }

  const wrenches = new Map();
  function wrenchFor(id) {
    let w = wrenches.get(id);
    if (!w) {
      w = Chars.makeWrench(true);
      w.scale.setScalar(16);
      scene.add(w);
      wrenches.set(id, w);
    }
    return w;
  }
  function sweepWrenches() {
    for (const [id, w] of wrenches) {
      if (!w.userData.seen) { w.removeFromParent(); wrenches.delete(id); }
      else w.userData.seen = false;
    }
  }

  function drawItem(fr, gy, time) {
    const it = fr.b.it, ia = fr.a.it;
    core.visible = !!it;
    if (!it) return;
    const z = ia ? NK.lerp(ia.z, it.z, fr.alpha) : it.z;
    const u = core.userData;
    const blink = it.l < 90 && Math.floor(time * 10) % 2 === 0;
    core.position.set(it.x + X0(), gy, Z3);
    u.gem.position.y = u.shell.position.y = u.halo.position.y = z + 30 + Math.sin(time * 3) * 3;
    u.gem.rotation.y = time * 2.2; u.shell.rotation.y = -time * 1.3; u.shell.rotation.x = time * 0.7;
    u.gem.visible = u.shell.visible = !blink;
    u.halo.material.opacity = 0.6 + 0.25 * Math.sin(time * 6);
    u.ring.position.y = 0.8;
    const rs = 1 + 0.25 * Math.sin(time * 5);
    u.ring.scale.set(rs, 1, rs * 0.6);
  }

  // ======================================================================
  // 世界渲染
  // ======================================================================
  function drawWorld(fr, time, now, dt) {
    const { a, b, alpha, rt } = fr;
    const dk = b.k - a.k;
    const fighters = b.f.map((f) => lerpFighter(a.f, f, alpha, dk));

    // 镜头：跟随两人中点，按距离拉近拉远
    if (fighters.length === 2) {
      const [p, q] = fighters;
      const mid = (p.x + q.x) / 2, dist = Math.abs(p.x - q.x);
      const top = Math.max(p.z, q.z);
      const tw = NK.clamp(Math.max(dist + 280, top * 2.6 + 400), 450, 1060);
      const half = tw / 2;
      const tx = NK.clamp(mid, half - 70, NK.ARENA - half + 70);
      const k = Math.min(1, dt * 6);
      G.cam.w += (tw - G.cam.w) * k;
      G.cam.x += (tx - G.cam.x) * Math.min(1, dt * 9);
    } else if (fighters.length === 1) {
      G.cam.x += (fighters[0].x - G.cam.x) * Math.min(1, dt * 6);
      G.cam.w += (700 - G.cam.w) * Math.min(1, dt * 6);
    }
    let sx = 0, sy = 0;
    if (G.shake > 0.2) {
      sx = (Math.random() * 2 - 1) * G.shake * 0.8; sy = (Math.random() * 2 - 1) * G.shake * 0.8;
      G.shake *= Math.pow(0.86, dt * 60);
    } else G.shake = 0;
    placeCamera(G.cam.x, G.cam.w, sx, sy);

    flushEvents(rt);
    const x0 = X0(), gy = gy0();
    const seen = new Set();
    for (const o of fighters) {
      seen.add(o.i);
      const e = getEnt(o.i, o.c);
      const t = Math.max(0, o._t);
      const raw = o._frozen ? 0 : Math.abs(o._vx);
      e.spd = (e.spd || 0) + (raw - (e.spd || 0)) * Math.min(1, dt * 14);
      o._spd = e.spd;
      e.brain.update(o, t, dt, time);
      const A = e.actor;
      const wx = o.x + x0;
      let jx = 0;
      if (o._frozen && VICTIM[o.s]) jx = Math.sin(now * 0.11) * 2.2;     // 命中停顿中受击方抖动
      // 两人稍微错开纵深，重叠时不会穿插闪烁
      const zz = Z3 + (o.i === 1 ? -3 : 3);
      A.root.position.set(wx + jx, (o.z || 0) + gy, zz);
      stepFx(e, o, t, dt, wx, gy);
      A.fx.flash.value = o.s === 'hurt' && t < 2 ? 0.75 * (1 - t / 2) : o.s === 'block' && o._frozen ? 0.25 : 0;
      A.root.visible = true;
      A.setOpacity(1);
      A.updateStrands(dt);
      e.shadow.position.set(wx, 0.6 + gy, zz);
      const k = Math.max(0.35, 1 - (o.z || 0) / 220);
      e.shadow.scale.set(e.h * 0.6 * k, 1, e.h * 0.3 * k);
      e.shadow.material.opacity = 0.75 * k;
      e.o = o; e.t = t; e.prevS = o.s;
    }
    // 必杀演出需要世界坐标
    supers.update(fighters.map((o) => { const e = G.actors.get(o.i); return e && { o: { ...o, x: o.x + x0 }, e, t: e.t }; }).filter(Boolean), dt, now, time);
    drawProjectiles(fr, gy);
    sweepWrenches();
    drawItem(fr, gy, time);
    vfx.update(dt);
    for (const [seat, e] of G.actors) if (!seen.has(seat)) { disposeEnt(e); G.actors.delete(seat); }
    world.bossLight.intensity = 0;
    fx.update(dt);
    renderer.render(scene, camera);
    return fighters;
  }

  // ======================================================================
  // HUD 层（2D）
  // ======================================================================
  function drawOverlay(fighters, fr, time, now, dt) {
    const b = fr.b;
    // KO 白闪
    if (G.flash && now - G.flash < 260) { ctx.fillStyle = `rgba(255,255,255,${0.7 * (1 - (now - G.flash) / 260)})`; ctx.fillRect(0, 0, W, H); }
    // 拟声字
    G.comics = G.comics.filter((c) => now - c.t0 < 700);
    for (const c of G.comics) {
      const age = (now - c.t0) / 700;
      const pop = age < 0.15 ? 0.5 + (age / 0.15) * 0.8 : 1.3 - Math.min(0.3, (age - 0.15) * 1.2);
      const [x, y] = project(c.x, c.z);
      ctx.save();
      ctx.translate(x, y - age * 34); ctx.rotate(c.rot); ctx.scale(pop, pop);
      ctx.globalAlpha = age > 0.7 ? 1 - (age - 0.7) / 0.3 : 1;
      NK.HUD.text(ctx, c.txt, 0, 0, { font: `italic 900 26px ${NK.HUD.FONT_EN}`, align: 'center', base: 'middle', color: c.col[0], stroke: c.col[1], lw: 7 });
      ctx.restore();
    }
    // 头顶标记：P1 / P2 / CPU
    if (b.ph === 'intro' || b.ph === 'fight') {
      for (const o of fighters) {
        if (o.s === 'special') continue;
        const [x, y0] = project(o.x, (o.z || 0) + 118);
        const slot = G.seats.indexOf(o.i);
        const col = o.cpu ? '#c9c2e6' : NK.HUD.SLOT_COL[o.i - 1];
        const y = y0 + Math.sin(time * 5 + o.i) * 2;
        ctx.fillStyle = col; ctx.strokeStyle = '#0a0614'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - 6, y - 4); ctx.lineTo(x + 6, y - 4); ctx.lineTo(x, y + 3); ctx.closePath(); ctx.stroke(); ctx.fill();
        NK.HUD.text(ctx, o.cpu ? 'CPU' : (slot >= 0 || G.seats.length === 0 ? 'P' + o.i : (o.n || 'P' + o.i)), x, y - 7, { font: `900 11px ${NK.HUD.FONT_EN}`, align: 'center', color: col, lw: 3 });
      }
    }
    // 必杀特写横幅
    supers.drawOverlay(ctx, now, (id) => {
      const e = G.actors.get(id);
      if (!e || !e.o) return null;
      return project(e.o.x, (e.o.z || 0) + 55);
    });
    // 血条 / 计时 / 能量 / 连击
    const local = G.seats.filter((s) => s > 0);
    if (b.f.length) NK.HUD.drawTop(ctx, b, time, dt);
    for (const f of b.f) {
      const side = f.i === 2 ? 1 : 0;
      const slot = G.seats.indexOf(f.i);
      NK.HUD.drawEnergy(ctx, side, f, time, now, slot >= 0 ? NK.Input.labels(slot) : null);
      NK.HUD.drawCombo(ctx, side, f, now);
    }
    NK.HUD.drawCenter(ctx, b, time, local, G.room, local.length ? NK.Input.labels(0) : null);
    const extra = b.md === 'vs' && b.aud ? `观众 ${b.aud}` : '';
    NK.HUD.drawPing(ctx, G.pings.slice(0, G.conns.length || 1), NK.Audio.musicOn, extra);
  }

  function pollInput() {
    if (!G.conns.length) { NK.Input.clearTaps(); return; }
    const blocked = helpOpen();
    G.conns.forEach((c, slot) => c.setMask(blocked ? 0 : NK.Input.mask(slot)));
    NK.Input.clearTaps();
  }

  // ======================================================================
  // 资源加载
  // ======================================================================
  $('startBtn').disabled = true;
  const startLabel = $('startBtn').textContent;
  $('startBtn').textContent = '加载中…';
  loadAll((p) => { $('startBtn').textContent = `加载中 ${Math.round(p * 100)}%`; }).then((A) => {
    assets = A;
    Chars.init(A);
    for (const c of cards) {
      c.actor = Chars.createHero(c.ch, cardScene);
      c.brain = new Anim(c.actor);
      cardScene.add(c.actor.root);
    }
    renderPortraits();
    // 预热：把四名角色各渲染一次，提前编译着色器
    const warm = NK.CHAR_ORDER.map((id) => Chars.createHero(id, scene)).concat([Chars.createRobot('boss', scene)]);
    warm.forEach((a, i) => { a.root.position.set(X0() + 300 + i * 60, 0, Z3); scene.add(a.root); });
    placeCamera(500, 800, 0, 0);
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    warm.forEach((a) => a.dispose());
    vfx.hideAll();
    $('startBtn').disabled = false;
    $('startBtn').textContent = startLabel;
    G.mode = 'lobby';
    window.NK_READY = true;
  }).catch((e) => {
    console.error(e);
    $('startBtn').textContent = '资源加载失败';
  });

  // ======================================================================
  // 主循环
  // ======================================================================
  const t0 = performance.now();
  let last = t0;
  function frame() {
    const now = performance.now();
    const time = (now - t0) / 1000;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    pollInput();
    // KO 慢镜头：让渲染时间暂时落后，再慢慢追回
    const dTick = dt * 1000 / TICK;
    if (now < G.slowUntil) G.lag = Math.min(24, G.lag + dTick * 0.72);
    else if (G.lag > 0) G.lag = Math.max(0, G.lag - dTick * 0.45);
    const pr = hud.width / W;
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const fr = (G.mode === 'game' || G.mode === 'error') && assets ? frames() : null;
    if (fr) {
      const fighters = drawWorld(fr, time, now, dt);
      drawOverlay(fighters, fr, time, now, dt);
      if (NK.afterFrame) NK.afterFrame(fr.b, glCanvas, hud);   // 调试钩子（截图脚本用）
      NK.Audio.setMood(fr.b.arc && fr.b.arc.st >= fr.b.arc.n ? 'boss' : 'normal');
    } else {
      if (G.mode === 'lobby') renderCards(time, dt);
      // 大厅背景：镜头在擂台上缓慢来回平移，每隔一阵换一个擂台
      if (G.mode !== 'game') G.stage = Math.floor(time / 14) % NK.STAGES.length;
      placeCamera(500 + Math.sin(time * 0.25) * 180, 860, 0, 0);
      fx.update(dt);
      vfx.update(dt);
      renderer.render(scene, camera);
      if (G.mode === 'game') NK.HUD.drawWaiting(ctx, time, '正在连接服务器');
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  NK.G = G;
  NK.three = { renderer, scene, camera, world, CAM };
}
