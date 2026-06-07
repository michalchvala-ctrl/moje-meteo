#!/bin/sh
# Obnova kontajnera moje-meteo (ak zmizol alebo je poškodený)
set -e
cd /opt/moje-meteo

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

remove_meteo_container() {
  echo "Odstraňujem starý kontajner moje-meteo…"
  podman stop moje-meteo 2>/dev/null || true
  podman rm -f moje-meteo 2>/dev/null || true
  if podman compose version >/dev/null 2>&1; then
    podman compose down 2>/dev/null || true
  fi
  for id in $(podman ps -aq --filter name=moje-meteo 2>/dev/null); do
    podman rm -f "$id" 2>/dev/null || true
  done
}

echo "=== Obnova kontajnera moje-meteo ==="
echo "Verzia v repozitári: $(cat VERSION 2>/dev/null || echo '?')"

remove_meteo_container
rm -rf server/node_modules

echo "Build image (môže trvať 1–2 min)…"
podman build -t moje-meteo:latest .

# Ešte raz pred štartom (po build-e môže ostať mŕtvy kontajner)
remove_meteo_container

if podman container exists moje-meteo 2>/dev/null; then
  echo "CHYBA: meno moje-meteo je stále obsadené. Skús: podman rm -f moje-meteo"
  podman ps -a --filter name=moje-meteo
  exit 1
fi

if podman compose version >/dev/null 2>&1; then
  echo "Spúšťam cez podman compose…"
  METEO_ADMIN_PASSWORD="${METEO_ADMIN_PASSWORD:-${ADMIN_PASSWORD:-zmen-heslo}}" \
    podman compose up -d
else
  echo "Spúšťam cez podman run…"
  podman run -d \
    --name moje-meteo \
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
fi

sleep 3
echo ""
curl -s http://127.0.0.1:8081/api/config
echo ""
podman exec moje-meteo cat /app/VERSION 2>/dev/null || true
podman exec moje-meteo test -f /app/radar-tiles.js && echo "OK: radar-tiles.js" || echo "CHÝBA: radar-tiles.js"
echo ""
echo "Hotovo. V prehliadači Ctrl+Shift+R."
