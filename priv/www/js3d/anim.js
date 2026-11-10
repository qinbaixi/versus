/* ==========================================================================
 * anim.js —— 服务器状态 → 动画（动作片段 + 程序化叠加）
 *   时间单位：tick（服务器 30 tick/s），t = 进入当前状态后经过的 tick（可为小数，命中停顿时冻结）
 *
 *   连贯性：
 *   - 每次进入新状态（含连招下一段、受击重置）都从“当前显示姿势”平滑过渡（Actor.blendFrom），
 *     动作片段与程序化叠加一起过渡，不会硬切；进攻类过渡短（≈0.05s），回到待机/移动长（≈0.2s）。
 *   - 出招时间轴与服务器判定帧对齐：蓄力 → 击中（判定帧）→ 收招，收招可被下一段取消。
 *   - 待机 ↔ 跑步按实际地面速度混合，跑步步频随速度变化，跑步循环相位保持连续。
 *   - 命中停顿（hs）期间 dt = 0：动画与过渡都冻结。
 * ========================================================================== */
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const X = V(1, 0, 0), Y = V(0, 1, 0), Z = V(0, 0, 1);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sm = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const easeIn = (t) => Math.pow(clamp(t, 0, 1), 1.6);
const easeOut = (t) => { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t); };

/** 出招包络：0 → 1（判定开始）→ 保持到判定结束 → 收招回 0 */
function env(t, a0, a1, end) {
  if (t < a0) return easeIn(t / a0);
  if (t < a1) return 1;
  return 1 - sm((t - a1) / Math.max(0.5, end - a1));
}

// 连招：clip / 起始秒 a / 击中秒 h / 结束秒 b；rec = 收招片段（从其 0 秒播到 recEnd）
// 服务器：第 1/2 段 9 tick（判定 3–4），第 3 段 15 tick（判定 4–7），再加角色快慢修正
const QUICK = { kai: 0, mira: -2, bruno: 2, zed: 1 };
const COMBO = {
  kai: {
    // 程序化拳击连段（侧面朝向，沿面朝方向出拳）：刺拳 → 后手直拳 → 升龙上勾拳
    1: { clip: 'Idle_Loop', a: 0.3, h: 0.3, b: 0.3, post: (a, t, A0, A1, D, br) => kaiPunch(a, t, A0, A1, D, KAI_MOVES.jab, br) },
    2: { clip: 'Idle_Loop', a: 0.3, h: 0.3, b: 0.3, post: (a, t, A0, A1, D, br) => kaiPunch(a, t, A0, A1, D, KAI_MOVES.cross, br) },
    3: { clip: 'Idle_Loop', a: 0.3, h: 0.3, b: 0.3, noStep: true, post: (a, t, A0, A1, D, br) => kaiPunch(a, t, A0, A1, D, KAI_MOVES.upper, br) },
  },
  mira: {
    1: { clip: 'Punch_Jab', a: 0.08, h: 0.3, b: 0.6 },
    2: { clip: 'Idle_Loop', a: 0.3, h: 0.3, b: 0.3, noStep: true, post: midKick },
    3: { clip: 'Idle_Loop', a: 0.3, h: 0.3, b: 0.3, noStep: true, post: highKick },
  },
  bruno: {
    1: { clip: 'Punch_Cross', a: 0.1, h: 0.36, b: 0.72 },
    2: { clip: 'Melee_Hook', a: 0.0, h: 0.22, rec: 'Melee_Hook_Rec', recEnd: 0.5 },
    3: { clip: 'Sword_Attack', a: 0.25, h: 0.62, b: 1.2 },
  },
  zed: {
    1: { clip: 'Sword_Regular_A', a: 0.0, h: 0.17, rec: 'Sword_Regular_A_Rec', recEnd: 0.25 },
    2: { clip: 'Sword_Regular_B', a: 0.0, h: 0.21, rec: 'Sword_Regular_B_Rec', recEnd: 0.25 },
    3: { clip: 'Sword_Attack', a: 0.25, h: 0.62, b: 1.2 },
  },
};

// 进入各状态时的过渡时长（秒）
const FADE = {
  loco: 0.16, run: 0.1, runatk: 0.05, launch: 0.05, slam: 0.06, slamland: 0.04, air: 0.08, attack: 0.06, dash: 0.05, jump: 0.06, jattack: 0.06, land: 0.05, special: 0.07,
  hurt: 0.05, knockdown: 0.08, down: 0.16, dead: 0.2, out: 0.2, getup: 0.1, grab: 0.1, throw: 0.06,
  crouch: 0.09, block: 0.05, bstep: 0.05, cjab: 0.04, sweep: 0.05, cast: 0.06, grabbed: 0.06, win: 0.25,
  windup: 0.1, cwind: 0.1, recover: 0.16, bpunch: 0.08, bstomp: 0.06, charge: 0.1, grabbed: 0.08, thrown: 0.06, dying: 0.15,
};
// 从这些状态回到待机/移动时用更长的过渡（收招 / 落地 / 受击恢复）
const SLOW_EXIT = { crouch: 0.12, block: 0.12, cjab: 0.1, sweep: 0.16, cast: 0.16, bstep: 0.12, launch: 0.16, slamland: 0.18, run: 0.15, runatk: 0.2, attack: 0.14, land: 0.18, hurt: 0.22, getup: 0.2, special: 0.2, dash: 0.2, throw: 0.22, grab: 0.18, recover: 0.2 };

/* ---------------------------------------------------------------- 程序化招式 */
/*
 * 踢腿：按“提膝（chamber）→ 伸展（extend）→ 收腿（retract）”关键帧插值。
 * 方向均为模型空间：+z = 面朝方向，+y = 上，+x = 角色左侧（右腿在 -x 侧）。
 * 骨盆绕 Y 轴正向转动 = 右髋向前送（侧踢的发力方向，身体保持侧面朝向镜头）。
 */
const nrm = (v) => v.clone().normalize();
const lerpDir = (a, b, k) => a.clone().lerp(b, k).normalize();
const KICKS = {
  // 中段侧踢：膝盖提到髋高，小腿水平踢出
  mid: {
    twist: 0.35, lean: -0.22,
    chamber: { thigh: V(-0.05, 0.3, 0.95), calf: V(0, -0.9, 0.35), foot: V(0, -0.2, 1) },
    ext: { thigh: V(-0.04, 0.12, 1), calf: V(-0.02, 0.1, 1), foot: V(0, 0.45, 0.9) },
  },
  // 高踢：提膝更高，脚踢到头部高度，上身后仰配重
  high: {
    twist: 0.5, lean: -0.4,
    chamber: { thigh: V(-0.06, 0.6, 0.8), calf: V(0, -0.55, 0.85), foot: V(0, 0.1, 1) },
    ext: { thigh: V(-0.04, 0.55, 0.84), calf: V(-0.03, 0.62, 0.79), foot: V(0, 0.85, 0.55) },
  },
  // 空中飞踢：前腿伸直略向下，后腿收起
  fly: {
    twist: 0.3, lean: -0.3,
    chamber: { thigh: V(-0.04, 0.25, 0.97), calf: V(0, -0.85, 0.5), foot: V(0, -0.3, 1) },
    ext: { thigh: V(-0.04, -0.2, 0.98), calf: V(-0.02, -0.25, 0.97), foot: V(0, 0.2, 1) },
  },
};
/** 支撑腿微屈、双拳护架（保持重心） */
function kickBody(a, P, w, air) {
  a.rotate('pelvis', Y, P.twist * w);
  a.rotate('spine_01', X, P.lean * w);
  a.rotate('spine_02', Y, -P.twist * 0.6 * w);       // 肩膀回正：上身仍朝向前方
  if (air) {
    a.aim('thigh_l', 'calf_l', nrm(V(0.05, 0.35, 0.94)), w);
    a.aim('calf_l', 'foot_l', nrm(V(0, -0.85, -0.5)), w);
  } else {
    a.aim('thigh_l', 'calf_l', nrm(V(0.08, -0.95, 0.22)), w);
    a.aim('calf_l', 'foot_l', nrm(V(0.02, -0.96, -0.26)), w);
    a.aim('foot_l', 'ball_l', nrm(V(0.05, -0.15, 1)), w * 0.8);
  }
  // 护架：前手在下巴前，后手护胸
  a.aim('upperarm_l', 'lowerarm_l', nrm(V(0.35, -0.65, 0.55)), w);
  a.aim('lowerarm_l', 'hand_l', nrm(V(-0.1, 0.75, 0.6)), w);
  a.aim('upperarm_r', 'lowerarm_r', nrm(V(-0.4, -0.8, 0.25)), w);
  a.aim('lowerarm_r', 'hand_r', nrm(V(0.15, 0.8, 0.5)), w);
}
/** e：0 = 提膝，1 = 完全伸展；w：整体权重 */
function kickLeg(a, P, e, w) {
  const c = P.chamber, x = P.ext;
  a.aim('thigh_r', 'calf_r', lerpDir(c.thigh, x.thigh, e), w);
  a.aim('calf_r', 'foot_r', lerpDir(c.calf, x.calf, e), w);
  a.aim('foot_r', 'ball_r', lerpDir(c.foot, x.foot, e), w);
}
/** 地面踢腿时间轴：A0 前 1.5 tick 提膝 → A0 伸直（判定帧）→ A1+0.5 保持 → 收腿 → D 回架势 */
function groundKick(a, t, A0, A1, D, P) {
  const c0 = Math.max(0.8, A0 - 1.5);
  const w = t < c0 ? easeOut(t / c0) : t < A1 + 2 ? 1 : 1 - sm((t - A1 - 2) / Math.max(1, D - A1 - 2));
  const e = t < c0 ? 0 : t < A0 ? easeIn((t - c0) / (A0 - c0)) : t < A1 + 0.5 ? 1 : 1 - easeOut((t - A1 - 0.5) / 2);
  kickBody(a, P, w, false);
  kickLeg(a, P, e, w);
}
function midKick(a, t, A0, A1, D) { groundKick(a, t, A0, A1, D, KICKS.mid); }
function highKick(a, t, A0, A1, D) { groundKick(a, t, A0, A1, D, KICKS.high); }

/*
 * 凯的拳法：每招三个关键姿势 —— C 蓄力（预备动作）、E 击出（判定帧保持）、F 送拳（随势），再回到拳架 G。
 *   ua / la：上臂 / 前臂方向（模型空间）；tw：骨盆转动（+ = 右髋向前）；sp：上身相对转动；ln：前倾；hd：头部回正；
 *   bend：+1 屈膝下蹲蓄力，-1 蹬地伸展（后腿离地）；lift：升龙离地高度。
 * 时间轴与服务器判定对齐：A0 之前约 1.4 tick 完成蓄力 → A0 拳到位 → 保持到 A1+0.5 → 送拳 → D 回到拳架。
 */
