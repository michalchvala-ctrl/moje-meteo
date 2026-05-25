#!/bin/sh
# Rýchly deploy na euflix (spusti na serveri v /opt/moje-meteo)
set -e
cd /opt/moje-meteo
git pull origin main

echo "Verzia v repozitári: $(cat VERSION 2>/dev/null || echo '?')"

podman cp server/forecast.js moje-meteo:/app/forecast.js
podman cp server/chart-period.js moje-meteo:/app/chart-period.js
podman cp server/schedule-sync.js moje-meteo:/app/schedule-sync.js
podman cp server/server.js moje-meteo:/app/server.js
podman cp server/ecowitt.js moje-meteo:/app/ecowitt.js
podman cp server/meteo-utils.js moje-meteo:/app/meteo-utils.js
podman cp server/export-data.js moje-meteo:/app/export-data.js
podman cp server/public/. moje-meteo:/app/public/
podman cp VERSION moje-meteo:/app/VERSION

podman restart moje-meteo
sleep 2

echo "--- /api/config (musí sedieť s VERSION) ---"
curl -s http://127.0.0.1:8081/api/config
echo ""

echo "--- súbory v kontajneri ---"
podman exec moje-meteo cat /app/VERSION
podman exec moje-meteo test -f /app/meteo-utils.js && echo "OK: meteo-utils.js" || echo "CHÝBA: meteo-utils.js"
podman exec moje-meteo test -f /app/export-data.js && echo "OK: export-data.js" || echo "CHÝBA: export-data.js"
podman exec moje-meteo grep -o 'v=1\.[0-9.]*' /app/public/index.html | head -3

echo ""
echo "V prehliadači: Ctrl+Shift+R. Ak ostáva stará verzia: DevTools → Application → Service Workers → Unregister."
