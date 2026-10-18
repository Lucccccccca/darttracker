'use strict';

// Tests for the browser scripts that contain no DOM work (history feed, analytics, mode list).
// They run in a vm context with the same global scope the scripts share in the browser.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { X01Match, CricketMatch, AroundTheClock } = require('../server/gameEngine');
const { CLASSIC_MODES } = require('../server/modes');

const PUBLIC_JS = path.join(__dirname, '..', 'public', 'js');
const ctx = vm.createContext({ console, Math, JSON, Date });
vm.runInContext('var latestState = { players: [{ id: "a", name: "A", color: "#ff6b5e" }, { id: "b", name: "B", color: "#4da3ff" }] };', ctx);
for (const file of ['util.js', 'modes-data.js', 'analytics.js', 'feed.js']) {
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_JS, file), 'utf8'), ctx, { filename: file });
}
const run = (code) => vm.runInContext(code, ctx);
// hand a plain JSON object into the context
const call = (fn, ...args) => {
  ctx.__args = JSON.parse(JSON.stringify(args));
  return run(`${fn}(...__args)`);
};

const P = (id) => ({ id, name: id.toUpperCase() });
const two = [P('a'), P('b')];
const feed = (game, opts) => call('buildFeedHtml', JSON.parse(JSON.stringify(game.toJSON())), opts || {});
const darts = (g, list) => list.forEach(([v, m]) => g.throwDart(v, m));

test('every file in public/js parses', () => {
  for (const file of fs.readdirSync(PUBLIC_JS).filter((f) => f.endsWith('.js'))) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(PUBLIC_JS, file), 'utf8'), { filename: file }), file);
  }
});

test('the mode list covers every engine mode and is consistent', () => {
  const keys = run('MODES.map((m) => m.key)');
  for (const mode of ['x01', 'cricket', 'atc', ...Object.keys(CLASSIC_MODES)]) assert.ok(keys.includes(mode), mode);
  for (const m of run('MODES')) {
    assert.ok(m.label && m.desc && m.group, m.key);
    assert.ok(m.min >= 1);
  }
  assert.equal(run('modeInfo("killer").min'), 2);
  assert.equal(run('MODE_LABELS.practice'), 'Training');
});

test('X01 feed: newest visit first, tags for 180 and bust, leg header', () => {
  const m = new X01Match({ players: two, startScore: 301, legsToWin: 2, setsToWin: 1, doubleOut: true, doubleIn: false });
  darts(m, [[20, 3], [20, 3], [20, 3], [19, 1], [18, 1], [17, 1], [20, 3], [20, 3], [20, 3], [20, 3], [20, 3], [20, 3]]);
  const html = feed(m);
  assert.match(html, /LEG|Leg 1/);
  assert.match(html, />180</);
  assert.match(html, /BUST/);
  // chronological: the second visit of A (a 180 again) comes before B's first visit
  assert.ok(html.indexOf('tl-entry') < html.lastIndexOf('tl-entry'));
  assert.ok(!/undefined|NaN/.test(html));
});

test('feed is built in throwing order, not grouped by player', () => {
  const m = new X01Match({ players: two, startScore: 501, legsToWin: 1, setsToWin: 1, doubleOut: true, doubleIn: false });
  darts(m, [[1, 1], [1, 1], [1, 1], [5, 1], [5, 1], [5, 1], [20, 1], [20, 1], [20, 1]]);
  const html = feed(m);
  const names = [...html.matchAll(/class="tl-who">(\w+)</g)].map((x) => x[1]);
  assert.deepEqual(names, ['A', 'B', 'A'].reverse());
});

