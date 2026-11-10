%% 顶层监督树：房间注册表 + 房间监督者。
-module(vs_sup).
-behaviour(supervisor).
-export([start_link/0, init/1]).

start_link() ->
    supervisor:start_link({local, ?MODULE}, ?MODULE, []).

init([]) ->
    Children = [
        #{id => vs_room_sup, start => {vs_room_sup, start_link, []}, type => supervisor},
        #{id => vs_rooms, start => {vs_rooms, start_link, []}}
    ],
    {ok, {#{strategy => rest_for_one, intensity => 5, period => 10}, Children}}.
