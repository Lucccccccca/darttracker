'use strict';

const socket = io();
let multiplier = 1;
let latest = { players: [], game: null };
let prevSnapshot = null; // { gameId, score, darts } of what was last rendered

const IDENTITY_KEY = 'darttracker-remote-identity';
let identity = '';
try { identity = localStorage.getItem(IDENTITY_KEY) || ''; } catch (e) { /* ignore */ }

// ---- Setup-from-phone state ----
let setupSelectedIds = [];
let setupScore = 501;
let setupLegs = 3;
let setupMode = 'x01';

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const MODE_LABELS = { x01: 'X01', cricket: 'Cricket', atc: 'Rund um die Uhr' };

// socket.io would queue emits while offline and fire them on reconnect — for a scoring app that
// means stale darts landing on the wrong player. Refuse instead, and say so.
function send(...args) {
  if (!socket.connected) { buzz(90); flashConnection(); return false; }
  socket.emit(...args);
  return true;
}

function flashConnection() {
  const b = document.getElementById('conn-banner');
  b.hidden = false;
  b.classList.remove('shake');
  void b.offsetWidth;
  b.classList.add('shake');
}

socket.on('disconnect', () => { document.getElementById('conn-banner').hidden = false; render(); });
socket.on('connect', () => { document.getElementById('conn-banner').hidden = true; });

function buzz(ms = 12) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ }
}

function throwDart(value, mult) {
  send('throw', { value, multiplier: mult });
  buzz();
}

// ---------------------------------------------------------------------------
// Input pad
// ---------------------------------------------------------------------------

const numpad = document.getElementById('remote-numpad');
for (let n = 1; n <= 20; n++) {
  const btn = document.createElement('button');
  btn.textContent = n;
  btn.addEventListener('click', () => throwDart(n, multiplier));
  numpad.appendChild(btn);
}

document.querySelectorAll('.multiplier-row button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.multiplier-row button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    multiplier = Number(btn.dataset.mult);
    buzz(6);
  });
});

(function setupInputModeToggle() {
  const toggle = document.getElementById('remote-input-mode');
  const numpadEl = document.getElementById('remote-input-numpad');
  const boardWrapEl = document.getElementById('remote-input-board');
  const storageKey = 'darttracker-input-mode-remote';
  let boardBuilt = false;

  function applyMode(mode) {
    toggle.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    numpadEl.hidden = mode !== 'numpad';
    boardWrapEl.hidden = mode !== 'board';
    if (mode === 'board' && !boardBuilt) {
      boardWrapEl.appendChild(createDartboardSVG((value, mult) => throwDart(value, mult), { touch: true }));
      const hint = document.createElement('div');
      hint.className = 'db-aim-hint';
      hint.textContent = 'Finger auf die Scheibe legen, mit der Lupe zielen, loslassen = Wurf. Außerhalb loslassen = abbrechen.';
      boardWrapEl.appendChild(hint);
      boardBuilt = true;
    }
    try { localStorage.setItem(storageKey, mode); } catch (e) { /* ignore */ }
  }

  toggle.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => applyMode(btn.dataset.mode)));

  let initial = 'numpad';
  try { initial = localStorage.getItem(storageKey) || 'numpad'; } catch (e) { /* ignore */ }
  applyMode(initial);
})();

document.getElementById('remote-bull25').addEventListener('click', () => throwDart(25, 1));
document.getElementById('remote-bull50').addEventListener('click', () => throwDart(25, 2));
document.getElementById('remote-miss').addEventListener('click', () => throwDart(0, 1));
document.getElementById('remote-undo').addEventListener('click', () => { send('undo_throw'); buzz(20); });
document.getElementById('remote-finish-practice').addEventListener('click', () => send('finish_game'));
document.getElementById('remote-end-game').addEventListener('click', () => {
  if (confirm('Spiel jetzt beenden? Der aktuelle Stand wird gewertet und gespeichert.')) { send('end_match_early'); buzz(20); }
});

