const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  user: null,
  settings: null,
  current: null,
  chartPeriod: '24h',
  chartResolution: 'auto'
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: opts.body && !(opts.body instanceof FormData)
      ? { 'Content-Type': 'application/json', ...opts.headers }
      : opts.headers,
    ...opts,
    body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' error' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function fmtTemp(v) {
  return v != null && !isNaN(v) ? `${Number(v).toFixed(1)} °C` : '—';
}
function fmtPct(v) {
  return v != null && !isNaN(v) ? `${Math.round(v)} %` : '—';
}
function fmtNum(v, u) {
  return v != null && !isNaN(v) ? `${Number(v).toFixed(1)} ${u}` : '—';
}
function parseDbTime(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) && !/Z|[+-]\d{2}:\d{2}/.test(s)) {
    return new Date(s.replace(' ', 'T') + 'Z');
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function fmtTime(iso) {
  const d = parseDbTime(iso);
  if (!d) return '—';
  return d.toLocaleString('sk-SK', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Bratislava'
  });
}

const COMPASS_SK = ['S', 'SV', 'V', 'JV', 'J', 'JZ', 'Z', 'SZ'];
const COMPASS_SK_LONG = [
  'sever', 'severovýchod', 'východ', 'juhovýchod',
  'juh', 'juhozápad', 'západ', 'severozápad'
];

function normDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

function degToCompassShort(deg) {
  return COMPASS_SK[Math.round(normDeg(deg) / 45) % 8];
}

function degToCompassLong(deg) {
  return COMPASS_SK_LONG[Math.round(normDeg(deg) / 45) % 8];
}

function renderWindWidget(latest) {
  const compass = $('#windCompass');
  const arrowWrap = $('#windArrowWrap');
  const from = latest?.wind_direction;

  $('#windSpeed').textContent = latest?.wind_speed_kmh != null
    ? `${Number(latest.wind_speed_kmh).toFixed(1)} km/h` : '—';
  $('#windGust').textContent = latest?.wind_gust_kmh != null
    ? `Náraz ${Number(latest.wind_gust_kmh).toFixed(1)} km/h` : 'Náraz —';

  if (from == null || isNaN(from)) {
    compass?.classList.add('no-data');
    if (arrowWrap) arrowWrap.style.transform = 'rotate(0deg)';
    $('#windDegNum').textContent = '—';
    $('#windDirLabel').textContent = '—';
    $('#windDirLong').textContent = 'Smer —';
    return;
  }

  const deg = normDeg(from);
  compass?.classList.remove('no-data');
  if (arrowWrap) arrowWrap.style.transform = `rotate(${deg}deg)`;
  $('#windDegNum').textContent = `${Math.round(deg)}°`;
  $('#windDirLabel').textContent = degToCompassShort(deg);
  $('#windDirLong').textContent = `Fúka zo ${degToCompassLong(deg)}`;
}

function initTheme() {
  const saved = localStorage.getItem('meteo-theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved === 'dark' ? 'dark' : 'light');
  $('#themeToggle').textContent = saved === 'dark' ? '☀️' : '🌙';
}

$('#themeToggle')?.addEventListener('click', () => {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = dark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next === 'dark' ? 'dark' : 'light');
  localStorage.setItem('meteo-theme', next);
  $('#themeToggle').textContent = next === 'dark' ? '☀️' : '🌙';
  rerenderCharts();
});

function showAuth(mode) {
  $('#authScreen').classList.remove('hidden');
  $('#app').classList.add('hidden');
  $('#loginForm').classList.toggle('hidden', mode === 'bootstrap');
  $('#bootstrapForm').classList.toggle('hidden', mode !== 'bootstrap');
}

function showApp() {
  $('#authScreen').classList.add('hidden');
  $('#app').classList.remove('hidden');
}

function renderAboutApp(cfg) {
  const el = $('#aboutAppLine');
  if (!el || !cfg) return;
  const v = cfg.version || '?';
  el.textContent = `Verzia ${v} · Self-hosted · PWA · Ecowitt · 🌤️ Naživo · 📅 Predpoveď · 📈 Grafy · 🔔 Upozornenia · import Excel`;
}

