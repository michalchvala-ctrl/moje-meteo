const XLSX = require('xlsx');
const db = require('./db');
const { aggregateWeatherDaily } = require('./ecowitt');

function num(v) {
  if (v == null || v === '' || v === '-') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function dateFromCell(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function isMinuteTimestamp(v) {
  if (v instanceof Date) return true;
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}/.test(s);
}

function parseRecordedAt(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.toISOString();
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const hh = m[2].padStart(2, '0');
    const mm = m[3].padStart(2, '0');
    const ss = (m[4] || '00').padStart(2, '0');
    const d = new Date(`${m[1]}T${hh}:${mm}:${ss}`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** WS View / Ecowitt export s riadkom jednotiek (Temperature(℃), …) */
function detectWsViewFormat(rows) {
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const r = rows[i];
    if (!r) continue;
    const h = String(r[1] || '');
    if (/temperature/i.test(h) && /humidity/i.test(String(r[4] || ''))) {
      return { startRow: i + 1, cols: 'wsview' };
    }
  }
  return null;
}

function sampleFromRow(row, format) {
  if (format === 'wsview') {
    return {
      outdoor_temp_c: num(row[1]),
      outdoor_humidity: num(row[4]),
      chata_temp_c: num(row[5]),
      chata_humidity: num(row[6]),
      solar_wm2: num(row[9]),
      uv_index: num(row[10]),
      rain_rate_mm: num(row[11]),
      rain_day_mm: num(row[12]),
      wind_speed_kmh: num(row[19]),
      wind_gust_kmh: num(row[20]),
      wind_direction: num(row[21]),
      pressure_hpa: num(row[23]) ?? num(row[24])
    };
  }
  /* Starší denný export GW1100 */
  return {
    outdoor_temp_c: num(row[1]),
    outdoor_temp_min: num(row[2]),
    outdoor_temp_max: num(row[3]),
    outdoor_humidity: num(row[6]),
    chata_temp_c: num(row[9]),
    chata_humidity: num(row[12])
  };
}

function parseGw1100SheetRows(rows) {
  if (!rows || !rows.length) return { daily: [], minute: [] };

  const wsView = detectWsViewFormat(rows);
  let start = 0;

  if (wsView) {
    start = wsView.startRow;
  } else {
    for (let i = 0; i < Math.min(rows.length, 8); i++) {
      const cell0 = rows[i] && rows[i][0];
      if (isMinuteTimestamp(cell0) || (dateFromCell(cell0) && !isMinuteTimestamp(cell0))) {
        start = i;
        break;
      }
    }
  }

  const byDate = new Map();
  const minuteRows = [];
  const format = wsView ? 'wsview' : 'legacy';

  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;

    const cell0 = row[0];
    if (cell0 == null || cell0 === '') continue;

    const sample = sampleFromRow(row, format);
    const hasData = Object.values(sample).some(v => v != null);
    if (!hasData) continue;

    if (isMinuteTimestamp(cell0)) {
      const recorded_at = parseRecordedAt(cell0);
      if (!recorded_at) continue;
      minuteRows.push({ recorded_at, ...sample });
      continue;
    }

    const date = dateFromCell(cell0);
    if (!date) continue;

    if (!byDate.has(date)) {
      byDate.set(date, {
        date,
        outdoor_temps: [],
        outdoor_temp_mins: [],
        outdoor_temp_maxs: [],
        outdoor_humidities: [],
        chata_temps: [],
        chata_humidities: []
      });
    }
    const acc = byDate.get(date);
    if (sample.outdoor_temp_c != null) acc.outdoor_temps.push(sample.outdoor_temp_c);
    if (sample.outdoor_temp_min != null) acc.outdoor_temp_mins.push(sample.outdoor_temp_min);
    if (sample.outdoor_temp_max != null) acc.outdoor_temp_maxs.push(sample.outdoor_temp_max);
    if (sample.outdoor_humidity != null) acc.outdoor_humidities.push(sample.outdoor_humidity);
    if (sample.chata_temp_c != null) acc.chata_temps.push(sample.chata_temp_c);
    if (sample.chata_humidity != null) acc.chata_humidities.push(sample.chata_humidity);
  }

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const minFn = (arr) => (arr.length ? Math.min(...arr) : null);
  const maxFn = (arr) => (arr.length ? Math.max(...arr) : null);

  const daily = [];
  for (const acc of byDate.values()) {
    const outdoor_temp_avg = avg(acc.outdoor_temps);
    daily.push({
      date: acc.date,
      outdoor_temp_avg: outdoor_temp_avg != null ? +outdoor_temp_avg.toFixed(2) : null,
      outdoor_temp_min: minFn(acc.outdoor_temp_mins) ?? (acc.outdoor_temps.length ? minFn(acc.outdoor_temps) : null),
      outdoor_temp_max: maxFn(acc.outdoor_temp_maxs) ?? (acc.outdoor_temps.length ? maxFn(acc.outdoor_temps) : null),
      outdoor_humidity_avg: avg(acc.outdoor_humidities) != null ? +avg(acc.outdoor_humidities).toFixed(1) : null,
      chata_temp_avg: avg(acc.chata_temps) != null ? +avg(acc.chata_temps).toFixed(2) : null,
      chata_humidity_avg: avg(acc.chata_humidities) != null ? +avg(acc.chata_humidities).toFixed(1) : null,
      sample_count: Math.max(acc.outdoor_temps.length, acc.outdoor_humidities.length, acc.chata_temps.length, 1)
    });
  }

  daily.sort((a, b) => a.date.localeCompare(b.date));
  minuteRows.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));

  return { daily, minute: minuteRows };
}

