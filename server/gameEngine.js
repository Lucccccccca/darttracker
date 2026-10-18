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
    this.endedEarly = false;
    this.lastLegSummary = null;
    this.legHistory = [];
    this._history = [];
  }

  get activePlayer() {
    return this.players[this.activePlayerIndex];
  }

  // Undo works by restoring whole snapshots: a wrong dart can then be taken back even after
  // it ended the turn (player switch), busted, or won the leg — every mutation is reversible.
  _pushHistory() {
    const { _history, ...state } = this;
    this._history.push(JSON.parse(JSON.stringify(state)));
    if (this._history.length > 300) this._history.shift();
  }

  get canUndo() {
    return this._history.length > 0;
  }

  undoThrow() {
    const snapshot = this._history.pop();
    if (!snapshot) return;
    Object.assign(this, snapshot);
  }

  throwDart(value, multiplier) {
    if (this.status !== 'in_progress') return;
    const player = this.activePlayer;
    if (player.turnDarts.length >= 3) return;
    this._pushHistory();

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
      // A bust voids the whole visit, not just the busting dart.
      player.currentScore = player.turnStartScore;
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
    this._pushHistory();
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

  /** Ends the match now; whoever leads on sets, then legs, wins — a tie is a draw (no winner). */
  endEarly() {
    if (this.status === 'finished') return;
    this._pushHistory();
    const ranked = this.players.slice().sort((a, b) => b.setsWon - a.setsWon || b.legsWon - a.legsWon);
    const top = ranked[0];
    const tied = ranked.length > 1 && ranked[1].setsWon === top.setsWon && ranked[1].legsWon === top.legsWon;
    this.winnerId = tied ? null : top.id;
    this.endedEarly = true;
    this.status = 'finished';
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
      endedEarly: this.endedEarly,
      canUndo: this.canUndo,
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
    const { canUndo, ...fields } = data;
    Object.assign(match, fields);
    // toJSON() adds derived fields (average, checkoutSuggestion) to player copies;
    // strip them back off so we resume from clean internal state.
    match.players = data.players.map(({ average, checkoutSuggestion, ...rest }) => rest);
    match.endedEarly = !!data.endedEarly;
    match._history = [];
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
      endedEarly: this.endedEarly,
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

// ---------------------------------------------------------------------------
// Shared bits for the multi-player modes below (Cricket, Around the Clock)
// ---------------------------------------------------------------------------

/**
 * Base for games whose state is plain data: every mutation first snapshots the whole state,
 * so "undo" can take back anything (a dart, a visit change, even the winning dart).
 */
class ReversibleGame {
  _pushHistory() {
    const { _history, ...state } = this;
    this._history.push(JSON.parse(JSON.stringify(state)));
    if (this._history.length > 300) this._history.shift();
  }

  get canUndo() {
    return this._history.length > 0;
  }

  undoThrow() {
    const snapshot = this._history.pop();
    if (!snapshot) return;
    Object.assign(this, snapshot);
  }

  get activePlayer() {
    return this.players[this.activePlayerIndex];
  }

  _closeVisit(player) {
    player.dartsThrownTotal += player.turnDarts.length;
    player.turnLog.push({
      darts: player.turnDarts.slice(),
      marks: player.turnDarts.reduce((s, d) => s + (d.marks || 0), 0),
      points: player.turnDarts.reduce((s, d) => s + (d.points || 0), 0),
    });
    player.turnDarts = [];
  }

  _endTurn(player) {
    this._closeVisit(player);
    this.activePlayerIndex = (this.activePlayerIndex + 1) % this.players.length;
  }

  /** Ends the game now; best score wins, a tie is a draw (no winner). Subclasses provide _rank(). */
  endEarly() {
    if (this.status === 'finished') return;
    this._pushHistory();
    const ranked = this.players.slice().sort((a, b) => this._rank(b) - this._rank(a));
    const tied = ranked.length > 1 && this._rank(ranked[0]) === this._rank(ranked[1]);
    this.winnerId = tied ? null : ranked[0].id;
    this.endedEarly = true;
    this.status = 'finished';
  }

  _serialiseBase() {
    return {
      id: this.id,
      mode: this.mode,
      startedAt: this.startedAt,
      activePlayerIndex: this.activePlayerIndex,
      status: this.status,
      winnerId: this.winnerId,
      endedEarly: this.endedEarly,
      canUndo: this.canUndo,
    };
  }

  static _restore(instance, data, derivedKeys) {
    const { canUndo, ...fields } = data;
    Object.assign(instance, fields);
    instance.players = data.players.map((p) => {
      const copy = { ...p };
      derivedKeys.forEach((k) => delete copy[k]);
      return copy;
    });
    instance.endedEarly = !!data.endedEarly;
    instance._history = [];
    return instance;
  }
}

// ---------------------------------------------------------------------------
// Cricket: close 20-15 and the bull with 3 marks each; extra marks on a number the opponents
// haven't closed score points. First to close everything with at least the top score wins.
// ---------------------------------------------------------------------------

const CRICKET_NUMBERS = [20, 19, 18, 17, 16, 15, 25];

class CricketMatch extends ReversibleGame {
  constructor({ players }) {
    super();
    this.id = nextId('cricket');
    this.mode = 'cricket';
    this.startedAt = Date.now();
    this.players = players.map((p) => ({
      id: p.id,
      name: p.name,
      score: 0,
      marks: Object.fromEntries(CRICKET_NUMBERS.map((n) => [n, 0])),
      turnDarts: [],
      turnLog: [],
      dartsThrownTotal: 0,
      marksTotal: 0,
    }));
    this.activePlayerIndex = 0;
    this.status = 'in_progress';
    this.winnerId = null;
    this.endedEarly = false;
    this._history = [];
  }

  _allClosed(player) {
    return CRICKET_NUMBERS.every((n) => player.marks[n] >= 3);
  }

  throwDart(value, multiplier) {
    if (this.status !== 'in_progress') return;
    const player = this.activePlayer;
    if (player.turnDarts.length >= 3) return;
    this._pushHistory();

    let marksThrown = 0;
    let points = 0;
    if (CRICKET_NUMBERS.includes(value)) {
      marksThrown = value === 25 ? Math.min(multiplier, 2) : multiplier;
      const have = player.marks[value];
      const closing = Math.min(marksThrown, Math.max(0, 3 - have));
      const extra = marksThrown - closing;
      player.marks[value] = have + closing;
      const opponentOpen = this.players.some((o) => o !== player && o.marks[value] < 3);
      if (extra > 0 && opponentOpen) {
        points = extra * value;
        player.score += points;
      }
    }
    player.marksTotal += marksThrown;
    player.turnDarts.push({ label: formatDartLabel(value, multiplier), value, multiplier, marks: marksThrown, points });

    const topOpponent = Math.max(...this.players.filter((o) => o !== player).map((o) => o.score), -Infinity);
    if (this._allClosed(player) && player.score >= topOpponent) {
      this._closeVisit(player);
      this.winnerId = player.id;
      this.status = 'finished';
      return;
    }
    if (player.turnDarts.length === 3) this._endTurn(player);
  }

  _rank(p) {
    return p.score;
  }

  _mpr(p) {
    return p.turnLog.length ? p.turnLog.reduce((s, t) => s + t.marks, 0) / p.turnLog.length : 0;
  }

  toJSON() {
    return {
      ...this._serialiseBase(),
      numbers: CRICKET_NUMBERS,
      players: this.players.map((p) => ({
        ...p,
        displayScore: String(p.score),
        rounds: p.turnLog.length,
        mpr: this._mpr(p),
        openNumbers: CRICKET_NUMBERS.filter((n) => p.marks[n] < 3),
      })),
    };
  }

  static fromJSON(data) {
    return ReversibleGame._restore(Object.create(CricketMatch.prototype), data, ['displayScore', 'rounds', 'mpr', 'openNumbers']);
  }

  toMatchRecord() {
    return {
      id: this.id,
      mode: 'cricket',
      startedAt: this.startedAt,
      finishedAt: Date.now(),
      winnerId: this.winnerId,
      endedEarly: this.endedEarly,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        marksTotal: p.marksTotal,
        rounds: p.turnLog.length,
        mpr: this._mpr(p),
        dartsThrownTotal: p.dartsThrownTotal,
        closed: CRICKET_NUMBERS.filter((n) => p.marks[n] >= 3).length,
      })),
    };
  }
}

