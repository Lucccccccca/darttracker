'use strict';

// Statistics, heat map, archive of finished matches and the start page panels.
// (Classic script: all files in public/js share one global scope; see the script tags in index.html.)

// ---------------------------------------------------------------------------
// Stats view
// ---------------------------------------------------------------------------

let statsSelectedPlayerId = 'all';
let statsMatchesCache = [];
let statsPracticeCache = [];
let statsPeriod = 'all';
let statsMatchLimit = 10;
let h2hA = null;
let h2hB = null;

function inPeriod(ts) {
  if (statsPeriod === 'all') return true;
  return ts >= Date.now() - Number(statsPeriod) * 86400000;
}
const periodMatches = () => statsMatchesCache.filter((m) => inPeriod(m.finishedAt));
const periodPractice = () => statsPracticeCache.filter((s) => inPeriod(s.finishedAt));

function matchTitle(m) {
  if (m.mode && m.mode !== 'x01') return MODE_LABELS[m.mode] || m.mode;
  return `X01 ${m.startScore}${m.handicap ? ' Handicap' : ''}`;
}

function fmtWhen(ts) {
  const d = new Date(ts);
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 0) return `heute, ${time}`;
  if (diffDays === 1) return `gestern, ${time}`;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: diffDays > 300 ? '2-digit' : undefined });
}

function renderStats() {
  socket.emit('get_data_info', (info) => {
    const el = document.getElementById('data-info');
    if (!info) { el.textContent = ''; return; }
    const last = info.backups.length ? info.backups[info.backups.length - 1].replace(/^darttracker-|\.json$/g, '') : null;
    renderBackupExtra(info);
    el.innerHTML = `Automatische Tagessicherung: ${info.backups.length} Datei${info.backups.length === 1 ? '' : 'en'}${last ? `, zuletzt ${escapeHtml(last)}` : ''} · Ordner: <code>${escapeHtml(info.backupDir)}</code> · Jede Sicherung lässt sich über „Sicherung laden“ wieder einspielen.`;
  });
  socket.emit('get_history', (res) => {
    statsMatchesCache = res.matches || [];
    statsPracticeCache = res.practiceSessions || [];
    if (statsSelectedPlayerId !== 'all' && !latestState.players.some((p) => p.id === statsSelectedPlayerId)) statsSelectedPlayerId = 'all';
    statsMatchLimit = 10;
    renderStatsView();
  });
}

/** Second backup folder: every daily backup is copied there as well (USB stick, OneDrive, other disk). */
function renderBackupExtra(info) {
  const el = document.getElementById('backup-extra');
  const dir = info.extraBackupDir;
  const mirror = info.mirror;
  let status = 'Nicht eingerichtet.';
  if (dir) {
    if (!mirror) status = 'Wird bei der nächsten Sicherung kopiert.';
    else status = mirror.ok ? `Zuletzt kopiert: ${fmtWhen(mirror.at)}` : `Fehler: ${escapeHtml(mirror.error || 'unbekannt')}`;
  }
  el.innerHTML = `<div class="backup-extra-row">
    <div>
      <strong>Zweiter Sicherungsordner</strong>
      <div class="hint">Jede Tagessicherung wird zusätzlich dorthin kopiert, zum Beispiel auf einen USB-Stick oder in einen OneDrive-Ordner. So übersteht deine Historie auch einen Festplattenschaden.</div>
      <div class="hint">${dir ? `<code>${escapeHtml(dir)}</code> · ` : ''}${status}</div>
    </div>
    <div class="row" style="gap:8px;">
      <button class="btn" id="btn-backup-dir">${dir ? 'Ordner ändern' : 'Ordner wählen'}</button>
      ${dir ? '<button class="btn btn-ghost" id="btn-backup-dir-clear">Entfernen</button>' : ''}
    </div>
  </div>`;

  const apply = (path) => socket.emit('set_backup_dir', path, (res) => {
    if (!res || !res.ok) { alert((res && res.error) || 'Ordner konnte nicht gesetzt werden.'); return; }
    renderBackupExtra(res.info);
  });
  document.getElementById('btn-backup-dir').addEventListener('click', async () => {
    let chosen = null;
    if (window.darttracker && window.darttracker.chooseFolder) chosen = await window.darttracker.chooseFolder();
    else chosen = prompt('Ordnerpfad für die zweite Sicherung, zum Beispiel E:\\DartTracker', dir || '');
    if (chosen) apply(chosen);
  });
  const clear = document.getElementById('btn-backup-dir-clear');
  if (clear) clear.addEventListener('click', () => apply(''));
}

