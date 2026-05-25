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

/** ISO čas v Europe/Bratislava pre API (zhoda so recorded_at v DB). */
function toSceneApiTime(d = new Date()) {
  const p = liveLocalParts(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00`;
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

/** Posun tieňa v maske: k=0 nov (stred), k=1 spln (tieň mimo). Dorastá = svetlo vpravo. */
function moonShadowCenterX(cx, r, illumination, waxing) {
  const k = Math.max(0, Math.min(1, illumination));
  const shift = 2 * r * k;
  return waxing ? cx - shift : cx + shift;
}

function moonPhaseNameFromAge(age) {
  const s = MOON_SYNODIC;
  if (age < s * 0.03) return MOON_NAMES[0];
  if (age < s * 0.22) return MOON_NAMES[1];
  if (age < s * 0.28) return MOON_NAMES[2];
  if (age < s * 0.47) return MOON_NAMES[3];
  if (age < s * 0.53) return MOON_NAMES[4];
  if (age < s * 0.72) return MOON_NAMES[5];
  if (age < s * 0.78) return MOON_NAMES[6];
  return MOON_NAMES[7];
}

function getMoonPhase(date = new Date()) {
  const days = (date.getTime() - MOON_EPOCH) / 86400000;
  const age = ((days % MOON_SYNODIC) + MOON_SYNODIC) % MOON_SYNODIC;
  const phase = age / MOON_SYNODIC;
  const illumination = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
  const waxing = age < MOON_SYNODIC / 2;
  return {
    phase,
    age,
    illumination,
    waxing,
    name: moonPhaseNameFromAge(age),
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
  const windFrom = typeof parseWindDirectionDeg === 'function'
    ? parseWindDirectionDeg(latest?.wind_direction)
    : latest?.wind_direction;
  const windSpeed = latest?.wind_speed_kmh ?? 0;
  const windGust = latest?.wind_gust_kmh ?? 0;
  const rainRate = latest?.rain_rate_mm ?? 0;
  const snow = temp != null && temp < 1 && rainRate > 0;
  const windStr = liveWindStrength(windSpeed, windGust);
  const blowTo = windFrom != null ? ((windFrom + 180) % 360 + 360) % 360 : 180;
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
    windFrom,
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

let liveSceneWxNote = '';

async function resolveLiveWeather(latest) {
  if (!isLiveSceneCustomTime() || !latest) {
    liveSceneWxNote = '';
    return latest;
  }
  const at = getLiveSceneTime();
  try {
    const near = await api(`/api/samples/nearest?at=${encodeURIComponent(at.toISOString())}`);
    if (!near) {
      liveSceneWxNote = 'pre tento čas nie sú vzorky — vietor z posledného syncu';
      return latest;
    }
    const when = near.recorded_at
      ? new Date(near.recorded_at).toLocaleString('sk-SK', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        timeZone: LIVE_TZ
      })
      : '';
    liveSceneWxNote = when ? `merania z ${when}` : 'merania z histórie';
    return { ...latest, ...near };
  } catch {
    liveSceneWxNote = '';
    return latest;
  }
}

function updateLiveTimeHint() {
  const hint = document.getElementById('liveTimeHint');
  if (!hint) return;
  if (isLiveSceneCustomTime()) {
    const extra = liveSceneWxNote ? ` · ${liveSceneWxNote}` : '';
    hint.textContent = `Náhľad scény: ${formatLiveSceneWhen(getLiveSceneTime())}${extra}`;
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

  const applyFromInput = async () => {
    const d = parseDatetimeLocalValue(input.value);
    if (!d) return;
    setLiveSceneTime(d);
    check.checked = true;
    await renderLiveScene(window.__liveLatest);
  };

  check.addEventListener('change', async () => {
    syncFields();
    if (check.checked) {
      await applyFromInput();
    } else {
      clearLiveSceneTime();
      input.value = toDatetimeLocalValue(new Date());
      await renderLiveScene(window.__liveLatest);
    }
  });

  input.addEventListener('change', () => {
    if (check.checked) applyFromInput();
  });

  document.getElementById('liveTimeApply')?.addEventListener('click', () => applyFromInput());

  document.getElementById('liveTimeNow')?.addEventListener('click', async () => {
    clearLiveSceneTime();
    check.checked = false;
    syncFields();
    input.value = toDatetimeLocalValue(new Date());
    await renderLiveScene(window.__liveLatest);
  });

  updateLiveTimeHint();
}

async function renderLiveScene(latest) {
  window.__liveLatest = latest;
  const root = document.getElementById('liveScene');
  if (!root) return;

  const wx = await resolveLiveWeather(latest);
  const s = buildLiveSceneState(wx);
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
  const east = Math.sin((driftDeg * Math.PI) / 180);
  const cloudDur = liveCloudDriftDuration(s.windSpeed, s.windStr);
  root.style.setProperty('--cloud-dur', `${cloudDur}s`);
  root.style.setProperty('--cloud-dur-b', `${(cloudDur * 1.2).toFixed(1)}s`);
  root.style.setProperty('--cloud-dur-c', `${(cloudDur * 1.55).toFixed(1)}s`);
  const windEl = document.getElementById('liveCloudWind');
  if (windEl) {
    windEl.dataset.reverse = east < 0 ? '1' : '0';
    windEl.dataset.flow = east >= 0 ? 'east' : 'west';
  }

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

  const moonSvg = document.getElementById('liveMoon');
  const moonShadow = document.getElementById('liveMoonShadow');
  if (moonSvg && showMoon) {
    moonSvg.style.opacity = String(0.55 + s.moon.illumination * 0.45);
  }
  if (moonShadow) {
    const cx = moonShadowCenterX(32, 27, s.moon.illumination, s.moon.waxing);
    moonShadow.setAttribute('cx', String(cx));
    moonShadow.setAttribute('cy', '32');
    moonShadow.setAttribute('r', '27');
  }

  const vane = document.getElementById('liveVane');
  if (vane) {
    const deg = s.windFrom != null ? s.windFrom : null;
    if (deg != null) {
      vane.setAttribute('transform', `rotate(${deg} 0 0)`);
      vane.dataset.deg = String(deg);
    } else {
      vane.setAttribute('transform', 'rotate(0 0 0)');
      vane.dataset.deg = '';
    }
    const clock = vane.closest('.live-wind-clock');
    if (clock) {
      const lbl = deg != null
        ? `Smer vetra: fúka zo ${Math.round(deg)}° (${typeof degToCompassShort === 'function' ? degToCompassShort(deg) : ''})`
        : 'Smer vetra: bez údajov';
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
    if (s.isNight || s.moon.visible) {
      const pct = Math.round(s.moon.illumination * 100);
      parts.push(`${s.moon.name} (${pct} %)`);
    } else if (!s.customTime) {
      parts.push(s.dayPhase === 'dawn' ? 'Úsvit' : s.dayPhase === 'dusk' ? 'Súmrak' : 'Deň');
    }
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
      s.windFrom != null ? `<span>🧭 ${Math.round(s.windFrom)}° ${typeof degToCompassShort === 'function' ? degToCompassShort(s.windFrom) : ''}</span>` : '',
      s.rainRate > 0 ? `<span>🌧 ${Number(s.rainRate).toFixed(1)} mm/h</span>` : '',
      s.moon.visible ? `<span>🌙 ${(s.moon.illumination * 100).toFixed(1)} %</span>` : ''
    ].filter(Boolean).join('');
  }

  updateLiveTimeHint();
}