const KAI_GUARD = { l: { ua: V(0.35, -0.75, 0.45), la: V(-0.15, 0.85, 0.55) }, r: { ua: V(-0.3, -0.8, 0.35), la: V(0.1, 0.8, 0.6) } };
const KAI_MOVES = {
  jab: { arm: 'l', strike: 1.3,
    C: { ua: V(0.5, -0.7, 0.1), la: V(-0.1, 0.92, 0.25), tw: -0.05, sp: 0.16, ln: -0.02, hd: -0.05, bend: 0.25 },
    E: { ua: V(-0.05, 0.12, 1), la: V(-0.04, 0.07, 1), tw: -0.15, sp: -0.4, ln: 0.14, hd: 0.3, bend: 0.1 },
    F: { ua: V(0.2, -0.25, 0.9), la: V(-0.12, 0.5, 0.85), tw: -0.08, sp: -0.2, ln: 0.08, hd: 0.15, bend: 0.1 } },
  cross: { arm: 'r', strike: 1.4,
    C: { ua: V(-0.5, -0.75, -0.05), la: V(0.05, 0.92, 0.3), tw: -0.18, sp: -0.25, ln: -0.04, hd: 0.15, bend: 0.3 },
    E: { ua: V(0.05, 0.1, 1), la: V(0.04, 0.06, 1), tw: 0.5, sp: 0.42, ln: 0.18, hd: -0.4, bend: 0.1 },
    F: { ua: V(0.12, -0.05, 1), la: V(0.15, 0.3, 0.95), tw: 0.6, sp: 0.5, ln: 0.2, hd: -0.45, bend: 0.15 } },
  upper: { arm: 'r', strike: 1.8, lift: 18,
    C: { ua: V(-0.22, -0.95, -0.05), la: V(0.1, 0.2, 1), tw: -0.3, sp: -0.32, ln: 0.42, hd: -0.25, bend: 1 },
    E: { ua: V(-0.06, 0.68, 0.74), la: V(0.0, 0.95, 0.32), tw: 0.45, sp: 0.35, ln: -0.18, hd: -0.25, bend: -1 },
    F: { ua: V(-0.05, 0.9, 0.42), la: V(0.0, 0.96, -0.25), tw: 0.5, sp: 0.4, ln: -0.24, hd: -0.25, bend: -0.6 } },
};
function mixPose(P, Q, k) {
  return {
    ua: lerpDir(P.ua, Q.ua, k), la: lerpDir(P.la, Q.la, k),
    tw: P.tw + (Q.tw - P.tw) * k, sp: P.sp + (Q.sp - P.sp) * k, ln: P.ln + (Q.ln - P.ln) * k,
    hd: P.hd + (Q.hd - P.hd) * k, bend: P.bend + (Q.bend - P.bend) * k,
  };
}
function kaiLegs(a, b) {
  if (b > 0) {        // 下蹲蓄力：双膝前屈
    a.aim('thigh_l', 'calf_l', nrm(V(0.12, -0.72, 0.68)), b);
    a.aim('calf_l', 'foot_l', nrm(V(0.02, -0.9, -0.42)), b);
    a.aim('thigh_r', 'calf_r', nrm(V(-0.12, -0.8, 0.5)), b);
    a.aim('calf_r', 'foot_r', nrm(V(-0.02, -0.88, -0.48)), b);
  } else if (b < 0) { // 蹬地升起：前腿伸直，后腿拖在身后、脚尖绷直
    const w = -b;
    a.aim('thigh_l', 'calf_l', nrm(V(0.06, -1, 0.1)), w);
    a.aim('calf_l', 'foot_l', nrm(V(0.02, -1, -0.05)), w);
    a.aim('foot_l', 'ball_l', nrm(V(0, -0.75, 0.66)), w * 0.8);
    a.aim('thigh_r', 'calf_r', nrm(V(-0.06, -0.95, -0.3)), w);
    a.aim('calf_r', 'foot_r', nrm(V(-0.02, -0.75, -0.66)), w);
    a.aim('foot_r', 'ball_r', nrm(V(0, -0.85, 0.5)), w);
  }
}
function kaiPunch(a, t, A0, A1, D, M, brain) {
  const s = M.arm, o = s === 'l' ? 'r' : 'l';
  const G = { ua: KAI_GUARD[s].ua, la: KAI_GUARD[s].la, tw: 0, sp: 0, ln: 0, hd: 0, bend: 0 };
  const c0 = Math.max(0.8, A0 - M.strike), hold = A1 + 0.5;
  let P;
  if (t < c0) P = mixPose(G, M.C, easeOut(t / c0));
  else if (t < A0) P = mixPose(M.C, M.E, easeIn((t - c0) / (A0 - c0)));
  else if (t < hold) P = M.E;
  else {
    const k = clamp((t - hold) / Math.max(1, D - hold), 0, 1);
    P = k < 0.3 ? mixPose(M.E, M.F, sm(k / 0.3)) : mixPose(M.F, G, easeOut((k - 0.3) / 0.7));
  }
  a.rotate('pelvis', Y, P.tw);
  a.rotate('spine_02', Y, P.sp);
  a.rotate('spine_01', X, P.ln);
  a.rotate('Head', Y, P.hd);
  kaiLegs(a, P.bend);
  a.aim('upperarm_' + o, 'lowerarm_' + o, KAI_GUARD[o].ua, 1);
  a.aim('lowerarm_' + o, 'hand_' + o, KAI_GUARD[o].la, 1);
  a.aim('upperarm_' + s, 'lowerarm_' + s, P.ua, 1);
  a.aim('lowerarm_' + s, 'hand_' + s, P.la, 1);
  if (M.lift && brain) {   // 升龙：蹬地后整体离地（落地修正之后再加）
    const L = t < c0 ? 0 : t < A0 + 1 ? easeOut((t - c0) / (A0 + 1 - c0)) : t < A1 + 1.5 ? 1 : 1 - sm((t - A1 - 1.5) / Math.max(1, D - A1 - 2.5));
    brain.lift = M.lift * L;
  }
}

/* ---------------------------------------------------------------- v7：疾走 / 疾走攻击 / 远跳 / 边打边走 / 角色专属必杀 */
const SPD = { kai: 4.2, mira: 5.2, bruno: 3.4, zed: 4.0 };   // 与服务器 char_stats 一致（单位/tick）
export const SUPER_LEN = { kai: 38, mira: 40, bruno: 34, zed: 36, boss: 44 };
export const SUPER_NAME = { kai: '升龙旋风', mira: '旋风腿', bruno: '震地拳', zed: '棍影乱舞', boss: '超频连锤' };
/** 必杀的离地高度（与服务器 super_step 相同的公式；查看器 / 大厅预览用） */
export function superZ(id, t) {
  if (id === 'kai') return t <= 6 ? 0 : t <= 26 ? 75 * Math.sin((Math.PI / 2) * (t - 6) / 20) : Math.max(0, 75 * (1 - (t - 26) / 10));
  if (id === 'mira') return t <= 5 ? (22 * t) / 5 : t <= 32 ? 22 : Math.max(0, 22 * (1 - (t - 32) / 6));
  if (id === 'bruno') return t <= 11 ? 60 * Math.sin((Math.PI / 2) * t / 11) : t <= 14 ? 60 * (1 - (t - 11) / 3) : 0;
  return 0;
}
const ramp = (t, a, b) => sm((t - a) / Math.max(1e-3, b - a));
const arm = (a, s, ua, la, w = 1) => { a.aim('upperarm_' + s, 'lowerarm_' + s, nrm(ua), w); a.aim('lowerarm_' + s, 'hand_' + s, nrm(la), w); };
const leg = (a, s, th, ca, w = 1, ft) => {
  a.aim('thigh_' + s, 'calf_' + s, nrm(th), w); a.aim('calf_' + s, 'foot_' + s, nrm(ca), w);
  if (ft) a.aim('foot_' + s, 'ball_' + s, nrm(ft), w);
};

/** 把泽德的长棍（长端，+y 轴）转向模型空间中的方向 dir：旋转右手腕 */
const _sq = new THREE.Quaternion(), _sq2 = new THREE.Quaternion(), _sq3 = new THREE.Quaternion(), _sv = new THREE.Vector3(), _sv2 = new THREE.Vector3();
function aimStaff(a, dir, w = 1) {
  const hand = a.bones.hand_r;
  const st = hand && (hand.userData.staff || (hand.userData.staff = hand.getObjectByName('staff')));
  if (!st || w <= 0) return;
  st.updateWorldMatrix(true, false);
  _sv.set(0, 1, 0).applyQuaternion(st.getWorldQuaternion(_sq)).normalize();
  _sv2.copy(dir).normalize().applyQuaternion(a.model.getWorldQuaternion(_sq2));
  _sq.setFromUnitVectors(_sv, _sv2);
  if (w < 1) { _sq3.copy(_sq); _sq.identity().slerp(_sq3, w); }
  hand.parent.getWorldQuaternion(_sq2);
  _sq3.copy(_sq2).invert().multiply(_sq).multiply(_sq2);
  hand.quaternion.premultiply(_sq3);
  hand.updateMatrixWorld(true);
}
/** 泽德必杀舞棍的平面：'side' 身侧立圆（镜头正面可见），'top' 头顶平转 */
export function zedWhirl(t) {
  if (t < 2 || t >= 20) return null;
  const top = t >= 11 && t < 17;
  return { plane: top ? 'top' : 'side', ph: (t - 2) * ((Math.PI * 2) / 3.2) };
}

/**
 * 边打边走：上身照常出招，双腿按实际移动方向（模型空间）迈步 —— 不再像在冰面上滑。
 * mv：模型空间移动方向（x 侧向，z 前后），phase：步伐相位，w：权重
 */
function stepLegs(a, mv, phase, w) {
  if (w <= 0.01) return;
  const s = Math.sin(phase), c = Math.cos(phase);
  for (const [side, sg, sx] of [['l', 1, 0.1], ['r', -1, -0.1]]) {
    const sw = s * sg, lift = Math.max(0, c * sg);
    leg(a, side, V(sx + mv.x * 0.42 * sw, -1, mv.z * 0.42 * sw + 0.05),
      V(sx * 0.4 + mv.x * 0.25 * sw, -1, mv.z * 0.25 * sw - 0.6 * lift), w);
  }
}

/** 疾走：身体前倾、步频随速度、双臂大幅摆动（相位跟随跑步循环） */
function sprintBody(a, k, phase, zed) {
  a.rotate('spine_01', X, 0.34 * k);
  a.rotate('Head', X, -0.18 * k);
  const s = Math.sin(phase * Math.PI * 2);
  // 前后摆臂：肘部弯曲约 90°，与对侧腿同相
  arm(a, 'l', V(0.2, -0.62, -0.85 * s), V(0.05, 0.35 + 0.25 * s, 0.95), 0.9 * k);
  if (zed) arm(a, 'r', V(-0.3, -0.85, -0.25), V(0.05, -0.2, 1), 0.8 * k);   // 泽德右手拖棍在身侧
  else arm(a, 'r', V(-0.2, -0.62, 0.85 * s), V(-0.05, 0.35 - 0.25 * s, 0.95), 0.9 * k);
}

/** 疾走攻击（18 tick，判定 3..11）：每人一招 */
function runAttack(a, id, t, brain) {
  const k = ramp(t, 0, 1.6) * (1 - ramp(t, 12, 18));
  a.rotate('spine_01', X, 0.25 * (1 - ramp(t, 10, 18)));   // 保持疾走的前倾
  if (id === 'kai') {
    // 飞膝：腾空顶膝，双手下拉
    const air = t > 1.5 && t < 13 ? Math.sin(Math.PI * clamp((t - 1.5) / 11.5, 0, 1)) : 0;
    brain.lift = 16 * air;
    brain.ground = air > 0.05 ? 'none' : null;
    a.rotate('spine_01', X, 0.3 * k);
    a.rotate('pelvis', Y, 0.25 * k);
    leg(a, 'r', V(-0.05, 0.5, 0.86), V(0, -0.82, -0.55), k, V(0, -0.9, 0.3));
    leg(a, 'l', V(0.06, -0.72, -0.68), V(0.02, -0.55, -0.85), k, V(0, -0.6, -0.8));
    arm(a, 'l', V(0.25, 0.15, 1), V(-0.25, -0.55, 0.8), k);
    arm(a, 'r', V(-0.25, 0.15, 1), V(0.25, -0.55, 0.8), k);
  } else if (id === 'mira') {
    // 滑铲踢：身体后仰贴地，前腿贴地伸直踢出，后腿折叠
    brain.ground = 'whole';
    a.rotate('spine_01', X, -0.75 * k);
    a.rotate('Head', X, 0.45 * k);
    leg(a, 'r', V(-0.04, -0.1, 1), V(-0.02, -0.06, 1), k, V(0, 0.55, 0.84));
    leg(a, 'l', V(0.2, -0.55, 0.8), V(0.05, -0.15, -1), k);
    arm(a, 'r', V(-0.45, -0.7, -0.55), V(-0.1, -0.9, -0.2), k);
    arm(a, 'l', V(0.35, -0.2, 0.9), V(-0.2, 0.6, 0.75), k);
  } else if (id === 'bruno') {
    // 肩撞：压低重心、右肩在前猛撞，左臂后摆
    a.rotate('pelvis', Y, 0.55 * k);
    a.rotate('spine_02', Y, 0.35 * k);
    a.rotate('spine_01', X, 0.45 * k);
    a.rotate('Head', Y, -0.6 * k);
    arm(a, 'r', V(-0.35, -0.55, 0.75), V(0.75, 0.2, 0.5), k);
    arm(a, 'l', V(0.35, -0.6, -0.7), V(0.05, 0.2, -1), k);
    leg(a, 'l', V(0.08, -0.65, 0.75), V(0.02, -0.92, -0.38), k);
    leg(a, 'r', V(-0.08, -0.82, -0.55), V(-0.02, -0.6, -0.8), k);
  } else {
    // 泽德：疾走中前刺长棍（弓步）
    a.rotate('spine_01', X, 0.38 * k);
    a.rotate('pelvis', Y, 0.3 * k);
    leg(a, 'l', V(0.08, -0.55, 0.83), V(0.02, -1, -0.08), k);
    leg(a, 'r', V(-0.06, -0.62, -0.78), V(-0.02, -0.5, -0.86), k);
    arm(a, 'r', V(-0.08, 0.05, 1), V(0.02, 0.05, 1), k);
    arm(a, 'l', V(0.12, 0, 1), V(-0.25, 0.05, 1), k);
    aimStaff(a, V(0, 0.03, 1), k);
  }
}

