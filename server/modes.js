'use strict';

// ---------------------------------------------------------------------------
// Classic pub-darts games: Shanghai, Baseball, Halve-It, Bob's 27, Golf and Killer.
//
// All of them build on ReversibleGame (snapshot undo, visit log with sequence numbers).
// Everything except Killer is "round based": every player throws one visit per round at a
// target that depends on the round, and the scoring rules differ per game. Those games share
// RoundGame and only describe their target, how a dart scores and what happens after a visit.
// ---------------------------------------------------------------------------

const { ReversibleGame, formatDartLabel, nextId } = require('./gameEngine');

const PLAYER_DERIVED = ['displayScore', 'darts', 'detail', 'caption', 'round'];

class RoundGame extends ReversibleGame {
  constructor({ mode, players, totalRounds, startScore = 0, title, unit, lowWins = false }) {
    super();
    this.id = nextId(mode);
    this.mode = mode;
    this.startedAt = Date.now();
    this.title = title;
    this.unit = unit;
    this.lowWins = lowWins;
    this.totalRounds = totalRounds;
    this.options = {};
    this.players = players.map((p) => ({
      id: p.id,
      name: p.name,
      score: startScore,
      out: false,
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

  // ---- hooks for the individual games ----
  target() { return 0; }
  targetLabelFor(t) { return String(t); }
  /** -> { hit, points }: points are added to the player's score right away. */
  scoreDart() { return { hit: false, points: 0 }; }
  endsVisit() { return false; }
  /** Called when a visit is over; may change the score and returns extra fields for the visit log. */
  afterVisit() { return {}; }
  _extend() { return false; }
  _rank(p) { return this.lowWins ? -p.score : p.score; }
  _display(p) { return String(p.score); }
  _detail(p) { return `${p.dartsThrownTotal + p.turnDarts.length} Darts`; }
  _caption(p) { return this.totalRounds ? `Runde ${Math.min(p.turnLog.length + 1, this.totalRounds)} / ${this.totalRounds}` : ''; }

  _roundOf(p) { return p.turnLog.length; }
  _isDone(p) { return p.out || p.turnLog.length >= this.totalRounds; }

  throwDart(value, multiplier) {
    if (this.status !== 'in_progress') return;
    const player = this.activePlayer;
    if (player.turnDarts.length >= 3) return;
    this._pushHistory();

    const target = this.target(this._roundOf(player));
    const r = this.scoreDart(player, target, value, multiplier);
    player.score += r.points;
    player.turnDarts.push({
      label: formatDartLabel(value, multiplier),
      value,
      multiplier,
      hit: r.hit,
      marks: r.hit ? 1 : 0,
      points: r.points,
    });
    if (this.endsVisit(r) || player.turnDarts.length === 3) this._finishVisit(player, target);
  }

  _finishVisit(player, target) {
    const extra = { target: this.targetLabelFor(target), ...(this.afterVisit(player, target) || {}) };
    this._closeVisit(player, extra);
    if (extra.win) {
      this.winnerId = player.id;
      this.status = 'finished';
      return;
    }
    this._advance();
  }

  _advance() {
    const n = this.players.length;
    if (this.players.every((p) => this._isDone(p))) {
      if (this._extend()) {
        this.activePlayerIndex = this.players.findIndex((p) => !this._isDone(p));
        return;
      }
      this.winnerId = this._pickWinner();
      this.status = 'finished';
      return;
    }
    for (let k = 1; k <= n; k++) {
      const j = (this.activePlayerIndex + k) % n;
      if (!this._isDone(this.players[j])) {
        this.activePlayerIndex = j;
        return;
      }
    }
  }

  /** Best score wins; a tie is a draw (no winner). Players that dropped out cannot win. */
  _pickWinner() {
    const ranked = this.players.filter((p) => !p.out).sort((a, b) => this._rank(b) - this._rank(a));
    if (!ranked.length) return null;
    if (ranked.length > 1 && this._rank(ranked[0]) === this._rank(ranked[1])) return null;
    return ranked[0].id;
  }

  endEarly() {
    if (this.status === 'finished') return;
    this._pushHistory();
    // a visit that is still open does not count
    this.winnerId = this._pickWinner();
    this.endedEarly = true;
    this.status = 'finished';
  }

  toJSON() {
    const active = this.activePlayer;
    return {
      ...this._serialiseBase(),
      title: this.title,
      unit: this.unit,
      lowWins: this.lowWins,
      options: this.options,
      totalRounds: this.totalRounds,
      roundNumber: Math.min(this._roundOf(active) + 1, this.totalRounds),
      targetLabel: this.status === 'in_progress' ? this.targetLabelFor(this.target(this._roundOf(active))) : '',
      players: this.players.map((p) => ({
        ...p,
        displayScore: this._display(p),
        darts: p.dartsThrownTotal + p.turnDarts.length,
        detail: this._detail(p),
        caption: this._caption(p),
        round: p.turnLog.length,
      })),
    };
  }

  toMatchRecord() {
    return {
      id: this.id,
      mode: this.mode,
      startedAt: this.startedAt,
      finishedAt: Date.now(),
      winnerId: this.winnerId,
      endedEarly: this.endedEarly,
      lowWins: this.lowWins,
      unit: this.unit,
      options: this.options,
      totalRounds: this.totalRounds,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        out: !!p.out,
        rounds: p.turnLog.length,
        dartsThrownTotal: p.dartsThrownTotal,
        turnLog: p.turnLog,
      })),
    };
  }

  static _fromJSON(Class, data) {
    return ReversibleGame._restore(Object.create(Class.prototype), data, PLAYER_DERIVED);
  }
}

// ---- Shanghai: round n = number n; only that number scores. S + D + T of it in one visit wins at once.
class ShanghaiGame extends RoundGame {
  constructor({ players, rounds = 7 }) {
    super({ mode: 'shanghai', players, totalRounds: Number(rounds) === 20 ? 20 : 7, title: 'Shanghai', unit: 'Punkte' });
    this.options = { rounds: this.totalRounds };
  }

