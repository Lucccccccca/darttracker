'use strict';

const socket = io();

let latestState = { players: [], playerStats: [], game: null, serverInfo: {} };
let previousGameId; // undefined until first state arrives (init sentinel)
let currentView = 'home';

// ---- Local UI-only state ----
let setupSelectedPlayerIds = [];
let setupStartScoreValue = 501;
let setupMode = 'x01';
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
  if (name === 'home') refreshHome();
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
  const firstState = previousGameId === undefined;
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

  if (firstState) refreshHome();
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
  if (typeof renderHomePanels === 'function') renderHomePanels();
  const banner = document.getElementById('resume-banner');
  const g = latestState.game;
  if (!g) { banner.hidden = true; return; }
  banner.hidden = false;
  const text = document.getElementById('resume-text');
  if (g.mode === 'practice') {
    text.textContent = `Training läuft: ${g.player.name}`;
  } else {
    const names = g.players.map((p) => p.name).join(' vs ');
    const mode = g.mode === 'x01' ? `Leg ${g.legNumber}` : MODE_LABELS[g.mode];
    text.textContent = `Spiel läuft: ${names} — ${mode}`;
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

function applySetupMode(mode) {
  setupMode = mode;
  document.querySelectorAll('#setup-mode .mode-card').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  document.getElementById('setup-x01-options').hidden = mode !== 'x01';
  document.getElementById('setup-atc-options').hidden = mode !== 'atc';
  document.getElementById('setup-cricket-options').hidden = mode !== 'cricket';
}
document.querySelectorAll('#setup-mode .mode-card').forEach((b) => b.addEventListener('click', () => applySetupMode(b.dataset.mode)));

document.getElementById('setup-start-btn').addEventListener('click', () => {
  if (setupSelectedPlayerIds.length === 0) {
    alert('Bitte mindestens einen Spieler auswählen.');
    return;
  }
  if (setupMode === 'cricket' && setupSelectedPlayerIds.length < 2) {
    alert('Cricket braucht mindestens 2 Spieler.');
    return;
  }
  socket.emit('start_match', {
    mode: setupMode,
    multiHit: document.getElementById('setup-atc-multihit').checked,
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

function setupInputModeToggle(toggleId, numpadId, boardId, storageKey, cameraId) {
  const toggle = document.getElementById(toggleId);
  const numpadEl = document.getElementById(numpadId);
  const boardWrapEl = document.getElementById(boardId);
  const cameraEl = cameraId ? document.getElementById(cameraId) : null;
  let boardBuilt = false;

  function applyMode(mode) {
    if (mode === 'camera' && !cameraEl) mode = 'numpad';
    toggle.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    numpadEl.hidden = mode !== 'numpad';
    boardWrapEl.hidden = mode !== 'board';
    if (cameraEl) cameraEl.hidden = mode !== 'camera';
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

setupInputModeToggle('game-input-mode', 'game-input-numpad', 'game-input-board', 'darttracker-input-mode-game', 'game-input-camera');
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
  if (confirm('Spiel verwerfen? Es wird nichts gespeichert.')) socket.emit('abort_game');
});
document.getElementById('btn-end-game').addEventListener('click', () => {
  if (confirm('Spiel jetzt beenden? Der aktuelle Stand wird gewertet und gespeichert.')) socket.emit('end_match_early');
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
      score: p.currentScore !== undefined ? p.currentScore : p.displayScore,
      darts: p.turnDarts.length,
      turns: p.turnLog.length,
      lastTurn: p.turnLog[p.turnLog.length - 1] || null,
    })),
  };
}

// ---- In-place scoreboard: cards live as long as the game does, and only what changed is touched.
// Rebuilding the DOM on every throw (as before) cost layout + paint each time and made CSS
// transitions impossible, which is what made show mode stutter on slower PCs.
let gameCards = [];
let gameCardsKey = null;
let turnLogSignature = null;

function restartAnim(el, cls, ms) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  el._animTimers = el._animTimers || {};
  clearTimeout(el._animTimers[cls]);
  el._animTimers[cls] = setTimeout(() => el.classList.remove(cls), ms);
}

function setText(entry, key, el, value) {
  if (entry.cache[key] === value) return;
  entry.cache[key] = value;
  el.textContent = value;
}

function setHtml(entry, key, el, html) {
  if (entry.cache[key] === html) return false;
  entry.cache[key] = html;
  el.innerHTML = html;
  return true;
}

function buildCard() {
  const el = document.createElement('div');
  el.className = 'player-card';
  el.innerHTML = `
    <span class="active-badge" hidden>AM WURF</span>
    <div class="name-row"><span class="name"></span><span class="avg"></span></div>
    <div class="score"></div>
    <div class="legs-sets"><span class="badge legs"></span><span class="badge sets" hidden></span></div>
    <div class="dart-slots"></div>
    <div class="checkout-suggestion"></div>`;
  return {
    el,
    cache: {},
    badge: el.querySelector('.active-badge'),
    name: el.querySelector('.name'),
    avg: el.querySelector('.avg'),
    score: el.querySelector('.score'),
    legs: el.querySelector('.legs'),
    sets: el.querySelector('.sets'),
    slots: el.querySelector('.dart-slots'),
    checkout: el.querySelector('.checkout-suggestion'),
  };
}

function renderX01Game() {
  const g = latestState.game;
  if (!g || g.mode !== 'x01') return;

  const prev = prevGameSnapshot && prevGameSnapshot.id === g.id ? prevGameSnapshot : null;
  const sameLeg = prev && prev.legNumber === g.legNumber;
  const show = document.body.classList.contains('tv-mode');

  const legText = `Leg ${g.legNumber}${g.setsToWin > 1 ? ` · Set ${g.setNumber}` : ''}`;
  const subText = `${g.startScore} · ${g.doubleOut ? 'Doppel-Out' : 'Einfach-Out'}${g.doubleIn ? ' · Doppel-In' : ''}`;
  const legEl = document.getElementById('game-meta-leg');
  const subEl = document.getElementById('game-meta-sub');
  if (legEl.textContent !== legText) legEl.textContent = legText;
  if (subEl.textContent !== subText) subEl.textContent = subText;

  const board = document.getElementById('scoreboard');
  const key = `${g.id}:${g.players.length}`;
  if (gameCardsKey !== key) {
    board.classList.remove('cricket-wrap');
    multiBoardKey = null;
    board.innerHTML = '';
    gameCards = g.players.map(() => buildCard());
    gameCards.forEach((c) => board.appendChild(c.el));
    gameCardsKey = key;
  }

  g.players.forEach((p, idx) => {
    const c = gameCards[idx];
    const isActive = idx === g.activePlayerIndex;
    const pp = prev ? prev.players[idx] : null;
    const scoreChanged = !!pp && sameLeg && pp.score !== p.currentScore;
    const dartAdded = !!pp && p.turnDarts.length > pp.darts;
    const newTurn = !!pp && p.turnLog.length > pp.turns ? p.turnLog[p.turnLog.length - 1] : null;
    const busted = !!newTurn && newTurn.bust;
    const becameActive = !!prev && isActive && prev.activePlayerIndex !== idx;
    const scored180 = !!newTurn && !newTurn.bust && !newTurn.checkout && newTurn.scoreBefore - newTurn.scoreAfter === 180;

    c.el.classList.toggle('active', isActive);
    c.badge.hidden = !isActive;
    if (becameActive) restartAnim(c.el, 'active-in', 1000);
    if (busted) restartAnim(c.el, 'bust-shake', 1000);

    setText(c, 'name', c.name, p.name);
    setText(c, 'avg', c.avg, `Ø ${p.average.toFixed(1)}`);
    setText(c, 'score', c.score, String(p.currentScore));
    if (scoreChanged) restartAnim(c.score, 'score-pop', 600);

    const legDots = Array.from({ length: g.legsToWin }, (_, i) => i < p.legsWon ? '●' : '○').join(' ');
    setText(c, 'legs', c.legs, `Legs ${legDots}`);
    c.sets.hidden = g.setsToWin <= 1;
    if (g.setsToWin > 1) setText(c, 'sets', c.sets, `Sets ${p.setsWon}/${g.setsToWin}`);

    const slotsChanged = setHtml(c, 'slots', c.slots, renderDartSlots(p.turnDarts, false));
    if (slotsChanged && dartAdded) {
      const filled = c.slots.querySelectorAll('.dart-slot.filled');
      if (filled.length) filled[filled.length - 1].classList.add('dart-in');
    }

    setHtml(c, 'checkout', c.checkout, isActive ? formatCheckout(p.checkoutSuggestion) : '');

    // the dart that was just thrown: still in turnDarts, or (if it ended the turn) last in the new log entry
    const thrownDart = dartAdded ? p.turnDarts[p.turnDarts.length - 1] : newTurn ? newTurn.darts[newTurn.darts.length - 1] : null;
    if (thrownDart && show) {
      showDartFly(thrownDart);
      playSound(thrownDart.bust ? 'bust' : thrownDart.multiplier === 3 ? 'treble' : 'dart');
    }
    if (scored180) { showBigFlash('180!', 'gold', 'Maximum'); playSound('max'); }
    else if (busted) { showBigFlash('Bust', 'red'); if (!show) playSound('bust'); }
    else if (newTurn && !newTurn.checkout && show) {
      const scored = newTurn.scoreBefore - newTurn.scoreAfter;
      if (scored >= 140) { showBigFlash(String(scored), 'orange', 'Aufnahme'); playSound('ton'); }
      else if (scored >= 100) { showBigFlash(String(scored), 'gold', 'Aufnahme'); playSound('ton'); }
      else if (scored >= 60) { showBigFlash(String(scored), 'white', 'Aufnahme'); }
    }
  });

  const buildLog = (markNew) => g.players.map((p, idx) => {
    const pp = prev ? prev.players[idx] : null;
    return p.turnLog.slice(-6).reverse().map((t, i) => {
      const cls = t.bust ? 'bust' : t.checkout ? 'checkout' : '';
      const isNew = markNew && i === 0 && !!pp && p.turnLog.length > pp.turns;
      const dartsStr = t.darts.map((d) => d.label).join(' ');
      const resultStr = t.bust ? 'BUST' : t.checkout ? `CHECKOUT ${t.scoreBefore}` : `${t.scoreBefore} → ${t.scoreAfter}`;
      return `<div class="turn-log-entry ${cls}${isNew ? ' new-entry' : ''}">
        <div><span class="who">${escapeHtml(p.name)}</span><div class="darts">${dartsStr}</div></div>
        <div class="result">${resultStr}</div>
      </div>`;
    }).join('');
  }).join('') || '<div class="empty-state">Noch keine Würfe</div>';

  const signature = buildLog(false);
  if (signature !== turnLogSignature) {
    turnLogSignature = signature;
    document.getElementById('turn-log').innerHTML = buildLog(true);
  }

  handleLegAndMatchOverlays(g, prev);
  prevGameSnapshot = snapshotGame(g);
  cameraNotifyGame(g);
}

// ---------------------------------------------------------------------------
// Cricket & Around the Clock rendering (X01 lives in renderX01Game above)
// ---------------------------------------------------------------------------

const MODE_LABELS = { x01: 'X01', cricket: 'Cricket', atc: 'Rund um die Uhr', practice: 'Training' };

function renderGame() {
  const g = latestState.game;
  if (!g || g.mode === 'practice') return;
  if (g.mode === 'x01') renderX01Game();
  else renderMultiGame(g);
}

/** Cricket mark glyphs as inline SVG: 1 = slash, 2 = cross, 3 = cross in a circle. */
function markSvg(n) {
  if (!n) return '';
  const slash = '<path d="M6 18 18 6"/>';
  const cross = '<path d="M6 6l12 12M18 6 6 18"/>';
  const ring = n >= 3 ? '<circle cx="12" cy="12" r="10"/>' : '';
  return `<svg class="mk mk-${Math.min(n, 3)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">${n === 1 ? slash : cross}${ring}</svg>`;
}

function cricketBoardHtml(g, prevMarks) {
  const N = g.players.length;
  const middle = N === 2;
  const label = (n) => (n === 25 ? 'B' : String(n));
  const closedByAll = (n) => g.players.every((p) => p.marks[n] >= 3);
  const cells = [];

  const head = (p, idx) => `<div class="cr-head${idx === g.activePlayerIndex ? ' active' : ''}">
      ${idx === g.activePlayerIndex && g.status === 'in_progress' ? '<span class="active-badge">AM WURF</span>' : ''}
      <div class="cr-name">${escapeHtml(p.name)}</div>
      <div class="cr-score">${p.score}</div>
      <div class="cr-mpr">MPR ${p.mpr.toFixed(2)}</div>
    </div>`;

  if (middle) cells.push(head(g.players[0], 0), '<div class="cr-gap"></div>', head(g.players[1], 1));
  else cells.push('<div class="cr-gap"></div>', ...g.players.map(head));

  g.numbers.forEach((n) => {
    const dead = closedByAll(n);
    const markCell = (p, idx) => {
      const pop = prevMarks && prevMarks[idx] !== undefined && p.marks[n] > prevMarks[idx][n];
      return `<div class="cr-cell${idx === g.activePlayerIndex ? ' active-col' : ''}${dead ? ' dead' : ''}${p.marks[n] >= 3 ? ' closed' : ''}${pop ? ' pop' : ''}">${markSvg(p.marks[n])}</div>`;
    };
    const num = `<div class="cr-num${dead ? ' dead' : ''}">${label(n)}</div>`;
    if (middle) cells.push(markCell(g.players[0], 0), num, markCell(g.players[1], 1));
    else cells.push(num, ...g.players.map(markCell));
  });

  const cols = middle ? 'minmax(0,1fr) auto minmax(0,1fr)' : `auto repeat(${N}, minmax(0,1fr))`;
  const active = g.players[g.activePlayerIndex];
  return `<div class="cr-board" style="grid-template-columns:${cols}">${cells.join('')}</div>
    <div class="cr-darts"><div class="dart-slots">${renderDartSlots(active.turnDarts, false)}</div></div>`;
}

function updateTurnLog(g, prev, describe) {
  const build = (markNew) => g.players.map((p, idx) => {
    const pp = prev ? prev.players[idx] : null;
    return p.turnLog.slice(-6).reverse().map((t, i) => {
      const isNew = markNew && i === 0 && !!pp && p.turnLog.length > pp.turns;
      const dartsStr = t.darts.map((d) => d.label).join(' ');
      return `<div class="turn-log-entry${isNew ? ' new-entry' : ''}">
        <div><span class="who">${escapeHtml(p.name)}</span><div class="darts">${dartsStr}</div></div>
        <div class="result">${describe(t)}</div>
      </div>`;
    }).join('');
  }).join('') || '<div class="empty-state">Noch keine Würfe</div>';
  const signature = build(false);
  if (signature !== turnLogSignature) {
    turnLogSignature = signature;
    document.getElementById('turn-log').innerHTML = build(true);
  }
}

let prevCricketMarks = null;
let multiBoardKey = null;
let multiBoardSignature = null;

function renderMultiGame(g) {
  const prev = prevGameSnapshot && prevGameSnapshot.id === g.id ? prevGameSnapshot : null;
  const show = document.body.classList.contains('tv-mode');
  const board = document.getElementById('scoreboard');

  const legEl = document.getElementById('game-meta-leg');
  const subEl = document.getElementById('game-meta-sub');
  const subText = g.mode === 'cricket'
    ? 'Marks schließen · Punkte sammeln'
    : g.multiHit ? 'Double/Triple springen weiter' : 'Jede Zahl der Reihe nach';
  if (legEl.textContent !== MODE_LABELS[g.mode]) legEl.textContent = MODE_LABELS[g.mode];
  if (subEl.textContent !== subText) subEl.textContent = subText;

  // dart that was just thrown (still in turnDarts, or last of the visit that just closed)
  let thrown = null;
  g.players.forEach((p, idx) => {
    const pp = prev ? prev.players[idx] : null;
    if (!pp) return;
    if (p.turnDarts.length > pp.darts) thrown = p.turnDarts[p.turnDarts.length - 1];
    else if (p.turnLog.length > pp.turns) {
      const t = p.turnLog[p.turnLog.length - 1];
      thrown = t.darts[t.darts.length - 1];
    }
  });
  if (thrown && show) {
    showDartFly({ ...thrown, bust: false });
    playSound(thrown.multiplier === 3 ? 'treble' : 'dart');
  }

  if (g.mode === 'cricket') {
    const key = `${g.id}:cricket`;
    if (multiBoardKey !== key) { board.innerHTML = ''; board.classList.add('cricket-wrap'); multiBoardKey = key; multiBoardSignature = null; prevCricketMarks = null; }
    const marksNow = g.players.map((p) => ({ ...p.marks }));
    const signature = JSON.stringify([g.players.map((p) => [p.score, p.marks, p.turnDarts.map((d) => d.label)]), g.activePlayerIndex, g.status]);
    if (signature !== multiBoardSignature) {
      board.innerHTML = cricketBoardHtml(g, prevCricketMarks);
      multiBoardSignature = signature;
      // number just closed by someone → celebrate in show mode
      if (show && prevCricketMarks) {
        g.numbers.forEach((n) => g.players.forEach((p, idx) => {
          if (p.marks[n] >= 3 && prevCricketMarks[idx] && prevCricketMarks[idx][n] < 3) showBigFlash(n === 25 ? 'Bull zu' : `${n} zu`, 'green', p.name);
        }));
      }
      prevCricketMarks = marksNow;
    }
    updateTurnLog(g, prev, (t) => `${t.marks} Marks${t.points ? ` · +${t.points}` : ''}`);
  } else {
    board.classList.remove('cricket-wrap');
    const key = `${g.id}:atc:${g.players.length}`;
    if (multiBoardKey !== key) {
      board.innerHTML = '';
      gameCards = g.players.map(() => buildCard());
      gameCards.forEach((c) => board.appendChild(c.el));
      gameCardsKey = null; // force the X01 card cache to rebuild if a different game comes next
      multiBoardKey = key;
    }
    g.players.forEach((p, idx) => {
      const c = gameCards[idx];
      const isActive = idx === g.activePlayerIndex && g.status === 'in_progress';
      const pp = prev ? prev.players[idx] : null;
      const targetChanged = !!pp && pp.score !== p.displayScore;
      const becameActive = !!prev && isActive && prev.activePlayerIndex !== idx;
      c.el.classList.toggle('active', isActive);
      c.badge.hidden = !isActive;
      if (becameActive) restartAnim(c.el, 'active-in', 1000);
      setText(c, 'name', c.name, p.name);
      setText(c, 'avg', c.avg, `${p.darts} Darts`);
      setText(c, 'score', c.score, p.displayScore);
      c.score.classList.toggle('long', p.displayScore.length > 2);
      if (targetChanged) restartAnim(c.score, 'score-pop', 600);
      c.sets.hidden = true;
      setText(c, 'legs', c.legs, `${p.reached} / ${g.totalTargets} getroffen`);
      const slotsChanged = setHtml(c, 'slots', c.slots, renderDartSlots(p.turnDarts, false));
      if (slotsChanged && pp && p.turnDarts.length > pp.darts) {
        const filled = c.slots.querySelectorAll('.dart-slot.filled');
        if (filled.length) filled[filled.length - 1].classList.add('dart-in');
      }
      const pct = Math.round((p.reached / g.totalTargets) * 100);
      setHtml(c, 'checkout', c.checkout, `<div class="atc-bar"><span style="width:${pct}%"></span></div>`);
    });
    updateTurnLog(g, prev, (t) => `${t.marks} ${t.marks === 1 ? 'Treffer' : 'Treffer'}`);
  }

  handleLegAndMatchOverlays(g, prev);
  prevGameSnapshot = snapshotGame(g);
  cameraNotifyGame(g);
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

function showBigFlash(text, colorClass, sub) {
  const el = document.createElement('div');
  el.className = `big-flash ${colorClass}`;
  el.innerHTML = `<div>${escapeHtml(text)}${sub ? `<span class="bf-sub">${escapeHtml(sub)}</span>` : ''}</div>`;
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
  // Fallback: with reduced-motion (no animation → no animationend) or a hidden tab the flash
  // would otherwise stay on screen forever.
  setTimeout(() => el.remove(), 1800);
}

function showDartFly(dart) {
  document.querySelectorAll('.dart-fly').forEach((e) => e.remove());
  const el = document.createElement('div');
  const kind = dart.value === 25 ? 'bull' : dart.multiplier === 3 ? 'triple' : dart.multiplier === 2 ? 'double' : 'single';
  el.className = `dart-fly ${kind}`;
  el.textContent = dart.bust ? `${dart.label} ✕` : dart.label;
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
  setTimeout(() => el.remove(), 1200);
}

// ---- Sounds: synthesized with WebAudio, so no audio files are needed. Only in show mode. ----
let audioCtx = null;
let soundEnabled = true;
try { soundEnabled = localStorage.getItem('darttracker-sound') !== 'off'; } catch (e) { /* ignore */ }

function audio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function tone(ctx, { freq, start, dur, type = 'sine', gain = 0.25, slideTo }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, ctx.currentTime + start);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + start + dur);
  g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.05);
}

