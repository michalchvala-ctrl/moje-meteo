/** Naživo — výpočty a vykreslenie animovanej scény počasia */

const LIVE_TZ = 'Europe/Bratislava';
const MOON_SYNODIC = 29.530588853;
const MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14, 0);

let liveSceneAtOverride = null;

function normDegLive(deg) {
  return ((deg % 360) + 360) % 360;
}

const MOON_NAMES = [
  'Nov', 'Dorastajúci srp', 'Prvý štvrť', 'Dorastajúci Mesiac',
  'Spln', 'Ubúdajúci Mesiac', 'Posledný štvrť', 'Ubúdajúci srp'
];

function setLiveSceneTime(at) {
  liveSceneAtOverride = at;
}

function clearLiveSceneTime() {
  liveSceneAtOverride = null;
}

function isLiveSceneCustomTime() {
  return liveSceneAtOverride != null;
}

function getLiveSceneTime() {
  return liveSceneAtOverride ? new Date(liveSceneAtOverride.getTime()) : new Date();
}

function toDatetimeLocalValue(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseDatetimeLocalValue(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function liveLocalParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: LIVE_TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  });
  const parts = fmt.formatToParts(date);
  const get = (t) => parseInt(parts.find((p) => p.type === t)?.value || '0', 10);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute')
  };
}

function formatLiveSceneWhen(date) {
  return date.toLocaleString('sk-SK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: LIVE_TZ
  });
}

function liveSeason(month) {
  if (month === 12 || month <= 2) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'autumn';
}

function liveDayPhase(hour, minute) {
  const t = hour + minute / 60;
  if (t >= 7 && t < 19) return 'day';
  if (t >= 5.5 && t < 7) return 'dawn';
  if (t >= 19 && t < 21) return 'dusk';
  return 'night';
}

function liveSunProgress(hour, minute) {
  const t = hour + minute / 60;
  if (t < 5.5 || t > 20.5) return null;
  return (t - 5.5) / 15;
}

function liveMoonProgress(hour, minute) {
  const t = hour + minute / 60;
  if (t >= 6.5 && t < 17.5) return null;
  if (t >= 17.5) return (t - 17.5) / 12.5;
  return (t + 6.5) / 12.5;
}

function liveCelestialPos(progress) {
  if (progress == null) return { visible: false };
  const p = Math.max(0, Math.min(1, progress));
  const x = 7 + p * 86;
  const arc = Math.sin(p * Math.PI);
  const y = 56 - arc * 44;
  return {
    visible: p > 0.015 && p < 0.985,
    x,
    y,
    arc,
    atHorizon: p <= 0.06 || p >= 0.94
  };
}

function getMoonPhase(date = new Date()) {
  const days = (date.getTime() - MOON_EPOCH) / 86400000;
  const age = ((days % MOON_SYNODIC) + MOON_SYNODIC) % MOON_SYNODIC;
  const phase = age / MOON_SYNODIC;
  const idx = Math.floor(phase * 8 + 0.5) % 8;
  const illumination = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
  return {
    phase,
    age,
    illumination,
    waxing: phase < 0.5,
    name: MOON_NAMES[idx],
    visible: illumination > 0.03
  };
}

function liveCloudiness(latest, dayPhase) {
  if ((latest?.rain_rate_mm ?? 0) > 0.05) return 0.92;
  if (dayPhase === 'night') return 0.35;
  const solar = latest?.solar_wm2 ?? 0;
  if (solar > 650) return 0.08;
  if (solar > 350) return 0.28;
  if (solar > 100) return 0.55;
  return 0.82;
}

function liveWindStrength(speed, gust) {
  const s = Math.max(speed ?? 0, (gust ?? 0) * 0.65);
  return Math.min(1, s / 45);
}

/** Dĺžka jedného cyklu oblakov — kratšia pri silnejšom vetre (km/h). */
function liveCloudDriftDuration(windSpeed, windStr) {
  const kmh = Math.max(0, windSpeed ?? 0);
  const boost = (windStr ?? 0) * 18;
  const combined = kmh + boost;
  return Math.max(8, Math.min(110, 105 - combined * 2.1));
}

function liveRainIntensity(rate) {
  if (!rate || rate <= 0) return 0;
  return Math.min(1, rate / 8);
}

