const db = require('./db');
const XLSX = require('xlsx');

const CSV_COLUMNS = [
  'recorded_at', 'outdoor_temp_c', 'outdoor_humidity', 'chata_temp_c', 'chata_humidity',
  'coop_temp_c', 'coop_humidity', 'wind_speed_kmh', 'wind_gust_kmh', 'wind_direction',
  'rain_rate_mm', 'rain_day_mm', 'pressure_hpa', 'solar_wm2', 'uv_index'
];

function querySamplesForExport(from, to) {
  let sql = `SELECT ${CSV_COLUMNS.join(', ')} FROM weather_samples WHERE 1=1`;
  const params = [];
  if (from) {
    sql += ' AND recorded_at >= ?';
    params.push(from);
  }
  if (to) {
    sql += ' AND recorded_at <= ?';
    params.push(to);
  }
  sql += ' ORDER BY recorded_at ASC';
  return db.prepare(sql).all(...params);
}

function rowsToCsv(rows) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push(CSV_COLUMNS.map((c) => esc(r[c])).join(','));
  }
  return lines.join('\r\n');
}

function rowsToXlsxBuffer(rows) {
  const data = rows.map((r) => {
    const o = {};
    for (const c of CSV_COLUMNS) o[c] = r[c] ?? '';
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(data, { header: CSV_COLUMNS });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'samples');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function exportSamples({ from, to, format }) {
  const rows = querySamplesForExport(from, to);
  if (!rows.length) {
    throw new Error('V zvolenom rozsahu nie sú žiadne záznamy.');
  }
  const fmt = (format || 'csv').toLowerCase();
  if (fmt === 'xlsx' || fmt === 'excel') {
    return {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `meteo-export-${from?.slice(0, 10) || 'all'}-${to?.slice(0, 10) || 'all'}.xlsx`,
      body: rowsToXlsxBuffer(rows),
      count: rows.length
    };
  }
  return {
    contentType: 'text/csv; charset=utf-8',
    filename: `meteo-export-${from?.slice(0, 10) || 'all'}-${to?.slice(0, 10) || 'all'}.csv`,
    body: Buffer.from(`\uFEFF${rowsToCsv(rows)}`, 'utf8'),
    count: rows.length
  };
}

module.exports = { exportSamples, querySamplesForExport };