  target(i) { return i + 1; }

  scoreDart(_p, t, value, multiplier) {
    const hit = value === t;
    return { hit, points: hit ? t * multiplier : 0 };
  }

  afterVisit(player, t) {
    const seen = new Set(player.turnDarts.filter((d) => d.value === t).map((d) => d.multiplier));
    if (seen.has(1) && seen.has(2) && seen.has(3)) return { win: true, note: 'Shanghai!' };
    return {};
  }

  static fromJSON(data) { return RoundGame._fromJSON(ShanghaiGame, data); }
}

// ---- Baseball: 9 innings, inning n = number n, single/double/treble = 1/2/3 runs. A tie goes to extra innings on the bull.
class BaseballGame extends RoundGame {
  constructor({ players, rounds = 9 }) {
    super({ mode: 'baseball', players, totalRounds: Number(rounds) === 6 ? 6 : 9, title: 'Baseball', unit: 'Runs' });
    this.baseRounds = this.totalRounds;
    this.options = { rounds: this.baseRounds };
  }

  target(i) { return i < this.baseRounds ? i + 1 : 25; }
  targetLabelFor(t) { return t === 25 ? 'Bull' : String(t); }

  scoreDart(_p, t, value, multiplier) {
    const hit = value === t;
    return { hit, points: hit ? multiplier : 0 };
  }

  _extend() {
    const ranked = this.players.slice().sort((a, b) => b.score - a.score);
    if (ranked.length < 2 || ranked[0].score !== ranked[1].score) return false;
    this.totalRounds += 1;
    return true;
  }

  _caption(p) {
    return p.turnLog.length >= this.baseRounds ? 'Verlängerung' : `Inning ${Math.min(p.turnLog.length + 1, this.baseRounds)} / ${this.baseRounds}`;
  }

  static fromJSON(data) { return RoundGame._fromJSON(BaseballGame, data); }
}

// ---- Halve-It: hit the round's target to add it up, miss with all three darts and the score is halved.
const HALVE_IT_ROUNDS = [15, 16, 'D', 17, 18, 'T', 19, 20, 'B'];

class HalveItGame extends RoundGame {
  constructor({ players }) {
    super({ mode: 'halveit', players, totalRounds: HALVE_IT_ROUNDS.length, startScore: 40, title: 'Halve-It', unit: 'Punkte' });
  }

