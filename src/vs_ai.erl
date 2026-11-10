%% ==========================================================================
%% vs_ai —— CPU 对手：按距离和对手状态挑选一小段“按键计划”，逐 tick 输出输入掩码。
%%   等级 1..4 控制防御概率、对空概率和出手间隔。CPU 只能看到公开的对战状态，
%%   并且和玩家一样通过输入掩码操作角色（不作弊）。
%% ==========================================================================
-module(vs_ai).
-export([new/2, decide/3]).

-define(LEFT, 1).
-define(RIGHT, 2).
-define(UP, 4).
-define(DOWN, 8).
-define(PUNCH, 16).
-define(KICK, 32).
-define(SPEC, 64).
-define(SUPER, 128).
-define(THROW, 256).

new(Level, Seed) ->
    #{lv => max(1, min(4, Level)), rng => rand:seed_s(exsss, {Seed, Seed * 7 + 13, 4242}),
      plan => [], seen => none}.

%% -> {Mask, Ai}
decide(Ai0, Sim, Seat) ->
    Me = vs_sim:fighter(Sim, Seat),
    Opp = vs_sim:fighter(Sim, 3 - Seat),
    case vs_sim:phase(Sim) of
        fight when Me =/= undefined, Opp =/= undefined ->
            Ai1 = react(Ai0, Me, Opp, Sim),
            Ai2 = case maps:get(plan, Ai1) of
                      [] -> think(Ai1, Me, Opp, Sim);
                      _ -> Ai1
                  end,
            pop(Ai2, Me, Opp);
        _ ->
            {0, Ai0#{plan := []}}
    end.

pop(#{plan := [{Keys, N} | Rest]} = Ai, Me, Opp) ->
    Plan = case N > 1 of true -> [{Keys, N - 1} | Rest]; false -> Rest end,
    {mask(Keys, Me, Opp), Ai#{plan := Plan}};
pop(Ai, _, _) -> {0, Ai}.

mask(Keys, #{x := X, f := Face}, #{x := OX}) ->
    Fwd = if OX > X -> ?RIGHT; OX < X -> ?LEFT; Face =:= 1 -> ?RIGHT; true -> ?LEFT end,
    Back = ?LEFT + ?RIGHT - Fwd,
    lists:foldl(fun(K, M) ->
                        M bor case K of
                                  fwd -> Fwd; back -> Back; up -> ?UP; down -> ?DOWN;
                                  p -> ?PUNCH; k -> ?KICK; s -> ?SPEC; u -> ?SUPER; t -> ?THROW
                              end
                end, 0, Keys).

roll(#{rng := R} = Ai) ->
    {V, R1} = rand:uniform_s(R),
    {V, Ai#{rng := R1}}.

int(Ai, Lo, Hi) ->
    {V, Ai1} = roll(Ai),
    {Lo + trunc(V * (Hi - Lo + 1)), Ai1}.

block_p(1) -> 0.25;
block_p(2) -> 0.5;
block_p(3) -> 0.75;
block_p(4) -> 0.9.

antiair_p(Lv) -> 0.12 + 0.2 * (Lv - 1).

gap(#{lv := Lv} = Ai) ->
    {Lo, Hi} = case Lv of 1 -> {14, 30}; 2 -> {8, 18}; 3 -> {3, 10}; _ -> {1, 6} end,
    int(Ai, Lo, Hi).

can_act(#{s := S}) -> lists:member(S, [idle, walk, run, crouch, block]).

%% ---- 反应：对手出招的头几帧里掷一次骰子决定防不防
react(#{seen := Seen, lv := Lv} = Ai, #{x := X, id := Id} = Me, #{x := OX, s := OS, t := OT, cb := OCb, mv := OMv, c := OC},
      Sim) ->
    D = abs(OX - X),
    K = vs_sim:now(Sim),
    Atk = lists:member(OS, [attack, cjab, sweep, launch, dash, runatk, jattack, slam, special,
                                bpunch, bstomp, charge]) andalso D < case OS of charge -> 400; bstomp -> 260; _ -> 170 end,
    Proj = lists:any(fun(#{o := Own, x := PX, vx := PVx}) ->
                             Own =/= Id andalso abs(PX - X) < 120 andalso (X - PX) * PVx > 0
                     end, vs_sim:projectiles(Sim)),
    Key = if Atk -> {OS, OCb, K - OT}; Proj -> proj; true -> none end,
    case Key =/= none andalso Key =/= Seen andalso can_act(Me) of
        true ->
            {V, Ai1} = roll(Ai#{seen := Key}),
            case V < block_p(Lv) of
                true ->
                    Low = OS =:= sweep orelse OS =:= cjab orelse (OS =:= runatk andalso OC =:= mira andalso OMv =:= sp6)
                        orelse (OS =:= slamland) orelse OS =:= bstomp,
                    Keys = case Low andalso maps:get(c, Me) =/= boss of true -> [back, down]; false -> [back] end,
                    Hold = case OS of bstomp -> 24; charge -> 30; bpunch -> 16; _ -> 11 end,
                    Ai1#{plan := [{Keys, Hold}]};
                false -> Ai1
            end;
        false when Key =:= none -> Ai#{seen := none};
        false -> Ai
    end.

%% ---- 决策：计划为空时挑下一段
think(Ai, #{s := grabbed}, _Opp, _Sim) ->
    {V, Ai1} = roll(Ai),
    case V < 0.12 * maps:get(lv, Ai) of
        true -> Ai1#{plan := [{[t], 2}]};
        false -> Ai1#{plan := [{[], 3}]}
    end;
think(Ai, Me, Opp, Sim) ->
    case can_act(Me) of
        false -> Ai#{plan := [{[], 2}]};
        true ->
            {Plan, Ai1} = choose(Ai, Me, Opp, Sim),
            {G, Ai2} = gap(Ai1),
            Ai2#{plan := Plan ++ [{[], G}]}
    end.

choose(Ai0, #{c := boss} = Me, Opp, _Sim) ->
    boss_choose(Ai0, Me, Opp);
choose(Ai0, #{x := X, c := C, en := En, own := Own}, #{x := OX, s := OS, z := OZ, vz := OVz}, Sim) ->
    #{lv := Lv} = Ai0,
    D = abs(OX - X),
    {V, Ai} = roll(Ai0),
    #{reach := Reach} = vs_sim:stats(C),
    OppDown = lists:member(OS, [down, getup, knockdown, dead]),
    OppAir = lists:member(OS, [jump, jattack, slam]),
    Item = vs_sim:item(Sim),
    if
        OppDown, D > 110 -> {[{[fwd], 6}], Ai};
        OppDown -> {[{[], 5}], Ai};
        OppAir, D < 110, OZ < 95, OVz < 0 ->
            AA = antiair_p(Lv),
            case V < AA of
                true when C =:= zed, D > 50 -> {[{[down, s], 2}, {[], 26}], Ai};   %% 挑天棍
                true when C =:= kai, V < AA * 0.5 -> {[{[down, s], 2}, {[], 30}], Ai};
                true -> {[{[k], 2}, {[], 12}], Ai};
                false -> {[{[back], 7}], Ai}
            end;
        OppAir -> {[{[back], 4}], Ai};
        Item =/= none, V < 0.45 ->
            #{x := IX} = Item,
            Toward = (IX - X) * (OX - X) >= 0,
            {[{[case Toward of true -> fwd; false -> back end], 8}], Ai};
        D > 380 ->
            if
                V < 0.4, not Own -> {[{[s], 2}, {[], 22}], Ai};
                V < 0.75 -> {[{[fwd], 2}, {[], 2}, {[fwd], 14}], Ai};
                V < 0.9 -> {[{[fwd], 12}], Ai};
                true -> {[{[], 10}], Ai}
            end;
        D > 150 ->
            if
                V < 0.32 -> {[{[fwd], 8}], Ai};
                V < 0.47 -> {[{[up, fwd], 3}, {[fwd], 10}, {[p], 2}, {[], 12}], Ai};
                V < 0.6, D < 270 -> {[{[fwd, s], 2}, {[], 18}], Ai};
                V < 0.72, not Own -> {[{[s], 2}, {[], 22}], Ai};
                V < 0.8, D < 190, C =/= kai, C =/= zed -> {[{[down, s], 2}, {[], 22}], Ai};
                V < 0.9 -> {[{[fwd], 2}, {[], 2}, {[fwd], 8}, {[fwd, p], 2}, {[], 14}], Ai};
                true -> {[{[back], 8}], Ai}
            end;
        D > Reach + 28 ->
            if
                V < 0.5 -> {[{[fwd], 4}], Ai};
                V < 0.65 -> {[{[down, k], 2}, {[down], 16}], Ai};
                V < 0.75 -> {[{[fwd, s], 2}, {[], 18}], Ai};
                V < 0.85 -> {[{[back], 2}, {[], 2}, {[back], 3}, {[], 8}], Ai};
                true -> {[{[back], 9}], Ai}
            end;
        true ->
            Blk = OS =:= block,
            ThrowP = case Blk of true -> 0.38; false -> 0.14 end,
            SuperOk = En >= 100 andalso Lv >= 2,
            if
                V < ThrowP, D < 60 -> {[{[t], 2}, {[], 18}], Ai};
                SuperOk, V < ThrowP + 0.12 -> {[{[p], 2}, {[], 4}, {[u], 2}, {[], 30}], Ai};
                V < 0.5 -> {[{[p], 2}, {[], 4}, {[p], 2}, {[], 4}, {[p], 2}, {[], 10}], Ai};
                V < 0.64 ->
                    %% 地面 J J K 挑空 → 追击跳 → 空中 J J J → K 坠击
                    {[{[p], 2}, {[], 4}, {[p], 2}, {[], 3}, {[k], 2}, {[], 10}, {[up], 3}, {[], 6},
                      {[p], 2}, {[], 5}, {[p], 2}, {[], 5}, {[p], 2}, {[], 5}, {[k], 2}, {[], 16}], Ai};
                V < 0.74 -> {[{[p], 2}, {[], 4}, {[p], 2}, {[], 3}, {[fwd, s], 2}, {[], 18}], Ai};
                V < 0.84 -> {[{[down, p], 2}, {[down], 3}, {[down, k], 2}, {[down], 16}], Ai};
                V < 0.92, C =:= kai -> {[{[down, s], 2}, {[], 30}], Ai};
                true -> {[{[back], 2}, {[], 2}, {[back], 3}, {[], 8}], Ai}
            end
    end.

%% ---- Boss「OVERCLOCK」：远处扔扳手、冲撞，中距离踩地，贴身重拳 / 抓投 / 超频连锤
boss_choose(Ai0, #{x := X, en := En, own := Own}, #{x := OX, s := OS}) ->
    D = abs(OX - X),
    {V, Ai} = roll(Ai0),
    OppDown = lists:member(OS, [down, getup, knockdown, dead]),
    OppAir = lists:member(OS, [jump, jattack, slam]),
    if
        OppDown, D > 160 -> {[{[fwd], 8}], Ai};
        OppDown -> {[{[], 6}], Ai};
        OppAir, D < 150 -> {[{[back], 10}], Ai};
        D > 380 ->
            if
                V < 0.4, not Own -> {[{[s], 2}, {[], 30}], Ai};
                V < 0.7 -> {[{[fwd, s], 2}, {[], 46}], Ai};
                true -> {[{[fwd], 16}], Ai}
            end;
        D > 160 ->
            if
                V < 0.28 -> {[{[fwd, s], 2}, {[], 46}], Ai};
                V < 0.48, not Own -> {[{[s], 2}, {[], 30}], Ai};
                V < 0.68, D < 270 -> {[{[k], 2}, {[], 38}], Ai};
                true -> {[{[fwd], 12}], Ai}
            end;
        D > 110 ->
            if
                V < 0.4 -> {[{[fwd], 8}], Ai};
                V < 0.65 -> {[{[p], 2}, {[], 31}], Ai};
                V < 0.85 -> {[{[k], 2}, {[], 38}], Ai};
                true -> {[{[back], 10}], Ai}
            end;
        true ->
            Blk = OS =:= block,
            if
                En >= 100, V < 0.35 -> {[{[u], 2}, {[], 44}], Ai};
                Blk, V < 0.45 -> {[{[t], 2}, {[], 24}], Ai};
                V < 0.18 -> {[{[t], 2}, {[], 24}], Ai};
                V < 0.62 -> {[{[p], 2}, {[], 31}], Ai};
                V < 0.8 -> {[{[k], 2}, {[], 38}], Ai};
                true -> {[{[back], 12}], Ai}
            end
    end.