async function initAuth() {
  const cfg = await api('/api/config');
  state.config = cfg;
  renderAboutApp(cfg);
  try {
    state.user = await api('/api/me');
    showApp();
    await loadApp();
    return;
  } catch {
    showAuth(cfg.allowBootstrap ? 'bootstrap' : 'login');
  }
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  $('#loginError').classList.add('hidden');
  try {
    await api('/api/login', {
      method: 'POST',
      body: {
        username: String(fd.get('username') || '').trim(),
        password: String(fd.get('password') || '').trim()
      }
    });
    state.user = await api('/api/me');
    showApp();
    await loadApp();
  } catch (err) {
    const el = $('#loginError');
    el.textContent = err.message;
    el.classList.remove('hidden');
  }
});

$('#bootstrapForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  $('#bootstrapError').classList.add('hidden');
  try {
    await api('/api/bootstrap', {
      method: 'POST',
      body: { username: fd.get('username'), password: fd.get('password') }
    });
    state.user = await api('/api/me');
    showApp();
    await loadApp();
  } catch (err) {
    const el = $('#bootstrapError');
    el.textContent = err.message;
    el.classList.remove('hidden');
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.reload();
});

$$('#nav .nav-link').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    $$('#nav .nav-link').forEach(b => b.classList.toggle('active', b === btn));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
    if (view === 'charts') loadCharts();
    if (view === 'forecast') loadForecast();
    if (view === 'alerts') loadAlertsList();
    if (view === 'settings') loadSettingsForms();
    if (view === 'dashboard') loadCurrent();
    if (view === 'live') renderLiveScene(state.current?.latest);
  });
});

async function loadApp() {
  initTheme();
  state.settings = await api('/api/settings');
  await fillForecastSettingsForm(state.settings?.forecast);
  await loadCurrent();
  registerServiceWorker();
  initLiveTimeControls();
  setInterval(() => loadCurrent(true), 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadCurrent(true);
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

async function loadCurrent(silent = false) {
  try {
    state.current = await api('/api/current');
    renderCurrent();
    renderAlertBanners();
    if (!silent) await loadDashboardChart();
  } catch (e) {
    if (!silent) toast(e.message, 'error');
  }
}

function renderCurrent() {
  const { latest, today, settings } = state.current || {};
  const s = settings?.ecowitt;

  const st = $('#syncStatus');
  const syncAt = s?.last_sync_at;
  const dataAt = latest?.recorded_at;
  let status = `Posledný sync: ${fmtTime(syncAt)}`;
  if (dataAt && fmtTime(dataAt) !== fmtTime(syncAt)) {
    status += ` · údaje zo ${fmtTime(dataAt)}`;
  }
  if (s?.last_error) {
    st.textContent = `${status} · Chyba: ${s.last_error}`;
    st.classList.add('error');
  } else {
    st.textContent = status;
    st.classList.remove('error');
  }

  $('#outTemp').textContent = fmtTemp(latest?.outdoor_temp_c);
  $('#outHum').textContent = `Vlhkosť ${fmtPct(latest?.outdoor_humidity)}`;
  $('#chataTemp').textContent = fmtTemp(latest?.chata_temp_c);
  $('#chataHum').textContent = `Vlhkosť ${fmtPct(latest?.chata_humidity)}`;
  renderWindWidget(latest);
  $('#rainDay').textContent = fmtNum(latest?.rain_day_mm, 'mm');
  $('#rainRate').textContent = latest?.rain_rate_mm != null
    ? `Intenzita ${Number(latest.rain_rate_mm).toFixed(1)} mm/h` : 'Intenzita —';
  $('#pressVal').textContent = latest?.pressure_hpa != null
    ? Number(latest.pressure_hpa).toFixed(1) : '—';
  $('#solarVal').textContent = latest?.solar_wm2 != null
    ? `${Math.round(latest.solar_wm2)} W/m²` : '—';
  $('#uvVal').textContent = latest?.uv_index != null
    ? `UV ${Number(latest.uv_index).toFixed(1)}` : 'UV —';

  if (today) {
    $('#todayOutTemp').textContent = today.outdoor_temp_min != null
      ? `${fmtTemp(today.outdoor_temp_min)} / ${fmtTemp(today.outdoor_temp_max)}`
      : fmtTemp(today.outdoor_temp_avg);
    $('#todayOutHum').textContent = fmtPct(today.outdoor_humidity_avg);
    $('#todayChata').textContent = fmtTemp(today.chata_temp_avg);
  }

  if ($('#view-live')?.classList.contains('active')) {
    renderLiveScene(latest);
  }
}

function renderAlertBanners() {
  const wrap = $('#alertBanners');
  wrap.innerHTML = '';
  const list = state.current?.alerts || [];
  for (const a of list) {
    const div = document.createElement('div');
    div.className = `alert-banner ${a.level === 'exceeded' ? 'danger' : 'warning'}`;
    div.innerHTML = `
      <span class="alert-icon">${a.level === 'exceeded' ? '🚨' : '⚠️'}</span>
      <div>
        <strong>${a.level === 'exceeded' ? 'Prekročený limit' : 'Blíži sa k limitu'}</strong>
        <div class="small">${a.message}</div>
        <div class="muted small">${fmtTime(a.created_at)}</div>
      </div>
      <button class="btn small ghost" data-ack="${a.id}">✕</button>`;
    wrap.appendChild(div);
  }
  wrap.querySelectorAll('[data-ack]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api(`/api/alerts/${btn.dataset.ack}/ack`, { method: 'POST' });
      await loadCurrent(true);
    });
  });
}