/** 远跳（疾走中起跳）：鱼跃前扑 —— 双臂前伸，双腿后摆，落地前收腿 */
function diveLeap(a, t, k) {
  const land = ramp(t, 13, 19);
  const w = k * (1 - land * 0.85);
  a.rotate('spine_01', X, 0.42 * w);
  a.rotate('Head', X, -0.35 * w);
  arm(a, 'l', V(0.3, 0.55, 0.8), V(0.1, 0.45, 0.9), w);
  arm(a, 'r', V(-0.3, 0.55, 0.8), V(-0.1, 0.45, 0.9), w);
  leg(a, 'l', V(0.08, -0.55, -0.83), V(0.02, -0.25, -0.97), w, V(0, -0.6, -0.8));
  leg(a, 'r', V(-0.05, -0.85, -0.5), V(-0.02, -0.4, -0.92), w, V(0, -0.6, -0.8));
  if (land > 0) tuck(a, land * k);
}

/* ---- 必杀 ---- */
/** 凯「升龙旋风」38 tick：1-6 蓄力下蹲 → 7-26 螺旋上升（多段） → 26 终结（双拳冲天） → 27-36 下落 → 落地 */
function superKai(a, t, brain) {
  if (t < 6.5) {
    const k = ramp(t, 0, 3);
    const tr = Math.sin(t * 9) * 0.02 * k;   // 蓄力颤动
    a.rotate('pelvis', Y, -0.35 * k);
    a.rotate('spine_02', Y, -0.3 * k + tr);
    a.rotate('spine_01', X, 0.45 * k);
    kaiLegs(a, 1.15 * k);
    arm(a, 'r', V(-0.25, -0.92, -0.3), V(0.1, 0.1, 1), k);
    arm(a, 'l', V(0.35, -0.75, 0.45), V(-0.15, 0.85, 0.55), k);
    return;
  }
  if (t < 27) {
    const u = (t - 6) / 20;
    // 匀减速旋转 3 圈，正好转回正面
    const spin = Math.PI * 2 * 3 * (1 - (1 - u) * (1 - u));
    a.body.rotation.y = -spin;
    a.body.rotation.z = 0.16 * Math.sin(Math.PI * u);
    const k = ramp(t, 6, 8);
    const fin = ramp(t, 23, 26);
    a.rotate('pelvis', Y, 0.45 * k);
    a.rotate('spine_01', X, -0.2 * k);
    a.rotate('Head', X, -0.25 * k);
    kaiLegs(a, -1 * k);
    leg(a, 'l', V(0.1, -0.25, 0.96), V(0.02, -1, 0.12), 0.85 * k * (1 - 0.5 * fin));   // 升龙：前膝高抬
    arm(a, 'r', V(-0.06, 0.92, 0.38), V(0, 1, 0.1), k);
    arm(a, 'l', V(0.35 + 0.35 * fin, -0.6 + 1.3 * fin, 0.5 - 0.3 * fin), V(-0.15 + 0.4 * fin, 0.85, 0.5 - 0.4 * fin), k);
    return;
  }
  // 下落：收腿，双拳回架势；落地缓冲下蹲
  const k = 1 - ramp(t, 35, 38);
  const land = ramp(t, 33.5, 36) * (1 - ramp(t, 36, 38));
  tuck(a, k * (1 - land));
  if (land > 0) kaiLegs(a, 0.8 * land);
  arm(a, 'l', KAI_GUARD.l.ua, KAI_GUARD.l.la, k);
  arm(a, 'r', V(-0.05, 0.3, 0.95), V(0.1, 0.8, 0.6), k);
}

/** 米拉「旋风腿」40 tick：1-5 起跳 → 6-32 倒立回旋踢（腿劈开横扫，向前移动） → 31 终结 → 33-40 前空翻落地 */
function superMira(a, t, brain) {
  const hip = 0.5 * 100;   // 主角髋部高度（世界单位，HERO_H=100）
  let flip = 0;
  if (t < 4) {
    const c = ramp(t, 0, 2) * (1 - ramp(t, 2, 4));
    kaiLegs(a, c);
    arm(a, 'l', V(0.4, 0.6 * (1 - c), 0.5), V(0.1, 0.8, 0.5), 0.8);
    arm(a, 'r', V(-0.4, 0.6 * (1 - c), 0.5), V(-0.1, 0.8, 0.5), 0.8);
  } else if (t < 33) {
    flip = Math.PI * ramp(t, 4, 7.5);
    const spin = (t - 4) * (0.95 + 0.35 * ramp(t, 27, 31));      // 末段加速
    a.body.rotation.y = -spin;
    const open = 1 - 0.55 * ramp(t, 30, 31.5) * (1 - ramp(t, 31.5, 33));   // 终结一击：双腿一合一开
    leg(a, 'l', V(1, 0.12 * open, 0.05), V(1, 0.1, 0.05), 1, V(1, 0.2, 0));
    leg(a, 'r', V(-1, 0.12 * open, 0.05), V(-1, 0.1, 0.05), 1, V(-1, 0.2, 0));
    arm(a, 'l', V(0.35, 1, 0.1), V(0.2, 1, 0), ramp(t, 4, 8));
    arm(a, 'r', V(-0.35, 1, 0.1), V(-0.2, 1, 0), ramp(t, 4, 8));
    a.rotate('Head', X, 0.3);
  } else {
    // 前空翻收身落地
    flip = Math.PI * (1 + ramp(t, 33, 37.5));
    const k = 1 - ramp(t, 37.5, 40);
    tuck(a, k);
    arm(a, 'l', V(0.35, -0.6, 0.6), V(-0.1, 0.6, 0.8), k);
    arm(a, 'r', V(-0.35, -0.6, 0.6), V(0.1, 0.6, 0.8), k);
  }
  if (flip) {
    // 绕髋部翻转（不是绕脚底）
    a.body.rotation.x = flip;
    a.body.position.y += hip * (1 - Math.cos(flip));
    a.body.position.z += -hip * Math.sin(flip);
    brain.ground = 'none';
  }
}

/** 布鲁诺「震地拳」34 tick：1-11 高跳蓄力（双拳举过头） → 11-14 下砸 → 14 右拳砸地（冲击波一） → 20 左拳再砸（冲击波二） → 收势 */
function superBruno(a, t, brain) {
  if (t < 11) {
    const c = ramp(t, 0, 1.5) * (1 - ramp(t, 1.5, 3.5));    // 起跳前下蹲
    const up = ramp(t, 1.5, 5);
    kaiLegs(a, c);
    if (up > 0) tuck(a, up * 0.8);
    a.rotate('spine_01', X, -0.25 * up);
    arm(a, 'l', V(0.12, 0.95, 0.25), V(-0.55, 0.45, 0.6), up);
    arm(a, 'r', V(-0.12, 0.95, 0.25), V(0.55, 0.45, 0.6), up);
    return;
  }
  if (t < 14) {
    const k = ramp(t, 11, 13.6);
    a.rotate('spine_01', X, -0.25 + 0.95 * k);
    arm(a, 'l', V(0.12, 0.95 - 1.6 * k, 0.25 + 0.6 * k), V(-0.55 + 0.4 * k, 0.45 - 1.4 * k, 0.6), 1);
    arm(a, 'r', V(-0.12, 0.95 - 1.6 * k, 0.25 + 0.6 * k), V(0.55 - 0.4 * k, 0.45 - 1.4 * k, 0.6), 1);
    leg(a, 'l', V(0.12, -0.8, 0.45), V(0.02, -0.9, -0.4), 0.8);
    leg(a, 'r', V(-0.12, -0.85, 0.2), V(-0.02, -0.9, -0.4), 0.8);
    return;
  }
  // 14-34：单膝跪地、右拳砸进地面（冲击波一）；16-20 左拳抡起再砸（冲击波二）；26 起起身
  const k = 1 - ramp(t, 26, 34);
  const sw = ramp(t, 15.5, 18) * (1 - ramp(t, 18.5, 20));    // 左拳抬起 → 砸下
  const left2 = ramp(t, 19, 20);
  brain.ground = 'whole';                                     // 膝 / 拳贴地
  a.rotate('spine_01', X, (0.7 - 0.25 * sw) * k);
  a.rotate('spine_02', X, 0.2 * k);
  a.rotate('pelvis', Y, (0.2 - 0.35 * left2) * k);
  a.rotate('spine_02', Y, (-0.25 * sw + 0.2 * left2) * k);
  a.rotate('Head', X, -0.6 * k);
  leg(a, 'l', V(0.22, -0.12, 1), V(0.04, -1, 0.04), k, V(0, -0.2, 1));
  leg(a, 'r', V(-0.16, -1, -0.12), V(-0.03, -0.12, -1), k, V(0, -0.5, -0.85));
  arm(a, 'r', V(-0.18, -0.92, 0.35), V(-0.02, -1, 0.12), k);
  // 左拳：一砸时撑在身侧，16-18 抡过头顶，19-20 砸下
  const l0 = { ua: V(0.4, -0.7, 0.3), la: V(0.1, -0.6, 0.8) };
  const lu = { ua: V(0.25, 0.95, -0.15), la: V(-0.2, 0.9, 0.4) };
  const ld = { ua: V(0.15, -0.9, 0.4), la: V(0.02, -1, 0.12) };
  const L = left2 > 0 ? { ua: lerpDir(lu.ua, ld.ua, left2), la: lerpDir(lu.la, ld.la, left2) } : { ua: lerpDir(l0.ua, lu.ua, sw), la: lerpDir(l0.la, lu.la, sw) };
  arm(a, 'l', L.ua, L.la, k);
}

