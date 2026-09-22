'use strict';

const socket = io();

let latestState = { players: [], playerStats: [], game: null, serverInfo: {} };
let previousGameId; // undefined until first state arrives (init sentinel)
let currentView = 'home';

// ---- Local UI-only state ----
let setupSelectedPlayerIds = [];
let setupStartScoreValue = 501;
let setupLegsValue = 3;
let setupSetsValue = 1;
let practiceSelectedPlayerId = null;
let gameMultiplier = 1;
let practiceMultiplier = 1;

// ---------------------------------------------------------------------------
// View management
// ---------------------------------------------------------------------------

function showView(name) {
  currentView = name;
  document.querySelectorAll('main.view').forEach((el) => {
    const show = el.id === `view-${name}`;
    if (show && el.hidden) {
      el.classList.remove('view-enter');
      void el.offsetWidth;
      el.classList.add('view-enter');
    }
    el.hidden = !show;
  });
  if (name !== 'game' && document.body.classList.contains('tv-mode')) exitTvMode();
  document.getElementById('btn-home').hidden = name === 'home';
  if (name !== 'game') {
    document.getElementById('overlay-leg').hidden = true;
    document.getElementById('overlay-match-finished').hidden = true;
    lastLegOverlayKey = null;
    lastMatchOverlayShown = false;
  }
  if (name === 'setup') renderSetup();
  if (name === 'practice-setup') renderPracticeSetup();
  if (name === 'players') renderPlayers();
  if (name === 'stats') renderStats();
  if (name === 'game') renderGame();
  if (name === 'practice') renderPracticeGame();
}

document.getElementById('btn-home').addEventListener('click', () => showView('home'));
document.getElementById('btn-new-match').addEventListener('click', () => { setupSelectedPlayerIds = []; showView('setup'); });
document.getElementById('btn-new-practice').addEventListener('click', () => { practiceSelectedPlayerId = null; showView('practice-setup'); });
document.getElementById('btn-players').addEventListener('click', () => showView('players'));
document.getElementById('btn-stats').addEventListener('click', () => showView('stats'));
document.querySelectorAll('[data-back]').forEach((btn) => btn.addEventListener('click', () => showView('home')));

document.getElementById('btn-resume').addEventListener('click', () => {
  if (!latestState.game) return;
  showView(latestState.game.mode === 'practice' ? 'practice' : 'game');
});

// ---------------------------------------------------------------------------
// Socket state sync
// ---------------------------------------------------------------------------

socket.on('state', (data) => {
  latestState = data;
  const newGameId = data.game ? data.game.id : null;

  if (previousGameId !== undefined) {
    if (newGameId && newGameId !== previousGameId) {
      showView(data.game.mode === 'practice' ? 'practice' : 'game');
    } else if (!newGameId && (currentView === 'game' || currentView === 'practice')) {
      showView('home');
    }
  }
  previousGameId = newGameId;

  renderCurrentView();
});

function renderCurrentView() {
  renderHome();
  if (currentView === 'setup') renderSetupPlayerSelection();
  if (currentView === 'practice-setup') renderPracticePlayerSelection();
  if (currentView === 'game') renderGame();
  if (currentView === 'practice') renderPracticeGame();
  if (currentView === 'players') renderPlayers();
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

function renderHome() {
  const banner = document.getElementById('resume-banner');
  const g = latestState.game;
  if (!g) { banner.hidden = true; return; }
  banner.hidden = false;
  if (g.mode === 'x01') {
    const names = g.players.map((p) => p.name).join(' vs ');
    document.getElementById('resume-text').textContent = `Spiel läuft: ${names} — Leg ${g.legNumber}`;
  } else {
    document.getElementById('resume-text').textContent = `Training läuft: ${g.player.name}`;
  }
}

// ---------------------------------------------------------------------------
// Setup (X01)
// ---------------------------------------------------------------------------

function renderSetup() {
  setupLegsValue = 3;
  setupSetsValue = 1;
  document.getElementById('setup-legs-value').textContent = setupLegsValue;
  document.getElementById('setup-sets-value').textContent = setupSetsValue;
  document.getElementById('setup-double-out').checked = true;
  document.getElementById('setup-double-in').checked = false;
  renderSetupPlayerSelection();
}

function setupStepper(wrapId, valueId, initial, onChange) {
  const wrap = document.getElementById(wrapId);
  const valueEl = document.getElementById(valueId);
  let value = initial;
  wrap.querySelectorAll('.stepper-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      value = Math.max(1, value + Number(btn.dataset.step));
      valueEl.textContent = value;
      onChange(value);
    });
  });
}

