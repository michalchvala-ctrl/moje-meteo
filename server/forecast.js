const db = require('./db');

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const TZ = 'Europe/Bratislava';
const DEFAULT_LAT = 48.1486;
const DEFAULT_LON = 17.1077;
const DEFAULT_NAME = 'Bratislava';

const cache = new Map();
const CACHE_MS = 45 * 60 * 1000;

const WMO = {
  0: { label: 'Jasno', icon: '☀️' },
  1: { label: 'Prevažne jasno', icon: '🌤️' },
  2: { label: 'Polojasno', icon: '⛅' },
  3: { label: 'Oblačno', icon: '☁️' },
  45: { label: 'Hmla', icon: '🌫️' },
  48: { label: 'Námraza', icon: '🌫️' },
  51: { label: 'Mrholenie', icon: '🌦️' },
  53: { label: 'Mrholenie', icon: '🌦️' },
  55: { label: 'Husté mrholenie', icon: '🌧️' },
  56: { label: 'Mrznúce mrholenie', icon: '🌧️' },
  57: { label: 'Mrznúce mrholenie', icon: '🌧️' },
  61: { label: 'Dážď', icon: '🌧️' },
  63: { label: 'Dážď', icon: '🌧️' },
  65: { label: 'Silný dážď', icon: '🌧️' },
  66: { label: 'Mrznúci dážď', icon: '🌨️' },
  67: { label: 'Mrznúci dážď', icon: '🌨️' },
  71: { label: 'Sneženie', icon: '❄️' },
  73: { label: 'Sneženie', icon: '❄️' },
  75: { label: 'Silné sneženie', icon: '❄️' },
  77: { label: 'Snehové zrná', icon: '❄️' },
  80: { label: 'Prehánky', icon: '🌦️' },
  81: { label: 'Prehánky', icon: '🌦️' },
  82: { label: 'Silné prehánky', icon: '⛈️' },
  85: { label: 'Snehové prehánky', icon: '🌨️' },
  86: { label: 'Snehové prehánky', icon: '🌨️' },
  95: { label: 'Búrka', icon: '⛈️' },
  96: { label: 'Búrka s krupobitím', icon: '⛈️' },
  99: { label: 'Silná búrka s krupobitím', icon: '⛈️' }
};

function wmoInfo(code) {
  return WMO[code] || { label: 'Počasie', icon: '🌡️' };
}

function migrateForecastColumns() {
  const cols = db.prepare('PRAGMA table_info(app_settings)').all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('forecast_lat')) {
    db.exec(`
      ALTER TABLE app_settings ADD COLUMN forecast_lat REAL DEFAULT ${DEFAULT_LAT};
      ALTER TABLE app_settings ADD COLUMN forecast_lon REAL DEFAULT ${DEFAULT_LON};
      ALTER TABLE app_settings ADD COLUMN forecast_location_name TEXT DEFAULT '${DEFAULT_NAME}';
      ALTER TABLE app_settings ADD COLUMN forecast_days INTEGER NOT NULL DEFAULT 7;
    `);
  }
}
migrateForecastColumns();

function getRow() {
  return db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
}

function getConfig() {
  const s = getRow();
  const days = Math.max(1, Math.min(7, parseInt(s.forecast_days, 10) || 7));
  return {
    lat: s.forecast_lat != null ? Number(s.forecast_lat) : DEFAULT_LAT,
    lon: s.forecast_lon != null ? Number(s.forecast_lon) : DEFAULT_LON,
    name: s.forecast_location_name || DEFAULT_NAME,
    days
  };
}

function clientSettings() {
  const s = getRow();
  const days = Math.max(1, Math.min(7, parseInt(s.forecast_days, 10) || 7));
  const lat = s.forecast_lat != null ? Number(s.forecast_lat) : DEFAULT_LAT;
  const lon = s.forecast_lon != null ? Number(s.forecast_lon) : DEFAULT_LON;
  const name = (s.forecast_location_name || '').trim();
  return {
    lat,
    lon,
    name,
    label: name || DEFAULT_NAME,
    days
  };
}

