/* ==========================================================================
 * actor.js —— 角色通用：动画混合器封装、骨骼程序化叠加（瞄准 / 旋转）、头发飘带物理
 * ========================================================================== */
import * as THREE from 'three';
import { toon, addOutline } from './materials.js';

const _q = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _mq = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

export class Actor {
  constructor(model, clips, unitScale) {
    this.root = new THREE.Group();           // 世界位置（世界单位）
    this.yawG = new THREE.Group();           // 朝向
    this.body = new THREE.Group();           // 程序化整体旋转（倒地 / 旋风）
    this.root.add(this.yawG); this.yawG.add(this.body);
    this.model = model;
    model.scale.setScalar(unitScale);
    this.body.add(model);
    this.unit = unitScale;
    this.mixer = new THREE.AnimationMixer(model);
    this.clips = clips;
    this.actions = {};
    this.cur = null;
    this.curName = '';
    this.bones = {};
    model.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    // 动画输出姿势缓存：AnimationMixer 只在数值变化时才写回骨骼，
    // 因此每帧先恢复上一帧的“纯动画姿势”（撤销程序化叠加），再让混合器更新
    this.pose = Object.values(this.bones).map((b) => [b, b.quaternion.clone(), b.position.clone()]);
    this.rest = this.pose.map((r) => [r[1].clone(), r[2].clone()]);
    this.targets = {};
    this.fx = { flash: { value: 0 }, tint: { value: new THREE.Color(0, 0, 0) } };
    this.yaw = 0;
    this.strands = [];
    this.opacity = 1;
    this.materials = [];
  }

  action(name) {
    let a = this.actions[name];
    if (!a) {
      const c = this.clips[name];
      if (!c) return null;
      a = this.mixer.clipAction(c);
      this.actions[name] = a;
    }
    return a;
  }