/** 泽德「棍影乱舞」36 tick：3-20 原地舞棍（右臂画圆带动长棍） → 20-22 后引 → 22-28 弓步突刺 → 收势 */
function superZed(a, t, brain) {
  if (t < 20) {
    const k = ramp(t, 0, 3) * (1 - ramp(t, 19, 21));
    const W = zedWhirl(t);
    const ph = W ? W.ph : 0;
    const top = ramp(t, 10, 11.5) * (1 - ramp(t, 16, 17.5));      // 11-17 举过头顶平转
    a.rotate('spine_02', Y, 0.2 * Math.sin(ph * 0.5) * k);
    a.rotate('spine_01', X, (0.15 - 0.25 * top) * k);
    kaiLegs(a, (0.55 - 0.25 * top) * k);
    // 身侧立圆：右手在身前小幅画圆；头顶：右手举高
    arm(a, 'r', lerpDir(V(-0.35 + 0.1 * Math.cos(ph), -0.05 + 0.12 * Math.sin(ph), 0.9), V(-0.25, 1, 0.2), top), lerpDir(V(-0.1, 0.1, 1), V(0, 1, 0.15), top), k);
    arm(a, 'l', lerpDir(V(0.35, -0.5, 0.6), V(0.45, 0.1, 0.6), top), V(-0.4, 0.5, 0.7), k);
    if (W) {
      const side = V(-0.12, Math.sin(ph), Math.cos(ph)), flat = V(Math.sin(ph), 0.12, Math.cos(ph));
      aimStaff(a, lerpDir(side, flat, top), k);
    }
    return;
  }
  if (t < 22) {
    const k = ramp(t, 20, 21.5);
    a.rotate('spine_01', X, -0.15 * k);
    a.rotate('pelvis', Y, -0.35 * k);
    arm(a, 'r', V(-0.5, -0.1, -0.85), V(0.1, 0.1, 1), k);
    arm(a, 'l', V(0.3, -0.2, 0.9), V(-0.2, 0.2, 1), k);
    kaiLegs(a, 0.6 * k);
    aimStaff(a, V(0, 0.08, 1), k);
    return;
  }
  const k = 1 - ramp(t, 29, 36);
  const e = ramp(t, 22, 23.5);
  a.rotate('pelvis', Y, (-0.35 + 0.75 * e) * k);
  a.rotate('spine_01', X, 0.42 * e * k);
  leg(a, 'l', V(0.08, -0.5, 0.86), V(0.02, -1, -0.06), k);
  leg(a, 'r', V(-0.06, -0.55, -0.83), V(-0.02, -0.45, -0.9), k, V(0, -0.5, -0.85));
  arm(a, 'r', V(-0.05, 0.08, 1), V(0.02, 0.05, 1), k);
  arm(a, 'l', V(0.08, 0.02, 1), V(-0.2, 0.05, 1), k);
  aimStaff(a, V(0, 0.02, 1), k);
}

const SUPERS = { kai: superKai, mira: superMira, bruno: superBruno, zed: superZed };
const SPRINT_PH = { kai: 0, mira: 0, bruno: 0, zed: 0 };   // 摆臂相位与 Jog 循环的对齐偏移

/* ---------------------------------------------------------------- v8：挑空 / 坠击 */
/**
 * 挑空（服务器 launch，20 tick：判定 3..6，7 起可接 跳跃追击 / 坠击 / 冲刺）
 *   凯「炎勾拳」/ 布鲁诺「擎天拳」：蹲身蓄力 → 上勾拳冲天（复用升龙上勾拳关键帧，离地高度由服务器 z 给出）
 *   米拉「月弧踢」：后仰的上挑高踢（月牙弧线）
 *   泽德「挑天棍」：长棍从脚下向上挑起，弓步
 */
export const LAUNCH_LEN = 20;
function launchPose(a, id, t) {
  if (id === 'kai' || id === 'bruno') { kaiPunch(a, t, 3, 6, LAUNCH_LEN, KAI_MOVES.upper, null); return; }
  if (id === 'mira') {
    groundKick(a, t, 3, 6, LAUNCH_LEN, KICKS.high);
    const k = ramp(t, 1, 4) * (1 - ramp(t, 9, 18));
    a.rotate('spine_01', X, -0.22 * k);                  // 后仰，脚尖划出月牙
    arm(a, 'l', V(0.55, 0.2, -0.75), V(0.4, 0.3, -0.8), k * 0.8);
    return;
  }
  // 泽德：长棍上挑
  const c = ramp(t, 0, 3), u = ramp(t, 2.5, 5.5), r = 1 - ramp(t, 9, 19);
  const w = c * r;
  a.rotate('pelvis', Y, (0.35 - 0.6 * u) * w);
  a.rotate('spine_01', X, (0.35 - 0.6 * u) * w);
  leg(a, 'l', V(0.08, -0.6, 0.8), V(0.02, -1, -0.1), w);
  leg(a, 'r', V(-0.06, -0.72, -0.68), V(-0.02, -0.5, -0.86), w);
  arm(a, 'r', lerpDir(V(-0.15, -0.75, 0.65), V(-0.1, 0.85, 0.5), u), lerpDir(V(0, -0.4, 0.9), V(0, 0.9, 0.4), u), w);
  arm(a, 'l', lerpDir(V(0.2, -0.6, 0.75), V(0.15, 0.7, 0.7), u), lerpDir(V(-0.2, -0.2, 1), V(-0.1, 0.8, 0.6), u), w);
  aimStaff(a, lerpDir(V(0, -0.7, 0.7), V(0, 0.92, 0.38), u), w);
}

/**
 * 泽德「挑天棍」（下 + 技，28 tick；判定 3..9，离地高度由服务器 z 给出）
 *   0-3 压低身体、长棍拖在身后贴地 → 3-9 长棍从身后经脚前抡过头顶（整整一个大弧），人随棍势踮起小跳
 *   → 9-16 棍举在头顶后上方、身体后仰 → 16-28 落地收棍
 */
function zedRisePose(a, t, brain) {
  brain.ground = t > 3 && t < 16 ? 'none' : null;
  const c = ramp(t, 0, 2.5);                       // 起手下压
  const sw = ramp(t, 2.5, 9);                      // 抡棍进度
  const r = 1 - ramp(t, 15, 27);                   // 收势
  const w = c * r;
  // 棍的方向角：-150°（身后贴地）→ 0°（正前方水平）→ +105°（头顶偏后）
  const ang = (-150 + 255 * sw) * Math.PI / 180;
  const dir = V(0, Math.sin(ang), Math.cos(ang));
  // 身体：起手前俯，抡起后后仰；髋随棍转
  const lean = 0.45 * (1 - sw) - 0.38 * sw;
  a.rotate('spine_01', X, lean * w);
  a.rotate('spine_02', X, 0.15 * (1 - sw) * w);
  a.rotate('pelvis', Y, (0.45 - 0.75 * sw) * w);
  a.rotate('Head', X, (-0.25 * (1 - sw) + 0.3 * sw) * w);
  // 腿：起手弓步下压 → 空中前腿收、后腿蹬直 → 落地屈膝
  const air = ramp(t, 3, 5) * (1 - ramp(t, 14, 16.5));
  const land = ramp(t, 15, 17) * (1 - ramp(t, 20, 27));
  leg(a, 'l', lerpDir(V(0.1, -0.55, 0.83), V(0.08, -0.25, 0.97), air), lerpDir(V(0.02, -1, -0.1), V(0.02, -0.85, -0.52), air), w);
  leg(a, 'r', lerpDir(V(-0.06, -0.7, -0.7), V(-0.05, -0.95, -0.3), air), lerpDir(V(-0.02, -0.55, -0.83), V(-0.02, -0.8, -0.6), air), w);
  if (land > 0) kaiLegs(a, 0.7 * land);
  // 双手握棍：右手在前、左手在后，手臂指向棍的方向（略收在身前）
  const hand = lerpDir(V(0, -0.35, 0.95), dir, 0.75);
  arm(a, 'r', lerpDir(V(-0.25, -0.2, 0.95), hand, 0.7), hand, w);
  arm(a, 'l', lerpDir(V(0.3, -0.35, 0.9), hand, 0.7), lerpDir(V(-0.2, -0.1, 1), hand, 0.85), w);
  aimStaff(a, dir, w);
}

/**
 * 坠击（服务器 slam：地面版先小跳 ≈5 tick 再俯冲，空中版约 1.5 tick 后俯冲；落地进入 slamland）
 *   凯「陨火锤」/ 布鲁诺「千斤坠」：双手合握高举 → 抡下
 *   米拉「流星踵」：腿举过头 → 脚跟下劈
 *   泽德「劈山棍」：长棍举到脑后 → 向前下方劈落
 */
function slamPose(a, id, t, brain, airStart) {
  brain.ground = 'none';
  const dv = airStart ? ramp(t, 0.3, 2.2) : ramp(t, 3.2, 5.6);
  const up = (airStart ? ramp(t, 0, 1) : ramp(t, 0, 2.5)) * (1 - dv);
  tuck(a, 0.6 * up + 0.3 * dv);
  if (id === 'mira') {
    a.rotate('spine_01', X, -0.25 * up + 0.35 * dv);
    leg(a, 'r', lerpDir(V(-0.04, 0.9, 0.42), V(-0.04, -0.35, 0.94), dv), lerpDir(V(0, 0.98, 0.2), V(0, -0.75, 0.66), dv), Math.max(up, dv), V(0, 0.2, 1));
    arm(a, 'l', V(0.85, 0.3, 0.3), V(0.85, 0.4, 0.2), 0.8 * Math.max(up, dv));
    arm(a, 'r', V(-0.85, 0.3, 0.3), V(-0.85, 0.4, 0.2), 0.8 * Math.max(up, dv));
    return;
  }
  a.rotate('spine_01', X, -0.35 * up + 0.55 * dv);
  a.rotate('Head', X, 0.2 * up - 0.3 * dv);
  if (id === 'zed') {
    arm(a, 'r', lerpDir(V(-0.15, 0.9, -0.35), V(-0.08, -0.3, 0.95), dv), lerpDir(V(0, 0.7, -0.7), V(0, -0.45, 0.9), dv), Math.max(up, dv));
    arm(a, 'l', lerpDir(V(0.15, 0.9, -0.3), V(0.1, -0.25, 0.96), dv), lerpDir(V(-0.1, 0.7, -0.7), V(-0.2, -0.4, 0.9), dv), Math.max(up, dv));
    aimStaff(a, lerpDir(V(0, 0.5, -0.86), V(0, -0.55, 0.84), dv), Math.max(up, dv));
    return;
  }
  // 双手合握的重锤
  arm(a, 'l', lerpDir(V(0.12, 0.95, -0.25), V(0.1, -0.35, 0.93), dv), lerpDir(V(-0.3, 0.6, -0.75), V(-0.35, -0.45, 0.82), dv), Math.max(up, dv));
  arm(a, 'r', lerpDir(V(-0.12, 0.95, -0.25), V(-0.1, -0.35, 0.93), dv), lerpDir(V(0.3, 0.6, -0.75), V(0.35, -0.45, 0.82), dv), Math.max(up, dv));
}
/** 坠击落地（13 tick，4 起可取消）：深蹲卸力 + 招式收势 */
function slamLandPose(a, id, t) {
  const k = 1 - ramp(t, 2, 12);
  kaiLegs(a, 0.9 * k);
  a.rotate('spine_01', X, 0.45 * k);
  if (id === 'zed') {
    arm(a, 'r', V(-0.08, -0.45, 0.89), V(0, -0.55, 0.83), k);
    arm(a, 'l', V(0.1, -0.4, 0.9), V(-0.2, -0.5, 0.84), k);
    aimStaff(a, V(0, -0.6, 0.8), k);
  } else if (id === 'mira') {
    leg(a, 'r', V(-0.06, -0.55, 0.83), V(0, -0.9, 0.3), k);
    arm(a, 'l', V(0.8, -0.2, 0.4), V(0.7, 0.2, 0.5), 0.7 * k);
    arm(a, 'r', V(-0.8, -0.2, 0.4), V(-0.7, 0.2, 0.5), 0.7 * k);
  } else {
    arm(a, 'l', V(0.1, -0.6, 0.8), V(-0.3, -0.7, 0.65), k);
    arm(a, 'r', V(-0.1, -0.6, 0.8), V(0.3, -0.7, 0.65), k);
  }
}

function brunoLiftThrow(a, t) {
  const up = ramp(t, 1, 8), dn = ramp(t, 9.5, 11.5), r = 1 - ramp(t, 14, 21);
  const w = Math.max(up, dn) * r;
  kaiLegs(a, (0.55 * (1 - up) + 0.25 * up * (1 - dn) + 0.75 * dn) * r);
  a.rotate('spine_01', X, (-0.32 * up * (1 - dn) + 0.75 * dn) * r);
  a.rotate('Head', X, (-0.35 * up * (1 - dn) - 0.35 * dn) * r);
  const ua = lerpDir(lerpDir(V(0, -0.2, 1), V(0, 0.95, 0.25), up), V(0, -0.45, 0.9), dn);
  const la = lerpDir(lerpDir(V(0, 0.5, 0.85), V(0, 1, -0.05), up), V(0, -0.6, 0.8), dn);
  arm(a, 'l', V(0.35, ua.y, ua.z), V(0.1, la.y, la.z), w);
  arm(a, 'r', V(-0.35, ua.y, ua.z), V(-0.1, la.y, la.z), w);
}

