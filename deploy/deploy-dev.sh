#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_NAME="mission-control-dev"
USER_SERVICE_DIR="$HOME/.config/systemd/user"

echo "=== Mission Control Center 開發環境部署 ==="
echo "專案目錄: $PROJECT_DIR"

# 1. 安裝依賴
echo ""
echo "[1/3] 安裝依賴..."
cd "$PROJECT_DIR"
npm install

# 2. 產生並安裝 systemd user service
echo ""
echo "[2/3] 產生 systemd user service..."
mkdir -p "$USER_SERVICE_DIR"

NPX_PATH="$(which npx)"

cat > "$USER_SERVICE_DIR/$SERVICE_NAME.service" <<EOF
[Unit]
Description=Mission Control Center WWZ (dev)
After=network.target

[Service]
Type=simple
WorkingDirectory=$PROJECT_DIR
ExecStart=$NPX_PATH tsx server.ts
Environment=NODE_ENV=development
Environment=PATH=$(dirname "$NPX_PATH"):/usr/local/bin:/usr/bin:/bin
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF

echo "已產生: $USER_SERVICE_DIR/$SERVICE_NAME.service"
systemctl --user daemon-reload

# 3. 啟用並啟動
echo ""
echo "[3/3] 啟用並啟動服務..."
systemctl --user enable "$SERVICE_NAME"
systemctl --user restart "$SERVICE_NAME"

# 啟用 lingering
loginctl enable-linger "$(whoami)"

echo ""
echo "=== 開發環境部署完成 ==="
echo ""
echo "常用指令："
echo "  狀態:  systemctl --user status $SERVICE_NAME"
echo "  日誌:  journalctl --user -u $SERVICE_NAME -f"
echo "  重啟:  systemctl --user restart $SERVICE_NAME"
echo "  停止:  systemctl --user stop $SERVICE_NAME"