$('#btnSyncNow').addEventListener('click', async () => {
  try {
    await api('/api/sync', { method: 'POST' });
    toast('Sync OK');
    await loadCurrent();
  } catch (e) {
    toast(e.message, 'error');
  }
});

function chartColor(alpha = 1) {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return dark ? `rgba(34, 197, 94, ${alpha})` : `rgba(22, 163, 74, ${alpha})`;
}
function chartTextColor() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? '#93a39a' : '#5d6f64';
}
function chartGridColor() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)';
}

function chartPointCount(data) {
  if (!data?.datasets?.length) return 0;
  const ds = data.datasets[0].data;
  return Array.isArray(ds) ? ds.length : 0;
}

function chartDensityOptions(pointCount) {
  const dense = pointCount > 50;
  return {
    dense,
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
    elements: {
      line: { borderWidth: 2, tension: 0.35 },
      point: {
        radius: dense ? 0 : 3,
        hoverRadius: 5,
        hitRadius: 12
      }
    },
    plugins: {
      legend: {
        display: true,
        labels: { color: chartTextColor(), boxWidth: 14, padding: 14 }
      },
      tooltip: {
        backgroundColor: 'rgba(20,36,26,.95)',
        padding: 10,
        cornerRadius: 8,
        titleFont: { size: 13 },
        bodyFont: { size: 12 }
      },
      decimation: dense ? {
        enabled: true,
        algorithm: 'lttb',
        samples: Math.min(100, pointCount),
        threshold: 50
      } : { enabled: false }
    }
  };
}

function periodRange(period) {
  const to = new Date();
  const from = new Date(to);
  const p = period || '24h';
  if (p === '24h') {
    from.setHours(0, 0, 0, 0);
  } else if (p === '7d') {
    from.setDate(from.getDate() - 6);
    from.setHours(0, 0, 0, 0);
  } else if (p === '30d') {
    from.setDate(from.getDate() - 29);
    from.setHours(0, 0, 0, 0);
  } else if (p === 'year') {
    from.setDate(from.getDate() - 364);
    from.setHours(0, 0, 0, 0);
  } else {
    from.setHours(0, 0, 0, 0);
  }
  return { from: from.toISOString(), to: to.toISOString(), period: p };
}

