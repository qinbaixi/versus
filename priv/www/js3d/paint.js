/* ==========================================================================
 * paint.js —— 在 UV 空间里给基础人体模型“画衣服”
 *   对每个三角形在贴图空间光栅化，插值得到该像素在绑定姿势下的 3D 位置 / 法线 / 骨骼分组权重，
 *   交给角色的规则函数决定颜色（夹克、T 恤、裤子、鞋……），原贴图的明暗细节按比例保留。
 * ========================================================================== */
import * as THREE from 'three';

/** 骨骼 → 身体分组 */
export const GROUPS = ['head', 'neck', 'chest', 'belly', 'pelvis', 'uarm', 'farm', 'hand', 'finger', 'thigh', 'calf', 'foot'];
function boneGroup(name) {
  if (name === 'Head') return 'head';
  if (name === 'neck_01') return 'neck';
  if (name === 'spine_03' || name.startsWith('clavicle')) return 'chest';
  if (name === 'spine_01' || name === 'spine_02') return 'belly';
  if (name === 'pelvis' || name === 'root') return 'pelvis';
  if (name.startsWith('upperarm')) return 'uarm';
  if (name.startsWith('lowerarm')) return 'farm';
  if (name.startsWith('hand')) return 'hand';
  if (/^(index|middle|ring|pinky|thumb)/.test(name)) return 'finger';
  if (name.startsWith('thigh')) return 'thigh';
  if (name.startsWith('calf')) return 'calf';
  return 'foot';
}
/** 肢体参数 t 的起止骨骼（沿骨骼方向 0→1） */
const LIMB = {
  uarm: ['upperarm', 'lowerarm'], farm: ['lowerarm', 'hand'], thigh: ['thigh', 'calf'], calf: ['calf', 'foot'],
  hand: ['hand', 'middle_01'], foot: ['foot', 'ball'],
};

/**
 * 计算网格每个顶点的绑定姿势数据。
 * @returns {{pos:Float32Array, nrm:Float32Array, grp:Float32Array, lt:Float32Array, bones:Object<string,THREE.Vector3>}}
 */
export function vertexData(mesh) {
  const g = mesh.geometry;
  const n = g.attributes.position.count;
  const sk = mesh.skeleton;
  mesh.updateMatrixWorld(true);
  sk.bones.forEach((b) => b.updateMatrixWorld(true));
  const bones = {};
  sk.bones.forEach((b) => { bones[b.name] = b.getWorldPosition(new THREE.Vector3()); });
  const bg = sk.bones.map((b) => GROUPS.indexOf(boneGroup(b.name)));
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), grp = new Float32Array(n * GROUPS.length), lt = new Float32Array(n);
  const v = new THREE.Vector3(), nv = new THREE.Vector3();
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const nm = new THREE.Matrix3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(g.attributes.position, i);
    mesh.applyBoneTransform(i, v);
    v.applyMatrix4(mesh.matrixWorld);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    // 法线：用主骨骼的蒙皮矩阵近似
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k), b = si.getComponent(i, k);
      if (w > 0) grp[i * GROUPS.length + bg[b]] += w;
      if (w > bw) { bw = w; best = b; }
    }
    nm.getNormalMatrix(new THREE.Matrix4().multiplyMatrices(sk.bones[best].matrixWorld, sk.boneInverses[best]).premultiply(mesh.matrixWorld).multiply(mesh.bindMatrix));
    nv.fromBufferAttribute(g.attributes.normal, i).applyMatrix3(nm).normalize();
    nrm[i * 3] = nv.x; nrm[i * 3 + 1] = nv.y; nrm[i * 3 + 2] = nv.z;
    // 肢体参数
    let gi = 0, gw = -1;
    for (let k = 0; k < GROUPS.length; k++) if (grp[i * GROUPS.length + k] > gw) { gw = grp[i * GROUPS.length + k]; gi = k; }
    const lim = LIMB[GROUPS[gi]];
    if (lim) {
      const side = v.x >= 0 ? '_l' : '_r';
      const a = bones[lim[0] + side], b = bones[lim[1] + side];
      if (a && b) {
        const ab = b.clone().sub(a);
        lt[i] = v.clone().sub(a).dot(ab) / ab.lengthSq();
      }
    }
  }
  return { pos, nrm, grp, lt, bones };
}

/** 读取贴图像素 */
function imagePixels(img, W, H) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d', { willReadFrequently: true });
  c.drawImage(img, 0, 0, W, H);
  return { cv, c, data: c.getImageData(0, 0, W, H) };
}

/**
 * 按规则重绘贴图。rule(ctx) 返回 null（保留原皮肤贴图）或 {c:[r,g,b](0..1), d:细节保留 0..1, id:区域编号(用于接缝描线), e:自发光(可选)}
 * ctx: {g:分组名, p:[x,y,z], n:[x,y,z], t:肢体参数, B:骨骼位置表, x,y,z}
 */