setupStepper('setup-legs-stepper', 'setup-legs-value', setupLegsValue, (v) => { setupLegsValue = v; });
setupStepper('setup-sets-stepper', 'setup-sets-value', setupSetsValue, (v) => { setupSetsValue = v; });

function renderSetupPlayerSelection() {
  const list = document.getElementById('setup-player-list');
  list.innerHTML = '';
  latestState.players.forEach((p) => {
    const idx = setupSelectedPlayerIds.indexOf(p.id);
    const chip = document.createElement('button');
    chip.className = 'chip' + (idx >= 0 ? ' selected' : '');
    chip.innerHTML = (idx >= 0 ? `<span class="order-badge">${idx + 1}</span>` : '') + escapeHtml(p.name);
    chip.addEventListener('click', () => {
      const existing = setupSelectedPlayerIds.indexOf(p.id);
      if (existing >= 0) setupSelectedPlayerIds.splice(existing, 1);
      else setupSelectedPlayerIds.push(p.id);
      renderSetupPlayerSelection();
    });
    list.appendChild(chip);
  });
}

document.getElementById('setup-add-player').addEventListener('click', () => {
  const input = document.getElementById('setup-new-player-name');
  const name = input.value.trim();
  if (!name) return;
  socket.emit('add_player', { name }, (res) => {
    if (res && res.ok) {
      setupSelectedPlayerIds.push(res.player.id);
      input.value = '';
      renderSetupPlayerSelection();
    }
  });
});

document.querySelectorAll('#setup-start-score button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#setup-start-score button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const customInput = document.getElementById('setup-custom-score');
    if (btn.dataset.value === 'custom') {
      customInput.hidden = false;
      setupStartScoreValue = Number(customInput.value) || 501;
    } else {
      customInput.hidden = true;
      setupStartScoreValue = Number(btn.dataset.value);
    }
  });
});
document.getElementById('setup-custom-score').addEventListener('input', (e) => {
  setupStartScoreValue = Number(e.target.value) || 0;
});

document.getElementById('setup-start-btn').addEventListener('click', () => {
  if (setupSelectedPlayerIds.length === 0) {
    alert('Bitte mindestens einen Spieler auswählen.');
    return;
  }
  socket.emit('start_match', {
    playerIds: setupSelectedPlayerIds,
    startScore: setupStartScoreValue || 501,
    legsToWin: setupLegsValue || 1,
    setsToWin: setupSetsValue || 1,
    doubleOut: document.getElementById('setup-double-out').checked,
    doubleIn: document.getElementById('setup-double-in').checked,
  });
});

// ---------------------------------------------------------------------------
// Setup (Practice)
// ---------------------------------------------------------------------------

function renderPracticeSetup() {
  renderPracticePlayerSelection();
}

function renderPracticePlayerSelection() {
  const list = document.getElementById('practice-player-list');
  list.innerHTML = '';
  latestState.players.forEach((p) => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (practiceSelectedPlayerId === p.id ? ' selected' : '');
    chip.textContent = p.name;
    chip.addEventListener('click', () => {
      practiceSelectedPlayerId = p.id;
      renderPracticePlayerSelection();
    });
    list.appendChild(chip);
  });
}

document.getElementById('practice-add-player').addEventListener('click', () => {
  const input = document.getElementById('practice-new-player-name');
  const name = input.value.trim();
  if (!name) return;
  socket.emit('add_player', { name }, (res) => {
    if (res && res.ok) {
      practiceSelectedPlayerId = res.player.id;
      input.value = '';
      renderPracticePlayerSelection();
    }
  });
});