function xTimeUnit(period) {
  if (period === '24h') return 'hour';
  if (period === '7d') return 'day';
  if (period === '30d') return 'day';
  if (period === 'year') return 'month';
  return 'hour';
}

function xTickLimit(period) {
  if (period === '24h') return 9;
  if (period === '7d') return 8;
  if (period === '30d') return 10;
  if (period === 'year') return 12;
  return 8;
}

function xScaleForRange(range, pointCount) {
  if (!range) {
    return { type: 'category', grid: { color: chartGridColor() }, ticks: { color: chartTextColor() } };
  }
  const period = range.period || '24h';
  const dense = pointCount > 50;
  return {
    type: 'time',
    min: range.from,
    max: range.to,
    grid: { color: chartGridColor() },
    time: {
      unit: xTimeUnit(period),
      tooltipFormat: period === '24h' ? 'dd.MM.yyyy HH:mm' : 'dd.MM.yyyy',
      displayFormats: {
        hour: 'HH:mm',
        day: 'dd.MM.',
        month: 'MM.yyyy'
      }
    },
    ticks: {
      color: chartTextColor(),
      maxRotation: 0,
      minRotation: 0,
      autoSkip: false,
      maxTicksLimit: xTickLimit(period),
      source: 'auto'
    }
  };
}

function rowX(r, source) {
  return source === 'daily' ? r.date : r.recorded_at;
}

function buildLineChartData(rows, source, seriesList) {
  const datasets = seriesList.map((s) => ({
    label: s.label,
    data: rows.map((r) => {
      const y = s.get(r);
      return { x: rowX(r, source), y: y != null && !isNaN(y) ? y : null };
    }),
    borderColor: s.color,
    backgroundColor: s.fill || 'transparent',
    fill: !!s.fill,
    yAxisID: s.yAxisID || 'y',
    spanGaps: true
  }));
  return { datasets };
}

function drawChart(canvasId, type, data, optionsOverride = {}) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  const existing = Chart.getChart(el);
  if (existing) existing.destroy();

  const n = chartPointCount(data);
  const density = chartDensityOptions(n);

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    parsing: true,
    animation: n > 200 ? false : undefined,
    interaction: density.interaction,
    elements: density.elements,
    plugins: { ...density.plugins, ...optionsOverride.plugins },
    scales: {
      x: {
        grid: { color: chartGridColor() },
        ticks: { color: chartTextColor() },
        ...(optionsOverride.scales?.x || {})
      },
      y: {
        grid: { color: chartGridColor() },
        ticks: { color: chartTextColor() },
        ...(optionsOverride.scales?.y || {})
      }
    }
  };

  if (optionsOverride.scales) {
    Object.keys(optionsOverride.scales).forEach((k) => {
      options.scales[k] = { ...(options.scales[k] || {}), ...optionsOverride.scales[k] };
    });
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  options.devicePixelRatio = dpr;

  new Chart(el, { type, data, options });
}

let chartResizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(chartResizeTimer);
  chartResizeTimer = setTimeout(() => rerenderCharts(), 200);
});

async function loadDashboardChart() {
  const data = await api('/api/chart-data?period=24h&resolution=raw');
  const rows = data.rows || [];
  const range = data.range || periodRange('24h');
  const src = data.source;
  const chartData = buildLineChartData(rows, src, [
    { label: 'Vonku', get: (r) => r.outdoor_temp_c ?? r.outdoor_temp_avg, color: chartColor(1), fill: chartColor(.12) },
    { label: 'Chata', get: (r) => r.chata_temp_c ?? r.chata_temp_avg, color: 'rgba(59, 130, 246, .9)' }
  ]);
  drawChart('chartDashTemp', 'line', chartData, {
    scales: {
      x: xScaleForRange(range, rows.length),
      y: { title: { display: true, text: '°C', color: chartTextColor() } }
    }
  });
}

