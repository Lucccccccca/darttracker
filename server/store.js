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
};
