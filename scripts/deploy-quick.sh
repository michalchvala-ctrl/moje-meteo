#!/bin/sh
# Rýchly deploy na euflix (spusti na serveri v /opt/moje-meteo)
set -e
cd /opt/moje-meteo
git pull origin main
podman cp server/forecast.js moje-meteo:/app/forecast.js
podman cp server/server.js moje-meteo:/app/server.js
podman cp server/public/. moje-meteo:/app/public/
podman cp VERSION moje-meteo:/app/VERSION
podman restart moje-meteo
echo "--- /api/config ---"
sleep 2
curl -s http://127.0.0.1:8081/api/config
echo ""
echo "Skontroluj forecast v server.js:"
podman exec moje-meteo grep -n "forecast" /app/server.js | head -5