document.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('.remote-numpad button, .remote-actions .btn, .multiplier-row button');
  if (!btn) return;
  btn.classList.add('pressed');
  setTimeout(() => btn.classList.remove('pressed'), 160);
});

// ---------------------------------------------------------------------------
// Setup from the phone (no game running)
// ---------------------------------------------------------------------------

function renderSetupPlayers() {
  const list = document.getElementById('remote-setup-players');
  list.innerHTML = '';
  latest.players.forEach((p) => {
    const idx = setupSelectedIds.indexOf(p.id);
    const chip = document.createElement('button');
    chip.className = 'chip' + (idx >= 0 ? ' selected' : '');
    chip.innerHTML = (idx >= 0 ? `<span class="order-badge">${idx + 1}</span>` : '') + escapeHtml(p.name);
    chip.addEventListener('click', () => {
      const existing = setupSelectedIds.indexOf(p.id);
      if (existing >= 0) setupSelectedIds.splice(existing, 1);
      else setupSelectedIds.push(p.id);
      renderSetupPlayers();
      buzz(6);
    });
    list.appendChild(chip);
  });
  if (latest.players.length === 0) {
    list.innerHTML = '<div style="color:var(--text-dim); font-size:0.9rem;">Noch keine Spieler – unten anlegen.</div>';
  }
}

document.getElementById('remote-add-player').addEventListener('click', () => {
  const input = document.getElementById('remote-new-player-name');
  const name = input.value.trim();
  if (!name) return;
  send('add_player', { name }, (res) => {
    if (res && res.ok) {
      setupSelectedIds.push(res.player.id);
      input.value = '';
      renderSetupPlayers();
    }
  });
});

document.querySelectorAll('#remote-setup-score button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#remote-setup-score button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    setupScore = Number(btn.dataset.value);
  });
});

document.querySelectorAll('#remote-setup-legs .stepper-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    setupLegs = Math.max(1, setupLegs + Number(btn.dataset.step));
    document.getElementById('remote-setup-legs-value').textContent = setupLegs;
  });
});

const MODE_HINTS = {
  cricket: 'Cricket: 20 bis 15 und Bull je dreimal treffen (Double = 2, Triple = 3). Weitere Treffer auf offene Zahlen geben Punkte. Ab 2 Spielern.',
  atc: 'Rund um die Uhr: 1 bis 20 und zuletzt Bull der Reihe nach treffen. Wer zuerst fertig ist, gewinnt.',
};
document.querySelectorAll('#remote-setup-mode button').forEach((btn) => {
  btn.addEventListener('click', () => {
    setupMode = btn.dataset.mode;
    document.querySelectorAll('#remote-setup-mode button').forEach((b) => b.classList.toggle('active', b === btn));
    document.getElementById('remote-x01-options').style.display = setupMode === 'x01' ? '' : 'none';
    const hint = document.getElementById('remote-mode-hint');
    hint.style.display = setupMode === 'x01' ? 'none' : 'block';
    hint.textContent = MODE_HINTS[setupMode] || '';
    buzz(6);
  });
});

document.getElementById('remote-start-match').addEventListener('click', () => {
  if (setupSelectedIds.length === 0) { alert('Bitte mindestens einen Spieler antippen.'); return; }
  if (setupMode === 'cricket' && setupSelectedIds.length < 2) { alert('Cricket braucht mindestens 2 Spieler.'); return; }
  send('start_match', {
    mode: setupMode,
    playerIds: setupSelectedIds,
    startScore: setupScore,
    legsToWin: setupLegs,
    setsToWin: 1,
    doubleOut: document.getElementById('remote-setup-double-out').checked,
    doubleIn: false,
  });
  buzz(20);
});

document.getElementById('remote-start-practice').addEventListener('click', () => {
  if (setupSelectedIds.length === 0) { alert('Bitte einen Spieler antippen.'); return; }
  send('start_practice', { playerId: setupSelectedIds[0] });
  buzz(20);
});

// ---------------------------------------------------------------------------
// Identity ("Ich bin …") — locks the pad while someone else is throwing
// ---------------------------------------------------------------------------

