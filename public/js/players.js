'use strict';

// Training view and the player list.
// (Classic script: all files in public/js share one global scope; see the script tags in index.html.)

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

function playerById(id) { return latestState.players.find((p) => p.id === id) || {}; }

function renderPlayers() {
  const body = document.getElementById('players-table-body');
  if (latestState.playerStats.length === 0) {
    body.innerHTML = '<tr><td colspan="8" class="empty-state">Noch keine Spieler angelegt</td></tr>';
    return;
  }
  body.innerHTML = latestState.playerStats.map((s) => `
    <tr>
      <td><button class="pc-dot big" data-color="${s.id}" style="background:${playerById(s.id).color || '#888'}" title="Farbe ändern"></button>${escapeHtml(s.name)}</td>
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
  body.querySelectorAll('[data-color]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const current = playerById(btn.dataset.color).color;
      const next = PLAYER_COLORS[(PLAYER_COLORS.indexOf(current) + 1) % PLAYER_COLORS.length];
      socket.emit('set_player_color', { id: btn.dataset.color, color: next });
    });
  });
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
