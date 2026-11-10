/* ==========================================================================
 * hud.js —— 画布上的对战 HUD：双血条、计时器、胜局标记、能量槽、连击数、
 *           回合提示（ROUND / FIGHT / K.O.）、结算、招式提示条、延迟
 * ========================================================================== */
'use strict';

(function (NK) {
  const W = NK.W, H = NK.H;
  const FONT_CN = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","WenQuanYi Zen Hei",sans-serif';
  const FONT_EN = '"Arial Black",Impact,"WenQuanYi Zen Hei",sans-serif';
  const SLOT_COL = ['#ffe45c', '#22f3ff'];   // P1 / P2 标记色
  const clamp = NK.clamp, sm = NK.smooth;

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }

  /** 带描边的文字 */
  function text(ctx, s, x, y, o) {
    o = o || {};
    ctx.font = o.font || `bold 14px ${FONT_CN}`;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.base || 'alphabetic';
    if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = o.blur || 12; }
    if (o.stroke !== false) {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = o.stroke || '#0a0614';
      ctx.lineWidth = o.lw || 4;
      ctx.strokeText(s, x, y);
    }
    ctx.fillStyle = o.color || '#fff';
    ctx.fillText(s, x, y);
    ctx.shadowBlur = 0;
  }

  // 每个座位的显示状态：血条残影、连击数弹出、能量满提示
  const disp = [0, 1].map(() => ({ trail: 1, hp: 1, hitAt: 0, combo: 0, comboAt: 0, lastHc: 0, maxAt: 0, wasMax: false }));
  function reset() { disp.forEach((d) => Object.assign(d, { trail: 1, hp: 1, hitAt: 0, combo: 0, comboAt: 0, lastHc: 0, maxAt: 0, wasMax: false })); }

  // ---------------------------------------------------------------- 顶部：血条 / 头像 / 计时 / 胜局
  const BAR_W = 360, BAR_H = 18, BAR_Y = 18;

  function drawBar(ctx, side, f, d, time, dt) {
    const ch = NK.CHARS[f.c] || NK.CHARS.kai;
    const ratio = f.m > 0 ? clamp(f.h / f.m, 0, 1) : 0;
    if (ratio < d.hp - 1e-4) d.hitAt = time;
    d.hp = ratio;
    if (d.trail < ratio) d.trail = ratio;
    else if (time - d.hitAt > 0.45) d.trail = Math.max(ratio, d.trail - dt * 0.6);
    const inner = side === 0 ? 480 - 46 : 480 + 46;       // 靠近计时器的一端
    const dir = side === 0 ? -1 : 1;
    const x0 = side === 0 ? inner - BAR_W : inner;
    // 斜切外框
    const sk = 8 * dir;
    const path = (pad) => {
      ctx.beginPath();
      ctx.moveTo(inner - dir * pad, BAR_Y - pad);
      ctx.lineTo(inner + dir * (BAR_W + pad), BAR_Y - pad);
      ctx.lineTo(inner + dir * (BAR_W + pad) - sk, BAR_Y + BAR_H + pad);
      ctx.lineTo(inner - dir * pad - sk, BAR_Y + BAR_H + pad);
      ctx.closePath();
    };
    ctx.save();
    path(3); ctx.fillStyle = '#0a0614'; ctx.fill();
    path(1.5); ctx.fillStyle = '#f4f0ff'; ctx.fill();
    path(0); ctx.fillStyle = '#2a0c1c'; ctx.fill();
    ctx.save(); path(0); ctx.clip();
    // 残影（刚被打掉的血量）
    const tw = BAR_W * d.trail, hw = BAR_W * ratio;
    ctx.fillStyle = '#ff5a3c';
    ctx.fillRect(side === 0 ? inner - tw - 10 : inner, BAR_Y, tw + 10, BAR_H);
    // 当前血量
    const low = ratio < 0.25;
    const col = low ? (Math.floor(time * 6) % 2 ? '#ff3030' : '#ff8a3c') : '#ffd83c';
    const grd = ctx.createLinearGradient(0, BAR_Y, 0, BAR_Y + BAR_H);
    grd.addColorStop(0, NK.shade(col, 1.5)); grd.addColorStop(0.45, col); grd.addColorStop(1, NK.shade(col, 0.62));
    ctx.fillStyle = grd;
    ctx.fillRect(side === 0 ? inner - hw - 10 : inner, BAR_Y, hw + 10, BAR_H);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(x0 - 10, BAR_Y + 2, BAR_W + 20, 3);
    ctx.restore();
    ctx.restore();

    // 头像
    const px = side === 0 ? 34 : W - 34, py = 34;
    ctx.save();
    ctx.beginPath(); ctx.arc(px, py, 25, 0, Math.PI * 2);
    ctx.fillStyle = NK.shade(ch.color, 0.35); ctx.fill();
    ctx.clip();
    if (NK.portrait) {
      const p = NK.portrait(f.c);
      if (p) {
        ctx.translate(px, py);
        if (side === 1) ctx.scale(-1, 1);
        ctx.drawImage(p, -29, -32, 60, 60);
      }
    }
    ctx.restore();
    ctx.beginPath(); ctx.arc(px, py, 25, 0, Math.PI * 2);
    ctx.lineWidth = 4; ctx.strokeStyle = '#0a0614'; ctx.stroke();
    ctx.lineWidth = 2.5; ctx.strokeStyle = ch.color; ctx.stroke();

    // 名字
    const nx = side === 0 ? x0 + 4 : x0 + BAR_W - 4;
    text(ctx, `${ch.cn} ${f.c.toUpperCase()}`, nx, BAR_Y + BAR_H + 19, { font: `italic 900 15px ${FONT_EN}`, align: side === 0 ? 'left' : 'right', color: ch.color, lw: 4 });
    const lw = ctx.measureText(`${ch.cn} ${f.c.toUpperCase()}`).width;
    text(ctx, f.n || '', nx + (side === 0 ? lw + 8 : -lw - 8), BAR_Y + BAR_H + 18, { font: `bold 12px ${FONT_CN}`, align: side === 0 ? 'left' : 'right', color: '#e8e2ff', lw: 3 });
  }

  function drawWins(ctx, side, n, time) {
    for (let i = 0; i < 2; i++) {
      const x = side === 0 ? 480 - 58 - i * 20 : 480 + 58 + i * 20, y = BAR_Y + BAR_H + 15;
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#0a0614'; ctx.fillRect(-7, -7, 14, 14);
      const on = i < n;
      ctx.fillStyle = on ? '#ffe45c' : '#3a2f55';
      if (on) { ctx.shadowColor = '#ffb300'; ctx.shadowBlur = 8 + 3 * Math.sin(time * 5); }
      ctx.fillRect(-5, -5, 10, 10);
      ctx.restore();
    }
  }

  function drawTimer(ctx, snap, time) {
    const t = snap.tm | 0;
    const low = snap.ph === 'fight' && t <= 10;
    ctx.save();
    ctx.translate(480, 30);
    ctx.beginPath(); ctx.moveTo(-36, -22); ctx.lineTo(36, -22); ctx.lineTo(28, 22); ctx.lineTo(-28, 22); ctx.closePath();
    ctx.fillStyle = 'rgba(10,6,20,0.85)'; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = low ? '#ff4040' : '#b9a9ff'; ctx.stroke();
    const s = low ? 1 + 0.12 * Math.abs(Math.sin(time * 6)) : 1;
    ctx.scale(s, s);
    text(ctx, String(t).padStart(2, '0'), 0, 13, { font: `900 34px ${FONT_EN}`, align: 'center', color: low ? '#ff5a4a' : '#fff', lw: 5 });
    ctx.restore();
  }

  function drawTop(ctx, snap, time, dt) {
    const fs = snap.f || [];
    fs.forEach((f) => {
      const side = f.i === 2 ? 1 : 0;
      drawBar(ctx, side, f, disp[side], time, dt);
      drawWins(ctx, side, (snap.w || [0, 0])[side], time);
    });
    drawTimer(ctx, snap, time);
  }

  // ---------------------------------------------------------------- 底部：能量槽 + 招式提示
  function drawEnergy(ctx, side, f, time, now, labels) {
    const ch = NK.CHARS[f.c] || NK.CHARS.kai;
    const d = disp[side];
    const w = 250, h = 11, y = H - 34;
    const x = side === 0 ? 36 : W - 36 - w;
    const k = clamp((f.e || 0) / 100, 0, 1);
    const max = k >= 1;
    if (max && !d.wasMax) d.maxAt = now;
    d.wasMax = max;
    rr(ctx, x - 3, y - 3, w + 6, h + 6, 4); ctx.fillStyle = '#0a0614'; ctx.fill();
    rr(ctx, x, y, w, h, 2); ctx.fillStyle = '#1b1238'; ctx.fill();
    const fw = w * k;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    if (max) {
      const p = 0.5 + 0.5 * Math.sin(time * 10);
      g.addColorStop(0, '#ffe45c'); g.addColorStop(0.5, NK.shade('#ffe45c', 1.3 + 0.4 * p)); g.addColorStop(1, '#ff8a00');
    } else { g.addColorStop(0, '#2b6bff'); g.addColorStop(1, '#22f3ff'); }
    ctx.fillStyle = g;
    ctx.fillRect(side === 0 ? x : x + w - fw, y, fw, h);
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(x, y + 1, w, 2);
    // 半格刻度
    ctx.fillStyle = '#0a0614'; ctx.fillRect(x + w / 2 - 1, y, 2, h);
    const ax = side === 0 ? x : x + w, al = side === 0 ? 'left' : 'right';
    const key = labels ? `[${labels.u}] ` : '';
    if (max) {
      const pop = 1 + 0.5 * (1 - sm((now - d.maxAt) / 300));
      ctx.save(); ctx.translate(ax, y - 6); ctx.scale(pop, pop);
      text(ctx, `${key}必杀 ${ch.sup} 可发动!`, 0, 0, { font: `900 14px ${FONT_CN}`, align: al, color: Math.floor(time * 8) % 2 ? '#fff' : '#ffe45c', lw: 4, glow: '#ff9d00', blur: 10 });
      ctx.restore();
    } else {
      text(ctx, `${key}必杀 ${ch.sup}`, ax, y - 6, { font: `bold 12px ${FONT_CN}`, align: al, color: '#9fd8ff', lw: 3 });
    }
    text(ctx, max ? 'MAX' : String(f.e | 0), side === 0 ? x + w + 8 : x - 8, y + 10, { font: `900 12px ${FONT_EN}`, align: side === 0 ? 'left' : 'right', color: max ? '#ffe45c' : '#cfe9ff', lw: 3 });
    // 本地玩家：招式提示条
    if (labels) {
      const L = labels;
      const tips = `${L.s} ${ch.sp5}   前+${L.s} ${ch.sp6}   下+${L.s} ${ch.sp2}   ${L.k} ${ch.k5}   ${L.t} 投`;
      text(ctx, tips, ax, H - 8, { font: `bold 11px ${FONT_CN}`, align: al, color: '#d9d0ff', lw: 3 });
    }
  }

  // ---------------------------------------------------------------- 连击数
  function drawCombo(ctx, side, f, now) {
    const d = disp[side];
    const hc = f.hc | 0;
    if (hc !== d.lastHc) {
      if (hc >= 2) { d.combo = hc; d.comboAt = now; }
      d.lastHc = hc;
    }
    const age = now - d.comboAt;
    if (d.combo < 2 || age > 1600) return;
    const x = side === 0 ? 70 : W - 70, y = 150;
    const pop = age < 110 ? 1.6 - 0.6 * (age / 110) : 1;
    ctx.save();
    ctx.globalAlpha = age > 1300 ? 1 - (age - 1300) / 300 : 1;
    ctx.translate(x, y); ctx.rotate(side === 0 ? -0.08 : 0.08); ctx.scale(pop, pop);
    const al = side === 0 ? 'left' : 'right';
    text(ctx, String(d.combo), 0, 0, { font: `italic 900 56px ${FONT_EN}`, align: al, color: '#ffe45c', stroke: '#b3120a', lw: 8 });
    const nw = ctx.measureText(String(d.combo)).width;
    text(ctx, 'HITS', side === 0 ? nw + 8 : -nw - 8, -2, { font: `italic 900 22px ${FONT_EN}`, align: al, color: '#fff', stroke: '#b3120a', lw: 6 });
    ctx.restore();
  }

  // ---------------------------------------------------------------- 中央提示
  function big(ctx, s, y, size, col, glow, scale, alpha, cn) {
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.translate(W / 2, y); ctx.scale(scale, scale); ctx.transform(1, 0, -0.14, 1, 0, 0);
    text(ctx, s, 0, 0, { font: `${cn ? '' : 'italic '}900 ${size}px ${cn ? FONT_CN : FONT_EN}`, align: 'center', base: 'middle', color: col, stroke: '#0a0614', lw: size * 0.16, glow, blur: 26 });
    ctx.restore();
  }
  /** 弹入：0→1 的时间比例换算成缩放 / 透明度 */
  const popIn = (k) => ({ s: 1 + 1.4 * Math.pow(1 - clamp(k, 0, 1), 3), a: clamp(k * 3, 0, 1) });

  function nameOf(snap, seat) {
    const f = (snap.f || []).find((q) => q.i === seat);
    if (!f) return '';
    const ch = NK.CHARS[f.c] || NK.CHARS.kai;
    return { cn: ch.cn, col: ch.color, n: f.n, cpu: f.cpu };
  }

  /** local：本地玩家的座位列表（[1] / [1,2] / [] 观众） */
  function drawCenter(ctx, snap, time, local, roomCode, labels) {
    const ph = snap.ph, pt = snap.pt | 0;
    if (ph === 'wait') {
      big(ctx, '等待对手加入', 220, 44, '#fff', '#22f3ff', 1, 1, true);
      text(ctx, `把房间号「${roomCode}」告诉对手，对方在联机对战里输入相同房间号即可` + '.'.repeat(1 + Math.floor(time * 2) % 3), W / 2, 280, { font: `bold 16px ${FONT_CN}`, align: 'center', color: '#ffe45c', lw: 4 });
      return;
    }
    if (ph === 'intro') {
      if (pt < 50) {
        const w = snap.w || [0, 0];
        const fin = w[0] === 1 && w[1] === 1;
        const p = popIn(pt / 8);
        const out = pt > 42 ? 1 - (pt - 42) / 8 : 1;
        if (snap.arc && snap.rd === 1) text(ctx, `闯关  第 ${snap.arc.st} / ${snap.arc.n} 战`, W / 2, 168, { font: `bold 20px ${FONT_CN}`, align: 'center', color: '#22f3ff', lw: 5 });
        big(ctx, fin ? 'FINAL ROUND' : `ROUND ${snap.rd}`, 230, fin ? 72 : 84, '#ffe45c', '#ff7a00', p.s, p.a * out);
      } else {
        const p = popIn((pt - 50) / 6);
        big(ctx, 'FIGHT!', 230, 110, '#fff', '#ff2bd6', p.s, p.a);
      }
      return;
    }
    if (ph === 'fight') {
      if (pt < 16) big(ctx, 'FIGHT!', 230, 110, '#fff', '#ff2bd6', 1 + pt * 0.03, 1 - pt / 16);
      return;
    }
    if (ph === 'ko') {
      const res = snap.res;
      if (pt < 62) {
        const p = popIn(pt / 7);
        const label = snap.to ? 'TIME UP' : res === 0 ? 'DOUBLE K.O.' : 'K.O.';
        big(ctx, label, 225, snap.to || res === 0 ? 84 : 140, '#ff4b3a', '#ffe45c', p.s, p.a * (pt > 54 ? 1 - (pt - 54) / 8 : 1));
      } else {
        const p = popIn((pt - 62) / 8);
        if (res === 0) big(ctx, '平局', 225, 80, '#fff', '#22f3ff', p.s, p.a, true);
        else {
          const n = nameOf(snap, res);
          big(ctx, `${n.cn} 胜`, 225, 84, n.col, '#ffffff', p.s, p.a, true);
        }
      }
      return;
    }
    if (ph === 'over') {
      const w = snap.w || [0, 0];
      const win = w[0] > w[1] ? 1 : 2;
      const n = nameOf(snap, win);
      const p = popIn(pt / 10);
      ctx.fillStyle = `rgba(6,2,16,${0.45 * clamp(pt / 20, 0, 1)})`; ctx.fillRect(0, 0, W, H);
      let title = `${n.cn} 获胜`, col = n.col;
      if (local.length === 1) {
        const mine = local[0] === win;
        title = mine ? 'YOU WIN' : 'YOU LOSE';
        col = mine ? '#ffe45c' : '#8fa0c8';
      }
      big(ctx, title, 200, 96, col, local.length === 1 && local[0] !== win ? '#30406a' : '#ff7a00', p.s, p.a, local.length !== 1);
      text(ctx, `${w[0]}  :  ${w[1]}`, W / 2, 285, { font: `900 34px ${FONT_EN}`, align: 'center', color: '#fff', lw: 6 });
      if (pt > 40) {
        const key = labels ? labels.p : 'J';
        let tip = `按 ${key}（拳）再来一局`;
        if (snap.md === 'arc') {
          const cleared = win === 1 && snap.arc && snap.arc.st >= snap.arc.n;
          if (cleared) { tip = `按 ${key} 从头再闯一遍`; big(ctx, '闯关成功！', 345, 40, '#22f3ff', '#22f3ff', 1, 1, true); }
          else tip = win === 1 ? `按 ${key} 挑战下一位对手` : `按 ${key} 原地续关`;
        }
        if (local.length === 0) tip = '观战中';
        const blink = 0.6 + 0.4 * Math.sin(time * 6);
        ctx.globalAlpha = blink;
        text(ctx, tip, W / 2, snap.md === 'arc' ? 400 : 345, { font: `bold 20px ${FONT_CN}`, align: 'center', color: '#ffe45c', lw: 5 });
        ctx.globalAlpha = 1;
        if (snap.md === 'vs' && snap.rdy) {
          const r = snap.rdy;
          text(ctx, `P1 ${r[0] ? '已准备' : '…'}      P2 ${r[1] ? '已准备' : '…'}`, W / 2, 375, { font: `bold 14px ${FONT_CN}`, align: 'center', color: '#cfe9ff', lw: 4 });
        }
        text(ctx, 'Esc 返回选人', W / 2, H - 60, { font: `bold 13px ${FONT_CN}`, align: 'center', color: '#b9a9ff', lw: 3 });
      }
    }
  }

  function drawWaiting(ctx, time, msg) {
    text(ctx, msg + '.'.repeat(1 + Math.floor(time * 2) % 3), W / 2, H / 2, { font: `bold 22px ${FONT_CN}`, align: 'center', color: '#22f3ff', lw: 5 });
  }

  function drawPing(ctx, pings, musicOn, extra) {
    const p = pings.filter((v) => v != null);
    const s = (p.length ? `${Math.max(...p)}ms` : '--') + (musicOn ? '  ♪' : '') + (extra ? '  ' + extra : '');
    text(ctx, s, W / 2, H - 6, { font: `bold 10px ${FONT_EN}`, align: 'center', color: '#8f84b8', lw: 2 });
  }

  NK.HUD = { FONT_CN, FONT_EN, SLOT_COL, text, reset, drawTop, drawEnergy, drawCombo, drawCenter, drawWaiting, drawPing };
})(window.NK);