function playSound(name) {
  if (!soundEnabled || !document.body.classList.contains('tv-mode')) return;
  const ctx = audio();
  if (!ctx) return;
  switch (name) {
    case 'dart': tone(ctx, { freq: 170, start: 0, dur: 0.09, type: 'triangle', gain: 0.35, slideTo: 60 }); break;
    case 'treble': tone(ctx, { freq: 170, start: 0, dur: 0.09, type: 'triangle', gain: 0.35, slideTo: 60 }); tone(ctx, { freq: 880, start: 0.03, dur: 0.12, gain: 0.12 }); break;
    case 'bust': tone(ctx, { freq: 220, start: 0, dur: 0.35, type: 'sawtooth', gain: 0.18, slideTo: 70 }); break;
    case 'ton': [523, 659, 784].forEach((f, i) => tone(ctx, { freq: f, start: i * 0.09, dur: 0.22, gain: 0.18 })); break;
    case 'max': [523, 659, 784, 1047, 1319].forEach((f, i) => tone(ctx, { freq: f, start: i * 0.08, dur: 0.3, type: 'square', gain: 0.12 })); break;
    case 'checkout': [392, 523, 659, 784].forEach((f, i) => tone(ctx, { freq: f, start: i * 0.11, dur: 0.4, gain: 0.2 })); tone(ctx, { freq: 1047, start: 0.46, dur: 0.7, gain: 0.2 }); break;
    case 'win': [392, 523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(ctx, { freq: f, start: i * 0.12, dur: 0.35, gain: 0.2 })); tone(ctx, { freq: 1568, start: 0.98, dur: 1.1, gain: 0.22 }); break;
    default: break;
  }
}