document.getElementById('practice-start-btn').addEventListener('click', () => {
  if (!practiceSelectedPlayerId) {
    alert('Bitte einen Spieler auswählen.');
    return;
  }
  socket.emit('start_practice', { playerId: practiceSelectedPlayerId });
});

// ---------------------------------------------------------------------------
// Numpad builders
// ---------------------------------------------------------------------------

function buildNumpad(container, onThrow) {
  container.innerHTML = '';
  for (let n = 1; n <= 20; n++) {
    const btn = document.createElement('button');
    btn.textContent = n;
    btn.addEventListener('click', () => onThrow(n));
    container.appendChild(btn);
  }
}

buildNumpad(document.getElementById('numpad-grid'), (n) => {
  socket.emit('throw', { value: n, multiplier: gameMultiplier });
});
buildNumpad(document.getElementById('practice-numpad-grid'), (n) => {
  socket.emit('throw', { value: n, multiplier: practiceMultiplier });
});

// ---- Dartboard input mode (numpad <-> visual board), remembered per device ----

function setupInputModeToggle(toggleId, numpadId, boardId, storageKey) {
  const toggle = document.getElementById(toggleId);
  const numpadEl = document.getElementById(numpadId);
  const boardWrapEl = document.getElementById(boardId);
  let boardBuilt = false;

  function applyMode(mode) {
    toggle.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    numpadEl.hidden = mode !== 'numpad';
    boardWrapEl.hidden = mode !== 'board';
    if (mode === 'board' && !boardBuilt) {
      boardWrapEl.appendChild(createDartboardSVG((value, multiplier) => socket.emit('throw', { value, multiplier })));
      boardBuilt = true;
    }
    try { localStorage.setItem(storageKey, mode); } catch (e) { /* ignore */ }
  }

  toggle.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => applyMode(btn.dataset.mode));
  });

  let initial = 'numpad';
  try { initial = localStorage.getItem(storageKey) || 'numpad'; } catch (e) { /* ignore */ }
  applyMode(initial);
}

setupInputModeToggle('game-input-mode', 'game-input-numpad', 'game-input-board', 'darttracker-input-mode-game');
setupInputModeToggle('practice-input-mode', 'practice-input-numpad', 'practice-input-board', 'darttracker-input-mode-practice');

document.querySelectorAll('#view-game .multiplier-row button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#view-game .multiplier-row button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    gameMultiplier = Number(btn.dataset.mult);
  });
});
document.querySelectorAll('#view-practice .multiplier-row button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#view-practice .multiplier-row button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    practiceMultiplier = Number(btn.dataset.mult);
  });
});

document.getElementById('btn-bull25').addEventListener('click', () => socket.emit('throw', { value: 25, multiplier: 1 }));
document.getElementById('btn-bull50').addEventListener('click', () => socket.emit('throw', { value: 25, multiplier: 2 }));
document.getElementById('btn-miss').addEventListener('click', () => socket.emit('throw', { value: 0, multiplier: 1 }));
document.getElementById('btn-undo').addEventListener('click', () => socket.emit('undo_throw'));
document.getElementById('btn-abort-game').addEventListener('click', () => {
  if (confirm('Spiel wirklich abbrechen? Der Fortschritt geht verloren.')) socket.emit('abort_game');
});

document.getElementById('practice-bull25').addEventListener('click', () => socket.emit('throw', { value: 25, multiplier: 1 }));
document.getElementById('practice-bull50').addEventListener('click', () => socket.emit('throw', { value: 25, multiplier: 2 }));
document.getElementById('practice-miss').addEventListener('click', () => socket.emit('throw', { value: 0, multiplier: 1 }));
document.getElementById('practice-undo').addEventListener('click', () => socket.emit('undo_throw'));
document.getElementById('btn-finish-practice').addEventListener('click', () => socket.emit('finish_game'));

// ---------------------------------------------------------------------------
// Game (X01) rendering
// ---------------------------------------------------------------------------

