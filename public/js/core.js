'use strict';

// Shared state, view switching and the live state from the server.
// (Classic script: all files in public/js share one global scope; see the script tags in index.html.)

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