  target(i) { return HALVE_IT_ROUNDS[i]; }
  targetLabelFor(t) { return t === 'D' ? 'Doppel' : t === 'T' ? 'Treble' : t === 'B' ? 'Bull' : String(t); }

  scoreDart(_p, t, value, multiplier) {
    if (typeof t === 'number') return value === t ? { hit: true, points: t * multiplier } : { hit: false, points: 0 };
    if (t === 'D') return value > 0 && multiplier === 2 ? { hit: true, points: value * 2 } : { hit: false, points: 0 };
    if (t === 'T') return value > 0 && multiplier === 3 ? { hit: true, points: value * 3 } : { hit: false, points: 0 };
    return value === 25 ? { hit: true, points: 25 * multiplier } : { hit: false, points: 0 };
  }

  afterVisit(player) {
    if (player.turnDarts.some((d) => d.hit)) return {};
    const before = player.score;
    player.score = Math.ceil(before / 2);
    return { points: player.score - before, note: 'Halbiert' };
  }

  static fromJSON(data) { return RoundGame._fromJSON(HalveItGame, data); }
}

// ---- Bob's 27: start on 27, throw at D1 … D20 and the bull. Hits add the double's value, a visit without a hit subtracts it. Below zero you are out.
class Bobs27Game extends RoundGame {
  constructor({ players }) {
    super({ mode: 'bobs27', players, totalRounds: 21, startScore: 27, title: "Bob's 27", unit: 'Punkte' });
  }

  target(i) { return i < 20 ? i + 1 : 25; }
  targetLabelFor(t) { return t === 25 ? 'Bull' : `D${t}`; }

  scoreDart(_p, t, value, multiplier) {
    const hit = value === t && multiplier === 2;
    return { hit, points: hit ? t * 2 : 0 };
  }

  afterVisit(player, t) {
    if (player.turnDarts.some((d) => d.hit)) return {};
    const penalty = t * 2;
    player.score -= penalty;
    if (player.score < 0) {
      player.out = true;
      return { points: -penalty, note: 'Raus' };
    }
    return { points: -penalty, note: 'Verfehlt' };
  }

  _rank(p) { return p.out ? -1e9 + p.score : p.score; }
  _detail(p) { return p.out ? 'ausgeschieden' : `${p.dartsThrownTotal + p.turnDarts.length} Darts`; }

  static fromJSON(data) { return RoundGame._fromJSON(Bobs27Game, data); }
}

// ---- Golf: hole n = number n. The first dart on the number ends the hole: treble 1, double 2, single 3 strokes, no hit in three darts 5. Fewest strokes win.
class GolfGame extends RoundGame {
  constructor({ players, rounds = 9 }) {
    super({ mode: 'golf', players, totalRounds: Number(rounds) === 18 ? 18 : 9, title: 'Golf', unit: 'Schläge', lowWins: true });
    this.options = { rounds: this.totalRounds };
  }

  target(i) { return i + 1; }
  targetLabelFor(t) { return String(t); }
  scoreDart(_p, t, value) { return { hit: value === t, points: 0 }; }
  endsVisit(r) { return r.hit; }

  afterVisit(player) {
    const hitDart = player.turnDarts.find((d) => d.hit);
    const strokes = hitDart ? { 3: 1, 2: 2, 1: 3 }[hitDart.multiplier] : 5;
    player.score += strokes;
    return { points: strokes, note: { 1: 'Eagle', 2: 'Birdie', 3: 'Par', 5: 'Verfehlt' }[strokes] };
  }

  _caption(p) { return `Loch ${Math.min(p.turnLog.length + 1, this.totalRounds)} / ${this.totalRounds}`; }

