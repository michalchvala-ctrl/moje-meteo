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

module.exports = { chartPeriodBounds, chartPeriodRangeIso };
