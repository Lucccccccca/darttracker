'use strict';

// X01 scoreboard (player cards that are updated in place).
// (Classic script: all files in public/js share one global scope; see the script tags in index.html.)

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
  const subText = `${g.startScore}${g.handicap ? ' Handicap' : ''} · ${g.doubleOut ? 'Doppel-Out' : 'Einfach-Out'}${g.doubleIn ? ' · Doppel-In' : ''}`;
  const legEl = document.getElementById('game-meta-leg');
  const subEl = document.getElementById('game-meta-sub');
  if (legEl.textContent !== legText) legEl.textContent = legText;
  if (subEl.textContent !== subText) subEl.textContent = subText;

  const board = document.getElementById('scoreboard');
  board.classList.toggle('crowded', g.players.length > 2);
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

  renderMatchFeed(g);

  handleLegAndMatchOverlays(g, prev);
  prevGameSnapshot = snapshotGame(g);
  cameraNotifyGame(g);
}
