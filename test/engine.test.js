'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { X01Match, CricketMatch, AroundTheClock, findCheckout } = require('../server/gameEngine');

const P = (id) => ({ id, name: id.toUpperCase() });
const x01 = (over = {}) => new X01Match({ players: [P('a'), P('b')], startScore: 101, legsToWin: 1, setsToWin: 1, doubleOut: true, doubleIn: false, ...over });

test('X01: a bust voids the whole visit, not just the last dart', () => {
  const m = x01({ startScore: 19, doubleOut: false });
  m.throwDart(5, 1);
  m.throwDart(15, 1); // 19-5-15 < 0
  assert.equal(m.players[0].currentScore, 19);
  assert.equal(m.activePlayerIndex, 1);
  assert.equal(m.players[0].turnLog[0].bust, true);
});

test('X01: double-out rules (no finish on a single, no leaving 1)', () => {
  const m = x01({ startScore: 20 });
  m.throwDart(20, 1); // would finish on a single -> bust
  assert.equal(m.players[0].currentScore, 20);
  assert.equal(m.status, 'in_progress');
  const n = x01({ startScore: 41 });
  n.throwDart(20, 2); // leaves 1 -> bust
  assert.equal(n.players[0].currentScore, 41);
});

test('X01: checkout wins the leg and the match', () => {
  const m = x01({ startScore: 40 });
  m.throwDart(20, 2);
  assert.equal(m.status, 'finished');
  assert.equal(m.winnerId, 'a');
});

test('X01: undo restores across turn change, bust and checkout', () => {
  const m = x01({ startScore: 301, legsToWin: 2 });
  m.throwDart(20, 3); m.throwDart(20, 3); m.throwDart(20, 3);
  assert.equal(m.activePlayerIndex, 1);
  m.undoThrow();
  assert.equal(m.activePlayerIndex, 0);
  assert.equal(m.players[0].currentScore, 301 - 120);
  assert.equal(m.players[0].turnDarts.length, 2);
});

test('X01: ending early scores the standing, a tie is a draw', () => {
  const m = x01({ legsToWin: 3 });
  m.endEarly();
  assert.equal(m.status, 'finished');
  assert.equal(m.winnerId, null);
});

test('checkout finder knows 170 and rejects impossible finishes', () => {
  assert.equal(findCheckout(170, 3, true).possible, true);
  assert.equal(findCheckout(169, 3, true).possible, false);
  assert.equal(findCheckout(1, 3, true).possible, false);
});

test('Cricket: three marks close a number, extra marks score only while an opponent is open', () => {
  const m = new CricketMatch({ players: [P('a'), P('b')] });
  m.throwDart(20, 3); // closes 20
  assert.equal(m.players[0].marks[20], 3);
  assert.equal(m.players[0].score, 0);
  m.throwDart(20, 1); // extra mark, B still open -> 20 points
  assert.equal(m.players[0].score, 20);
  m.throwDart(20, 2); // two more marks -> 40 more
  assert.equal(m.players[0].score, 60);
  assert.equal(m.activePlayerIndex, 1);
});

test('Cricket: no points once everyone closed the number; non-cricket numbers do nothing', () => {
  const m = new CricketMatch({ players: [P('a'), P('b')] });
  m.throwDart(19, 3); m.throwDart(5, 1); m.throwDart(0, 1);   // A closes 19
  m.throwDart(19, 3); m.throwDart(0, 1); m.throwDart(0, 1);   // B closes 19
  m.throwDart(19, 3);                                          // A: closed by both -> no points
  assert.equal(m.players[0].score, 0);
  assert.equal(m.players[0].marks[19], 3);
});

test('Cricket: bull counts 1 or 2 marks (never 3) and scores 25 per extra mark', () => {
  const m = new CricketMatch({ players: [P('a'), P('b')] });
  m.throwDart(25, 2); m.throwDart(25, 1);          // 3 marks -> closed, no points yet
  assert.equal(m.players[0].marks[25], 3);
  m.throwDart(25, 2);                              // 2 extra marks -> 50
  assert.equal(m.players[0].score, 50);
});

test('Cricket: winning needs everything closed AND at least the top score', () => {
  const m = new CricketMatch({ players: [P('a'), P('b')] });
  m.players[0].marks = { 20: 3, 19: 3, 18: 3, 17: 3, 16: 3, 15: 3, 25: 2 };
  m.players[1].score = 30;
  m.throwDart(25, 1); // closes everything but A has 0 < 30
  assert.equal(m.status, 'in_progress');
  m.throwDart(20, 3); // 3 extra marks on 20 -> 60 points, now ahead
  assert.equal(m.status, 'finished');
  assert.equal(m.winnerId, 'a');
});

test('Cricket: undo takes back the winning dart and survives JSON round-trip', () => {
  const m = new CricketMatch({ players: [P('a'), P('b')] });
  m.players[0].marks = { 20: 3, 19: 3, 18: 3, 17: 3, 16: 3, 15: 3, 25: 2 };
  m.throwDart(25, 1);
  assert.equal(m.status, 'finished');
  m.undoThrow();
  assert.equal(m.status, 'in_progress');
  assert.equal(m.players[0].marks[25], 2);
  const copy = CricketMatch.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));
  assert.equal(copy.players[0].marks[25], 2);
  assert.equal(typeof copy.throwDart, 'function');
});

test('Around the Clock: targets in order, one step per hit, bull last', () => {
  const m = new AroundTheClock({ players: [P('a'), P('b')] });
  m.throwDart(2, 1);  // target is 1 -> miss
  assert.equal(m.players[0].reached, 0);
  m.throwDart(1, 3);  // hit (treble counts one step by default)
  assert.equal(m.players[0].reached, 1);
  m.throwDart(2, 1);  // next target 2 -> hit
  assert.equal(m.players[0].reached, 2);
  assert.equal(m.activePlayerIndex, 1);
});

test('Around the Clock: multi-hit variant jumps and the bull finishes the game', () => {
  const m = new AroundTheClock({ players: [P('a'), P('b')], multiHit: true });
  m.throwDart(1, 3);
  assert.equal(m.players[0].reached, 3);
  m.players[0].reached = 20; // only the bull left
  m.throwDart(0, 1);
  m.throwDart(25, 2);
  assert.equal(m.status, 'finished');
  assert.equal(m.winnerId, 'a');
});

test('Around the Clock: ending early ranks by progress', () => {
  const m = new AroundTheClock({ players: [P('a'), P('b')] });
  m.players[1].reached = 7;
  m.endEarly();
  assert.equal(m.winnerId, 'b');
});