// Snapshot of the last rendered game, so a re-render knows what actually changed and can
// animate only that (the scoreboard is rebuilt from scratch on every state update).
let prevGameSnapshot = null;

function snapshotGame(g) {
  return {
    id: g.id,
    status: g.status,
    activePlayerIndex: g.activePlayerIndex,
    legNumber: g.legNumber,
    players: g.players.map((p) => ({
      score: p.currentScore,
      darts: p.turnDarts.length,
      turns: p.turnLog.length,
      lastTurn: p.turnLog[p.turnLog.length - 1] || null,
    })),
  };
}

function renderGame() {
  const g = latestState.game;
  if (!g || g.mode !== 'x01') return;

  const prev = prevGameSnapshot && prevGameSnapshot.id === g.id ? prevGameSnapshot : null;
  const sameLeg = prev && prev.legNumber === g.legNumber;

  document.getElementById('game-meta-leg').textContent =
    `Leg ${g.legNumber}${g.setsToWin > 1 ? ` · Set ${g.setNumber}` : ''}`;
  document.getElementById('game-meta-sub').textContent =
    `${g.startScore} · ${g.doubleOut ? 'Doppel-Out' : 'Einfach-Out'}${g.doubleIn ? ' · Doppel-In' : ''}`;

  const board = document.getElementById('scoreboard');
  board.innerHTML = '';
  g.players.forEach((p, idx) => {
    const isActive = idx === g.activePlayerIndex;
    const pp = prev ? prev.players[idx] : null;
    const scoreChanged = !!pp && sameLeg && pp.score !== p.currentScore;
    const dartAdded = !!pp && p.turnDarts.length > pp.darts;
    const newTurn = !!pp && p.turnLog.length > pp.turns ? p.turnLog[p.turnLog.length - 1] : null;
    const busted = !!newTurn && newTurn.bust;
    const becameActive = !!prev && isActive && prev.activePlayerIndex !== idx;
    const scored180 = !!newTurn && !newTurn.bust && !newTurn.checkout && newTurn.scoreBefore - newTurn.scoreAfter === 180;

    const card = document.createElement('div');
    card.className = 'player-card' + (isActive ? ' active' : '') + (busted ? ' bust-shake' : '') + (becameActive ? ' active-in' : '');

    const legDots = Array.from({ length: g.legsToWin }, (_, i) => i < p.legsWon ? '●' : '○').join(' ');

    card.innerHTML = `
      ${isActive ? '<span class="active-badge">AM WURF</span>' : ''}
      <div class="name-row">
        <span class="name">${escapeHtml(p.name)}</span>
        <span class="avg">Ø ${p.average.toFixed(1)}</span>
      </div>
      <div class="score${scoreChanged ? ' score-pop' : ''}">${p.currentScore}</div>
      <div class="legs-sets">
        <span class="badge">Legs ${legDots}</span>
        ${g.setsToWin > 1 ? `<span class="badge">Sets ${p.setsWon}/${g.setsToWin}</span>` : ''}
      </div>
      <div class="dart-slots">${renderDartSlots(p.turnDarts, dartAdded)}</div>
      <div class="checkout-suggestion">${isActive ? formatCheckout(p.checkoutSuggestion) : ''}</div>
    `;
    board.appendChild(card);

    if (scored180) showBigFlash('180!', 'gold');
    else if (busted) showBigFlash('Bust', 'red');
  });

  const log = document.getElementById('turn-log');
  log.innerHTML = g.players.map((p, idx) => {
    const pp = prev ? prev.players[idx] : null;
    const entries = p.turnLog.slice(-6).reverse().map((t, i) => {
      const cls = t.bust ? 'bust' : t.checkout ? 'checkout' : '';
      const isNew = i === 0 && !!pp && p.turnLog.length > pp.turns;
      const dartsStr = t.darts.map((d) => d.label).join(' ');
      const resultStr = t.bust ? 'BUST' : t.checkout ? `CHECKOUT ${t.scoreBefore}` : `${t.scoreBefore} → ${t.scoreAfter}`;
      return `<div class="turn-log-entry ${cls}${isNew ? ' new-entry' : ''}">
        <div><span class="who">${escapeHtml(p.name)}</span><div class="darts">${dartsStr}</div></div>
        <div class="result">${resultStr}</div>
      </div>`;
    }).join('');
    return entries;
  }).join('') || '<div class="empty-state">Noch keine Würfe</div>';

  handleLegAndMatchOverlays(g, prev);
  prevGameSnapshot = snapshotGame(g);
}

