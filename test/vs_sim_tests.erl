-module(vs_sim_tests).
-include_lib("eunit/include/eunit.hrl").

-define(L, 1). -define(R, 2). -define(U, 4). -define(D, 8).
-define(P, 16). -define(K, 32). -define(S, 64). -define(SU, 128). -define(T, 256).

fresh() -> fresh(kai, mira).
fresh(C1, C2) ->
    S = vs_sim:start(vs_sim:seat(vs_sim:seat(vs_sim:new(), 1, C1, <<"a">>, false), 2, C2, <<"b">>, false)),
    run(S, 0, 0, 80).

run(S, _, _, 0) -> S;
run(S, M1, M2, N) -> run(vs_sim:tick(S, M1, M2), M1, M2, N - 1).

%% 按一串 {M1, M2, Ticks} 推进
seq(S, []) -> S;
seq(S, [{M1, M2, N} | T]) -> seq(run(S, M1, M2, N), T).

f(S, I) -> vs_sim:fighter(S, I).
hp(S, I) -> maps:get(hp, f(S, I)).
close_up(S) ->
    %% 让两人走到贴身距离
    run(S, ?R, ?L, 40).

intro_then_fight_test() ->
    S0 = vs_sim:start(vs_sim:seat(vs_sim:seat(vs_sim:new(), 1, kai, <<"a">>, false), 2, mira, <<"b">>, false)),
    ?assertEqual(intro, vs_sim:phase(S0)),
    ?assertEqual(fight, vs_sim:phase(run(S0, 0, 0, 80))).

jab_hits_and_block_test() ->
    S = close_up(fresh()),
    S1 = seq(S, [{?P, 0, 1}, {0, 0, 8}]),
    ?assert(hp(S1, 2) < 900),
    ?assertEqual(1000, hp(S1, 1)),
    %% 对手按住后（座位 2 面朝左，后 = 右）：防住，不掉血
    S2 = seq(S, [{?P, ?R, 1}, {0, ?R, 8}]),
    ?assertEqual(900, hp(S2, 2)).

combo_counts_test() ->
    S = close_up(fresh()),
    S1 = seq(S, [{?P, 0, 1}, {0, 0, 5}, {?P, 0, 1}, {0, 0, 5}, {?P, 0, 1}, {0, 0, 8}]),
    ?assertEqual(3, maps:get(hc, f(S1, 1))),
    ?assert(lists:member(maps:get(s, f(S1, 2)), [knockdown, down])).

sweep_must_be_blocked_low_test() ->
    S = close_up(fresh()),
    Stand = seq(S, [{?D bor ?K, ?R, 1}, {?D, ?R, 10}]),
    ?assert(hp(Stand, 2) < 900),
    Low = seq(S, [{?D bor ?K, ?R bor ?D, 1}, {?D, ?R bor ?D, 10}]),
    ?assertEqual(900, hp(Low, 2)).

jump_attack_is_overhead_test() ->
    S = run(fresh(), ?R, ?L, 25),
    J = [{?U bor ?R, 2}, {?R, 9}, {?P, 1}, {0, 14}],
    Crouch = seq(S, [{A, ?R bor ?D, N} || {A, N} <- J]),
    Stand = seq(S, [{A, ?R, N} || {A, N} <- J]),
    ?assert(hp(Crouch, 2) < 900),
    ?assertEqual(900, hp(Stand, 2)).

throw_beats_block_and_can_be_teched_test() ->
    S = close_up(fresh()),
    S1 = seq(S, [{?T, ?R, 1}, {0, ?R, 30}]),
    ?assertEqual(900 - 110, hp(S1, 2)),
    S2 = seq(S, [{?T, ?R, 1}, {0, ?R, 5}, {0, ?T, 1}, {0, 0, 30}]),
    ?assertEqual(900, hp(S2, 2)).

projectile_test() ->
    S = fresh(),
    S1 = seq(S, [{?S, 0, 1}, {0, 0, 60}]),
    ?assert(hp(S1, 2) < 900),
    ?assertEqual([], vs_sim:projectiles(S1)),
    %% 防住有削血
    S2 = seq(S, [{?S, ?R, 1}, {0, ?R, 60}]),
    ?assert(hp(S2, 2) < 900),
    ?assert(hp(S2, 2) > hp(S1, 2)),
    %% 两个飞行道具相撞抵消
    S3 = seq(S, [{?S, ?S, 1}, {0, 0, 60}]),
    ?assertEqual(1000, hp(S3, 1)),
    ?assertEqual(900, hp(S3, 2)).

launcher_juggle_cap_test() ->
    S = close_up(fresh()),
    S1 = seq(S, [{?K, 0, 1}, {0, 0, 6}]),
    ?assertEqual(air, maps:get(s, f(S1, 2))).

