/**
 * Kalendárne obdobia v lokálnom čase servera (TZ kontajnera, napr. Europe/Bratislava).
 * 24h = dnes od 00:00, 7d = 7 kalendárnych dní (dnes + 6 späť), atď.
 */
function chartPeriodBounds(period) {
  const to = new Date();
  const from = new Date(to);

  switch (period) {
    case '24h':
      from.setHours(0, 0, 0, 0);
      break;
    case '7d':
      from.setDate(from.getDate() - 6);
      from.setHours(0, 0, 0, 0);
      break;
    case '30d':
      from.setDate(from.getDate() - 29);
      from.setHours(0, 0, 0, 0);
      break;
    case 'year':
      from.setDate(from.getDate() - 364);
      from.setHours(0, 0, 0, 0);
      break;
    default:
      from.setHours(0, 0, 0, 0);
  }

  return { from, to };
}

function chartPeriodRangeIso(period) {
  const { from, to } = chartPeriodBounds(period);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    period: period || '24h'
  };
}

/** Jeden kalendárny deň (lokálny čas servera / TZ kontajnera). date = YYYY-MM-DD */
function chartDayRangeIso(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!m) throw new Error('Neplatný dátum (očakávané YYYY-MM-DD).');
  const from = new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0);
  const end = new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999);
  const now = new Date();
  const to = end > now ? now : end;
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    period: 'day',
    date: `${m[1]}-${m[2]}-${m[3]}`
  };
}

function chartResolveRange({ period, date } = {}) {
  if (date) return chartDayRangeIso(date);
  return chartPeriodRangeIso(period || '24h');
}

module.exports = {
  chartPeriodBounds,
  chartPeriodRangeIso,
  chartDayRangeIso,
  chartResolveRange
};
