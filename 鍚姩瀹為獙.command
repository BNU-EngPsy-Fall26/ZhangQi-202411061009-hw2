#!/bin/bash
# ============================================================
# 启动实验.command —— macOS 双击启动（本地静态服务器）
# 浏览器把 http://localhost 视为安全上下文 → 摄像头眼动可用，
# 无需 HTTPS/证书。依赖 macOS 自带的 python3（无则退回 python）。
# ============================================================
cd "$(dirname "$0")"
PORT=8765

echo "==============================================="
echo " 注意实验室本地服务器已启动（HTTP · localhost）"
echo " 地址: http://localhost:$PORT/index.html"
echo " localhost 为浏览器安全上下文，摄像头眼动可用"
echo " 关闭此窗口即可停止服务器"
echo "==============================================="
open "http://localhost:$PORT/index.html"

if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then
  exec python -m http.server "$PORT"
else
  echo "未找到 Python。可改用任意静态服务器，例如："
  echo "  npx serve -l $PORT"
  read -r -p "按回车键关闭…" _
fi
