/* ==========================================================================
 * supers.js —— 角色专属必杀的演出：特写横幅（HUD）+ 按服务器阶段触发的特效
 *   凯「升龙旋风」：上升的火焰螺旋 + 余烬，26 tick 终结爆炸
 *   米拉「旋风腿」：双脚龙卷拖尾 + 每段一圈风环，31 tick 终结
 *   布鲁诺「震地拳」：蓄力光 → 砸地冲击波（r220 / r380）、地裂、碎石、强震屏
 *   泽德「棍影乱舞」：长棍残影圆盘 + 突刺光迹
 *   特效本体全部经由 effects.js 的同名函数生成（可整体替换为序列帧）。
 * ========================================================================== */
import * as THREE from 'three';
import { SUPER_NAME, zedWhirl } from './anim.js';

const NK = window.NK;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sm = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _r = new THREE.Vector3(), _g = new THREE.Vector3(), _m = new THREE.Quaternion(), _o = new THREE.Object3D();

export class Supers {
  /** env：{ vfx（effects.js 的 Effects）, K, groundAt(z3), shake(v), portrait(c) } */
  constructor(env) {
    Object.assign(this, env);
    this.cuts = [];         // 特写横幅
    this.state = new Map(); // 玩家 id → 上一帧的必杀 tick
  }

  /** 必杀开始（fx super 事件）：特写横幅 + 原地爆闪 */
  start(ev, now) {
    const c = NK.CHARS[ev.c] ? ev.c : 'kai';
    this.cuts = this.cuts.filter((x) => now - x.t0 < 560);
    this.cuts.push({ c, i: ev.i, t0: now, x: ev.x, y: ev.y, row: this.cuts.length });
    const gy = this.groundAt(ev.y * this.K);
    this.vfx.superFlash(_p.set(ev.x, gy + 55, ev.y * this.K + 4), NK.CHARS[c].color, 30, 230, 320);
    this.vfx.superFlash(_p, '#ffffff', 20, 120, 200);
    this.shake(4);
  }

  /** 布鲁诺冲击波（fx quake 事件）：r 为服务器判定半径（|Δx| ≤ r；纵深容差 70 / 90 世界单位 → three z ×K） */
  quake(ev) {
    const big = ev.r > 300;
    const z3 = ev.y * this.K, gy = this.groundAt(z3);
    _g.set(ev.x, gy, z3);
    this.vfx.quakeRing(_g, ev.r, (big ? 90 : 70) * this.K, big);
    this.vfx.quakeDust(_g, big ? 120 : 30, big ? 8 : 14);
    if (!big) this.vfx.crackDecal(_g, 190, 120);
    this.vfx.superFlash(_p.set(ev.x, gy + 10, z3 + 6), '#ffb340', 40, big ? 260 : 340, 300);
    this.shake(big ? 11 : 16);
  }

  /**
   * 挑空（fx launch，判定 3..6 tick）：拳/脚/棍划出的上挑光弧（Blender 序列帧，按角色挑选并染色）
   *   ev：{ c, x, y, f }。事件在出招第 0 tick 到达，特效延后约 3 tick 与判定帧对齐。
   */
  launch(ev) {
    const c = NK.CHARS[ev.c] ? ev.c : 'kai', f = ev.f || 1, col = NK.CHARS[c].color;
    const V = this.vfx, K = this.K;
    setTimeout(() => {
      const z3 = ev.y * K, gy = this.groundAt(z3);
      const p = _p.set(ev.x + f * 36, gy + 48, z3 + 6);
      if (c === 'kai') {
        if (V.has('kai_fire_burst')) V.spawn('kai_fire_burst', { x: p.x, y: p.y + 6, z: p.z, scale: 0.6 });
      } else if (c === 'mira') {
        if (V.has('mira_wind_slash')) V.spawn('mira_wind_slash', { x: p.x, y: p.y + 4, z: p.z, scale: 0.75, rotation: f > 0 ? 1.1 : -1.1, flipX: f < 0 });
      } else if (c === 'bruno') {
        if (V.has('hit_heavy')) V.spawn('hit_heavy', { x: p.x, y: p.y + 10, z: p.z, scale: 1.25, rotation: f > 0 ? 0.9 : -0.9 });
        V.dustPuff(_q.set(ev.x + f * 10, gy, z3), 2, f * 12);
      } else {
        if (V.has('zed_staff_disc')) { const d = V.fb.getFlipbookDef('zed_staff_disc'); V.spawn('zed_staff_disc', { x: ev.x + f * 22, y: gy + 40, z: z3 + 8, scale: 120 / d.size, flipX: f < 0, duration: 0.22 }); }
      }
      V.superFlash(_r.set(p.x, p.y, p.z), col, 20, 90, 200);
      if (V.has('speed_lines')) V.spawn('speed_lines', { x: p.x, y: p.y + 20, z: p.z, scale: 0.35, rotation: f > 0 ? 1.45 : -1.45, alpha: 0.8, duration: 0.25 });
    }, 95);
  }

