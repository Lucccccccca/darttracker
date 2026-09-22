'use strict';

// ---------------------------------------------------------------------------
// Dart value catalogue + checkout finder
// ---------------------------------------------------------------------------

/** All throwable dart values, richest (best for scoring) first. */
function buildDartCatalogue() {
  const darts = [];
  for (let n = 20; n >= 1; n--) darts.push({ label: `T${n}`, value: n * 3, isDouble: false });
  darts.push({ label: 'Bull', value: 50, isDouble: true });
  for (let n = 20; n >= 1; n--) darts.push({ label: `D${n}`, value: n * 2, isDouble: true });
  darts.push({ label: '25', value: 25, isDouble: false });
  for (let n = 20; n >= 1; n--) darts.push({ label: `S${n}`, value: n, isDouble: false });
  return darts;
}

const DART_CATALOGUE = buildDartCatalogue();
const DOUBLES = DART_CATALOGUE.filter((d) => d.isDouble);
// Preference order for "filler" darts before the final checkout dart: big trebles/doubles first.
const SCORING_PREFERENCE = DART_CATALOGUE.slice().sort((a, b) => b.value - a.value);

/**
 * Find a route to check out `remaining` points within `dartsLeft` darts.
 * Returns { possible, route: [{label,value}], dartsNeeded } or { possible:false }.
 */
function findCheckout(remaining, dartsLeft, doubleOut) {
  if (remaining <= 0 || dartsLeft <= 0) return { possible: false };
  if (doubleOut && remaining === 1) return { possible: false };

  const finishers = doubleOut ? DOUBLES : DART_CATALOGUE;

  // 1-dart finish
  const oneDart = finishers.find((d) => d.value === remaining);
  if (oneDart) return { possible: true, route: [oneDart], dartsNeeded: 1 };

  if (dartsLeft >= 2) {
    for (const first of SCORING_PREFERENCE) {
      if (first.value >= remaining) continue;
      const rest = remaining - first.value;
      const finish = finishers.find((d) => d.value === rest);
      if (finish) return { possible: true, route: [first, finish], dartsNeeded: 2 };
    }
  }

  if (dartsLeft >= 3) {
    for (const first of SCORING_PREFERENCE) {
      if (first.value >= remaining) continue;
      for (const second of SCORING_PREFERENCE) {
        const rest = remaining - first.value - second.value;
        if (rest <= 0) continue;
        const finish = finishers.find((d) => d.value === rest);
        if (finish) return { possible: true, route: [first, second, finish], dartsNeeded: 3 };
      }
    }
  }

  return { possible: false };
}

let idCounter = 1;
function nextId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}

// ---------------------------------------------------------------------------
// X01 match
// ---------------------------------------------------------------------------

class X01Match {
  constructor({ players, startScore, legsToWin, setsToWin, doubleOut, doubleIn }) {
    this.id = nextId('match');
    this.mode = 'x01';
    this.startedAt = Date.now();
    this.startScore = startScore;
    this.legsToWin = legsToWin;
    this.setsToWin = setsToWin;
    this.doubleOut = doubleOut;
    this.doubleIn = doubleIn;

    this.players = players.map((p) => ({
      id: p.id,
      name: p.name,
      legsWon: 0,
      setsWon: 0,
      currentScore: startScore,
      turnDarts: [],
      turnStartScore: startScore,
      hasDoubledIn: !doubleIn,
      dartsThrownTotal: 0,
      pointsScoredTotal: 0,
      checkoutsHit: 0,
      highestCheckout: 0,
      highestTurn: 0,
      turnLog: [],
    }));

    this.legNumber = 1;
    this.setNumber = 1;
    this.legStarterIndex = 0;
    this.activePlayerIndex = 0;
    this.status = 'in_progress'; // in_progress | leg_finished | set_finished | finished
    this.winnerId = null;
    this.lastLegSummary = null;
    this.legHistory = [];
  }

  get activePlayer() {
    return this.players[this.activePlayerIndex];
  }

  throwDart(value, multiplier) {
    if (this.status !== 'in_progress') return;
    const player = this.activePlayer;
    if (player.turnDarts.length >= 3) return;

    const points = value * multiplier;
    const isDoubleDart = multiplier === 2;
    let scoreDelta = points;

    if (this.doubleIn && !player.hasDoubledIn) {
      if (isDoubleDart) {
        player.hasDoubledIn = true;
        scoreDelta = points;
      } else {
        scoreDelta = 0;
      }
    }

    const newScore = player.currentScore - scoreDelta;
    const label = formatDartLabel(value, multiplier);
    let bust = false;

    if (newScore < 0) bust = true;
    else if (newScore === 0 && this.doubleOut && !isDoubleDart) bust = true;
    else if (newScore === 1 && this.doubleOut) bust = true;

    if (bust) {
      player.turnDarts.push({ label, value, multiplier, points: scoreDelta, bust: true });
      this._endTurn(player, { bust: true });
      return;
    }

    player.currentScore = newScore;
    player.turnDarts.push({ label, value, multiplier, points: scoreDelta, bust: false });

    if (newScore === 0) {
      this._winLeg(player);
      return;
    }

    if (player.turnDarts.length === 3) {
      this._endTurn(player, { bust: false });
    }
  }