function flyingKick(a, t) {
  const w = easeOut(t / 1.2);
  const e = t < 1 ? 0 : easeIn((t - 1) / 1.5);
  kickBody(a, KICKS.fly, w, true);
  kickLeg(a, KICKS.fly, e, w);
}
function kneeStrike(a, k) {
  // 膝撞：把敌人往下拉、膝盖向前上方顶，支撑腿微屈
  a.rotate('spine_01', X, 0.22 * k);
  a.aim('thigh_r', 'calf_r', nrm(V(-0.04, 0.5, 0.86)), k);
  a.aim('calf_r', 'foot_r', nrm(V(0, -0.95, 0.2)), k);
  a.aim('thigh_l', 'calf_l', nrm(V(0.08, -0.95, 0.2)), k * 0.8);
  a.aim('calf_l', 'foot_l', nrm(V(0.02, -0.96, -0.25)), k * 0.8);
}
function grabArms(a, k) {
  a.aim('upperarm_l', 'lowerarm_l', V(0.15, -0.15, 1), k);
  a.aim('upperarm_r', 'lowerarm_r', V(-0.15, -0.15, 1), k);
  a.aim('lowerarm_l', 'hand_l', V(-0.25, 0.1, 1), k);
  a.aim('lowerarm_r', 'hand_r', V(0.25, 0.1, 1), k);
}
function spinArms(a, k) {
  a.aim('upperarm_l', 'lowerarm_l', V(1, 0.05, 0.05), k);
  a.aim('upperarm_r', 'lowerarm_r', V(-1, 0.05, 0.05), k);
  a.aim('lowerarm_l', 'hand_l', V(1, 0.1, 0.2), k);
  a.aim('lowerarm_r', 'hand_r', V(-1, 0.1, 0.2), k);
}
function guard(a, k) {
  // 拳架：双拳抬到下巴前
  a.aim('upperarm_l', 'lowerarm_l', V(0.35, -0.75, 0.45), k);
  a.aim('upperarm_r', 'lowerarm_r', V(-0.3, -0.8, 0.35), k);
  a.aim('lowerarm_l', 'hand_l', V(-0.15, 0.85, 0.55), k);
  a.aim('lowerarm_r', 'hand_r', V(0.1, 0.8, 0.6), k);
}
function tuck(a, k) {
  a.aim('thigh_l', 'calf_l', V(0.05, -0.3, 0.95), k * 0.8);
  a.aim('calf_l', 'foot_l', V(0, -1, -0.3), k * 0.8);
  a.aim('thigh_r', 'calf_r', V(-0.05, -0.75, 0.6), k * 0.6);
  a.aim('calf_r', 'foot_r', V(0, -1, -0.6), k * 0.7);
}
/** 冲刺突击：低身前冲 + 出拳（泽德为长棍前刺） */
function dashStrike(a, k, zed) {
  a.rotate('spine_01', X, 0.12 * k);
  if (!zed) {
    a.aim('upperarm_r', 'lowerarm_r', V(-0.12, 0.05, 1), k * 0.6);
    a.aim('lowerarm_r', 'hand_r', V(-0.05, 0.08, 1), k * 0.6);
  }
}
function recoil(a, t) {
  const k = t < 2 ? sm(t / 1.2) : Math.max(0, 1 - sm((t - 2) / 8));
  a.rotate('Torso_1', X, -0.5 * k);
  a.rotate('Abdomen', X, -0.3 * k);
  a.rotate('Head', X, -0.4 * k);
}

/* ---------------------------------------------------------------- 对战版新增动作：下蹲 / 防御 / 蹲拳 / 扫腿 / 发波 / 后跳步 / 被抓 / 浮空 / 胜利 */
/** 深蹲：双膝大幅前屈、上身前倾护架（脚底贴地由 groundFix 负责，身体自然下沉） */
function crouchPose(a, k) {
  leg(a, 'l', V(0.2, -0.28, 0.94), V(0.02, -0.72, -0.7), k);
  leg(a, 'r', V(-0.24, -0.5, 0.62), V(-0.03, -0.55, -0.84), k, V(0, -0.55, 0.84));
  a.rotate('spine_01', X, 0.3 * k);
  a.rotate('Head', X, -0.22 * k);
}
/** 防御：双臂竖在脸前，重心后坐；stun 中（t 小）有一下被震的后仰 */
function blockPose(a, t, crouch, zed) {
  const k = ramp(t, -1, 1.5);
  const jolt = Math.max(0, 1 - t / 5);
  if (crouch) crouchPose(a, k); else { kaiLegs(a, 0.35 * k); a.rotate('spine_01', X, (-0.1 - 0.12 * jolt) * k); }
  a.rotate('pelvis', Y, -0.18 * k);
  if (zed) {
    // 泽德横棍格挡
    arm(a, 'r', V(-0.3, 0.1, 0.95), V(0.3, 0.75, 0.6), k);
    arm(a, 'l', V(0.35, -0.2, 0.9), V(-0.1, 0.6, 0.8), k);
    aimStaff(a, V(0.25, 0.95, 0.15), k);
  } else {
    arm(a, 'l', V(0.2, -0.25, 0.95), V(-0.16, 0.97, 0.12), k);
    arm(a, 'r', V(-0.22, -0.3, 0.93), V(0.16, 0.97, 0.1), k);
  }
  a.rotate('Head', X, 0.16 * k);
}
/** 蹲拳（8 tick，判定 2..3）：蹲姿前手刺拳 */
function crouchJab(a, t, zed) {
  crouchPose(a, 1);
  const e = env(t, 2, 3.5, 8);
  if (zed) {
    arm(a, 'r', lerpDir(V(-0.3, -0.5, 0.5), V(-0.08, -0.05, 1), e), V(0.02, 0, 1), 1);
    arm(a, 'l', V(0.2, -0.3, 0.9), V(-0.25, 0.1, 1), 1);
    aimStaff(a, V(0, -0.02, 1), 1);
  } else {
    arm(a, 'l', lerpDir(V(0.35, -0.6, 0.5), V(-0.02, -0.08, 1), e), lerpDir(V(-0.15, 0.85, 0.5), V(-0.02, -0.04, 1), e), 1);
    arm(a, 'r', V(-0.3, -0.7, 0.4), V(0.12, 0.85, 0.5), 1);
    a.rotate('spine_02', Y, -0.3 * e);
  }
}
/** 扫腿（20 tick，判定 5..7）：单腿深蹲，另一条腿贴地向前扫出 */
function sweepPose(a, t, brain, zed) {
  const w = ramp(t, 0, 3) * (1 - ramp(t, 12, 20));
  const e = env(t, 5, 8, 16);
  brain.ground = 'whole';
  a.rotate('pelvis', Y, (0.15 + 0.5 * e) * w);
  a.rotate('spine_01', X, (0.25 - 0.5 * e) * w);
  a.rotate('spine_02', Y, -0.35 * e * w);
  a.rotate('Head', X, 0.2 * e * w);
  leg(a, 'l', V(0.3, -0.15, 0.94), V(0.03, -0.62, -0.78), w);
  leg(a, 'r', lerpDir(V(-0.3, -0.35, 0.7), V(-0.06, -0.3, 0.95), e), lerpDir(V(-0.03, -0.6, -0.8), V(-0.02, -0.16, 0.99), e), w, V(0, 0.45, 0.9));
  if (zed) {
    arm(a, 'r', V(-0.1, -0.5, 0.86), V(0.02, -0.4, 0.92), w);
    arm(a, 'l', V(0.15, -0.45, 0.88), V(-0.25, -0.35, 0.9), w);
    aimStaff(a, V(0, -0.38, 0.92), w);
  } else {
    arm(a, 'r', V(-0.55, -0.7, -0.45), V(-0.15, -0.95, -0.25), w);
    arm(a, 'l', V(0.4, -0.35, 0.85), V(-0.2, 0.75, 0.6), w);
  }
}
/** 发波：各角色一种出手方式。at = 飞行道具出手的 tick，len = 总长（与服务器 cast/1 一致） */
const CAST = { kai: [8, 24], mira: [6, 19], bruno: [10, 28], zed: [7, 22] };
function castPose(a, id, t, brain) {
  const [at, len] = CAST[id] || CAST.kai;
  const wind = ramp(t, 0, at - 2.5) * (1 - ramp(t, at - 2.5, at));
  const e = ramp(t, at - 2, at) * (1 - ramp(t, at + 5, len));
  const w = Math.max(wind, e);
  if (id === 'mira') { groundKick(a, t, at, at + 2, len, KICKS.mid); return; }
  if (id === 'bruno') {
    // 抡拳砸地：举拳 → 单膝压低、右拳砸在身前
    brain.ground = e > 0.3 ? 'whole' : null;
    a.rotate('spine_01', X, -0.2 * wind + 0.62 * e);
    a.rotate('Head', X, -0.4 * e);
    kaiLegs(a, 0.4 * wind);
    leg(a, 'l', V(0.2, -0.2, 0.96), V(0.03, -1, 0.05), e, V(0, -0.2, 1));
    leg(a, 'r', V(-0.16, -0.95, -0.2), V(-0.03, -0.2, -0.98), e, V(0, -0.5, -0.85));
    arm(a, 'r', lerpDir(V(-0.2, 0.95, -0.2), V(-0.12, -0.8, 0.58), e), lerpDir(V(0.1, 0.9, 0.4), V(0, -0.95, 0.3), e), w);
    arm(a, 'l', V(0.45, -0.7, 0.3), V(0.1, -0.5, 0.85), w);
    return;
  }
  // 弓步
  a.rotate('pelvis', Y, -0.4 * wind + 0.35 * e);
  a.rotate('spine_01', X, -0.08 * wind + 0.24 * e);
  leg(a, 'l', V(0.08, -0.62, 0.78), V(0.02, -1, -0.08), 0.9 * w);
  leg(a, 'r', V(-0.06, -0.74, -0.66), V(-0.02, -0.52, -0.85), 0.9 * w);
  if (id === 'zed') {
    arm(a, 'r', lerpDir(V(-0.5, -0.2, -0.8), V(-0.08, 0.06, 1), e), V(0.02, 0.05, 1), w);
    arm(a, 'l', lerpDir(V(0.3, -0.3, 0.85), V(0.1, 0.02, 1), e), V(-0.22, 0.05, 1), w);
    aimStaff(a, V(0, 0.03, 1), w);
    return;
  }
  // 凯：双掌收在腰侧 → 向前推出
  arm(a, 'r', lerpDir(V(-0.45, -0.75, -0.45), V(-0.14, 0.02, 1), e), lerpDir(V(0.1, -0.1, 1), V(0.12, 0.3, 0.95), e), w);
  arm(a, 'l', lerpDir(V(0.3, -0.85, -0.35), V(0.14, -0.1, 1), e), lerpDir(V(-0.1, 0.1, 1), V(-0.12, -0.25, 0.96), e), w);
}
/** 胜利姿势 */
function winPose(a, id, t, time) {
  const k = ramp(t, 2, 12);
  const bob = Math.sin(time * 4) * 0.03;
  a.rotate('spine_01', X, -0.12 * k);
  a.rotate('Head', X, -0.15 * k);
  if (id === 'zed') {
    arm(a, 'r', V(-0.25, 0.9 + bob, 0.3), V(0, 1, 0.1), k);
    arm(a, 'l', V(0.6, -0.7, 0.2), V(-0.5, -0.3, 0.6), k);
    aimStaff(a, V(0, 1, 0), k);
  } else if (id === 'mira') {
    arm(a, 'r', V(-0.35, 0.9 + bob, 0.2), V(-0.3, 0.9, 0.1), k);
    arm(a, 'l', V(0.7, -0.65, 0.15), V(-0.7, -0.2, 0.55), k);
    a.rotate('pelvis', Y, 0.25 * k);
  } else if (id === 'bruno') {
    arm(a, 'r', V(-0.75, 0.55 + bob, 0.2), V(0.25, 0.95, 0.1), k);
    arm(a, 'l', V(0.75, 0.55 + bob, 0.2), V(-0.25, 0.95, 0.1), k);
  } else {
    arm(a, 'r', V(-0.18, 0.95 + bob, 0.25), V(0.05, 1, 0.05), k);
    arm(a, 'l', V(0.65, -0.7, 0.2), V(-0.6, -0.25, 0.6), k);
  }
}