  /**
   * 切换/驱动动作。
   * opt.time 给定时为“刷时间”模式（按服务器计时精确定位到某一帧）；否则按 speed 播放。
   * 切换动作不再使用混合器的交叉淡化，而是由 blendFrom() 做“姿势快照”过渡
   * （同时覆盖动作片段和程序化叠加，所有状态切换都不会硬切）。
   */
  play(name, opt = {}) {
    const a = this.action(name);
    if (!a) return;
    if (this.curName !== name || opt.restart) {
      if (opt.fade) this.blendFrom(opt.fade);
      this.stopAll(a);
      a.reset();
      a.enabled = true;
      a.setLoop(opt.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      a.clampWhenFinished = true;
      a.setEffectiveWeight(1);
      if (opt.startAt != null) a.time = opt.startAt;
      a.play();
      this.resetUnanimated([name]);
      this.cur = a; this.curName = name;
    }
    if (opt.time != null) {
      a.time = Math.max(0, Math.min(a.getClip().duration - 1e-3, opt.time));
      a.timeScale = 0;
    } else {
      a.timeScale = opt.speed == null ? 1 : opt.speed;
    }
  }

  /** 某个片段驱动的骨骼通道 */
  clipTargets(name) {
    let t = this.targets[name];
    if (!t) {
      t = { q: new Set(), p: new Set() };
      for (const tr of this.clips[name].tracks) {
        const i = tr.name.lastIndexOf('.');
        const node = tr.name.slice(0, i), prop = tr.name.slice(i + 1);
        if (prop === 'quaternion') t.q.add(node); else if (prop === 'position') t.p.add(node);
      }
      this.targets[name] = t;
    }
    return t;
  }

  /**
   * 切换片段后：新片段不驱动的通道恢复到静止姿势。
   * 否则姿势缓存会一直保留上一个片段的值（例如收招片段里压低的骨盆位移会“粘”在之后的受击动作上）。
   */
  resetUnanimated(names) {
    const ts = names.map((n) => this.clipTargets(n));
    for (let i = 0; i < this.pose.length; i++) {
      const r = this.pose[i], nm = r[0].name;
      if (!ts.some((t) => t.q.has(nm))) r[1].copy(this.rest[i][0]);
      if (!ts.some((t) => t.p.has(nm))) r[2].copy(this.rest[i][1]);
    }
  }

  /** 停掉除 keep 以外的所有动作；记住跑步循环的相位，以便再次起跑时接上 */
  stopAll(keep) {
    for (const k in this.actions) {
      const x = this.actions[k];
      if (x === keep || !x.isScheduled()) continue;   // 注意：刷时间（timeScale 0）的动作 isRunning() 为 false，必须用 isScheduled()
      if (x === this.locoRun) this.runPhase = x.time / x.getClip().duration;
      x.stop();
    }
  }

  /**
   * 移动混合：待机与跑步两个循环同时播放，按 w（0..1）混合权重。
   * 跑步循环的相位在离开/重新进入移动状态时保持连续。
   */
  loco(idleName, runName, w, idleSpeed, runSpeed, fade) {
    const idle = this.action(idleName), run = this.action(runName);
    if (!idle || !run) return;
    const key = 'loco:' + idleName + '/' + runName;
    if (this.curName !== key) {
      if (fade) this.blendFrom(fade);
      for (const k in this.actions) {
        const x = this.actions[k];
        if (x !== idle && x !== run && x.isScheduled()) x.stop();
      }
      if (!idle.isScheduled()) { idle.reset(); idle.setLoop(THREE.LoopRepeat, Infinity); idle.play(); }
      if (!run.isScheduled()) {
        run.reset(); run.setLoop(THREE.LoopRepeat, Infinity);
        run.time = (this.runPhase || 0) * run.getClip().duration;
        run.play();
      }
      this.resetUnanimated([idleName, runName]);
      this.cur = idle; this.curName = key; this.locoRun = run;
    }
    idle.setEffectiveWeight(Math.max(0.001, 1 - w));
    run.setEffectiveWeight(Math.max(0.001, w));
    idle.timeScale = idleSpeed;
    run.timeScale = runSpeed;
  }

  /** 记录当前显示的姿势，之后 dur 秒内从它平滑过渡到新姿势 */
  blendFrom(dur) {
    if (!this.shown || dur <= 0) return;
    if (!this.from) this.from = this.pose.map((r) => [r[1].clone(), r[2].clone()]);
    for (let i = 0; i < this.pose.length; i++) {
      this.from[i][0].copy(this.shown[i][0]);
      this.from[i][1].copy(this.shown[i][1]);
    }
    this.fromBodyQ = (this.fromBodyQ || new THREE.Quaternion()).copy(this.shownBodyQ);
    this.fromBodyP = (this.fromBodyP || new THREE.Vector3()).copy(this.shownBodyP);
    this.blendT = 0; this.blendDur = dur;
  }

  update(dt) {
    for (const r of this.pose) { r[0].quaternion.copy(r[1]); r[0].position.copy(r[2]); }
    this.mixer.update(dt);
    // PropertyMixer 只在结果“看起来变了”时才写回骨骼（与它自己上次的结果比较）；
    // 切换片段后这会让部分骨骼停留在旧姿势上，所以这里把所有活动通道的结果强制写回一次。
    const m = this.mixer, bs = m._bindings, ai = m._accuIndex;
    if (bs && ai != null) {
      for (let i = 0, n = m._nActiveBindings; i < n; i++) {
        const pm = bs[i], st = pm.valueSize;
        pm.binding.setValue(pm.buffer, ai * st + st);
      }
    }
    for (const r of this.pose) { r[1].copy(r[0].quaternion); r[2].copy(r[0].position); }
    this.model.updateMatrixWorld(true);
  }

  /**
   * 每帧最后调用（动作 + 程序化叠加之后）：执行姿势过渡并记录最终显示姿势。
   * dt 为 0（命中停顿）时过渡也随之暂停。
   */
  finish(dt) {
    const bq = this.body.quaternion.setFromEuler(this.body.rotation);
    if (this.blendDur > 0 && this.blendT < this.blendDur) {
      this.blendT += dt;
      let k = Math.min(1, this.blendT / this.blendDur);
      k = k * k * (3 - 2 * k);
      for (let i = 0; i < this.pose.length; i++) {
        const b = this.pose[i][0];
        _q3.copy(b.quaternion);
        b.quaternion.copy(this.from[i][0]).slerp(_q3, k);
        b.position.lerpVectors(this.from[i][1], b.position, k);
      }
      _q3.copy(bq);
      this.body.quaternion.copy(this.fromBodyQ).slerp(_q3, k);
      this.body.position.lerpVectors(this.fromBodyP, this.body.position, k);
    }
    if (!this.shown) {
      this.shown = this.pose.map((r) => [new THREE.Quaternion(), new THREE.Vector3()]);
      this.shownBodyQ = new THREE.Quaternion(); this.shownBodyP = new THREE.Vector3();
    }
    for (let i = 0; i < this.pose.length; i++) {
      const b = this.pose[i][0];
      this.shown[i][0].copy(b.quaternion); this.shown[i][1].copy(b.position);
    }
    this.shownBodyQ.copy(this.body.quaternion); this.shownBodyP.copy(this.body.position);
    this.model.updateMatrixWorld(true);
  }

  /**
   * 脚底离地高度（相对 root，世界单位）：对双脚（及脚趾）上的蒙皮顶点做 CPU 蒙皮取最低点。
   * 动作库的骨盆高度与角色腿长不完全一致，直接播放会让脚陷进地面或悬空，所以每帧按此修正。
   */
  soleHeight(whole) {
    if (!this.soleSets) {
      this.bodySets = [];
      this.soleSets = [];
      const re = this.kind === 'hero' ? /^(foot|ball)_[lr]$/ : /^Foot[LR]$/;
      const meshes = [];
      this.model.traverse((o) => {
        if (!o.isSkinnedMesh || !o.visible) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (m && m.isShaderMaterial) return;   // 描边外壳
        meshes.push(o);
      });
      for (const mesh of meshes) {
        const g = mesh.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
        if (!si || !sw) continue;
        const bones = mesh.skeleton.bones;
        const idx = [];
        for (let i = 0; i < si.count; i++) {
          let best = 0, bw = -1;
          for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
          const b = bones[best];
          if (b && re.test(b.name)) idx.push(i);
        }
        const all = [];
        const bs = Math.max(1, Math.floor(si.count / 260));
        for (let i = 0; i < si.count; i += bs) all.push(i);
        this.bodySets.push({ mesh, idx: all });
        if (!idx.length) continue;
        const step = Math.max(1, Math.floor(idx.length / 90));
        this.soleSets.push({ mesh, idx: idx.filter((_, k) => k % step === 0) });
      }
    }
    const sets = whole ? this.bodySets : this.soleSets;
    if (!sets.length) return null;
    this.root.updateMatrixWorld(true);
    let mn = Infinity;
    for (const { mesh, idx } of sets) {
      mesh.skeleton.update();
      const pos = mesh.geometry.attributes.position;
      for (const i of idx) {
        _v.fromBufferAttribute(pos, i);
        mesh.applyBoneTransform(i, _v);
        _v.applyMatrix4(mesh.matrixWorld);
        if (_v.y < mn) mn = _v.y;
      }
    }
    return mn - this.root.matrixWorld.elements[13];
  }

  /** 设置朝向（平滑转身） */
  face(target, dt, rate = 18) {
    let d = target - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * rate);
    this.yawG.rotation.y = this.yaw;
  }