async function loadCharts() {
  const q = `period=${state.chartPeriod}&resolution=${state.chartResolution}`;
  const data = await api(`/api/chart-data?${q}`);
  const rows = data.rows || [];
  const range = data.range || periodRange(state.chartPeriod);
  const src = data.source;
  const isDaily = src === 'daily';
  const xScale = xScaleForRange(range, rows.length);

  drawChart('chartTemp', 'line', buildLineChartData(rows, src, [
    { label: 'Vonku', get: (r) => r.outdoor_temp_c ?? r.outdoor_temp_avg, color: chartColor(1) },
    { label: 'Chata', get: (r) => r.chata_temp_c ?? r.chata_temp_avg, color: 'rgba(59, 130, 246, .9)' }
  ]), { scales: { x: xScale, y: { title: { display: true, text: '°C', color: chartTextColor() } } } });

  drawChart('chartHum', 'line', buildLineChartData(rows, src, [
    { label: 'Vonku %', get: (r) => r.outdoor_humidity ?? r.outdoor_humidity_avg, color: chartColor(.85) },
    { label: 'Chata %', get: (r) => r.chata_humidity ?? r.chata_humidity_avg, color: 'rgba(59,130,246,.75)' }
  ]), { scales: { x: xScale, y: { title: { display: true, text: '%', color: chartTextColor() } } } });

  drawChart('chartWind', 'line', buildLineChartData(rows, src, [
    { label: 'Vietor km/h', get: (r) => r.wind_speed_kmh ?? r.wind_speed_max_kmh, color: chartColor(1), fill: chartColor(.1) }
  ]), { scales: { x: xScale } });

  drawChart('chartRainPress', 'line', buildLineChartData(rows, src, [
    { label: 'Dážď mm', get: (r) => r.rain_day_mm, color: 'rgba(37, 99, 235, .9)', yAxisID: 'y' },
    { label: 'Tlak hPa', get: (r) => r.pressure_hpa ?? r.pressure_avg_hpa, color: chartColor(1), yAxisID: 'y1' }
  ]), {
    scales: {
      x: xScale,
      y: { position: 'left', title: { display: true, text: 'mm', color: chartTextColor() } },
      y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'hPa', color: chartTextColor() } }
    }
  });

  drawChart('chartSolar', 'line', buildLineChartData(rows, src, [
    { label: 'Slnko W/m²', get: (r) => r.solar_wm2 ?? r.solar_max_wm2, color: '#eab308', yAxisID: 'y' },
    { label: 'UV', get: (r) => r.uv_index ?? r.uv_max, color: '#a855f7', yAxisID: 'y1' }
  ]), {
    scales: {
      x: xScale,
      y1: { position: 'right', grid: { drawOnChartArea: false } }
    }
  });

  if (isDaily && rows.length < 3) {
    toast('Málo denných dát — importuj Excel alebo počkaj na sync.', 'error');
  }
}

function rerenderCharts() {
  if ($('#view-dashboard').classList.contains('active')) loadDashboardChart();
  if ($('#view-charts').classList.contains('active')) loadCharts();
}

$$('#periodSeg button').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('#periodSeg button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.chartPeriod = btn.dataset.period;
    loadCharts();
  });
});

$$('#resolutionSeg button').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('#resolutionSeg button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.chartResolution = btn.dataset.resolution;
    loadCharts();
  });
});

async function loadAlertsList() {
  const rows = await api('/api/alerts?limit=100');
  const ul = $('#alertsList');
  if (!rows.length) {
    ul.innerHTML = '<li class="muted">Žiadne upozornenia.</li>';
    return;
  }
  ul.innerHTML = rows.map(a => `
    <li>
      <div>
        <span class="badge ${a.level === 'exceeded' ? 'danger' : 'warn'}">${a.level === 'exceeded' ? 'Limit' : 'Blíži sa'}</span>
        ${a.message}
        <div class="muted small">${fmtTime(a.created_at)}</div>
      </div>
      ${a.acknowledged ? '' : `<button class="btn small ghost" data-ack="${a.id}">OK</button>`}
    </li>`).join('');
  ul.querySelectorAll('[data-ack]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api(`/api/alerts/${btn.dataset.ack}/ack`, { method: 'POST' });
      loadAlertsList();
      loadCurrent(true);
    });
  });
}