const FAST_TURN = { bpunch: 1, bstomp: 1, cjab: 1, sweep: 1, cast: 1, block: 1, launch: 1, slam: 1, runatk: 1, attack: 1, dash: 1, special: 1, jattack: 1, throw: 1, windup: 1, cwind: 1, charge: 1, grab: 1 };
const GROUNDED = { bpunch: 1, dead: 0, crouch: 1, block: 1, cjab: 1, sweep: 1, cast: 1, win: 1, grabbed: 1, launch: 1, slamland: 1, idle: 1, walk: 1, run: 1, runatk: 1, attack: 1, dash: 1, land: 1, special: 1, hurt: 1, grab: 1, throw: 1, recover: 1, windup: 1, cwind: 1, charge: 1 };
const LYING = { down: 1, dead: 1, out: 1, getup: 1, dying: 1 };
const FACE_YAW = 0.38;   // 朝向偏向镜头约 22°：以侧面为主，又能看到脸
const BOSS_STATES = { bpunch: 1, bstomp: 1, charge: 1, cast: 1, special: 1, block: 1, grab: 1, throw: 1, win: 1, dead: 1, land: 1 };
const ROBOT_EYE = { grunt: '#3df2ff', spark: '#ffe14a', brute: '#7dff4a', thrower: '#ff9df0', boss: '#ff3030' };
const ROBOT_WALK = { grunt: [1.1, 2.2], spark: [1.6, 3.6], brute: [0.8, 1.6], thrower: [1.1, 2.4], boss: [0.8, 2.0] };   // [步频, 标称速度]
const ROBOT_WINDUP = { grunt: 14, spark: 9, brute: 20, thrower: 16, boss: 18 };

export class Anim {
  constructor(actor) {
    this.a = actor;
    this.hero = actor.kind === 'hero';
    this.id = this.hero ? actor.cid : actor.rtype;
    this.key = '';
    this.st = '';
    this.lastT = 0;
    this.w = 0;           // 跑步混合权重（平滑）
    this.hurtClip = 'Hit_Chest';
  }

  /** 进入新的“姿势段”时从当前显示姿势过渡 */
  enter(key, st, t) {
    const re = key === this.key && t < this.lastT - 1.5 && key !== 'loco';   // 同状态被重置（如连续受击）
    if (key !== this.key || re) {
      let fade = FADE[st] != null ? FADE[st] : 0.12;
      if (key === 'loco' && SLOW_EXIT[this.st]) fade = SLOW_EXIT[this.st];
      this.a.blendFrom(fade);
      this.key = key; this.st = st;
      this.lastT = t;
      return true;
    }
    this.lastT = t;
    return false;
  }

  /**
   * o：插值后的实体（_spd 地面速度 单位/tick，_frozen 命中停顿中）
   * t：状态内 tick；dt 秒；time 全局秒
   */
  update(o, t, dt, time) {
    const a = this.a;
    const adt = o._frozen ? 0 : dt;
    a.root.userData.lift = 0;
    a.body.rotation.set(0, 0, 0);
    a.body.position.set(0, 0, 0);
    a.body.scale.set(1, 1, 1);
    this.lift = 0;
    this.ground = null;
    this.faceStep(o, adt);
    if (this.hero) this.heroPose(o, t, adt, time); else this.robotPose(o, t, adt, time);
    this.turnOverlay(o);
    a.finish(adt);
    this.groundFix(o, adt);
  }

  /**
   * 转身：朝向翻转时播放一次真正的转身 —— 约 0.18 秒（Boss 0.32 秒）缓入缓出地经由“面向镜头”一侧转过去，
   * 期间髋部领先、肩膀滞后、屈膝下沉；跑动中转身为急停滑步（身体后仰 + 尘土）。
   * 出招/冲刺/必杀开始时立即把剩余转身压缩到约 0.04 秒，保证打击朝向正确。
   */
  faceStep(o, dt) {
    const a = this.a;
    const target = (o.f >= 0 ? 1 : -1) * (Math.PI / 2 - FACE_YAW);
    if (this.faceTarget == null) { this.faceTarget = target; a.yaw = target; a.yawG.rotation.y = target; return; }
    if (target !== this.faceTarget) {
      const air = (o.z || 0) > 2 || o.s === 'jump' || o.s === 'jattack';
      const boss = this.id === 'boss', brute = this.id === 'brute';
      this.turn = {
        from: a.yaw, to: target, t: 0,
        dur: air ? 0.2 : boss ? 0.32 : brute ? 0.26 : this.hero ? 0.18 : 0.22,
        air, skid: !air && (o.s === 'walk' || o.s === 'run') && (o._spd || 0) > 1.2,
      };
      if (this.turn.skid) this.skidPuff = true;
      this.faceTarget = target;
    }
    const tr = this.turn;
    if (!tr) { this.turnK = 0; this.airTurnK = 0; return; }
    if (FAST_TURN[o.s]) tr.dur = Math.min(tr.dur, tr.t + 0.04);
    tr.t += dt;
    const k = clamp(tr.t / tr.dur, 0, 1);
    a.yaw = tr.from + (tr.to - tr.from) * sm(k);
    a.yawG.rotation.y = a.yaw;
    this.turnK = tr.air ? 0 : Math.sin(Math.PI * k);
    this.airTurnK = tr.air ? Math.sin(Math.PI * k) : 0;
    this.turnSign = Math.sign(tr.to - tr.from);
    this.turnSkid = tr.skid;
    if (k >= 1) { this.turn = null; this.turnK = 0; this.airTurnK = 0; }
  }

  /** 转身期间的身体叠加：髋领先、肩滞后、屈膝；滑步时后仰 */
  turnOverlay(o) {
    const k = this.turnK || 0;
    if (k <= 0.001) return;
    const a = this.a, sg = this.turnSign;
    if (this.hero) {
      a.rotate('pelvis', Y, sg * 0.55 * k);
      a.rotate('spine_02', Y, -sg * 0.45 * k);
      a.rotate('spine_01', X, (this.turnSkid ? -0.3 : 0.12) * k);
      const bend = 0.4 * k;
      a.aim('thigh_l', 'calf_l', nrm(V(0.12, -0.85, 0.5)), bend);
      a.aim('calf_l', 'foot_l', nrm(V(0.02, -0.9, -0.42)), bend);
      a.aim('thigh_r', 'calf_r', nrm(V(-0.12, -0.85, 0.5)), bend);
      a.aim('calf_r', 'foot_r', nrm(V(-0.02, -0.9, -0.42)), bend);
    } else {
      a.rotate('Torso_1', Y, -sg * 0.45 * k);
      a.rotate('Torso_1', X, (this.turnSkid ? -0.3 : 0.15) * k);
      a.rotate('Head', Y, -sg * 0.25 * k);
    }
  }

  /** 落地修正：站立类状态下让最低的脚底正好贴地（可抬可压），平滑过渡；空中/倒地状态不修正 */
  groundFix(o, dt) {
    const a = this.a;
    let target = 0;
    // ground：招式可指定 'none'（倒立/腾空的自定义位置）或 'whole'（全身最低点贴地，如滑铲）
    if (this.ground !== 'none' && (GROUNDED[o.s] || (LYING[o.s] && (o.z || 0) < 1))) {
      // 站立：脚底贴地；倒地/起身：全身最低点贴地（不陷进地面）
      const h = a.soleHeight(this.ground === 'whole' || !GROUNDED[o.s]);
      if (h != null) target = -h;
    }
    if (this.gOff == null) this.gOff = target;
    else this.gOff += (target - this.gOff) * Math.min(1, (dt || 0) * 45);
    a.body.position.y += this.gOff + (this.lift || 0);
    a.body.updateMatrixWorld(true);
  }

