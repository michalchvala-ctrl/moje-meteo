# Moje meteo

[![GitHub](https://img.shields.io/github/v/tag/michalchvala-ctrl/moje-meteo?label=verzia)](https://github.com/michalchvala-ctrl/moje-meteo)

Samostatná **PWA** pre Ecowitt GW1100 (Vonku, Chata, rezerva pre budúci Kurník). Vizuál zladený s projektom Môj kurník — modrá UI téma, zelené grafy Vonku, karty, Chart.js, tmavý režim, mobilná navigácia.

**Nie je súčasťou kurníka** — vlastná SQLite DB, vlastný kontajner, port **8081**.

**Workflow a nasadenie:** pozri [INFO.md](./INFO.md).

## Funkcie

- Sync z `api.ecowitt.net` každých 5 min (zarovnaný čas)
- Vzorky do SQLite + denné agregáty (min/max/priemer)
- Prehľad, **Naživo** (animovaná scéna), grafy (24 h / 7 d / 30 d / rok)
- **Predpoveď 1–7 dní** (Open-Meteo, lokalita v Nastaveniach)
- Prahy teploty, in-app bannery + história upozornení (cooldown)
- Import `all_GW1100….xlsx` (denné + minútové riadky)
- Jeden admin účet (env alebo prvý bootstrap)

## GitHub

```bash
git clone https://github.com/michalchvala-ctrl/moje-meteo.git
cd moje-meteo
```

Nová verzia: `git push` z PC → na serveri `git pull` (detaily v [INFO.md](./INFO.md)).

## Lokálny vývoj

```bash
cd server
npm install
set ADMIN_USERNAME=admin
set ADMIN_PASSWORD=tajne
set PORT=8081
npm run dev
```

Otvor http://localhost:8081

## Build (Docker / Podman)

```bash
cd meteo
podman build -t moje-meteo:latest .
# alebo: docker build -t moje-meteo:latest .
```

## Spustenie na **euflix** vedľa kurníka

Predpoklad: kurník (`monitorvajec`) už beží na porte **8080**, dáta v `/data` alebo `/mnt/.../kurnik`.

### 1. Priečinky na serveri (euflix) — najprv vytvor, potom kopíruj

Na **serveri** (SSH):

```bash
# kód aplikácie (Dockerfile, server/, compose.yaml)
sudo mkdir -p /opt/moje-meteo

# dáta kontajnera — iba meteo.db a .jwt-secret (NIE sem dávaj zdrojáky)
sudo mkdir -p /opt/moje-meteo-data
# Rootless podman: použi :U pri mounte (nižšie), alebo:
# podman unshare chown -R $(id -u):$(id -g) /opt/moje-meteo-data
# Rootful podman: chown 100:101 (user „app“ v Alpine image)
```

Štruktúra po nasadení:

```text
/opt/moje-meteo/          ← projekt (build odtiaľ)
/opt/moje-meteo-data/     ← volume /data (meteo.db, .jwt-secret)
```

Z **PC** skopíruj projekt do **/opt/moje-meteo** (nie do moje-meteo-data):

```bash
# z priečinka, kde máš lokálny „meteo“ (rodičovský adresár projektu)
scp -r meteo euforik@euflix:/tmp/meteo-upload
ssh euforik@euflix "sudo mv /tmp/meteo-upload /opt/moje-meteo && sudo chown -R root:root /opt/moje-meteo"
```

Ak už máš omylom kód v `/opt/moje-meteo-data/meteo`:

```bash
sudo mv /opt/moje-meteo-data/meteo /opt/moje-meteo
```

### 2. Spustenie cez Podman (odporúčané na Debian)

```bash
cd /opt/moje-meteo
podman build -t moje-meteo:latest .

podman run -d \
  --name moje-meteo \
  --restart unless-stopped \
  -p 8081:8081 \
  -e TZ=Europe/Bratislava \
  -e PORT=8081 \
  -e DB_PATH=/data/meteo.db \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD='TVOJE_SILNE_HESLO' \
  -e COOKIE_SECURE=false \
  -e TRUST_PROXY=false \
  -v /opt/moje-meteo-data:/data:Z,U \
  moje-meteo:latest
```

`:U` = pri rootless Podman nastaví vlastníka volume podľa používateľa v kontajneri (inak `SQLITE_CANTOPEN`).

Ak máš **reverse proxy** (nginx/Caddy) pred kurníkom s HTTPS, nastav `COOKIE_SECURE=true` a `TRUST_PROXY=true`.

### 3. Compose (alternatíva)

```bash
cd /opt/moje-meteo
export METEO_ADMIN_PASSWORD='TVOJE_SILNE_HESLO'
podman compose up -d --build
```

### 4. Firewall / proxy

- Priamy prístup: `http://euflix:8081`
- Alebo proxy napr. `meteo.tvojadomena.sk` → `127.0.0.1:8081` (kurník ostáva na 8080)

### 5. Prvé spustenie

1. Otvor Web UI, prihlás sa (`admin` + heslo z env).
2. **Nastavenia** → Ecowitt: MAC `34:94:54:96:29:B3`, Application key + API key z [api.ecowitt.net](https://api.ecowitt.net).
3. Zapni sync, **Otestovať API**, potom **Sync**.
4. Voliteľne: import Excelu `all_GW1100….xlsx`.
5. Nastav prahy teploty pre Vonku / Chatu.

### 6. PWA na mobile

V Chrome/Safari: *Pridať na plochu*. Ikona: `/icon.svg`.

## API (prehľad)

| Metóda | Cesta | Popis |
|--------|--------|--------|
| GET | `/api/config` | Verejná konfigurácia |
| POST | `/api/login` | Prihlásenie |
| GET/PUT | `/api/settings` | Ecowitt + prahy |
| POST | `/api/sync` | Manuálny sync |
| GET | `/api/current` | Aktuálne + dnes + bannery |
| GET | `/api/samples?from=&to=` | Vzorky |
| GET | `/api/daily?from=&to=` | Denné agregáty |
| GET | `/api/chart-data?period=&resolution=` | Dáta pre grafy |
| POST | `/api/weather/import` | Excel (multipart `file`) |
| GET | `/api/alerts` | Zoznam upozornení |
| GET | `/api/forecast` | Denná predpoveď (Open-Meteo) |
| GET | `/api/forecast/geocode?q=` | Hľadanie lokality |

Všetky okrem `/api/config` a auth vyžadujú prihlásenie (cookie JWT).

## Riešenie problémov

### `better_sqlite3.node: Exec format error`

Na server sa dostali **Windows `node_modules`** a pri `COPY server/` prepísali linux binding z Docker buildu.

Na serveri pred rebuildom:

```bash
rm -rf /opt/moje-meteo/server/node_modules
cd /opt/moje-meteo
podman rm -f moje-meteo
podman build --no-cache -t moje-meteo:latest .
# potom znova podman run ... (alebo compose)
```

V repozitári je `.dockerignore` (`server/node_modules`), aby sa to už nestalo.

## Záloha

```bash
podman exec moje-meteo ls -la /data
# zálohuj súbor meteo.db a .jwt-secret
cp /opt/moje-meteo-data/meteo.db ~/backup/
```

## Jednotky

Ukladané v **°C**, **%**, **km/h**, **mm**, **hPa**. API môže posielať °F / mph / in — server konvertuje pri sync.
