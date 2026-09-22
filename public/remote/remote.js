'use strict';

const socket = io();
let multiplier = 1;

const numpad = document.getElementById('remote-numpad');
for (let n = 1; n <= 20; n++) {
  const btn = document.createElement('button');
  btn.textContent = n;
  btn.addEventListener('click', () => socket.emit('throw', { value: n, multiplier }));
  numpad.appendChild(btn);
}

document.querySelectorAll('.multiplier-row button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.multiplier-row button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    multiplier = Number(btn.dataset.mult);
  });
});

// ---- Dartboard input mode (numpad <-> visual board), remembered per device ----
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
      boardWrapEl.appendChild(createDartboardSVG((value, mult) => socket.emit('throw', { value, multiplier: mult })));
      boardBuilt = true;
    }
    try { localStorage.setItem(storageKey, mode); } catch (e) { /* ignore */ }
  }

  toggle.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => applyMode(btn.dataset.mode)));

  let initial = 'numpad';
  try { initial = localStorage.getItem(storageKey) || 'numpad'; } catch (e) { /* ignore */ }
  applyMode(initial);
})();

document.getElementById('remote-bull25').addEventListener('click', () => socket.emit('throw', { value: 25, multiplier: 1 }));
document.getElementById('remote-bull50').addEventListener('click', () => socket.emit('throw', { value: 25, multiplier: 2 }));
document.getElementById('remote-miss').addEventListener('click', () => socket.emit('throw', { value: 0, multiplier: 1 }));
document.getElementById('remote-undo').addEventListener('click', () => socket.emit('undo_throw'));

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderDartSlots(darts) {
  let html = '';
  for (let i = 0; i < 3; i++) {
    const d = darts[i];
    html += d ? `<div class="dart-slot filled${d.bust ? ' bust' : ''}">${d.label}</div>` : '<div class="dart-slot"></div>';
  }
  return html;
}

socket.on('state', (data) => {
  const g = data.game;
  const idle = document.getElementById('remote-idle');
  const active = document.getElementById('remote-active');

  if (!g) {
    idle.hidden = false;
    active.hidden = true;
    return;
  }
  idle.hidden = true;
  active.hidden = false;

  if (g.mode === 'x01') {
    const player = g.players[g.activePlayerIndex];
    document.getElementById('remote-turn-text').innerHTML =
      `<span class="who">${escapeHtml(player.name)} ist dran</span> <span class="sub">— Leg ${g.legNumber}</span>`;
    document.getElementById('remote-score').textContent = player.currentScore;
    document.getElementById('remote-dart-slots').innerHTML = renderDartSlots(player.turnDarts);
    const co = player.checkoutSuggestion;
    document.getElementById('remote-checkout').innerHTML = co && co.possible
      ? `<span class="co-label">CHECKOUT</span><span class="co-value">${co.route.map((r) => r.label).join(' · ')}</span>`
      : '';
  } else {
    document.getElementById('remote-turn-text').innerHTML =
      `<span class="who">Training</span> <span class="sub">— ${escapeHtml(g.player.name)}</span>`;
    document.getElementById('remote-score').textContent = g.totalPoints;
    document.getElementById('remote-dart-slots').innerHTML = renderDartSlots(g.turnDarts);
    document.getElementById('remote-checkout').innerHTML =
      `<span class="co-label">SCHNITT</span><span class="co-value">${g.average.toFixed(1)}</span>`;
  }
});