// ---- Effects level: 'auto' measures real frame rate in show mode, 'lite'/'full' force it ----
let fxPref = 'auto';
try { fxPref = localStorage.getItem('darttracker-fx') || 'auto'; } catch (e) { /* ignore */ }
let fxMeasureToken = 0;

function isLite() { return document.body.classList.contains('lite'); }

function renderFxButton() {
  const label = fxPref === 'lite' ? 'Effekte: Sparsam' : fxPref === 'full' ? 'Effekte: Voll' : (isLite() ? 'Effekte: Auto (sparsam)' : 'Effekte: Auto');
  document.getElementById('btn-fx').textContent = label;
}

/** Average fps and share of slow frames while the stage animations run. null if the tab is hidden. */
function measureFps(durationMs) {
  return new Promise((resolve) => {
    if (document.hidden) { resolve(null); return; }
    const stamps = [];
    const t0 = performance.now();
    // rAF stops entirely when the window is covered/minimized — don't wait forever
    setTimeout(() => resolve(null), durationMs + 2500);
    const step = (t) => {
      stamps.push(t);
      if (document.hidden) { resolve(null); return; } // minimized / covered: numbers would be meaningless
      if (t - t0 < durationMs) requestAnimationFrame(step);
      else {
        let slow = 0;
        for (let i = 1; i < stamps.length; i++) if (stamps[i] - stamps[i - 1] > 34) slow++;
        const frames = stamps.length - 1;
        resolve(frames > 5 ? { fps: (frames * 1000) / (stamps[stamps.length - 1] - stamps[0]), slowShare: slow / frames } : null);
      }
    };
    requestAnimationFrame(step);
  });
}

