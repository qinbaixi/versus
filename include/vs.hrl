%% ==========================================================================
%% vs.hrl —— 后端共用的数据结构（record）
%%
%%   对外协议（快照 / 事件 / JSON）仍然是 map，这里只定义服务器内部的实体。
%%   约定：x 横向 0..1000，z 离地高度，f 朝向（1 右 / -1 左），时间单位都是 tick（30 tick/s）。
%% ==========================================================================

%% ---------------------------------------------------------------- 角色
-record(fighter, {
    %% 身份
    id = 1          :: 1 | 2,            %% 座位
    c = kai         :: atom(),           %% 角色：kai | mira | bruno | zed | boss
    n = <<>>        :: binary(),         %% 显示名
    cpu = false     :: boolean(),        %% 是否 CPU 操控
    mhp = 1000      :: integer(),        %% 最大血量
    hp = 1000       :: number(),         %% 当前血量
    en = 0.0        :: float(),          %% 必杀能量 0..100
    %% 位置与速度
    x = 0.0         :: number(),
    z = 0.0         :: number(),
    vx = 0.0        :: number(),
    vz = 0.0        :: number(),
    f = 1           :: 1 | -1,
    %% 状态机
    s = idle        :: atom(),           %% 当前状态（idle / walk / attack / hurt / air ...）
    t = 0           :: integer(),        %% 进入当前状态后的 tick 数
    mv = none       :: atom() | tuple(), %% 当前招式（p5 / k5 / sp6 / super ...；倒地时记来源 air | knockdown）
    cb = 0          :: integer(),        %% 连击段数（轻拳三连 / 空中连段的第几下）
    a = none        :: none | s | c,     %% 防御姿势：s 站防 / c 蹲防（none = 还没防过）
    %% 攻击
    hit = []        :: [term()],         %% 本招已经命中过的攻击框 id（同一框只打一次）
    con = false     :: boolean(),        %% 本招是否打中（可取消）
    hc = 0          :: integer(),        %% 当前连段计数（显示 + 伤害衰减）
    armor = 0       :: integer(),        %% 霸体剩余次数
    %% 受击
    hs = 0          :: integer(),        %% 打击停顿（hitstop）剩余 tick
    stun = 0        :: integer(),        %% 硬直 / 防御硬直剩余 tick
    kb = 0.0        :: float(),          %% 硬直期间的击退速度
    inv = 0         :: integer(),        %% 无敌剩余 tick
    tinv = 0        :: integer(),        %% 不可被投剩余 tick
    jc = 0          :: integer(),        %% 本套浮空被追打次数
    jd = 0          :: number(),         %% 本套浮空累计伤害
    jt = 0          :: integer(),        %% 本套浮空已持续 tick
    %% 输入
    m = 0           :: integer(),        %% 本 tick 的按键掩码
    pm = 0          :: integer(),        %% 上 tick 的按键掩码
    buf = #{}       :: #{integer() => integer()}, %% 按键缓冲：键 => 剩余 tick
    tapd = 0        :: -1 | 0 | 1,       %% 上一次方向键按下的方向（双击检测）
    tapt = 99       :: integer(),        %% 距上一次方向键按下的 tick
    dtap = 0        :: -1 | 0 | 1,       %% 本 tick 的双击：1 向前 / -1 向后
    run = false     :: boolean(),        %% 疾跑中
    own = false     :: boolean()         %% 自己的飞行道具还在场上
}).

%% ---------------------------------------------------------------- 飞行道具
-record(proj, {
    id              :: term(),           %% {pj, 发射者座位, 发射 tick}
    o = 1           :: 1 | 2,            %% 发射者座位
    c = kai         :: atom(),           %% 发射者角色（决定外观）
    x = 0.0         :: number(),
    vx = 0.0        :: number(),
    v = 0.0         :: number(),         %% 速度大小
    z0 = 0          :: number(),         %% 判定高度下沿
    z1 = 0          :: number(),         %% 判定高度上沿
    life = 0        :: integer(),        %% 剩余存活 tick
    dmg = 0         :: number()
}).

%% ---------------------------------------------------------------- 道具「霓虹核心」
-record(item, {
    x = 0.0         :: number(),
    z = 0.0         :: number(),
    life = 0        :: integer()
}).

%% ---------------------------------------------------------------- 一场对战
-record(sim, {
    k = 0           :: integer(),        %% 总 tick
    ph = wait       :: wait | intro | fight | ko | over,
    pt = 0          :: integer(),        %% 进入当前阶段后的 tick
    rd = 1          :: integer(),        %% 第几局
    tm = 0          :: integer(),        %% 本局剩余 tick
    w = {0, 0}      :: {integer(), integer()}, %% 双方赢的局数
    fs = #{}        :: #{1 | 2 => #fighter{}},
    pj = []         :: [#proj{}],        %% 场上的飞行道具
    it = none       :: none | #item{},   %% 霓虹核心
    itd = false     :: boolean(),        %% 本局是否已经掉落过道具
    ev = []         :: [map()],          %% 本 tick 产生的事件（倒序）
    res = none      :: none | 0 | 1 | 2, %% 本局结果：0 平 / 胜者座位
    to = false      :: boolean()         %% 本局是否时间到
}).

%% ---------------------------------------------------------------- 攻击框
%%   x0..x1 是面朝方向上的前后范围，z0..z1 相对攻击者自身 z
-record(box, {
    id              :: term(),           %% 同一 id 对同一人只打一次
    x0 = 0          :: number(),
    x1 = 0          :: number(),
    z0 = 0          :: number(),
    z1 = 0          :: number(),
    dmg = 0         :: number(),
    lvl = mid       :: mid | over | low | throw, %% mid 站蹲都能防 / over 必须站防 / low 必须蹲防 / throw 投
    kind = hit      :: atom(),           %% hit / launch / kd / trip / bounce / lift / drag / grab / release
    hst = 0         :: integer(),        %% 命中硬直
    bst = 0         :: integer(),        %% 防御硬直
    push = 0        :: number(),         %% 推开距离
    chip = false    :: boolean(),        %% 防住也削血
    heavy = false   :: boolean(),        %% 重击（停顿更长、特效更大）
    sup = false     :: boolean(),        %% 必杀的攻击框
    %% 只有投（kind = release）用到
    dir = 1         :: 1 | -1,           %% 扔出去的方向
    ox = 0.0        :: number(),         %% 投的人所在 x
    slam = false    :: boolean()         %% 举起后砸地（布鲁诺）
}).

%% ---------------------------------------------------------------- 角色数值
-record(stats, {
    spd             :: float(),          %% 走路速度
    hp              :: integer(),        %% 最大血量
    pow             :: float(),          %% 伤害倍率
    reach           :: integer(),        %% 拳脚距离
    quick           :: integer(),        %% 出招快慢（加在招式总长上，负数更快）
    thr             :: integer()         %% 投技伤害
}).

%% 突进技参数（rush/2）
-record(rush, {
    st              :: dash | runatk,    %% 用哪套动作
    len             :: integer(),        %% 总长
    a0              :: integer(),        %% 判定开始
    a1              :: integer(),        %% 判定结束（之后霸体也解除）
    v0              :: float(),          %% 初速
    decay           :: float(),          %% 每 tick 速度衰减
    dmg             :: number(),
    lvl             :: mid | low,
    armor           :: integer(),        %% 起手霸体次数
    range           :: integer()         %% 攻击框比普通拳脚多出的距离
}).

%% 发波参数（cast/1）
-record(cast, {
    len             :: integer(),        %% 总长
    at              :: integer()         %% 出手 tick
}).
