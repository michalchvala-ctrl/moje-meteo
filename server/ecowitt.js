const db = require('./db');
const { checkTemperatureAlerts } = require('./alerts');
const {
  alignedSampleTimestamp, clampIntervalMin, nowIso
} = require('./schedule-sync');

const ECOWITT_REALTIME_URL = 'https://api.ecowitt.net/api/v3/device/real_time';

function fToC(f) {
  const n = parseFloat(f);
  if (isNaN(n)) return null;
  return +((n - 32) * 5 / 9).toFixed(2);
}

function mphToKmh(mph) {
  const n = parseFloat(mph);
  if (isNaN(n)) return null;
  return +(n * 1.60934).toFixed(2);
}

function inToMm(inches) {
  const n = parseFloat(inches);
  if (isNaN(n)) return null;
  return +(n * 25.4).toFixed(2);
}

function inHgToHpa(inHg) {
  const n = parseFloat(inHg);
  if (isNaN(n)) return null;
  return +(n * 33.8639).toFixed(1);
}

function sensorRaw(block, key) {
  if (!block || block[key] == null) return null;
  const raw = block[key];
  if (typeof raw === 'object' && raw !== null && 'value' in raw) {
    return { value: raw.value, unit: raw.unit || '' };
  }
  return { value: raw, unit: '' };
}

function sensorNumeric(block, key) {
  const r = sensorRaw(block, key);
  if (!r) return null;
  const n = parseFloat(r.value);
  return isNaN(n) ? null : n;
}

function tempToC(block, key) {
  const r = sensorRaw(block, key);
  if (!r) return null;
  const n = parseFloat(r.value);
  if (isNaN(n)) return null;
  const u = String(r.unit || '').toLowerCase();
  if (u.includes('c') || u === '°c') return +n.toFixed(2);
  return fToC(n);
}

function speedToKmh(block, key) {
  const r = sensorRaw(block, key);
  if (!r) return null;
  const n = parseFloat(r.value);
  if (isNaN(n)) return null;
  const u = String(r.unit || '').toLowerCase();
  if (u.includes('km')) return +n.toFixed(2);
  if (u.includes('m/s') || u === 'ms') return +(n * 3.6).toFixed(2);
  return mphToKmh(n);
}

function rainToMm(block, key) {
  const r = sensorRaw(block, key);
  if (!r) return null;
  const n = parseFloat(r.value);
  if (isNaN(n)) return null;
  const u = String(r.unit || '').toLowerCase();
  if (u.includes('mm')) return +n.toFixed(2);
  return inToMm(n);
}

function pressureToHpa(block, key) {
  const r = sensorRaw(block, key);
  if (!r) return null;
  const n = parseFloat(r.value);
  if (isNaN(n)) return null;
  const u = String(r.unit || '').toLowerCase();
  if (u.includes('hpa') || u.includes('mbar')) return +n.toFixed(1);
  if (u.includes('inhg')) return inHgToHpa(n);
  if (n > 500 && n < 1100) return +n.toFixed(1);
  return inHgToHpa(n);
}

function findIndoorBlock(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.indoor) return data.indoor;
  const key = Object.keys(data).find(k => /^indoor\d*$/i.test(k));
  return key ? data[key] : null;
}

function parseEcowittRealtime(json) {
  if (!json || json.code !== 0) {
    const msg = (json && json.msg) || 'Ecowitt API chyba';
    throw new Error(msg);
  }
  const data = json.data || {};
  const outdoor = data.outdoor || {};
  const indoor = findIndoorBlock(data);
  const wind = data.wind || {};
  const rain = data.rainfall || data.rain || {};
  const pressure = data.pressure || {};
  const solar = data.solar_and_uvi || data.solar || {};

  return {
    outdoor_temp_c: tempToC(outdoor, 'temperature'),
    outdoor_humidity: sensorNumeric(outdoor, 'humidity'),
    chata_temp_c: tempToC(indoor, 'temperature'),
    chata_humidity: sensorNumeric(indoor, 'humidity'),
    coop_temp_c: null,
    coop_humidity: null,
    wind_speed_kmh: speedToKmh(wind, 'wind_speed') ?? speedToKmh(wind, 'speed'),
    wind_gust_kmh: speedToKmh(wind, 'wind_gust') ?? speedToKmh(wind, 'gust'),
    wind_direction: sensorNumeric(wind, 'wind_direction') ?? sensorNumeric(wind, 'direction'),
    rain_rate_mm: rainToMm(rain, 'rain_rate') ?? rainToMm(rain, 'rate'),
    rain_day_mm: rainToMm(rain, 'daily') ?? rainToMm(rain, 'rain_day'),
    pressure_hpa: pressureToHpa(pressure, 'relative') ?? pressureToHpa(pressure, 'absolute'),
    solar_wm2: sensorNumeric(solar, 'solar'),
    uv_index: sensorNumeric(solar, 'uvi') ?? sensorNumeric(solar, 'uv')
  };
}