async function applyFxPreference() {
  const token = ++fxMeasureToken;
  if (fxPref === 'lite') document.body.classList.add('lite');
  else if (fxPref === 'full') document.body.classList.remove('lite');
  else {
    document.body.classList.remove('lite');
    renderFxButton();
    await new Promise((r) => setTimeout(r, 700)); // let the show layout settle first
    const m = await measureFps(2200);
    if (token !== fxMeasureToken || fxPref !== 'auto') return;
    if (m && (m.fps < 46 || m.slowShare > 0.2)) document.body.classList.add('lite');
  }
  renderFxButton();
}

document.getElementById('btn-fx').addEventListener('click', () => {
  fxPref = fxPref === 'auto' ? 'lite' : fxPref === 'lite' ? 'full' : 'auto';
  try { localStorage.setItem('darttracker-fx', fxPref); } catch (e) { /* ignore */ }
  applyFxPreference();
});

function launchConfetti(container) {
  const colors = ['#ff4136', '#ffb020', '#2fae6b', '#f5f3ef', '#ff8a3d'];
  const wrap = document.createElement('div');
  wrap.className = 'confetti';
  const count = isLite() ? 26 : 60;
  for (let i = 0; i < count; i++) {
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
        playSound('checkout');
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
      if (justHappened && !g.endedEarly) {
        showBigFlash('Game Shot!', 'gold');
        playSound('win');
        setTimeout(() => launchConfetti(matchOverlay), 250);
      }
      const winner = g.players.find((p) => p.id === g.winnerId);
      const trophy = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="var(--gold)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v4a5 5 0 0 1-10 0V4Z"/><path d="M7 5H4a3 3 0 0 0 3 5"/><path d="M17 5h3a3 3 0 0 1-3 5"/><path d="M12 13v3"/><path d="M9 20h6"/><path d="M10 17h4l.6 3H9.4l.6-3Z"/></svg>';
      document.getElementById('match-overlay-title').innerHTML = winner
        ? `${trophy} ${escapeHtml(winner.name)} gewinnt!`
        : 'Unentschieden';
      document.getElementById('match-summary').innerHTML =
        (g.endedEarly ? '<div style="margin-bottom:8px;">Vorzeitig beendet – Stand wird gewertet.</div>' : '') +
        g.players.map((p) => {
          if (g.mode === 'cricket') return `${escapeHtml(p.name)}: ${p.score} Punkte · ${p.marksTotal} Marks · MPR ${p.mpr.toFixed(2)}`;
          if (g.mode === 'atc') return `${escapeHtml(p.name)}: ${p.reached}/${g.totalTargets} getroffen · ${p.darts} Darts`;
          return `${escapeHtml(p.name)}: ${p.legsWon} Legs${g.setsToWin > 1 ? `, ${p.setsWon} Sets` : ''} · Ø ${p.average.toFixed(1)} · Highscore ${p.highestTurn}${p.highestCheckout ? ` · Bestes Checkout ${p.highestCheckout}` : ''}`;
        }).join('<br/>');
    }
  } else {
    matchOverlay.hidden = true;
    lastMatchOverlayShown = false;
  }
}