function renderDartSlots(darts, animateLast = false) {
  let html = '';
  for (let i = 0; i < 3; i++) {
    const d = darts[i];
    if (!d) { html += '<div class="dart-slot"></div>'; continue; }
    const isLast = i === darts.length - 1;
    html += `<div class="dart-slot filled${d.bust ? ' bust' : ''}${animateLast && isLast ? ' dart-in' : ''}">${d.label}</div>`;
  }
  return html;
}

function showBigFlash(text, colorClass) {
  const el = document.createElement('div');
  el.className = `big-flash ${colorClass}`;
  el.textContent = text;
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
  // Fallback: with reduced-motion (no animation → no animationend) or a hidden tab the flash
  // would otherwise stay on screen forever.
  setTimeout(() => el.remove(), 1800);
}

function launchConfetti(container) {
  const colors = ['#ff4136', '#ffb020', '#2fae6b', '#f5f3ef', '#ff8a3d'];
  const wrap = document.createElement('div');
  wrap.className = 'confetti';
  for (let i = 0; i < 70; i++) {
    const s = document.createElement('span');
    s.style.left = `${50 + (Math.random() * 40 - 20)}%`;
    s.style.background = colors[i % colors.length];
    s.style.setProperty('--dx', `${Math.random() * 600 - 300}px`);
    s.style.setProperty('--rot', `${Math.random() * 1080 - 540}deg`);
    s.style.setProperty('--dur', `${1.6 + Math.random() * 1.4}s`);
    s.style.setProperty('--delay', `${Math.random() * 0.4}s`);
    wrap.appendChild(s);
  }
  container.appendChild(wrap);
  setTimeout(() => wrap.remove(), 3600);
}

function formatCheckout(suggestion) {
  if (!suggestion || !suggestion.possible) return '';
  return `<span class="co-label">CHECKOUT</span><span class="co-value">${suggestion.route.map((r) => r.label).join(' · ')}</span>`;
}

let lastLegOverlayKey = null;
let lastMatchOverlayShown = false;

function handleLegAndMatchOverlays(g, prev) {
  const legOverlay = document.getElementById('overlay-leg');
  const matchOverlay = document.getElementById('overlay-match-finished');
  const justHappened = !!prev && prev.status === 'in_progress';

  if (g.status === 'leg_finished' || g.status === 'set_finished') {
    const key = `${g.legNumber}-${g.setNumber}-${g.status}`;
    if (lastLegOverlayKey !== key) {
      lastLegOverlayKey = key;
      if (justHappened) {
        showBigFlash(g.status === 'set_finished' ? 'Set!' : 'Checkout!', 'gold');
        setTimeout(() => launchConfetti(legOverlay), 250);
      }
      const summary = g.lastLegSummary;
      const icon = g.status === 'set_finished'
        ? '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--gold)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v4a5 5 0 0 1-10 0V4Z"/><path d="M7 5H4a3 3 0 0 0 3 5"/><path d="M17 5h3a3 3 0 0 1-3 5"/><path d="M12 13v3"/><path d="M9 20h6"/><path d="M10 17h4l.6 3H9.4l.6-3Z"/></svg>'
        : '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--green)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>';
      document.getElementById('leg-overlay-title').innerHTML =
        icon + (g.status === 'set_finished' ? ' Set gewonnen: ' : ' Leg gewonnen: ') + escapeHtml(summary ? summary.winnerName : '');
      document.getElementById('leg-overlay-checkout').textContent = summary ? `Checkout ${summary.checkoutScore}` : '';
      document.getElementById('leg-overlay-sub').textContent = summary ? summary.checkoutDarts.map((d) => d.label).join(' · ') : '';
    }
    legOverlay.hidden = false;
  } else {
    legOverlay.hidden = true;
    lastLegOverlayKey = null;
  }

  if (g.status === 'finished') {
    matchOverlay.hidden = false;
    if (!lastMatchOverlayShown) {
      lastMatchOverlayShown = true;
      if (justHappened) {
        showBigFlash('Game Shot!', 'gold');
        setTimeout(() => launchConfetti(matchOverlay), 250);
      }
      const winner = g.players.find((p) => p.id === g.winnerId);
      document.getElementById('match-winner-name').textContent = winner ? winner.name : '';
      document.getElementById('match-summary').innerHTML = g.players.map((p) =>
        `${escapeHtml(p.name)}: ${p.legsWon} Legs${g.setsToWin > 1 ? `, ${p.setsWon} Sets` : ''} · Ø ${p.average.toFixed(1)} · Highscore ${p.highestTurn}${p.highestCheckout ? ` · Bestes Checkout ${p.highestCheckout}` : ''}`
      ).join('<br/>');
    }
  } else {
    matchOverlay.hidden = true;
    lastMatchOverlayShown = false;
  }
}

