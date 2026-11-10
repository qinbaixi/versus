/* ==========================================================================
 * chars.js —— 角色工厂：主角（Quaternius 通用人体 + 程序化服装/配件）与机器人敌人（RobotExpressive）
 * ========================================================================== */
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { toon, addOutline } from './materials.js';
import { vertexData, paintTexture, GROUPS } from './paint.js';
import { HERO_DEFS } from './heroes.js';
import { Actor, Strand, BoneChain } from './actor.js';

export const DEPTH_K = 2.0;         // 纵深拉伸系数（世界 y → three z），让 2.5D 视角下街道纵深更开阔
export const HERO_H = 100;           // 主角身高（世界单位）
let A = null;                       // 已加载资源
const templates = {};               // 每个主角一份模板（贴图已绘制），实例用 SkeletonUtils.clone

export function init(assets) { A = assets; }

/* ---------------------------------------------------------------- 工具 */
function findSkinned(root, pred) {
  let r = null;
  root.traverse((o) => { if (!r && o.isSkinnedMesh && pred(o)) r = o; });
  return r;
}

/** 头部尺寸测量：在某高度的水平切片里求包围椭圆 */
function headSlice(vd, y, tol = 0.012) {
  const NG = GROUPS.length, hi = GROUPS.indexOf('head');
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9, n = 0;
  for (let i = 0; i < vd.pos.length / 3; i++) {
    if (vd.grp[i * NG + hi] < 0.5) continue;
    const py = vd.pos[i * 3 + 1];
    if (Math.abs(py - y) > tol) continue;
    const px = vd.pos[i * 3], pz = vd.pos[i * 3 + 2];
    minx = Math.min(minx, px); maxx = Math.max(maxx, px); minz = Math.min(minz, pz); maxz = Math.max(maxz, pz); n++;
  }
  if (!n) return null;
  return { cx: (minx + maxx) / 2, cz: (minz + maxz) / 2, rx: (maxx - minx) / 2, rz: (maxz - minz) / 2 };
}
function headTop(vd) {
  const NG = GROUPS.length, hi = GROUPS.indexOf('head');
  let top = -1e9;
  for (let i = 0; i < vd.pos.length / 3; i++) if (vd.grp[i * NG + hi] > 0.5) top = Math.max(top, vd.pos[i * 3 + 1]);
  return top;
}

/** 把一个在模型空间（绑定姿势）定义的物体挂到骨骼上，保持当前世界位姿 */
function attachToBone(bone, obj) {
  bone.updateWorldMatrix(true, false);
  const inv = bone.matrixWorld.clone().invert();
  obj.updateMatrix();
  obj.matrix.premultiply(inv);
  obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
  bone.add(obj);
}

/** 把头发等独立蒙皮网格重新绑定到角色骨架 */
function rebindTo(mesh, bonesByName) {
  const sk = mesh.skeleton;
  const bones = sk.bones.map((b) => bonesByName[b.name] || b);
  const nsk = new THREE.Skeleton(bones, sk.boneInverses.map((m) => m.clone()));
  mesh.bind(nsk, mesh.bindMatrix.clone());
}

/** 法线方向膨胀（让布鲁诺更壮） */
function inflate(mesh, vd, amount) {
  const g = mesh.geometry.clone();
  const p = g.attributes.position, n = g.attributes.normal;
  const np = new Float32Array(p.count * 3);
  // 世界(米) ↔ 网格局部的比例
  const a = new THREE.Vector3().fromBufferAttribute(p, 0), b = new THREE.Vector3().fromBufferAttribute(p, Math.floor(p.count / 2));
  const wa = new THREE.Vector3(vd.pos[0], vd.pos[1], vd.pos[2]), wb = new THREE.Vector3().fromArray(vd.pos, Math.floor(p.count / 2) * 3);
  const s = wa.distanceTo(wb) / Math.max(1e-6, a.distanceTo(b));
  const NG = GROUPS.length;
  const W = { head: 0, neck: 0.8, chest: 1.2, belly: 0.8, pelvis: 0.6, uarm: 1.3, farm: 1.0, hand: 0.3, finger: 0.1, thigh: 0.9, calf: 0.7, foot: 0.15 };
  const v = new THREE.Vector3(), nv = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    let w = 0;
    for (let k = 0; k < NG; k++) w += vd.grp[i * NG + k] * W[GROUPS[k]];
    v.fromBufferAttribute(p, i); nv.fromBufferAttribute(n, i).normalize();
    v.addScaledVector(nv, (amount * w) / s);
    np[i * 3] = v.x; np[i * 3 + 1] = v.y; np[i * 3 + 2] = v.z;
  }
  g.setAttribute('position', new THREE.BufferAttribute(np, 3));
  g.computeBoundingSphere();
  mesh.geometry = g;
}