document.getElementById('leg-overlay-continue').addEventListener('click', () => socket.emit('continue_after_leg'));
document.getElementById('leg-overlay-undo').addEventListener('click', () => socket.emit('undo_throw'));
document.getElementById('match-overlay-undo').addEventListener('click', () => socket.emit('undo_throw'));
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

let statsSelectedPlayerId = 'all';
let statsMatchesCache = [];
let statsPracticeCache = [];
let statsPeriod = 'all';
let statsMatchLimit = 10;
let h2hA = null;
let h2hB = null;

const MODE_PILLS = { x01: 'X01', cricket: 'Cricket', atc: 'Rund um die Uhr' };

function inPeriod(ts) {
  if (statsPeriod === 'all') return true;
  return ts >= Date.now() - Number(statsPeriod) * 86400000;
}
const periodMatches = () => statsMatchesCache.filter((m) => inPeriod(m.finishedAt));
const periodPractice = () => statsPracticeCache.filter((s) => inPeriod(s.finishedAt));

function matchTitle(m) {
  return m.mode === 'cricket' ? 'Cricket' : m.mode === 'atc' ? 'Rund um die Uhr' : `X01 ${m.startScore}`;
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

function renderStatsView() {
  renderStatsPlayerTabs();
  renderStatsForm();
  renderStatsAnalytics();
  renderStatsTables();
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

  if (x01.matchesPlayed === 0 && practice.sessionsPlayed === 0 && other.cricketPlayed === 0 && other.atcPlayed === 0) {
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
      <td>${m.mode === 'cricket' ? 'Cricket' : m.mode === 'atc' ? 'Rund um die Uhr' : m.startScore}</td>
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

function renderMatchDetail(match) {
  if (match.mode === 'cricket' || match.mode === 'atc') {
    const lines = match.players.map((p) => `
      <div class="leg-history-item">
        <span>${escapeHtml(p.name)}${p.id === match.winnerId ? ' · Sieger' : ''}</span>
        <span>${match.mode === 'cricket'
          ? `${p.score} Punkte · ${p.closed}/7 geschlossen · ${p.marksTotal} Marks · MPR ${(p.mpr || 0).toFixed(2)}`
          : `${p.reached}/21 getroffen · ${p.dartsThrownTotal} Darts${p.finished ? ' · fertig' : ''}`}</span>
      </div>`).join('');
    return `<div class="stack"><div>
      <strong style="font-size:0.85rem; color:var(--text-dim)">${match.mode === 'cricket' ? 'Cricket' : 'Rund um die Uhr'}${match.endedEarly ? ' · vorzeitig beendet' : ''}</strong>
      <div class="leg-history-list" style="margin-top:6px;">${lines}</div></div></div>`;
  }
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
// Camera detection (single webcam)
// ---------------------------------------------------------------------------

const CAMERA_STORAGE_KEY = 'darttracker-camera';
let cameraStream = null;
let cameraAuto = true;
let pendingDetection = null;
const cameraVideo = document.getElementById('camera-video');
const cameraOverlay = document.getElementById('camera-overlay');

function loadCameraSettings() {
  try { return JSON.parse(localStorage.getItem(CAMERA_STORAGE_KEY) || 'null') || {}; } catch (e) { return {}; }
}
function saveCameraSettings(patch) {
  const next = { ...loadCameraSettings(), ...patch };
  try { localStorage.setItem(CAMERA_STORAGE_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
  return next;
}

function setCameraPill(text, cls) {
  const pill = document.getElementById('camera-pill');
  pill.hidden = !cameraDetector.running;
  pill.className = 'camera-pill' + (cls ? ` ${cls}` : '');
  document.getElementById('camera-pill-text').textContent = text;
}

const cameraDetector = new CameraDetector({
  onStatus: (text, state) => {
    document.getElementById('camera-status').textContent = text;
    setCameraPill(`Kamera: ${text}`, state === 'waitClear' || state === 'motion' ? 'busy' : '');
  },
  onFrame: () => {
    if (cameraOverlay.width !== cameraOverlay.clientWidth || cameraOverlay.height !== cameraOverlay.clientHeight) {
      cameraOverlay.width = cameraOverlay.clientWidth || 320;
      cameraOverlay.height = cameraOverlay.clientHeight || 240;
    }
    cameraDetector.drawOverlay(cameraOverlay.getContext('2d'), cameraOverlay.width, cameraOverlay.height);
  },
  onDetect: (hit) => {
    setCameraPill(`Kamera: ${hit.label} erkannt`, 'detected');
    if (cameraAuto) {
      socket.emit('throw', { value: hit.value, multiplier: hit.mult });
    } else {
      pendingDetection = hit;
      document.getElementById('camera-last-label').textContent = hit.label;
      document.getElementById('camera-last').hidden = false;
    }
  },
});

async function openCameraStream(deviceId) {
  if (cameraStream) cameraStream.getTracks().forEach((t) => t.stop());
  const constraints = { video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
  cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
  return cameraStream;
}

async function startCamera() {
  const btn = document.getElementById('camera-start');
  try {
    const settings = loadCameraSettings();
    const stream = await openCameraStream(settings.deviceId);
    cameraVideo.srcObject = stream;
    await new Promise((resolve) => { cameraVideo.onloadedmetadata = resolve; setTimeout(resolve, 1500); });
    cameraDetector.setSource(cameraVideo);
    cameraDetector.setCalibration(settings.calibration ? { ...settings.calibration, position: settings.position, sensitivity: settings.sensitivity } : null);
    if (typeof settings.sensitivity === 'number') {
      document.getElementById('camera-sens').value = settings.sensitivity;
      document.getElementById('camera-sens-label').textContent = settings.sensitivity;
    }
    cameraDetector.start();
    btn.textContent = 'Kamera stoppen';
    btn.classList.remove('btn-primary');
    if (!cameraDetector.isCalibrated) cameraDetector.setStatus('Bitte zuerst „Scheibe einrichten“');
    setCameraPill('Kamera läuft', '');
  } catch (err) {
    cameraDetector.setStatus('Keine Kamera: ' + (err && err.message ? err.message : err));
    alert('Kamera konnte nicht gestartet werden: ' + (err && err.message ? err.message : err) + '\n\nIst eine Webcam angeschlossen und in den Windows-Datenschutzeinstellungen für Desktop-Apps freigegeben?');
  }
}

function stopCamera() {
  cameraDetector.stop();
  if (cameraStream) cameraStream.getTracks().forEach((t) => t.stop());
  cameraStream = null;
  cameraVideo.srcObject = null;
  const btn = document.getElementById('camera-start');
  btn.textContent = 'Kamera starten';
  btn.classList.add('btn-primary');
  document.getElementById('camera-status').textContent = 'Kamera aus';
  document.getElementById('camera-pill').hidden = true;
}

document.getElementById('camera-start').addEventListener('click', () => {
  if (cameraDetector.running) stopCamera(); else startCamera();
});
document.getElementById('camera-mark-empty').addEventListener('click', () => {
  if (!cameraDetector.running) { alert('Bitte zuerst die Kamera starten.'); return; }
  cameraDetector.markEmpty();
});
document.getElementById('camera-sens').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  cameraDetector.sensitivity = v;
  document.getElementById('camera-sens-label').textContent = v;
  saveCameraSettings({ sensitivity: v });
});
document.getElementById('camera-auto').addEventListener('change', (e) => {
  cameraAuto = e.target.checked;
  document.getElementById('camera-last').hidden = true;
});
document.getElementById('camera-accept').addEventListener('click', () => {
  if (!pendingDetection) return;
  socket.emit('throw', { value: pendingDetection.value, multiplier: pendingDetection.mult });
  pendingDetection = null;
  document.getElementById('camera-last').hidden = true;
});

// Tell the detector when a visit is over (3 darts, bust or checkout) so it waits for the board to be cleared.
let cameraLastTurnCount = 0;
function cameraNotifyGame(g) {
  if (!cameraDetector.running) return;
  if (!g || g.mode === 'practice') { cameraDetector.setPaused(true); return; }
  cameraDetector.setPaused(g.status !== 'in_progress');
  const turns = g.players.reduce((s, p) => s + p.turnLog.length, 0);
  if (turns !== cameraLastTurnCount) {
    cameraLastTurnCount = turns;
    if (turns > 0) cameraDetector.notifyVisitEnded();
  }
}

// ---- calibration modal ----
let calibPoints = [];
let calibStream = null;
const calibVideo = document.getElementById('calib-video');
const calibCanvas = document.getElementById('calib-canvas');

function drawCalib() {
  const w = calibCanvas.width = calibCanvas.clientWidth || 640;
  const h = calibCanvas.height = calibCanvas.clientHeight || 480;
  const ctx = calibCanvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (calibPoints.length === 4) {
    const probe = new CameraDetector({ onDetect: () => {} });
    probe.setCalibration({ points: calibPoints, position: document.getElementById('calib-position').value });
    probe.drawOverlay(ctx, w, h);
  }
  calibPoints.forEach(([nx, ny], i) => {
    const x = nx * w, y = ny * h;
    ctx.fillStyle = '#ffb020';
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Manrope, sans-serif';
    ctx.fillText(String(i + 1), x + 9, y - 9);
  });
  const instr = document.getElementById('calib-instruction');
  instr.textContent = calibPoints.length < 4
    ? `Punkt ${calibPoints.length + 1} von 4: ${CALIB_POINTS[calibPoints.length].label}`
    : 'Passt das rote Gitter auf die Scheibe? Dann „Fertig“ – sonst Punkte zurücksetzen.';
  document.getElementById('calib-done').disabled = calibPoints.length !== 4;
}

async function openCalibration() {
  const overlay = document.getElementById('overlay-calibrate');
  overlay.hidden = false;
  const settings = loadCameraSettings();
  calibPoints = settings.calibration && settings.calibration.points ? settings.calibration.points.slice() : [];
  document.getElementById('calib-position').value = settings.position || 'oben';
  try {
    if (cameraStream) cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
    calibStream = await navigator.mediaDevices.getUserMedia({ video: settings.deviceId ? { deviceId: { exact: settings.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    calibVideo.srcObject = calibStream;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const sel = document.getElementById('calib-device');
    sel.innerHTML = devices.map((d, i) => `<option value="${d.deviceId}">${escapeHtml(d.label || `Kamera ${i + 1}`)}</option>`).join('');
    const current = calibStream.getVideoTracks()[0].getSettings().deviceId;
    if (current) sel.value = current;
  } catch (err) {
    document.getElementById('calib-instruction').textContent = 'Keine Kamera gefunden: ' + (err && err.message ? err.message : err);
  }
  drawCalib();
}

function closeCalibration() {
  document.getElementById('overlay-calibrate').hidden = true;
  if (calibStream) calibStream.getTracks().forEach((t) => t.stop());
  calibStream = null;
  calibVideo.srcObject = null;
  if (cameraDetector.running) startCamera();
}

document.getElementById('camera-calibrate').addEventListener('click', openCalibration);
document.getElementById('calib-cancel').addEventListener('click', closeCalibration);
document.getElementById('calib-reset').addEventListener('click', () => { calibPoints = []; drawCalib(); });
document.getElementById('calib-stage').addEventListener('click', (e) => {
  if (calibPoints.length >= 4) return;
  const rect = calibCanvas.getBoundingClientRect();
  calibPoints.push([(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height]);
  drawCalib();
});
document.getElementById('calib-position').addEventListener('change', drawCalib);
document.getElementById('calib-device').addEventListener('change', async (e) => {
  saveCameraSettings({ deviceId: e.target.value });
  if (calibStream) calibStream.getTracks().forEach((t) => t.stop());
  calibStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: e.target.value }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  calibVideo.srcObject = calibStream;
  calibPoints = [];
  drawCalib();
});
document.getElementById('calib-done').addEventListener('click', () => {
  if (calibPoints.length !== 4) return;
  saveCameraSettings({ calibration: { points: calibPoints }, position: document.getElementById('calib-position').value });
  closeCalibration();
});

// ---------------------------------------------------------------------------
// Connection indicator
// ---------------------------------------------------------------------------

socket.on('disconnect', () => { document.getElementById('conn-banner').hidden = false; });
socket.on('connect', () => { document.getElementById('conn-banner').hidden = true; });

// ---------------------------------------------------------------------------
// Backup: export / import all data as one JSON file
// ---------------------------------------------------------------------------

document.getElementById('btn-export-data').addEventListener('click', () => {
  socket.emit('export_data', (data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `darttracker-sicherung-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
});

document.getElementById('btn-import-data').addEventListener('click', () => {
  document.getElementById('import-file').click();
});

document.getElementById('import-file').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  file.text().then((text) => {
    let data;
    try { data = JSON.parse(text); } catch (err) { alert('Datei konnte nicht gelesen werden.'); return; }
    socket.emit('import_data', data, (res) => {
      if (!res || !res.ok) { alert(res && res.error ? res.error : 'Import fehlgeschlagen.'); return; }
      alert(`Sicherung geladen: ${res.players} Spieler, ${res.matches} Spiele, ${res.practiceSessions} Trainings neu übernommen.`);
      renderStats();
    });
  });
});

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

function renderSoundButton() {
  document.getElementById('btn-sound-label').textContent = soundEnabled ? 'Sound an' : 'Sound aus';
  document.getElementById('btn-sound').style.opacity = soundEnabled ? '' : '0.6';
}

document.getElementById('btn-sound').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  try { localStorage.setItem('darttracker-sound', soundEnabled ? 'on' : 'off'); } catch (e) { /* ignore */ }
  renderSoundButton();
  if (soundEnabled) playSound('ton');
});

function enterTvMode() {
  document.body.classList.add('tv-mode');
  document.getElementById('show-bar').hidden = false;
  renderSoundButton();
  applyFxPreference();
  audio();
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
  document.getElementById('show-bar').hidden = true;
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
