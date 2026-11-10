/* ==========================================================================
 * input.js —— 键盘 + 手柄（Gamepad API）→ 每个本地玩家的输入掩码
 *   P1：A/D 左右，W 跳，S 蹲，J 拳，K 踢，L 技，I 投，U 必杀
 *   P2：方向键，小键盘 1/2/3/5/4（或 , . / ' ;）= 拳 / 踢 / 技 / 投 / 必杀
 *   只有一名本地玩家时，P2 的按键也可操作 P1。
 *   手柄 i → 本地玩家 i：十字键 / 左摇杆，X 拳，A 踢，B 技，Y 投，RB / RT 必杀
 * ========================================================================== */
'use strict';

(function (NK) {
  const B = NK.BTN;

  const KEYMAP = [
    { KeyA: B.LEFT, KeyD: B.RIGHT, KeyW: B.UP, KeyS: B.DOWN, KeyJ: B.PUNCH, KeyK: B.KICK, KeyL: B.SPECIAL, KeyU: B.SUPER, KeyI: B.THROW },
    {
      ArrowLeft: B.LEFT, ArrowRight: B.RIGHT, ArrowUp: B.UP, ArrowDown: B.DOWN,
      Numpad1: B.PUNCH, Numpad2: B.KICK, Numpad3: B.SPECIAL, Numpad4: B.SUPER, Numpad5: B.THROW,
      Comma: B.PUNCH, Period: B.KICK, Slash: B.SPECIAL, Semicolon: B.SUPER, Quote: B.THROW,
    },
  ];

  // HUD 上显示的按键名（随最近使用的输入设备切换）
  const LABELS = {
    kb0: { p: 'J', k: 'K', s: 'L', u: 'U', t: 'I', fwd: '前', down: '下' },
    kb1: { p: '1', k: '2', s: '3', u: '4', t: '5', fwd: '前', down: '下' },
    pad: { p: 'X', k: 'A', s: 'B', u: 'RB', t: 'Y', fwd: '前', down: '下' },
  };
  const lastSrc = ['kb', 'kb'];

  const down = new Set();     // 当前按下的 e.code
  const taps = new Set();     // 自上次采样以来按下过的键（保证极短的点按也至少发送一次）
  let onKeyHook = null;

  function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  }
  const isGameKey = (code) => code in KEYMAP[0] || code in KEYMAP[1];

  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    if (isGameKey(e.code)) {
      if (!e.repeat) taps.add(e.code);
      down.add(e.code);
      if (NK.Input.active) e.preventDefault();
    }
    if (onKeyHook) onKeyHook(e);
  });
  window.addEventListener('keyup', (e) => {
    down.delete(e.code);
    if (isGameKey(e.code) && NK.Input.active) e.preventDefault();
  });
  // 失去焦点时清空按键，避免“粘键”
  window.addEventListener('blur', () => { down.clear(); taps.clear(); });

  function keyMask(map) {
    let m = 0;
    for (const code in map) if (down.has(code) || taps.has(code)) m |= map[code];
    return m;
  }

  function padMask(gp) {
    if (!gp || !gp.connected) return 0;
    const btn = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const ax = (i) => gp.axes[i] || 0;
    const DZ = 0.45;
    let m = 0;
    if (btn(14) || ax(0) < -DZ) m |= B.LEFT;
    if (btn(15) || ax(0) > DZ) m |= B.RIGHT;
    if (btn(12) || ax(1) < -0.6) m |= B.UP;
    if (btn(13) || ax(1) > 0.6) m |= B.DOWN;
    if (btn(2)) m |= B.PUNCH;             // X
    if (btn(0)) m |= B.KICK;              // A
    if (btn(1)) m |= B.SPECIAL;           // B
    if (btn(3)) m |= B.THROW;             // Y
    if (btn(5) || btn(7)) m |= B.SUPER;   // RB / RT
    return m;
  }

  NK.Input = {
    active: false,     // 对战中才拦截浏览器默认行为
    localTwo: false,

    /** 返回本地玩家 slot 的当前掩码 */
    mask(slot) {
      let m = keyMask(KEYMAP[slot]);
      if (!this.localTwo && slot === 0) m |= keyMask(KEYMAP[1]);
      let pads = [];
      try { pads = navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) { pads = []; }
      const pm = padMask(pads[slot]);
      if (pm) lastSrc[slot] = 'pad'; else if (m) lastSrc[slot] = 'kb';
      m |= pm;
      if ((m & B.LEFT) && (m & B.RIGHT)) m &= ~(B.LEFT | B.RIGHT);
      if ((m & B.UP) && (m & B.DOWN)) m &= ~B.UP;
      return m;
    },

    /** 每次采样后调用，清除点按锁存 */
    clearTaps() { taps.clear(); },

    /** 本地玩家 slot 当前应显示的按键名 */
    labels(slot) {
      if (lastSrc[slot] === 'pad') return LABELS.pad;
      return slot === 1 && this.localTwo ? LABELS.kb1 : LABELS.kb0;
    },

    onKey(fn) { onKeyHook = fn; },
  };
})(window.NK);
