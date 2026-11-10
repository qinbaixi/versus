@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"
title Neon Knuckles Versus Server

set "PORT=8090"
set "URL=http://localhost:%PORT%/"

echo ==============================================
echo   霓虹铁拳：对决 Neon Knuckles Versus - 一键启动
echo ==============================================

rem ---- 1. 检查 Erlang/OTP ----
where erl >nul 2>nul
if errorlevel 1 (
    if exist "C:\Program Files\Erlang OTP\bin\erl.exe" (
        set "PATH=C:\Program Files\Erlang OTP\bin;%PATH%"
    ) else (
        for /d %%D in ("C:\Program Files\erl*") do if exist "%%D\bin\erl.exe" set "PATH=%%D\bin;%PATH%"
    )
)
where erl >nul 2>nul
if errorlevel 1 (
    echo [错误] 没找到 Erlang/OTP，请先安装 OTP 26：https://www.erlang.org/downloads
    echo        安装后把 Erlang 的 bin 目录加入 PATH，再双击本脚本。
    pause
    exit /b 1
)

rem ---- 2. 找 rebar3，找不到就自动下载到 tools\rebar3 ----
where rebar3 >nul 2>nul
if not errorlevel 1 (
    set "REBAR=call rebar3"
    goto :have_rebar
)
if not exist "tools\rebar3" (
    echo [信息] 没找到 rebar3，正在下载到 tools\rebar3 ...
    if not exist tools mkdir tools
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; try { Invoke-WebRequest -UseBasicParsing 'https://s3.amazonaws.com/rebar3/rebar3' -OutFile 'tools\rebar3' } catch { Invoke-WebRequest -UseBasicParsing 'https://github.com/erlang/rebar3/releases/download/3.24.0/rebar3' -OutFile 'tools\rebar3' }"
    if not exist "tools\rebar3" (
        echo [错误] rebar3 下载失败。请手动下载 https://s3.amazonaws.com/rebar3/rebar3 放到 tools\rebar3 后重试。
        pause
        exit /b 1
    )
)
set "REBAR=escript tools\rebar3"

:have_rebar
rem ---- 3. 编译（第一次会下载 cowboy 依赖；失败则自动切换国内 hex 镜像重试）----
echo [信息] 正在编译...
%REBAR% compile
if errorlevel 1 (
    echo [信息] 编译/下载依赖失败，切换到国内 hex 镜像重试...
    set "HEX_CDN=https://hexpm.upyun.com"
    %REBAR% compile
    if errorlevel 1 (
        echo [错误] 编译失败，请把上面的错误信息发给我。
        pause
        exit /b 1
    )
)

rem ---- 4. 3 秒后自动打开浏览器，然后启动服务器 ----
echo.
echo [信息] 服务器启动中，浏览器会自动打开 %URL%
echo        局域网好友访问 http://你的IP:%PORT%/ ，选「联机对战」并输入相同房间号即可对打。
echo        关闭本窗口即停止服务器。
echo.
start "" /b cmd /c "ping -n 4 127.0.0.1 >nul & start "" %URL%"
%REBAR% shell
pause
