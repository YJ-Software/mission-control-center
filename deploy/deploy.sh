#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_NAME="mission-control"
USER_SERVICE_DIR="$HOME/.config/systemd/user"

echo "=== Mission Control Center 部署 ==="
echo "專案目錄: $PROJECT_DIR"

# 1. 安裝依賴 & 建構
echo ""
echo "[1/5] 安裝依賴..."
cd "$PROJECT_DIR"
npm ci --omit=dev

echo ""
echo "[2/5] 建構 Next.js..."
npm run build

# 3. 產生並安裝 systemd user service
echo ""
echo "[3/5] 產生 systemd user service..."
mkdir -p "$USER_SERVICE_DIR"

NPX_PATH="$(which npx)"

cat > "$USER_SERVICE_DIR/$SERVICE_NAME.service" <<EOF
[Unit]
Description=Mission Control Center WWZ
After=network.target

[Service]
Type=simple
WorkingDirectory=$PROJECT_DIR
ExecStart=$NPX_PATH tsx server.ts
Environment=NODE_ENV=production
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

# 4. 啟用並啟動
echo ""
echo "[4/5] 啟用並啟動服務..."
systemctl --user enable "$SERVICE_NAME"
systemctl --user restart "$SERVICE_NAME"

# 5. 啟用 lingering（不需要登入也能跑）
echo ""
echo "[5/5] 啟用 loginctl lingering..."
loginctl enable-linger "$(whoami)"

echo ""
echo "=== 部署完成 ==="
echo ""
echo "常用指令："
echo "  狀態:  systemctl --user status $SERVICE_NAME"
echo "  日誌:  journalctl --user -u $SERVICE_NAME -f"
echo "  重啟:  systemctl --user restart $SERVICE_NAME"
echo "  停止:  systemctl --user stop $SERVICE_NAME"
