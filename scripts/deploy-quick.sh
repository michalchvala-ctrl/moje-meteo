#!/bin/sh
# Rýchly deploy na euflix (spusti na serveri v /opt/moje-meteo)
set -e
cd /opt/moje-meteo
git pull origin main

echo "Verzia v repozitári: $(cat VERSION 2>/dev/null || echo '?')"

podman cp server/forecast.js moje-meteo:/app/forecast.js
# forecast.js = logika uloženej lokality (Skalica vs. predvolená BA)
podman cp server/server.js moje-meteo:/app/server.js
podman cp server/public/. moje-meteo:/app/public/
podman cp VERSION moje-meteo:/app/VERSION

podman restart moje-meteo
sleep 2

echo "--- /api/config (musí sedieť s VERSION) ---"
curl -s http://127.0.0.1:8081/api/config
echo ""

echo "--- súbory v kontajneri ---"
podman exec moje-meteo cat /app/VERSION
podman exec moje-meteo test -f /app/public/radar.js && echo "OK: radar.js" || echo "CHÝBA: radar.js"
podman exec moje-meteo grep -o 'v=1\.[0-9.]*' /app/public/index.html | head -3

echo ""
echo "V prehliadači: Ctrl+Shift+R. Ak ostáva stará verzia: DevTools → Application → Service Workers → Unregister."