function renderStatsView() {
  renderStatsPlayerTabs();
  renderStatsForm();
  renderStatsAnalytics();
  renderHeatmap();
  renderStatsTables();
}

/** Where the darts landed: coloured board plus the most-hit fields. */
function renderHeatmap() {
  const card = document.getElementById('heatmap-card');
  const heat = computeHeatmap(statsSelectedPlayerId, periodMatches(), periodPractice());
  card.hidden = heat.total === 0;
  if (!heat.total) return;
  const who = statsSelectedPlayerId === 'all' ? 'alle Spieler' : (playerById(statsSelectedPlayerId).name || '');
  document.getElementById('heatmap-title').textContent = `Trefferbild · ${who}`;
  const boardEl = document.getElementById('heatmap-board');
  boardEl.innerHTML = '';
  boardEl.appendChild(createHeatmapSVG(heat.counts));
  const label = (key) => {
    const [mult, value] = key.split('x').map(Number);
    return value === 25 ? (mult === 2 ? 'Bull' : '25') : `${mult === 3 ? 'T' : mult === 2 ? 'D' : 'S'}${value}`;
  };
  const top = Object.entries(heat.counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const pct = (n) => ((n / (heat.total + heat.misses)) * 100).toFixed(0);
  const sum = (m) => Object.entries(heat.counts).filter(([k]) => k.startsWith(`${m}x`)).reduce((t, [, n]) => t + n, 0);
  document.getElementById('heatmap-list').innerHTML = `
    <div class="heat-facts">
      <span><b>${heat.total + heat.misses}</b> Darts</span>
      <span><b>${pct(sum(3))}%</b> Treble</span>
      <span><b>${pct(sum(2))}%</b> Doppel</span>
      <span><b>${pct(heat.misses)}%</b> daneben</span>
    </div>
    <div class="heat-top-title">Am häufigsten getroffen</div>
    ${top.map(([key, n]) => `<div class="heat-row"><span class="heat-label">${label(key)}</span><span class="heat-bar"><span style="width:${((n / top[0][1]) * 100).toFixed(0)}%"></span></span><span class="heat-n">${n}</span></div>`).join('')}`;
}

function renderStatsPlayerTabs() {
  const wrap = document.getElementById('stats-player-tabs');
  const tabs = [{ id: 'all', name: 'Alle' }, ...latestState.players];
  wrap.innerHTML = tabs.map((p) =>
    `<button data-player="${p.id}" class="${p.id === statsSelectedPlayerId ? 'active' : ''}">${escapeHtml(p.name)}</button>`
  ).join('');
  wrap.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      statsSelectedPlayerId = btn.dataset.player;
      statsMatchLimit = 10;
      renderStatsView();
    });
  });
}

document.querySelectorAll('#stats-period button').forEach((btn) => {
  btn.addEventListener('click', () => {
    statsPeriod = btn.dataset.period;
    document.querySelectorAll('#stats-period button').forEach((b) => b.classList.toggle('active', b === btn));
    statsMatchLimit = 10;
    renderStatsView();
  });
});

document.getElementById('stats-more-matches').addEventListener('click', () => {
  statsMatchLimit += 20;
  renderStatsTables();
});

