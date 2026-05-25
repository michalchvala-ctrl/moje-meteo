/**
 * Plánovanie syncu na hranice intervalu (napr. :00, :05, :10 … v TZ kontajnera).
 */

const SYNC_OFFSET_SEC = Math.max(0, Math.min(120, parseInt(process.env.SYNC_OFFSET_SEC || '15', 10)));

function clampIntervalMin(min) {
  return Math.max(1, Math.min(60, parseInt(min, 10) || 5));
}

/** Najbližší čas zarovnaný na interval (minúty % interval === 0, sekundy 0). */
function nextAlignedDate(intervalMin, from = new Date(), offsetSec = SYNC_OFFSET_SEC) {
  const step = clampIntervalMin(intervalMin);
  const d = new Date(from);
  d.setMilliseconds(0);
  d.setSeconds(offsetSec);

  const min = d.getMinutes();
  const rem = min % step;
  if (rem !== 0 || from > d) {
    d.setMinutes(min + (rem === 0 ? step : step - rem));
  }

  if (d <= from) {
    d.setMinutes(d.getMinutes() + step);
  }

  return d;
}

function msUntilNextAligned(intervalMin, from = new Date()) {
  const next = nextAlignedDate(intervalMin, from);
  return Math.max(0, next.getTime() - from.getTime());
}

function formatAlignedTime(d) {
  return d.toLocaleString('sk-SK', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Europe/Bratislava'
  });
}

/** SQLite datetime('now') alebo ISO z API. */
function parseDbTimestamp(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) && !/Z|[+-]\d{2}:\d{2}/.test(s)) {
    return new Date(s.replace(' ', 'T') + 'Z');
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function nowIso() {
  return new Date().toISOString();
}

/** Časová značka vzorky = začiatok aktuálneho intervalu (napr. sync o 14:05:15 → 14:05:00). */
function alignedSampleTimestamp(intervalMin, at = new Date()) {
  const step = clampIntervalMin(intervalMin);
  const d = new Date(at);
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  d.setMinutes(m - (m % step));
  return d.toISOString();
}

let timer = null;

function stopAlignedScheduler() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function startAlignedScheduler(tickFn, getIntervalMin) {
  stopAlignedScheduler();

  const scheduleNext = () => {
    const intervalMin = clampIntervalMin(getIntervalMin());
    const delay = msUntilNextAligned(intervalMin);
    const next = nextAlignedDate(intervalMin);

    timer = setTimeout(async () => {
      try {
        await tickFn();
      } catch (_) { /* log v tick */ }
      scheduleNext();
    }, delay);

    console.log(
      `[meteo] Ďalší sync o ${formatAlignedTime(next)} ` +
      `(každých ${intervalMin} min, +${SYNC_OFFSET_SEC}s, TZ=${process.env.TZ || 'system'})`
    );
  };

  scheduleNext();
}

module.exports = {
  SYNC_OFFSET_SEC,
  clampIntervalMin,
  nextAlignedDate,
  msUntilNextAligned,
  formatAlignedTime,
  alignedSampleTimestamp,
  parseDbTimestamp,
  nowIso,
  startAlignedScheduler,
  stopAlignedScheduler
};
