'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// store.js reads its data folder when it is first loaded, so point it at a temp folder first.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'darttracker-store-'));
process.env.DARTTRACKER_DATA_DIR = dir;
const store = require('../server/store');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('daily backup is written in the export format and never shrinks', () => {
  store.savePlayers([{ id: 'p1', name: 'A' }]);
  store.appendMatch({ id: 'm1', mode: 'x01', players: [] });
  const file = store.autoBackup();
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(backup.app, 'darttracker');
  assert.equal(backup.matches.length, 1);

  store.saveMatches([]); // simulate lost data
  store.autoBackup();
  const again = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(again.matches.length, 1, 'a smaller state must not replace a good backup');
});

test('only the newest 7 daily backups are kept', () => {
  const backups = path.join(dir, 'backups');
  for (let i = 1; i <= 9; i++) fs.writeFileSync(path.join(backups, `darttracker-2020-01-0${i}.json`), '{}');
  store.autoBackup();
  assert.equal(store.dataInfo().backups.length, 7);
});

test('a damaged data file is kept aside instead of being overwritten', () => {
  fs.writeFileSync(path.join(dir, 'players.json'), '{broken');
  const origError = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(store.loadPlayers(), []);
  } finally {
    console.error = origError;
  }
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('players.json.corrupt-')));
});
