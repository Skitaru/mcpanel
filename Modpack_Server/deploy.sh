#!/usr/bin/env bash
SERVER="root@91.99.210.218"
REMOTE="/opt/mcpanel/app"
LOCAL="/mnt/c/Users/bross/Desktop/Claude/Modpack_Server/app"

echo "→ Dateien übertragen..."
scp "$LOCAL/server.js" "$SERVER:$REMOTE/server.js"
scp "$LOCAL/public/index.html" "$SERVER:$REMOTE/public/index.html"

echo "→ Service neu starten..."
ssh "$SERVER" "systemctl restart mcpanel"

echo "✓ Fertig! Panel läuft wieder."
