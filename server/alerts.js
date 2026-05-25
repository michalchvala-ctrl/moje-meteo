const db = require('./db');

function getSettings() {
  return db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
}

function canFire(alertKey, cooldownMin) {
  const row = db.prepare('SELECT last_fired_at FROM alert_cooldown WHERE alert_key = ?').get(alertKey);
  if (!row) return true;
  const last = new Date(row.last_fired_at).getTime();
  const minMs = (cooldownMin || 60) * 60 * 1000;
  return Date.now() - last >= minMs;
}

function markFired(alertKey) {
  db.prepare(`INSERT INTO alert_cooldown (alert_key, last_fired_at) VALUES (?, datetime('now'))
    ON CONFLICT(alert_key) DO UPDATE SET last_fired_at = datetime('now')`).run(alertKey);
}

function insertAlert({ sensor, level, kind, message, value_c, threshold_c }) {
  db.prepare(`INSERT INTO weather_alerts (sensor, level, kind, message, value_c, threshold_c)
    VALUES (?, ?, ?, ?, ?, ?)`).run(sensor, level, kind, message, value_c, threshold_c);
}

function evaluateSensor(sensorLabel, sensorKey, temp, settings, prefix) {
  if (temp == null || isNaN(temp)) return;
  const enabled = settings[`alert_${prefix}_enabled`];
  if (!enabled) return;

  const min = settings[`alert_${prefix}_min`];
  const max = settings[`alert_${prefix}_max`];
  const delta = settings.alert_approach_delta_c ?? 2;
  const cooldown = settings.alert_cooldown_min ?? 60;

  const checks = [];

  if (max != null) {
    if (temp > max) {
      checks.push({
        key: `${prefix}_high`,
        level: 'exceeded',
        kind: 'high',
        message: `${sensorLabel}: teplota ${temp.toFixed(1)} °C prekročila horný limit ${max} °C`,
        threshold: max
      });
    } else if (temp > max - delta) {
      checks.push({
        key: `${prefix}_approach_high`,
        level: 'approaching',
        kind: 'approach_high',
        message: `${sensorLabel}: teplota ${temp.toFixed(1)} °C sa blíži k hornému limitu ${max} °C`,
        threshold: max
      });
    }
  }

  if (min != null) {
    if (temp < min) {
      checks.push({
        key: `${prefix}_low`,
        level: 'exceeded',
        kind: 'low',
        message: `${sensorLabel}: teplota ${temp.toFixed(1)} °C klesla pod dolný limit ${min} °C`,
        threshold: min
      });
    } else if (temp < min + delta) {
      checks.push({
        key: `${prefix}_approach_low`,
        level: 'approaching',
        kind: 'approach_low',
        message: `${sensorLabel}: teplota ${temp.toFixed(1)} °C sa blíži k dolnému limitu ${min} °C`,
        threshold: min
      });
    }
  }

  for (const c of checks) {
    if (!canFire(c.key, cooldown)) continue;
    insertAlert({
      sensor: sensorKey,
      level: c.level,
      kind: c.kind,
      message: c.message,
      value_c: temp,
      threshold_c: c.threshold
    });
    markFired(c.key);
  }
}

function checkTemperatureAlerts(readings) {
  const settings = getSettings();
  evaluateSensor('Vonku', 'outdoor', readings.outdoor_temp_c, settings, 'outdoor');
  evaluateSensor('Chata', 'chata', readings.chata_temp_c, settings, 'chata');
}

function listAlerts({ limit = 50, activeOnly = false } = {}) {
  let sql = 'SELECT * FROM weather_alerts';
  if (activeOnly) sql += ' WHERE acknowledged = 0';
  sql += ' ORDER BY created_at DESC LIMIT ?';
  return db.prepare(sql).all(limit);
}

function acknowledgeAlert(id) {
  db.prepare('UPDATE weather_alerts SET acknowledged = 1 WHERE id = ?').run(id);
}

function acknowledgeAll() {
  db.prepare('UPDATE weather_alerts SET acknowledged = 1 WHERE acknowledged = 0').run();
}

function getActiveBannerAlerts() {
  return db.prepare(`
    SELECT * FROM weather_alerts
    WHERE acknowledged = 0
    ORDER BY created_at DESC
    LIMIT 5
  `).all();
}

module.exports = {
  checkTemperatureAlerts,
  listAlerts,
  acknowledgeAlert,
  acknowledgeAll,
  getActiveBannerAlerts
};
