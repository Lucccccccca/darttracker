'use strict';

// Numpad, dartboard input and the buttons around them.
// (Classic script: all files in public/js share one global scope; see the script tags in index.html.)

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