/** Last five results of the selected player as W / L / D pills (newest first). */
function renderStatsForm() {
  const el = document.getElementById('stats-form');
  if (statsSelectedPlayerId === 'all') { el.innerHTML = ''; return; }
  const mine = periodMatches()
    .filter((m) => m.players.some((p) => p.id === statsSelectedPlayerId))
    .sort((a, b) => b.finishedAt - a.finishedAt)
    .slice(0, 5);
  if (!mine.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<span class="form-label">Form</span>' + mine.map((m) => {
    const res = m.winnerId === statsSelectedPlayerId ? 'W' : m.winnerId ? 'L' : 'D';
    const opp = m.players.filter((p) => p.id !== statsSelectedPlayerId).map((p) => p.name).join(', ');
    return `<span class="form-pill ${res}" title="${escapeHtml(matchTitle(m))} gegen ${escapeHtml(opp)} · ${fmtWhen(m.finishedAt)}">${res === 'W' ? 'S' : res === 'L' ? 'N' : 'U'}</span>`;
  }).join('');
}

function statTile(value, label) {
  return `<div class="stat-tile"><div class="value">${value}</div><div class="label">${label}</div></div>`;
}

function renderLeaderboard() {
  const matches = periodMatches();
  const rows = latestState.players.map((p) => {
    const mine = matches.filter((m) => m.players.some((x) => x.id === p.id));
    const wins = mine.filter((m) => m.winnerId === p.id).length;
    const x01 = computeX01Overview(p.id, matches);
    return {
      id: p.id, name: p.name, played: mine.length, wins,
      rate: mine.length ? (wins / mine.length) * 100 : 0,
      avg: x01.overallAverage, best: x01.bestAverage, max: x01.maximums,
      co: x01.checkoutOpportunities ? x01.checkoutRate : null,
    };
  }).sort((a, b) => b.wins - a.wins || b.rate - a.rate || b.avg - a.avg);

  const el = document.getElementById('stats-leaderboard');
  if (!rows.some((r) => r.played > 0)) {
    el.innerHTML = '<div class="empty-state" style="padding:24px 0;">Noch keine Spiele im gewählten Zeitraum.</div>';
    return;
  }
  el.innerHTML = `<table class="lb-table">
    <thead><tr><th>#</th><th>Spieler</th><th>Spiele</th><th>Siege</th><th>Quote</th><th>Ø X01</th><th>Bester Ø</th><th>180er</th><th>Checkout</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr class="${i === 0 && r.played ? 'leader' : ''}">
      <td><span class="rank rank-${i + 1}">${i + 1}</span></td>
      <td><strong>${escapeHtml(r.name)}</strong></td>
      <td>${r.played}</td>
      <td>${r.wins}</td>
      <td>${r.played ? `<span class="rate-cell"><span class="rate-bar"><span style="width:${r.rate.toFixed(0)}%"></span></span>${r.rate.toFixed(0)}%</span>` : '–'}</td>
      <td>${r.avg ? r.avg.toFixed(1) : '–'}</td>
      <td>${r.best ? r.best.toFixed(1) : '–'}</td>
      <td>${r.max || 0}</td>
      <td>${r.co !== null ? r.co.toFixed(0) + '%' : '–'}</td>
    </tr>`).join('')}</tbody></table>`;
}

function renderHeadToHead() {
  const card = document.getElementById('h2h-card');
  const players = latestState.players;
  card.hidden = players.length < 2;
  if (players.length < 2) return;
  const selA = document.getElementById('h2h-a');
  const selB = document.getElementById('h2h-b');
  if (!h2hA || !players.some((p) => p.id === h2hA)) h2hA = players[0].id;
  if (!h2hB || !players.some((p) => p.id === h2hB) || h2hB === h2hA) h2hB = (players.find((p) => p.id !== h2hA) || players[1]).id;
  const options = players.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  selA.innerHTML = options; selB.innerHTML = options;
  selA.value = h2hA; selB.value = h2hB;

  const a = players.find((p) => p.id === h2hA);
  const b = players.find((p) => p.id === h2hB);
  const ms = periodMatches()
    .filter((m) => m.players.some((x) => x.id === h2hA) && m.players.some((x) => x.id === h2hB))
    .sort((x, y) => y.finishedAt - x.finishedAt);
  const winsA = ms.filter((m) => m.winnerId === h2hA).length;
  const winsB = ms.filter((m) => m.winnerId === h2hB).length;
  const draws = ms.length - winsA - winsB;
  const result = document.getElementById('h2h-result');
  if (!ms.length) {
    result.innerHTML = '<div class="empty-state" style="padding:20px 0;">Diese beiden haben im gewählten Zeitraum noch nicht gegeneinander gespielt.</div>';
    return;
  }
  const avgOf = (id) => {
    const vals = ms.filter((m) => (!m.mode || m.mode === 'x01')).map((m) => (m.players.find((x) => x.id === id) || {}).average).filter((v) => typeof v === 'number' && v > 0);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };
  const avgA = avgOf(h2hA);
  const avgB = avgOf(h2hB);
  const total = winsA + winsB || 1;
  result.innerHTML = `
    <div class="h2h-score">
      <div class="h2h-side ${winsA > winsB ? 'lead' : ''}"><div class="h2h-name">${escapeHtml(a.name)}</div><div class="h2h-num">${winsA}</div></div>
      <div class="h2h-colon">:</div>
      <div class="h2h-side right ${winsB > winsA ? 'lead' : ''}"><div class="h2h-name">${escapeHtml(b.name)}</div><div class="h2h-num">${winsB}</div></div>
    </div>
    <div class="h2h-bar"><span class="a" style="width:${(winsA / total) * 100}%"></span><span class="b" style="width:${(winsB / total) * 100}%"></span></div>
    <div class="h2h-meta">${ms.length} Spiel${ms.length === 1 ? '' : 'e'}${draws ? ` · ${draws} unentschieden` : ''}${avgA && avgB ? ` · Ø in diesen Spielen: ${avgA.toFixed(1)} zu ${avgB.toFixed(1)}` : ''}</div>
    <div class="h2h-recent">${ms.slice(0, 5).map((m) => {
      const w = m.players.find((x) => x.id === m.winnerId);
      return `<div class="recent-item"><span class="mode-pill">${escapeHtml(matchTitle(m))}</span><span class="recent-names">${w ? `Sieger ${escapeHtml(w.name)}` : 'Unentschieden'}</span><span class="recent-date">${fmtWhen(m.finishedAt)}</span></div>`;
    }).join('')}</div>`;
}

document.getElementById('h2h-a').addEventListener('change', (e) => { h2hA = e.target.value; renderHeadToHead(); });
document.getElementById('h2h-b').addEventListener('change', (e) => { h2hB = e.target.value; renderHeadToHead(); });

function renderStatsAnalytics() {
  const emptyEl = document.getElementById('stats-analytics-empty');
  const bodyEl = document.getElementById('stats-analytics-body');
  const allEl = document.getElementById('stats-all');

  if (latestState.players.length === 0) {
    allEl.hidden = true;
    emptyEl.hidden = false;
    bodyEl.hidden = true;
    emptyEl.textContent = 'Noch keine Spieler angelegt.';
    return;
  }

  if (statsSelectedPlayerId === 'all') {
    emptyEl.hidden = true;
    bodyEl.hidden = true;
    allEl.hidden = false;
    renderLeaderboard();
    renderHeadToHead();
    return;
  }
  allEl.hidden = true;

  const matches = periodMatches();
  const sessions = periodPractice();
  const x01 = computeX01Overview(statsSelectedPlayerId, matches);
  const practice = computePracticeOverview(statsSelectedPlayerId, sessions);
  const other = computeOtherModes(statsSelectedPlayerId, matches);
  const classics = computeClassicModes(statsSelectedPlayerId, matches);

  if (x01.matchesPlayed === 0 && practice.sessionsPlayed === 0 && other.cricketPlayed === 0 && other.atcPlayed === 0 && !classics.length) {
    emptyEl.hidden = false;
    bodyEl.hidden = true;
    emptyEl.textContent = statsPeriod === 'all'
      ? 'Noch keine gespeicherten Spiele oder Trainings für diesen Spieler.'
      : 'Im gewählten Zeitraum gibt es für diesen Spieler noch keine Spiele oder Trainings.';
    return;
  }
  emptyEl.hidden = true;
  bodyEl.hidden = false;

  document.getElementById('stats-overview-tiles').innerHTML = [
    statTile(x01.matchesPlayed, 'Spiele gespielt'),
    statTile(x01.matchesPlayed ? x01.winRate.toFixed(0) + '%' : '–', 'Siegquote'),
    statTile(x01.overallAverage ? x01.overallAverage.toFixed(1) : '–', 'Schnitt (X01 gesamt)'),
    statTile(x01.bestAverage ? x01.bestAverage.toFixed(1) : '–', 'Bester Match-Schnitt'),
    statTile(x01.bestCheckout || '–', 'Bestes Checkout'),
    statTile(x01.highestTurn || '–', 'Höchste Aufnahme'),
    statTile(practice.sessionsPlayed, 'Trainingseinheiten'),
    statTile(practice.overallAverage ? practice.overallAverage.toFixed(1) : '–', 'Schnitt (Training)'),
    ...(other.cricketPlayed ? [statTile(`${other.cricketWon}/${other.cricketPlayed}`, 'Cricket Siege'), statTile(other.bestMpr ? other.bestMpr.toFixed(2) : '–', 'Bester MPR (Cricket)')] : []),
    ...(other.atcPlayed ? [statTile(`${other.atcWon}/${other.atcPlayed}`, 'Rund um die Uhr Siege'), statTile(other.bestClockDarts !== null ? other.bestClockDarts : '–', 'Bestes Rund um die Uhr (Darts)')] : []),
    ...classics.flatMap((c) => [statTile(`${c.won}/${c.played}`, `${escapeHtml(c.label)} Siege`), statTile(c.best !== null ? c.best : '–', escapeHtml(c.bestLabel))]),
  ].join('');

  document.getElementById('chart-x01-trend').innerHTML = buildLineChartSVG(x01.trend, { color: 'var(--accent)' });
  document.getElementById('chart-practice-trend').innerHTML = buildLineChartSVG(practice.trend, { color: 'var(--green)' });
  document.getElementById('chart-scoring-bars').innerHTML = buildBarChartSVG([
    { label: '100+', value: x01.tons, color: '#fbbf24' },
    { label: '140+', value: x01.oneForties, color: '#fb923c' },
    { label: '180', value: x01.maximums, color: '#ff4d4d' },
  ]);
  document.getElementById('chart-checkout-donut').innerHTML = buildDonutSVG(x01.checkoutRate, { color: 'var(--green)' });
  document.getElementById('chart-checkout-legend').innerHTML =
    `<strong>${x01.checkoutsHit} / ${x01.checkoutOpportunities}</strong>Checkouts verwandelt`;
}

function renderStatsTables() {
  const forPlayer = (list, get) => (statsSelectedPlayerId === 'all' ? list : list.filter((x) => get(x)));
  const matches = forPlayer(periodMatches(), (m) => m.players.some((p) => p.id === statsSelectedPlayerId))
    .slice().sort((a, b) => b.finishedAt - a.finishedAt);

  const matchesBody = document.getElementById('stats-matches-body');
  const shown = matches.slice(0, statsMatchLimit);
  matchesBody.innerHTML = shown.length ? shown.map((m) => {
    const winner = m.players.find((p) => p.id === m.winnerId);
    return `<tr class="match-row" data-match="${m.id}">
      <td>${new Date(m.finishedAt).toLocaleString('de-DE')}</td>
      <td>${escapeHtml(matchTitle(m))}</td>
      <td>${m.players.map((p) => escapeHtml(p.name)).join(' vs ')}</td>
      <td>${winner ? escapeHtml(winner.name) : '–'}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="4" class="empty-state">Keine Spiele für diese Auswahl</td></tr>';

  const more = document.getElementById('stats-more-matches');
  more.hidden = matches.length <= statsMatchLimit;
  more.textContent = `Mehr anzeigen (${matches.length - statsMatchLimit} weitere)`;

  matchesBody.querySelectorAll('.match-row').forEach((row) => {
    row.addEventListener('click', () => toggleMatchDetail(row, statsMatchesCache.find((m) => m.id === row.dataset.match)));
  });

  const sessions = forPlayer(periodPractice(), (s) => s.player.id === statsSelectedPlayerId)
    .slice().sort((a, b) => b.finishedAt - a.finishedAt).slice(0, 15);
  document.getElementById('stats-practice-body').innerHTML = sessions.length ? sessions.map((s) => `
    <tr>
      <td>${new Date(s.finishedAt).toLocaleString('de-DE')}</td>
      <td>${escapeHtml(s.player.name)}</td>
      <td>${s.rounds}</td>
      <td>${s.totalPoints}</td>
      <td>${s.average.toFixed(1)}</td>
    </tr>
  `).join('') : '<tr><td colspan="5" class="empty-state">Noch keine Trainingseinheiten</td></tr>';
}

