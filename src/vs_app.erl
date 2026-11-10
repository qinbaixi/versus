%% 应用入口：启动 cowboy（静态前端 + /ws）和监督树。
-module(vs_app).
-behaviour(application).
-export([start/2, stop/1]).

start(_Type, _Args) ->
    Port = application:get_env(versus, port, 8090),
    Dispatch = cowboy_router:compile([
        {'_', [
            {"/ws", vs_ws, #{}},
            {"/", cowboy_static, {priv_file, versus, "www/index.html"}},
            {"/[...]", cowboy_static, {priv_dir, versus, "www"}}
        ]}
    ]),
    {ok, _} = cowboy:start_clear(vs_http, [{port, Port}],
                                 #{env => #{dispatch => Dispatch}}),
    logger:notice("Neon Knuckles: Versus listening on http://localhost:~p/", [Port]),
    vs_sup:start_link().

stop(_State) ->
    ok = cowboy:stop_listener(vs_http).
