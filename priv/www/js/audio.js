/* ==========================================================================
 * audio.js —— WebAudio 合成音效 + 程序化循环背景音乐（无任何音频文件）
 *   首次用户操作时 unlock()；M 键开关音乐。
 * ========================================================================== */
'use strict';

(function (NK) {
  const A = {
    ctx: null,
    master: null,
    sfxBus: null,
    musicBus: null,
    musicOn: true,
    mood: 'normal',     // 'normal' | 'boss'
    _noise: null,
    _last: {},
    _seq: null,
  };

  /** 在首个用户手势里创建/恢复 AudioContext */
  A.unlock = function () {
    if (!A.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      A.ctx = ctx;
      A.master = ctx.createGain();
      A.master.gain.value = 0.8;
      // 轻度压缩，防止叠加爆音
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      A.master.connect(comp); comp.connect(ctx.destination);
      A.sfxBus = ctx.createGain(); A.sfxBus.gain.value = 0.55; A.sfxBus.connect(A.master);
      A.musicBus = ctx.createGain(); A.musicBus.gain.value = A.musicOn ? 0.22 : 0; A.musicBus.connect(A.master);
      // 预生成 1 秒白噪声
      const len = ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      A._noise = buf;
      startMusic();
    }
    if (A.ctx.state === 'suspended') A.ctx.resume();
  };

  A.toggleMusic = function () {
    A.musicOn = !A.musicOn;
    if (A.musicBus) {
      const t = A.ctx.currentTime;
      A.musicBus.gain.cancelScheduledValues(t);
      A.musicBus.gain.setTargetAtTime(A.musicOn ? 0.22 : 0, t, 0.05);
    }
    return A.musicOn;
  };

  A.setMood = function (m) { A.mood = m; };

  // ---------------------------------------------------------------- 基础合成
  /** 振荡器音：频率 f0→f1 指数滑动，带简易包络 */
  function tone(o) {
    const ctx = A.ctx, t = (o.at != null ? o.at : ctx.currentTime);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1 && o.f1 !== o.f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + o.dur);
    if (o.vib) {
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = o.vib; lg.gain.value = o.vibAmt || 20;
      lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t); lfo.stop(t + o.dur + 0.05);
    }
    const v = o.vol == null ? 0.3 : o.vol, atk = o.atk || 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    let node = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(o.lp, t);
      if (o.lp1) f.frequency.exponentialRampToValueAtTime(o.lp1, t + o.dur);
      f.Q.value = o.q || 1; osc.connect(f); node = f;
    }
    node.connect(g); g.connect(o.dest || A.sfxBus);
    osc.start(t); osc.stop(t + o.dur + 0.02);
  }

  /** 滤波噪声：用于挥拳风声、打击、鼓 */
  function noise(o) {
    const ctx = A.ctx, t = (o.at != null ? o.at : ctx.currentTime);
    const src = ctx.createBufferSource();
    src.buffer = A._noise;
    const f = ctx.createBiquadFilter();
    f.type = o.ft || 'bandpass';
    f.frequency.setValueAtTime(o.f0 || 1000, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    f.Q.value = o.q || 1;
    const g = ctx.createGain();
    const v = o.vol == null ? 0.3 : o.vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + (o.atk || 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g); g.connect(o.dest || A.sfxBus);
    src.start(t, Math.random() * 0.5); src.stop(t + o.dur + 0.02);
  }

  /** 按半音计算频率（A4 = 440） */
  const note = (n) => 440 * Math.pow(2, (n - 69) / 12);

  /** 必杀特写的“唰”声：上扫噪声 + 闪光音（tr：按角色微调音高） */
  function cutin(t, tr) {
    noise({ ft: 'bandpass', f0: 500, f1: 6000, q: 1.5, dur: 0.22, vol: 0.32, at: t });
    tone({ type: 'square', f0: note(84 + tr), f1: note(96 + tr), dur: 0.14, vol: 0.07, lp: 6000, at: t + 0.02 });
    tone({ type: 'sine', f0: note(60 + tr), dur: 0.35, vol: 0.12, at: t + 0.02 });
  }

  // ---------------------------------------------------------------- 音效表
  const SFX = {
    swing() {
      noise({ ft: 'bandpass', f0: 2400, f1: 600, q: 1.4, dur: 0.13, vol: 0.35 });
    },
    hit() {
      tone({ type: 'sine', f0: 180, f1: 55, dur: 0.11, vol: 0.6 });
      noise({ ft: 'lowpass', f0: 3000, f1: 400, dur: 0.07, vol: 0.45 });
    },
    block() {
      tone({ type: 'square', f0: 520, f1: 260, dur: 0.07, vol: 0.2, lp: 2600 });
      noise({ ft: 'bandpass', f0: 1800, f1: 900, q: 2.5, dur: 0.06, vol: 0.4 });
    },
    heavy() {
      tone({ type: 'sine', f0: 140, f1: 35, dur: 0.28, vol: 0.8 });
      tone({ type: 'square', f0: 90, f1: 40, dur: 0.16, vol: 0.18, lp: 900 });
      noise({ ft: 'lowpass', f0: 5000, f1: 300, dur: 0.18, vol: 0.6 });
    },
    ko() {
      tone({ type: 'square', f0: 700, f1: 70, dur: 0.6, vol: 0.22, lp: 2500, lp1: 300 });
      noise({ ft: 'lowpass', f0: 2000, f1: 100, dur: 0.5, vol: 0.4 });
    },
    jump() {
      tone({ type: 'square', f0: 220, f1: 660, dur: 0.12, vol: 0.14, lp: 3000 });
    },
    land() {
      tone({ type: 'sine', f0: 110, f1: 45, dur: 0.1, vol: 0.45 });
      noise({ ft: 'lowpass', f0: 900, dur: 0.07, vol: 0.25 });
    },
    dash() {
      noise({ ft: 'bandpass', f0: 600, f1: 3200, q: 1.2, dur: 0.18, vol: 0.4 });
      tone({ type: 'triangle', f0: 120, f1: 60, dur: 0.12, vol: 0.3 });
    },
    ready() {
      const t = A.ctx.currentTime;
      tone({ type: 'sine', f0: 1320, dur: 0.07, vol: 0.08, at: t });
      tone({ type: 'sine', f0: 1760, dur: 0.1, vol: 0.07, at: t + 0.06 });
    },
    throw() {
      noise({ ft: 'bandpass', f0: 500, f1: 2500, q: 2, dur: 0.25, vol: 0.35 });
      tone({ type: 'triangle', f0: 200, f1: 500, dur: 0.2, vol: 0.2 });
    },
    special() {
      tone({ type: 'sawtooth', f0: 160, f1: 900, dur: 0.45, vol: 0.18, lp: 1200, lp1: 5000, vib: 18, vibAmt: 40 });
      noise({ ft: 'bandpass', f0: 600, f1: 3000, q: 3, dur: 0.45, vol: 0.3 });
    },
    // ---- 角色专属必杀（必杀开始时一次性排好整段音效，与服务器阶段对齐：1 tick = 1/30 秒）
    /** 凯「升龙旋风」：蓄力嗡鸣 → 螺旋上升的火焰呼啸 → 26 tick 终结爆响 */
    super_kai() {
      const t = A.ctx.currentTime, T = (k) => t + k / 30;
      cutin(t, 0);
      tone({ type: 'sawtooth', f0: 70, f1: 140, dur: 0.22, vol: 0.18, lp: 500, at: t, vib: 30, vibAmt: 8 });
      tone({ type: 'sawtooth', f0: 140, f1: 1100, dur: 0.68, vol: 0.16, lp: 900, lp1: 5200, vib: 22, vibAmt: 60, at: T(6) });
      noise({ ft: 'bandpass', f0: 380, f1: 4200, q: 2.5, dur: 0.7, vol: 0.38, at: T(6), atk: 0.05 });
      for (let i = 0; i < 5; i++) noise({ ft: 'bandpass', f0: 1200 + i * 500, f1: 500, q: 3, dur: 0.09, vol: 0.22, at: T(8 + i * 4) });
      tone({ type: 'sine', f0: 190, f1: 38, dur: 0.5, vol: 0.85, at: T(26) });
      noise({ ft: 'lowpass', f0: 6000, f1: 260, dur: 0.45, vol: 0.6, at: T(26) });
      tone({ type: 'square', f0: note(76), f1: note(88), dur: 0.18, vol: 0.08, lp: 5000, at: T(26) });
    },
    /** 米拉「旋风腿」：清亮起手 → 每 5 tick 一次的旋风呼啸（逐渐加快升调） → 31 tick 终结 */
    super_mira() {
      const t = A.ctx.currentTime, T = (k) => t + k / 30;
      cutin(t, 7);
      [79, 84, 91].forEach((n, i) => tone({ type: 'triangle', f0: note(n), dur: 0.16, vol: 0.09, at: t + i * 0.045 }));
      for (let k = 6, i = 0; k < 31; k += 5 - (k > 22 ? 1.5 : 0), i++) {
        noise({ ft: 'bandpass', f0: 900 + i * 180, f1: 3800 + i * 200, q: 4, dur: 0.15, vol: 0.32, at: T(k), atk: 0.03 });
        tone({ type: 'sine', f0: 520 + i * 40, f1: 1300 + i * 60, dur: 0.12, vol: 0.05, at: T(k) });
      }
      noise({ ft: 'highpass', f0: 1500, dur: 0.95, vol: 0.08, at: T(6), atk: 0.1 });
      tone({ type: 'sine', f0: 160, f1: 50, dur: 0.3, vol: 0.6, at: T(31) });
      noise({ ft: 'bandpass', f0: 4000, f1: 700, q: 1.5, dur: 0.3, vol: 0.45, at: T(31) });
    },
    /** 布鲁诺「震地拳」：低沉蓄力上扬（冲击波本身由 quake 播放） */
    super_bruno() {
      const t = A.ctx.currentTime, T = (k) => t + k / 30;
      cutin(t, -5);
      tone({ type: 'sawtooth', f0: 45, f1: 120, dur: 0.38, vol: 0.28, lp: 300, lp1: 1200, at: t });
      tone({ type: 'square', f0: 60, f1: 180, dur: 0.36, vol: 0.08, lp: 700, at: t, vib: 12, vibAmt: 10 });
      noise({ ft: 'bandpass', f0: 300, f1: 1800, q: 2, dur: 0.36, vol: 0.25, at: T(1), atk: 0.2 });
      // 11-14 下砸的风声
      noise({ ft: 'bandpass', f0: 2600, f1: 400, q: 1.2, dur: 0.12, vol: 0.4, at: T(11) });
    },
    /** 泽德「棍影乱舞」：急促的舞棍风声（约 3 tick 一圈） → 22 tick 突刺的破空尖啸 */
    super_zed() {
      const t = A.ctx.currentTime, T = (k) => t + k / 30;
      cutin(t, 3);
      for (let k = 2.5, i = 0; k < 20; k += 3.2, i++) noise({ ft: 'bandpass', f0: 1700, f1: 520, q: 2.2, dur: 0.1, vol: 0.3, at: T(k) });
      for (let k = 3, i = 0; k <= 19; k += 4, i++) tone({ type: 'triangle', f0: 900 + i * 60, f1: 600, dur: 0.05, vol: 0.06, at: T(k) });
      noise({ ft: 'highpass', f0: 2500, f1: 7000, q: 1, dur: 0.22, vol: 0.4, at: T(22) });
      tone({ type: 'sawtooth', f0: 1600, f1: 220, dur: 0.24, vol: 0.12, lp: 6000, lp1: 800, at: T(22) });
      tone({ type: 'sine', f0: 150, f1: 60, dur: 0.22, vol: 0.5, at: T(24) });
    },
    /** OVERCLOCK「超频连锤」：电机过载的升调嗡鸣 → 每 4 tick 一记金属重击 → 34 tick 上冲重拳 */
    super_boss() {
      const t = A.ctx.currentTime, T = (k) => t + k / 30;
      cutin(t, -8);
      tone({ type: 'sawtooth', f0: 55, f1: 440, dur: 0.6, vol: 0.2, lp: 600, lp1: 3000, vib: 40, vibAmt: 25, at: t });
      tone({ type: 'square', f0: 110, f1: 880, dur: 0.6, vol: 0.06, lp: 2000, at: t });
      for (let k = 6, i = 0; k < 32; k += 4, i++) {
        noise({ ft: 'bandpass', f0: 900 + i * 60, f1: 300, q: 4, dur: 0.07, vol: 0.32, at: T(k + 1) });
        tone({ type: 'square', f0: 220 + i * 18, f1: 90, dur: 0.06, vol: 0.1, lp: 1800, at: T(k + 1) });
      }
      tone({ type: 'sine', f0: 170, f1: 36, dur: 0.5, vol: 0.85, at: T(34) });
      noise({ ft: 'lowpass', f0: 5000, f1: 240, dur: 0.42, vol: 0.6, at: T(34) });
    },
    /** 震地冲击波：超低频轰击 + 碎石滚动 */
    quake() {
      const t = A.ctx.currentTime;
      tone({ type: 'sine', f0: 95, f1: 24, dur: 0.85, vol: 0.95, at: t });
      tone({ type: 'square', f0: 55, f1: 28, dur: 0.4, vol: 0.18, lp: 400, at: t });
      noise({ ft: 'lowpass', f0: 2600, f1: 120, dur: 1.0, vol: 0.7, at: t });
      for (let i = 0; i < 6; i++) noise({ ft: 'bandpass', f0: 500 + Math.random() * 900, q: 3, dur: 0.06, vol: 0.18, at: t + 0.12 + i * 0.09 + Math.random() * 0.04 });
    },
    grab() {
      const t = A.ctx.currentTime;
      tone({ type: 'square', f0: 330, dur: 0.05, vol: 0.15, at: t });
      tone({ type: 'square', f0: 220, dur: 0.07, vol: 0.15, at: t + 0.06 });
    },
    hurt() {
      tone({ type: 'square', f0: 340, f1: 140, dur: 0.18, vol: 0.18, vib: 40, vibAmt: 30, lp: 2000 });
    },
    charge() {
      tone({ type: 'sawtooth', f0: 80, f1: 700, dur: 0.7, vol: 0.2, lp: 400, lp1: 4000, q: 6 });
    },
    go() {
      const t = A.ctx.currentTime;
      tone({ type: 'square', f0: 880, dur: 0.1, vol: 0.14, at: t });
      tone({ type: 'square', f0: 1320, dur: 0.18, vol: 0.14, at: t + 0.11 });
    },
    wave() {
      const t = A.ctx.currentTime;
      [60, 64, 67, 72].forEach((n, i) => tone({ type: 'square', f0: note(n + 12), dur: 0.12, vol: 0.12, at: t + i * 0.07, lp: 4000 }));
    },
    boss() {
      const t = A.ctx.currentTime;
      [38, 41, 44].forEach((n) => tone({ type: 'sawtooth', f0: note(n), dur: 1.4, vol: 0.14, at: t, lp: 600, vib: 6, vibAmt: 3 }));
      for (let i = 0; i < 4; i++) {
        tone({ type: 'square', f0: 990, dur: 0.12, vol: 0.08, at: t + i * 0.3 });
        tone({ type: 'square', f0: 740, dur: 0.12, vol: 0.08, at: t + i * 0.3 + 0.15 });
      }
    },
    victory() {
      const t = A.ctx.currentTime;
      const mel = [[67, 0], [72, 0.12], [76, 0.24], [79, 0.36], [76, 0.56], [79, 0.68], [84, 0.84]];
      mel.forEach(([n, d]) => tone({ type: 'square', f0: note(n), dur: d === 0.84 ? 0.7 : 0.14, vol: 0.13, at: t + d, lp: 5000 }));
      [48, 55, 60].forEach((n) => tone({ type: 'triangle', f0: note(n), dur: 1.4, vol: 0.15, at: t + 0.84 }));
    },
    gameover() {
      const t = A.ctx.currentTime;
      [[64, 0], [63, 0.3], [62, 0.6], [61, 0.9]].forEach(([n, d]) =>
        tone({ type: 'triangle', f0: note(n), f1: d === 0.9 ? note(n - 12) : null, dur: d === 0.9 ? 1.2 : 0.28, vol: 0.2, at: t + d }));
    },
  };

  /** 播放命名音效（同名 40ms 内去重） */
  A.play = function (name) {
    if (!A.ctx || A.ctx.state !== 'running') return;
    const fn = SFX[name];
    if (!fn) return;
    const now = A.ctx.currentTime;
    if (A._last[name] && now - A._last[name] < 0.04) return;
    A._last[name] = now;
    try { fn(); } catch (e) { /* 忽略合成错误 */ }
  };
  A.names = Object.keys(SFX);

  // ---------------------------------------------------------------- 背景音乐
  // 原创 4 小节循环：16 分音符步进，贝斯 + 鼓 + 琶音。旋律由种子随机生成（稳定）。
  const PROG = {
    normal: { bpm: 148, roots: [45, 41, 43, 40], minor: [1, 0, 0, 1] },   // A F G E
    boss:   { bpm: 164, roots: [38, 38, 34, 37], minor: [1, 1, 0, 0] },   // D D Bb C#
  };
  const BASS = [1, 0, 1, 2, 0, 1, 3, 0, 1, 0, 1, 2, 0, 3, 2, 1];  // 0=休止 1=根音 2=八度 3=五度
  const melRng = NK.rng(1337);
  const MEL = [];  // 每小节 16 步：-1 休止，否则为和弦音序号
  for (let b = 0; b < 4; b++) {
    const bar = [];
    for (let s = 0; s < 16; s++) bar.push(s % 2 === 0 && melRng.chance(0.7) ? melRng.int(0, 4) : -1);
    MEL.push(bar);
  }

  function startMusic() {
    const ctx = A.ctx;
    const seq = { step: 0, bar: 0, next: ctx.currentTime + 0.1 };
    A._seq = seq;
    setInterval(() => {
      if (!A.musicOn || ctx.state !== 'running') { seq.next = ctx.currentTime + 0.05; return; }
      while (seq.next < ctx.currentTime + 0.12) {
        schedule(seq.step, seq.bar, seq.next);
        const p = PROG[A.mood] || PROG.normal;
        seq.next += 60 / p.bpm / 4;
        seq.step = (seq.step + 1) % 16;
        if (seq.step === 0) seq.bar = (seq.bar + 1) % 4;
      }
    }, 25);
  }

  function schedule(step, bar, t) {
    const p = PROG[A.mood] || PROG.normal;
    const dest = A.musicBus;
    const root = p.roots[bar];
    const third = p.minor[bar] ? 3 : 4;
    const chord = [0, third, 7, 12, 12 + third];
    const sd = 60 / p.bpm / 4;

    // 鼓：底鼓 / 军鼓 / 踩镲
    if (step === 0 || step === 8 || step === 10 || (A.mood === 'boss' && step === 4)) {
      tone({ type: 'sine', f0: 150, f1: 40, dur: 0.16, vol: 0.9, at: t, dest });
    }
    if (step === 4 || step === 12) {
      noise({ ft: 'bandpass', f0: 1800, q: 0.8, dur: 0.12, vol: 0.5, at: t, dest });
      tone({ type: 'triangle', f0: 220, f1: 120, dur: 0.07, vol: 0.3, at: t, dest });
    }
    if (step % 2 === 0 || A.mood === 'boss') {
      noise({ ft: 'highpass', f0: 7000, dur: step === 14 ? 0.12 : 0.035, vol: 0.18, at: t, dest });
    }
    // 贝斯
    const b = BASS[step];
    if (b) {
      const n = root + (b === 2 ? 12 : b === 3 ? 7 : 0);
      tone({ type: 'square', f0: note(n), dur: sd * 0.9, vol: 0.32, at: t, dest, lp: 700, lp1: 250, q: 4 });
    }
    // 琶音（第 2、4 小节更密）
    const m = MEL[bar][step];
    if (m >= 0) {
      tone({ type: 'triangle', f0: note(root + 24 + chord[m]), dur: sd * 1.6, vol: 0.16, at: t, dest });
    } else if (bar % 2 === 1 && step % 4 === 3) {
      tone({ type: 'square', f0: note(root + 36 + chord[step % 3]), dur: sd * 0.5, vol: 0.05, at: t, dest, lp: 3000 });
    }
  }

  NK.Audio = A;
})(window.NK);