// ---------------------------------------------------------------------------
// Home: recent games + leaderboard
// ---------------------------------------------------------------------------

let homeHistory = null;
let homePanelsSignature = null;

function refreshHome() {
  socket.emit('get_history', (res) => {
    homeHistory = res;
    renderHomePanels();
  });
}

function renderHomePanels() {
  const players = latestState.players;
  const onboard = document.getElementById('home-onboard');
  const panels = document.getElementById('home-panels');
  onboard.hidden = players.length > 0;
  panels.hidden = players.length === 0;
  if (!players.length) return;

  const matches = homeHistory ? homeHistory.matches : [];
  const recent = matches.slice().sort((a, b) => b.finishedAt - a.finishedAt).slice(0, 5);
  const recentHtml = recent.length ? recent.map((m) => {
    const w = m.players.find((p) => p.id === m.winnerId);
    return `<div class="recent-item">
      <span class="mode-pill">${escapeHtml(matchTitle(m))}</span>
      <span class="recent-names">${m.players.map((p) => `<span class="${p.id === m.winnerId ? 'won' : ''}">${escapeHtml(p.name)}</span>`).join(' <i>vs</i> ')}</span>
      <span class="recent-date">${w ? '' : 'Unentschieden · '}${fmtWhen(m.finishedAt)}</span>
    </div>`;
  }).join('') : '<div class="empty-state" style="padding:22px 0;">Noch keine Spiele gespeichert.</div>';

  const board = players.map((p) => {
    const mine = matches.filter((m) => m.players.some((x) => x.id === p.id));
    const wins = mine.filter((m) => m.winnerId === p.id).length;
    return { name: p.name, played: mine.length, wins, rate: mine.length ? (wins / mine.length) * 100 : 0 };
  }).sort((a, b) => b.wins - a.wins || b.rate - a.rate).slice(0, 5);
  const leadersHtml = board.map((r, i) => `<div class="leader-item">
      <span class="rank rank-${i + 1}">${i + 1}</span>
      <span class="leader-name">${escapeHtml(r.name)}</span>
      <span class="leader-bar"><span style="width:${r.rate.toFixed(0)}%"></span></span>
      <span class="leader-wins">${r.wins}<small>/${r.played}</small></span>
    </div>`).join('');

  const signature = recentHtml + leadersHtml;
  if (signature === homePanelsSignature) return;
  homePanelsSignature = signature;
  document.getElementById('home-recent').innerHTML = recentHtml;
  document.getElementById('home-leaders').innerHTML = leadersHtml;
}

