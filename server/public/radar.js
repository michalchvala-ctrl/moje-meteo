/**
 * Radar zrážok — RainViewer / LibreWXR + Leaflet (lazy load).
 * Lokalita z nastavenia predpovede (forecast_lat/lon).
 */
(function () {
  const STORAGE_KEY = 'meteo_radar_provider';
  const TILE_SIZE = typeof window !== 'undefined' && window.devicePixelRatio >= 2 ? 512 : 256;
  const ANIM_MS = 550;
  const FALLBACK = { lat: 48.1486, lon: 17.1077, name: 'Bratislava', zoom: 8 };

  const PROVIDERS = {
    rainviewer: {
      id: 'rainviewer',
      label: 'RainViewer',
      apiUrl: 'https://api.rainviewer.com/public/weather-maps.json',
      defaultHost: 'https://tilecache.rainviewer.com',
      tileSize: TILE_SIZE,
      color: 2,
      options: '1_1',
      attribution: { name: 'RainViewer', url: 'https://www.rainviewer.com/' },
      licenseNote: ''
    },
    librewxr: {
      id: 'librewxr',
      label: 'LibreWXR',
      apiUrl: 'https://api.librewxr.net/public/weather-maps.json',
      defaultHost: 'https://api.librewxr.net',
      tileSize: 256,
      color: 7,
      options: '1_1',
      attribution: { name: 'LibreWXR', url: 'https://librewxr.net/' },
      licenseNote: ' (CC-BY-4.0)'
    }
  };

  let providerId = loadProviderId();
  let map = null;
  let radarLayer = null;
  let apiHost = PROVIDERS[providerId].defaultHost;
  let frames = [];
  let frameIdx = 0;
  let playing = false;
  let playTimer = null;
  let leafletPromise = null;
  let mapReady = false;
  let lastLocKey = '';
  let lastFetchKey = '';

  function currentProvider() {
    return PROVIDERS[providerId] || PROVIDERS.rainviewer;
  }

  function loadProviderId() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v && PROVIDERS[v]) return v;
    } catch (_) { /* ignore */ }
    return 'rainviewer';
  }

  function saveProviderId(id) {
    providerId = id;
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch (_) { /* ignore */ }
  }

  function $(sel) {
    return document.querySelector(sel);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Nepodarilo sa načítať ${src}`));
      document.head.appendChild(s);
    });
  }

  function loadStylesheet(href) {
    if (document.querySelector(`link[href="${href}"]`)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = () => resolve();
      link.onerror = () => reject(new Error(`Nepodarilo sa načítať ${href}`));
      document.head.appendChild(link);
    });
  }

  async function ensureLeaflet() {
    if (window.L) return window.L;
    if (!leafletPromise) {
      leafletPromise = (async () => {
        await loadStylesheet('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
        await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
        if (!window.L) throw new Error('Leaflet nie je k dispozícii.');
        return window.L;
      })();
    }
    return leafletPromise;
  }

  async function resolveLocation() {
    if (typeof getMeteoForecastLocation === 'function') {
      const loc = getMeteoForecastLocation();
      if (loc) {
        return {
          lat: loc.lat,
          lon: loc.lon,
          name: loc.name,
          zoom: 9,
          source: loc.source
        };
      }
    }
    if (typeof api === 'function') {
      try {
        const s = await api('/api/settings');
        const fc = s?.forecast;
        if (fc?.saved && fc.lat != null && fc.lon != null) {
          return {
            lat: Number(fc.lat),
            lon: Number(fc.lon),
            name: (fc.name || fc.label || '').trim() || 'Lokalita',
            zoom: 9,
            source: 'server'
          };
        }
      } catch (_) { /* ignore */ }
    }
    return { ...FALLBACK, source: 'fallback' };
  }

  function tileUrl(path) {
    const p = currentProvider();
    return `${apiHost}${path}/${p.tileSize}/{z}/{x}/{y}/${p.color}/${p.options}.png`;
  }

  function formatFrameTime(unix) {
    return new Date(unix * 1000).toLocaleString('sk-SK', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Bratislava'
    });
  }

  function setMeta(text, isError) {
    const el = $('#radarMeta');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('error', !!isError);
  }

  function $$(sel) {
    return [...document.querySelectorAll(sel)];
  }

  function updateAttribution() {
    const el = $('#radarSourceLink');
    const p = currentProvider();
    if (!el) return;
    el.textContent = p.attribution.name + p.licenseNote;
    el.href = p.attribution.url;
  }

  function syncProviderUi() {
    $$('#radarProviderSeg button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.provider === providerId);
    });
    updateAttribution();
  }

  function updateSliderUi() {
    const slider = $('#radarSlider');
    const timeEl = $('#radarFrameTime');
    if (!slider || !frames.length) return;
    slider.min = '0';
    slider.max = String(Math.max(0, frames.length - 1));
    slider.value = String(frameIdx);
    slider.disabled = frames.length < 2;
    if (timeEl && frames[frameIdx]) {
      timeEl.textContent = formatFrameTime(frames[frameIdx].time);
    }
  }

  function showFrame(index) {
    if (!frames.length || !radarLayer) return;
    frameIdx = Math.max(0, Math.min(frames.length - 1, index));
    const frame = frames[frameIdx];
    radarLayer.setUrl(tileUrl(frame.path));
    updateSliderUi();
  }

  function stopPlay() {
    playing = false;
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
    }
    const btn = $('#btnRadarPlay');
    if (btn) {
      btn.textContent = '▶ Prehrať';
      btn.setAttribute('aria-pressed', 'false');
    }
  }

  function startPlay() {
    if (frames.length < 2) return;
    playing = true;
    const btn = $('#btnRadarPlay');
    if (btn) {
      btn.textContent = '⏸ Pauza';
      btn.setAttribute('aria-pressed', 'true');
    }
    playTimer = setInterval(() => {
      const next = (frameIdx + 1) % frames.length;
      showFrame(next);
    }, ANIM_MS);
  }

  function togglePlay() {
    if (playing) stopPlay();
    else startPlay();
  }

  function createMap(L, loc) {
    const wrap = $('#radarMap');
    if (!wrap) return;
    if (map) {
      map.remove();
      map = null;
      radarLayer = null;
      mapReady = false;
    }
    wrap.innerHTML = '';
    map = L.map(wrap, {
      center: [loc.lat, loc.lon],
      zoom: loc.zoom,
      zoomControl: true,
      attributionControl: true
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    L.circleMarker([loc.lat, loc.lon], {
      radius: 7,
      color: 'var(--primary, #5b9bd9)',
      weight: 2,
      fillColor: '#fff',
      fillOpacity: 0.9
    }).addTo(map).bindPopup(loc.name);
    mapReady = true;
    setTimeout(() => map.invalidateSize(), 80);
  }

  function ensureRadarLayer(L) {
    if (!map) return;
    if (radarLayer) {
      map.removeLayer(radarLayer);
      radarLayer = null;
    }
    const path = frames[frameIdx]?.path || frames[frames.length - 1]?.path;
    if (!path) return;
    radarLayer = L.tileLayer(tileUrl(path), {
      tileSize: 256,
      opacity: 0.78,
      maxNativeZoom: 7,
      maxZoom: 12,
      zIndex: 200
    });
    radarLayer.addTo(map);
  }

  async function fetchFrames() {
    const p = currentProvider();
    const res = await fetch(p.apiUrl);
    if (!res.ok) throw new Error(`${p.label} HTTP ${res.status}`);
    const data = await res.json();
    apiHost = data.host || p.defaultHost;
    const past = data?.radar?.past || [];
    const nowcast = data?.radar?.nowcast || [];
    frames = [...past, ...nowcast];
    if (!frames.length) throw new Error(`${p.label}: radar momentálne nemá snímky.`);
    frameIdx = frames.length - 1;
  }

  async function initRadarView(force = false) {
    const view = $('#view-radar');
    if (!view?.classList.contains('active') && !force) return;

    syncProviderUi();
    setMeta(`Načítavam radar (${currentProvider().label})…`);
    stopPlay();

    try {
      const L = await ensureLeaflet();
      const loc = await resolveLocation();
      const locKey = `${loc.lat},${loc.lon}`;
      const fetchKey = `${providerId}|${locKey}`;

      if (!mapReady || lastLocKey !== locKey) {
        createMap(L, loc);
        lastLocKey = locKey;
      }

      if (lastFetchKey !== fetchKey || !frames.length) {
        await fetchFrames();
        lastFetchKey = fetchKey;
      }

      ensureRadarLayer(L);
      showFrame(frameIdx);

      const updated = frames[frameIdx]
        ? formatFrameTime(frames[frameIdx].time)
        : '—';
      const srcHint = loc.source === 'backup'
        ? ' (záloha z prehliadača — ulož aj v Nastaveniach)'
        : loc.source === 'fallback'
          ? ' — nastav lokalitu v Predpovedi / Nastaveniach'
          : '';
      setMeta(`${currentProvider().label} · ${loc.name} · ${frames.length} snímok · posledná ${updated}${srcHint}`);
      if (map) map.invalidateSize();
    } catch (e) {
      setMeta(e.message || 'Radar sa nepodarilo načítať.', true);
    }
  }

  function setProvider(id) {
    if (!PROVIDERS[id] || id === providerId) return;
    saveProviderId(id);
    apiHost = currentProvider().defaultHost;
    frames = [];
    lastFetchKey = '';
    syncProviderUi();
    initRadarView(true);
  }

  function centerMap() {
    if (!map) return;
    resolveLocation().then((loc) => {
      map.setView([loc.lat, loc.lon], loc.zoom, { animate: true });
    });
  }

  function bindControls() {
    $('#btnRadarPlay')?.addEventListener('click', togglePlay);
    $('#btnRadarRefresh')?.addEventListener('click', () => {
      lastFetchKey = '';
      initRadarView(true);
    });
    $('#btnRadarCenter')?.addEventListener('click', centerMap);
    $('#radarSlider')?.addEventListener('input', (e) => {
      stopPlay();
      showFrame(parseInt(e.target.value, 10));
    });
    $$('#radarProviderSeg button').forEach((btn) => {
      btn.addEventListener('click', () => setProvider(btn.dataset.provider));
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') stopPlay();
    });
    syncProviderUi();
  }

  bindControls();
  window.initRadarView = initRadarView;
})();
