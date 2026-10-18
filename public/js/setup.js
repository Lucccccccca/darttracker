'use strict';

// Starting a game: mode picker, players, handicap, training setup.
// (Classic script: all files in public/js share one global scope; see the script tags in index.html.)

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
  setupHandicap = false;
  setupHandicapScores = {};
  document.getElementById('setup-handicap').checked = false;
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
    chip.innerHTML = `<span class="pc-dot" style="background:${p.color || '#888'}"></span>` + (idx >= 0 ? `<span class="order-badge">${idx + 1}</span>` : '') + escapeHtml(p.name);
    chip.addEventListener('click', () => {
      const existing = setupSelectedPlayerIds.indexOf(p.id);
      if (existing >= 0) setupSelectedPlayerIds.splice(existing, 1);
      else setupSelectedPlayerIds.push(p.id);
      renderSetupPlayerSelection();
    });
    list.appendChild(chip);
  });
  renderHandicap();
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

// ---- Mode picker: generated from MODES (public/js/modes-data.js) ----
let setupRoundsByMode = {};
let setupHandicap = false;
let setupHandicapScores = {}; // playerId -> start score typed by the user (others follow the start score)

function buildModePicker() {
  const wrap = document.getElementById('setup-mode');
  let html = '';
  let group = null;
  MODES.forEach((m) => {
    if (m.group !== group) {
      if (group !== null) html += '</div>';
      group = m.group;
      html += `<div class="mode-group-title">${escapeHtml(m.group)}</div><div class="mode-picker">`;
    }
    html += `<button class="mode-card" data-mode="${m.key}"><span class="mode-card-title">${escapeHtml(m.label)}</span><span class="mode-card-desc">${escapeHtml(m.desc)}</span></button>`;
  });
  wrap.innerHTML = html + '</div>';
  wrap.querySelectorAll('.mode-card').forEach((b) => b.addEventListener('click', () => applySetupMode(b.dataset.mode)));
}

function applySetupMode(mode) {
  setupMode = mode;
  const info = modeInfo(mode) || MODES[0];
  document.querySelectorAll('#setup-mode .mode-card').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  document.getElementById('setup-x01-options').hidden = mode !== 'x01';
  document.getElementById('setup-atc-options').hidden = mode !== 'atc';
  const hint = document.getElementById('setup-mode-hint');
  hint.textContent = info.hint || '';
  hint.hidden = !info.hint;
  const roundsBox = document.getElementById('setup-rounds-options');
  roundsBox.hidden = !info.rounds;
  if (info.rounds) {
    document.getElementById('setup-rounds-label').textContent = info.roundsLabel;
    const current = setupRoundsByMode[mode] || info.rounds[0];
    const seg = document.getElementById('setup-rounds');
    seg.innerHTML = info.rounds.map((r) => `<button data-value="${r}" class="${r === current ? 'active' : ''}">${r}</button>`).join('');
    seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      setupRoundsByMode[mode] = Number(b.dataset.value);
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    }));
  }
  renderHandicap();
}

/** Handicap: one start score input per selected player. */
function renderHandicap() {
  const list = document.getElementById('setup-handicap-list');
  const on = setupHandicap && setupMode === 'x01';
  list.hidden = !on;
  if (!on) return;
  const selected = setupSelectedPlayerIds.map((id) => latestState.players.find((p) => p.id === id)).filter(Boolean);
  if (!selected.length) {
    list.innerHTML = '<div class="setup-hint">Wähle zuerst die Spieler aus.</div>';
    return;
  }
  const base = setupStartScoreValue || 501;
  list.innerHTML = selected.map((p) => `<label class="handicap-row">
      <span><span class="pc-dot" style="background:${p.color || '#888'}"></span>${escapeHtml(p.name)}</span>
      <input type="number" min="2" step="1" data-hid="${p.id}" value="${setupHandicapScores[p.id] || base}" />
    </label>`).join('');
  list.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => {
    setupHandicapScores[inp.dataset.hid] = Number(inp.value) || 0;
  }));
}

document.getElementById('setup-handicap').addEventListener('change', (e) => {
  setupHandicap = e.target.checked;
  renderHandicap();
});
document.getElementById('setup-start-score').addEventListener('click', () => setTimeout(renderHandicap, 0));
document.getElementById('setup-custom-score').addEventListener('input', () => renderHandicap());

document.getElementById('setup-start-btn').addEventListener('click', () => {
  const info = modeInfo(setupMode) || MODES[0];
  if (setupSelectedPlayerIds.length === 0) {
    alert('Bitte mindestens einen Spieler auswählen.');
    return;
  }
  if (setupSelectedPlayerIds.length < info.min) {
    alert(`${info.label} braucht mindestens ${info.min} Spieler.`);
    return;
  }
  const config = {
    mode: setupMode,
    multiHit: document.getElementById('setup-atc-multihit').checked,
    playerIds: setupSelectedPlayerIds,
    startScore: setupStartScoreValue || 501,
    legsToWin: setupLegsValue || 1,
    setsToWin: setupSetsValue || 1,
    doubleOut: document.getElementById('setup-double-out').checked,
    doubleIn: document.getElementById('setup-double-in').checked,
  };
  if (info.rounds) config.rounds = setupRoundsByMode[setupMode] || info.rounds[0];
  if (setupMode === 'x01' && setupHandicap) {
    config.startScores = {};
    setupSelectedPlayerIds.forEach((id) => { config.startScores[id] = Number(setupHandicapScores[id]) || config.startScore; });
  }
  socket.emit('start_match', config);
});

buildModePicker();
applySetupMode(setupMode);

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