document.getElementById('leg-overlay-continue').addEventListener('click', () => socket.emit('continue_after_leg'));
document.getElementById('match-finished-close').addEventListener('click', () => socket.emit('finish_game'));

// ---------------------------------------------------------------------------
// Practice rendering
// ---------------------------------------------------------------------------

function renderPracticeGame() {
  const g = latestState.game;
  if (!g || g.mode !== 'practice') return;

  document.getElementById('practice-meta').textContent = `Training gestartet ${new Date(g.startedAt).toLocaleTimeString('de-DE')}`;
  document.getElementById('practice-player-name').textContent = g.player.name;
  document.getElementById('practice-total').textContent = g.totalPoints;
  document.getElementById('practice-avg').textContent = g.average.toFixed(1);
  document.getElementById('practice-dart-slots').innerHTML = renderDartSlots(g.turnDarts);

  const roundsLog = document.getElementById('practice-rounds-log');
  roundsLog.innerHTML = g.rounds.slice().reverse().map((r, i) => {
    const roundNum = g.rounds.length - i;
    return `<div class="turn-log-entry"><span>Runde ${roundNum}: ${r.darts.map((d) => d.label).join(' ')}</span><span>${r.total} Punkte</span></div>`;
  }).join('') || '<div class="empty-state">Noch keine Runden</div>';
}

// ---------------------------------------------------------------------------
// Players view
// ---------------------------------------------------------------------------

function renderPlayers() {
  const body = document.getElementById('players-table-body');
  if (latestState.playerStats.length === 0) {
    body.innerHTML = '<tr><td colspan="8" class="empty-state">Noch keine Spieler angelegt</td></tr>';
    return;
  }
  body.innerHTML = latestState.playerStats.map((s) => `
    <tr>
      <td>${escapeHtml(s.name)}</td>
      <td>${s.matchesPlayed}</td>
      <td>${s.matchesWon}</td>
      <td>${s.overallAverage ? s.overallAverage.toFixed(1) : '–'}</td>
      <td>${s.bestAverage ? s.bestAverage.toFixed(1) : '–'}</td>
      <td>${s.bestCheckout || '–'}</td>
      <td>${s.checkoutOpportunities ? s.checkoutRate.toFixed(0) + '%' : '–'}</td>
      <td>${s.maximums || 0}</td>
      <td><button class="btn btn-danger" data-delete="${s.id}">Löschen</button></td>
    </tr>
  `).join('');
  body.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (confirm('Spieler wirklich löschen? (Historie bleibt erhalten)')) {
        socket.emit('delete_player', { id: btn.dataset.delete });
      }
    });
  });
}

document.getElementById('players-add-btn').addEventListener('click', () => {
  const input = document.getElementById('players-new-name');
  const name = input.value.trim();
  if (!name) return;
  socket.emit('add_player', { name }, (res) => {
    if (res && res.ok) input.value = '';
  });
});

