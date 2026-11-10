%% 房间注册表：房间码 -> 房间进程。房间进程退出时自动移除。
-module(vs_rooms).
-behaviour(gen_server).
-export([start_link/0, get_or_create/1]).
-export([init/1, handle_call/3, handle_cast/2, handle_info/2]).

start_link() ->
    gen_server:start_link({local, ?MODULE}, ?MODULE, [], []).

-spec get_or_create(binary()) -> {ok, pid()}.
get_or_create(Code) ->
    gen_server:call(?MODULE, {get_or_create, Code}).

init([]) ->
    {ok, #{}}.

handle_call({get_or_create, Code}, _From, Rooms) ->
    case Rooms of
        #{Code := Pid} ->
            {reply, {ok, Pid}, Rooms};
        _ ->
            {ok, Pid} = vs_room_sup:start_room(Code),
            erlang:monitor(process, Pid),
            {reply, {ok, Pid}, Rooms#{Code => Pid}}
    end.

handle_cast(_Msg, Rooms) ->
    {noreply, Rooms}.

handle_info({'DOWN', _Ref, process, Pid, _Reason}, Rooms) ->
    {noreply, maps:filter(fun(_, P) -> P =/= Pid end, Rooms)};
handle_info(_Msg, Rooms) ->
    {noreply, Rooms}.
