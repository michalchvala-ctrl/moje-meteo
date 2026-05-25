# Moje meteo — info a workflow

## Repozitár

- **GitHub:** https://github.com/michalchvala-ctrl/moje-meteo
- **Aktuálna verzia UI:** `1.2.1` (v `index.html` parametre `?v=…`)
- **Produkčný server:** euflix, používateľ `euforik`, port **8081**, cesta `/opt/moje-meteo`

## Ako to funguje (ty vs. Cursor)

| Kto | Čo robí |
|-----|---------|
| **Cursor / agent** | Upraví kód, spraví `git commit` lokálne (súbory pripravené na GitHub) |
| **Ty** | Keď chceš novú verziu na serveri: `git push` → na euflix `git pull` → rebuild/restart |

Agent **nepushuje** automaticky pri každej úprave — ty rozhodneš, kedy ide verzia von (`git push`).

## Nová verzia — kroky pre teba (Windows)

V PowerShelli v priečinku projektu:

```powershell
cd "c:\Users\micha\OneDrive\Dokumenty\meteo"
git status
git push origin main
```

Voliteľne označ verziu tagom:

```powershell
git tag v1.2.1
git push origin v1.2.1
```

## Rýchly deploy na euflix (po `git pull`)

```bash
cd /opt/moje-meteo
chmod +x scripts/deploy-quick.sh
./scripts/deploy-quick.sh
```

Očakávané v `/api/config`: `"version":"1.2.6"` a `"features":{"forecast":true}`.

## Nasadenie na euflix po `git push`

Na serveri (SSH ako `euforik`):

```bash
cd /opt/moje-meteo
git pull origin main
rm -rf server/node_modules
podman build --no-cache -t moje-meteo:latest .
podman rm -f moje-meteo
podman run -d --name moje-meteo --restart unless-stopped -p 8081:8081 \
  -e TZ=Europe/Bratislava -e PORT=8081 -e DB_PATH=/data/meteo.db \
  -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD='TVOJE_HESLO' \
  -e COOKIE_SECURE=false -e TRUST_PROXY=false \
  -v /opt/moje-meteo-data:/data:Z,U \
  moje-meteo:latest
```

Ak meníš len frontend (`server/public/`), stačí rýchlejšie:

```bash
cd /opt/moje-meteo
git pull origin main
podman cp server/public/. moje-meteo:/app/public/
podman restart moje-meteo
```

V prehliadači **Ctrl+F5** (cache `?v=` v HTML).

## Prvé napojenie git na serveri (jednorazovo)

```bash
cd /opt/moje-meteo
git init
git remote add origin https://github.com/michalchvala-ctrl/moje-meteo.git
git fetch origin
git checkout -b main origin/main
```

Ak tam už máš ručne nakopírovaný kód, radšej zálohuj `moje-meteo-data` a potom `git pull`.

## Čo sa na GitHub **nedáva**

- `server/data/` — databáza, JWT secret
- `server/node_modules/`
- `.env`, heslá, Ecowitt API kľúče

Tieto veci ostávajú len na serveri / v Nastaveniach aplikácie.

## Funkcie aplikácie (stručne)

- Ecowitt GW1100 — sync každých 5 min, SQLite, grafy
- Naživo — animovaná scéna podľa počasia
- Predpoveď 1–7 dní — Open-Meteo, lokalita v Nastaveniach
- Upozornenia na teplotu, import Excelu, PWA

## Kontakt / účty

- GitHub: `michalchvala-ctrl`
- Server SSH: `euforik@euflix` (nie `micha@euflix`)
