#!/bin/sh
# Agresívne odstránenie kontajnera moje-meteo (aj mŕtve / zaseknuté)
set +e
cd /opt/moje-meteo 2>/dev/null || true

echo "=== Odstraňujem moje-meteo ==="

podman stop -t 5 moje-meteo 2>/dev/null
podman rm -fv moje-meteo 2>/dev/null

if podman compose version >/dev/null 2>&1; then
  podman compose down --remove-orphans 2>/dev/null
fi

# Všetky kontajnery s týmto menom (aj Created/Exited)
for id in $(podman ps -a --filter name=moje-meteo -q 2>/dev/null); do
  echo "rm $id"
  podman rm -fv "$id" 2>/dev/null
  podman rm -f --storage "$id" 2>/dev/null
done

podman container prune -f 2>/dev/null

remaining=$(podman ps -a --filter name=moje-meteo -q 2>/dev/null)
if [ -n "$remaining" ]; then
  echo "VAROVANIE: kontajner stále existuje:"
  podman ps -a --filter name=moje-meteo
  echo "Skús ručne: podman rm -f --storage $(echo $remaining | awk '{print $1}')"
  exit 1
fi

echo "OK: meno moje-meteo je voľné."
exit 0
