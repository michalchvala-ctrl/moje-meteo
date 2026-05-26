/**
 * Radar zrážok — RainViewer / LibreWXR + Leaflet (lazy load).
 * Dáta cez /api/radar/* (proxy dlaždíc — spoľahlivé prepínanie zdrojov).
 */
(function () {
  const STORAGE_KEY = 'meteo_radar_provider';
  const ANIM_MS = 550;
  const FALLBACK = { lat: 48.1486, lon: 17.1077, name: 'Bratislava', zoom: 8 };

  const PROVIDERS = {
    rainviewer: {
      id: 'rainviewer',
      label: 'RainViewer',
      attribution: { name: 'RainViewer', url: 'https://www.rainviewer.com/' },
      licenseNote: ''
    },
    librewxr: {
      id: 'librewxr',
      label: 'LibreWXR',
      attribution: { name: 'LibreWXR', url: 'https://librewxr.net/' },
      licenseNote: ' (CC-BY-4.0)'
    }
  };

  let providerId = loadProviderId();
  let map = null;
  let radarLayer = null;
  let frames = [];
  let frameIdx = 0;
  let currentFramePath = '';
  let playing = false;
  let playTimer = null;
  let leafletPromise = null;
  let mapReady = false;
  let lastLocKey = '';
  let lastFetchKey = '';
  let tileErrors = 0;

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

  function $$(sel) {
    return [...document.querySelectorAll(sel)];
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
    const enc = encodeURIComponent(path);
    return `/api/radar/tile?provider=${providerId}&path=${enc}&z={z}&x={x}&y={y}`;
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

  function removeRadarLayer() {
    if (map && radarLayer) {
      map.removeLayer(radarLayer);
    }
    radarLayer = null;
  }

  function attachRadarLayer(path) {
    if (!map || !path) return;
    removeRadarLayer();
    currentFramePath = path;
    tileErrors = 0;
    radarLayer = L.tileLayer(tileUrl(path), {
      pane: 'radarPane',
      tileSize: 256,
      opacity: 0.82,
      maxNativeZoom: 7,
      maxZoom: 12,
      className: `radar-tiles radar-tiles-${providerId}`,
      updateWhenZooming: true,
      updateWhenIdle: true
    });
    radarLayer.on('tileerror', () => {
      tileErrors += 1;
      if (tileErrors === 3) {
        setMeta(
          `${currentProvider().label}: dlaždice sa nenačítavajú — skús ⟳ alebo druhý zdroj.`,
          true
        );
      }
    });
    radarLayer.addTo(map);
    radarLayer.bringToFront();
  }

  function showFrame(index) {
    if (!frames.length) return;
    frameIdx = Math.max(0, Math.min(frames.length - 1, index));
    const frame = frames[frameIdx];
    if (!frame?.path) return;
    if (!radarLayer || currentFramePath !== frame.path) {
      attachRadarLayer(frame.path);
    } else {
      radarLayer.setUrl(tileUrl(frame.path));
    }
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
    map.createPane('radarPane');
    map.getPane('radarPane').style.zIndex = 450;
    mapReady = true;
    setTimeout(() => map.invalidateSize(), 80);
  }

  async function fetchFrames() {
    if (typeof api !== 'function') {
      throw new Error('Radar vyžaduje prihlásenie do aplikácie.');
    }
    const p = currentProvider();
    const data = await api(`/api/radar/frames?provider=${p.id}`);
    frames = data.frames || [];
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
        removeRadarLayer();
        await fetchFrames();
        lastFetchKey = fetchKey;
      }

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
      if (map) {
        map.invalidateSize();
        setTimeout(() => map.invalidateSize(), 150);
      }
    } catch (e) {
      removeRadarLayer();
      setMeta(e.message || 'Radar sa nepodarilo načítať.', true);
    }
  }

  function setProvider(id) {
    if (!PROVIDERS[id] || id === providerId) return;
    saveProviderId(id);
    stopPlay();
    removeRadarLayer();
    frames = [];
    currentFramePath = '';
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
      removeRadarLayer();
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