  undoThrow() {
    if (this.status !== 'in_progress') return;
    const player = this.activePlayer;
    if (player.turnDarts.length === 0) return;
    const last = player.turnDarts.pop();
    if (!last.bust) {
      player.currentScore += last.points;
    }
    if (player.hasDoubledIn && this.doubleIn) {
      // Recompute doubledIn state from remaining darts this turn (rare edge case).
      const stillDoubled = player.turnDarts.some((d) => d.multiplier === 2 && !d.bust);
      if (!stillDoubled && !player.turnDarts.length) {
        // Only reset if no prior turns already doubled in - simplest safe default: leave as-is.
      }
    }
  }

  _endTurn(player, { bust }) {
    const scored = player.turnStartScore - player.currentScore;
    player.dartsThrownTotal += player.turnDarts.length;
    if (!bust) {
      player.pointsScoredTotal += scored;
      if (scored > player.highestTurn) player.highestTurn = scored;
    }
    player.turnLog.push({
      leg: this.legNumber,
      set: this.setNumber,
      darts: player.turnDarts.slice(),
      bust,
      scoreBefore: player.turnStartScore,
      scoreAfter: player.currentScore,
    });
    player.turnDarts = [];
    player.turnStartScore = player.currentScore;
    this._advancePlayer();
  }

  _advancePlayer() {
    this.activePlayerIndex = (this.activePlayerIndex + 1) % this.players.length;
  }

  _winLeg(player) {
    const dartsUsed = player.turnDarts.length;
    player.dartsThrownTotal += dartsUsed;
    player.pointsScoredTotal += player.turnStartScore - player.currentScore;
    player.checkoutsHit += 1;
    if (player.turnStartScore > player.highestCheckout) player.highestCheckout = player.turnStartScore;
    if (player.turnStartScore > player.highestTurn) player.highestTurn = player.turnStartScore;
    player.turnLog.push({
      leg: this.legNumber,
      set: this.setNumber,
      darts: player.turnDarts.slice(),
      bust: false,
      checkout: true,
      scoreBefore: player.turnStartScore,
      scoreAfter: 0,
    });
    player.legsWon += 1;

    this.lastLegSummary = {
      winnerId: player.id,
      winnerName: player.name,
      leg: this.legNumber,
      set: this.setNumber,
      checkoutScore: player.turnStartScore,
      checkoutDarts: player.turnLog[player.turnLog.length - 1].darts,
    };
    this.legHistory.push({
      leg: this.legNumber,
      set: this.setNumber,
      winnerId: player.id,
      checkoutScore: player.turnStartScore,
      checkoutDartCount: dartsUsed,
    });

    if (player.legsWon >= this.legsToWin) {
      player.setsWon += 1;
      if (player.setsWon >= this.setsToWin) {
        this.status = 'finished';
        this.winnerId = player.id;
        return;
      }
      this.status = 'set_finished';
      return;
    }
    this.status = 'leg_finished';
  }

  /** Called after leg_finished / set_finished acknowledgement to start the next leg. */
  continueAfterLeg() {
    if (this.status === 'finished') return;
    const startingNewSet = this.status === 'set_finished';
    this.legStarterIndex = (this.legStarterIndex + 1) % this.players.length;
    this.activePlayerIndex = this.legStarterIndex;

    for (const p of this.players) {
      p.currentScore = this.startScore;
      p.turnDarts = [];
      p.turnStartScore = this.startScore;
      p.hasDoubledIn = !this.doubleIn;
      if (startingNewSet) p.legsWon = 0;
    }

    if (startingNewSet) {
      this.setNumber += 1;
      this.legNumber = 1;
    } else {
      this.legNumber += 1;
    }
    this.status = 'in_progress';
  }

  checkoutSuggestionFor(player) {
    const dartsLeft = 3 - player.turnDarts.length;
    if (dartsLeft <= 0) return { possible: false };
    return findCheckout(player.currentScore, dartsLeft, this.doubleOut);
  }

