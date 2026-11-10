%% ==========================================================================
%% vs_room —— 一个房间 = 一张擂台。持有权威的对战状态，30 tick/s 推进并向所有连接广播快照。
%%   模式（由第一个进入房间的人决定）：
%%     vs  双人对战：前两个连接是选手（座位 1 / 2），之后进来的是观众（座位 0）
%%     cpu 对战 CPU：座位 1 是玩家，座位 2 由 vs_ai 操控
%%     arc 闯关：依次挑战其余三人和自己的镜像，CPU 一场比一场强
%% ==========================================================================
-module(vs_room).
-behaviour(gen_server).
-export([start_link/1, join/6, input/3]).
-export([init/1, handle_call/3, handle_cast/2, handle_info/2]).

-define(TICK_MS, 33).
-define(EMPTY_TTL_TICKS, 150).   %% 空房间 5 秒后关闭
-define(PUNCH, 16).
-define(CHARS, [kai, mira, bruno, zed]).

start_link(Code) ->
    gen_server:start_link(?MODULE, Code, []).

-spec join(pid(), pid(), binary(), atom(), atom(), binary()) -> {ok, integer(), atom()}.
join(Room, Conn, Name, Char, Mode, Arg) ->
    gen_server:call(Room, {join, Conn, Name, Char, Mode, Arg}).

input(Room, Conn, Mask) ->
    gen_server:cast(Room, {input, Conn, Mask}).

init(Code) ->
    erlang:send_after(?TICK_MS, self(), tick),
    {ok, #{code => Code, mode => none, sim => vs_sim:new(), conns => #{}, in => #{1 => 0, 2 => 0},
           ai => none, arc => none, rdy => #{}, empty => 0, stg => rand:uniform(4) - 1,
           next_tick => erlang:monotonic_time(millisecond) + ?TICK_MS}}.