/* ---------------------------------------------------------------- 建模主角（mira.glb / kai.glb：Blender 中建模的服装/头发/骨骼链） */
function buildModelTemplate(id, def) {
  const src = A[def.model];
  const scene = SkeletonUtils.clone(src.scene);
  scene.updateMatrixWorld(true);
  const bonesByName = {};
  scene.traverse((o) => { if (o.isBone) bonesByName[o.name] = o; });
  // 身高基准：与原始基础模型一致（同一骨架、同一比例）
  const base = findSkinned(A[def.base].scene, (m) => /Superhero/i.test(m.material.name));
  const baseTex = base.material.map;
  const height = (() => { const bb = new THREE.Box3().setFromObject(base); return bb.max.y - bb.min.y; })();
  const parts = {};
  let skinParent = null;
  scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const name = o.material && o.material.name;
    const spec = def.mats[name];
    if (!spec) return;
    const mat = Object.assign({}, spec);
    delete mat.outline;
    if (spec.skin) { delete mat.skin; mat.map = baseTex; if (base.material.normalMap) mat.normalMap = base.material.normalMap; }
    parts[o.uuid] = { mesh: o, mat, outline: spec.outline == null ? 1 : spec.outline };
    if (!skinParent) skinParent = o.parent;
  });
  // 眼睛 / 眉毛沿用基础模型（同名骨骼重新绑定）
  const bs = SkeletonUtils.clone(A[def.base].scene);
  for (const [re, key, outline] of [[/Eye/i, 'eyes', 0], [/Hair/i, 'brows', 0]]) {
    const m = findSkinned(bs, (x) => re.test(x.material.name) && !/Superhero/i.test(x.material.name));
    if (!m) continue;
    m.removeFromParent(); skinParent.add(m);
    rebindTo(m, bonesByName);
    parts[key] = { mesh: m, mat: key === 'eyes' ? { map: m.material.map } : { color: def.browColor, map: m.material.map }, outline };
  }
  return { id, def, scene, parts, accMeshes: [], height, anchorNames: [], anchorsTpl: {} };
}

