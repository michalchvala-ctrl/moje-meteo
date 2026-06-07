#!/bin/sh
# Rýchly deploy na euflix (spusti na serveri v /opt/moje-meteo)
set -e
cd /opt/moje-meteo
git pull origin main

VER=$(cat VERSION 2>/dev/null || echo '?')
echo "Verzia v repozitári: $VER"

C=moje-meteo

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

podman restart "$C"
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
echo "Logy (posledných 15 riadkov): podman logs --tail 15 $C"
echo "V prehliadači: Ctrl+Shift+R. Ak ostáva stará verzia: Service Workers → Unregister."
