# 通信协议（WebSocket `/ws`）

## 客户端 → 服务器（文本帧，`|` 分隔）

| 帧 | 含义 |
| --- | --- |
| `J|名字|角色|房间|模式|参数` | 加入。角色 `kai|mira|bruno|zed`；模式 `vs`（对人）、`cpu`、`arc`（街机）。`cpu` 的参数是 `<角色或 random>:<难度 1-4>` |
| `I|mask` | 当前按键位掩码（0..511），变化时发送 |
| `P|n` | ping，服务器回 `{t:"pong",n}` |

按键位：LEFT=1 RIGHT=2 UP=4 DOWN=8 拳=16 踢=32 技=64 必杀=128 投=256。

## 服务器 → 客户端（JSON）

- `{t:"welcome", id, room, mode}`：`id` 是座位，1 / 2 为选手，0 为观众。
- `{t:"error", msg}`
- 每 tick 一个快照：

```
{t:"s", k:tick, ph:"wait|intro|fight|ko|over", pt:阶段内 tick, rd:第几局, tm:剩余秒,
 w:[P1 胜局, P2 胜局], res:-1|0|1|2（本局结果，0 平局）, to:是否超时,
 f:[{i:座位, c:角色, n:名字, cpu, x, y:100, z:高度, f:朝向 ±1, s:状态, t:状态内 tick,
     cb:连招段, h:体力, m:体力上限, e:能量, hs:硬直, hc:连击数, a:招式或防御姿态}],
 j:[{c:角色, x, z, vx, i:主人}],          飞行道具
 it:null | {x, z, l},                     霓虹核心
 ev:[{k:"hit|block|ko|dust|item|sfx|fx", ...}],
 md:模式, stg:擂台 0-3, rdy:[bool,bool], aud:观众数, arc:{st:第几关, n:总关数}}
```

状态名：`idle walk run crouch block bstep jump land attack cjab sweep launch jattack slam slamland
runatk dash cast special grab throw grabbed hurt air knockdown down getup dead win`。
比赛结束（`over`）后，选手按拳表示准备好；对人模式需双方都按，CPU / 街机只需 P1。