/* ---------------------------------------------------------------- 主角模板 */
function buildHeroTemplate(id) {
  const def = HERO_DEFS[id];
  if (def.model) return buildModelTemplate(id, def);
  const src = A[def.base];
  const scene = SkeletonUtils.clone(src.scene);
  scene.updateMatrixWorld(true);
  const body = findSkinned(scene, (m) => /Superhero/i.test(m.material.name));
  const eyes = findSkinned(scene, (m) => /Eye/i.test(m.material.name));
  const brows = findSkinned(scene, (m) => /Hair/i.test(m.material.name));
  const bonesByName = {};
  scene.traverse((o) => { if (o.isBone) bonesByName[o.name] = o; });

  const vd = vertexData(body);
  const tex = paintTexture(body, vd, def.paint, 1024, def.skinMul);
  if (def.bulk) inflate(body, vd, def.bulk);
  const top = headTop(vd);
  const height = scene.userData.h = (() => { const bb = new THREE.Box3().setFromObject(body); return bb.max.y - bb.min.y; })();

  const parts = {
    body: { mesh: body, mat: { map: tex, normalMap: body.material.normalMap || null }, outline: 1 },
    eyes: eyes && { mesh: eyes, mat: { map: eyes.material.map }, outline: 0 },
    brows: brows && { mesh: brows, mat: { color: def.browColor, map: brows.material.map }, outline: 0 },
  };

  // 头发 / 胡子
  const hairs = [];
  for (const key of [def.hair, def.beard]) {
    if (!key || !A[key]) continue;
    const hs = SkeletonUtils.clone(A[key].scene);
    hs.traverse((o) => {
      if (o.isSkinnedMesh) hairs.push(o);
    });
  }
  for (const h of hairs) {
    const parent = body.parent;
    h.removeFromParent();
    parent.add(h);
    rebindTo(h, bonesByName);
    parts['hair_' + h.name] = { mesh: h, mat: { color: def.hairColor }, outline: 0.8 };
  }

  // ---- 配件（模型空间、绑定姿势下构建，再挂到骨骼）
  const head = bonesByName.Head;
  const acc = def.acc || {};
  const accMeshes = [];   // {mesh, outline}
  const anchors = {};
  if (acc.headband) {
    const y = top - 0.075;
    const s = headSlice(vd, y) || { cx: 0, cz: 0, rx: 0.08, rz: 0.1 };
    const g = new THREE.TorusGeometry(1, 0.11, 8, 32);
    const m = new THREE.Mesh(g, null);
    m.userData.mat = { color: acc.headband };
    m.rotation.x = Math.PI / 2 + 0.12;
    m.scale.set(s.rx * 1.06, s.rz * 1.06, 0.2);   // 圆环的管径随 scale.z 不变 —— 用较小 z 让带子扁一点
    m.position.set(s.cx, y, s.cz);
    m.userData.tube = true;
    // 用更精细的方式：管径按头宽缩放
    m.geometry = new THREE.TorusGeometry(1, 0.13, 8, 36);
    m.scale.set(s.rx * 1.07, s.rz * 1.07, 0.11);
    attachToBone(head, m);
    accMeshes.push({ mesh: m, outline: 0.9 });
    // 飘带挂点：后脑结
    const knot = new THREE.Object3D();
    knot.position.set(s.cx, y + 0.005, s.cz - s.rz * 1.06);
    attachToBone(head, knot);
    anchors.band = knot;
    const kb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), null);
    kb.userData.mat = { color: acc.headband };
    kb.position.set(s.cx, y + 0.005, s.cz - s.rz * 1.08);
    kb.scale.set(1.3, 1, 0.8);
    attachToBone(head, kb);
    accMeshes.push({ mesh: kb, outline: 0.9 });
  }
  if (acc.ponytail) {
    const y = top - 0.04;
    const s = headSlice(vd, y - 0.02) || { cx: 0, cz: 0, rx: 0.08, rz: 0.1 };
    const tie = new THREE.Object3D();
    const tp = new THREE.Vector3(s.cx, y, s.cz - s.rz * 0.92);
    tie.position.copy(tp);
    attachToBone(head, tie);
    anchors.pony = tie;
    // 发圈
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.009, 6, 16), null);
    ring.userData.mat = { color: '#6ff0ff', emissive: '#3ad8ff' };
    ring.position.copy(tp).add(new THREE.Vector3(0, 0.0, -0.012));
    ring.rotation.x = 0.9;
    attachToBone(head, ring);
    accMeshes.push({ mesh: ring, outline: 0.6 });
    // 马尾根部的发团
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 10), null);
    bun.userData.mat = { color: def.hairColor };
    bun.position.copy(tp).add(new THREE.Vector3(0, 0.012, 0.02));
    attachToBone(head, bun);
    accMeshes.push({ mesh: bun, outline: 0.8 });
  }
  if (acc.cap) {
    const y = top - 0.085;
    const s = headSlice(vd, y) || { cx: 0, cz: 0, rx: 0.08, rz: 0.1 };
    const ry = top - y + 0.016;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), null);
    dome.userData.mat = { color: acc.cap };
    dome.scale.set(s.rx * 1.12, ry, s.rz * 1.1);
    dome.position.set(s.cx, y, s.cz - 0.004);
    attachToBone(head, dome);
    accMeshes.push({ mesh: dome, outline: 1 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24, 1, false, -Math.PI / 2, Math.PI), null);
    brim.userData.mat = { color: acc.capBrim };
    brim.scale.set(s.rx * 1.05, 0.012, s.rz * 0.95);
    brim.position.set(s.cx, y + 0.005, s.cz + s.rz * 0.55);
    brim.rotation.x = 0.16;
    attachToBone(head, brim);
    accMeshes.push({ mesh: brim, outline: 1 });
    // 帽顶小扣 + 正面徽标
    const btn = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 6), null);
    btn.userData.mat = { color: acc.capBrim };
    btn.position.set(s.cx, top + 0.014, s.cz);
    attachToBone(head, btn);
    accMeshes.push({ mesh: btn, outline: 0 });
    const logo = new THREE.Mesh(new THREE.CircleGeometry(0.026, 16), null);
    logo.userData.mat = { color: acc.capBrim, emissive: '#3a2a00' };
    logo.position.set(s.cx, y + 0.045, s.cz + s.rz * 1.09);
    logo.rotation.x = -0.35;
    attachToBone(head, logo);
    accMeshes.push({ mesh: logo, outline: 0 });
  }
  if (acc.staff) {
    const B = vd.bones;
    const hand = bonesByName.hand_r;
    const I = B.index_01_r, P = B.pinky_01_r, H = B.hand_r, M = B.middle_01_r;
    const ax = (new URLSearchParams(location.search).get('sax') || acc.staffAxis || 'x').split('');
    const lv = new THREE.Vector3(ax.includes('x') ? 1 : 0, ax.includes('y') ? 1 : 0, ax.includes('z') ? 1 : 0);
    if (ax.includes('-')) lv.negate();
    const axis = lv.applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const grip = H.clone().lerp(M, 0.75);
    // 掌心方向偏移
    const palm = new THREE.Vector3().subVectors(B.thumb_01_r, H).normalize();
    grip.addScaledVector(palm, 0.012);
    const L = 1.8;
    const staff = new THREE.Group();
    staff.name = 'staff';
    const wood = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, L, 10), null);
    wood.userData.mat = { color: acc.staff };
    staff.add(wood);
    for (const e of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.12, 10), null);
      cap.userData.mat = { color: '#d8c27a', emissive: '#2a2000' };
      cap.position.y = e * (L / 2 - 0.06);
      staff.add(cap);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.025, 10), null);
      band.userData.mat = { color: '#2a1a10' };
      band.position.y = e * (L / 2 - 0.2);
      staff.add(band);
    }
    // 握在 38% 处
    staff.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    staff.position.copy(grip).addScaledVector(axis, L * 0.07);
    attachToBone(hand, staff);
    staff.traverse((o) => { if (o.isMesh) accMeshes.push({ mesh: o, outline: 0.9 }); });
  }
  if (acc.coat) {
    const B = vd.bones;
    const yTop = B.pelvis.y + 0.1, yBot = B.calf_l.y + 0.06;
    // 测量腰部截面
    let rx = 0.17, rz = 0.13;
    {
      const NG = GROUPS.length;
      let mx = 0, mzp = 0, mzn = 0;
      for (let i = 0; i < vd.pos.length / 3; i++) {
        const py = vd.pos[i * 3 + 1];
        if (Math.abs(py - yTop) > 0.03) continue;
        const gi = vd.grp[i * NG + GROUPS.indexOf('pelvis')] + vd.grp[i * NG + GROUPS.indexOf('belly')];
        if (gi < 0.5) continue;
        mx = Math.max(mx, Math.abs(vd.pos[i * 3])); mzp = Math.max(mzp, vd.pos[i * 3 + 2]); mzn = Math.min(mzn, vd.pos[i * 3 + 2]);
      }
      if (mx > 0) { rx = mx; rz = (mzp - mzn) / 2; }
    }
    const H = yTop - yBot, gap = 0.42;
    const geo = new THREE.CylinderGeometry(1, 1, H, 24, 8, true, gap, Math.PI * 2 - gap * 2);
    const pos = geo.attributes.position;
    const si = [], sw = [];
    const bones = [bonesByName.pelvis, bonesByName.thigh_l, bonesByName.thigh_r, bonesByName.calf_l, bonesByName.calf_r];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), yy = pos.getY(i), z = pos.getZ(i);
      const h = (H / 2 - yy) / H;               // 0 顶 → 1 底
      const flare = 1.06 + h * 0.42;
      const backBoost = z < 0 ? 1 + h * 0.15 : 1;
      pos.setXYZ(i, x * rx * flare, yTop - h * H, z * rz * flare * backBoost + 0.0);
      const side = x >= 0 ? 0 : 1;              // 左/右
      const lat = Math.min(1, Math.abs(x) * 1.6);
      const wt = Math.min(0.9, h * 1.1) * (0.35 + 0.65 * lat);
      const wc = h > 0.85 ? (h - 0.85) * 1.2 * lat : 0;
      si.push(0, 1 + side, 3 + side, 0);
      sw.push(1 - wt, wt - wc, wc, 0);
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.computeVertexNormals();
    const coat = new THREE.SkinnedMesh(geo, null);
    coat.userData.mat = { color: acc.coat, side: THREE.DoubleSide };
    body.parent.add(coat);
    coat.updateMatrixWorld(true);
    const sk = new THREE.Skeleton(bones);
    coat.bind(sk, coat.matrixWorld.clone());
    coat.frustumCulled = false;
    accMeshes.push({ mesh: coat, outline: 1 });
  }

  return { id, def, scene, parts, accMeshes, height, anchorNames: Object.keys(anchors), anchorsTpl: anchors };
}

