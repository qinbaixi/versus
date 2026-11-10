/* ==========================================================================
 * net.js —— WebSocket 连接（每个本地玩家一个独立连接）
 *   发送：J|name|char|room|mode|arg、I|mask（变化时立即发，并每 100ms 重发）、P|n（每 2s）
 *   接收：welcome / error / s（快照）/ pong
 * ========================================================================== */
'use strict';

(function (NK) {
  /** 计算 WebSocket 地址；file:// 打开时回退到 localhost:8090 */
  NK.wsUrl = function () {
    if (location.protocol === 'file:' || !location.host) return 'ws://localhost:8090/ws';
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  };

  /** 名字清洗：去掉 '|'、首尾空白，最多 12 个字符 */
  NK.cleanName = function (s, fallback) {
    s = String(s || '').replace(/[|\r\n\t]/g, '').trim();
    s = Array.from(s).slice(0, 12).join('');
    return s || fallback;
  };

  class Conn {
    /**
     * @param {number} slot 本地玩家序号（0=P1, 1=P2）
     * @param {string} mode vs | cpu | arc；arg：cpu 模式为 "<对手角色|random>:<难度 1-4>"
     * @param {object} h 回调 {welcome, snap, error, close, ping}
     */
    constructor(slot, name, char, room, mode, arg, h) {
      this.slot = slot;
      this.name = name;
      this.char = char;
      this.room = room;
      this.mode = mode;
      this.arg = arg || '';
      this.h = h;
      this.id = null;           // 服务器分配的座位：1 / 2 是选手，0 是观众
      this.mask = 0;
      this.ping = null;         // 往返延迟 ms
      this.closedByUs = false;
      this.ws = null;
      this.timers = [];
    }

    connect() {
      let ws;
      try {
        ws = new WebSocket(NK.wsUrl());
      } catch (e) {
        this.h.error(this.slot, 'connect_failed');
        return;
      }
      this.ws = ws;
      this.opened = false;

      ws.onopen = () => {
        this.opened = true;
        this.send(`J|${this.name}|${this.char}|${this.room}|${this.mode}|${this.arg}`);
        this.send(`I|${this.mask}`);
        // 每 100ms 重发当前输入；每 2s ping 一次
        this.timers.push(setInterval(() => this.send(`I|${this.mask}`), 100));
        this.timers.push(setInterval(() => this.send(`P|${Math.floor(performance.now())}`), 2000));
        this.send(`P|${Math.floor(performance.now())}`);
      };

      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        switch (m.t) {
          case 's': this.h.snap(this.slot, m); break;
          case 'welcome': this.id = m.id; this.h.welcome(this.slot, m); break;
          case 'error': this.h.error(this.slot, m.msg || 'error'); break;
          case 'pong':
            if (typeof m.n === 'number') {
              this.ping = Math.max(0, Math.round(performance.now() - m.n));
              this.h.ping(this.slot, this.ping);
            }
            break;
        }
      };

      ws.onerror = () => { /* onclose 会紧随其后 */ };
      ws.onclose = () => {
        this.stopTimers();
        if (!this.closedByUs) this.h.close(this.slot, this.opened);
      };
    }

    send(txt) {
      if (this.ws && this.ws.readyState === 1) this.ws.send(txt);
    }

    /** 更新输入掩码；发生变化时立即发送 */
    setMask(mask) {
      if (mask !== this.mask) {
        this.mask = mask;
        this.send(`I|${mask}`);
      }
    }

    stopTimers() {
      this.timers.forEach(clearInterval);
      this.timers = [];
    }

    close() {
      this.closedByUs = true;
      this.stopTimers();
      if (this.ws) { try { this.ws.close(); } catch (e) { /* ignore */ } }
    }
  }

  NK.Conn = Conn;
})(window.NK);