function updateSettings(f) {
  const cur = getRow();
  const lat = f.lat != null ? parseFloat(f.lat) : cur.forecast_lat;
  const lon = f.lon != null ? parseFloat(f.lon) : cur.forecast_lon;
  const name = f.name !== undefined
    ? String(f.name || '').trim()
    : cur.forecast_location_name;
  const days = f.days != null
    ? Math.max(1, Math.min(7, parseInt(f.days, 10) || 7))
    : cur.forecast_days;

  if (lat != null && (isNaN(lat) || lat < -90 || lat > 90)) {
    throw new Error('Neplatná zemepisná šírka.');
  }
  if (lon != null && (isNaN(lon) || lon < -180 || lon > 180)) {
    throw new Error('Neplatná zemepisná dĺžka.');
  }

  db.prepare(`UPDATE app_settings SET
    forecast_lat = ?,
    forecast_lon = ?,
    forecast_location_name = ?,
    forecast_days = ?
    WHERE id = 1`).run(
    lat ?? DEFAULT_LAT,
    lon ?? DEFAULT_LON,
    name,
    days ?? 7
  );

  cache.clear();
  return clientSettings();
}

async function fetchJson(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function geocode(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const url = new URL(GEO_URL);
  url.searchParams.set('name', q);
  url.searchParams.set('count', '8');
  url.searchParams.set('language', 'sk');
  url.searchParams.set('format', 'json');
  const json = await fetchJson(url.toString());
  return (json.results || []).map((r) => ({
    name: r.name,
    country: r.country || '',
    admin1: r.admin1 || '',
    lat: r.latitude,
    lon: r.longitude,
    label: [r.name, r.admin1, r.country].filter(Boolean).join(', ')
  }));
}

function formatDayLabel(isoDate) {
  const d = new Date(isoDate + 'T12:00:00');
  const today = new Date();
  const todayStr = today.toLocaleDateString('en-CA', { timeZone: TZ });
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: TZ });
  if (isoDate === todayStr) return 'Dnes';
  if (isoDate === tomorrowStr) return 'Zajtra';
  return d.toLocaleDateString('sk-SK', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: TZ });
}

async function fetchForecast(daysOverride) {
  const cfg = getConfig();
  const days = daysOverride != null
    ? Math.max(1, Math.min(7, parseInt(daysOverride, 10) || cfg.days))
    : cfg.days;

  const cacheKey = `${cfg.lat},${cfg.lon},${days}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const url = new URL(FORECAST_URL);
  url.searchParams.set('latitude', String(cfg.lat));
  url.searchParams.set('longitude', String(cfg.lon));
  url.searchParams.set('timezone', TZ);
  url.searchParams.set('forecast_days', String(days));
  url.searchParams.set('daily', [
    'weather_code',
    'temperature_2m_max',
    'temperature_2m_min',
    'precipitation_sum',
    'precipitation_probability_max',
    'wind_speed_10m_max',
    'wind_gusts_10m_max',
    'sunrise',
    'sunset'
  ].join(','));

  const json = await fetchJson(url.toString());
  const daily = json.daily || {};
  const rows = [];

  for (let i = 0; i < (daily.time || []).length && i < days; i++) {
    const code = daily.weather_code?.[i] ?? 0;
    const info = wmoInfo(code);
    rows.push({
      date: daily.time[i],
      label: formatDayLabel(daily.time[i]),
      weather_code: code,
      summary: info.label,
      icon: info.icon,
      temp_max_c: daily.temperature_2m_max?.[i] ?? null,
      temp_min_c: daily.temperature_2m_min?.[i] ?? null,
      rain_mm: daily.precipitation_sum?.[i] ?? null,
      rain_prob_pct: daily.precipitation_probability_max?.[i] ?? null,
      wind_max_kmh: daily.wind_speed_10m_max?.[i] ?? null,
      gust_max_kmh: daily.wind_gusts_10m_max?.[i] ?? null,
      sunrise: daily.sunrise?.[i] ?? null,
      sunset: daily.sunset?.[i] ?? null
    });
  }

  const data = {
    location: { name: cfg.name, lat: cfg.lat, lon: cfg.lon },
    days: rows.length,
    timezone: TZ,
    provider: 'Open-Meteo',
    fetched_at: new Date().toISOString(),
    daily: rows
  };

  cache.set(cacheKey, { at: Date.now(), data });
  return data;
}

module.exports = {
  clientSettings,
  updateSettings,
  geocode,
  fetchForecast,
  wmoInfo
};
