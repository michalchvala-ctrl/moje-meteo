const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./db');
const ecowitt = require('./ecowitt');
const forecast = require('./forecast');
const weatherImport = require('./weather-import');
const alerts = require('./alerts');
const { chartPeriodRangeIso } = require('./chart-period');

const PORT = parseInt(process.env.PORT || '8081', 10);

function readAppVersion() {
  const versionFile = path.join(__dirname, 'VERSION');
  try {
    return fs.readFileSync(versionFile, 'utf8').trim() || 'dev';
  } catch {
    return process.env.APP_VERSION || 'dev';
  }
}

const APP_VERSION = readAppVersion();
const COOKIE_SECURE = (process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true';
const TRUST_PROXY = (process.env.TRUST_PROXY || 'false').toLowerCase() === 'true';
const COOKIE_NAME = 'meteo_token';
const TOKEN_TTL_DAYS = 30;

const SECRET_FILE = path.join(path.dirname(db.DB_PATH), '.jwt-secret');
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (fs.existsSync(SECRET_FILE)) {
    JWT_SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } else {
    JWT_SECRET = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(SECRET_FILE, JWT_SECRET, { mode: 0o600 });
    console.log('[init] Vygenerovaný JWT secret -> .jwt-secret');
  }
}

function ensureAdminFromEnv() {
  const u = process.env.ADMIN_USERNAME;
  const p = process.env.ADMIN_PASSWORD;
  if (!u || !p) return;
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(u);
  if (existing) return;
  const hash = bcrypt.hashSync(p, 10);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(u, hash);
  console.log(`[init] Vytvorený admin účet "${u}" z env premenných.`);
}
ensureAdminFromEnv();

const app = express();
if (TRUST_PROXY) app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

function signToken(user) {
  return jwt.sign({ uid: user.id, username: user.username }, JWT_SECRET, { expiresIn: `${TOKEN_TTL_DAYS}d` });
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: '/'
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.uid;
    req.username = payload.username;
    next();
  } catch {
    clearAuthCookie(res);
    return res.status(401).json({ error: 'unauthorized' });
  }
}

app.get('/api/config', (req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  res.json({
    appName: 'Moje meteo',
    version: APP_VERSION,
    hasUsers: userCount > 0,
    allowBootstrap: userCount === 0
  });
});

app.post('/api/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '').trim();
  if (!username || !password) return res.status(400).json({ error: 'Chýba meno alebo heslo.' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Nesprávne meno alebo heslo.' });
  }
  const token = signToken(user);
  setAuthCookie(res, token);
  res.json({ ok: true, user: { id: user.id, username: user.username } });
});

app.post('/api/bootstrap', (req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount > 0) {
    return res.status(403).json({ error: 'Účet už existuje. Použi prihlásenie alebo ADMIN_USERNAME v env.' });
  }
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || !/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    return res.status(400).json({ error: 'Neplatné meno (3–32 znakov).' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Heslo musí mať aspoň 6 znakov.' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
  const user = { id: result.lastInsertRowid, username };
  const token = signToken(user);
  setAuthCookie(res, token);
  res.json({ ok: true, user });
});

app.post('/api/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ id: req.userId, username: req.username });
});

app.post('/api/change-password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    return res.status(400).json({ error: 'Nové heslo musí mať aspoň 6 znakov.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user || !bcrypt.compareSync(oldPassword || '', user.password_hash)) {
    return res.status(401).json({ error: 'Staré heslo nesedí.' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.userId);
  res.json({ ok: true });
});

function settingsPayload() {
  return ecowitt.settingsForClient({ forecast: forecast.clientSettings() });
}

app.get('/api/settings', requireAuth, (req, res) => {
  res.json(settingsPayload());
});

