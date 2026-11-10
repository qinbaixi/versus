%% 房间进程的 simple_one_for_one 监督者。房间崩溃不重启（temporary），玩家重新加入即可。
-module(vs_room_sup).
-behaviour(supervisor).
-export([start_link/0, start_room/1, init/1]).

start_link() ->
    supervisor:start_link({local, ?MODULE}, ?MODULE, []).

start_room(Code) ->
    supervisor:start_child(?MODULE, [Code]).

init([]) ->
    Child = #{id => vs_room, start => {vs_room, start_link, []}, restart => temporary},
    {ok, {#{strategy => simple_one_for_one, intensity => 10, period => 10}, [Child]}}.