// ---------------------------------------------------------------------------
// Around the Clock: hit 1, 2, … 20 and finally the bull, in order. First to finish wins.
// ---------------------------------------------------------------------------

const CLOCK_TARGETS = [...Array.from({ length: 20 }, (_, i) => i + 1), 25];

class AroundTheClock extends ReversibleGame {
  constructor({ players, multiHit = false }) {
    super();
    this.id = nextId('clock');
    this.mode = 'atc';
    this.startedAt = Date.now();
    this.multiHit = !!multiHit; // double/treble of the target jump 2/3 numbers ahead
    this.players = players.map((p) => ({
      id: p.id,
      name: p.name,
      reached: 0, // how many targets are done (0..21)
      turnDarts: [],
      turnLog: [],
      dartsThrownTotal: 0,
    }));
    this.activePlayerIndex = 0;
    this.status = 'in_progress';
    this.winnerId = null;
    this.endedEarly = false;
    this._history = [];
  }

  throwDart(value, multiplier) {
    if (this.status !== 'in_progress') return;
    const player = this.activePlayer;
    if (player.turnDarts.length >= 3) return;
    this._pushHistory();

    const target = CLOCK_TARGETS[player.reached];
    let steps = 0;
    if (value === target) steps = this.multiHit && target !== 25 ? multiplier : 1;
    player.reached = Math.min(CLOCK_TARGETS.length, player.reached + steps);
    player.turnDarts.push({ label: formatDartLabel(value, multiplier), value, multiplier, hit: steps > 0, marks: steps, points: 0 });

    if (player.reached >= CLOCK_TARGETS.length) {
      this._closeVisit(player);
      this.winnerId = player.id;
      this.status = 'finished';
      return;
    }
    if (player.turnDarts.length === 3) this._endTurn(player);
  }

