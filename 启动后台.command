#!/bin/bash
set -e

cd "$(dirname "$0")"

mkdir -p data

NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ] && [ -x "$HOME/.local/bin/node" ]; then
  NODE_BIN="$HOME/.local/bin/node"
fi

if [ -z "$NODE_BIN" ]; then
  echo "未找到 Node.js，请先安装 Node.js 22.5 或更高版本。"
  read -r -p "按回车键关闭窗口..."
  exit 1
fi

if lsof -nP -iTCP:8787 -sTCP:LISTEN >/dev/null 2>&1; then
  open "http://127.0.0.1:8787/admin/"
  exit 0
fi

nohup "$NODE_BIN" server.mjs > data/server.log 2>&1 &

for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:8787/api/health" >/dev/null 2>&1; then
    open "http://127.0.0.1:8787/admin/"
    exit 0
  fi
  sleep 0.5
done

echo "后台启动失败，请查看 data/server.log"
read -r -p "按回车键关闭窗口..."
exit 1