$('#btnAckAll').addEventListener('click', async () => {
  await api('/api/alerts/ack-all', { method: 'POST' });
  loadAlertsList();
  loadCurrent(true);
});

function parseCoord(v) {
  if (v == null || v === '') return NaN;
  return parseFloat(String(v).trim().replace(',', '.'));
}

function formatCoord(n) {
  if (n == null || Number.isNaN(Number(n))) return '';
  return String(Number(n));
}

async function fillForecastSettingsForm(fcIn) {
  const lat = $('#forecastLat');
  const lon = $('#forecastLon');
  const name = $('#forecastName');
  const query = $('#forecastLocationQuery');
  const days = $('#forecastDays');
  const summary = $('#forecastSavedSummary');
  let fc = fcIn;
  if (!fc) {
    try {
      const s = await api('/api/settings');
      state.settings = s;
      if (s && Object.prototype.hasOwnProperty.call(s, 'forecast')) {
        fc = s.forecast;
      } else if (summary) {
        summary.textContent = 'Backend je starý — v odpovedi /api/settings chýba „forecast“. Na euflix: git pull, potom podman cp server/forecast.js a server/server.js do kontajnera a restart.';
        if (lat) lat.value = '';
        if (lon) lon.value = '';
        if (name) name.value = '';
        if (query) query.value = '';
        return;
      }
    } catch (e) {
      if (summary) summary.textContent = `Nastavenia sa nenačítali: ${e.message}`;
      return;
    }
  }
  if (!fc) {
    if (summary) {
      summary.textContent = 'Lokalita ešte nie je uložená — vyhľadaj mesto a klikni „Uložiť lokalitu“.';
    }
    if (lat) lat.value = '';
    if (lon) lon.value = '';
    if (name) name.value = '';
    if (query) query.value = '';
    return;
  }
  const label = (fc.name || fc.label || '').trim();
  if (lat) lat.value = formatCoord(fc.lat);
  if (lon) lon.value = formatCoord(fc.lon);
  if (name) name.value = label;
  if (query) query.value = label;
  if (days) days.value = String(fc.days || 7);
  if (summary) {
    if (fc.saved) {
      summary.textContent = label
        ? `Uložené na serveri: ${label} · ${formatCoord(fc.lat)}, ${formatCoord(fc.lon)} · ${fc.days || 7} dní`
        : `Uložené na serveri: ${formatCoord(fc.lat)}, ${formatCoord(fc.lon)} · ${fc.days || 7} dní`;
    } else {
      summary.textContent = 'Lokalita ešte nie je uložená na serveri — skontroluj údaje a klikni „Uložiť lokalitu“.';
    }
  }
}