  _rank(p) {
    return p.reached;
  }

  static targetLabel(index) {
    return index >= CLOCK_TARGETS.length ? '✓' : CLOCK_TARGETS[index] === 25 ? 'Bull' : String(CLOCK_TARGETS[index]);
  }

  toJSON() {
    return {
      ...this._serialiseBase(),
      multiHit: this.multiHit,
      totalTargets: CLOCK_TARGETS.length,
      players: this.players.map((p) => ({
        ...p,
        displayScore: AroundTheClock.targetLabel(p.reached),
        darts: p.dartsThrownTotal + p.turnDarts.length,
      })),
    };
  }

  static fromJSON(data) {
    return ReversibleGame._restore(Object.create(AroundTheClock.prototype), data, ['displayScore', 'darts']);
  }

  toMatchRecord() {
    return {
      id: this.id,
      mode: 'atc',
      startedAt: this.startedAt,
      finishedAt: Date.now(),
      winnerId: this.winnerId,
      endedEarly: this.endedEarly,
      multiHit: this.multiHit,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        reached: p.reached,
        finished: p.reached >= CLOCK_TARGETS.length,
        dartsThrownTotal: p.dartsThrownTotal,
      })),
    };
  }
}

module.exports = { X01Match, PracticeSession, CricketMatch, AroundTheClock, CRICKET_NUMBERS, CLOCK_TARGETS, findCheckout, DART_CATALOGUE };