/* ---------------------------------------------------------------- 主角实例 */
export function createHero(id, scene3d) {
  if (!templates[id]) templates[id] = buildHeroTemplate(id);
  const T = templates[id];
  const def = T.def;
  // 克隆前给模板对象打上标记，克隆后按标记找回
  T.scene.traverse((o) => { o.userData.tplId = o.uuid; });
  const model = SkeletonUtils.clone(T.scene);
  const byTpl = {};
  model.traverse((o) => { if (o.userData.tplId) byTpl[o.userData.tplId] = o; });

  const unit = (HERO_H * def.height) / T.height;
  const actor = new Actor(model, A.clips, unit);
  actor.kind = 'hero'; actor.cid = id;
  const fx = actor.fx;

  const mk = (spec, src) => {
    const p = Object.assign({}, spec);
    if (p.emissive) p.emissive = new THREE.Color(p.emissive);
    const m = toon(p, fx);
    if (src && src.material && src.material.side != null && p.side == null) m.side = THREE.FrontSide;
    return m;
  };
  for (const k in T.parts) {
    const part = T.parts[k];
    if (!part) continue;
    const m = byTpl[part.mesh.uuid];
    m.material = mk(part.mat, part.mesh);
    if (part.mat.normalMap) { m.material.normalMap = part.mat.normalMap; m.material.normalScale = new THREE.Vector2(0.7, 0.7); }
    m.castShadow = true;
    m.frustumCulled = false;
    if (part.outline) addOutline(m, part.outline);
  }
  for (const a of T.accMeshes) {
    const m = byTpl[a.mesh.uuid];
    m.material = mk(a.mesh.userData.mat);
    m.castShadow = true;
    m.frustumCulled = false;
    if (a.outline) addOutline(m, a.outline);
  }
  actor.collectMaterials();

  // 骨骼链摆动（建模主角：米拉的马尾、凯的头带飘带）
  const chains = def.chains || (def.chain ? [def.chain] : []);
  for (const names of chains) {
    const bones = names.map((n) => actor.bones[n]).filter(Boolean);
    if (bones.length) actor.strands.push(new BoneChain(bones, Object.assign({ grav: 900, damp: 0.85, stiff: 0.25, maxAng: 0.9 }, def.chainOpts || {})));
  }
  // 物理飘带
  const acc = def.acc || {};
  if (acc.headband) {
    const anc = byTpl[T.anchorsTpl.band.uuid];
    for (const sx of [-1, 1]) {
      const o = new THREE.Object3D();
      o.position.set(sx * 0.01 / unit * 40, 0, 0);
      anc.add(o);
      actor.strands.push(new Strand(o, { scene: scene3d, n: 6, len: 2.3, r0: 1.1, r1: 0.7, flat: true, color: acc.headband,
        rest: new THREE.Vector3(sx * 0.25, -0.5, -1), grav: 200, stiff: 0.12, damp: 0.9, radial: 6 }));
    }
  }
  if (acc.ponytail) {
    const anc = byTpl[T.anchorsTpl.pony.uuid];
    actor.strands.push(new Strand(anc, { scene: scene3d, n: 8, len: 3.6, r0: 2.6, r1: 0.5, color: def.hairColor,
      rest: new THREE.Vector3(0, -0.55, -1), grav: 320, stiff: 0.2, damp: 0.88, radial: 8 }));
  }
  actor.hero = def;
  return actor;
}

