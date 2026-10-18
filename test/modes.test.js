'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { X01Match } = require('../server/gameEngine');
const { ShanghaiGame, BaseballGame, HalveItGame, Bobs27Game, GolfGame, KillerGame, CLASSIC_MODES } = require('../server/modes');

const P = (id) => ({ id, name: id.toUpperCase() });
const two = [P('a'), P('b')];
const throwAll = (g, darts) => darts.forEach(([v, m]) => g.throwDart(v, m));
const roundtrip = (g) => CLASSIC_MODES[g.mode].fromJSON(JSON.parse(JSON.stringify(g.toJSON())));

test('X01 handicap: every player starts on their own score', () => {
  const m = new X01Match({ players: two, startScore: 501, legsToWin: 1, setsToWin: 1, doubleOut: true, doubleIn: false, startScores: { b: 401 } });
  assert.equal(m.players[0].currentScore, 501);
  assert.equal(m.players[1].currentScore, 401);
  assert.equal(m.toJSON().handicap, true);
  const record = m.toMatchRecord();
  assert.equal(record.players[1].startScore, 401);
  assert.equal(record.handicap, true);
});

test('X01 handicap: a new leg resets to the personal start score', () => {
  const m = new X01Match({ players: two, startScore: 40, legsToWin: 2, setsToWin: 1, doubleOut: true, doubleIn: false, startScores: { b: 60 } });
  throwAll(m, [[20, 2]]); // a checks out 40
  assert.equal(m.status, 'leg_finished');
  m.continueAfterLeg();
  assert.deepEqual(m.players.map((p) => p.currentScore), [40, 60]);
});

test('Shanghai: single, double and treble of the target in one visit win at once', () => {
  const g = new ShanghaiGame({ players: two });
  throwAll(g, [[1, 1], [1, 2], [1, 3]]);
  assert.equal(g.status, 'finished');
  assert.equal(g.winnerId, 'a');
  assert.equal(g.players[0].turnLog[0].note, 'Shanghai!');
});

test('Shanghai: only the round number scores and the best total wins after 7 rounds', () => {
  const g = new ShanghaiGame({ players: two });
  throwAll(g, [[1, 3], [5, 1], [0, 1]]); // a: round 1 target 1 -> 3 points, the 5 is ignored
  assert.equal(g.players[0].score, 3);
  assert.equal(g.activePlayerIndex, 1);
  for (let i = 0; i < 13; i++) throwAll(g, [[0, 1], [0, 1], [0, 1]]);
  assert.equal(g.status, 'finished');
  assert.equal(g.winnerId, 'a');
});

test('Baseball: runs per hit, and a tie after the last inning goes to extra innings', () => {
  const g = new BaseballGame({ players: two });
  for (let r = 0; r < 9; r++) {
    for (const p of ['a', 'b']) {
      const target = r + 1;
      throwAll(g, [[target, 1], [0, 1], [0, 1]]);
    }
  }
  assert.equal(g.status, 'in_progress', 'tied 9:9 keeps playing');
  assert.equal(g.totalRounds, 10);
  throwAll(g, [[25, 2], [0, 1], [0, 1]]); // a scores 2 runs on the bull
  throwAll(g, [[0, 1], [0, 1], [0, 1]]);
  assert.equal(g.status, 'finished');
  assert.equal(g.winnerId, 'a');
});

test('Halve-It: a visit without a hit halves the score, hits add up', () => {
  const g = new HalveItGame({ players: two });
  assert.equal(g.players[0].score, 40);
  throwAll(g, [[0, 1], [0, 1], [0, 1]]); // target 15, no hit
  assert.equal(g.players[0].score, 20);
  assert.equal(g.players[0].turnLog[0].points, -20);
  throwAll(g, [[15, 3], [15, 1], [0, 1]]); // b: 40 + 45 + 15
  assert.equal(g.players[1].score, 100);
});

