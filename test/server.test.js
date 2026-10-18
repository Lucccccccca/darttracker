'use strict';

// End-to-end tests: a real server with a temporary data folder, driven through socket.io like
// the PC screen and the phone do.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io } = require('socket.io-client');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'darttracker-server-'));
const mirrorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'darttracker-mirror-'));
process.env.DARTTRACKER_DATA_DIR = dir;
const { createServer } = require('../server/index');

let server;
let client;
let state;
const waitFor = async (check, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('timeout');
};
const ack = (event, ...args) => new Promise((resolve) => client.emit(event, ...args, resolve));
const send = async (event, payload) => {
  const before = state;
  client.emit(event, payload);
  await waitFor(() => state !== before);
};
const throwAll = async (list) => { for (const [value, multiplier] of list) await send('throw', { value, multiplier }); };

test.before(async () => {
  ({ server } = createServer());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  client = io(`http://127.0.0.1:${server.address().port}`, { transports: ['websocket'] });
  client.on('state', (s) => { state = s; });
  await waitFor(() => state);
});

test.after(() => {
  client.close();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(mirrorDir, { recursive: true, force: true });
});

test('new players get different fixed colours and can change them', async () => {
  const names = ['Anna', 'Ben', 'Cem'];
  for (const name of names) await ack('add_player', { name });
  await waitFor(() => state.players.length === 3);
  const colors = state.players.map((p) => p.color);
  assert.equal(new Set(colors).size, 3);
  const id = state.players[0].id;
  client.emit('set_player_color', { id, color: '#2ed3c6' });
  await waitFor(() => state.players[0].color === '#2ed3c6');
  client.emit('set_player_color', { id, color: 'javascript:alert(1)' });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(state.players[0].color, '#2ed3c6', 'only palette colours are accepted');
});

test('X01 with handicap through the socket', async () => {
  const [a, b] = state.players;
  await send('start_match', { mode: 'x01', playerIds: [a.id, b.id], startScore: 501, legsToWin: 1, setsToWin: 1, doubleOut: true, startScores: { [b.id]: 301 } });
  assert.equal(state.game.handicap, true);
  assert.deepEqual(state.game.players.map((p) => p.currentScore), [501, 301]);
  await send('abort_game');
});

test('every classic mode can be started, played, finished and ends up in the history', async () => {
  const [a, b] = state.players;
  const modes = ['shanghai', 'baseball', 'halveit', 'bobs27', 'golf', 'killer'];
  for (const mode of modes) {
    await send('start_match', { mode, playerIds: [a.id, b.id] });
    assert.equal(state.game.mode, mode);
    await throwAll([[20, 2], [1, 3], [5, 1]]);
    await send('end_match_early');
    assert.equal(state.game.status, 'finished');
    await send('finish_game');
    assert.equal(state.game, null);
  }
  const history = await ack('get_history');
  assert.deepEqual(history.matches.map((m) => m.mode), modes);
  for (const m of history.matches) assert.ok(m.players.every((p) => Array.isArray(p.turnLog)), `${m.mode} keeps its visit log`);
});

test('Killer needs two players', async () => {
  await send('start_match', { mode: 'shanghai', playerIds: [state.players[0].id] });
  assert.equal(state.game.mode, 'shanghai');
  const before = state;
  client.emit('start_match', { mode: 'killer', playerIds: [state.players[0].id] });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(state, before, 'no new state for an invalid start');
  assert.equal(state.game.mode, 'shanghai');
  await send('abort_game');
});

test('a running classic game survives in the autosave file and can be resumed', async () => {
  await send('start_match', { mode: 'halveit', playerIds: [state.players[0].id, state.players[1].id] });
  await throwAll([[15, 3]]);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'current-match.json'), 'utf8'));
  assert.equal(saved.mode, 'halveit');
  const { CLASSIC_MODES } = require('../server/modes');
  const restored = CLASSIC_MODES.halveit.fromJSON(saved);
  assert.equal(restored.players[0].score, 85);
  await send('abort_game');
});

test('the second backup folder receives a copy and can be removed again', async () => {
  const res = await ack('set_backup_dir', mirrorDir);
  assert.equal(res.ok, true, res.error);
  const copies = fs.readdirSync(mirrorDir).filter((f) => /^darttracker-\d{4}-\d{2}-\d{2}\.json$/.test(f));
  assert.equal(copies.length, 1);
  const info = await ack('get_data_info');
  assert.equal(info.extraBackupDir, path.resolve(mirrorDir));
  assert.equal(info.mirror.ok, true);

  const bad = await ack('set_backup_dir', path.join(dir, 'players.json', 'nope'));
  assert.equal(bad.ok, false);

  const cleared = await ack('set_backup_dir', '');
  assert.equal(cleared.ok, true);
  assert.equal((await ack('get_data_info')).extraBackupDir, null);
});