  /** 坠击落地（fx slam）：小范围冲击波 + 地裂 + 尘土，按角色叠加火焰 / 风环 / 碎石 / 电光 */
  slam(ev) {
    const c = NK.CHARS[ev.c] ? ev.c : 'kai', col = NK.CHARS[c].color;
    const V = this.vfx, K = this.K;
    const z3 = ev.y * K, gy = this.groundAt(z3);
    _g.set(ev.x, gy, z3);
    V.quakeRing(_g, 100, 34 * K, false);
    V.crackDecal(_g, 80, 50);
    V.dustPuff(_q.set(ev.x - 22, gy, z3), 1);
    V.dustPuff(_q.set(ev.x + 22, gy, z3), 1);
    V.superFlash(_p.set(ev.x, gy + 12, z3 + 6), col, 30, 150, 240);
    if (c === 'kai' && V.has('kai_fire_burst')) V.spawn('kai_fire_burst', { x: ev.x, y: gy + 10, z: z3 + 8, scale: 0.85 });
    else if (c === 'mira' && V.has('mira_wind_ring')) V.spawn('mira_wind_ring', { x: ev.x, y: gy + 4, z: z3 + 6, scale: 0.75, duration: 0.45 });
    else if (c === 'bruno') V.quakeDust(_g, 30, 8);
    else if (V.has('elec_spark')) { V.spawn('elec_spark', { x: ev.x - 14, y: gy + 16, z: z3 + 8, scale: 0.8 }); V.spawn('elec_spark', { x: ev.x + 14, y: gy + 22, z: z3 + 8, scale: 0.7, rotation: 2 }); }
    this.shake(c === 'bruno' ? 10 : 8);
  }

  /** 每帧：ents = [{o, e, t}]（玩家） */
  update(ents, dt, now, time) {
    const K = this.K, V = this.vfx;
    for (const { o, e, t } of ents) {
      const A = e.actor;
      if (o.s !== 'special') { this.state.delete(o.i); if (A.fx && A.fx.tint) A.fx.tint.value.setRGB(0, 0, 0); continue; }
      A.root.updateMatrixWorld(true);
      const c = o.c;
      const z3 = o.y * K, gy = this.groundAt(z3);
      const prevT = this.state.has(o.i) ? this.state.get(o.i) : -1;
      this.state.set(o.i, t);
      const cross = (k) => prevT < k && t >= k;
      let tint = t < 3 ? 0.5 * (1 - t / 3) : 0;     // 起手：全身闪一下角色色
      if (c === 'kai') {
        if (t < 6) tint = Math.max(tint, 0.25 + 0.15 * Math.sin(time * 40));     // 蓄力颤光
        if (t >= 5 && t < 31) {
          const k = sm((t - 5) / 2.5) * (1 - sm((t - 27) / 4));
          V.kaiSpiral(_g.set(o.x, gy, z3), (o.z || 0) + 115, k, time, o.i);
          if (Math.floor(t / 4) !== Math.floor(prevT / 4) && t > 7 && t < 26) tint = 0.35;   // 每段命中闪一下
        }
        if (cross(26)) { A.bones.hand_r.getWorldPosition(_p); V.kaiBurst(_p); this.shake(12); tint = 0.8; }
      } else if (c === 'mira') {
        if (t >= 4 && t < 34) {
          const k = sm((t - 4) / 3) * (1 - sm((t - 31) / 3));
          A.bones.ball_l.getWorldPosition(_p); A.bones.ball_r.getWorldPosition(_q);
          V.miraTornado(_p, _q, _g.set(o.x, gy, z3), k, new THREE.Vector3(o.x, gy + (o.z || 0), z3), o.i);
          _r.set(o.x, (_p.y + _q.y) / 2, z3);
          // 每 5 tick（与多段判定同步）一圈风环；31 tick 终结
          if (t >= 6 && t < 32 && Math.floor((t - 6) / 5) !== Math.floor((prevT - 6) / 5)) V.miraSlash(_r, 1);
          if (cross(31)) { V.miraSlash(_r, 1.7); V.superFlash(_r, '#8ff8ff', 30, 200, 300); this.shake(8); }
        }
      } else if (c === 'bruno') {
        if (t < 13) {
          const k = sm(t / 4);
          A.bones.hand_l.getWorldPosition(_p); A.bones.hand_r.getWorldPosition(_q); _p.lerp(_q, 0.5);
          V.brunoCharge(_p, k, time);
          tint = Math.max(tint, 0.3 * k + 0.12 * Math.sin(time * 30));
          if (cross(1)) V.dustPuff(_g.set(o.x - 24, gy, z3), 4, 16);
        }
      } else if (c === 'zed') {
        const W = zedWhirl(t);
        const staff = A.bones.hand_r.userData.staff;
        if (W && staff) {
          const k = sm((t - 2) / 2) * (1 - sm((t - 19) / 2));
          A.bones.hand_r.getWorldPosition(_p);
          staff.localToWorld(_q.set(0, 0.9, 0)); staff.localToWorld(_r.set(0, -0.9, 0));
          const R = Math.max(_q.distanceTo(_p), _r.distanceTo(_p)) * 1.04;
          // 圆盘平面：身侧立圆（法线 = 角色左右方向）或头顶平转；随棍子相位旋转
          A.model.getWorldQuaternion(_m);
          const tmp = _o; tmp.quaternion.copy(_m);
          if (W.plane === 'side') { tmp.rotateY(Math.PI / 2); tmp.rotateZ(-W.ph); } else { tmp.rotateX(-Math.PI / 2); tmp.rotateZ(W.ph); }
          V.zedWhirlDisc(_p, R, tmp.quaternion, k, _q, o.f >= 0 ? 1 : -1, o.i);
        }
        if (t >= 21.5 && t < 30 && staff) {
          const f = o.f >= 0 ? 1 : -1;
          staff.localToWorld(_q.set(0, 0.9, 0)); staff.localToWorld(_r.set(0, -0.9, 0));
          const tip = f * (_q.x - _r.x) >= 0 ? _q : _r;
          const k = sm((t - 21.5) / 1.2) * (1 - sm((t - 27) / 3));
          V.zedThrust(tip, f, 60 + 200 * sm((t - 22) / 5), k, o.i);
          if (cross(23)) { V.superFlash(_p.copy(tip), '#c8ffd4', 20, 140, 220); this.shake(6); }
        }
      }
      if (A.fx && A.fx.tint) A.fx.tint.value.set(NK.CHARS[c] ? NK.CHARS[c].color : '#ffffff').multiplyScalar(tint);
    }
  }