async function ecowittHttpFetch(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Ecowitt HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function getSettings() {
  return db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
}

function buildRealtimeUrl(settings) {
  const url = new URL(ECOWITT_REALTIME_URL);
  url.searchParams.set('application_key', settings.application_key);
  url.searchParams.set('api_key', settings.api_key);
  url.searchParams.set('mac', settings.mac);
  url.searchParams.set('call_back', 'all');
  return url.toString();
}

async function fetchEcowittRealtime(settings) {
  if (!settings.application_key || !settings.api_key || !settings.mac) {
    throw new Error('Chýba application key, API key alebo MAC.');
  }
  const json = await ecowittHttpFetch(buildRealtimeUrl(settings));
  return parseEcowittRealtime(json);
}

function storeWeatherSample(parsed) {
  const settings = getSettings();
  const intervalMin = clampIntervalMin(settings.sync_interval_min || 5);
  const recordedAt = alignedSampleTimestamp(intervalMin);

  const existing = db.prepare(
    'SELECT id FROM weather_samples WHERE recorded_at = ?'
  ).get(recordedAt);

  const cols = `outdoor_temp_c = ?, outdoor_humidity = ?, chata_temp_c = ?, chata_humidity = ?,
    coop_temp_c = ?, coop_humidity = ?, wind_speed_kmh = ?, wind_gust_kmh = ?, wind_direction = ?,
    rain_rate_mm = ?, rain_day_mm = ?, pressure_hpa = ?, solar_wm2 = ?, uv_index = ?`;
  const vals = [
    parsed.outdoor_temp_c,
    parsed.outdoor_humidity,
    parsed.chata_temp_c,
    parsed.chata_humidity,
    parsed.coop_temp_c,
    parsed.coop_humidity,
    parsed.wind_speed_kmh,
    parsed.wind_gust_kmh,
    parsed.wind_direction,
    parsed.rain_rate_mm,
    parsed.rain_day_mm,
    parsed.pressure_hpa,
    parsed.solar_wm2,
    parsed.uv_index
  ];

  if (existing) {
    db.prepare(`UPDATE weather_samples SET ${cols} WHERE id = ?`).run(...vals, existing.id);
  } else {
    db.prepare(`INSERT INTO weather_samples (
    recorded_at, outdoor_temp_c, outdoor_humidity, chata_temp_c, chata_humidity,
    coop_temp_c, coop_humidity, wind_speed_kmh, wind_gust_kmh, wind_direction,
    rain_rate_mm, rain_day_mm, pressure_hpa, solar_wm2, uv_index
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    recordedAt,
    ...vals
  );
  }
  const date = recordedAt.slice(0, 10);
  aggregateWeatherDaily(date);
  checkTemperatureAlerts(parsed);
  return { recordedAt, date };
}

function aggregateWeatherDaily(date) {
  const row = db.prepare(`
    SELECT
      AVG(outdoor_temp_c) AS outdoor_temp_avg,
      MIN(outdoor_temp_c) AS outdoor_temp_min,
      MAX(outdoor_temp_c) AS outdoor_temp_max,
      AVG(outdoor_humidity) AS outdoor_humidity_avg,
      AVG(chata_temp_c) AS chata_temp_avg,
      AVG(chata_humidity) AS chata_humidity_avg,
      AVG(coop_temp_c) AS coop_temp_avg,
      AVG(coop_humidity) AS coop_humidity_avg,
      MAX(wind_speed_kmh) AS wind_speed_max_kmh,
      MAX(wind_gust_kmh) AS wind_gust_max_kmh,
      MAX(rain_day_mm) AS rain_day_mm,
      AVG(pressure_hpa) AS pressure_avg_hpa,
      MAX(solar_wm2) AS solar_max_wm2,
      MAX(uv_index) AS uv_max,
      COUNT(*) AS sample_count
    FROM weather_samples
    WHERE date(recorded_at) = ?
  `).get(date);

  if (!row || !row.sample_count) {
    db.prepare('DELETE FROM weather_daily WHERE date = ?').run(date);
    return null;
  }

  const round = (v, d) => (v != null ? +Number(v).toFixed(d) : null);

  db.prepare(`INSERT INTO weather_daily (
    date, outdoor_temp_avg, outdoor_temp_min, outdoor_temp_max, outdoor_humidity_avg,
    chata_temp_avg, chata_humidity_avg, coop_temp_avg, coop_humidity_avg,
    wind_speed_max_kmh, wind_gust_max_kmh, rain_day_mm, pressure_avg_hpa,
    solar_max_wm2, uv_max, sample_count
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(date) DO UPDATE SET
    outdoor_temp_avg = excluded.outdoor_temp_avg,
    outdoor_temp_min = excluded.outdoor_temp_min,
    outdoor_temp_max = excluded.outdoor_temp_max,
    outdoor_humidity_avg = excluded.outdoor_humidity_avg,
    chata_temp_avg = excluded.chata_temp_avg,
    chata_humidity_avg = excluded.chata_humidity_avg,
    coop_temp_avg = excluded.coop_temp_avg,
    coop_humidity_avg = excluded.coop_humidity_avg,
    wind_speed_max_kmh = excluded.wind_speed_max_kmh,
    wind_gust_max_kmh = excluded.wind_gust_max_kmh,
    rain_day_mm = excluded.rain_day_mm,
    pressure_avg_hpa = excluded.pressure_avg_hpa,
    solar_max_wm2 = excluded.solar_max_wm2,
    uv_max = excluded.uv_max,
    sample_count = excluded.sample_count
  `).run(
    date,
    round(row.outdoor_temp_avg, 2),
    round(row.outdoor_temp_min, 2),
    round(row.outdoor_temp_max, 2),
    round(row.outdoor_humidity_avg, 1),
    round(row.chata_temp_avg, 2),
    round(row.chata_humidity_avg, 1),
    row.coop_temp_avg,
    row.coop_humidity_avg,
    round(row.wind_speed_max_kmh, 2),
    round(row.wind_gust_max_kmh, 2),
    round(row.rain_day_mm, 2),
    round(row.pressure_avg_hpa, 1),
    round(row.solar_max_wm2, 0),
    round(row.uv_max, 1),
    row.sample_count
  );

  return db.prepare('SELECT * FROM weather_daily WHERE date = ?').get(date);
}

async function syncEcowitt() {
  const s = getSettings();
  if (!s.application_key || !s.api_key || !s.mac) {
    throw new Error('Ecowitt nie je nakonfigurované (kľúče alebo MAC).');
  }
  try {
    const parsed = await fetchEcowittRealtime(s);
    const meta = storeWeatherSample(parsed);
    db.prepare(`UPDATE app_settings SET last_sync_at = ?, last_error = NULL WHERE id = 1`).run(nowIso());
    return { ok: true, readings: parsed, ...meta };
  } catch (e) {
    const err = String(e.message || e).slice(0, 200);
    db.prepare(`UPDATE app_settings SET last_error = ? WHERE id = 1`).run(err);
    throw e;
  }
}

function getLatestSample() {
  return db.prepare('SELECT * FROM weather_samples ORDER BY recorded_at DESC LIMIT 1').get();
}

function getTodayDaily() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Bratislava' });
  return db.prepare('SELECT * FROM weather_daily WHERE date = ?').get(today);
}

function settingsForClient(extra = {}) {
  const s = getSettings();
  return {
    ...extra,
    ecowitt: {
      enabled: !!s.ecowitt_enabled,
      mac: s.mac || '',
      application_key_set: !!s.application_key,
      api_key_set: !!s.api_key,
      sync_interval_min: s.sync_interval_min || 5,
      last_sync_at: s.last_sync_at || null,
      last_error: s.last_error || null
    },
    alerts: {
      outdoor_enabled: !!s.alert_outdoor_enabled,
      outdoor_min: s.alert_outdoor_min,
      outdoor_max: s.alert_outdoor_max,
      chata_enabled: !!s.alert_chata_enabled,
      chata_min: s.alert_chata_min,
      chata_max: s.alert_chata_max,
      approach_delta_c: s.alert_approach_delta_c ?? 2,
      cooldown_min: s.alert_cooldown_min ?? 60
    }
  };
}

async function schedulerTick() {
  const s = getSettings();
  if (!s.ecowitt_enabled) return;
  if (!s.application_key || !s.api_key || !s.mac) return;
  try {
    await syncEcowitt();
    console.log('[meteo] sync OK');
  } catch (e) {
    console.error('[meteo] sync FAIL:', e.message);
  }
}

module.exports = {
  parseEcowittRealtime,
  fetchEcowittRealtime,
  getSettings,
  syncEcowitt,
  storeWeatherSample,
  aggregateWeatherDaily,
  getLatestSample,
  getTodayDaily,
  settingsForClient,
  schedulerTick
};