  /** 以模型空间的轴旋转骨骼（叠加在动画之上） */
  rotate(name, axis, ang) {
    const b = this.bones[name];
    if (!b || !ang) return;
    this.model.getWorldQuaternion(_mq);
    b.parent.getWorldQuaternion(_pq);
    _v.copy(axis).applyQuaternion(_mq).normalize();
    _q.setFromAxisAngle(_v, ang);
    _q2.copy(_pq).invert().multiply(_q).multiply(_pq);
    b.quaternion.premultiply(_q2);
    b.updateMatrixWorld(true);
  }

  /** 把骨骼（到其子骨骼方向）转向模型空间中的目标方向，w 为混合权重 */
  aim(name, child, dirModel, w = 1) {
    const b = this.bones[name], c = this.bones[child];
    if (!b || !c || w <= 0) return;
    b.getWorldPosition(_v); c.getWorldPosition(_v2);
    _v2.sub(_v).normalize();
    this.model.getWorldQuaternion(_mq);
    _v3.copy(dirModel).applyQuaternion(_mq).normalize();
    _q.setFromUnitVectors(_v2, _v3);
    if (w < 1) { _q3.copy(_q); _q.identity().slerp(_q3, w); }
    b.parent.getWorldQuaternion(_pq);
    _q2.copy(_pq).invert().multiply(_q).multiply(_pq);
    b.quaternion.premultiply(_q2);
    b.updateMatrixWorld(true);
  }

