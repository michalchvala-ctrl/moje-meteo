const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'meteo.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    ecowitt_enabled INTEGER NOT NULL DEFAULT 0,
    application_key TEXT,
    api_key TEXT,
    mac TEXT,
    sync_interval_min INTEGER NOT NULL DEFAULT 5,
    last_sync_at TEXT,
    last_error TEXT,
    alert_outdoor_enabled INTEGER NOT NULL DEFAULT 1,
    alert_outdoor_min REAL,
    alert_outdoor_max REAL,
    alert_chata_enabled INTEGER NOT NULL DEFAULT 0,
    alert_chata_min REAL,
    alert_chata_max REAL,
    alert_approach_delta_c REAL NOT NULL DEFAULT 2,
    alert_cooldown_min INTEGER NOT NULL DEFAULT 60
  );

  INSERT OR IGNORE INTO app_settings (id) VALUES (1);

  CREATE TABLE IF NOT EXISTS weather_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
    outdoor_temp_c REAL,
    outdoor_humidity REAL,
    chata_temp_c REAL,
    chata_humidity REAL,
    coop_temp_c REAL,
    coop_humidity REAL,
    wind_speed_kmh REAL,
    wind_gust_kmh REAL,
    wind_direction REAL,
    rain_rate_mm REAL,
    rain_day_mm REAL,
    pressure_hpa REAL,
    solar_wm2 REAL,
    uv_index REAL
  );

  CREATE TABLE IF NOT EXISTS weather_daily (
    date TEXT PRIMARY KEY,
    outdoor_temp_avg REAL,
    outdoor_temp_min REAL,
    outdoor_temp_max REAL,
    outdoor_humidity_avg REAL,
    chata_temp_avg REAL,
    chata_humidity_avg REAL,
    coop_temp_avg REAL,
    coop_humidity_avg REAL,
    wind_speed_max_kmh REAL,
    wind_gust_max_kmh REAL,
    rain_day_mm REAL,
    pressure_avg_hpa REAL,
    solar_max_wm2 REAL,
    uv_max REAL,
    sample_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS weather_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sensor TEXT NOT NULL,
    level TEXT NOT NULL,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    value_c REAL,
    threshold_c REAL,
    acknowledged INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS alert_cooldown (
    alert_key TEXT PRIMARY KEY,
    last_fired_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_weather_samples_time ON weather_samples(recorded_at DESC);
  CREATE INDEX IF NOT EXISTS idx_weather_daily_date ON weather_daily(date DESC);
  CREATE INDEX IF NOT EXISTS idx_weather_alerts_created ON weather_alerts(created_at DESC);
`);

module.exports = db;
module.exports.DB_PATH = DB_PATH;