/* ======================================================================
 * 机器人敌人（RobotExpressive by Tomás Laulhé / Quaternius, CC0）
 * ====================================================================== */
export const ROBOT_DEFS = {
  grunt:   { h: 88, wide: 1.0,  main: '#7d6fa6', grey: '#5a5468', black: '#18141f', eye: '#3df2ff' },
  spark:   { h: 68, wide: 0.95, main: '#ff7a1a', grey: '#ffd08a', black: '#2a1408', eye: '#ffe14a' },
  brute:   { h: 112, wide: 1.32, main: '#34343f', grey: '#5c5c70', black: '#0d0d12', eye: '#7dff4a' },
  thrower: { h: 86, wide: 1.0,  main: '#3f8f6a', grey: '#a4c8a0', black: '#122018', eye: '#ff9df0' },
  boss:    { h: 130, wide: 1.12, main: '#3a1f3f', grey: '#d8a83a', black: '#0e0a14', eye: '#ff3030' },
};
let robotH = 0;

export function createRobot(type, scene3d) {
  const def = ROBOT_DEFS[type] || ROBOT_DEFS.grunt;
  const model = SkeletonUtils.clone(A.robot.scene);
  if (!robotH) { const bb = new THREE.Box3().setFromObject(A.robot.scene); robotH = bb.max.y - bb.min.y; }
  const unit = def.h / robotH;
  const actor = new Actor(model, A.robotClips, unit);
  actor.kind = 'robot'; actor.rtype = type;
  model.scale.set(unit * def.wide, unit, unit * def.wide);
  const fx = actor.fx;
  const eyeEmissive = { value: 0 };
  actor.eye = new THREE.Color(def.eye);
  const mats = {};
  model.traverse((o) => {
    if (!o.isMesh) return;
    const conv = (m) => {
      if (!mats[m.name]) {
        let col = def.main, emissive = null, ei = 0;
        if (m.name === 'Grey') col = def.grey;
        if (m.name === 'Black') { col = def.black; emissive = def.eye; ei = 0.9; }
        const tm = toon({ color: col }, fx);
        if (emissive) { tm.emissive = new THREE.Color(emissive); tm.emissiveIntensity = ei; tm.userData.eye = true; }
        mats[m.name] = tm;
      }
      return mats[m.name];
    };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
    o.castShadow = true;
    o.frustumCulled = false;
  });
  const meshes = [];
  model.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) addOutline(m, type === 'boss' ? 1.4 : 1);
  actor.eyeMat = mats.Black;

  // 类型特征（几何尺寸以机器人模型单位给出：身高约 4.8）
  const place = (boneName, obj, x, y, z) => {
    const bone = actor.bones[boneName];
    obj.position.set(x, y, z);
    model.add(obj);
    model.updateMatrixWorld(true);
    if (bone) bone.attach(obj);
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    const ms = []; obj.traverse((o) => { if (o.isMesh && !o.userData.noOutline) ms.push(o); });
    for (const m of ms) addOutline(m, 1);
    return obj;
  };
  if (type === 'thrower') {
    const w = makeWrench(false);
    w.rotation.set(0.3, 0, 0.5);
    actor.wrench = place('Palm2R', w, -1.35, 1.0, 1.05);
    const pack = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.3, 0.7), toon({ color: '#2c3a2c' }, fx));
    pack.add(box);
    for (const sx of [-0.45, 0.45]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.0, 10), toon({ color: '#c8a030' }, fx));
      t.position.set(sx, 0.75, -0.1); pack.add(t);
    }
    place('Torso_1', pack, 0, 2.05, -0.75);
  }
  if (type === 'spark') {
    const g = new THREE.Group();
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6), toon({ color: '#ffd08a' }, fx));
    ant.position.y = 0.5; g.add(ant);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffe14a' }));
    tip.position.y = 1.05; tip.userData.noOutline = true; g.add(tip);
    actor.sparkTip = tip;
    place('Head', g, 0, 4.45, 0);
  }
  if (type === 'brute') {
    for (const sx of [-1, 1]) {
      const g = new THREE.Group();
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), toon({ color: '#22222b' }, fx));
      pad.scale.set(1.1, 0.85, 1.1); g.add(pad);
      const stud = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.45, 8), toon({ color: '#9aa0b0' }, fx));
      stud.position.y = 0.6; g.add(stud);
      place(sx > 0 ? 'ShoulderL' : 'ShoulderR', g, sx * 0.72, 2.35, 0);
    }
  }
  if (type === 'boss') {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), new THREE.MeshBasicMaterial({ color: '#ff2a3a' }));
    core.userData.noOutline = true; g.add(core);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 8, 24), toon({ color: '#d8a83a', emissive: new THREE.Color('#3a2400') }, fx));
    g.add(ring);
    actor.core = core;
    place('Torso_1', g, 0, 2.0, 0.62);
    for (let i = -2; i <= 2; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7 - Math.abs(i) * 0.12, 0.6), toon({ color: '#d8a83a' }, fx));
      fin.rotation.z = -i * 0.2;
      place('Head', fin, i * 0.34, 4.55 - Math.abs(i) * 0.08, -0.2);
    }
  }
  actor.collectMaterials();
  return actor;
}