  setOpacity(a) {
    if (Math.abs(a - this.opacity) < 0.01) return;
    this.opacity = a;
    for (const m of this.materials) {
      const tr = a < 0.999;
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
      if (m.uniforms && m.uniforms.uOpacity) m.uniforms.uOpacity.value = a;
      else m.opacity = a;
      m.depthWrite = !tr;
    }
    for (const s of this.strands) s.setOpacity(a);
  }

  collectMaterials() {
    const set = new Set();
    this.root.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => set.add(m)); });
    this.materials = [...set];
  }

  updateStrands(dt) { for (const s of this.strands) s.update(dt); }

  dispose() {
    this.mixer.stopAllAction();
    for (const s of this.strands) s.dispose();
    this.root.removeFromParent();
    // 材质为实例私有，释放之（几何体与贴图共享，不释放）
    for (const m of this.materials) m.dispose();
  }
}

/* ======================================================================
 * 飘带 / 马尾：Verlet 链 + 每帧重建的锥形管
 * ====================================================================== */
export class Strand {
  /**
   * @param {THREE.Object3D} anchor 挂点（骨骼上的子节点）
   * @param {object} o {n 节数, len 每节长度(世界单位), r0 r1 起止半径, color, scene, flat 是否为扁平飘带, grav, rest 静止方向(局部)}
   */
  constructor(anchor, o) {
    this.anchor = anchor;
    this.o = Object.assign({ n: 7, len: 4, r0: 2, r1: 0.4, color: '#222', grav: 260, damp: 0.86, flat: false, rest: new THREE.Vector3(0, -0.3, -1), stiff: 0.25, radial: 7 }, o);
    this.pts = []; this.prev = [];
    this.inited = false;
    const N = this.o.n + 1, R = this.o.radial;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * R * 3);
    this.nrm = new Float32Array(N * R * 3);
    const idx = [];
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < R; j++) {
      const a = i * R + j, b = i * R + ((j + 1) % R), c = (i + 1) * R + j, d = (i + 1) * R + ((j + 1) % R);
      idx.push(a, b, c, b, d, c);
    }
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3));
    this.mat = toon({ color: this.o.color, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.o.scene.add(this.mesh);
    this.outlineMesh = this.o.flat ? null : addOutline(this.mesh, 1.0);
  }

  setOpacity(a) {
    for (const m of [this.mat, this.outlineMesh && this.outlineMesh.material]) {
      if (!m) continue;
      const tr = a < 0.999;
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
      if (m.uniforms && m.uniforms.uOpacity) m.uniforms.uOpacity.value = a; else m.opacity = a;
    }
  }

  setVisible(v) { this.mesh.visible = v; if (this.outlineMesh) this.outlineMesh.visible = v; }

  update(dt) {
    const o = this.o, N = o.n + 1;
    this.anchor.updateWorldMatrix(true, false);
    const a = this.anchor.getWorldPosition(new THREE.Vector3());
    const q = this.anchor.getWorldQuaternion(new THREE.Quaternion());
    const restDir = o.rest.clone().applyQuaternion(q).normalize();
    if (!this.inited) {
      for (let i = 0; i < N; i++) {
        const p = a.clone().addScaledVector(restDir, o.len * i);
        this.pts.push(p); this.prev.push(p.clone());
      }
      this.inited = true;
    }
    dt = Math.min(dt, 1 / 30);
    // 积分
    for (let i = 1; i < N; i++) {
      const p = this.pts[i], pv = this.prev[i];
      const vx = (p.x - pv.x) * o.damp, vy = (p.y - pv.y) * o.damp, vz = (p.z - pv.z) * o.damp;
      pv.copy(p);
      p.x += vx; p.y += vy - o.grav * dt * dt; p.z += vz;
      // 朝静止方向的弹力（越靠近根部越硬）
      const k = o.stiff * (1 - (i - 1) / N);
      const tgt = a.clone().addScaledVector(restDir, o.len * i);
      p.lerp(tgt, k);
    }
    this.pts[0].copy(a);
    // 约束
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i < N; i++) {
        const p0 = this.pts[i - 1], p1 = this.pts[i];
        _v.subVectors(p1, p0);
        const l = _v.length() || 1e-4;
        _v.multiplyScalar(o.len / l);
        p1.copy(p0).add(_v);
      }
    }
    // 防止穿到地面以下
    for (let i = 1; i < N; i++) if (this.pts[i].y < 0.5) this.pts[i].y = 0.5;
    this.rebuild(q);
  }

  rebuild(q) {
    const o = this.o, N = o.n + 1, R = o.radial;
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const t = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const p = this.pts[i];
      const pn = this.pts[Math.min(N - 1, i + 1)], pp = this.pts[Math.max(0, i - 1)];
      t.subVectors(pn, pp).normalize();
      u.copy(side).addScaledVector(t, -side.dot(t)).normalize();
      w.crossVectors(t, u).normalize();
      const f = i / (N - 1);
      // 马尾：根部收紧 → 中段蓬起 → 尾端变细
      const prof = o.flat ? 1 : Math.sin(Math.min(1, f * 1.15 + 0.12) * Math.PI) * 0.75 + 0.25;
      const r = (o.r0 + (o.r1 - o.r0) * f) * prof;
      for (let j = 0; j < R; j++) {
        const ang = (j / R) * Math.PI * 2;
        let cx = Math.cos(ang), cy = Math.sin(ang);
        if (o.flat) { cx *= 1; cy *= 0.18; }
        const k = (i * R + j) * 3;
        const nx = u.x * cx + w.x * cy, ny = u.y * cx + w.y * cy, nz = u.z * cx + w.z * cy;
        this.pos[k] = p.x + nx * r; this.pos[k + 1] = p.y + ny * r; this.pos[k + 2] = p.z + nz * r;
        const nl = Math.hypot(nx, ny, nz) || 1;
        this.nrm[k] = nx / nl; this.nrm[k + 1] = ny / nl; this.nrm[k + 2] = nz / nl;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
    this.geo.computeBoundingSphere();
  }

  reset() { this.inited = false; this.pts = []; this.prev = []; }

  dispose() {
    this.mesh.removeFromParent();
    if (this.outlineMesh) { this.outlineMesh.removeFromParent(); this.outlineMesh.material.dispose(); }
    this.geo.dispose(); this.mat.dispose();
  }
}