async function loadForecast() {
  const grid = $('#forecastGrid');
  const meta = $('#forecastMeta');
  if (!grid) return;
  grid.innerHTML = '<p class="muted">Načítavam predpoveď…</p>';
  try {
    const fc = state.settings?.forecast || (await api('/api/settings')).forecast;
    const days = fc?.days || 7;
    const data = await api(`/api/forecast?days=${days}`);
    const loc = data.location?.name || fc?.label || fc?.name || '—';
    const updated = data.fetched_at
      ? new Date(data.fetched_at).toLocaleString('sk-SK', { timeZone: 'Europe/Bratislava' })
      : '—';
    if (meta) {
      meta.textContent = `${loc} · ${data.daily?.length || 0} dní · aktualizované ${updated}`;
    }
    if (!data.daily?.length) {
      grid.innerHTML = '<p class="muted">Žiadne dáta predpovede.</p>';
      return;
    }
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Bratislava' });
    grid.innerHTML = data.daily.map((d) => {
      const isToday = d.date === todayStr;
      const tMax = d.temp_max_c != null ? Math.round(d.temp_max_c) : '—';
      const tMin = d.temp_min_c != null ? Math.round(d.temp_min_c) : '—';
      const rain = d.rain_mm != null ? `${Number(d.rain_mm).toFixed(1)} mm` : '—';
      const prob = d.rain_prob_pct != null ? `${Math.round(d.rain_prob_pct)} %` : '—';
      const wind = d.wind_max_kmh != null ? `${Math.round(d.wind_max_kmh)} km/h` : '—';
      const gust = d.gust_max_kmh != null ? `${Math.round(d.gust_max_kmh)} km/h` : '—';
      return `
        <article class="forecast-day${isToday ? ' is-today' : ''}">
          <div class="forecast-day-head">${d.label}</div>
          <div class="forecast-day-icon" aria-hidden="true">${d.icon || '🌡️'}</div>
          <div class="forecast-day-summary">${d.summary || ''}</div>
          <div class="forecast-day-temp">${tMax}<span>°</span> / ${tMin}<span>°</span></div>
          <div class="forecast-day-details">
            <div>🌧 ${rain} (${prob})</div>
            <div>💨 ${wind}${gust !== '—' ? ` (náraz ${gust})` : ''}</div>
          </div>
        </article>`;
    }).join('');
  } catch (e) {
    if (meta) meta.textContent = '—';
    grid.innerHTML = `<p class="muted error">${e.message}</p>`;
  }
}

$('#btnForecastRefresh')?.addEventListener('click', () => loadForecast());

$('#btnForecastGeocode')?.addEventListener('click', async () => {
  const q = $('#forecastLocationQuery')?.value?.trim();
  const list = $('#forecastGeoResults');
  if (!q || !list) return;
  list.classList.remove('hidden');
  list.innerHTML = '<li><span class="muted small" style="padding:.5rem .75rem;display:block">Hľadám…</span></li>';
  try {
    const { results } = await api(`/api/forecast/geocode?q=${encodeURIComponent(q)}`);
    if (!results?.length) {
      list.innerHTML = '<li><span class="muted small" style="padding:.5rem .75rem;display:block">Nič nenájdené.</span></li>';
      return;
    }
    list.innerHTML = results.map((r, i) => `
      <li><button type="button" data-idx="${i}">${r.label}</button></li>`).join('');
    list._results = results;
    list.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const r = list._results[parseInt(btn.dataset.idx, 10)];
        $('#forecastLat').value = formatCoord(r.lat);
        $('#forecastLon').value = formatCoord(r.lon);
        $('#forecastName').value = r.name;
        list.classList.add('hidden');
        toast(`Vybraté: ${r.label}`);
      });
    });
  } catch (e) {
    list.innerHTML = `<li><span class="muted small" style="padding:.5rem .75rem;display:block">${e.message}</span></li>`;
  }
});

$('#settingsForecast')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const lat = parseCoord($('#forecastLat')?.value);
  const lon = parseCoord($('#forecastLon')?.value);
  const name = $('#forecastName')?.value?.trim()
    || $('#forecastLocationQuery')?.value?.trim();
  const days = parseInt($('#forecastDays')?.value, 10);
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    toast('Zadaj platné súradnice (bodka alebo čiarka).', 'error');
    return;
  }
  try {
    state.settings = await api('/api/settings', {
      method: 'PUT',
      body: {
        forecast: { lat, lon, name, days }
      }
    });
    await fillForecastSettingsForm(state.settings.forecast);
    toast('Lokalita predpovede uložená');
    if ($('#view-forecast')?.classList.contains('active')) loadForecast();
  } catch (err) {
    toast(err.message, 'error');
  }
});

