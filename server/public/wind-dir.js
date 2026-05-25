/** Smer vetra v stupňoch (0 = sever, kam fúka). Ecowitt: väčšinou 0–360°. */

function parseWindDirectionDeg(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n <= 16 && Math.abs(n - Math.round(n)) < 0.01) {
    return ((Math.round(n) * 22.5) % 360 + 360) % 360;
  }
  return ((n % 360) + 360) % 360;
}

function degToCompassShort(deg) {
  const labels = ['S', 'SV', 'V', 'JV', 'J', 'JZ', 'Z', 'SZ'];
  return labels[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}
