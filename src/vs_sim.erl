%% ==========================================================================
%% vs_sim —— 1v1 对战的纯函数模拟（30 tick/s，服务器权威）
%%
%%   坐标：x 横向 0..1000（擂台），z 离地高度；没有纵深。f 朝向（1 右 / -1 左）。
%%   一场比赛 = 三局两胜。阶段 ph：wait → intro → fight → ko → (intro | over)
%%   招式的帧数与前端 js3d/anim.js 的动画时间轴一一对应（见 PROTOCOL.md）。
%% ==========================================================================
-module(vs_sim).
-export([new/0, now/1, seat/5, unseat/2, seated/2, start/1, rematch/1, tick/3, snapshot/1,
         phase/1, fighter/2, projectiles/1, item/1, winner/1, stats/1, valid_char/1]).

-define(XMIN, 35.0).
-define(XMAX, 965.0).
-define(GRAV, 1.1).
-define(BUF, 6).
-define(TAP, 10).
-define(ROUND_TICKS, 1800).
-define(INTRO_TICKS, 80).
-define(KO_TICKS, 110).
-define(ITEM_AT, 600).
-define(JUGGLE_MAX, 5).

-define(LEFT, 1).
-define(RIGHT, 2).
-define(UP, 4).
-define(DOWN, 8).
-define(PUNCH, 16).
-define(KICK, 32).
-define(SPEC, 64).
-define(SUPER, 128).
-define(THROW, 256).

%% ---------------------------------------------------------------- 角色数值
valid_char(C) -> lists:member(C, [kai, mira, bruno, zed]).

stats(kai)   -> #{spd => 4.2, hp => 1000, pow => 1.0,  reach => 58, quick => 0,  thr => 110};
stats(mira)  -> #{spd => 5.2, hp => 900,  pow => 0.85, reach => 54, quick => -2, thr => 100};
stats(bruno) -> #{spd => 3.4, hp => 1150, pow => 1.25, reach => 60, quick => 2,  thr => 150};
stats(zed)   -> #{spd => 4.0, hp => 950,  pow => 0.95, reach => 82, quick => 1,  thr => 105};
%% 街机关底 Boss「OVERCLOCK」：只由 CPU 操控。体型大、血厚、出招带霸体；不会蹲、不会跳（下段打得到它）
stats(boss)  -> #{spd => 3.0, hp => 1450, pow => 1.1, reach => 72, quick => 2,  thr => 160}.

super_len(kai) -> 38;
super_len(mira) -> 40;
super_len(bruno) -> 34;
super_len(zed) -> 36;
super_len(boss) -> 44.

%% ---------------------------------------------------------------- 对外接口
new() ->
    #{k => 0, ph => wait, pt => 0, rd => 1, tm => ?ROUND_TICKS, w => {0, 0},
      fs => #{}, pj => [], it => none, itd => false, ev => [], res => none, to => false}.