function setIdentity(id) {
  identity = id;
  try { localStorage.setItem(IDENTITY_KEY, id); } catch (e) { /* ignore */ }
  render();
  buzz(6);
}

function renderIdentityBar(g) {
  const bar = document.getElementById('remote-identity');
  if (g.mode !== 'x01' || g.players.length < 2) { bar.innerHTML = ''; return; }
  const options = [{ id: '', name: 'Alle steuern' }, ...g.players.map((p) => ({ id: p.id, name: p.name }))];
  bar.innerHTML = options.map((o) =>
    `<button class="chip${identity === o.id ? ' selected' : ''}" data-id="${o.id}">${o.id ? 'Ich bin ' : ''}${escapeHtml(o.name)}</button>`
  ).join('');
  bar.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setIdentity(b.dataset.id)));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderDartSlots(darts, animateLast) {
  let html = '';
  for (let i = 0; i < 3; i++) {
    const d = darts[i];
    if (!d) { html += '<div class="dart-slot"></div>'; continue; }
    const isLast = i === darts.length - 1;
    html += `<div class="dart-slot filled${d.bust ? ' bust' : ''}${animateLast && isLast ? ' dart-in' : ''}">${d.label}</div>`;
  }
  return html;
}

function render() {
  const g = latest.game;
  const idle = document.getElementById('remote-idle');
  const active = document.getElementById('remote-active');

  if (!g) {
    idle.hidden = false;
    active.hidden = true;
    renderSetupPlayers();
    prevSnapshot = null;
    return;
  }
  idle.hidden = true;
  active.hidden = false;

  const pad = document.getElementById('remote-pad');
  const wait = document.getElementById('remote-wait');
  const flow = document.getElementById('remote-flow');
  const finishPractice = document.getElementById('remote-finish-practice');
  const endGame = document.getElementById('remote-end-game');
  const undoBtn = document.getElementById('remote-undo');
  const scoreEl = document.getElementById('remote-score');

  renderIdentityBar(g);

  if (g.mode !== 'practice') {
    const player = g.players[g.activePlayerIndex];
    const display = g.mode === 'x01' ? player.currentScore : player.displayScore;
    const where = g.mode === 'x01' ? `Leg ${g.legNumber}` : MODE_LABELS[g.mode];
    const identityPlayer = identity ? g.players.find((p) => p.id === identity) : null;
    const isMe = !!identityPlayer && identityPlayer.id === player.id;
    const sameGame = prevSnapshot && prevSnapshot.gameId === g.id;
    const scoreChanged = sameGame && prevSnapshot.score !== display && prevSnapshot.playerId === player.id;
    const dartAdded = sameGame && prevSnapshot.playerId === player.id && player.turnDarts.length > prevSnapshot.darts;

    document.getElementById('remote-turn-text').innerHTML = isMe
      ? `<span class="who me">Du bist dran</span> <span class="sub">— ${where}</span>`
      : `<span class="who">${escapeHtml(player.name)} ist dran</span> <span class="sub">— ${where}</span>`;
    scoreEl.textContent = display;
    scoreEl.classList.toggle('long', String(display).length > 3);
    scoreEl.classList.remove('score-pop');
    if (scoreChanged) { void scoreEl.offsetWidth; scoreEl.classList.add('score-pop'); }
    document.getElementById('remote-dart-slots').innerHTML = renderDartSlots(player.turnDarts, dartAdded);
    let infoHtml = '';
    if (g.mode === 'x01') {
      const co = player.checkoutSuggestion;
      if (co && co.possible) infoHtml = `<span class="co-label">CHECKOUT</span><span class="co-value">${co.route.map((r) => r.label).join(' · ')}</span>`;
    } else if (g.mode === 'cricket') {
      const open = player.openNumbers.map((n) => (n === 25 ? 'B' : n)).join(' · ');
      infoHtml = `<span class="co-label">NOCH OFFEN</span><span class="co-value">${open || 'alles zu – Punkte holen'}</span>`;
    } else {
      infoHtml = `<span class="co-label">${player.reached} / ${g.totalTargets} GETROFFEN</span><span class="co-value">Ziel: ${display}</span>`;
    }
    document.getElementById('remote-checkout').innerHTML = infoHtml;

    finishPractice.hidden = true;
    endGame.hidden = g.status === 'finished';
    undoBtn.hidden = false;
    undoBtn.disabled = !g.canUndo;
    document.getElementById('remote-undo-label').textContent =
      g.status === 'in_progress' && player.turnDarts.length === 0 ? 'Letzten Wurf zurück (Spielerwechsel)' : 'Letzten Wurf zurück';

    if (g.status === 'leg_finished' || g.status === 'set_finished' || g.status === 'finished') {
      const s = g.lastLegSummary;
      const winner = g.status === 'finished' ? g.players.find((p) => p.id === g.winnerId) : null;
      flow.innerHTML = g.status === 'finished'
        ? `<div class="flow-title">${winner ? escapeHtml(winner.name) + ' gewinnt!' : 'Unentschieden'}</div>
           <button class="btn btn-primary" id="remote-flow-btn">Speichern &amp; fertig</button>`
        : `<div class="flow-title">${g.status === 'set_finished' ? 'Set' : 'Leg'} für ${escapeHtml(s ? s.winnerName : '')}</div>
           <button class="btn btn-primary" id="remote-flow-btn">Nächstes Leg</button>
           <button class="btn btn-ghost" id="remote-flow-undo">Falsch eingegeben? Letzten Wurf zurück</button>`;
      flow.hidden = false;
      document.getElementById('remote-flow-btn').addEventListener('click', () => {
        send(g.status === 'finished' ? 'finish_game' : 'continue_after_leg');
        buzz(20);
      });
      const flowUndo = document.getElementById('remote-flow-undo');
      if (flowUndo) flowUndo.addEventListener('click', () => { send('undo_throw'); buzz(20); });
      pad.hidden = true;
      wait.hidden = true;
    } else {
      flow.hidden = true;
      pad.hidden = false;
      const locked = !!identityPlayer && !isMe;
      pad.classList.toggle('locked', locked || !socket.connected);
      wait.hidden = !locked;
      if (locked) wait.innerHTML = `<strong>${escapeHtml(player.name)}</strong> ist dran – dein Handy wartet, bis du wieder wirfst.`;
    }

    prevSnapshot = { gameId: g.id, playerId: player.id, score: display, darts: player.turnDarts.length };
  } else {
    const sameGame = prevSnapshot && prevSnapshot.gameId === g.id;
    const dartAdded = sameGame && g.turnDarts.length > prevSnapshot.darts;
    const scoreChanged = sameGame && prevSnapshot.score !== g.totalPoints;

    document.getElementById('remote-turn-text').innerHTML =
      `<span class="who">Training</span> <span class="sub">— ${escapeHtml(g.player.name)}</span>`;
    scoreEl.textContent = g.totalPoints;
    scoreEl.classList.remove('score-pop');
    if (scoreChanged) { void scoreEl.offsetWidth; scoreEl.classList.add('score-pop'); }
    document.getElementById('remote-dart-slots').innerHTML = renderDartSlots(g.turnDarts, dartAdded);
    document.getElementById('remote-checkout').innerHTML =
      `<span class="co-label">SCHNITT</span><span class="co-value">${g.average.toFixed(1)}</span>`;
    flow.hidden = true;
    wait.hidden = true;
    pad.hidden = false;
    pad.classList.remove('locked');
    finishPractice.hidden = false;
    endGame.hidden = true;
    undoBtn.hidden = false;
    undoBtn.disabled = false;
    document.getElementById('remote-undo-label').textContent = 'Letzten Wurf zurück';

    prevSnapshot = { gameId: g.id, playerId: null, score: g.totalPoints, darts: g.turnDarts.length };
  }
}

socket.on('state', (data) => {
  latest = data;
  // keep the phone's setup selection in sync with players that got deleted elsewhere
  setupSelectedIds = setupSelectedIds.filter((id) => data.players.some((p) => p.id === id));
  render();
});