test('Halve-It: any double and any treble rounds', () => {
  const g = new HalveItGame({ players: [P('a')] });
  throwAll(g, [[15, 1], [0, 1], [0, 1]]); // 40 + 15
  throwAll(g, [[16, 1], [0, 1], [0, 1]]); // + 16 = 71
  throwAll(g, [[9, 2], [8, 2], [0, 1]]); // doubles: 18 + 16
  assert.equal(g.players[0].score, 105);
  throwAll(g, [[17, 1], [0, 1], [0, 1]]);
  throwAll(g, [[18, 1], [0, 1], [0, 1]]);
  throwAll(g, [[7, 3], [20, 1], [0, 1]]); // any treble: 21 only
  assert.equal(g.players[0].turnLog[5].points, 21);
});

test("Bob's 27: hits add double value, a miss subtracts it and below zero you are out", () => {
  const g = new Bobs27Game({ players: two });
  throwAll(g, [[1, 2], [0, 1], [1, 1]]); // a hits D1: 27 + 2
  assert.equal(g.players[0].score, 29);
  throwAll(g, [[0, 1], [0, 1], [0, 1]]); // b misses D1: 25
  assert.equal(g.players[1].score, 25);
  const solo = new Bobs27Game({ players: [P('a')] });
  for (let i = 0; i < 6; i++) throwAll(solo, [[0, 1], [0, 1], [0, 1]]);
  assert.equal(solo.players[0].out, true);
  assert.equal(solo.status, 'finished');
  assert.equal(solo.winnerId, null);
});

test('Golf: first dart on the hole ends it, treble 1 / double 2 / single 3 / miss 5, fewest wins', () => {
  const g = new GolfGame({ players: two });
  throwAll(g, [[1, 3]]); // a: hole 1 with a treble -> one dart only
  assert.equal(g.players[0].score, 1);
  assert.equal(g.players[0].turnDarts.length, 0);
  assert.equal(g.activePlayerIndex, 1);
  throwAll(g, [[0, 1], [0, 1], [0, 1]]); // b misses
  assert.equal(g.players[1].score, 5);
  for (let r = 1; r < 9; r++) { throwAll(g, [[r + 1, 1]]); throwAll(g, [[r + 1, 1]]); }
  assert.equal(g.status, 'finished');
  assert.equal(g.winnerId, 'a');
});

test('Killer: become a killer on your own double, then remove lives until one player is left', () => {
  const g = new KillerGame({ players: two, numbers: [20, 19] });
  throwAll(g, [[19, 2], [20, 2], [20, 2]]); // a: D19 does nothing yet, then D20 = killer
  assert.equal(g.players[0].killer, true);
  assert.equal(g.players[1].lives, 3);
  throwAll(g, [[0, 1], [0, 1], [0, 1]]); // b
  throwAll(g, [[19, 2], [19, 2], [19, 2]]); // a takes three lives
  assert.equal(g.players[1].out, true);
  assert.equal(g.status, 'finished');
  assert.equal(g.winnerId, 'a');
  assert.equal(g.toMatchRecord().players[0].kills, 3);
});

test('every classic mode survives save/restore and undo', () => {
  for (const mode of Object.keys(CLASSIC_MODES)) {
    const g = new CLASSIC_MODES[mode]({ players: two, numbers: [20, 19] });
    g.throwDart(20, 2);
    g.throwDart(1, 1);
    const copy = roundtrip(g);
    assert.equal(copy.mode, mode);
    assert.equal(copy.players[0].turnDarts.length, g.players[0].turnDarts.length, mode);
    copy.throwDart(5, 1);
    assert.doesNotThrow(() => copy.toJSON());
    assert.equal(copy.canUndo, true);
    copy.undoThrow();
    assert.equal(copy.players[0].turnDarts.length + copy.players[1].turnDarts.length, g.players[0].turnDarts.length + g.players[1].turnDarts.length, mode);
  }
});

test('ending a classic game early picks the leader, a tie is a draw', () => {
  const g = new ShanghaiGame({ players: two });
  throwAll(g, [[1, 1], [0, 1], [0, 1]]);
  g.endEarly();
  assert.equal(g.winnerId, 'a');
  const t = new ShanghaiGame({ players: two });
  t.endEarly();
  assert.equal(t.winnerId, null);
  assert.equal(g.toMatchRecord().players[0].turnLog.length, 1);
});