function toggleMatchDetail(row, match) {
  const existing = row.nextElementSibling;
  document.querySelectorAll('.match-detail-row').forEach((el) => el.remove());
  if (existing && existing.classList.contains('match-detail-row')) return;
  if (!match) return;
  const tr = document.createElement('tr');
  tr.className = 'match-detail-row';
  const td = document.createElement('td');
  td.colSpan = 4;
  td.innerHTML = `<div class="match-detail-inner">${renderMatchDetail(match)}</div>`;
  tr.appendChild(td);
  row.after(tr);
}

/** One line per player for a finished match in the archive. */
function matchDetailPlayerLine(match, p) {
  if (match.mode === 'cricket') return `${p.score} Punkte · ${p.closed}/7 geschlossen · ${p.marksTotal} Marks · MPR ${(p.mpr || 0).toFixed(2)}`;
  if (match.mode === 'atc') return `${p.reached}/21 getroffen · ${p.dartsThrownTotal} Darts${p.finished ? ' · fertig' : ''}`;
  if (match.mode === 'killer') return `Nr. ${p.number} · ${p.kills} Treffer · ${p.out ? 'raus' : `${p.lives} Leben`} · ${p.dartsThrownTotal} Darts`;
  return `${p.score} ${match.unit || 'Punkte'}${p.out ? ' · raus' : ''} · ${p.rounds} Runden · ${p.dartsThrownTotal} Darts`;
}