  heroPose(o, t, dt, time) {
    const a = this.a, id = this.id;
    const zed = id === 'zed';
    const idleClip = zed ? 'Sword_Idle' : 'Idle_Loop';
    const spd = o._spd || 0;
    let post = null;
    switch (o.s) {
      case 'idle': case 'walk': case 'run': {
        this.enter('loco', o.s, t);
        const run = o.s === 'run';
        const target = run ? 1 : o.s === 'walk' ? 0.85 * clamp(spd / 2.4, 0.35, 1) : 0;
        this.w += (target - this.w) * Math.min(1, dt * 12);
        this.runK = (this.runK || 0) + ((run ? 1 : 0) - (this.runK || 0)) * Math.min(1, dt * 10);
        const w = this.w, rk = this.runK;
        // 步频随速度：Jog 循环的原始速度远快于游戏移动速度，配合权重缩小步幅；疾走时步频更高
        const walkTs = clamp(0.3 + 0.1 * spd, 0.55, 1.0), runTs = clamp(0.5 + 0.085 * spd, 1.0, 1.55);
        a.loco(idleClip, 'Jog_Fwd_Loop', w, id === 'mira' ? 1.4 : 1, walkTs + (runTs - walkTs) * rk);
        post = () => {
          if (!zed) guard(a, (0.75 * (1 - w / 0.85) + 0.2 * w) * (1 - rk));
          else a.aim('upperarm_r', 'lowerarm_r', V(-0.3, -0.6, 0.6), 0.5 * w * (1 - rk));
          a.rotate('spine_01', X, 0.16 * w * (1 - rk));   // 跑动时身体前倾
          if (rk > 0.01) {
            const ph = a.locoRun ? a.locoRun.time / a.locoRun.getClip().duration : 0;
            sprintBody(a, rk, ph + (SPRINT_PH[id] || 0), zed);
          }
        };
        break;
      }
      case 'crouch': {
        this.enter('crouch', 'crouch', t);
        a.play(idleClip);
        const k = ramp(t, 0, 3);
        post = () => { crouchPose(a, k); if (!zed) guard(a, 0.8 * k); };
        break;
      }
      case 'block': {
        // 防御（o.a === 'c' 为蹲防）；被打中进入硬直时 t 归零，重新播一次受震
        this.enter('block' + (o.a === 'c' ? 'c' : 's'), 'block', t);
        a.play(idleClip);
        post = () => blockPose(a, t, o.a === 'c', zed);
        break;
      }
      case 'bstep': {
        this.enter('bstep', 'bstep', t);
        a.play('NinjaJump_Idle_Loop', { fade: 0.05 });
        this.ground = 'none';
        post = () => { tuck(a, 0.5 * (1 - ramp(t, 7, 12))); a.rotate('spine_01', X, -0.22 * (1 - ramp(t, 6, 12))); if (!zed) guard(a, 0.8); };
        break;
      }
      case 'cjab': {
        this.enter('cjab', 'cjab', t);
        a.play(idleClip);
        post = () => crouchJab(a, t, zed);
        break;
      }
      case 'sweep': {
        this.enter('sweep', 'sweep', t);
        a.play(idleClip);
        post = () => sweepPose(a, t, this, zed);
        break;
      }
      case 'cast': {
        this.enter('cast', 'cast', t);
        a.play(idleClip);
        post = () => castPose(a, id, t, this);
        break;
      }
      case 'grabbed': {
        this.enter('grabbed', 'grabbed', t);
        a.play('Hit_Chest', { time: 0.12 });
        const lift = clamp(((o.z || 0) - 6) / 60, 0, 1);    // 被布鲁诺举过头顶：身体放平、四肢挣扎
        a.body.rotation.x = -0.18 - 1.35 * lift;
        if (lift > 0) this.ground = 'none';
        post = () => {
          a.rotate('spine_01', X, -0.25); a.rotate('Head', X, -0.3 + 0.08 * Math.sin(time * 30));
          if (lift > 0) {
            const k = Math.sin(time * 22) * 0.25;
            leg(a, 'l', V(0.15, -0.8 + k, 0.4), V(0.05, -0.9, -0.3), lift * 0.8);
            leg(a, 'r', V(-0.15, -0.8 - k, 0.4), V(-0.05, -0.9, -0.3), lift * 0.8);
            arm(a, 'l', V(0.7, 0.3 + k, 0.4), V(0.5, 0.6, 0.6), lift * 0.8);
            arm(a, 'r', V(-0.7, 0.3 - k, 0.4), V(-0.5, 0.6, 0.6), lift * 0.8);
          }
        };
        break;
      }
      case 'air': {
        // 浮空（被挑空 / 追打）：仰面腾空，随时间轻微翻滚
        this.enter('air', 'air', t);
        a.play('Hit_Knockback', { time: 0.3 });
        a.body.rotation.x = -0.75 * sm(t / 3) - 0.22 * Math.sin(t * 0.3);
        this.ground = 'none';
        break;
      }
      case 'win': {
        this.enter('win', 'win', t);
        a.play(idleClip);
        post = () => winPose(a, id, t, time);
        break;
      }
      case 'runatk': {
        // 疾走攻击：各角色一招（凯飞膝 / 米拉滑铲 / 布鲁诺肩撞 / 泽德突刺）
        this.enter('runatk', 'runatk', t);
        // 底层动作用定格的跑步帧（从疾走过渡时不会先站直）；泽德用前刺收招帧
        if (zed) a.play('Sword_Regular_A_Rec', { time: 0.04 });
        else a.play('Jog_Fwd_Loop', { time: 0.2 });
        post = () => runAttack(a, id, t, this);
        break;
      }
      case 'attack': {
        const cb = clamp(o.cb | 0, 1, 3);
        const mv = COMBO[id][cb];
        const D = (cb === 3 ? 15 : 9) + (QUICK[id] || 0);
        const A0 = cb === 3 ? 4 : 3, A1 = cb === 3 ? 7 : 4;
        this.enter('attack' + cb, 'attack', t);
        const hold = mv.h + 0.05;
        if (t < A0) {
          a.play(mv.clip, { time: mv.a + (mv.h - mv.a) * easeIn(t / A0) });
        } else if (t < A1 + 1 || (!mv.rec && mv.b == null)) {
          a.play(mv.clip, { time: mv.h + (hold - mv.h) * clamp((t - A0) / (A1 + 1 - A0), 0, 1) });
        } else {
          const k = easeOut((t - A1 - 1) / Math.max(1, D - A1 - 1));
          if (mv.rec) a.play(mv.rec, { fade: 0.04, time: k * mv.recEnd });
          else a.play(mv.clip, { time: hold + (mv.b - hold) * k });
        }
        // 边打边走：服务器允许出招时以 40% 速度移动 —— 双腿按实际移动方向迈步
        const step = this.attackStep(o, dt, mv.noStep);
        post = () => {
          if (mv.post) mv.post(a, t, A0, A1, D, this);
          if (step) stepLegs(a, step.mv, this.stepPh, step.w);
        };
        break;
      }
      case 'dash': {
        // 约 14 tick：0–2 蓄力压低，2–9 低身前冲（判定），9–14 收招
        this.enter('dash', 'dash', t);
        const k = t < 2 ? sm(t / 2) : t < 9 ? 1 : 1 - sm((t - 9) / 5);
        // 前冲姿势取自收招片段的第一帧（低身前倾、拳/棍在前），收招时顺势播放其后半段回到架势
        const clip = zed ? 'Sword_Regular_A_Rec' : 'Melee_Hook_Rec';
        const end = zed ? 0.25 : 0.5;
        a.play(clip, { time: t < 9 ? 0.04 * clamp(t / 9, 0, 1) : 0.04 + (end - 0.04) * easeOut((t - 9) / 5) });
        post = () => dashStrike(a, k, zed);
        break;
      }
      case 'jump': {
        if (this.enter('jump', 'jump', t)) this.longJ = this.prevS === 'run';
        // 远跳（疾走中起跳）：水平速度明显高于普通跳跃
        if (t < 4 && Math.abs(o._vx || 0) > SPD[id] * 1.45) this.longJ = true;
        const at = this.airTurnK || 0, sg = this.turnSign || 1;
        const turnFx = () => {
          // 空中转身：髋部领先、肩膀滞后，身体略微侧倾
          if (at > 0.01) { a.rotate('pelvis', Y, sg * 0.45 * at); a.rotate('spine_02', Y, -sg * 0.35 * at); a.body.rotation.z += 0.12 * sg * at; }
        };
        if (t < 2) {
          // 起跳：先压低再蹬地
          a.play('NinjaJump_Start', { time: 0.02 + t * 0.03 });
          if (this.longJ) post = () => diveLeap(a, t, ramp(t, 0, 2) * 0.5);
        } else {
          a.play('NinjaJump_Idle_Loop', { fade: 0.1 });
          if (this.longJ) post = () => { diveLeap(a, t, ramp(t, 1, 4)); turnFx(); };
          else post = () => { tuck(a, sm((t - 2) / 4)); turnFx(); };
        }
        break;
      }
      case 'launch': {
        // 挑空：上挑把敌人打上天（判定 3..6）
        this.enter('launch', 'launch', t);
        if (zed) a.play('Sword_Idle'); else if (id === 'mira') a.play('Idle_Loop'); else a.play(idleClip);
        post = zed && o.a === 'zsp2' ? () => zedRisePose(a, t, this) : () => launchPose(a, id, t);
        break;
      }
      case 'slam': {
        // 坠击：地面版小跳后俯冲 / 空中版直接俯冲
        if (this.enter('slam', 'slam', t)) this.slamAir = (o.z || 0) > 8 && t < 1.5;
        a.play('NinjaJump_Idle_Loop', { fade: 0.06 });
        const airStart = this.slamAir;
        post = () => slamPose(a, id, t, this, airStart);
        break;
      }
      case 'slamland': {
        this.enter('slamland', 'slamland', t);
        a.play('NinjaJump_Land', { time: 0.12 + Math.min(t, 8) * 0.05 });
        const sq = Math.sin(clamp(t / 3, 0, 1) * Math.PI) * 0.1;
        a.body.scale.set(1 + sq * 0.6, 1 - sq, 1 + sq * 0.6);
        post = () => slamLandPose(a, id, t);
        break;
      }
      case 'jattack':
        this.enter('jattack', 'jattack', t);
        a.play('NinjaJump_Idle_Loop');
        post = () => flyingKick(a, t);
        break;
      case 'land': {
        this.enter('land', 'land', t);
        a.play('NinjaJump_Land', { time: 0.15 + t * 0.06 });
        // 落地压缩
        const sq = Math.sin(clamp(t / 4, 0, 1) * Math.PI) * 0.07;
        a.body.scale.set(1 + sq * 0.6, 1 - sq, 1 + sq * 0.6);
        break;
      }
      case 'special': {
        // 角色专属必杀（阶段与服务器 super_step 对齐）
        this.enter('special', 'special', t);
        a.play(zed && t >= 20 ? 'Sword_Regular_A_Rec' : idleClip, zed && t >= 20 ? { time: 0.04, fade: 0.08 } : undefined);
        const fn = SUPERS[id] || superKai;
        post = () => fn(a, t, this);
        break;
      }
      case 'hurt': {
        if (this.enter('hurt', 'hurt', t)) this.hurtClip = Math.random() < 0.5 ? 'Hit_Chest' : 'Hit_Head';
        // 受击：快速后仰（约 2 tick），再在剩余硬直里恢复到站姿
        const dur = this.hurtClip === 'Hit_Head' ? 0.42 : 0.32;
        const k = t < 2 ? (t / 2) * 0.35 : 0.35 + 0.65 * easeOut((t - 2) / 10);
        a.play(this.hurtClip, { time: k * dur });
        // 受击瞬间上身与头部猛地后仰，再随硬直恢复（让小比例下也读得出受击）
        const rk = t < 1.5 ? sm(t / 1.5) : 1 - sm((t - 1.5) / 9);
        post = () => { a.rotate('spine_01', X, -0.22 * rk); a.rotate('Head', X, -0.3 * rk); };
        break;
      }
      case 'knockdown':
        this.enter('knockdown', 'knockdown', t);
        a.play('Hit_Knockback', { time: 0.06 + 0.52 * sm(t / 16) });
        a.body.rotation.x = -0.45 * sm(t / 7) * (1 - sm((t - 10) / 8));
        break;
      case 'down':
        this.enter('down', 'down', t);
        a.play('Hit_Knockback', { time: 0.68 });
        break;
      case 'dead': case 'out':
        this.enter('dead', 'dead', t);
        a.play('Death01', { time: Math.min(1.95, 1.1 + t * 0.05) });
        break;
      case 'getup':
        this.enter('getup', 'getup', t);
        a.play('LayToIdle', { time: easeOut(t / 14) * 1.45 });
        break;
      case 'grab': {
        this.enter('grab', 'grab', t);
        a.play(idleClip);
        const gk = sm(t / 3);
        const knee = o.a === 'knee' ? Math.sin(((time * 3.5) % 1) * Math.PI) : 0;
        post = () => { grabArms(a, gk); if (knee > 0.01) kneeStrike(a, knee); };
        break;
      }
      case 'throw':
        this.enter('throw', 'throw', t);
        if (id === 'bruno') {
          // 举起砸地：2-9 tick 把对手举过头顶（双臂上推），11 tick 前倾全力砸下，再慢慢直起身
          a.play(idleClip);
          post = () => brunoLiftThrow(a, t);
        } else a.play('OverhandThrow', { time: 0.25 + easeOut(t / 14) * 0.9 });
        break;
      default:
        this.enter('loco', 'idle', t);
        a.loco(idleClip, 'Jog_Fwd_Loop', 0, 1, 0.7);
    }
    a.update(dt);
    if (post) post();
    this.prevS = o.s;
  }

  /** 边打边走：把世界速度换算到模型空间，推进步伐相位；返回 null 表示不叠加 */
  attackStep(o, dt, noStep) {
    const K = 2;
    const vx = o._frozen ? 0 : o._vx || 0, vz = o._frozen ? 0 : (o._vy || 0) * K;
    const c = Math.cos(this.a.yaw), s = Math.sin(this.a.yaw);
    const mx = vx * c - vz * s, mz = vx * s + vz * c;
    const m = Math.hypot(mx, mz);
    const target = m > 0.4 && !noStep ? 0.8 : 0;
    this.stepW = (this.stepW || 0) + (target - (this.stepW || 0)) * Math.min(1, dt * 14);
    this.stepPh = (this.stepPh || 0) + m * dt * 30 * (Math.PI * 2) / 34;
    if (this.stepW < 0.02) return null;
    const g = clamp(m / 2, 0.35, 1) / Math.max(m, 1e-3);
    if (m > 0.05) this.stepDir = { x: mx * g, z: mz * g };
    return { mv: this.stepDir || { x: 0, z: 0.5 }, w: this.stepW };
  }

