'use strict';

// Cricket, Around the Clock and the classic round games on the scoreboard.
// (Classic script: all files in public/js share one global scope; see the script tags in index.html.)

// ---------------------------------------------------------------------------
// Cricket & Around the Clock rendering (X01 lives in renderX01Game above)
// ---------------------------------------------------------------------------

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

let prevCricketMarks = null;
let multiBoardKey = null;
let multiBoardSignature = null;

function renderMultiGame(g) {
  const prev = prevGameSnapshot && prevGameSnapshot.id === g.id ? prevGameSnapshot : null;
  const show = document.body.classList.contains('tv-mode');
  const board = document.getElementById('scoreboard');
  board.classList.toggle('crowded', g.players.length > 2);

  const legEl = document.getElementById('game-meta-leg');
  const subEl = document.getElementById('game-meta-sub');
  let subText;
  if (g.mode === 'cricket') subText = 'Marks schließen · Punkte sammeln';
  else if (g.mode === 'atc') subText = g.multiHit ? 'Double/Triple springen weiter' : 'Jede Zahl der Reihe nach';
  else if (g.status !== 'in_progress') subText = g.unit ? `Wertung: ${g.unit}` : '';
  else if (g.mode === 'killer') subText = `Runde ${g.roundNumber}`;
  else subText = `${ROUND_WORD[g.mode] || 'Runde'} ${g.roundNumber}${g.totalRounds ? ` / ${g.totalRounds}` : ''}${g.targetLabel ? ` · Ziel ${g.targetLabel}` : ''}`;
  const titleText = MODE_LABELS[g.mode] || g.title || '';
  if (legEl.textContent !== titleText) legEl.textContent = titleText;
  if (subEl.textContent !== subText) subEl.textContent = subText;

  // dart that was just thrown (still in turnDarts, or last of the visit that just closed)
  let thrown = null;
  let flash = null; // { note, name }: something worth announcing in show mode (Shanghai, Killer, Halbiert …)
  g.players.forEach((p, idx) => {
    const pp = prev ? prev.players[idx] : null;
    if (!pp) return;
    if (p.turnDarts.length > pp.darts) {
      thrown = p.turnDarts[p.turnDarts.length - 1];
      if (thrown.note) flash = { note: thrown.note, name: p.name };
    } else if (p.turnLog.length > pp.turns) {
      const t = p.turnLog[p.turnLog.length - 1];
      thrown = t.darts[t.darts.length - 1];
      const note = thrown.note || (g.mode === 'killer' ? '' : t.note);
      if (note) flash = { note, name: p.name };
    }
  });
  if (thrown && show) {
    showDartFly({ ...thrown, bust: false });
    playSound(thrown.multiplier === 3 ? 'treble' : 'dart');
  }
  if (flash && show) flashForNote(flash.note, flash.name);

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
    renderMatchFeed(g);
  } else {
    // Around the Clock and all classic round games share the same player cards
    board.classList.remove('cricket-wrap');
    const isAtc = g.mode === 'atc';
    const key = `${g.id}:cards:${g.players.length}`;
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
      c.el.classList.toggle('out', !!p.out);
      c.badge.hidden = !isActive;
      if (becameActive) restartAnim(c.el, 'active-in', 1000);
      setText(c, 'name', c.name, p.name);
      setText(c, 'avg', c.avg, isAtc ? `${p.darts} Darts` : p.detail || '');
      setText(c, 'score', c.score, p.displayScore);
      c.score.classList.toggle('long', p.displayScore.length > (isAtc ? 2 : 3));
      if (targetChanged) restartAnim(c.score, 'score-pop', 600);
      c.sets.hidden = true;
      setText(c, 'legs', c.legs, isAtc ? `${p.reached} / ${g.totalTargets} getroffen` : p.caption || '');
      const slotsChanged = setHtml(c, 'slots', c.slots, renderDartSlots(p.turnDarts, false));
      if (slotsChanged && pp && p.turnDarts.length > pp.darts) {
        const filled = c.slots.querySelectorAll('.dart-slot.filled');
        if (filled.length) filled[filled.length - 1].classList.add('dart-in');
      }
      if (isAtc) {
        const pct = Math.round((p.reached / g.totalTargets) * 100);
        setHtml(c, 'checkout', c.checkout, `<div class="atc-bar"><span style="width:${pct}%"></span></div>`);
      } else {
        const long = (g.targetLabel || '').length > 14;
        setHtml(c, 'checkout', c.checkout, isActive && g.targetLabel
          ? `<span class="co-label">${g.mode === 'killer' ? 'DEIN ZIEL' : 'ZIEL'}</span><span class="co-value${long ? ' text' : ''}">${escapeHtml(g.targetLabel)}</span>`
          : '');
      }
    });
    renderMatchFeed(g);
  }

  handleLegAndMatchOverlays(g, prev);
  prevGameSnapshot = snapshotGame(g);
  cameraNotifyGame(g);
}