super_needs_meter_test() ->
    S = close_up(fresh()),
    S1 = seq(S, [{?SU, 0, 1}, {0, 0, 5}]),
    ?assertNotEqual(special, maps:get(s, f(S1, 1))),
    #{fs := Fs} = S,
    F1 = maps:get(1, Fs),
    S2 = seq(S#{fs := Fs#{1 := F1#{en := 100.0}}}, [{?SU, 0, 1}, {0, 0, 5}]),
    ?assertEqual(special, maps:get(s, f(S2, 1))),
    S3 = run(S2, 0, 0, 70),
    ?assert(hp(S3, 2) < 900 - 150),
    ?assertEqual(0, trunc(maps:get(en, f(S3, 1)) / 100)).

timeout_round_test() ->
    S = close_up(fresh()),
    S1 = seq(S, [{?P, 0, 1}, {0, 0, 8}]),
    S2 = run(S1, 0, 0, 1800),
    ?assertEqual({1, 0}, maps:get(w, S2)).

%% 两个 CPU 打完整场比赛：必须在合理时间内分出胜负，全程不崩溃，位置始终在擂台内
cpu_vs_cpu_test_() ->
    {timeout, 120,
     fun() ->
             lists:foreach(
               fun({C1, C2, Seed}) ->
                       S0 = vs_sim:start(vs_sim:seat(vs_sim:seat(vs_sim:new(), 1, C1, <<"a">>, true), 2, C2, <<"b">>, true)),
                       {S, N} = bots(S0, vs_ai:new(3, Seed), vs_ai:new(3, Seed + 1), 0),
                       ?assertEqual(over, vs_sim:phase(S)),
                       ?assert(N < 30 * 60 * 6),
                       ?assert(lists:member(vs_sim:winner(S), [1, 2]))
               end,
               [{kai, mira, 1}, {bruno, zed, 2}, {mira, bruno, 3}, {zed, kai, 4}, {kai, kai, 5},
                {kai, boss, 6}, {mira, boss, 7}, {bruno, boss, 8}, {zed, boss, 9}])
     end}.

bots(S, A1, A2, N) ->
    case vs_sim:phase(S) =:= over orelse N > 30 * 60 * 8 of
        true -> {S, N};
        false ->
            {M1, A1b} = vs_ai:decide(A1, S, 1),
            {M2, A2b} = vs_ai:decide(A2, S, 2),
            S1 = vs_sim:tick(S, M1, M2),
            lists:foreach(fun(I) ->
                                  #{x := X, z := Z} = vs_sim:fighter(S1, I),
                                  ?assert(X >= 34.9 andalso X =< 965.1),
                                  ?assert(Z >= 0)
                          end, [1, 2]),
            _ = iolist_to_binary(vs_json:encode(vs_sim:snapshot(S1))),
            bots(S1, A1b, A2b, N + 1)
    end.

%% 泽德「挑天棍」：下 + 技，打得到跳进来的对手并把他挑上天
zed_rising_staff_antiair_test() ->
    S = run(fresh(mira, zed), ?R, ?L, 18),
    %% 米拉向前跳，泽德在她落到头顶前出挑天棍
    S1 = seq(S, [{?U bor ?R, 0, 2}, {?R, 0, 4}, {?R, ?D bor ?S, 1}, {0, ?D, 8}]),
    ?assertEqual(launch, maps:get(s, f(S1, 2))),
    ?assertEqual(zsp2, maps:get(mv, f(S1, 2))),
    ?assert(hp(S1, 1) < 900),
    ?assertEqual(air, maps:get(s, f(S1, 1))).

%% 布鲁诺的投：先把对手举过头顶，再砸下去
bruno_lift_throw_test() ->
    S = close_up(fresh(bruno, kai)),
    S1 = seq(S, [{?T, 0, 1}, {0, 0, 13}]),
    ?assertEqual(grabbed, maps:get(s, f(S1, 2))),
    ?assert(maps:get(z, f(S1, 2)) > 60),
    S2 = run(S1, 0, 0, 40),
    ?assertEqual(1000 - 150, hp(S2, 2)).

%% Boss 不会蹲：下段（扫腿）防不住；但站着能防中段
boss_cannot_block_low_test() ->
    S = close_up(fresh(kai, boss)),
    Low = seq(S, [{?D bor ?K, ?R bor ?D, 1}, {?D, ?R bor ?D, 12}]),
    ?assert(hp(Low, 2) < 1450),
    Mid = seq(S, [{?P, ?R, 1}, {0, ?R, 8}]),
    ?assertEqual(1450, hp(Mid, 2)).

%% Boss 的重拳带霸体：被轻拳打中也不会中断
boss_punch_armor_test() ->
    S = close_up(fresh(kai, boss)),
    S1 = seq(S, [{0, ?P, 1}, {0, 0, 2}, {?P, 0, 1}, {0, 0, 4}]),
    ?assertEqual(bpunch, maps:get(s, f(S1, 2))),
    S2 = run(S1, 0, 0, 10),
    ?assert(hp(S2, 1) < 1000).

%% Boss 挑不起来
boss_not_launchable_test() ->
    S = close_up(fresh(kai, boss)),
    S1 = seq(S, [{?K, 0, 1}, {0, 0, 6}]),
    ?assertEqual(hurt, maps:get(s, f(S1, 2))).
