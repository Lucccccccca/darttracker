'use strict';

const fs = require('fs');
const path = require('path');

// Packaged (installed) builds run from inside a read-only app.asar archive, so data can't live
// next to the source there. Electron's main process points this at a writable per-user folder
// before the server starts; plain `node server/index.js` (dev/standalone) falls back to ./data.
const DATA_DIR = process.env.DARTTRACKER_DATA_DIR || path.join(__dirname, '..', 'data');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const MATCHES_FILE = path.join(DATA_DIR, 'matches.json');
const PRACTICE_FILE = path.join(DATA_DIR, 'practice-sessions.json');
const CURRENT_MATCH_FILE = path.join(DATA_DIR, 'current-match.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  ensureDataDir();
  if (!fs.existsSync(file)) return fallback;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Konnte ${file} nicht lesen, verwende Fallback.`, err);
    // Keep the damaged file: the next save would otherwise overwrite it with an empty list.
    try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch (e) { /* ignore */ }
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDataDir();
  const tmpFile = `${file}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpFile, file);
}

// --- Players ---------------------------------------------------------------

function loadPlayers() {
  return readJson(PLAYERS_FILE, []);
}

function savePlayers(players) {
  writeJson(PLAYERS_FILE, players);
}

// --- Matches -----------------------------------------------------------------

function loadMatches() {
  return readJson(MATCHES_FILE, []);
}

function appendMatch(matchRecord) {
  const matches = loadMatches();
  matches.push(matchRecord);
  writeJson(MATCHES_FILE, matches);
}

function saveMatches(matches) {
  writeJson(MATCHES_FILE, matches);
}

function savePracticeSessions(sessions) {
  writeJson(PRACTICE_FILE, sessions);
}

// --- Practice sessions -------------------------------------------------------

function loadPracticeSessions() {
  return readJson(PRACTICE_FILE, []);
}

function appendPracticeSession(sessionRecord) {
  const sessions = loadPracticeSessions();
  sessions.push(sessionRecord);
  writeJson(PRACTICE_FILE, sessions);
}

// --- In-progress match autosave (crash recovery) ------------------------------

function saveCurrentMatch(matchJson) {
  writeJson(CURRENT_MATCH_FILE, matchJson);
}

function loadCurrentMatch() {
  return readJson(CURRENT_MATCH_FILE, null);
}

function clearCurrentMatch() {
  ensureDataDir();
  if (fs.existsSync(CURRENT_MATCH_FILE)) fs.unlinkSync(CURRENT_MATCH_FILE);
}

// --- Automatic backups -----------------------------------------------------------
// One file per day in the same format as the manual "Daten sichern" export, so any of them can
// be loaded again with "Sicherung laden". The last 7 days are kept.

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_RE = /^darttracker-\d{4}-\d{2}-\d{2}\.json$/;

function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter((f) => BACKUP_RE.test(f)).sort();
}

function pruneBackups(keep) {
  const all = listBackups();
  all.slice(0, Math.max(0, all.length - keep)).forEach((f) => {
    try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (e) { /* ignore */ }
  });
}

function autoBackup(keep = 7) {
  const players = loadPlayers();
  const matches = loadMatches();
  const sessions = loadPracticeSessions();
  const total = players.length + matches.length + sessions.length;
  if (total === 0) return null;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `darttracker-${todayStamp()}.json`);
  if (fs.existsSync(file)) {
    // Refresh today's backup only if it would not get smaller (a damaged data file must never
    // replace a good backup).
    try {
      const old = JSON.parse(fs.readFileSync(file, 'utf8'));
      const oldTotal = (old.players || []).length + (old.matches || []).length + (old.practiceSessions || []).length;
      if (oldTotal > total) { pruneBackups(keep); mirrorBackup(file, keep); return file; }
    } catch (e) { /* unreadable old backup: overwrite */ }
  }
  writeJson(file, { app: 'darttracker', exportedAt: Date.now(), players, matches, practiceSessions: sessions });
  pruneBackups(keep);
  mirrorBackup(file, keep);
  return file;
}

// --- Settings & second backup location ----------------------------------------------------
// A copy of every daily backup can go to another folder (USB stick, OneDrive, second disk), so a
// broken drive does not take the data and its backups with it.

function loadSettings() {
  return readJson(SETTINGS_FILE, {});
}

function saveSettings(settings) {
  writeJson(SETTINGS_FILE, settings);
}

let lastMirror = null; // { ok, at, error?, dir }

function backupTotal(file) {
  try {
    const b = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (b.players || []).length + (b.matches || []).length + (b.practiceSessions || []).length;
  } catch (e) {
    return -1;
  }
}

/** Copies today's backup into the chosen extra folder; never replaces a fuller copy with a smaller one. */
function mirrorBackup(localFile, keep = 7) {
  const dir = loadSettings().backupDir;
  if (!dir) { lastMirror = null; return null; }
  try {
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, path.basename(localFile));
    if (!fs.existsSync(target) || backupTotal(target) <= backupTotal(localFile)) fs.copyFileSync(localFile, target);
    const all = fs.readdirSync(dir).filter((f) => BACKUP_RE.test(f)).sort();
    all.slice(0, Math.max(0, all.length - keep)).forEach((f) => {
      try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* ignore */ }
    });
    lastMirror = { ok: true, at: Date.now(), dir };
  } catch (err) {
    lastMirror = { ok: false, at: Date.now(), dir, error: err.message };
  }
  return lastMirror;
}

/** Sets (or clears, with an empty value) the extra backup folder. Returns { ok, error? }. */
function setBackupDir(dir) {
  const settings = loadSettings();
  if (!dir) {
    delete settings.backupDir;
    saveSettings(settings);
    lastMirror = null;
    return { ok: true };
  }
  const resolved = path.resolve(String(dir));
  try {
    fs.mkdirSync(resolved, { recursive: true });
    const probe = path.join(resolved, '.darttracker-write-test');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  } catch (err) {
    return { ok: false, error: 'In diesen Ordner kann nicht geschrieben werden.' };
  }
  settings.backupDir = resolved;
  saveSettings(settings);
  const local = autoBackup();
  if (local) mirrorBackup(local);
  return { ok: true, dir: resolved };
}

function dataInfo() {
  return { dir: DATA_DIR, backupDir: BACKUP_DIR, backups: listBackups(), extraBackupDir: loadSettings().backupDir || null, mirror: lastMirror };
}

module.exports = {
  loadPlayers,
  savePlayers,
  loadMatches,
  appendMatch,
  saveMatches,
  loadPracticeSessions,
  appendPracticeSession,
  savePracticeSessions,
  saveCurrentMatch,
  loadCurrentMatch,
  clearCurrentMatch,
  autoBackup,
  dataInfo,
  loadSettings,
  setBackupDir,
};