export function paintTexture(mesh, vd, rule, size = 1024, skinMul = null) {
  const map = mesh.material.map;
  const img = map.image;
  const W = size, H = size;
  const src = imagePixels(img, W, H);
  const S = src.data.data;
  const out = new Uint8ClampedArray(S);
  const region = new Int16Array(W * H).fill(-1);
  const g = mesh.geometry;
  const uv = g.attributes.uv;
  const idx = g.index;
  const NG = GROUPS.length;
  const { pos, nrm, grp, lt, bones } = vd;
  const ctx = { g: '', p: [0, 0, 0], n: [0, 0, 0], t: 0, B: bones, x: 0, y: 0, z: 0 };
  const gw = new Float32Array(NG);
  const tri = idx ? idx.count / 3 : g.attributes.position.count / 3;
  const ia = [0, 0, 0], ux = [0, 0, 0], uy = [0, 0, 0];
  // 平均亮度（用于细节归一化）
  let lsum = 0, lcnt = 0;
  for (let i = 0; i < S.length; i += 64) { lsum += S[i] * 0.3 + S[i + 1] * 0.59 + S[i + 2] * 0.11; lcnt++; }
  const lavg = Math.max(30, lsum / lcnt);

  for (let t = 0; t < tri; t++) {
    for (let k = 0; k < 3; k++) {
      const vi = idx ? idx.getX(t * 3 + k) : t * 3 + k;
      ia[k] = vi;
      ux[k] = uv.getX(vi) * W; uy[k] = uv.getY(vi) * H;
    }
    const minx = Math.max(0, Math.floor(Math.min(ux[0], ux[1], ux[2]) - 1)), maxx = Math.min(W - 1, Math.ceil(Math.max(ux[0], ux[1], ux[2]) + 1));
    const miny = Math.max(0, Math.floor(Math.min(uy[0], uy[1], uy[2]) - 1)), maxy = Math.min(H - 1, Math.ceil(Math.max(uy[0], uy[1], uy[2]) + 1));
    const d = (uy[1] - uy[2]) * (ux[0] - ux[2]) + (ux[2] - ux[1]) * (uy[0] - uy[2]);
    if (Math.abs(d) < 1e-9) continue;
    // 1.2 像素的外扩，避免 UV 接缝
    const e0 = 1.2 * Math.hypot(uy[1] - uy[2], ux[2] - ux[1]) / Math.abs(d);
    const e1 = 1.2 * Math.hypot(uy[2] - uy[0], ux[0] - ux[2]) / Math.abs(d);
    const e2 = 1.2 * Math.hypot(uy[0] - uy[1], ux[1] - ux[0]) / Math.abs(d);
    for (let py = miny; py <= maxy; py++) {
      for (let px = minx; px <= maxx; px++) {
        const x = px + 0.5, y = py + 0.5;
        let b0 = ((uy[1] - uy[2]) * (x - ux[2]) + (ux[2] - ux[1]) * (y - uy[2])) / d;
        let b1 = ((uy[2] - uy[0]) * (x - ux[2]) + (ux[0] - ux[2]) * (y - uy[2])) / d;
        let b2 = 1 - b0 - b1;
        if (b0 < -e0 || b1 < -e1 || b2 < -e2) continue;
        const pi = py * W + px;
        const inside = b0 >= 0 && b1 >= 0 && b2 >= 0;
        if (!inside && region[pi] !== -1) continue;   // 外扩像素不覆盖已有内部像素
        b0 = Math.max(0, b0); b1 = Math.max(0, b1); b2 = Math.max(0, b2);
        const bs = b0 + b1 + b2; b0 /= bs; b1 /= bs; b2 /= bs;
        const i0 = ia[0], i1 = ia[1], i2 = ia[2];
        for (let k = 0; k < 3; k++) {
          ctx.p[k] = pos[i0 * 3 + k] * b0 + pos[i1 * 3 + k] * b1 + pos[i2 * 3 + k] * b2;
          ctx.n[k] = nrm[i0 * 3 + k] * b0 + nrm[i1 * 3 + k] * b1 + nrm[i2 * 3 + k] * b2;
        }
        let best = 0, bw = -1;
        for (let k = 0; k < NG; k++) {
          gw[k] = grp[i0 * NG + k] * b0 + grp[i1 * NG + k] * b1 + grp[i2 * NG + k] * b2;
          if (gw[k] > bw) { bw = gw[k]; best = k; }
        }
        ctx.g = GROUPS[best];
        ctx.gw = gw;
        ctx.t = lt[i0] * b0 + lt[i1] * b1 + lt[i2] * b2;
        ctx.x = ctx.p[0]; ctx.y = ctx.p[1]; ctx.z = ctx.p[2];
        const r = rule(ctx);
        const o = pi * 4;
        if (!r) {
          region[pi] = 0;
          if (skinMul) { out[o] = S[o] * skinMul[0]; out[o + 1] = S[o + 1] * skinMul[1]; out[o + 2] = S[o + 2] * skinMul[2]; }
          else { out[o] = S[o]; out[o + 1] = S[o + 1]; out[o + 2] = S[o + 2]; }
          continue;
        }
        region[pi] = r.id || 1;
        const lum = (S[o] * 0.3 + S[o + 1] * 0.59 + S[o + 2] * 0.11) / lavg;
        const det = r.d == null ? 0.35 : r.d;
        const k = Math.max(0.35, Math.min(1.35, 1 + (lum - 1) * det));
        out[o] = r.c[0] * 255 * k; out[o + 1] = r.c[1] * 255 * k; out[o + 2] = r.c[2] * 255 * k;
      }
    }
  }
  // 区域边界画深色缝线
  const res = new Uint8ClampedArray(out);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const pi = y * W + x, r0 = region[pi];
      if (r0 < 0) continue;
      const a = region[pi - 1], b = region[pi + 1], c = region[pi - W], e = region[pi + W];
      if ((a >= 0 && a !== r0) || (b >= 0 && b !== r0) || (c >= 0 && c !== r0) || (e >= 0 && e !== r0)) {
        const o = pi * 4;
        res[o] *= 0.45; res[o + 1] *= 0.45; res[o + 2] *= 0.45;
      }
    }
  }
  src.data.data.set(res);
  src.c.putImageData(src.data, 0, 0);
  const tex = new THREE.CanvasTexture(src.cv);
  tex.flipY = map.flipY;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = map.wrapS; tex.wrapT = map.wrapT;
  return tex;
}

/** '#rrggbb' → [r,g,b] (0..1, sRGB) */
export function C(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
