/**
 * Proxy radarových dlaždíc (RainViewer / LibreWXR) pre klienta cez /api/radar/*.
 */

const PROVIDERS = {
  rainviewer: {
    id: 'rainviewer',
    apiUrl: 'https://api.rainviewer.com/public/weather-maps.json',
    defaultHost: 'https://tilecache.rainviewer.com',
    color: 2,
    tileSize: 256
  },
  librewxr: {
    id: 'librewxr',
    apiUrl: 'https://api.librewxr.net/public/weather-maps.json',
    defaultHost: 'https://api.librewxr.net',
    color: 2,
    tileSize: 256
  }
};

const hostCache = new Map();
const HOST_TTL_MS = 5 * 60 * 1000;

function normalizeProvider(id) {
  return id === 'librewxr' ? 'librewxr' : 'rainviewer';
}

function normalizePath(path) {
  const p = String(path || '').trim();
  if (!/^\/v2\/radar\/[A-Za-z0-9_-]+$/.test(p)) {
    throw new Error('Neplatná cesta radarovej snímky.');
  }
  return p;
}

async function getApiHost(provider) {
  const id = normalizeProvider(provider);
  const cached = hostCache.get(id);
  if (cached && cached.expires > Date.now()) return cached.host;

  const cfg = PROVIDERS[id];
  const res = await fetch(cfg.apiUrl);
  if (!res.ok) throw new Error(`${cfg.id} metadata HTTP ${res.status}`);
  const data = await res.json();
  const host = String(data.host || cfg.defaultHost).replace(/\/$/, '');
  hostCache.set(id, { host, expires: Date.now() + HOST_TTL_MS });
  return host;
}

async function fetchFrames(provider) {
  const id = normalizeProvider(provider);
  const cfg = PROVIDERS[id];
  const res = await fetch(cfg.apiUrl);
  if (!res.ok) throw new Error(`${cfg.id} metadata HTTP ${res.status}`);
  const data = await res.json();
  const host = String(data.host || cfg.defaultHost).replace(/\/$/, '');
  hostCache.set(id, { host, expires: Date.now() + HOST_TTL_MS });
  const past = data?.radar?.past || [];
  const nowcast = data?.radar?.nowcast || [];
  const frames = [...past, ...nowcast];
  if (!frames.length) throw new Error(`${cfg.id}: radar momentálne nemá snímky.`);
  return { provider: id, host, frames };
}

function buildUpstreamTileUrl(host, provider, path, z, x, y) {
  const cfg = PROVIDERS[normalizeProvider(provider)];
  const safePath = normalizePath(path);
  return `${host}${safePath}/${cfg.tileSize}/${z}/${x}/${y}/${cfg.color}/1_1.png`;
}

async function fetchTile(provider, path, z, x, y) {
  const host = await getApiHost(provider);
  const url = buildUpstreamTileUrl(host, provider, path, z, x, y);
  const res = await fetch(url);
  return { res, url };
}

module.exports = {
  PROVIDERS,
  normalizeProvider,
  normalizePath,
  fetchFrames,
  fetchTile
};