  /** ---- HUD：特写横幅（约 0.6 秒）。screenOf(id) → [x, y] 角色在屏幕上的位置（聚光暗场用） ---- */
  drawOverlay(ctx, now, screenOf) {
    const W = NK.W, H = NK.H;
    this.cuts = this.cuts.filter((c) => now - c.t0 < 560);
    for (const cut of this.cuts) {
      const age = (now - cut.t0) / 1000;
      const ch = NK.CHARS[cut.c];
      const col = ch.color;
      // 暗场（角色处留出聚光） + 起手白闪（“慢镜头”感）
      const dim = sm(age / 0.05) * (1 - sm((age - 0.28) / 0.24));
      const sp = screenOf(cut.i);
      ctx.save();
      if (sp) {
        const gr = ctx.createRadialGradient(sp[0], sp[1], 40, sp[0], sp[1], 300);
        gr.addColorStop(0, 'rgba(6,2,16,0)'); gr.addColorStop(1, `rgba(6,2,16,${0.5 * dim})`);
        ctx.fillStyle = gr;
      } else ctx.fillStyle = `rgba(6,2,16,${0.4 * dim})`;
      ctx.fillRect(0, 0, W, H);
      if (age < 0.12) { ctx.fillStyle = `rgba(255,255,255,${0.45 * (1 - age / 0.12)})`; ctx.fillRect(0, 0, W, H); }
      // 集中线（围绕角色）
      if (sp && age < 0.4) {
        const k = 1 - age / 0.4;
        ctx.strokeStyle = `rgba(255,255,255,${0.55 * k})`;
        for (let i = 0; i < 28; i++) {
          const a = (i / 28) * Math.PI * 2 + (i % 3) * 0.05;
          const r0 = 90 + ((i * 37) % 50), r1 = 520;
          ctx.lineWidth = 1 + (i % 4);
          ctx.beginPath(); ctx.moveTo(sp[0] + Math.cos(a) * r0, sp[1] + Math.sin(a) * r0 * 0.7); ctx.lineTo(sp[0] + Math.cos(a) * r1, sp[1] + Math.sin(a) * r1 * 0.7); ctx.stroke();
        }
      }
      ctx.restore();
      this.drawBanner(ctx, cut, age, col);
    }
  }