  toJSON() {
    return {
      id: this.id,
      mode: this.mode,
      startedAt: this.startedAt,
      startScore: this.startScore,
      legsToWin: this.legsToWin,
      setsToWin: this.setsToWin,
      doubleOut: this.doubleOut,
      doubleIn: this.doubleIn,
      legNumber: this.legNumber,
      setNumber: this.setNumber,
      activePlayerIndex: this.activePlayerIndex,
      status: this.status,
      winnerId: this.winnerId,
      lastLegSummary: this.lastLegSummary,
      legHistory: this.legHistory,
      players: this.players.map((p) => ({
        ...p,
        average: p.dartsThrownTotal > 0 ? (p.pointsScoredTotal / p.dartsThrownTotal) * 3 : 0,
        checkoutSuggestion: this.status === 'in_progress' ? this.checkoutSuggestionFor(p) : { possible: false },
      })),
    };
  }

  static fromJSON(data) {
    const match = Object.create(X01Match.prototype);
    Object.assign(match, data);
    // toJSON() adds derived fields (average, checkoutSuggestion) to player copies;
    // strip them back off so we resume from clean internal state.
    match.players = data.players.map(({ average, checkoutSuggestion, ...rest }) => rest);
    return match;
  }

  toMatchRecord() {
    const json = this.toJSON();
    return {
      id: this.id,
      mode: 'x01',
      startedAt: this.startedAt,
      finishedAt: Date.now(),
      startScore: this.startScore,
      legsToWin: this.legsToWin,
      setsToWin: this.setsToWin,
      doubleOut: this.doubleOut,
      doubleIn: this.doubleIn,
      winnerId: this.winnerId,
      legHistory: this.legHistory,
      players: json.players.map((p) => ({
        id: p.id,
        name: p.name,
        legsWon: p.legsWon,
        setsWon: p.setsWon,
        average: p.average,
        dartsThrownTotal: p.dartsThrownTotal,
        pointsScoredTotal: p.pointsScoredTotal,
        checkoutsHit: p.checkoutsHit,
        highestCheckout: p.highestCheckout,
        highestTurn: p.highestTurn,
        turnLog: p.turnLog,
      })),
    };
  }
}

function formatDartLabel(value, multiplier) {
  if (value === 0) return 'Fehler';
  if (value === 25) return multiplier === 2 ? 'Bull' : '25';
  if (multiplier === 3) return `T${value}`;
  if (multiplier === 2) return `D${value}`;
  return `S${value}`;
}

// ---------------------------------------------------------------------------
// Free practice / training session
// ---------------------------------------------------------------------------

class PracticeSession {
  constructor({ player }) {
    this.id = nextId('practice');
    this.mode = 'practice';
    this.startedAt = Date.now();
    this.player = { id: player.id, name: player.name };
    this.turnDarts = [];
    this.rounds = []; // {darts:[...], total}
    this.totalPoints = 0;
    this.totalDarts = 0;
    this.status = 'in_progress';
  }

  throwDart(value, multiplier) {
    if (this.status !== 'in_progress') return;
    if (this.turnDarts.length >= 3) return;
    const points = value * multiplier;
    const label = formatDartLabel(value, multiplier);
    this.turnDarts.push({ label, value, multiplier, points });
    if (this.turnDarts.length === 3) this._endRound();
  }

  undoThrow() {
    if (this.turnDarts.length > 0) {
      this.turnDarts.pop();
      return;
    }
    const last = this.rounds.pop();
    if (last) {
      this.totalPoints -= last.total;
      this.totalDarts -= last.darts.length;
      this.turnDarts = last.darts;
    }
  }

  endRoundEarly() {
    if (this.turnDarts.length > 0) this._endRound();
  }

  _endRound() {
    const total = this.turnDarts.reduce((sum, d) => sum + d.points, 0);
    this.rounds.push({ darts: this.turnDarts.slice(), total });
    this.totalPoints += total;
    this.totalDarts += this.turnDarts.length;
    this.turnDarts = [];
  }

  finish() {
    if (this.turnDarts.length > 0) this._endRound();
    this.status = 'finished';
  }

  toJSON() {
    return {
      id: this.id,
      mode: this.mode,
      startedAt: this.startedAt,
      player: this.player,
      turnDarts: this.turnDarts,
      rounds: this.rounds,
      totalPoints: this.totalPoints,
      totalDarts: this.totalDarts,
      average: this.totalDarts > 0 ? (this.totalPoints / this.totalDarts) * 3 : 0,
      status: this.status,
    };
  }

  static fromJSON(data) {
    const session = Object.create(PracticeSession.prototype);
    const { average, ...rest } = data;
    Object.assign(session, rest);
    return session;
  }

  toSessionRecord() {
    const json = this.toJSON();
    return {
      id: this.id,
      mode: 'practice',
      startedAt: this.startedAt,
      finishedAt: Date.now(),
      player: this.player,
      rounds: this.rounds.length,
      totalDarts: this.totalDarts,
      totalPoints: this.totalPoints,
      average: json.average,
    };
  }
}

module.exports = { X01Match, PracticeSession, findCheckout, DART_CATALOGUE };