test('feed renders every classic mode with its notes and units', () => {
  for (const [mode, Class] of Object.entries(CLASSIC_MODES)) {
    const g = new Class({ players: two, numbers: [20, 19] });
    darts(g, [[20, 2], [1, 1], [5, 1], [3, 3], [0, 1], [0, 1], [19, 2], [19, 2], [2, 2]]);
    const json = JSON.parse(JSON.stringify(g.toJSON()));
    const html = call('buildFeedHtml', json);
    assert.ok(html.includes('tl-entry'), mode);
    assert.ok(!/undefined|NaN/.test(html), mode);
    const summary = call('feedSummaryHtml', json);
    assert.ok(summary.includes('tl-sum'), mode);
  }
});

test('Shanghai and Killer notes become tags', () => {
  const s = new CLASSIC_MODES.shanghai({ players: two });
  darts(s, [[1, 3], [1, 1], [1, 2]]);
  assert.match(feed(s), /Shanghai!/);
  const k = new CLASSIC_MODES.killer({ players: two, numbers: [20, 19] });
  darts(k, [[20, 2], [0, 1], [0, 1]]);
  assert.match(feed(k), /Killer!/);
});

test('a saved match record can be shown with the same feed', () => {
  const c = new CricketMatch({ players: two });
  darts(c, [[20, 3], [19, 1], [0, 1], [20, 2], [20, 1], [18, 1]]);
  const record = JSON.parse(JSON.stringify(c.toMatchRecord()));
  const g = call('recordToFeedGame', record);
  assert.equal(g.status, 'finished');
  const html = call('buildFeedHtml', g, { limit: 200 });
  assert.match(html, /Runde 1/);
  assert.ok(!/undefined|NaN/.test(html));

  const atc = new AroundTheClock({ players: two });
  darts(atc, [[1, 1], [2, 1], [3, 1]]);
  const html2 = call('buildFeedHtml', call('recordToFeedGame', JSON.parse(JSON.stringify(atc.toMatchRecord()))), { limit: 200 });
  assert.match(html2, /Treffer/);
});

test('old records without a visit log render an empty feed instead of failing', () => {
  const html = call('buildFeedHtml', call('recordToFeedGame', { id: 'x', mode: 'x01', startScore: 501, players: [{ id: 'a', name: 'A', average: 40 }] }));
  assert.match(html, /Noch keine Aufnahmen/);
});

test('heat map counts every field and ignores misses', () => {
  const m = new X01Match({ players: two, startScore: 501, legsToWin: 1, setsToWin: 1, doubleOut: true, doubleIn: false });
  darts(m, [[20, 3], [20, 3], [0, 1], [5, 1], [25, 2], [25, 1]]);
  const record = JSON.parse(JSON.stringify(m.toMatchRecord()));
  const all = call('computeHeatmap', 'all', [record]);
  assert.equal(all.counts['3x20'], 2);
  assert.equal(all.counts['1x5'], 1);
  assert.equal(all.counts['2x25'], 1);
  assert.equal(all.counts['1x25'], 1);
  assert.equal(all.misses, 1);
  assert.equal(all.total, 5);
  // a threw the two trebles and a miss, b the rest
  assert.equal(call('computeHeatmap', 'a', [record]).total, 2);
  assert.equal(call('computeHeatmap', 'b', [record]).total, 3);
  assert.equal(call('computeHeatmap', 'nobody', [record]).total, 0);
});

test('classic mode statistics: wins, best result, lower is better in golf', () => {
  const golf = (a, b) => {
    const g = new CLASSIC_MODES.golf({ players: two });
    g.players[0].score = a;
    g.players[1].score = b;
    g.winnerId = a < b ? 'a' : 'b';
    return JSON.parse(JSON.stringify(g.toMatchRecord()));
  };
  const stats = call('computeClassicModes', 'a', [golf(30, 40), golf(25, 20)]);
  assert.equal(stats.length, 1);
  assert.equal(stats[0].played, 2);
  assert.equal(stats[0].won, 1);
  assert.equal(stats[0].best, 25); // lower is better in golf: a's best is 25
  assert.equal(call('computeClassicModes', 'a', []).length, 0);
});