function buildLiveSceneState(latest, at = getLiveSceneTime()) {
  const { hour, minute, month } = liveLocalParts(at);
  const dayPhase = liveDayPhase(hour, minute);
  const isNight = dayPhase === 'night' || dayPhase === 'dusk';
  const temp = latest?.outdoor_temp_c;
  const windFrom = latest?.wind_direction;
  const windSpeed = latest?.wind_speed_kmh ?? 0;
  const windGust = latest?.wind_gust_kmh ?? 0;
  const rainRate = latest?.rain_rate_mm ?? 0;
  const snow = temp != null && temp < 1 && rainRate > 0;
  const windStr = liveWindStrength(windSpeed, windGust);
  const blowTo = windFrom != null ? normDegLive(windFrom + 180) : 180;
  const moon = getMoonPhase(at);
  const sunPos = liveCelestialPos(liveSunProgress(hour, minute));
  const moonPos = liveCelestialPos(liveMoonProgress(hour, minute));

  return {
    at,
    hour,
    minute,
    month,
    season: liveSeason(month),
    dayPhase,
    isNight,
    temp,
    windFrom: windFrom != null ? normDegLive(windFrom) : null,
    blowTo,
    windSpeed,
    windStr,
    rainRate,
    rainInt: liveRainIntensity(rainRate),
    snow,
    clouds: liveCloudiness(latest, dayPhase),
    moon,
    sunPos,
    moonPos,
    frozen: temp != null && temp < 0,
    hot: temp != null && temp > 28,
    humid: (latest?.outdoor_humidity ?? 0) > 85,
    customTime: isLiveSceneCustomTime()
  };
}

function ensureLiveParticles(container, count, cls) {
  const key = `${cls}:${count}`;
  if (container.dataset.key === key) return;
  container.dataset.key = key;
  container.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    el.className = cls;
    el.style.left = `${(i * 13.7 + 5) % 98}%`;
    el.style.animationDelay = `${-(i * 0.17) % 2.5}s`;
    el.style.animationDuration = `${0.55 + (i % 7) * 0.08}s`;
    frag.appendChild(el);
  }
  container.appendChild(frag);
}

function updateLiveTimeHint() {
  const hint = document.getElementById('liveTimeHint');
  if (!hint) return;
  if (isLiveSceneCustomTime()) {
    hint.textContent = `Náhľad scény: ${formatLiveSceneWhen(getLiveSceneTime())} · merania sú aktuálne`;
  } else {
    hint.textContent = 'Scéna sleduje reálny čas. Počasie z posledného syncu.';
  }
}

function initLiveTimeControls() {
  const input = document.getElementById('liveDateTime');
  const check = document.getElementById('liveUseCustomTime');
  if (!input || !check) return;

  input.value = toDatetimeLocalValue(new Date());
  input.disabled = !check.checked;

  const syncFields = () => {
    input.disabled = !check.checked;
  };

  const applyFromInput = () => {
    const d = parseDatetimeLocalValue(input.value);
    if (!d) return;
    setLiveSceneTime(d);
    check.checked = true;
    renderLiveScene(window.__liveLatest);
    updateLiveTimeHint();
  };

  check.addEventListener('change', () => {
    syncFields();
    if (check.checked) {
      applyFromInput();
    } else {
      clearLiveSceneTime();
      input.value = toDatetimeLocalValue(new Date());
      renderLiveScene(window.__liveLatest);
      updateLiveTimeHint();
    }
  });

  input.addEventListener('change', () => {
    if (check.checked) applyFromInput();
  });

  document.getElementById('liveTimeApply')?.addEventListener('click', applyFromInput);

  document.getElementById('liveTimeNow')?.addEventListener('click', () => {
    clearLiveSceneTime();
    check.checked = false;
    syncFields();
    input.value = toDatetimeLocalValue(new Date());
    renderLiveScene(window.__liveLatest);
    updateLiveTimeHint();
  });

  updateLiveTimeHint();
}