/* ======================================================================
 * 骨骼链马尾（mira.glb 自带 ponytail_1..N 骨骼）：Verlet 质点跟随，再把每节骨骼转向下一个质点。
 * 与 Strand 同接口（update / setOpacity / setVisible / reset / dispose），网格本身由蒙皮驱动。
 * ====================================================================== */
const _cq = new THREE.Quaternion(), _cq2 = new THREE.Quaternion(), _cq3 = new THREE.Quaternion();
export class BoneChain {
  /** @param {THREE.Bone[]} bones 根→梢；o: {grav, damp, stiff} */
  constructor(bones, o = {}) {
    this.bones = bones;
    this.o = Object.assign({ grav: 320, damp: 0.86, stiff: 0.22, maxAng: 1.0 }, o);
    // 每节在自身局部空间里指向下一节的方向（末节沿用上一节的方向）
    this.dir = bones.map((b, i) => {
      const c = bones[i + 1];
      return c ? c.position.clone().normalize() : (i ? null : new THREE.Vector3(0, 1, 0));
    });
    for (let i = 0; i < this.dir.length; i++) if (!this.dir[i]) this.dir[i] = this.dir[i - 1].clone();
    this.len = bones.map((b, i) => (bones[i + 1] ? bones[i + 1].position.length() : bones[i].position.length() || 0.05));
    this.pts = []; this.prev = []; this.inited = false;
  }

