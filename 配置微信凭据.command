#!/bin/bash
set -e

cd "$(dirname "$0")"

NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ] && [ -x "$HOME/.local/bin/node" ]; then
  NODE_BIN="$HOME/.local/bin/node"
fi

if [ -z "$NODE_BIN" ]; then
  echo "未找到 Node.js，请先安装 Node.js 22.5 或更高版本。"
  read -r -p "按回车键关闭窗口..."
  exit 1
fi

echo "配置微信小程序凭据"
echo
EXISTING_APPID="$(awk -F= '/^WECHAT_APPID=/{print $2; exit}' .env 2>/dev/null)"
if [ -n "$EXISTING_APPID" ]; then
  read -r -p "小程序 AppID（直接回车使用 $EXISTING_APPID）： " APPID
  APPID="${APPID:-$EXISTING_APPID}"
else
  read -r -p "请输入小程序 AppID（以 wx 开头）： " APPID
fi
read -s -r -p "请输入 AppSecret（输入时不会显示）： " APPSECRET
echo
echo

if [ -z "$APPID" ] || [ -z "$APPSECRET" ]; then
  echo "AppID 和 AppSecret 都不能为空。"
  read -r -p "按回车键关闭窗口..."
  exit 1
fi

export NEW_WECHAT_APPID="$APPID"
export NEW_WECHAT_SECRET="$APPSECRET"

if ! "$NODE_BIN" scripts/configure-wechat.mjs; then
  read -r -p "配置失败，按回车键关闭窗口..."
  exit 1
fi

if launchctl print "gui/$(id -u)/com.home-organizing.server" >/dev/null 2>&1; then
  launchctl kickstart -k "gui/$(id -u)/com.home-organizing.server" >/dev/null 2>&1 || true
else
  nohup "$NODE_BIN" server.mjs > data/server.log 2>&1 &
fi

for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:8787/api/health" >/dev/null 2>&1; then
    echo
    echo "后台已使用新凭据重启。"
    open "http://127.0.0.1:8787/admin/#qr"
    echo "下一步：用微信开发者工具上传并发布小程序，再运行 npm run generate:qr。"
    read -r -p "按回车键关闭窗口..."
    exit 0
  fi
  sleep 0.5
done

echo "后台重启失败，请双击“启动后台.command”后再试。"
read -r -p "按回车键关闭窗口..."
exit 1
