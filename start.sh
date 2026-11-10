#!/usr/bin/env bash
# 霓虹铁拳：对决 Neon Knuckles Versus - 一键启动（Linux / macOS）
set -e
cd "$(dirname "$0")"
PORT=8090
URL="http://localhost:$PORT/"

command -v erl >/dev/null || { echo "[错误] 没找到 Erlang/OTP，请先安装 OTP 26"; exit 1; }

if command -v rebar3 >/dev/null; then
  REBAR=(rebar3)
else
  if [ ! -f tools/rebar3 ]; then
    echo "[信息] 没找到 rebar3，正在下载到 tools/rebar3 ..."
    mkdir -p tools
    curl -fsSL -o tools/rebar3 https://s3.amazonaws.com/rebar3/rebar3 \
      || curl -fsSL -o tools/rebar3 https://github.com/erlang/rebar3/releases/download/3.24.0/rebar3
    chmod +x tools/rebar3
  fi
  REBAR=(escript tools/rebar3)
fi

echo "[信息] 正在编译..."
if ! "${REBAR[@]}" compile; then
  echo "[信息] 失败，切换国内 hex 镜像重试..."
  HEX_CDN=https://hexpm.upyun.com "${REBAR[@]}" compile
fi

( sleep 3; (xdg-open "$URL" || open "$URL") >/dev/null 2>&1 || true ) &
echo "[信息] 服务器启动中：$URL  （Ctrl+C 两次退出）"
exec "${REBAR[@]}" shell