  /**
   * 关底 Boss「OVERCLOCK」的格斗招式（服务器状态 → 机器人动作片段 + 程序化叠加）
   *   bpunch 重拳 31 tick（0-9 蓄力，10-12 判定）/ bstomp 跳起踩地 38 tick（19 落地）/ charge 冲撞 46 tick（0-11 蓄力，12-34 冲）
   *   cast 扔扳手 30 tick（13 出手）/ special 超频连锤 44 tick（6-31 连打，34 上冲重拳）/ block / grab / throw / win / dead / land
   */
  bossPose(o, t, dt, time) {
    const a = this.a;
    let post = null, eye = 0;
    const twist = (k) => a.rotate('Torso_1', Y, k);
    switch (o.s) {
      case 'bpunch': {
        if (t < 10) {
          this.enter('bwind', 'windup', t);
          const k = sm(t / 8);
          a.play('Punch', { time: 0.28 * k });
          const shake = Math.sin(time * 55) * 0.05 * k;
          a.body.position.z -= 10 * k;
          post = () => { twist(0.55 * k + shake); a.rotate('Torso_1', X, -0.2 * k); };
          eye = 0.6 + 0.4 * Math.sin(time * 30);
        } else {
          this.enter('bhit', 'attack', t);
          const u = t - 10, k = easeOut(u / 3);
          a.play('Punch', { time: 0.3 + Math.min(1, u / 8) * 0.55 });
          a.body.position.z += 16 * k - 16 * sm((u - 6) / 12);
          post = () => { twist(-0.4 * k * (1 - sm((u - 5) / 12))); a.rotate('Torso_1', X, 0.15 * k * (1 - sm((u - 5) / 12))); };
          eye = u < 8 ? 1 : 0;
        }
        break;
      }
      case 'bstomp': {
        this.enter('bstomp', 'bstomp', t);
        this.ground = 'none';
        if (t < 5) {
          a.play('Jump', { time: 0.05 + 0.2 * (t / 5) });
          a.body.scale.set(1.06, 1 - 0.1 * sm(t / 4), 1.06);
        } else if (t < 19) {
          a.play('Jump', { time: 0.32 + 0.25 * sm((t - 5) / 14) });
          post = () => { a.rotate('Torso_1', X, -0.25 + 0.5 * sm((t - 12) / 7)); };
        } else {
          const u = t - 19;
          a.play('Jump', { time: 0.62 + Math.min(0.35, u * 0.03) });
          const sq = Math.sin(clamp(u / 5, 0, 1) * Math.PI) * 0.16;
          a.body.scale.set(1 + sq * 0.7, 1 - sq, 1 + sq * 0.7);
          this.ground = null;
        }
        eye = t > 12 && t < 24 ? 1 : 0.4;
        break;
      }
      case 'charge': {
        if (t < 12) {
          this.enter('cwind', 'cwind', t);
          const k = sm(t / 9);
          a.play('Running', { time: 0.1 });
          a.body.position.z -= 8 * k;
          post = () => { a.rotate('Torso_1', X, 0.45 * k); a.rotate('Head', X, -0.3 * k); };
          eye = 0.5 + 0.5 * Math.sin(time * 40);
        } else if (t < 35) {
          this.enter('charge', 'charge', t);
          a.play('Running', { speed: dt ? 2.2 : 0 });
          post = () => { a.rotate('Torso_1', X, 0.55); a.rotate('Head', X, -0.35); };
          eye = 1;
        } else {
          this.enter('brec', 'recover', t);
          a.play('Idle', { speed: dt ? 1 : 0 });
          const k = 1 - sm((t - 35) / 10);
          post = () => a.rotate('Torso_1', X, 0.4 * k);
        }
        break;
      }
      case 'cast': {
        // 扔扳手：右手从身后抡过头顶甩出（13 tick 出手）
        this.enter('bcast', 'cast', t);
        a.play('Punch', { time: t < 13 ? 0.12 : 0.3 + Math.min(1, (t - 13) / 8) * 0.5 });
        const up = sm(t / 10) * (1 - sm((t - 12) / 2.5)), fl = sm((t - 12) / 3) * (1 - sm((t - 20) / 9));
        post = () => {
          twist(0.5 * up - 0.45 * fl);
          a.rotate('Torso_1', X, -0.25 * up + 0.25 * fl);
          a.aim('UpperArmR', 'LowerArmR', lerpDir(V(-0.3, 0.7, -0.65), V(-0.1, 0.1, 1), fl), Math.max(up, fl));
          a.aim('LowerArmR', 'Palm2R', lerpDir(V(-0.1, 0.95, -0.2), V(0, 0, 1), fl), Math.max(up, fl));
        };
        if (a.wrenchHeld) a.wrenchHeld.visible = t < 13;
        eye = t > 10 && t < 16 ? 1 : 0;
        break;
      }
      case 'special': {
        // 超频连锤：左右交替的高速直拳（每 4 tick 一拳），最后一记上冲重拳
        this.enter('bsup', 'special', t);
        eye = 1;
        if (t < 6) {
          a.play('Idle', { time: 0.2 });
          const k = sm(t / 5);
          post = () => { a.rotate('Torso_1', X, -0.25 * k); a.rotate('Head', X, -0.3 * k); };
          a.body.scale.setScalar(1 + 0.05 * Math.sin(time * 60) * k);
        } else if (t < 32) {
          const ph = ((t - 6) % 4) / 4, side = Math.floor((t - 6) / 4) % 2 ? 1 : -1;
          a.play('Punch', { time: 0.3 + 0.45 * Math.sin(ph * Math.PI) });
          a.body.position.z += 8 * Math.sin(ph * Math.PI);
          post = () => { twist(side * 0.45 * Math.sin(ph * Math.PI)); a.rotate('Torso_1', X, 0.12); };
        } else {
          const u = t - 32, k = sm(u / 3) * (1 - sm((u - 6) / 6));
          a.play('Punch', { time: 0.3 + Math.min(1, u / 6) * 0.5 });
          a.body.position.z += 18 * k;
          post = () => {
            twist(-0.5 * k); a.rotate('Torso_1', X, -0.35 * k);
            a.aim('UpperArmR', 'LowerArmR', V(-0.1, 0.75, 0.66), k);
            a.aim('LowerArmR', 'Palm2R', V(0, 0.98, 0.2), k);
          };
        }
        break;
      }
      case 'block': {
        // 防御：双臂交叉护在胸前、上身后缩
        this.enter('bblock', 'block', t);
        a.play('Idle', { speed: dt ? 0.5 : 0 });
        post = () => {
          a.rotate('Torso_1', X, -0.15);
          a.aim('UpperArmL', 'LowerArmL', V(0.35, -0.2, 0.9), 1);
          a.aim('LowerArmL', 'Palm2L', V(-0.85, 0.45, 0.25), 1);
          a.aim('UpperArmR', 'LowerArmR', V(-0.35, -0.1, 0.9), 1);
          a.aim('LowerArmR', 'Palm2R', V(0.85, 0.5, 0.15), 1);
        };
        break;
      }
      case 'grab': {
        this.enter('bgrab', 'grab', t);
        a.play('Punch', { time: 0.4 });
        post = () => {
          a.aim('UpperArmL', 'LowerArmL', V(0.25, -0.1, 1), 1); a.aim('LowerArmL', 'Palm2L', V(-0.3, 0, 1), 1);
          a.aim('UpperArmR', 'LowerArmR', V(-0.25, -0.1, 1), 1); a.aim('LowerArmR', 'Palm2R', V(0.3, 0, 1), 1);
        };
        break;
      }
      case 'throw': {
        // 把对手抡起甩到身后
        this.enter('bthrow', 'throw', t);
        a.play('Punch', { time: 0.3 + Math.min(1, t / 10) * 0.5 });
        const k = sm(t / 8) * (1 - sm((t - 10) / 8));
        post = () => { twist(-0.9 * k); a.rotate('Torso_1', X, 0.2 * k); };
        eye = t < 10 ? 1 : 0;
        break;
      }
      case 'win':
        this.enter('bwin', 'win', t);
        if (t < 40) a.play('Yes', { speed: dt ? 1 : 0 });
        else a.play('Dance', { speed: dt ? 1 : 0 });
        eye = 0.5 + 0.5 * Math.sin(time * 8);
        break;
      case 'dead':
        this.enter('bdead', 'dead', t);
        a.play('Death', { time: 0.93 });
        break;
      case 'land':
        this.enter('loco', 'idle', t);
        a.loco('Idle', 'Walking', 0, 1, 1);
        break;
    }
    a.update(dt);
    if (post) post();
    if (a.core) a.core.scale.setScalar(1 + 0.25 * eye + 0.08 * Math.sin(time * 9));
    if (a.eyeMat) {
      a.eyeMat.emissive.set(eye > 0.3 ? '#ff1a1a' : ROBOT_EYE.boss);
      a.eyeMat.emissiveIntensity = 0.9 + eye * 1.6;
    }
  }

  robotPose(o, t, dt, time) {
    const a = this.a, type = this.id;
    const spd = o._spd || 0;
    let post = null;
    let eye = 0;
    if (type === 'boss' && BOSS_STATES[o.s]) { this.bossPose(o, t, dt, time); return; }
    switch (o.s) {
      case 'idle': case 'walk': case 'recover': {
        this.enter('loco', o.s, t);
        const [ts, nom] = ROBOT_WALK[type] || [1.1, 2.2];
        const target = o.s === 'walk' ? clamp(spd / (nom * 0.5), 0.4, 1) : 0;
        this.w += (target - this.w) * Math.min(1, dt * 10);
        a.loco('Idle', 'Walking', this.w, 1, ts * clamp(spd / nom, 0.5, 1.3));
        break;
      }
      case 'windup': case 'cwind': {
        // 蓄力：向后拧身、拉开拳头、轻微颤抖 —— 明确的出手预告
        this.enter('windup', o.s, t);
        const W = o.s === 'cwind' ? 14 : ROBOT_WINDUP[type] || 14;
        const k = sm(t / (W * 0.8));
        a.play('Punch', { time: 0.28 * k });
        const shake = Math.sin(time * 55) * 0.04 * k;
        a.body.position.z -= 5 * k * (type === 'boss' ? 2 : 1);
        post = () => {
          a.rotate('Torso_1', Y, 0.45 * k + shake);
          a.rotate('Torso_1', X, -0.18 * k);
          a.rotate('Head', X, 0.12 * k);
        };
        eye = 0.6 + 0.4 * Math.sin(time * 30);
        break;
      }
      case 'attack': {
        this.enter('attack', 'attack', t);
        const k = easeOut(t / 4);
        a.play('Punch', { time: 0.3 + Math.min(1, t / 7) * 0.5 });
        a.body.position.z += (8 * k - 8 * sm((t - 4) / 6)) * (type === 'boss' ? 2 : 1);
        post = () => a.rotate('Torso_1', Y, -0.25 * k * (1 - sm((t - 3) / 6)));
        eye = 1;
        break;
      }
      case 'charge':
        this.enter('charge', 'charge', t);
        a.play('Running', { speed: dt ? 1.6 : 0 });
        post = () => a.rotate('Torso_1', X, 0.3);
        eye = 1;
        break;
      case 'hurt':
        this.enter('hurt', 'hurt', t);
        a.play('Idle', { speed: dt ? 1 : 0 });
        post = () => recoil(a, t);
        break;
      case 'grabbed':
        this.enter('grabbed', 'grabbed', t);
        a.play('Jump', { time: 0.3 });
        a.body.position.y += 10 + Math.sin(time * 40) * 1.5;   // 被提起
        post = () => recoil(a, 2 + Math.sin(time * 30));
        break;
      case 'air':
        // 浮空（被挑空 / 追打 / 坠击砸地反弹）：仰面腾空、手脚甩开，随时间轻微翻滚
        this.enter('air', 'air', t);
        a.play('Death', { time: 0.12 + 0.06 * Math.sin(t * 0.5) });
        a.body.rotation.x = -0.75 - 0.3 * Math.sin(t * 0.32);
        post = () => recoil(a, 2.2);
        break;
      case 'knockdown': case 'thrown':
        this.enter('knockdown', o.s, t);
        a.play('Death', { time: 0.05 + 0.25 * sm(t / 12) });
        a.body.rotation.x = o.s === 'thrown' ? -t * 0.5 : -0.8 * sm(t / 9);
        break;
      case 'down': case 'dying':
        this.enter('down', o.s, t);
        a.play('Death', { time: 0.93 });
        break;
      case 'getup':
        this.enter('getup', 'getup', t);
        a.play('Death', { time: 0.93 * (1 - sm(t / 14)) });
        break;
      default:
        this.enter('loco', 'idle', t);
        a.loco('Idle', 'Walking', 0, 1, 1);
    }
    a.update(dt);
    if (post) post();
    if (a.eyeMat) {
      a.eyeMat.emissive.set(eye > 0.3 ? '#ff1a1a' : (ROBOT_EYE[type] || '#3df2ff'));
      a.eyeMat.emissiveIntensity = 0.9 + eye * 1.2;
    }
  }
}