function workbookToRows(wb) {
  const name = wb.SheetNames.includes('result_list') ? 'result_list' : wb.SheetNames[0];
  const sheet = wb.Sheets[name];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
}

function parseXlsxBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  return parseGw1100SheetRows(workbookToRows(wb));
}

function importWeatherDailyRecords(records, { overwrite = true } = {}) {
  if (!records.length) {
    return { imported: 0, skipped: 0, days: 0, dateFrom: null, dateTo: null };
  }

  const existsStmt = db.prepare('SELECT 1 FROM weather_daily WHERE date = ?');
  const upsert = db.prepare(`INSERT INTO weather_daily (
    date, outdoor_temp_avg, outdoor_temp_min, outdoor_temp_max, outdoor_humidity_avg,
    chata_temp_avg, chata_humidity_avg, sample_count
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(date) DO UPDATE SET
    outdoor_temp_avg = excluded.outdoor_temp_avg,
    outdoor_temp_min = excluded.outdoor_temp_min,
    outdoor_temp_max = excluded.outdoor_temp_max,
    outdoor_humidity_avg = excluded.outdoor_humidity_avg,
    chata_temp_avg = excluded.chata_temp_avg,
    chata_humidity_avg = excluded.chata_humidity_avg,
    sample_count = excluded.sample_count`);

  let imported = 0;
  let skipped = 0;

  const tx = db.transaction(() => {
    for (const r of records) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
      if (!overwrite && existsStmt.get(r.date)) {
        skipped++;
        continue;
      }
      upsert.run(
        r.date,
        r.outdoor_temp_avg,
        r.outdoor_temp_min,
        r.outdoor_temp_max,
        r.outdoor_humidity_avg,
        r.chata_temp_avg,
        r.chata_humidity_avg,
        r.sample_count || 1
      );
      imported++;
    }
  });
  tx();

  return {
    imported,
    skipped,
    dateFrom: records[0].date,
    dateTo: records[records.length - 1].date,
    days: records.length
  };
}

function importMinuteSamples(rows, { overwrite = true } = {}) {
  if (!rows.length) return { imported: 0, skipped: 0, dates: [] };

  if (overwrite) {
    const from = rows[0].recorded_at;
    const to = rows[rows.length - 1].recorded_at;
    db.prepare('DELETE FROM weather_samples WHERE recorded_at >= ? AND recorded_at <= ?').run(from, to);
  }

  const insert = db.prepare(`INSERT INTO weather_samples (
    recorded_at, outdoor_temp_c, outdoor_humidity, chata_temp_c, chata_humidity,
    wind_speed_kmh, wind_gust_kmh, wind_direction, rain_rate_mm, rain_day_mm,
    pressure_hpa, solar_wm2, uv_index
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const dates = new Set();
  let imported = 0;
  let skipped = 0;

  const tx = db.transaction(() => {
    for (const r of rows) {
      try {
        insert.run(
          r.recorded_at,
          r.outdoor_temp_c,
          r.outdoor_humidity,
          r.chata_temp_c,
          r.chata_humidity,
          r.wind_speed_kmh ?? null,
          r.wind_gust_kmh ?? null,
          r.wind_direction ?? null,
          r.rain_rate_mm ?? null,
          r.rain_day_mm ?? null,
          r.pressure_hpa ?? null,
          r.solar_wm2 ?? null,
          r.uv_index ?? null
        );
        dates.add(r.recorded_at.slice(0, 10));
        imported++;
      } catch (e) {
        if (String(e.message).includes('UNIQUE')) skipped++;
        else throw e;
      }
    }
  });
  tx();

  for (const d of dates) aggregateWeatherDaily(d);

  return { imported, skipped, dates: [...dates].sort() };
}

module.exports = {
  parseGw1100SheetRows,
  parseXlsxBuffer,
  importWeatherDailyRecords,
  importMinuteSamples
};
