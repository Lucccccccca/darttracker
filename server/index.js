'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server: SocketIOServer } = require('socket.io');
const QRCode = require('qrcode');

const store = require('./store');
const { getLanIp } = require('./network');
const { X01Match, PracticeSession, findCheckout } = require('./gameEngine');

function createServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new SocketIOServer(server);

  app.use(express.static(path.join(__dirname, '..', 'public')));

  // ---- In-memory session state (one shared game at a time, any number of clients) ----
  let players = store.loadPlayers();
  let currentGame = null; // X01Match | PracticeSession | null

  const savedMatch = store.loadCurrentMatch();
  if (savedMatch) {
    try {
      currentGame = savedMatch.mode === 'practice' ? PracticeSession.fromJSON(savedMatch) : X01Match.fromJSON(savedMatch);
    } catch (err) {
      console.error('Konnte gespeichertes Spiel nicht wiederherstellen:', err);
      store.clearCurrentMatch();
    }
  }

  function persistCurrentGame() {
    if (currentGame && currentGame.status !== 'finished') {
      store.saveCurrentMatch(currentGame.toJSON());
    } else {
      store.clearCurrentMatch();
    }
  }

  function computePlayerStats() {
    const matches = enrichMatchesWithAnalytics(store.loadMatches());
    const stats = new Map();
    for (const p of players) {
      stats.set(p.id, {
        id: p.id,
        name: p.name,
        matchesPlayed: 0,
        matchesWon: 0,
        bestAverage: 0,
        bestCheckout: 0,
        totalDarts: 0,
        totalPoints: 0,
        tons: 0,
        oneForties: 0,
        maximums: 0,
        checkoutOpportunities: 0,
        checkoutsHit: 0,
      });
    }
    for (const m of matches) {
      for (const mp of m.players) {
        const s = stats.get(mp.id);
        if (!s) continue;
        s.matchesPlayed += 1;
        if (m.winnerId === mp.id) s.matchesWon += 1;
        if (mp.average > s.bestAverage) s.bestAverage = mp.average;
        if (mp.highestCheckout > s.bestCheckout) s.bestCheckout = mp.highestCheckout;
        s.totalDarts += mp.dartsThrownTotal;
        s.totalPoints += mp.pointsScoredTotal;
        s.tons += mp.tons;
        s.oneForties += mp.oneForties;
        s.maximums += mp.maximums;
        s.checkoutOpportunities += mp.checkoutOpportunities;
        s.checkoutsHit += mp.checkoutsHit;
      }
    }
    return Array.from(stats.values()).map((s) => ({
      ...s,
      overallAverage: s.totalDarts > 0 ? (s.totalPoints / s.totalDarts) * 3 : 0,
      checkoutRate: s.checkoutOpportunities > 0 ? (s.checkoutsHit / s.checkoutOpportunities) * 100 : 0,
      winRate: s.matchesPlayed > 0 ? (s.matchesWon / s.matchesPlayed) * 100 : 0,
    }));
  }

  /**
   * Attaches derived per-turn analytics (checkout opportunities, scoring bands, busts) to
   * stored match records. Computed on read so older saved matches degrade gracefully
   * (missing turnLog -> zeros) instead of needing a data migration.
   */
  function enrichMatchesWithAnalytics(matches) {
    return matches.map((m) => ({
      ...m,
      players: m.players.map((p) => {
        const turnLog = p.turnLog || [];
        let checkoutOpportunities = 0;
        let tons = 0;
        let oneForties = 0;
        let maximums = 0;
        let busts = 0;
        for (const turn of turnLog) {
          if (turn.bust) {
            busts += 1;
            continue;
          }
          if (findCheckout(turn.scoreBefore, 3, m.doubleOut).possible) checkoutOpportunities += 1;
          const scored = turn.checkout ? turn.scoreBefore : turn.scoreBefore - turn.scoreAfter;
          if (scored === 180) maximums += 1;
          else if (scored >= 140) oneForties += 1;
          else if (scored >= 100) tons += 1;
        }
        return { ...p, checkoutOpportunities, tons, oneForties, maximums, busts };
      }),
    }));
  }

  function fullState() {
    return {
      players,
      playerStats: computePlayerStats(),
      game: currentGame ? currentGame.toJSON() : null,
      serverInfo: { ip: getLanIp(), port: server.address() ? server.address().port : null },
    };
  }

  function broadcastState() {
    persistCurrentGame();
    io.emit('state', fullState());
  }

  io.on('connection', (socket) => {
    socket.emit('state', fullState());

    socket.on('add_player', (payload, ack) => {
      const name = (payload && payload.name ? String(payload.name) : '').trim();
      if (!name) return ack && ack({ ok: false, error: 'Name fehlt' });
      const player = { id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, name, createdAt: Date.now() };
      players.push(player);
      store.savePlayers(players);
      broadcastState();
      ack && ack({ ok: true, player });
    });

    socket.on('delete_player', ({ id } = {}) => {
      players = players.filter((p) => p.id !== id);
      store.savePlayers(players);
      broadcastState();
    });

    socket.on('start_match', (config = {}) => {
      const selected = (config.playerIds || [])
        .map((id) => players.find((p) => p.id === id))
        .filter(Boolean);
      if (selected.length < 1) return;

      const startScore = Number(config.startScore) || 501;
      const legsToWin = Math.max(1, Number(config.legsToWin) || 1);
      const setsToWin = Math.max(1, Number(config.setsToWin) || 1);

      currentGame = new X01Match({
        players: selected,
        startScore,
        legsToWin,
        setsToWin,
        doubleOut: config.doubleOut !== false,
        doubleIn: !!config.doubleIn,
      });
      broadcastState();
    });

    socket.on('start_practice', ({ playerId } = {}) => {
      const player = players.find((p) => p.id === playerId);
      if (!player) return;
      currentGame = new PracticeSession({ player });
      broadcastState();
    });

    socket.on('throw', ({ value, multiplier } = {}) => {
      if (!currentGame) return;
      const v = Number(value);
      const m = Number(multiplier) || 1;
      if (Number.isNaN(v)) return;
      currentGame.throwDart(v, m);
      broadcastState();
    });

    socket.on('undo_throw', () => {
      if (!currentGame) return;
      currentGame.undoThrow();
      broadcastState();
    });

    socket.on('end_round', () => {
      if (currentGame && currentGame.mode === 'practice') {
        currentGame.endRoundEarly();
        broadcastState();
      }
    });

    socket.on('continue_after_leg', () => {
      if (currentGame && currentGame.mode === 'x01') {
        currentGame.continueAfterLeg();
        broadcastState();
      }
    });

    socket.on('finish_game', () => {
      if (!currentGame) return;
      if (currentGame.mode === 'x01') {
        store.appendMatch(currentGame.toMatchRecord());
      } else if (currentGame.mode === 'practice') {
        currentGame.finish();
        store.appendPracticeSession(currentGame.toSessionRecord());
      }
      currentGame = null;
      store.clearCurrentMatch();
      broadcastState();
    });

    socket.on('abort_game', () => {
      currentGame = null;
      store.clearCurrentMatch();
      broadcastState();
    });

    socket.on('get_history', (ack) => {
      ack && ack({ matches: enrichMatchesWithAnalytics(store.loadMatches()), practiceSessions: store.loadPracticeSessions() });
    });

    socket.on('get_remote_url', async (ack) => {
      const port = server.address() ? server.address().port : null;
      const url = `http://${getLanIp()}:${port}/remote/`;
      try {
        const qr = await QRCode.toDataURL(url, { margin: 1, width: 240 });
        ack && ack({ url, qr });
      } catch (err) {
        ack && ack({ url, qr: null });
      }
    });
  });

  return { app, server, io };
}

function startServer(preferredPort) {
  return new Promise((resolve, reject) => {
    const { server } = createServer();
    server.on('error', reject);
    server.listen(preferredPort, () => {
      resolve({ server, port: server.address().port });
    });
  });
}

module.exports = { createServer, startServer };

if (require.main === module) {
  startServer(process.env.PORT ? Number(process.env.PORT) : 4848).then(({ port }) => {
    console.log(`DartTracker Server läuft auf http://localhost:${port}`);
  });
}