  /** 动画姿势下（未摆动）各质点的世界位置 = 摆动的“静止目标” */
  animPoints(out) {
    const n = this.bones.length;
    for (let i = 0; i < n; i++) {
      const b = this.bones[i];
      b.updateWorldMatrix(true, false);
      out[i] = (out[i] || new THREE.Vector3()).setFromMatrixPosition(b.matrixWorld);
    }
    // 末端：最后一节沿其方向延伸一节
    const last = this.bones[n - 1];
    const s = _v.setFromMatrixScale(last.matrixWorld).x;
    last.getWorldQuaternion(_cq);
    out[n] = (out[n] || new THREE.Vector3()).copy(this.dir[n - 1]).applyQuaternion(_cq).multiplyScalar(this.len[n - 1] * s).add(out[n - 1]);
    return out;
  }

  update(dt) {
    const o = this.o, n = this.bones.length;
    // 骨骼每帧由姿势缓存恢复为静止（未被动画驱动）→ 当前即“跟随头部的静止姿势”
    this.tgt = this.animPoints(this.tgt || []);
    const T = this.tgt;
    if (!this.inited) { this.pts = T.map((p) => p.clone()); this.prev = T.map((p) => p.clone()); this.inited = true; }
    dt = Math.min(dt, 1 / 30);
    const seg = [];
    for (let i = 0; i < n; i++) seg.push(T[i + 1].distanceTo(T[i]));
    this.pts[0].copy(T[0]); this.prev[0].copy(T[0]);
    for (let i = 1; i <= n; i++) {
      const p = this.pts[i], pv = this.prev[i];
      const vx = (p.x - pv.x) * o.damp, vy = (p.y - pv.y) * o.damp, vz = (p.z - pv.z) * o.damp;
      pv.copy(p);
      p.x += vx; p.y += vy - o.grav * dt * dt; p.z += vz;
      p.lerp(T[i], o.stiff * (1 - (i - 1) / (n + 1)));
    }
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i <= n; i++) {
        _v.subVectors(this.pts[i], this.pts[i - 1]);
        const l = _v.length() || 1e-4;
        this.pts[i].copy(this.pts[i - 1]).addScaledVector(_v, seg[i - 1] / l);
      }
    }
    // 每节偏离静止方向不超过 maxAng（避免跳跃/急停时马尾竖起）
    const cosMax = Math.cos(o.maxAng);
    for (let i = 1; i <= n; i++) {
      const r = _v2.subVectors(T[i], T[i - 1]).normalize();
      const d = _v3.subVectors(this.pts[i], this.pts[i - 1]);
      const l = d.length() || 1e-4; d.divideScalar(l);
      const c = d.dot(r);
      if (c < cosMax) {
        // 在 r 与 d 构成的平面内把 d 旋回到 maxAng
        const perp = _v.copy(d).addScaledVector(r, -c).normalize();
        d.copy(r).multiplyScalar(cosMax).addScaledVector(perp, Math.sin(o.maxAng));
        this.pts[i].copy(this.pts[i - 1]).addScaledVector(d, l);
      }
    }
    for (let i = 1; i <= n; i++) if (this.pts[i].y < 0.5) this.pts[i].y = 0.5;
    // 骨骼转向：当前世界方向 → 质点方向
    for (let i = 0; i < n; i++) {
      const b = this.bones[i];
      b.updateWorldMatrix(true, false);
      b.getWorldQuaternion(_cq);
      const cur = _v2.copy(this.dir[i]).applyQuaternion(_cq).normalize();
      const want = _v3.subVectors(this.pts[i + 1], this.pts[i]).normalize();
      _cq2.setFromUnitVectors(cur, want).multiply(_cq);           // 新的世界旋转
      b.parent.getWorldQuaternion(_cq3).invert();
      b.quaternion.copy(_cq3.multiply(_cq2));
      b.updateMatrixWorld(true);
    }
  }

  setOpacity() {}
  setVisible() {}
  reset() { this.inited = false; }
  dispose() {}
}