// ---------------------------------------------------------------------------
// Stats view
// ---------------------------------------------------------------------------

let statsSelectedPlayerId = null;
let statsMatchesCache = [];
let statsPracticeCache = [];

function renderStats() {
  socket.emit('get_history', (res) => {
    statsMatchesCache = res.matches || [];
    statsPracticeCache = res.practiceSessions || [];
    if (!statsSelectedPlayerId || !latestState.players.some((p) => p.id === statsSelectedPlayerId)) {
      statsSelectedPlayerId = latestState.players[0] ? latestState.players[0].id : null;
    }
    renderStatsPlayerTabs();
    renderStatsAnalytics();
    renderStatsTables();
  });
}

function renderStatsPlayerTabs() {
  const wrap = document.getElementById('stats-player-tabs');
  wrap.innerHTML = latestState.players.map((p) =>
    `<button data-player="${p.id}" class="${p.id === statsSelectedPlayerId ? 'active' : ''}">${escapeHtml(p.name)}</button>`
  ).join('');
  wrap.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      statsSelectedPlayerId = btn.dataset.player;
      renderStatsPlayerTabs();
      renderStatsAnalytics();
    });
  });
}

function statTile(value, label) {
  return `<div class="stat-tile"><div class="value">${value}</div><div class="label">${label}</div></div>`;
}

