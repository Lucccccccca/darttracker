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

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buzz(ms = 12) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ }
}

function throwDart(value, mult) {
  socket.emit('throw', { value, multiplier: mult });
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
      boardWrapEl.appendChild(createDartboardSVG((value, mult) => throwDart(value, mult)));
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
document.getElementById('remote-undo').addEventListener('click', () => { socket.emit('undo_throw'); buzz(20); });
document.getElementById('remote-finish-practice').addEventListener('click', () => socket.emit('finish_game'));

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
  socket.emit('add_player', { name }, (res) => {
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

document.getElementById('remote-start-match').addEventListener('click', () => {
  if (setupSelectedIds.length === 0) { alert('Bitte mindestens einen Spieler antippen.'); return; }
  socket.emit('start_match', {
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
  socket.emit('start_practice', { playerId: setupSelectedIds[0] });
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
  const scoreEl = document.getElementById('remote-score');

  renderIdentityBar(g);

  if (g.mode === 'x01') {
    const player = g.players[g.activePlayerIndex];
    const identityPlayer = identity ? g.players.find((p) => p.id === identity) : null;
    const isMe = !!identityPlayer && identityPlayer.id === player.id;
    const sameGame = prevSnapshot && prevSnapshot.gameId === g.id;
    const scoreChanged = sameGame && prevSnapshot.score !== player.currentScore && prevSnapshot.playerId === player.id;
    const dartAdded = sameGame && prevSnapshot.playerId === player.id && player.turnDarts.length > prevSnapshot.darts;

    document.getElementById('remote-turn-text').innerHTML = isMe
      ? `<span class="who me">Du bist dran</span> <span class="sub">— Leg ${g.legNumber}</span>`
      : `<span class="who">${escapeHtml(player.name)} ist dran</span> <span class="sub">— Leg ${g.legNumber}</span>`;
    scoreEl.textContent = player.currentScore;
    scoreEl.classList.remove('score-pop');
    if (scoreChanged) { void scoreEl.offsetWidth; scoreEl.classList.add('score-pop'); }
    document.getElementById('remote-dart-slots').innerHTML = renderDartSlots(player.turnDarts, dartAdded);
    const co = player.checkoutSuggestion;
    document.getElementById('remote-checkout').innerHTML = co && co.possible
      ? `<span class="co-label">CHECKOUT</span><span class="co-value">${co.route.map((r) => r.label).join(' · ')}</span>`
      : '';

    finishPractice.hidden = true;

    if (g.status === 'leg_finished' || g.status === 'set_finished' || g.status === 'finished') {
      const s = g.lastLegSummary;
      const winner = g.status === 'finished' ? g.players.find((p) => p.id === g.winnerId) : null;
      flow.innerHTML = g.status === 'finished'
        ? `<div class="flow-title">${escapeHtml(winner ? winner.name : '')} gewinnt!</div>
           <button class="btn btn-primary" id="remote-flow-btn">Spiel abschließen</button>`
        : `<div class="flow-title">${g.status === 'set_finished' ? 'Set' : 'Leg'} für ${escapeHtml(s ? s.winnerName : '')}</div>
           <button class="btn btn-primary" id="remote-flow-btn">Nächstes Leg</button>`;
      flow.hidden = false;
      document.getElementById('remote-flow-btn').addEventListener('click', () => {
        socket.emit(g.status === 'finished' ? 'finish_game' : 'continue_after_leg');
        buzz(20);
      });
      pad.hidden = true;
      wait.hidden = true;
    } else {
      flow.hidden = true;
      pad.hidden = false;
      const locked = !!identityPlayer && !isMe;
      pad.classList.toggle('locked', locked);
      wait.hidden = !locked;
      if (locked) wait.innerHTML = `<strong>${escapeHtml(player.name)}</strong> ist dran – dein Handy wartet, bis du wieder wirfst.`;
    }

    prevSnapshot = { gameId: g.id, playerId: player.id, score: player.currentScore, darts: player.turnDarts.length };
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

    prevSnapshot = { gameId: g.id, playerId: null, score: g.totalPoints, darts: g.turnDarts.length };
  }
}

socket.on('state', (data) => {
  latest = data;
  // keep the phone's setup selection in sync with players that got deleted elsewhere
  setupSelectedIds = setupSelectedIds.filter((id) => data.players.some((p) => p.id === id));
  render();
});