  drawBanner(ctx, cut, age, col) {
    const W = NK.W;
    const HUD = NK.HUD;
    const inK = 1 - Math.pow(1 - clamp(age / 0.09, 0, 1), 3);
    const outK = sm((age - 0.40) / 0.14);
    const cy = 128 + cut.row * 86, bh = 64, skew = 26;
    const dx = (1 - inK) * -W + outK * W;
    ctx.save();
    ctx.globalAlpha = 1 - outK * 0.6;
    ctx.translate(dx, 0);
    // 横幅底：角色色渐变的斜切带
    const path = () => { ctx.beginPath(); ctx.moveTo(-40, cy - bh / 2); ctx.lineTo(W + 40, cy - bh / 2 - skew); ctx.lineTo(W + 40, cy + bh / 2 - skew); ctx.lineTo(-40, cy + bh / 2); ctx.closePath(); };
    const gr = ctx.createLinearGradient(0, 0, W, 0);
    gr.addColorStop(0, NK.shade(col, 0.25)); gr.addColorStop(0.35, col); gr.addColorStop(1, NK.shade(col, 0.15));
    ctx.fillStyle = gr; ctx.globalAlpha *= 0.86; path(); ctx.fill(); ctx.globalAlpha = 1 - outK * 0.6;
    ctx.lineWidth = 4; ctx.strokeStyle = '#0a0614'; path(); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.moveTo(-40, cy - bh / 2 + 6); ctx.lineTo(W + 40, cy - bh / 2 - skew + 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-40, cy + bh / 2 - 6); ctx.lineTo(W + 40, cy + bh / 2 - skew - 6); ctx.stroke();
    // 速度线（带内向左飞掠）
    ctx.save(); path(); ctx.clip();
    for (let i = 0; i < 16; i++) {
      const yy = cy - bh / 2 + 6 + ((i * 23) % (bh - 12)) - skew * 0.5;
      const len = 80 + ((i * 71) % 160);
      const xx = W - ((age * 2600 + i * 173) % (W + len * 2));
      ctx.strokeStyle = `rgba(255,255,255,${0.25 + (i % 3) * 0.15})`; ctx.lineWidth = 1 + (i % 3);
      ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx + len, yy - len * (skew / W)); ctx.stroke();
    }
    ctx.restore();
    // 头像（斜框）
    const px = 150 - (cut.row % 2) * 0, py = cy - 8;
    const pr = this.portrait && this.portrait(cut.c);
    ctx.save();
    ctx.translate(px, py);
    ctx.beginPath(); ctx.moveTo(-52, -44); ctx.lineTo(60, -54); ctx.lineTo(52, 50); ctx.lineTo(-60, 58); ctx.closePath();
    ctx.fillStyle = '#0a0614'; ctx.fill();
    ctx.save(); ctx.clip();
    const pg = ctx.createLinearGradient(0, -50, 0, 60); pg.addColorStop(0, '#ffffff'); pg.addColorStop(1, col);
    ctx.fillStyle = pg; ctx.fillRect(-70, -60, 140, 120);
    if (pr) { const s = 1 + 0.06 * (1 - inK); ctx.drawImage(pr, -60 * s, -58 * s, 120 * s, 120 * s); }
    ctx.restore();
    ctx.lineWidth = 3.5; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    ctx.restore();
    // 招式名：逐字弹入
    const name = SUPER_NAME[cut.c] || '必杀';
    const fs = 44;
    let x = 240;
    for (let i = 0; i < name.length; i++) {
      const k = clamp((age - 0.04 - i * 0.035) / 0.08, 0, 1);
      if (k <= 0) break;
      const s = 1 + 0.9 * (1 - k) * (1 - k);
      const yy = cy + 2 - (x / W) * skew;
      ctx.save();
      ctx.translate(x + fs / 2, yy); ctx.rotate(-0.05); ctx.scale(s, s);
      HUD.text(ctx, name[i], 0, 0, { font: `italic 900 ${fs}px ${HUD.FONT_CN}`, align: 'center', base: 'middle', color: '#ffffff', stroke: '#0a0614', lw: 8, glow: col, blur: 14 });
      ctx.restore();
      x += fs + 6;
    }
    const ch = NK.CHARS[cut.c];
    HUD.text(ctx, `${cut.c.toUpperCase()} · ${ch.cn} · SUPER`, 244, cy - bh / 2 - 6 - (244 / W) * skew, { font: `italic 900 13px ${HUD.FONT_EN}`, color: '#ffe45c', lw: 4 });
    ctx.restore();
  }
}