app.put('/api/settings', requireAuth, (req, res) => {
  const body = req.body || {};
  const e = body.ecowitt || {};
  const a = body.alerts || {};
  const f = body.forecast || {};
  const s = ecowitt.getSettings();

  if (Object.keys(f).length) {
    try {
      forecast.updateSettings(f);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  const application_key = e.application_key !== undefined
    ? (e.application_key || null)
    : s.application_key;
  const api_key = e.api_key !== undefined ? (e.api_key || null) : s.api_key;

  db.prepare(`UPDATE app_settings SET
    ecowitt_enabled = ?,
    mac = COALESCE(?, mac),
    application_key = ?,
    api_key = ?,
    sync_interval_min = COALESCE(?, sync_interval_min),
    alert_outdoor_enabled = COALESCE(?, alert_outdoor_enabled),
    alert_outdoor_min = ?,
    alert_outdoor_max = ?,
    alert_chata_enabled = COALESCE(?, alert_chata_enabled),
    alert_chata_min = ?,
    alert_chata_max = ?,
    alert_approach_delta_c = COALESCE(?, alert_approach_delta_c),
    alert_cooldown_min = COALESCE(?, alert_cooldown_min)
    WHERE id = 1`).run(
    e.enabled != null ? (e.enabled ? 1 : 0) : s.ecowitt_enabled,
    e.mac !== undefined ? e.mac : null,
    application_key,
    api_key,
    e.sync_interval_min != null ? Math.max(1, Math.min(60, parseInt(e.sync_interval_min, 10) || 5)) : null,
    a.outdoor_enabled != null ? (a.outdoor_enabled ? 1 : 0) : null,
    a.outdoor_min !== undefined ? a.outdoor_min : s.alert_outdoor_min,
    a.outdoor_max !== undefined ? a.outdoor_max : s.alert_outdoor_max,
    a.chata_enabled != null ? (a.chata_enabled ? 1 : 0) : null,
    a.chata_min !== undefined ? a.chata_min : s.alert_chata_min,
    a.chata_max !== undefined ? a.chata_max : s.alert_chata_max,
    a.approach_delta_c != null ? a.approach_delta_c : null,
    a.cooldown_min != null ? a.cooldown_min : null
  );

  restartScheduler();
  res.json(settingsPayload());
});

app.get('/api/forecast/geocode', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const results = await forecast.geocode(q);
    res.json({ results });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Geokódovanie zlyhalo' });
  }
});

app.get('/api/forecast', requireAuth, async (req, res) => {
  try {
    const cfg = forecast.clientSettings();
    if (cfg.lat == null || cfg.lon == null) {
      return res.status(400).json({ error: 'Nastav lokalitu predpovede v Nastaveniach.' });
    }
    const days = req.query.days != null ? req.query.days : cfg.days;
    const data = await forecast.fetchForecast(days);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message || 'Predpoveď nedostupná' });
  }
});

app.post('/api/sync', requireAuth, async (req, res) => {
  try {
    const result = await ecowitt.syncEcowitt();
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message || 'Sync zlyhal' });
  }
});