/** 扳手（投射物 / 投掷兵手持） */
export function makeWrench(outline = true) {
  const g = new THREE.Group();
  const mat = toon({ color: '#c8ccd8' });
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.5, 0.12), mat);
  g.add(handle);
  for (const e of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.1, 6, 12, Math.PI * 1.45), mat);
    head.position.y = e * 0.85;
    head.rotation.z = e > 0 ? -Math.PI * 0.22 : Math.PI * 0.78;
    g.add(head);
  }
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.6, 0.16), toon({ color: '#d4142a' }));
  grip.position.y = -0.2;
  g.add(grip);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  const meshes = []; g.traverse((o) => { if (o.isMesh) meshes.push(o); });
  if (outline) for (const m of meshes) addOutline(m, 0.8);
  return g;
}

/* ---------------------------------------------------------------- 冲刺残影 */
/**
 * 为角色创建 n 个残影：共享几何与骨骼结构的克隆，用加色半透明的纯色材质。
 * copyPose(actor) 把当前骨骼姿势与世界变换拷贝过去。
 */
export function createGhosts(actor, n, color, scene3d) {
  const list = [];
  for (let i = 0; i < n; i++) {
    const root = SkeletonUtils.clone(actor.model);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
    root.traverse((o) => {
      if (!o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m && m.isShaderMaterial) { o.visible = false; return; }   // 描边外壳不需要
      o.material = mat;
      o.castShadow = false; o.receiveShadow = false;
      o.renderOrder = 3; o.frustumCulled = false;
    });
    const srcBones = [], dstBones = [];
    actor.model.traverse((o) => { if (o.isBone) srcBones.push(o); });
    root.traverse((o) => { if (o.isBone) dstBones.push(o); });
    root.matrixAutoUpdate = false;
    root.visible = false;
    scene3d.add(root);
    list.push({
      root, mat, live: false, life: 0,
      copyPose(a) {
        a.model.updateMatrixWorld(true);
        root.matrix.copy(a.model.matrixWorld);
        for (let k = 0; k < dstBones.length && k < srcBones.length; k++) {
          dstBones[k].position.copy(srcBones[k].position);
          dstBones[k].quaternion.copy(srcBones[k].quaternion);
          dstBones[k].scale.copy(srcBones[k].scale);
        }
        root.updateMatrixWorld(true);
      },
      dispose() { root.removeFromParent(); mat.dispose(); },
    });
  }
  return list;
}
