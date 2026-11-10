/* ==========================================================================
 * util.js —— 公共工具与常量（全局命名空间 NK）
 * ========================================================================== */
'use strict';

window.NK = window.NK || {};

(function (NK) {
  // ---- 画布 / 擂台常量（见 PROTOCOL.md）----
  NK.W = 960;
  NK.H = 540;
  NK.ARENA = 1000;          // 擂台宽度（服务器 x 0..1000）
  NK.TICK_MS = 1000 / 30;   // 服务器 30 tick/s
  // 四个擂台：把服务器的 0..1000 平移到街景的不同区段
  NK.STAGES = [
    { x0: 260, name: '市中心' },
    { x0: 1760, name: '码头' },
    { x0: 2960, name: '工厂' },
    { x0: 3330, name: '厂区尽头' },
  ];

  // ---- 输入位掩码 ----
  NK.BTN = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, PUNCH: 16, KICK: 32, SPECIAL: 64, SUPER: 128, THROW: 256 };

  // ---- 四名原创角色 ----
  //   sp5 / sp6 / sp2：技（L）/ 前+技 / 下+技；sup：必杀（U）；run：疾跑中拳
  NK.CHARS = {
    kai: {
      id: 'kai', cn: '凯', color: '#ff4b4b', desc: '均衡型 · 有无敌对空',
      sp5: '炎弹', sp6: '炎冲拳', sp2: '炎勾拳', sup: '升龙旋风', k5: '上勾拳', run: '飞膝', thr: '过肩摔',
      stat: '体力 ●●●○<br>速度 ●●●○<br>距离 ●●○○',
    },
    mira: {
      id: 'mira', cn: '米拉', color: '#3fa8ff', desc: '速度型 · 上下段择多',
      sp5: '风刃', sp6: '滑铲', sp2: '流星踵', sup: '旋风腿', k5: '月弧踢', run: '冲拳', thr: '剪刀脚摔',
      stat: '体力 ●●○○<br>速度 ●●●●<br>距离 ●●○○',
    },
    bruno: {
      id: 'bruno', cn: '布鲁诺', color: '#ffd23f', desc: '力量型 · 血厚投技强',
      sp5: '裂地波', sp6: '铁肩撞', sp2: '震地', sup: '震地拳', k5: '擎天拳', run: '冲拳', thr: '举起砸地',
      stat: '体力 ●●●●<br>速度 ●●○○<br>距离 ●●○○',
    },
    zed: {
      id: 'zed', cn: '泽德', color: '#4fdc6a', desc: '长距离 · 长棍压制',
      sp5: '棍气', sp6: '奔袭刺', sp2: '劈山棍', sup: '棍影乱舞', k5: '挑天棍', run: '突刺', thr: '棍挑摔',
      stat: '体力 ●●●○<br>速度 ●●●○<br>距离 ●●●●',
    },
  };
  NK.CHAR_ORDER = ['kai', 'mira', 'bruno', 'zed'];

  // ---- 数学 ----
  NK.lerp = (a, b, t) => a + (b - a) * t;
  NK.clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  NK.smooth = (t) => { t = NK.clamp(t, 0, 1); return t * t * (3 - 2 * t); };

  // ---- 颜色 ----
  NK.hex = function (h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  NK.rgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  /** 调暗/调亮 '#hex'，k<1 变暗，k>1 向白色靠近 */
  NK.shade = function (h, k) {
    const c = NK.hex(h);
    return NK.rgb(k <= 1 ? c.map((v) => v * k) : c.map((v) => v + (255 - v) * (k - 1)));
  };

  /** 可复现的种子随机数（mulberry32） */
  NK.rng = function (seed) {
    let a = seed >>> 0;
    const f = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (lo, hi) => lo + f() * (hi - lo);
    f.int = (lo, hi) => Math.floor(lo + f() * (hi - lo + 1));
    f.pick = (arr) => arr[Math.floor(f() * arr.length)];
    f.chance = (p) => f() < p;
    return f;
  };

})(window.NK);
