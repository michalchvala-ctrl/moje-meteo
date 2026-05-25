/**
 * Meteo výpočty a agregácie (bez závislosti na Express).
 */

const db = require('./db');
const scheduleSync = require('./schedule-sync');

const TZ = 'Europe/Bratislava';

function todayDateKey(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: TZ });
}

/** Pocitová teplota °C — wind chill (≤10°C, vietor) / heat index (≥27°C, vlhkosť). */
function feelsLikeC(tempC, windKmh, humidityPct) {
  const t = Number(tempC);
  if (tempC == null || Number.isNaN(t)) return null;
  const v = windKmh != null && !Number.isNaN(windKmh) ? Math.max(0, Number(windKmh)) : 0;
  const rh = humidityPct != null && !Number.isNaN(humidityPct)
    ? Math.max(0, Math.min(100, Number(humidityPct)))
    : null;

  if (t <= 10 && v >= 4.8) {
    const wc = 13.12 + 0.6215 * t - 11.37 * Math.pow(v, 0.16)
      + 0.3965 * Math.pow(v, 0.16) * t;
    return Math.round(wc * 10) / 10;
  }

  if (t >= 27 && rh != null && rh >= 40) {
    const hi = -8.78469475556
      + 1.61139411 * t + 2.33854883889 * rh
      + -0.14611605 * t * rh
      + -0.012308094 * t * t
      + -0.0164248277778 * rh * rh
      + 0.002211732 * t * t * rh
      + 0.00072546 * t * rh * rh
      + -0.000003582 * t * t * rh * rh;
    return Math.round(hi * 10) / 10;
  }

  return Math.round(t * 10) / 10;
}

const ROSE_LABELS_SK = [
  'S', 'SSV', 'SV', 'VSV', 'V', 'VJV', 'JV', 'JJV',
  'J', 'JJZ', 'JZ', 'ZJZ', 'Z', 'ZSZ', 'SZ', 'SSZ'
];

function normDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

/** 16 sektorov, vážené rýchlosťou vetra (km/h). */
function buildWindRose(fromIso, toIso, bins = 16) {
  let sql = `
    SELECT wind_direction, wind_speed_kmh
    FROM weather_samples
    WHERE wind_direction IS NOT NULL
  `;
  const params = [];
  if (fromIso) {
    sql += ' AND recorded_at >= ?';
    params.push(fromIso);
  }
  if (toIso) {
    sql += ' AND recorded_at <= ?';
    params.push(toIso);
  }
  const rows = db.prepare(sql).all(...params);

  const sectors = Array.from({ length: bins }, (_, i) => ({
    index: i,
    label: ROSE_LABELS_SK[i],
    deg: i * (360 / bins),
    count: 0,
    speedSum: 0
  }));

  let total = 0;
  for (const r of rows) {
    const deg = normDeg(r.wind_direction);
    const idx = Math.floor((deg + 360 / bins / 2) / (360 / bins)) % bins;
    const spd = r.wind_speed_kmh != null ? Number(r.wind_speed_kmh) : 0;
    sectors[idx].count += 1;
    sectors[idx].speedSum += spd;
    total += 1;
  }

  const maxCount = Math.max(1, ...sectors.map((s) => s.count));
  return {
    bins,
    labels: sectors.map((s) => s.label),
    counts: sectors.map((s) => s.count),
    speeds: sectors.map((s) => (s.count ? Math.round((s.speedSum / s.count) * 10) / 10 : 0)),
    total,
    maxCount
  };
}

function sampleAgeSec(recordedAt) {
  const d = scheduleSync.parseDbTimestamp(recordedAt);
  if (!d) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
}

function formatAge(sec) {
  if (sec == null) return '—';
  if (sec < 60) return `${sec} s`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h ${Math.floor((sec % 3600) / 60)} min`;
  return `${Math.floor(sec / 86400)} d`;
}

function getSystemStatus(ecowittModule) {
  const s = ecowittModule.getSettings();
  const latest = ecowittModule.getLatestSample();
  const todayKey = todayDateKey();
  const today = db.prepare('SELECT * FROM weather_daily WHERE date = ?').get(todayKey);
  const samplesToday = db.prepare(
    'SELECT COUNT(*) AS c FROM weather_samples WHERE date(recorded_at) = ?'
  ).get(todayKey);
  const totalSamples = db.prepare('SELECT COUNT(*) AS c FROM weather_samples').get().c;
  const intervalMin = scheduleSync.clampIntervalMin(s.sync_interval_min || 5);
  const next = scheduleSync.nextAlignedDate(intervalMin);
  const ageSec = sampleAgeSec(latest?.recorded_at);

  return {
    ecowitt_enabled: !!s.ecowitt_enabled,
    sync_interval_min: intervalMin,
    last_sync_at: s.last_sync_at || null,
    last_error: s.last_error || null,
    next_sync_at: next.toISOString(),
    next_sync_label: scheduleSync.formatAlignedTime(next),
    latest_sample_at: latest?.recorded_at || null,
    latest_sample_age_sec: ageSec,
    latest_sample_age_label: formatAge(ageSec),
    samples_today: samplesToday?.c ?? 0,
    daily_aggregate_samples: today?.sample_count ?? null,
    total_samples: totalSamples,
    today_date: todayKey
  };
}

module.exports = {
  TZ,
  todayDateKey,
  feelsLikeC,
  buildWindRose,
  ROSE_LABELS_SK,
  getSystemStatus,
  formatAge,
  sampleAgeSec
};
