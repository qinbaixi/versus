%% WebSocket 连接处理：每个本地玩家（或观众）一个连接。协议见 PROTOCOL.md。
-module(vs_ws).
-export([init/2, websocket_init/1, websocket_handle/2, websocket_info/2]).

init(Req, _Opts) ->
    {cowboy_websocket, Req, #{room => undefined},
     #{idle_timeout => 60000, compress => true}}.

websocket_init(St) ->
    {ok, St}.

websocket_handle({text, <<"I|", Mask/binary>>}, #{room := Room} = St) when is_pid(Room) ->
    case catch binary_to_integer(Mask) of
        M when is_integer(M), M >= 0, M < 512 -> vs_room:input(Room, self(), M);
        _ -> ok
    end,
    {ok, St};
websocket_handle({text, <<"P|", N/binary>>}, St) ->
    case catch binary_to_integer(N) of
        I when is_integer(I) -> {reply, {text, vs_json:encode(#{t => pong, n => I})}, St};
        _ -> {ok, St}
    end;
websocket_handle({text, <<"J|", Rest/binary>>}, #{room := undefined} = St) ->
    case binary:split(Rest, <<"|">>, [global]) of
        [Name0, CharBin, Code0, ModeBin, Arg] ->
            Char = pick(CharBin, [kai, mira, bruno, zed], kai),
            Mode = pick(ModeBin, [vs, cpu, arc], vs),
            Name = clean(Name0, 12, <<"Player">>),
            Code = clean(Code0, 24, <<"1">>),
            {ok, Room} = vs_rooms:get_or_create(Code),
            case catch vs_room:join(Room, self(), Name, Char, Mode, Arg) of
                {ok, Seat, RMode} ->
                    erlang:monitor(process, Room),
                    {reply, {text, vs_json:encode(#{t => welcome, id => Seat, room => Code, mode => RMode})},
                     St#{room := Room}};
                _ ->
                    {reply, {text, vs_json:encode(#{t => error, msg => room_closed})}, St}
            end;
        _ ->
            {reply, {text, vs_json:encode(#{t => error, msg => bad_join})}, St}
    end;
websocket_handle(_Frame, St) ->
    {ok, St}.

websocket_info({snap, Bin}, St) ->
    {reply, {text, Bin}, St};
websocket_info({'DOWN', _Ref, process, Room, _Reason}, #{room := Room} = St) ->
    {reply, [{text, vs_json:encode(#{t => error, msg => room_closed})}, close], St#{room := undefined}};
websocket_info(_Info, St) ->
    {ok, St}.

pick(Bin, Atoms, Default) ->
    case [A || A <- Atoms, atom_to_binary(A, utf8) =:= Bin] of
        [A] -> A;
        [] -> Default
    end.

%% 取前 Max 个字符（按 UTF-8 码点），去掉控制字符；空则用默认值
clean(Bin, Max, Default) ->
    Chars = case unicode:characters_to_list(Bin, utf8) of
                L when is_list(L) -> [C || C <- L, C >= 32, C =/= $|];
                _ -> []
            end,
    case unicode:characters_to_binary(lists:sublist(Chars, Max), utf8) of
        <<>> -> Default;
        B when is_binary(B) -> B;
        _ -> Default
    end.
