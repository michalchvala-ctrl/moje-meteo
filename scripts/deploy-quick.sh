#!/bin/sh
# Rýchly deploy na euflix (spusti na serveri v /opt/moje-meteo)
set -e
cd /opt/moje-meteo
git pull origin main

VER=$(cat VERSION 2>/dev/null || echo '?')
echo "Verzia v repozitári: $VER"

C=moje-meteo

if ! podman container exists "$C" 2>/dev/null; then
  echo "Kontajner $C neexistuje — skúšam štart existujúceho image…"
  if podman image exists moje-meteo:latest 2>/dev/null; then
    bash scripts/start-meteo.sh
    exit 0
  fi
  echo "Image chýba — plná obnova…"
  bash scripts/recreate-container.sh
  exit 0
fi

echo "Zastavujem kontajner pred kopírovaním…"
podman stop "$C" 2>/dev/null || true

podman cp server/forecast.js "$C":/app/forecast.js
podman cp server/chart-period.js "$C":/app/chart-period.js
podman cp server/schedule-sync.js "$C":/app/schedule-sync.js
podman cp server/server.js "$C":/app/server.js
podman cp server/ecowitt.js "$C":/app/ecowitt.js
podman cp server/meteo-utils.js "$C":/app/meteo-utils.js
podman cp server/export-data.js "$C":/app/export-data.js
podman cp server/radar-tiles.js "$C":/app/radar-tiles.js
podman cp server/public/. "$C":/app/public/
podman cp VERSION "$C":/app/VERSION

echo "Spúšťam kontajner…"
podman start "$C"
sleep 3

echo ""
echo "--- /api/config (musí obsahovať version: $VER) ---"
curl -s http://127.0.0.1:8081/api/config
echo ""

echo ""
echo "--- súbory v kontajneri ---"
podman exec "$C" cat /app/VERSION
for f in meteo-utils.js export-data.js radar-tiles.js schedule-sync.js chart-period.js; do
  podman exec "$C" test -f "/app/$f" && echo "OK: $f" || echo "CHÝBA: $f"
done
podman exec "$C" grep -o 'v=1\.[0-9.]*' /app/public/index.html | head -3

echo ""
echo "Logy: podman logs --tail 15 $C"
echo "Ak kontajner opäť zmizne: bash scripts/recreate-container.sh"
echo "V prehliadači: Ctrl+Shift+R."