phase(#{ph := Ph}) -> Ph.
now(#{k := K}) -> K.
fighter(#{fs := Fs}, Seat) -> maps:get(Seat, Fs, undefined).
projectiles(#{pj := Pj}) -> Pj.
item(#{it := It}) -> It.
seated(#{fs := Fs}, Seat) -> maps:is_key(Seat, Fs).

%% 比赛结束后的胜者座位（1 | 2），未结束为 none
winner(#{ph := over, w := {A, B}}) when A > B -> 1;
winner(#{ph := over}) -> 2;
winner(_) -> none.

seat(#{fs := Fs} = S, Seat, Char, Name, Cpu) when Seat =:= 1; Seat =:= 2 ->
    S#{fs := Fs#{Seat => mk(Seat, Char, Name, Cpu)}}.

unseat(#{fs := Fs} = S, Seat) ->
    (new())#{k := maps:get(k, S), fs := maps:remove(Seat, Fs)}.

start(#{fs := Fs} = S) when map_size(Fs) =:= 2 ->
    Fs1 = maps:map(fun(_, F) -> F#{en := 0.0} end, Fs),
    round_reset(S#{fs := Fs1, w := {0, 0}, rd := 1, res => none}).

rematch(S) -> start(S).

mk(Seat, Char, Name, Cpu) ->
    #{hp := Hp} = stats(Char),
    reset_fighter(#{id => Seat, c => Char, n => Name, cpu => Cpu, mhp => Hp, en => 0.0}).

reset_fighter(#{id := Seat, mhp := Hp} = F) ->
    F#{x => case Seat of 1 -> 380.0; _ -> 620.0 end, z => 0.0, vx => 0.0, vz => 0.0,
       f => case Seat of 1 -> 1; _ -> -1 end,
       s => idle, t => 0, cb => 0, hp => Hp, hs => 0, mv => none, hit => [], con => false,
       jc => 0, stun => 0, inv => 0, tinv => 0, kb => 0.0, armor => 0, hc => 0,
       m => 0, pm => 0, buf => #{}, tapd => 0, tapt => 99, dtap => 0, run => false, own => false}.

round_reset(#{fs := Fs} = S) ->
    S#{ph := intro, pt := 0, tm := ?ROUND_TICKS, pj := [], it := none, itd := false, to := false,
       fs := maps:map(fun(_, F) -> reset_fighter(F) end, Fs)}.

%% ---------------------------------------------------------------- 主循环
tick(#{ph := wait, k := K} = S, _, _) ->
    S#{k := K + 1, ev := []};
tick(#{k := K, pt := Pt, ph := Ph} = S0, M1, M2) ->
    S1 = S0#{k := K + 1, pt := Pt + 1, ev := []},
    {A1, A2} = case Ph of fight -> {M1, M2}; _ -> {0, 0} end,
    S2 = step_fighters(S1, A1, A2),
    S3 = step_projs(S2),
    S4 = separate(S3),
    S5 = case Ph of fight -> step_item(S4); _ -> S4 end,
    phase_step(S5).

ev(#{ev := Ev} = S, E) -> S#{ev := [E | Ev]}.
evs(S, L) -> lists:foldl(fun(E, A) -> ev(A, E) end, S, L).
sfx(N) -> #{k => sfx, n => N}.

%% ---------------------------------------------------------------- 阶段推进
phase_step(#{ph := intro, pt := Pt} = S) when Pt >= ?INTRO_TICKS ->
    ev(S#{ph := fight, pt := 0}, sfx(go));
phase_step(#{ph := fight, tm := Tm, fs := #{1 := F1, 2 := F2}} = S) ->
    H1 = maps:get(hp, F1), H2 = maps:get(hp, F2),
    if
        H1 =< 0, H2 =< 0 -> round_end(S, 0, false);
        H2 =< 0 -> round_end(S, 1, false);
        H1 =< 0 -> round_end(S, 2, false);
        Tm =< 1 ->
            R1 = H1 / maps:get(mhp, F1), R2 = H2 / maps:get(mhp, F2),
            round_end(S#{tm := 0}, if R1 > R2 -> 1; R2 > R1 -> 2; true -> 0 end, true);
        true -> S#{tm := Tm - 1}
    end;
phase_step(#{ph := ko, pt := Pt, res := Res, fs := Fs} = S) when Pt =:= 45 ->
    %% 胜者摆出胜利姿势（要等他落地并回到待机）
    case Res of
        0 -> S;
        W ->
            F = maps:get(W, Fs),
            case neutral_state(maps:get(s, F)) of
                true -> S#{fs := Fs#{W := F#{s := win, t := 0, vx := 0.0}}};
                false -> S#{pt := Pt - 1}
            end
    end;
phase_step(#{ph := ko, pt := Pt, w := {W1, W2}, rd := Rd} = S) when Pt >= ?KO_TICKS ->
    case W1 >= 2 orelse W2 >= 2 of
        true -> ev(S#{ph := over, pt := 0}, sfx(victory));
        false -> round_reset(S#{rd := Rd + 1})
    end;
phase_step(S) -> S.

round_end(#{w := {W1, W2}} = S, Res, TimeOut) ->
    W = case Res of 1 -> {W1 + 1, W2}; 2 -> {W1, W2 + 1}; _ -> {W1, W2} end,
    ev(S#{ph := ko, pt := 0, res := Res, w := W, to := TimeOut, pj := []},
       sfx(case TimeOut of true -> gameover; false -> ko end)).

neutral_state(St) -> lists:member(St, [idle, walk, run, crouch, block]).

%% ---------------------------------------------------------------- 角色推进
step_fighters(#{fs := #{1 := F1, 2 := F2}, pj := Pj} = S, M1, M2) ->
    Own = fun(Id) -> lists:any(fun(#{o := O}) -> O =:= Id end, Pj) end,
    A = input(F1#{own := Own(1)}, M1),
    B = input(F2#{own := Own(2)}, M2),
    {A0, EvA} = fstep(A, B, S),
    {B0, EvB} = fstep(B, A, S),
    %% 必杀发动：双方定格 14 tick（特写时间）
    Flash = lists:any(fun(#{k := fx, n := super}) -> true; (_) -> false end, EvA ++ EvB),
    {A1, B1} = case Flash of
                   true -> {A0#{hs := 14}, B0#{hs := 14}};
                   false -> {A0, B0}
               end,
    %% 判定：双方的攻击框都用本 tick 推进后的状态计算，可以相杀
    BoxA = box(A1), BoxB = box(B1),
    HitA = BoxA =/= none andalso touches(A1, BoxA, B1),
    HitB = BoxB =/= none andalso touches(B1, BoxB, A1),
    {A2, B2, Ev1} = case HitA of
                        true -> apply_hit(A1, B1, BoxA);
                        false -> {A1, B1, []}
                    end,
    {B3, A3, Ev2} = case HitB of
                        true -> apply_hit(B2, A2, BoxB);
                        false -> {B2, A2, []}
                    end,
    {Projs, Evs} = lists:partition(fun({proj, _}) -> true; (_) -> false end, EvA ++ EvB ++ Ev1 ++ Ev2),
    evs(S#{fs := #{1 => A3, 2 => B3}, pj := Pj ++ [P || {proj, P} <- Projs]}, Evs);
step_fighters(S, _, _) -> S.

%% 输入：记录按键沿（缓冲 ?BUF tick）与方向双击
input(#{m := Prev, buf := Buf0, tapd := TapD, tapt := TapT, f := Face} = F, M) ->
    Edge = M band (bnot Prev),
    Buf1 = maps:filter(fun(_, V) -> V > 0 end, maps:map(fun(_, V) -> V - 1 end, Buf0)),
    Buf = lists:foldl(fun(B, Acc) ->
                              case Edge band B of 0 -> Acc; _ -> Acc#{B => ?BUF} end
                      end, Buf1, [?UP, ?PUNCH, ?KICK, ?SPEC, ?SUPER, ?THROW]),
    Dir = if Edge band ?RIGHT =/= 0 -> 1; Edge band ?LEFT =/= 0 -> -1; true -> 0 end,
    {DTap, TapD1, TapT1} =
        case Dir of
            0 -> {0, TapD, TapT + 1};
            TapD when TapT =< ?TAP -> {Dir * Face, 0, 99};
            _ -> {0, Dir, 0}
        end,
    F#{pm := Prev, m := M, buf := Buf, dtap := DTap, tapd := TapD1, tapt := TapT1}.

pressed(#{buf := Buf}, B) -> maps:get(B, Buf, 0) > 0.
use(#{buf := Buf} = F, B) -> F#{buf := maps:remove(B, Buf)}.
held(#{m := M}, B) -> M band B =/= 0.
dirx(#{m := M}) ->
    if M band ?RIGHT =/= 0 -> 1; M band ?LEFT =/= 0 -> -1; true -> 0 end.
fwd(#{f := Face} = F) -> dirx(F) * Face.

dec(V) when V > 0 -> V - 1;
dec(_) -> 0.

fstep(#{hs := Hs} = F, _O, _S) when Hs > 0 ->
    {F#{hs := Hs - 1}, []};
fstep(#{t := T, inv := Inv, tinv := TInv, s := St} = F, O, S) ->
    st(St, F#{t := T + 1, inv := dec(Inv), tinv := dec(TInv)}, O, S).

set(#{s := St} = F, St) -> F;
set(F, St) -> F#{s := St, t := 0}.

to_idle(F) ->
    F#{s := idle, t := 0, mv := none, cb := 0, hit := [], con := false, vx := 0.0, vz := 0.0,
       z := 0.0, armor := 0, kb := 0.0, stun := 0, run := false}.

face(#{x := X, f := Face} = F, #{x := OX}) ->
    F#{f := if OX > X -> 1; OX < X -> -1; true -> Face end}.

%% ---- 待机 / 行走 / 疾跑 / 下蹲 / 防御姿势
st(St, F, O, S) when St =:= idle; St =:= walk; St =:= run; St =:= crouch ->
    neutral(F, O, S);
st(block, #{stun := Stun, x := X, kb := Kb} = F, _O, _S) when Stun > 0 ->
    {F#{stun := Stun - 1, x := X + Kb, kb := Kb * 0.8, tinv := 7}, []};
st(block, F, O, S) ->
    neutral(F, O, S);
st(win, F, _O, _S) -> {F, []};
st(dead, F, _O, _S) -> {F, []};

%% ---- Boss：重拳（起手带一次霸体）
st(bpunch, #{t := T, x := X, f := Face} = F, _O, _S) ->
    F1 = case T >= 9 andalso T =< 12 of true -> F#{x := X + Face * 4.0}; false -> F end,
    F2 = case T >= 11 of true -> F1#{armor := 0}; false -> F1 end,
    finish(F2, T, 31);
%% ---- Boss：跳起踩地。落地一圈下段冲击波（要蹲防或跳起躲）
st(bstomp, #{t := T, x := X, f := Face} = F, _O, _S) ->
    if
        T < 5 -> {F, []};
        T < 19 ->
            {F#{z := 85.0 * math:sin(math:pi() * (T - 5) / 14), x := X + Face * 4.5}, []};
        T =:= 19 ->
            {F#{z := 0.0, armor := 0},
             [#{k => fx, n => slam, c => boss, x => X, y => 100, r => 130}, #{k => fx, n => quake, r => 130, x => X, y => 100},
              sfx(heavy)]};
        true -> finish(F, T, 38)
    end;
%% ---- Boss：蓄力冲撞（全程两次霸体，撞到人或冲完才停）
st(charge, #{t := T, x := X, f := Face, vx := Vx} = F, _O, _S) ->
    if
        T < 12 -> {F, []};
        T =:= 12 -> {F#{vx := 11.0, x := X + Face * 11.0}, [sfx(dash)]};
        T =< 34 -> {F#{x := X + Face * Vx}, []};
        T =:= 35 -> {F#{vx := 0.0, armor := 0}, []};
        true -> finish(F, T, 46)
    end;

st(bstep, #{t := T, x := X, f := Face} = F, _O, _S) ->
    V = 9.5 * math:pow(0.84, T),
    Z = 9.0 * math:sin(math:pi() * min(T, 10) / 10),
    case T >= 12 of
        true -> {to_idle(F), []};
        false -> {F#{x := X - Face * V, z := Z}, []}
    end;

%% ---- 跳跃 / 空中攻击 / 落地
st(jump, #{t := T, z := Z} = F0, _O, _S) ->
    case T >= 3 andalso Z > 12 of
        true ->
            case {pressed(F0, ?KICK), pressed(F0, ?PUNCH)} of
                {true, _} -> start_slam(use(F0, ?KICK), air);
                {_, true} ->
                    F = air_move(use(F0, ?PUNCH)),
                    {F#{s := jattack, t := 0, hit := [], con := false, mv := jp}, [sfx(swing)]};
                _ -> land_check(air_move(F0), 0)
            end;
        false -> land_check(air_move(F0), 0)
    end;
st(jattack, F, _O, _S) ->
    land_check(air_move(F), 2);
st(land, #{t := T, stun := Stun} = F, _O, _S) ->
    case T >= 4 + Stun of
        true -> {to_idle(F), []};
        false -> {F, []}
    end;

%% ---- 轻拳三连
st(attack, #{t := T, cb := Cb, c := C, x := X, f := Face, con := Con} = F, _O, _S) ->
    #{quick := Q} = stats(C),
    Len = case Cb of 3 -> 15; _ -> 9 end + Q,
    A1 = case Cb of 3 -> 7; _ -> 4 end,
    F1 = case T =< 3 of true -> F#{x := X + Face * 2.2}; false -> F end,
    Next = T > A1 andalso Cb < 3 andalso pressed(F1, ?PUNCH),
    if
        Next ->
            {(use(F1, ?PUNCH))#{cb := Cb + 1, t := 0, hit := [], con := false}, [sfx(swing)]};
        T > A1, Con ->
            Allowed = case Cb of 3 -> [super]; _ -> [super, special, kick] end,
            case actions(F1, Allowed) of
                none -> finish(F1, T, Len);
                R -> R
            end;
        true -> finish(F1, T, Len)
    end;
st(cjab, #{t := T, con := Con} = F, _O, _S) ->
    case T > 3 andalso Con of
        true ->
            case actions(F, [super, special, kick]) of
                none -> finish_crouch(F, T, 8);
                R -> R
            end;
        false -> finish_crouch(F, T, 8)
    end;
st(sweep, #{t := T} = F, _O, _S) ->
    finish_crouch(F, T, 20);

%% ---- 重击（挑空）与凯的炎勾拳（dp）共用 launch 动作
st(launch, #{mv := dp, t := T, x := X, z := Z, vz := Vz, f := Face} = F, _O, _S) ->
    if
        T < 3 -> {F, []};
        T =< 13 ->
            {F#{z := 62.0 * math:sin(math:pi() / 2 * (T - 3) / 10), x := X + Face * 2.4, vz := 0.0}, []};
        true ->
            Vz1 = Vz - ?GRAV, Z1 = Z + Vz1,
            case Z1 =< 0 of
                true -> {F#{s := land, t := 0, z := 0.0, vz := 0.0, vx := 0.0, stun := 9, mv := none}, [sfx(land)]};
                false -> {F#{z := Z1, vz := Vz1}, []}
            end
    end;
st(launch, #{mv := zsp2, t := T, x := X, f := Face, con := Con} = F, _O, _S) ->
    %% 泽德「挑天棍」：踏步小跳，长棍从脚下抡过头顶；命中后可用必杀取消
    Z = if T < 3 -> 0.0; T =< 15 -> 30.0 * math:sin(math:pi() * (T - 3) / 12); true -> 0.0 end,
    F1 = F#{z := Z, x := X + case T >= 2 andalso T =< 7 of true -> Face * 2.0; false -> 0.0 end},
    case T >= 10 andalso Con of
        true ->
            case actions(F1, [super]) of
                none -> zsp2_end(F1, T);
                R -> R
            end;
        false -> zsp2_end(F1, T)
    end;
st(launch, #{t := T, con := Con} = F, _O, _S) ->
    case T >= 7 andalso Con of
        true ->
            case pressed(F, ?UP) of
                true -> start_jump((use(F, ?UP))#{run := false});
                false ->
                    case actions(F, [super, special]) of
                        none -> finish(F, T, 22);
                        R -> R
                    end
            end;
        false -> finish(F, T, 22)
    end;

%% ---- 突进类（dash / runatk 两套动作，参数见 rush/2）
st(St, #{t := T, mv := Mv, c := C, x := X, f := Face, vx := Vx} = F, _O, _S) when St =:= dash; St =:= runatk ->
    #{len := Len, decay := Decay, a1 := A1} = rush(C, Mv),
    F1 = F#{x := X + Face * Vx, vx := Vx * Decay},
    F2 = case T > A1 of true -> F1#{armor := 0}; false -> F1 end,
    finish(F2, T, Len);

%% ---- 发波
st(cast, #{t := T, mv := Mv, c := C, x := X, f := Face, id := Id} = F, _O, _S) ->
    #{len := Len, at := At} = cast(C),
    case T =:= At andalso Mv =:= sp5 of
        true ->
            P0 = proj(C),
            P = P0#{o => Id, c => C, x => X + Face * 44.0, vx => Face * maps:get(v, P0), id => {pj, Id, T}},
            {F, [{proj, P}, sfx(dash)]};
        false -> finish(F, T, Len)
    end;

%% ---- 坠击（空中 K，以及米拉 / 布鲁诺 / 泽德的 下+技）
st(slam, #{x := X, z := Z, vx := Vx, vz := Vz, c := C, mv := Mv} = F, _O, _S) ->
    Vz1 = case Vz > 0 of true -> Vz - 1.9; false -> max(-19.0, Vz - 3.2) end,
    Z1 = Z + Vz1,
    case Z1 =< 0 of
        true ->
            {F#{s := slamland, t := 0, z := 0.0, vz := 0.0, vx := 0.0, x := X + Vx, hit := [], con := false},
             [#{k => fx, n => slam, c => C, x => X + Vx, y => 100, r => slam_ring(C, Mv)}, sfx(heavy)]};
        false ->
            {F#{x := X + Vx, z := Z1, vz := Vz1}, []}
    end;
st(slamland, #{t := T, c := C, mv := Mv} = F, _O, _S) ->
    finish(F, T, case {C, Mv} of {bruno, sp2} -> 20; {_, sp2} -> 17; _ -> 15 end);

%% ---- 必杀
st(special, #{t := T, c := C} = F, _O, _S) ->
    {F1, Ev} = super_step(C, T, F),
    case T >= super_len(C) of
        true -> {to_idle(F1), Ev};
        false -> {F1, Ev}
    end;

%% ---- 投
st(grab, #{t := T} = F, _O, _S) ->
    finish(F, T, 20);
st(throw, #{t := T, x := X, f := Face, c := C} = F, #{s := OS}, _S) ->
    Rel = release_at(C),
    if
        T < Rel, OS =/= grabbed ->
            %% 被拆投：双方弹开
            {(to_idle(F))#{s := hurt, stun := 12, kb := -Face * 6.0, x := X}, []};
        T >= Rel + 10 -> {to_idle(F), []};
        true -> {F, []}
    end;
st(grabbed, #{t := T} = F, #{s := OS, x := OX, f := OF} = O, _S) ->
    Tech = T =< 6 andalso pressed(F, ?THROW),
    if
        Tech ->
            {(to_idle(use(F, ?THROW)))#{s := hurt, stun := 10, kb := OF * 6.0},
             [#{k => block, x => OX + OF * 18, z => 55, tech => 1}, sfx(block)]};
        OS =/= throw, T > 1 -> {to_idle(F), []};
        true -> {F#{x := OX + OF * 34.0 * (1 - lift_k(O)), z := 78.0 * lift_k(O)}, []}
    end;

%% ---- 受击 / 浮空 / 倒地 / 起身
st(hurt, #{stun := Stun, x := X, kb := Kb} = F, _O, _S) ->
    case Stun =< 0 of
        true -> {(to_idle(F))#{tinv := 7, jc := 0}, []};
        false -> {F#{stun := Stun - 1, x := X + Kb, kb := Kb * 0.8}, []}
    end;
st(St, #{x := X, z := Z, vx := Vx, vz := Vz, hp := Hp} = F, _O, _S) when St =:= air; St =:= knockdown ->
    Vz1 = Vz - 0.95, Z1 = Z + Vz1,
    case Z1 =< 0 of
        true ->
            Next = case Hp =< 0 of true -> dead; false -> down end,
            {F#{s := Next, t := 0, z := 0.0, vz := 0.0, vx := 0.0, x := X + Vx, mv := St},
             [sfx(land), #{k => dust, x => X + Vx}]};
        false -> {F#{x := X + Vx, z := Z1, vz := Vz1}, []}
    end;
st(down, #{t := T, mv := From} = F, _O, _S) ->
    case T >= (case From of air -> 12; _ -> 18 end) of
        true -> {F#{s := getup, t := 0, jc := 0, mv := none}, []};
        false -> {F, []}
    end;
st(getup, #{t := T} = F, _O, _S) ->
    case T >= 14 of
        true -> {(to_idle(F))#{tinv := 9, jc := 0}, []};
        false -> {F, []}
    end.

zsp2_end(F, T) when T >= 28 -> {to_idle(F), []};
zsp2_end(#{t := 16} = F, _) -> {F#{z := 0.0}, [sfx(land)]};
zsp2_end(F, _) -> {F, []}.

finish(F, T, Len) when T >= Len -> {to_idle(F), []};
finish(F, _, _) -> {F, []}.

%% 布鲁诺的投：抓住后 2..9 tick 把对手举过头顶（0 → 1）
lift_k(#{c := bruno, s := throw, t := T}) -> min(1.0, max(0.0, (T - 1) / 8));
lift_k(_) -> 0.0.

release_at(bruno) -> 11;
release_at(_) -> 8.

finish_crouch(F, T, Len) when T >= Len ->
    F1 = to_idle(F),
    case held(F1, ?DOWN) of
        true -> {F1#{s := crouch}, []};
        false -> {F1, []}
    end;
finish_crouch(F, _, _) -> {F, []}.

air_move(#{x := X, z := Z, vx := Vx, vz := Vz} = F) ->
    Vz1 = Vz - ?GRAV,
    F#{x := X + Vx, z := Z + Vz1, vz := Vz1}.

land_check(#{z := Z} = F, Extra) when Z =< 0 ->
    {F#{s := land, t := 0, z := 0.0, vz := 0.0, vx := 0.0, stun := Extra, mv := none, hit := [], con := false},
     [sfx(land)]};
land_check(F, _) -> {F, []}.

%% ---------------------------------------------------------------- 中立状态下的行动
neutral(F0, O, S) ->
    F1 = (face(F0, O))#{cb := 0, mv := none, hit := [], con := false, armor := 0, kb := 0.0, stun := 0, z := 0.0},
    case actions(F1, [super, throw, special, kick, punch]) of
        none -> move(F1, O, S);
        R -> R
    end.

move(#{c := boss, x := X, f := Face} = F, O, S) ->
    #{spd := Spd} = stats(boss),
    Fw = fwd(F),
    case Fw < 0 andalso threat(F, O, S) of
        true -> {(set(F, block))#{run := false}, []};
        false when Fw > 0 -> {(set(F, walk))#{x := X + Face * Spd, run := false}, []};
        false when Fw < 0 -> {(set(F, walk))#{x := X - Face * Spd * 0.8, run := false}, []};
        false -> {(set(F, idle))#{run := false}, []}
    end;
move(#{c := C, x := X, f := Face, dtap := DTap, run := Run0} = F, O, S) ->
    #{spd := Spd} = stats(C),
    Fw = fwd(F),
    Down = held(F, ?DOWN),
    Threat = Fw < 0 andalso threat(F, O, S),
    Run = Fw > 0 andalso (Run0 orelse DTap > 0),
    if
        Down, Threat -> {(set(F, block))#{run := false}, []};
        Down -> {(set(F, crouch))#{run := false}, []};
        Threat -> {(set(F, block))#{run := false}, []};
        true ->
            case pressed(F, ?UP) of
                true -> start_jump(use(F, ?UP));
                false ->
                    if
                        DTap < 0, Fw < 0 -> {F#{s := bstep, t := 0, run := false}, [sfx(dash)]};
                        Run -> {(set(F, run))#{x := X + Face * Spd * 1.9, run := true}, []};
                        Fw > 0 -> {(set(F, walk))#{x := X + Face * Spd, run := false}, []};
                        Fw < 0 -> {(set(F, walk))#{x := X - Face * Spd * 0.8, run := false}, []};
                        true -> {(set(F, idle))#{run := false}, []}
                    end
            end
    end.

%% 对手正在出招且够得着，或有飞行道具飞来：按住后会摆出防御姿势
threat(#{x := X, id := Id}, #{x := OX, s := OS}, #{pj := Pj}) ->
    Atk = lists:member(OS, [attack, cjab, sweep, launch, dash, runatk, jattack, slam, special, cast,
                            bpunch, bstomp, charge]),
    (Atk andalso abs(OX - X) < 190)
        orelse lists:any(fun(#{o := Own, x := PX, vx := PVx}) ->
                                 Own =/= Id andalso abs(PX - X) < 210 andalso (X - PX) * PVx > 0
                         end, Pj).

start_jump(#{c := C, f := Face, run := Run} = F) ->
    #{spd := Spd} = stats(C),
    Fw = fwd(F),
    Mul = if Run, Fw > 0 -> 1.7; Fw < 0 -> 0.85; true -> 1.0 end,
    {F#{s := jump, t := 0, vz := 13.0, vx := Fw * Face * Spd * Mul, z := 0.0, run := false,
        hit := [], con := false, mv := none, cb := 0}, [sfx(jump)]}.

%% 按优先级尝试出招：必杀 > 投 > 技 > 踢 > 拳
actions(_F, []) -> none;
actions(F, [super | T]) ->
    case pressed(F, ?SUPER) andalso maps:get(en, F) >= 100 of
        true -> start_super(use(F, ?SUPER));
        false -> actions(F, T)
    end;
actions(F, [throw | T]) ->
    case pressed(F, ?THROW) of
        true ->
            {(use(F, ?THROW))#{s := grab, t := 0, mv := case fwd(F) < 0 of true -> back; false -> front end,
                               hit := [], con := false, run := false}, [sfx(swing)]};
        false -> actions(F, T)
    end;
actions(#{c := boss} = F, [punch | T]) ->
    case pressed(F, ?PUNCH) of
        true -> {(begin_move(use(F, ?PUNCH), bpunch, p5))#{armor := 1}, [sfx(swing)]};
        false -> actions(F, T)
    end;
actions(#{c := boss} = F, [kick | T]) ->
    case pressed(F, ?KICK) of
        true -> boss_stomp(use(F, ?KICK));
        false -> actions(F, T)
    end;
actions(#{c := boss} = F, [special | T]) ->
    case pressed(F, ?SPEC) of
        true ->
            F1 = use(F, ?SPEC),
            Fw = fwd(F1),
            if
                Fw > 0 -> {(begin_move(F1, charge, sp6))#{armor := 2}, [sfx(special)]};
                true ->
                    case held(F1, ?DOWN) orelse maps:get(own, F1) of
                        true -> boss_stomp(F1);
                        false -> {begin_move(F1, cast, sp5), [sfx(special)]}
                    end
            end;
        false -> actions(F, T)
    end;
actions(F, [special | T]) ->
    case pressed(F, ?SPEC) of
        true ->
            F1 = use(F, ?SPEC),
            Down = held(F1, ?DOWN), Fw = fwd(F1),
            if
                Down -> start_sp2(F1);
                Fw > 0 -> start_rush(F1, sp6);
                true ->
                    case maps:get(own, F1) of
                        true -> actions(F1, T);
                        false -> {begin_move(F1, cast, sp5), [sfx(special)]}
                    end
            end;
        false -> actions(F, T)
    end;
actions(F, [kick | T]) ->
    case pressed(F, ?KICK) of
        true ->
            F1 = use(F, ?KICK),
            case held(F1, ?DOWN) of
                true -> {begin_move(F1, sweep, k2), [sfx(swing)]};
                false -> {begin_move(F1, launch, k5), [sfx(swing), #{k => fx, n => launch, c => maps:get(c, F1),
                                                                    x => maps:get(x, F1), y => 100, f => maps:get(f, F1)}]}
            end;
        false -> actions(F, T)
    end;
actions(F, [punch | T]) ->
    case pressed(F, ?PUNCH) of
        true ->
            F1 = use(F, ?PUNCH),
            Down = held(F1, ?DOWN),
            if
                Down -> {begin_move(F1, cjab, p2), [sfx(swing)]};
                true ->
                    case maps:get(run, F1) of
                        true -> start_rush(F1, prun);
                        false -> {(begin_move(F1, attack, p5))#{cb := 1}, [sfx(swing)]}
                    end
            end;
        false -> actions(F, T)
    end.

boss_stomp(F) ->
    {(begin_move(F, bstomp, k5))#{armor := 1}, [sfx(jump)]}.

begin_move(F, St, Mv) ->
    F#{s := St, t := 0, mv := Mv, hit := [], con := false, run := false, vx := 0.0, kb := 0.0, cb := 0, armor := 0}.

start_sp2(#{c := kai} = F) ->
    {(begin_move(F, launch, dp))#{inv := 8}, [sfx(special), #{k => fx, n => launch, c => kai, x => maps:get(x, F),
                                                             y => 100, f => maps:get(f, F)}]};
start_sp2(#{c := zed} = F) ->
    {(begin_move(F, launch, zsp2))#{inv := 6}, [sfx(special), #{k => fx, n => launch, c => zed, x => maps:get(x, F),
                                                               y => 100, f => maps:get(f, F), m => zsp2}]};
start_sp2(F) ->
    start_slam(F, sp2).

start_slam(#{c := C, f := Face} = F, Kind) ->
    {Vx, Vz} = case {Kind, C} of
                   {air, _} -> {Face * 4.0, 2.0};
                   {sp2, mira} -> {Face * 8.5, 9.5};
                   {sp2, bruno} -> {Face * 3.0, 10.5};
                   {sp2, _} -> {Face * 5.5, 9.5}
               end,
    F1 = begin_move(F, slam, Kind),
    {F1#{vx := Vx, vz := Vz}, [sfx(jump)]}.

start_rush(#{c := C} = F, Mv) ->
    #{st := St, v0 := V0, armor := Armor} = rush(C, Mv),
    F1 = begin_move(F, St, Mv),
    {F1#{vx := V0, armor := Armor}, [sfx(dash)]}.

start_super(#{c := C, x := X, id := Id} = F) ->
    F1 = begin_move(F, special, super),
    {F1#{en := 0.0, inv := 9},
     [#{k => fx, n => super, c => C, i => Id, x => X, y => 100}, sfx(special)]}.

%% 突进技参数。st：用哪套动作；len 总长；a0..a1 判定；v0 初速与每 tick 衰减
rush(kai, sp6)   -> #{st => dash,   len => 18, a0 => 2, a1 => 9,  v0 => 12.0, decay => 0.88, dmg => 95,  lvl => mid, armor => 0, range => 16};
rush(kai, prun)  -> #{st => runatk, len => 18, a0 => 3, a1 => 11, v0 => 8.0,  decay => 0.93, dmg => 80,  lvl => mid, armor => 0, range => 4};
rush(mira, sp6)  -> #{st => runatk, len => 20, a0 => 3, a1 => 11, v0 => 11.0, decay => 0.92, dmg => 75,  lvl => low, armor => 0, range => 14};
rush(bruno, sp6) -> #{st => runatk, len => 22, a0 => 4, a1 => 12, v0 => 9.0,  decay => 0.93, dmg => 110, lvl => mid, armor => 1, range => 6};
rush(zed, sp6)   -> #{st => runatk, len => 20, a0 => 3, a1 => 11, v0 => 12.0, decay => 0.92, dmg => 85,  lvl => mid, armor => 0, range => 34};
rush(C, prun) ->
    #{spd := Spd} = stats(C),
    #{st => dash, len => 16, a0 => 2, a1 => 9, v0 => Spd * 1.9, decay => 0.9, dmg => 70, lvl => mid, armor => 0, range => 10}.

%% 发波：len 总长，at 出手 tick
cast(kai) -> #{len => 24, at => 8};
cast(mira) -> #{len => 19, at => 6};
cast(bruno) -> #{len => 28, at => 10};
cast(zed) -> #{len => 22, at => 7};
cast(boss) -> #{len => 30, at => 13}.

%% 飞行道具：v 速度，z0..z1 高度范围，life 存活 tick
proj(kai)   -> #{v => 9.0,  z0 => 38, z1 => 78, life => 95,  dmg => 70};
proj(mira)  -> #{v => 13.0, z0 => 36, z1 => 72, life => 60,  dmg => 45};
proj(bruno) -> #{v => 6.5,  z0 => 0,  z1 => 34, life => 115, dmg => 95};
proj(zed)   -> #{v => 16.0, z0 => 44, z1 => 68, life => 22,  dmg => 60};
proj(boss)  -> #{v => 10.5, z0 => 40, z1 => 80, life => 90,  dmg => 80}.   %% 旋转扳手

slam_ring(bruno, sp2) -> 120;
slam_ring(_, _) -> 48.

%% ---------------------------------------------------------------- 必杀（时间轴与旧版动画一致）
super_step(kai, T, #{x := X, f := Face} = F) ->
    Z = if T =< 6 -> 0.0;
           T =< 26 -> 75.0 * math:sin(math:pi() / 2 * (T - 6) / 20);
           true -> max(0.0, 75.0 * (1 - (T - 26) / 10))
        end,
    Vx = case T >= 7 andalso T =< 20 of true -> Face * 1.6; false -> 0.0 end,
    {F#{z := Z, x := X + Vx}, case T of 26 -> [sfx(heavy)]; _ -> [] end};
super_step(mira, T, #{x := X, f := Face} = F) ->
    Z = if T =< 5 -> 22.0 * T / 5;
           T =< 32 -> 22.0;
           true -> max(0.0, 22.0 * (1 - (T - 32) / 6))
        end,
    Vx = case T >= 6 andalso T =< 32 of
             true -> Face * 5.7 + dirx(F) * 2.6;
             false -> 0.0
         end,
    {F#{z := Z, x := X + Vx}, []};
super_step(bruno, T, #{x := X} = F) ->
    Z = if T =< 11 -> 60.0 * math:sin(math:pi() / 2 * T / 11);
           T =< 14 -> 60.0 * (1 - (T - 11) / 3);
           true -> 0.0
        end,
    Ev = case T of
             14 -> [#{k => fx, n => quake, r => 220, x => X, y => 100}, sfx(heavy)];
             20 -> [#{k => fx, n => quake, r => 380, x => X, y => 100}];
             _ -> []
         end,
    {F#{z := Z}, Ev};
super_step(boss, T, #{x := X, f := Face} = F) ->
    %% 「超频连锤」：眼睛转红，边逼近边连打，最后一记上冲重拳
    Vx = if T >= 6, T < 32 -> Face * 1.6; T >= 33, T =< 36 -> Face * 5.0; true -> 0.0 end,
    {F#{x := X + Vx, z := 0.0}, case T of 34 -> [sfx(heavy)]; _ -> [] end};
super_step(zed, T, #{x := X, f := Face} = F) ->
    Vx = case T >= 22 andalso T =< 28 of true -> Face * 14.0; false -> 0.0 end,
    {F#{x := X + Vx, z := 0.0}, []}.

%% ---------------------------------------------------------------- 攻击框
%% box(F) -> none | #{id, x0, x1（面朝方向的前后范围）, z0, z1（相对自身 z）, dmg, lvl, kind, hst, bst, push, chip, heavy}
%%   lvl：mid 站蹲都能防 / over 中段（必须站防）/ low 下段（必须蹲防）/ throw 投
%%   kind：hit 普通硬直 / launch 挑空 / kd 击倒 / trip 扫倒 / bounce 砸地反弹 / lift 必杀托举 / grab / release
box(#{hs := Hs}) when Hs > 0 -> none;
box(#{s := attack, cb := Cb, t := T, c := C}) ->
    #{reach := R, pow := P} = stats(C),
    case Cb of
        3 when T >= 4, T =< 7 -> bx({atk, 3}, -10, R + 14, 20, 100, 80 * P, mid, kd, 0, 12, 7, false, true);
        2 when T >= 3, T =< 4 -> bx({atk, 2}, -10, R + 6, 30, 95, 50 * P, mid, hit, 13, 9, 4, false, false);
        1 when T >= 3, T =< 4 -> bx({atk, 1}, -10, R, 30, 95, 40 * P, mid, hit, 12, 8, 4, false, false);
        _ -> none
    end;
box(#{s := cjab, t := T, c := C}) when T >= 2, T =< 3 ->
    #{reach := R, pow := P} = stats(C),
    bx(cjab, -10, R - 4, 10, 60, 30 * P, mid, hit, 10, 7, 3, false, false);
box(#{s := sweep, t := T, c := C}) when T >= 5, T =< 7 ->
    #{reach := R, pow := P} = stats(C),
    bx(sweep, -10, R + 14, 0, 28, 70 * P, low, trip, 0, 10, 6, false, true);
box(#{s := launch, mv := dp, t := T, c := C}) when T >= 3, T =< 9 ->
    #{pow := P} = stats(C),
    bx(dp, -14, 52, 0, 125, 120 * P, mid, kd, 0, 12, 4, true, true);
box(#{s := launch, mv := zsp2, t := T, c := C}) when T >= 3, T =< 9 ->
    #{reach := R, pow := P} = stats(C),
    %% 抡起的长棍画出一道大弧：身前到头顶都有判定，专打跳进来的对手
    bx(zsp2, -24, R + 18, 0, 215, 105 * P, mid, launch, 0, 12, 5, true, true);
box(#{s := launch, mv := k5, t := T, c := C}) when T >= 3, T =< 6 ->
    #{reach := R, pow := P} = stats(C),
    bx(k5, -10, R + 4, 20, 140, 90 * P, mid, launch, 0, 9, 6, false, true);
box(#{s := jattack, t := T, c := C}) when T >= 2 ->
    #{reach := R, pow := P} = stats(C),
    bx(jp, -10, R + 6, -18, 48, 60 * P, over, hit, 14, 10, 4, false, false);
box(#{s := slam, vz := Vz, c := C, mv := Mv}) when Vz < 0 ->
    #{reach := R, pow := P} = stats(C),
    {Dmg, Ext} = case {C, Mv} of
                     {_, air} -> {70, 0};
                     {mira, _} -> {85, 4};
                     {bruno, _} -> {60, 0};
                     {_, _} -> {90, 26}
                 end,
    bx(slam, -14, R - 6 + Ext, -24, 60, Dmg * P, over, bounce, 0, 11, 5, Mv =:= sp2, true);
box(#{s := slamland, t := 1, c := C, mv := Mv}) ->
    #{pow := P} = stats(C),
    R = slam_ring(C, Mv),
    case {C, Mv} of
        {bruno, sp2} -> bx(ring, -R, R, 0, 22, 100 * P, low, trip, 0, 12, 8, true, true);
        _ -> bx(ring, -R, R, 0, 22, 30 * P, mid, hit, 12, 9, 6, false, false)
    end;
box(#{s := St, t := T, mv := Mv, c := C}) when St =:= dash; St =:= runatk ->
    #{a0 := A0, a1 := A1, dmg := Dmg, lvl := Lvl, range := Rg} = rush(C, Mv),
    #{reach := R, pow := P} = stats(C),
    case T >= A0 andalso T =< A1 of
        true ->
            {Z0, Z1, Kind} = case Lvl of low -> {0, 30, trip}; _ -> {15, 95, kd} end,
            bx(rush, -10, R + Rg, Z0, Z1, Dmg * P, Lvl, Kind, 0, 11, 7, Mv =:= sp6, true);
        false -> none
    end;
box(#{s := bpunch, t := T, c := C}) when T >= 10, T =< 12 ->
    #{reach := R, pow := P} = stats(C),
    bx(bpunch, -10, R + 26, 30, 125, 85 * P, mid, kd, 0, 14, 9, false, true);
box(#{s := bstomp, t := T, c := C}) when T >= 19, T =< 20 ->
    #{pow := P} = stats(C),
    bx(stomp, -130, 130, 0, 26, 70 * P, low, trip, 0, 13, 9, true, true);
box(#{s := charge, t := T, vx := Vx, c := C}) when T >= 12, T =< 34, Vx > 0 ->
    #{reach := R, pow := P} = stats(C),
    bx(charge, -10, R + 18, 10, 140, 115 * P, mid, kd, 0, 14, 10, true, true);
box(#{s := grab, t := 4, c := C}) ->
    #{id => grab, x0 => 0, x1 => case C of bruno -> 70; boss -> 84; _ -> 62 end, z0 => 0, z1 => 90, dmg => 0, lvl => throw,
      kind => grab, hst => 0, bst => 0, push => 0, chip => false, heavy => false, sup => false};
box(#{s := throw, t := T, c := C, x := X, f := Face, mv := Mv}) when T =:= 8, C =/= bruno; T =:= 11, C =:= bruno ->
    #{thr := Dmg} = stats(C),
    #{id => release, x0 => -200, x1 => 200, z0 => -50, z1 => 200, dmg => Dmg, lvl => throw, kind => release,
      hst => 0, bst => 0, push => 0, chip => false, heavy => true, sup => false,
      dir => case Mv of back -> -Face; _ -> Face end, ox => X, slam => C =:= bruno};
box(#{s := special, c := C, t := T}) ->
    #{reach := R, pow := P} = stats(C),
    super_box(C, T, R, P);
box(_) -> none.

bx(Id, X0, X1, Z0, Z1, Dmg, Lvl, Kind, Hst, Bst, Push, Chip, Heavy) ->
    #{id => Id, x0 => X0, x1 => X1, z0 => Z0, z1 => Z1, dmg => Dmg, lvl => Lvl, kind => Kind,
      hst => Hst, bst => Bst, push => Push, chip => Chip, heavy => Heavy, sup => false}.

sbx(B) -> B#{sup := true}.

super_box(kai, T, R, P) when T >= 7, T < 26 ->
    sbx(bx({sup, (T - 7) div 4}, -(R + 6), R + 18, -20, 115, 34 * P, mid, lift, 10, 9, 0, true, false));
super_box(kai, 26, R, P) ->
    sbx(bx({sup, fin}, -(R + 10), R + 30, -30, 125, 170 * P, mid, kd, 0, 12, 6, true, true));
super_box(mira, T, R, P) when T >= 6, T < 31 ->
    sbx(bx({sup, (T - 6) div 5}, -(R + 10), R + 16, -10, 85, 30 * P, mid, drag, 10, 9, 0, true, false));
super_box(mira, 31, R, P) ->
    sbx(bx({sup, fin}, -(R + 14), R + 24, -10, 95, 170 * P, mid, kd, 0, 12, 6, true, true));
super_box(bruno, 14, _R, P) ->
    sbx(bx({sup, 1}, -220, 220, 0, 24, 230 * P, mid, kd, 0, 14, 9, true, true));
super_box(bruno, 20, _R, P) ->
    sbx(bx({sup, 2}, -380, 380, 0, 24, 120 * P, mid, kd, 0, 14, 9, true, true));
super_box(zed, T, R, P) when T >= 3, T =< 20 ->
    sbx(bx({sup, (T - 3) div 4}, -(R + 4), R + 10, 0, 115, 28 * P, mid, hit, 10, 9, 1, true, false));
super_box(zed, T, R, P) when T > 22, T =< 28 ->
    sbx(bx({sup, fin}, -10, R + 70, 20, 90, 170 * P, mid, kd, 0, 13, 7, true, true));
super_box(boss, T, R, P) when T >= 6, T < 32 ->
    sbx(bx({sup, (T - 6) div 4}, -(R + 4), R + 22, 10, 130, 26 * P, mid, drag, 10, 9, 0, true, false));
super_box(boss, 34, R, P) ->
    sbx(bx({sup, fin}, -(R + 10), R + 44, 0, 170, 175 * P, mid, kd, 0, 13, 7, true, true));
super_box(_, _, _, _) -> none.

%% ---------------------------------------------------------------- 受击框与判定
hurt_h(#{s := St, mv := Mv, c := C, a := A}) ->
    case St of
        crouch -> 60; cjab -> 60; sweep -> 55;
        block when A =:= c -> 60;
        runatk when C =:= mira, Mv =:= sp6 -> 34;
        air when C =:= boss -> 110;
        air -> 70; jump -> 80; jattack -> 80;
        _ when C =:= boss -> 140;
        _ -> 95
    end;
hurt_h(F) -> hurt_h(F#{a => none}).

hittable(#{s := St, inv := Inv}) ->
    Inv =:= 0 andalso not lists:member(St, [knockdown, down, getup, grabbed, win, dead, throw]).

grounded(#{z := Z, s := St}) ->
    Z =< 0.5 andalso not lists:member(St, [jump, jattack, slam, air, knockdown, special, bstomp]).

touches(#{hit := Hit} = A, #{id := Id} = Box, V) ->
    (not lists:member(Id, Hit)) andalso touches1(A, Box, V).

touches1(_A, #{kind := release}, #{s := grabbed}) -> true;
touches1(_A, #{kind := release}, _V) -> false;
touches1(#{x := X, f := Face}, #{kind := grab, x1 := X1}, #{x := VX, s := VS, stun := Stun, tinv := TInv} = V) ->
    D = (VX - X) * Face,
    grounded(V) andalso TInv =:= 0 andalso D >= -10 andalso D =< X1
        andalso (lists:member(VS, [idle, walk, run, crouch, land]) orelse (VS =:= block andalso Stun =:= 0));
touches1(#{x := X, z := Z, f := Face}, #{x0 := X0, x1 := X1, z0 := Z0, z1 := Z1}, #{x := VX, z := VZ} = V) ->
    {L, R} = case Face of 1 -> {X + X0, X + X1}; _ -> {X - X1, X - X0} end,
    Hw = case maps:get(c, V, none) of boss -> 30; _ -> 20 end,
    hittable(V) andalso R >= VX - Hw andalso L =< VX + Hw
        andalso Z + Z1 >= VZ andalso Z + Z0 =< VZ + hurt_h(V).

%% 是否防住：必须在地面、处于可防御状态、按着“后”，且站 / 蹲与攻击段位相符
blocks(#{m := M, x := X, s := St} = V, AttX, Lvl) ->
    Back = if AttX > X -> ?LEFT; AttX < X -> ?RIGHT; true -> case maps:get(f, V) of 1 -> ?LEFT; _ -> ?RIGHT end end,
    Crouch = M band ?DOWN =/= 0 andalso maps:get(c, V) =/= boss,
    grounded(V) andalso lists:member(St, [idle, walk, crouch, block])
        andalso (Lvl =/= low orelse Crouch)
        andalso M band Back =/= 0
        andalso case Lvl of mid -> true; over -> not Crouch; low -> Crouch; _ -> false end.

%% 返回 {攻击方, 受击方, 事件}
apply_hit(A, V, #{kind := grab}) ->
    #{x := AX, f := Face} = A,
    {A#{s := throw, t := 0, hit := []},
     (to_idle(V))#{s := grabbed, x := AX + Face * 34.0},
     [sfx(grab)]};
apply_hit(#{x := AX} = A, V, #{kind := release, dmg := Dmg, dir := Dir, id := Id} = Box) ->
    Hp = max(0, maps:get(hp, V) - Dmg),
    V1 = case maps:get(slam, Box, false) of
             true ->
                 %% 举过头顶后朝投掷方向砸下去
                 V#{hp := Hp, s := knockdown, t := 0, vz := -6.0, vx := Dir * 2.5, z := 70.0, hs := 6, jc := 0,
                    x := AX + Dir * 30.0};
             false ->
                 V#{hp := Hp, s := knockdown, t := 0, vz := 8.5, vx := Dir * 7.0, z := 12.0, hs := 5, jc := 0,
                    x := case Dir =:= maps:get(f, A) of true -> maps:get(x, V); false -> AX + Dir * 20.0 end}
         end,
    A1 = (gain(A, Dmg * 0.08))#{hit := [Id], hc := 1, hs := 5, f := Dir},
    {A1, gain(V1, Dmg * 0.05),
     case maps:get(slam, Box, false) of
         true -> [#{k => hit, x => maps:get(x, V1), z => 30, b => 1}, sfx(throw), sfx(heavy),
                  #{k => fx, n => slam, c => maps:get(c, A), x => maps:get(x, V1), y => 100, r => 60}];
         false -> [#{k => hit, x => maps:get(x, V1), z => 50, b => 1}, sfx(throw)]
     end};
apply_hit(#{x := AX, f := AF, hit := Hit} = A, V, #{id := Id, lvl := Lvl} = Box) ->
    A1 = A#{hit := [Id | Hit], con := true},
    case blocks(V, AX, Lvl) of
        true -> blocked(A1, V, Box, AX, AF);
        false -> struck(A1, V, Box, AX, AF)
    end.

gain(#{en := En} = F, N) -> F#{en := min(100.0, En + N)}.

hitpos(AF, #{x := VX, z := VZ} = V, AZ, #{z0 := Z0, z1 := Z1}) ->
    Zc = max(VZ + 10, min(VZ + hurt_h(V) - 8, AZ + (Z0 + Z1) / 2)),
    {VX - AF * 14, Zc}.

blocked(A, #{x := VX, hp := Hp, m := M} = V, #{dmg := Dmg, bst := Bst, push := Push, chip := Chip, heavy := Heavy} = Box,
        AX, AF) ->
    Dir = if VX > AX -> 1; VX < AX -> -1; true -> AF end,
    Hp1 = case Chip of true -> max(1, Hp - round(Dmg * 0.15)); false -> Hp end,
    Hs = case Heavy of true -> 4; false -> 2 end,
    {PX, PZ} = hitpos(AF, V, maps:get(z, A), Box),
    V1 = (gain(V, 3.0))#{s := block, t := 0, stun := Bst, kb := Dir * Push * 1.0, hp := Hp1, hs := Hs,
                         a => case M band ?DOWN of 0 -> s; _ -> c end, run := false},
    A1 = corner(stop_rush((gain(A, 2.0))#{hs := Hs}), V1, Dir, Push),
    {A1, V1, [#{k => block, x => PX, z => PZ}, sfx(block)]}.

struck(A, #{c := boss, z := VZ} = V, #{kind := K0, hst := H0} = Box, AX, AF)
  when (K0 =:= launch orelse K0 =:= bounce orelse K0 =:= lift), VZ =< 0.5 ->
    %% Boss 太重，挑不起来：挑空 / 砸地反弹 / 必杀托举对它只造成硬直
    struck1(A, V, Box#{kind := case K0 of lift -> drag; _ -> hit end, hst := max(H0, 14)}, AX, AF);
struck(A, V, Box, AX, AF) ->
    struck1(A, V, Box, AX, AF).

struck1(#{hc := Hc0} = A, #{x := VX, hp := Hp, jc := Jc, armor := Armor, s := VS} = V,
       #{dmg := Dmg0, kind := Kind, hst := Hst, push := Push, heavy := Heavy, sup := Sup} = Box, AX, AF) ->
    Dir = if VX > AX -> 1; VX < AX -> -1; true -> AF end,
    InCombo = lists:member(VS, [hurt, air]),
    Hc = case InCombo of true -> Hc0 + 1; false -> 1 end,
    Scale = max(case Sup of true -> 0.7; false -> 0.4 end, 1.0 - 0.12 * (Hc - 1)),
    {PX, PZ} = hitpos(AF, V, maps:get(z, A), Box),
    Hs = if Sup, not Heavy -> 2; Heavy -> 6; true -> 3 end,
    HitEv = [#{k => hit, x => PX, z => PZ, b => case Heavy of true -> 1; false -> 0 end},
             sfx(case Heavy of true -> heavy; false -> hit end)],
    case Armor > 0 andalso not Sup of
        true ->
            %% 霸体：吃下伤害但不被打断
            Dmg = round(Dmg0 * Scale * 0.7),
            Hp1 = max(1, Hp - Dmg),
            {stop_rush((gain(A, Dmg * 0.1))#{hs := Hs, hc := Hc}),
             (gain(V, Dmg * 0.06))#{hp := Hp1, armor := Armor - 1, hs := Hs}, HitEv};
        false ->
            Dmg = round(Dmg0 * Scale),
            Hp1 = max(0, Hp - Dmg),
            Air = not grounded(V),
            Dead = Hp1 =< 0,
            V0 = (gain(V, Dmg * 0.06))#{hp := Hp1, t := 0, hs := Hs, mv := none, hit := [], con := false,
                                        cb := 0, armor := 0, run := false, stun := 0, kb := 0.0},
            Capped = Jc >= ?JUGGLE_MAX andalso not Sup,
            V1 = if
                     Dead -> V0#{s := knockdown, vz := 9.0, vx := Dir * 6.0, z := max(maps:get(z, V0), 4.0)};
                     Kind =:= lift ->
                         V0#{s := air, vz := 6.2, vx := 0.0, x := VX + (AX + AF * 26 - VX) * 0.5,
                             z := max(maps:get(z, V0), 6.0)};
                     Kind =:= drag ->
                         V0#{s := hurt, stun := Hst, kb := AF * 5.2, z := 0.0, vz := 0.0};
                     Kind =:= kd; Capped ->
                         V0#{s := knockdown, vz := 7.5, vx := Dir * 6.0, z := max(maps:get(z, V0), 4.0)};
                     Kind =:= trip ->
                         V0#{s := knockdown, vz := 5.0, vx := Dir * 3.0, z := max(maps:get(z, V0), 3.0)};
                     Kind =:= launch ->
                         V0#{s := air, vz := 12.5 - Jc * 0.8, vx := Dir * 1.4, z := max(maps:get(z, V0), 4.0), jc := Jc + 1};
                     Kind =:= bounce ->
                         V0#{s := air, vz := 9.0 - Jc * 0.5, vx := Dir * 1.6, z := max(maps:get(z, V0), 4.0), jc := Jc + 1};
                     Air ->
                         V0#{s := air, vz := 7.5 - Jc * 0.5, vx := Dir * 2.2, jc := Jc + 1};
                     true ->
                         V0#{s := hurt, stun := Hst, kb := Dir * Push * 1.0, z := 0.0, vz := 0.0}
                 end,
            A1 = (gain(A, Dmg * 0.1))#{hs := Hs, hc := Hc},
            A2 = case maps:get(s, V1) of hurt -> corner(A1, V1, Dir, Push); _ -> A1 end,
            {A2, V1, HitEv ++ case Dead of true -> [#{k => ko, x => VX, z => PZ}]; false -> [] end}
    end.

stop_rush(#{s := St} = A) when St =:= dash; St =:= runatk; St =:= charge -> A#{vx := 0.0};
stop_rush(A) -> A.

%% 对手被逼在版边时，推力改由攻击方承受（把自己弹开）
corner(#{s := special} = A, _V, _Dir, _Push) -> A;
corner(#{x := AX} = A, #{x := VX}, Dir, Push) ->
    case (Dir > 0 andalso VX >= ?XMAX - 4) orelse (Dir < 0 andalso VX =< ?XMIN + 4) of
        true -> A#{x := AX - Dir * Push * 2.2};
        false -> A
    end.

%% ---------------------------------------------------------------- 飞行道具
step_projs(#{pj := []} = S) -> S;
step_projs(#{pj := Pj0, fs := Fs0} = S) ->
    Moved = [P#{x := X + Vx, life := L - 1} || #{x := X, vx := Vx, life := L} = P <- Pj0,
                                                L > 1, X + Vx > ?XMIN - 30, X + Vx < ?XMAX + 30],
    %% 两个飞行道具相撞互相抵消
    Clash = [{maps:get(id, P), (maps:get(x, P) + maps:get(x, Q)) / 2}
             || P <- Moved, Q <- Moved, maps:get(o, P) =/= maps:get(o, Q),
                abs(maps:get(x, P) - maps:get(x, Q)) < 30],
    Gone = [Id || {Id, _} <- Clash],
    ClashEv = case Clash of
                  [{_, CX} | _] -> [#{k => block, x => CX, z => 55}, sfx(block)];
                  [] -> []
              end,
    Alive = [P || P <- Moved, not lists:member(maps:get(id, P), Gone)],
    {Pj, Fs, Ev} = lists:foldl(fun proj_hit/2, {[], Fs0, ClashEv}, Alive),
    evs(S#{pj := lists:reverse(Pj), fs := Fs}, Ev).

proj_hit(#{o := O, x := X, vx := Vx, z0 := Z0, z1 := Z1, dmg := Dmg, id := Id} = P, {Acc, Fs, Ev}) ->
    VSeat = 3 - O,
    V = maps:get(VSeat, Fs),
    Dir = case Vx > 0 of true -> 1; false -> -1 end,
    Box = (bx(Id, -16, 16, Z0, Z1, Dmg, mid, hit, 14, 10, 5, true, false))#{sup := false},
    Ghost = #{x => X, z => 0.0, f => Dir, hit => []},
    case touches(Ghost, Box, V) of
        true ->
            A = maps:get(O, Fs),
            Proxy = A#{x := X - Dir * 30.0, f := Dir, z := 0.0, s := idle, hit := []},
            {A1, V1, Ev1} = apply_hit(Proxy, V, Box),
            A2 = A#{en := maps:get(en, A1), hc := maps:get(hc, A1)},
            {Acc, Fs#{O := A2, VSeat := V1}, Ev ++ Ev1};
        false ->
            {[P | Acc], Fs, Ev}
    end.

%% ---------------------------------------------------------------- 推挤、版边、道具
separate(#{fs := #{1 := A0, 2 := B0}} = S) ->
    A = clampx(A0), B = clampx(B0),
    #{x := AX, z := AZ} = A, #{x := BX, z := BZ} = B,
    Solid = fun(#{s := St}) -> not lists:member(St, [grabbed, throw, down, dead, knockdown]) end,
    D = BX - AX,
    Body = case maps:get(c, A) =:= boss orelse maps:get(c, B) =:= boss of true -> 50; false -> 36 end,
    case abs(D) < Body andalso abs(AZ - BZ) < 60 andalso Solid(A) andalso Solid(B) of
        true ->
            Sg = if D > 0 -> 1; D < 0 -> -1; true -> -maps:get(f, A) end,
            Push = (Body - abs(D)) / 2,
            A1 = clampx(A#{x := AX - Sg * Push}),
            B1 = clampx(B#{x := BX + Sg * Push}),
            %% 一方贴墙时另一方承担全部位移
            Left = (Body - abs(maps:get(x, B1) - maps:get(x, A1))),
            {A2, B2} = case Left > 0.01 of
                           true ->
                               case maps:get(x, A1) =< ?XMIN + 0.01 orelse maps:get(x, A1) >= ?XMAX - 0.01 of
                                   true -> {A1, clampx(B1#{x := maps:get(x, B1) + Sg * Left})};
                                   false -> {clampx(A1#{x := maps:get(x, A1) - Sg * Left}), B1}
                               end;
                           false -> {A1, B1}
                       end,
            S#{fs := #{1 => A2, 2 => B2}};
        false ->
            S#{fs := #{1 => A, 2 => B}}
    end;
separate(S) -> S.

clampx(#{x := X} = F) -> F#{x := max(?XMIN, min(?XMAX, X))}.

%% 霓虹核心：每局开打 20 秒后从空中落到两人中间，先碰到的人能量 +50
step_item(#{it := none, itd := false, pt := Pt, fs := #{1 := A, 2 := B}} = S) when Pt >= ?ITEM_AT ->
    X = max(120.0, min(880.0, (maps:get(x, A) + maps:get(x, B)) / 2)),
    ev(S#{it := #{x => X, z => 330.0, life => 420}, itd := true}, #{k => item, n => drop, x => X});
step_item(#{it := #{x := X, z := Z, life := L} = It, fs := Fs} = S) ->
    Z1 = max(0.0, Z - 5.5),
    Takers = [Id || {Id, #{x := FX, z := FZ, s := St}} <- maps:to_list(Fs),
                    abs(FX - X) < 34, FZ < 45, Z1 < 40,
                    not lists:member(St, [down, dead, knockdown, air, getup, grabbed])],
    case Takers of
        [_, _] -> S#{it := It#{z := Z1, life := L - 1}};   %% 同时碰到：谁也拿不到，继续争
        [Id] ->
            F = maps:get(Id, Fs),
            ev(ev(S#{it := none, fs := Fs#{Id := gain(F, 50.0)}}, #{k => item, n => take, i => Id, x => X}), sfx(ready));
        [] when L =< 1 -> S#{it := none};
        [] -> S#{it := It#{z := Z1, life := L - 1}}
    end;
step_item(S) -> S.

%% ---------------------------------------------------------------- 快照
snapshot(#{k := K, ph := Ph, pt := Pt, rd := Rd, tm := Tm, w := {W1, W2}, fs := Fs, pj := Pj, it := It,
           ev := Ev, res := Res, to := To}) ->
    #{t => s, k => K, ph => Ph, pt => Pt, rd => Rd, tm => (Tm + 29) div 30, w => [W1, W2],
      res => case Res of none -> -1; R -> R end, to => To,
      f => [fsnap(F) || {_, F} <- lists:sort(maps:to_list(Fs))],
      j => [#{c => C, x => X, z => (Z0 + Z1) / 2, vx => Vx, i => O}
            || #{c := C, x := X, z0 := Z0, z1 := Z1, vx := Vx, o := O} <- Pj],
      it => case It of none -> null; #{x := IX, z := IZ, life := IL} -> #{x => IX, z => IZ, l => IL} end,
      ev => lists:reverse(Ev)}.

fsnap(#{id := Id, c := C, n := N, cpu := Cpu, x := X, z := Z, f := Face, s := St, t := T, cb := Cb,
        hp := Hp, mhp := Mhp, en := En, hs := Hs, hc := Hc, mv := Mv} = F) ->
    A = case St of
            block -> maps:get(a, F, s);
            _ -> Mv
        end,
    #{i => Id, c => C, n => N, cpu => Cpu, x => X, y => 100, z => Z, f => Face, s => St, t => T, cb => Cb,
      h => Hp, m => Mhp, e => trunc(En), hs => Hs, hc => Hc, a => A}.
