#!/bin/sh
# Len štart (bez buildu) — image moje-meteo:latest už musí existovať
set -e
cd /opt/moje-meteo

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

bash scripts/remove-meteo-container.sh

echo "Štartujem moje-meteo:latest…"
podman run -d \
  --name moje-meteo \
  --replace \
  --restart unless-stopped \
  -p 8081:8081 \
  -e TZ=Europe/Bratislava \
  -e PORT=8081 \
  -e DB_PATH=/data/meteo.db \
  -e ADMIN_USERNAME="${ADMIN_USERNAME:-admin}" \
  -e ADMIN_PASSWORD="${ADMIN_PASSWORD:-${METEO_ADMIN_PASSWORD:-zmen-heslo}}" \
  -e COOKIE_SECURE=false \
  -e TRUST_PROXY=false \
  -v /opt/moje-meteo-data:/data:Z,U \
  moje-meteo:latest

sleep 2
curl -s http://127.0.0.1:8081/api/config
echo ""