/** The full visit-by-visit history of a saved match, same look as during the game. */
function matchDetailFeed(match) {
  const g = recordToFeedGame(match);
  if (!g.players.some((p) => p.turnLog.length)) return '';
  return `<div>
    <strong style="font-size:0.85rem; color:var(--text-dim)">Verlauf</strong>
    <div class="turn-summary archive-summary" style="margin-top:8px;">${feedSummaryHtml(g)}</div>
    <div class="turn-log archive-feed">${buildFeedHtml(g, { limit: 200 })}</div>
  </div>`;
}

function renderMatchDetail(match) {
  if (match.mode && match.mode !== 'x01') {
    const lines = match.players.map((p) => `
      <div class="leg-history-item">
        <span>${escapeHtml(p.name)}${p.id === match.winnerId ? ' · Sieger' : ''}</span>
        <span>${escapeHtml(matchDetailPlayerLine(match, p))}</span>
      </div>`).join('');
    return `<div class="stack"><div>
      <strong style="font-size:0.85rem; color:var(--text-dim)">${escapeHtml(MODE_LABELS[match.mode] || match.mode)}${match.endedEarly ? ' · vorzeitig beendet' : ''}</strong>
      <div class="leg-history-list" style="margin-top:6px;">${lines}</div></div>${matchDetailFeed(match)}</div>`;
  }
  const legLines = (match.legHistory || []).map((l) => {
    const winner = match.players.find((p) => p.id === l.winnerId);
    return `<div class="leg-history-item"><span>Leg ${l.leg}${match.setsToWin > 1 ? ` · Set ${l.set}` : ''} — ${winner ? escapeHtml(winner.name) : '?'}</span><span>Checkout ${l.checkoutScore} (${l.checkoutDartCount} ${l.checkoutDartCount === 1 ? 'Dart' : 'Darts'})</span></div>`;
  }).join('') || '<div class="empty-state">Keine Leg-Details gespeichert</div>';

  const statsLines = match.players.map((p) => `
    <div class="leg-history-item">
      <span>${escapeHtml(p.name)}${match.handicap && p.startScore ? ` · Start ${p.startScore}` : ''}</span>
      <span>Ø ${p.average.toFixed(1)} · ${p.tons || 0}×100+ · ${p.oneForties || 0}×140+ · ${p.maximums || 0}×180 · ${p.checkoutsHit}/${p.checkoutOpportunities || 0} Checkouts</span>
    </div>
  `).join('');

  return `<div class="stack">
    <div><strong style="font-size:0.85rem; color:var(--text-dim)">Leg-Verlauf</strong><div class="leg-history-list" style="margin-top:6px;">${legLines}</div></div>
    <div><strong style="font-size:0.85rem; color:var(--text-dim)">Spieler-Stats</strong><div class="leg-history-list" style="margin-top:6px;">${statsLines}</div></div>
    ${matchDetailFeed(match)}
  </div>`;
}
