'use strict';

// ---------------------------------------------------------------------------
// Aggregation: raw match/practice records -> per-player analytics
// ---------------------------------------------------------------------------

/** Builds an X01 analytics summary for one player from (server-enriched) match records. */
function computeX01Overview(playerId, matches) {
  const relevant = matches
    .filter((m) => m.players.some((p) => p.id === playerId))
    .sort((a, b) => a.finishedAt - b.finishedAt);

  const totals = {
    matchesPlayed: 0, matchesWon: 0, totalDarts: 0, totalPoints: 0,
    bestAverage: 0, bestCheckout: 0, highestTurn: 0,
    tons: 0, oneForties: 0, maximums: 0, busts: 0,
    checkoutOpportunities: 0, checkoutsHit: 0,
  };
  const trend = [];

  for (const m of relevant) {
    const mp = m.players.find((p) => p.id === playerId);
    if (!mp) continue;
    totals.matchesPlayed += 1;
    if (m.winnerId === playerId) totals.matchesWon += 1;
    totals.totalDarts += mp.dartsThrownTotal;
    totals.totalPoints += mp.pointsScoredTotal;
    if (mp.average > totals.bestAverage) totals.bestAverage = mp.average;
    if (mp.highestCheckout > totals.bestCheckout) totals.bestCheckout = mp.highestCheckout;
    if (mp.highestTurn > totals.highestTurn) totals.highestTurn = mp.highestTurn;
    totals.tons += mp.tons || 0;
    totals.oneForties += mp.oneForties || 0;
    totals.maximums += mp.maximums || 0;
    totals.busts += mp.busts || 0;
    totals.checkoutOpportunities += mp.checkoutOpportunities || 0;
    totals.checkoutsHit += mp.checkoutsHit || 0;
    trend.push({
      date: m.finishedAt,
      average: mp.average,
      won: m.winnerId === playerId,
      opponents: m.players.filter((p) => p.id !== playerId).map((p) => p.name).join(', '),
      matchId: m.id,
    });
  }

  return {
    ...totals,
    winRate: totals.matchesPlayed ? (totals.matchesWon / totals.matchesPlayed) * 100 : 0,
    overallAverage: totals.totalDarts ? (totals.totalPoints / totals.totalDarts) * 3 : 0,
    checkoutRate: totals.checkoutOpportunities ? (totals.checkoutsHit / totals.checkoutOpportunities) * 100 : 0,
    trend,
  };
}

/** Builds a practice/training analytics summary for one player. */
function computePracticeOverview(playerId, sessions) {
  const relevant = sessions
    .filter((s) => s.player.id === playerId)
    .sort((a, b) => a.finishedAt - b.finishedAt);

  let totalDarts = 0;
  let totalPoints = 0;
  let bestAverage = 0;
  let bestRound = 0;
  const trend = [];

  for (const s of relevant) {
    totalDarts += s.totalDarts;
    totalPoints += s.totalPoints;
    if (s.average > bestAverage) bestAverage = s.average;
    trend.push({ date: s.finishedAt, average: s.average });
  }

  return {
    sessionsPlayed: relevant.length,
    totalDarts,
    totalPoints,
    bestAverage,
    bestRound,
    overallAverage: totalDarts ? (totalPoints / totalDarts) * 3 : 0,
    trend,
  };
}

// ---------------------------------------------------------------------------
// Small hand-rolled SVG charts (no external chart library — app must stay offline-safe)
// ---------------------------------------------------------------------------

function svgEl(tag, attrs) {
  const s = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<${tag} ${s}/>`;
}

/** Line chart of values over time. Returns an SVG markup string. */
function buildLineChartSVG(points, opts = {}) {
  const width = opts.width || 560;
  const height = opts.height || 150;
  const padTop = 16;
  const padBottom = 22;
  const padX = 8;
  const color = opts.color || 'var(--accent)';

  if (points.length === 0) {
    return `<svg viewBox="0 0 ${width} ${height}" class="chart-svg"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="chart-empty">Noch keine Daten</text></svg>`;
  }
  if (points.length === 1) {
    points = [points[0], points[0]];
  }

  const values = points.map((p) => p.average);
  const max = Math.max(...values, 1) * 1.15;
  const min = 0;
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;

  const coords = points.map((p, i) => {
    const x = padX + (i / (points.length - 1)) * innerW;
    const y = padTop + innerH - ((p.average - min) / (max - min)) * innerH;
    return { x, y, p };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${padTop + innerH} L ${coords[0].x.toFixed(1)} ${padTop + innerH} Z`;

  const dots = coords.map((c) => {
    const title = c.p.date ? new Date(c.p.date).toLocaleDateString('de-DE') : '';
    const wonCls = c.p.won === true ? ' chart-dot-win' : c.p.won === false ? ' chart-dot-loss' : '';
    return `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4" class="chart-dot${wonCls}"><title>${title}: Ø ${c.p.average.toFixed(1)}</title></circle>`;
  }).join('');

  const gradId = `grad-${Math.random().toString(36).slice(2, 9)}`;

  return `<svg viewBox="0 0 ${width} ${height}" class="chart-svg" preserveAspectRatio="none">
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${areaPath}" fill="url(#${gradId})" stroke="none"/>
    <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    <text x="${padX}" y="12" class="chart-axis-label">Ø ${max.toFixed(0)}</text>
    <text x="${padX}" y="${height - 6}" class="chart-axis-label">${new Date(points[0].date).toLocaleDateString('de-DE')}</text>
    <text x="${width - padX}" y="${height - 6}" text-anchor="end" class="chart-axis-label">${new Date(points[points.length - 1].date).toLocaleDateString('de-DE')}</text>
  </svg>`;
}

/** Simple vertical bar chart for small labelled counts (e.g. Tons/140+/180). */
function buildBarChartSVG(bars, opts = {}) {
  const width = opts.width || 280;
  const height = opts.height || 140;
  const padBottom = 26;
  const padTop = 18;
  const gap = 14;
  const barW = (width - gap * (bars.length + 1)) / bars.length;
  const max = Math.max(...bars.map((b) => b.value), 1);

  const bodyParts = bars.map((b, i) => {
    const x = gap + i * (barW + gap);
    const h = ((height - padTop - padBottom) * b.value) / max;
    const y = height - padBottom - h;
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, 2).toFixed(1)}" rx="4" fill="${b.color || 'var(--accent)'}"/>
      <text x="${(x + barW / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" class="chart-bar-value">${b.value}</text>
      <text x="${(x + barW / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle" class="chart-axis-label">${b.label}</text>
    `;
  }).join('');

  return `<svg viewBox="0 0 ${width} ${height}" class="chart-svg">${bodyParts}</svg>`;
}

/** Radial "percentage complete" ring, used for the checkout rate. */
function buildDonutSVG(percent, opts = {}) {
  const size = opts.size || 120;
  const stroke = opts.stroke || 12;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(100, percent)) / 100 * circumference;
  const color = opts.color || 'var(--green)';

  return `<svg viewBox="0 0 ${size} ${size}" class="chart-svg" width="${size}" height="${size}">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${stroke}"/>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-dasharray="${filled.toFixed(1)} ${circumference.toFixed(1)}" stroke-linecap="round"
      transform="rotate(-90 ${c} ${c})"/>
    <text x="${c}" y="${c + 6}" text-anchor="middle" class="chart-donut-value">${percent.toFixed(0)}%</text>
  </svg>`;
}