  static fromJSON(data) { return RoundGame._fromJSON(GolfGame, data); }
}

// ---------------------------------------------------------------------------
// Killer: everybody owns a number. Hit your own double to become a Killer, then take
// the lives (3 each) of the others by hitting their doubles. Last one standing wins.
// ---------------------------------------------------------------------------

class KillerGame extends ReversibleGame {
  constructor({ players, numbers }) {
    super();
    this.id = nextId('killer');
    this.mode = 'killer';
    this.startedAt = Date.now();
    this.title = 'Killer';
    this.unit = 'Treffer';
    const pool = Array.from({ length: 20 }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.players = players.map((p, i) => ({
      id: p.id,
      name: p.name,
      number: numbers && numbers[i] ? numbers[i] : pool[i],
      lives: 3,
      killer: false,
      out: false,
      kills: 0,
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

    let marks = 0;
    let points = 0;
    let note = '';
    if (value > 0 && multiplier === 2) {
      if (!player.killer && value === player.number) {
        player.killer = true;
        marks = 1;
        note = 'Killer!';
      } else if (player.killer) {
        const victim = this.players.find((o) => o !== player && !o.out && o.number === value);
        if (victim) {
          victim.lives -= 1;
          player.kills += 1;
          marks = 1;
          points = 1;
          note = `-1 ${victim.name}`;
          if (victim.lives <= 0) {
            victim.out = true;
            note += ' (raus)';
          }
        }
      }
    }
    player.turnDarts.push({ label: formatDartLabel(value, multiplier), value, multiplier, marks, points, note });

    const alive = this.players.filter((o) => !o.out);
    if (alive.length === 1) {
      this._closeVisit(player, { note: this._visitNote(player) });
      this.winnerId = alive[0].id;
      this.status = 'finished';
      return;
    }
    if (player.turnDarts.length === 3) this._endTurn(player);
  }

  _visitNote(player) {
    return player.turnDarts.map((d) => d.note).filter(Boolean).join(' · ');
  }

  _endTurn(player) {
    this._closeVisit(player, { note: this._visitNote(player) });
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const j = (this.activePlayerIndex + k) % n;
      if (!this.players[j].out) {
        this.activePlayerIndex = j;
        return;
      }
    }
  }

  _rank(p) { return p.out ? -1 : p.lives * 100 + p.kills; }

  _targets(player) {
    if (!player.killer) return `Eigene Doppel treffen: D${player.number}`;
    const victims = this.players.filter((o) => o !== player && !o.out).map((o) => `D${o.number} (${o.name})`);
    return `Killer! Ziele: ${victims.join(', ')}`;
  }

  toJSON() {
    const active = this.activePlayer;
    return {
      ...this._serialiseBase(),
      title: this.title,
      unit: this.unit,
      roundNumber: active.turnLog.length + 1,
      targetLabel: this.status === 'in_progress' ? this._targets(active) : '',
      players: this.players.map((p) => ({
        ...p,
        displayScore: p.out ? 'RAUS' : String(p.lives),
        darts: p.dartsThrownTotal + p.turnDarts.length,
        detail: `Nr. ${p.number}`,
        caption: p.out ? 'ausgeschieden' : p.killer ? `Killer · ${p.kills} Treffer` : 'noch kein Killer',
        round: p.turnLog.length,
      })),
    };
  }

  static fromJSON(data) {
    return ReversibleGame._restore(Object.create(KillerGame.prototype), data, PLAYER_DERIVED);
  }

  toMatchRecord() {
    return {
      id: this.id,
      mode: 'killer',
      startedAt: this.startedAt,
      finishedAt: Date.now(),
      winnerId: this.winnerId,
      endedEarly: this.endedEarly,
      unit: this.unit,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        score: p.kills,
        number: p.number,
        lives: p.lives,
        kills: p.kills,
        out: p.out,
        rounds: p.turnLog.length,
        dartsThrownTotal: p.dartsThrownTotal,
        turnLog: p.turnLog,
      })),
    };
  }
}

/** mode key -> class, for the modes in this file */
const CLASSIC_MODES = {
  shanghai: ShanghaiGame,
  baseball: BaseballGame,
  halveit: HalveItGame,
  bobs27: Bobs27Game,
  golf: GolfGame,
  killer: KillerGame,
};

module.exports = { CLASSIC_MODES, ShanghaiGame, BaseballGame, HalveItGame, Bobs27Game, GolfGame, KillerGame, HALVE_IT_ROUNDS };