async function loadSettingsForms() {
  const s = await api('/api/settings');
  state.settings = s;
  await fillForecastSettingsForm(s.forecast);
  const f = $('#settingsEcowitt');
  f.elements.enabled.checked = s.ecowitt.enabled;
  f.elements.mac.value = s.ecowitt.mac || '';
  f.elements.sync_interval_min.value = s.ecowitt.sync_interval_min || 5;
  f.elements.application_key.value = '';
  f.elements.api_key.value = '';

  const a = $('#settingsAlerts');
  a.elements.outdoor_enabled.checked = s.alerts.outdoor_enabled;
  a.elements.chata_enabled.checked = s.alerts.chata_enabled;
  a.elements.outdoor_min.value = s.alerts.outdoor_min ?? '';
  a.elements.outdoor_max.value = s.alerts.outdoor_max ?? '';
  a.elements.chata_min.value = s.alerts.chata_min ?? '';
  a.elements.chata_max.value = s.alerts.chata_max ?? '';
  a.elements.approach_delta_c.value = s.alerts.approach_delta_c ?? 2;
  a.elements.cooldown_min.value = s.alerts.cooldown_min ?? 60;
}

$('#settingsEcowitt').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = {
    ecowitt: {
      enabled: fd.get('enabled') === 'on',
      mac: fd.get('mac'),
      sync_interval_min: parseInt(fd.get('sync_interval_min'), 10)
    }
  };
  if (fd.get('application_key')) body.ecowitt.application_key = fd.get('application_key');
  if (fd.get('api_key')) body.ecowitt.api_key = fd.get('api_key');
  try {
    state.settings = await api('/api/settings', { method: 'PUT', body });
    await fillForecastSettingsForm(state.settings?.forecast);
    toast('Nastavenia uložené');
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#settingsAlerts').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const num = (k) => {
    const v = fd.get(k);
    return v === '' || v == null ? null : parseFloat(v);
  };
  try {
    state.settings = await api('/api/settings', {
      method: 'PUT',
      body: {
        alerts: {
          outdoor_enabled: fd.get('outdoor_enabled') === 'on',
          chata_enabled: fd.get('chata_enabled') === 'on',
          outdoor_min: num('outdoor_min'),
          outdoor_max: num('outdoor_max'),
          chata_min: num('chata_min'),
          chata_max: num('chata_max'),
          approach_delta_c: num('approach_delta_c'),
          cooldown_min: parseInt(fd.get('cooldown_min'), 10)
        }
      }
    });
    await fillForecastSettingsForm(state.settings?.forecast);
    toast('Prahy uložené');
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#btnTestEcowitt').addEventListener('click', async () => {
  const f = $('#settingsEcowitt');
  try {
    const body = { mac: f.elements.mac.value };
    if (f.elements.application_key.value) body.application_key = f.elements.application_key.value;
    if (f.elements.api_key.value) body.api_key = f.elements.api_key.value;
    const r = await api('/api/ecowitt/test', { method: 'POST', body });
    toast(`OK — Vonku ${fmtTemp(r.readings.outdoor_temp_c)}`);
  } catch (e) {
    toast(e.message, 'error');
  }
});

$('#importForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  if (!fd.get('overwrite')) fd.append('overwrite', 'false');
  try {
    const r = await api('/api/weather/import', { method: 'POST', body: fd });
    const dFrom = r.minute.dates && r.minute.dates[0];
    const dTo = r.minute.dates && r.minute.dates[r.minute.dates.length - 1];
    $('#importResult').textContent =
      `Importované: ${r.minute.imported || 0} vzoriek (5 min)${dFrom ? `, ${dFrom} – ${dTo}` : ''}. ` +
      `Denné agregáty: ${(r.minute.dates || []).length} dní.`;
    toast('Import hotový');
    await loadCurrent();
    if ($('#view-charts').classList.contains('active')) loadCharts();
    if ($('#view-dashboard').classList.contains('active')) loadDashboardChart();
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#changePasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('/api/change-password', {
      method: 'POST',
      body: { oldPassword: fd.get('oldPassword'), newPassword: fd.get('newPassword') }
    });
    toast('Heslo zmenené');
    e.target.reset();
  } catch (err) {
    toast(err.message, 'error');
  }
});

initTheme();
initAuth().catch(e => {
  console.error(e);
  showAuth('login');
});