function renderStatsAnalytics() {
  const emptyEl = document.getElementById('stats-analytics-empty');
  const bodyEl = document.getElementById('stats-analytics-body');

  if (!statsSelectedPlayerId) {
    emptyEl.hidden = false;
    bodyEl.hidden = true;
    emptyEl.textContent = 'Noch keine Spieler angelegt.';
    return;
  }

  const x01 = computeX01Overview(statsSelectedPlayerId, statsMatchesCache);
  const practice = computePracticeOverview(statsSelectedPlayerId, statsPracticeCache);

  if (x01.matchesPlayed === 0 && practice.sessionsPlayed === 0) {
    emptyEl.hidden = false;
    bodyEl.hidden = true;
    emptyEl.textContent = 'Noch keine gespeicherten Spiele oder Trainings für diesen Spieler.';
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
  const matchesBody = document.getElementById('stats-matches-body');
  const matches = statsMatchesCache.slice().reverse();
  matchesBody.innerHTML = matches.length ? matches.map((m) => {
    const winner = m.players.find((p) => p.id === m.winnerId);
    return `<tr class="match-row" data-match="${m.id}">
      <td>${new Date(m.finishedAt).toLocaleString('de-DE')}</td>
      <td>${m.startScore}</td>
      <td>${m.players.map((p) => escapeHtml(p.name)).join(' vs ')}</td>
      <td>${winner ? escapeHtml(winner.name) : '–'}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="4" class="empty-state">Noch keine Spiele gespeichert</td></tr>';

  matchesBody.querySelectorAll('.match-row').forEach((row) => {
    row.addEventListener('click', () => toggleMatchDetail(row, statsMatchesCache.find((m) => m.id === row.dataset.match)));
  });

  const practiceBody = document.getElementById('stats-practice-body');
  const sessions = statsPracticeCache.slice().reverse();
  practiceBody.innerHTML = sessions.length ? sessions.map((s) => `
    <tr>
      <td>${new Date(s.finishedAt).toLocaleString('de-DE')}</td>
      <td>${escapeHtml(s.player.name)}</td>
      <td>${s.rounds}</td>
      <td>${s.totalPoints}</td>
      <td>${s.average.toFixed(1)}</td>
    </tr>
  `).join('') : '<tr><td colspan="5" class="empty-state">Noch keine Trainingseinheiten</td></tr>';
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

function renderMatchDetail(match) {
  const legLines = (match.legHistory || []).map((l) => {
    const winner = match.players.find((p) => p.id === l.winnerId);
    return `<div class="leg-history-item"><span>Leg ${l.leg}${match.setsToWin > 1 ? ` · Set ${l.set}` : ''} — ${winner ? escapeHtml(winner.name) : '?'}</span><span>Checkout ${l.checkoutScore} (${l.checkoutDartCount} ${l.checkoutDartCount === 1 ? 'Dart' : 'Darts'})</span></div>`;
  }).join('') || '<div class="empty-state">Keine Leg-Details gespeichert</div>';

  const statsLines = match.players.map((p) => `
    <div class="leg-history-item">
      <span>${escapeHtml(p.name)}</span>
      <span>Ø ${p.average.toFixed(1)} · ${p.tons || 0}×100+ · ${p.oneForties || 0}×140+ · ${p.maximums || 0}×180 · ${p.checkoutsHit}/${p.checkoutOpportunities || 0} Checkouts</span>
    </div>
  `).join('');

  return `<div class="stack">
    <div><strong style="font-size:0.85rem; color:var(--text-dim)">Leg-Verlauf</strong><div class="leg-history-list" style="margin-top:6px;">${legLines}</div></div>
    <div><strong style="font-size:0.85rem; color:var(--text-dim)">Spieler-Stats</strong><div class="leg-history-list" style="margin-top:6px;">${statsLines}</div></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Remote QR overlay
// ---------------------------------------------------------------------------

document.getElementById('btn-remote-qr').addEventListener('click', () => {
  socket.emit('get_remote_url', (res) => {
    if (res.qr) document.getElementById('remote-qr-img').src = res.qr;
    document.getElementById('remote-qr-url').textContent = res.url;
    document.getElementById('overlay-remote-qr').hidden = false;
  });
});
document.getElementById('overlay-remote-close').addEventListener('click', () => {
  document.getElementById('overlay-remote-qr').hidden = true;
});

// ---------------------------------------------------------------------------
// TV mode (fullscreen scoreboard, phones do the input)
// ---------------------------------------------------------------------------

function enterTvMode() {
  document.body.classList.add('tv-mode');
  document.getElementById('btn-tv-exit').hidden = false;
  socket.emit('get_remote_url', (res) => {
    if (res.qr) document.getElementById('tv-qr-img').src = res.qr;
    document.getElementById('tv-qr-url').textContent = res.url;
  });
  const el = document.documentElement;
  if (el.requestFullscreen && !document.fullscreenElement) {
    el.requestFullscreen().catch(() => { /* fullscreen is a nice-to-have */ });
  }
}

function exitTvMode() {
  document.body.classList.remove('tv-mode');
  document.getElementById('btn-tv-exit').hidden = true;
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => { /* ignore */ });
  }
}

document.getElementById('btn-tv-mode').addEventListener('click', enterTvMode);
document.getElementById('btn-tv-exit').addEventListener('click', exitTvMode);
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && document.body.classList.contains('tv-mode')) exitTvMode();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('tv-mode')) exitTvMode();
});

// ---------------------------------------------------------------------------
// Press feedback for pads
// ---------------------------------------------------------------------------

document.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('.numpad-grid button, .numpad-actions .btn, .multiplier-row button');
  if (!btn) return;
  btn.classList.add('pressed');
  setTimeout(() => btn.classList.remove('pressed'), 160);
});

// ---------------------------------------------------------------------------
// Desktop integration (only present inside the Electron app, not in a plain browser)
// ---------------------------------------------------------------------------

if (window.darttracker) {
  window.darttracker.getVersion().then((v) => {
    document.getElementById('app-version').textContent = `v${v}`;
  }).catch(() => {});

  const banner = document.getElementById('update-banner');
  const bannerText = document.getElementById('update-banner-text');
  const installBtn = document.getElementById('update-install');
  window.darttracker.onUpdateStatus((info) => {
    if (info.state === 'downloading') {
      bannerText.textContent = `Update auf v${info.version} wird im Hintergrund geladen…`;
      installBtn.hidden = true;
      banner.hidden = false;
    } else if (info.state === 'ready') {
      bannerText.textContent = `Update auf v${info.version} ist bereit.`;
      installBtn.hidden = false;
      banner.hidden = false;
    }
  });
  installBtn.addEventListener('click', () => window.darttracker.installUpdate());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