app.post('/api/ecowitt/test', requireAuth, async (req, res) => {
  const s = ecowitt.getSettings();
  const creds = {
    application_key: req.body?.application_key || s.application_key,
    api_key: req.body?.api_key || s.api_key,
    mac: req.body?.mac || s.mac
  };
  try {
    const readings = await ecowitt.fetchEcowittRealtime(creds);
    res.json({ ok: true, readings });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/current', requireAuth, (req, res) => {
  const latest = ecowitt.getLatestSample();
  const today = ecowitt.getTodayDaily();
  const bannerAlerts = alerts.getActiveBannerAlerts();
  const settings = ecowitt.settingsForClient();
  res.json({ latest, today, alerts: bannerAlerts, settings });
});

function querySamples(from, to) {
  let sql = 'SELECT * FROM weather_samples WHERE 1=1';
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

function queryDaily(from, to) {
  let sql = 'SELECT * FROM weather_daily WHERE 1=1';
  const params = [];
  if (from) {
    sql += ' AND date >= ?';
    params.push(from.slice(0, 10));
  }
  if (to) {
    sql += ' AND date <= ?';
    params.push(to.slice(0, 10));
  }
  sql += ' ORDER BY date ASC';
  return db.prepare(sql).all(...params);
}

app.get('/api/samples', requireAuth, (req, res) => {
  res.json(querySamples(req.query.from, req.query.to));
});

app.get('/api/daily', requireAuth, (req, res) => {
  res.json(queryDaily(req.query.from, req.query.to));
});

app.get('/api/chart-data', requireAuth, (req, res) => {
  const period = req.query.period || '24h';
  const resolution = req.query.resolution || 'auto';

  const { from: fromIso, to: toIso, period: rangePeriod } = chartPeriodRangeIso(period);

  let useDaily = period === 'year' || resolution === 'day';
  if (resolution === 'hour' && period !== 'year') useDaily = false;
  if (resolution === 'raw') useDaily = false;
  if (resolution === 'auto') {
    useDaily = period === '30d' || period === 'year';
  }

  const range = { from: fromIso, to: toIso, period: rangePeriod };

  if (useDaily) {
    const rows = queryDaily(fromIso, toIso);
    return res.json({ source: 'daily', rows, range });
  }

  let rows = querySamples(fromIso, toIso);
  if (resolution === 'hour' || (resolution === 'auto' && (period === '7d' || period === '30d'))) {
    rows = aggregateSamplesByHour(rows);
  }
  res.json({ source: 'samples', rows, range });
});

function aggregateSamplesByHour(rows) {
  const buckets = new Map();
  for (const r of rows) {
    const h = r.recorded_at.slice(0, 13) + ':00:00.000Z';
    if (!buckets.has(h)) buckets.set(h, []);
    buckets.get(h).push(r);
  }
  const out = [];
  for (const [bucket, list] of buckets) {
    const avg = (key) => {
      const vals = list.map(x => x[key]).filter(v => v != null);
      if (!vals.length) return null;
      return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
    };
    out.push({
      recorded_at: bucket,
      outdoor_temp_c: avg('outdoor_temp_c'),
      outdoor_humidity: avg('outdoor_humidity'),
      chata_temp_c: avg('chata_temp_c'),
      chata_humidity: avg('chata_humidity'),
      wind_speed_kmh: avg('wind_speed_kmh'),
      rain_day_mm: list[list.length - 1]?.rain_day_mm ?? null,
      pressure_hpa: avg('pressure_hpa'),
      solar_wm2: Math.max(...list.map(x => x.solar_wm2 || 0)),
      uv_index: Math.max(...list.map(x => x.uv_index || 0))
    });
  }
  return out.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
}

app.post('/api/weather/import', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Chýba súbor.' });
  const overwrite = req.body?.overwrite !== 'false';
  const ext = path.extname(req.file.originalname || '').toLowerCase();

  try {
    let parsed;
    if (ext === '.xlsx' || ext === '.xls') {
      parsed = weatherImport.parseXlsxBuffer(req.file.buffer);
    } else {
      return res.status(400).json({ error: 'Podporovaný je len Excel (.xlsx).' });
    }

    if (!parsed.daily.length && !parsed.minute.length) {
      return res.status(400).json({ error: 'V súbore sa nenašli žiadne záznamy počasia.' });
    }

    const dailyResult = weatherImport.importWeatherDailyRecords(parsed.daily, { overwrite });
    let minuteResult = { imported: 0, dates: [] };
    if (parsed.minute.length) {
      minuteResult = weatherImport.importMinuteSamples(parsed.minute, { overwrite });
    }

    res.json({
      ok: true,
      parsed: { dailyRows: parsed.daily.length, minuteRows: parsed.minute.length },
      daily: dailyResult,
      minute: minuteResult
    });
  } catch (e) {
    console.error('[import]', e);
    res.status(400).json({ error: e.message || 'Import zlyhal' });
  }
});

app.get('/api/alerts', requireAuth, (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
  const activeOnly = req.query.active === '1';
  res.json(alerts.listAlerts({ limit, activeOnly }));
});

app.post('/api/alerts/:id/ack', requireAuth, (req, res) => {
  alerts.acknowledgeAlert(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

app.post('/api/alerts/ack-all', requireAuth, (req, res) => {
  alerts.acknowledgeAll();
  res.json({ ok: true });
});

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, { maxAge: '1h', etag: true }));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

const scheduleSync = require('./schedule-sync');

function restartScheduler() {
  scheduleSync.stopAlignedScheduler();
  scheduleSync.startAlignedScheduler(
    () => ecowitt.schedulerTick(),
    () => ecowitt.getSettings().sync_interval_min || 5
  );
}

restartScheduler();

setTimeout(() => {
  const s = ecowitt.getSettings();
  if (!s.ecowitt_enabled || !s.application_key || !s.api_key || !s.mac) return;
  const last = scheduleSync.parseDbTimestamp(s.last_sync_at);
  const maxAge = (s.sync_interval_min || 5) * 60 * 1000 + 90_000;
  if (!last || Date.now() - last.getTime() > maxAge) {
    ecowitt.schedulerTick().catch((e) => console.error('[meteo] catch-up sync', e.message));
  }
}, 8000);

app.listen(PORT, () => {
  console.log(`Moje meteo beží na http://0.0.0.0:${PORT}`);
});