function renderLiveScene(latest) {
  window.__liveLatest = latest;
  const root = document.getElementById('liveScene');
  if (!root) return;

  const s = buildLiveSceneState(latest);
  root.dataset.season = s.season;
  root.dataset.phase = s.dayPhase;
  root.dataset.frozen = s.frozen ? '1' : '0';
  root.dataset.hot = s.hot ? '1' : '0';
  root.dataset.humid = s.humid ? '1' : '0';
  root.dataset.rain = s.rainInt > 0 ? '1' : '0';
  root.dataset.snow = s.snow ? '1' : '0';
  root.dataset.custom = s.customTime ? '1' : '0';

  root.style.setProperty('--clouds', s.clouds.toFixed(2));
  root.style.setProperty('--wind-str', s.windStr.toFixed(2));
  const tilt = s.windStr > 0.05
    ? s.windStr * 32 * Math.sin(s.blowTo * Math.PI / 180) : 0;
  root.style.setProperty('--rain-tilt', `${tilt.toFixed(1)}deg`);
  root.style.setProperty('--wind-x', String(Math.cos((s.blowTo - 90) * Math.PI / 180)));
  root.style.setProperty('--rain-int', s.rainInt.toFixed(2));

  const driftDeg = s.windFrom != null ? s.blowTo : 90;
  const driftRad = ((driftDeg - 90) * Math.PI) / 180;
  const dist = 420;
  const cos = Math.cos(driftRad);
  const sin = Math.sin(driftRad);
  root.style.setProperty('--cloud-from-x', `${(-cos * 85).toFixed(1)}px`);
  root.style.setProperty('--cloud-from-y', `${(-sin * 42).toFixed(1)}px`);
  root.style.setProperty('--cloud-to-x', `${(cos * dist).toFixed(1)}px`);
  root.style.setProperty('--cloud-to-y', `${(sin * dist * 0.42).toFixed(1)}px`);
  const cloudDur = liveCloudDriftDuration(s.windSpeed, s.windStr);
  root.style.setProperty('--cloud-dur', `${cloudDur}s`);
  root.style.setProperty('--cloud-dur-b', `${(cloudDur * 1.22).toFixed(1)}s`);
  root.style.setProperty('--cloud-dur-c', `${(cloudDur * 0.86).toFixed(1)}s`);

  const applyCelestial = (wrap, pos, el, show) => {
    if (!wrap || !el) return;
    const visible = show && pos?.visible;
    wrap.classList.toggle('hidden', !visible);
    if (!visible) return;
    wrap.style.left = `${pos.x}%`;
    wrap.style.top = `${pos.y}%`;
    if (pos.atHorizon) wrap.classList.add('at-horizon');
    else wrap.classList.remove('at-horizon');
  };

  const showSun = s.dayPhase !== 'night' && s.sunPos?.visible;
  const showMoon = s.moon.visible && s.moonPos?.visible
    && (s.dayPhase === 'night' || s.dayPhase === 'dusk' || s.dayPhase === 'dawn');

  applyCelestial(
    document.getElementById('liveSunWrap'),
    s.sunPos,
    document.getElementById('liveSun'),
    showSun
  );
  applyCelestial(
    document.getElementById('liveMoonWrap'),
    s.moonPos,
    document.getElementById('liveMoon'),
    showMoon
  );

  const moonEl = document.getElementById('liveMoon');
  const moonMask = document.getElementById('liveMoonMaskShadow');
  if (moonEl && showMoon) {
    moonEl.style.opacity = String(0.55 + s.moon.illumination * 0.45);
  }
  if (moonMask) {
    const shift = Math.cos(s.moon.phase * 2 * Math.PI) * 54;
    moonMask.setAttribute('cx', String(32 + shift));
  }

  const vane = document.getElementById('liveVane');
  if (vane) {
    const deg = s.windFrom ?? 0;
    vane.setAttribute('transform', `rotate(${deg})`);
    const clock = vane.closest('.live-wind-clock');
    if (clock) {
      const lbl = s.windFrom != null
        ? `Smer vetra: fúka zo ${Math.round(deg)}°`
        : 'Smer vetra: —';
      clock.setAttribute('aria-label', lbl);
    }
  }

  const treeL = document.getElementById('liveTreeL');
  const treeR = document.getElementById('liveTreeR');
  const sway = `${Math.max(1.2, 3.8 - s.windStr * 2.5)}s`;
  [treeL, treeR].forEach((t, i) => {
    if (!t) return;
    t.style.animationDuration = sway;
    t.style.animationDelay = i ? '-0.4s' : '0s';
  });

  const precip = document.getElementById('livePrecip');
  if (precip) {
    if (s.rainInt <= 0) {
      precip.innerHTML = '';
      precip.dataset.key = '';
    } else {
      const n = Math.round(12 + s.rainInt * 48);
      ensureLiveParticles(precip, n, s.snow ? 'live-snowflake' : 'live-raindrop');
    }
  }

  const windBits = document.getElementById('liveWindBits');
  if (windBits) {
    if (s.windStr < 0.12) {
      windBits.innerHTML = '';
      windBits.dataset.key = '';
    } else {
      const n = Math.round(4 + s.windStr * 14);
      ensureLiveParticles(windBits, n, 'live-windbit');
    }
  }

  const cap = document.getElementById('liveCaption');
  if (cap) {
    const parts = [];
    if (s.customTime) parts.push('Náhľad');
    if (s.isNight) parts.push(s.moon.name);
    else parts.push(s.dayPhase === 'dawn' ? 'Úsvit' : s.dayPhase === 'dusk' ? 'Súmrak' : 'Deň');
    if (s.rainInt > 0) parts.push(s.snow ? 'Sneží' : 'Prší');
    else if (s.windStr > 0.35) parts.push('Fúka vietor');
    if (s.frozen) parts.push('Mráz');
    cap.textContent = parts.join(' · ') || 'Pokojné počasie';
  }

  const stats = document.getElementById('liveStats');
  if (stats) {
    stats.innerHTML = [
      s.temp != null ? `<span>${Number(s.temp).toFixed(1)} °C</span>` : '',
      s.windSpeed != null ? `<span>💨 ${Number(s.windSpeed).toFixed(1)} km/h</span>` : '',
      s.rainRate > 0 ? `<span>🌧 ${Number(s.rainRate).toFixed(1)} mm/h</span>` : ''
    ].filter(Boolean).join('');
  }

  updateLiveTimeHint();
}