handle_call({join, Conn, Name, Char, Mode0, Arg}, _From, #{sim := Sim, conns := Conns, mode := RMode} = St) ->
    erlang:monitor(process, Conn),
    Mode = case RMode of none -> Mode0; _ -> RMode end,
    Taken = [S || S <- maps:values(Conns), S > 0],
    case {Mode, Taken} of
        {vs, []} ->
            Sim1 = vs_sim:seat(Sim, 1, Char, Name, false),
            {reply, {ok, 1, vs}, St#{mode := vs, sim := Sim1, conns := Conns#{Conn => 1}}};
        {vs, [Other]} ->
            Seat = 3 - Other,
            Sim1 = vs_sim:start(vs_sim:seat(Sim, Seat, Char, Name, false)),
            {reply, {ok, Seat, vs}, St#{sim := Sim1, conns := Conns#{Conn => Seat}, rdy := #{}}};
        {cpu, []} ->
            {CChar, Lv} = parse_cpu(Arg, Char),
            CName = case CChar of boss -> <<"关底 BOSS"/utf8>>; _ -> cpu_name(Lv) end,
            Sim1 = vs_sim:start(vs_sim:seat(vs_sim:seat(Sim, 1, Char, Name, false), 2, CChar, CName, true)),
            Stg = case CChar of boss -> 3; _ -> maps:get(stg, St) end,
            {reply, {ok, 1, cpu}, St#{mode := cpu, sim := Sim1, conns := Conns#{Conn => 1}, ai := vs_ai:new(Lv, seed()),
                                      stg := Stg}};
        {arc, []} ->
            %% 其余三人（随机顺序）→ 自己的镜像 → 关底 Boss OVERCLOCK
            Order = [C || C <- shuffle(?CHARS -- [Char])] ++ [Char, boss],
            Arc = #{order => Order, st => 1, char => Char, name => Name},
            St1 = arc_stage(St#{mode := arc, arc := Arc, conns := Conns#{Conn => 1}}),
            {reply, {ok, 1, arc}, St1};
        _ ->
            {reply, {ok, 0, Mode}, St#{conns := Conns#{Conn => 0}}}
    end.

handle_cast({input, Conn, Mask}, #{conns := Conns, in := In} = St) ->
    case Conns of
        #{Conn := Seat} when Seat > 0 -> {noreply, St#{in := In#{Seat := Mask}}};
        _ -> {noreply, St}
    end;
handle_cast(_Msg, St) ->
    {noreply, St}.

handle_info(tick, #{conns := Conns, empty := Empty, next_tick := Next} = St) ->
    %% 用单调时钟校正，避免 send_after 的累计漂移
    Now = erlang:monotonic_time(millisecond),
    Next1 = max(Next + ?TICK_MS, Now + 1),
    erlang:send_after(Next1 - Now, self(), tick),
    case map_size(Conns) of
        0 when Empty >= ?EMPTY_TTL_TICKS -> {stop, normal, St};
        0 -> {noreply, St#{empty := Empty + 1, next_tick := Next1}};
        _ ->
            St1 = step(St),
            Bin = iolist_to_binary(vs_json:encode(snapshot(St1))),
            maps:foreach(fun(Pid, _) -> Pid ! {snap, Bin} end, Conns),
            {noreply, St1#{empty := 0, next_tick := Next1}}
    end;
handle_info({'DOWN', _Ref, process, Pid, _Reason}, #{sim := Sim, conns := Conns, in := In, mode := Mode} = St) ->
    case maps:take(Pid, Conns) of
        {0, Conns1} -> {noreply, St#{conns := Conns1}};
        {Seat, Conns1} when Mode =:= vs ->
            %% 选手离开：擂台回到等待状态，留下的人等下一位对手
            {noreply, St#{sim := vs_sim:unseat(Sim, Seat), conns := Conns1, in := In#{Seat := 0}, rdy := #{}}};
        {_Seat, Conns1} ->
            {noreply, St#{conns := Conns1, sim := vs_sim:new(), mode := none, ai := none, arc := none}};
        error -> {noreply, St}
    end;
handle_info(_Msg, St) ->
    {noreply, St}.

%% ---------------------------------------------------------------- 每 tick
step(#{sim := Sim, in := #{1 := M1, 2 := M2}, ai := Ai} = St) ->
    {M2a, Ai1} = case Ai of
                     none -> {M2, none};
                     _ -> vs_ai:decide(Ai, Sim, 2)
                 end,
    Sim1 = vs_sim:tick(Sim, M1, M2a),
    after_match(St#{sim := Sim1, ai := Ai1}).

%% 比赛结束后：选手按“拳”表示准备好，再来一局 / 进入下一关
after_match(#{sim := Sim, in := In, rdy := Rdy0, mode := Mode} = St) ->
    case vs_sim:phase(Sim) of
        over ->
            Pt = maps:get(pt, Sim),
            Rdy = case Pt > 40 of
                      true ->
                          maps:fold(fun(Seat, M, Acc) ->
                                            case M band ?PUNCH of 0 -> Acc; _ -> Acc#{Seat => true} end
                                    end, Rdy0, In);
                      false -> #{}
                  end,
            Need = case Mode of vs -> [1, 2]; _ -> [1] end,
            case lists:all(fun(S) -> maps:is_key(S, Rdy) end, Need) of
                true -> next_match(St#{rdy := #{}});
                false -> St#{rdy := Rdy}
            end;
        _ -> St
    end.

next_match(#{mode := arc, sim := Sim, arc := #{st := N, order := Order} = Arc} = St) ->
    case vs_sim:winner(Sim) of
        1 when N >= length(Order) -> arc_stage(St#{arc := Arc#{st := 1, order := shuffle3(Order)}});
        1 -> arc_stage(St#{arc := Arc#{st := N + 1}, stg := maps:get(stg, St) + 1});
        _ -> arc_stage(St)
    end;
next_match(#{sim := Sim, stg := Stg} = St) ->
    St#{sim := vs_sim:rematch(Sim), stg := Stg + 1}.

arc_stage(#{arc := #{st := N, order := Order, char := Char, name := Name}} = St) ->
    CChar = lists:nth(N, Order),
    Lv = lists:nth(N, [1, 2, 3, 4, 4]),
    CName = case CChar of boss -> <<"关底 BOSS"/utf8>>; _ -> cpu_name(Lv) end,
    Sim = vs_sim:start(vs_sim:seat(vs_sim:seat(vs_sim:new(), 1, Char, Name, false), 2, CChar, CName, true)),
    %% Boss 战固定在厂区尽头
    Stg = case CChar of boss -> 3; _ -> maps:get(stg, St) end,
    St#{sim := Sim, ai := vs_ai:new(Lv, seed()), stg := Stg}.

snapshot(#{sim := Sim, mode := Mode, arc := Arc, rdy := Rdy, conns := Conns, stg := Stg}) ->
    Snap = vs_sim:snapshot(Sim),
    Snap1 = Snap#{md => Mode, stg => Stg rem 4, rdy => [maps:is_key(1, Rdy), maps:is_key(2, Rdy)],
                  aud => length([1 || 0 <- maps:values(Conns)])},
    case Arc of
        #{st := N, order := Order} -> Snap1#{arc => #{st => N, n => length(Order)}};
        _ -> Snap1
    end.

%% ---------------------------------------------------------------- 工具
parse_cpu(Arg, Mine) ->
    {CBin, LBin} = case binary:split(Arg, <<":">>) of
                       [A, B] -> {A, B};
                       [A] -> {A, <<"2">>};
                       _ -> {<<"random">>, <<"2">>}
                   end,
    Lv = case catch binary_to_integer(LBin) of
             L when is_integer(L), L >= 1, L =< 4 -> L;
             _ -> 2
         end,
    Char = case [C || C <- ?CHARS ++ [boss], atom_to_binary(C, utf8) =:= CBin] of
               [C] -> C;
               [] -> hd(shuffle(?CHARS -- [Mine]))
           end,
    {Char, Lv}.

cpu_name(1) -> <<"CPU Lv1">>;
cpu_name(2) -> <<"CPU Lv2">>;
cpu_name(3) -> <<"CPU Lv3">>;
cpu_name(_) -> <<"CPU Lv4">>.

seed() -> erlang:unique_integer([positive]) + erlang:monotonic_time().

shuffle(L) ->
    [X || {_, X} <- lists:sort([{rand:uniform(), X} || X <- L])].

%% 通关后重新开始：前三个对手重新洗牌，镜像战和 Boss 仍在最后
shuffle3(Order) ->
    {Front, Last} = lists:split(length(Order) - 2, Order),
    shuffle(Front) ++ Last.
