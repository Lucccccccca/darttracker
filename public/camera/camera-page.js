'use strict';

// Phone-as-camera: the old phone films the board, detects darts locally (camera.js) and only
// sends the recognised throws to the PC over the socket – no cables, no video streaming.

const socket = io();
const STORAGE_KEY = 'darttracker-phone-camera';
const video = document.getElementById('cam-video');
const canvas = document.getElementById('cam-canvas');
const stage = document.getElementById('cam-stage');
let stream = null;
let calibrating = false;
let calibPoints = [];
let auto = true;
let pending = null;
let lastTurnCount = 0;
let wakeLock = null;

function loadSettings() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || {}; } catch (e) { return {}; } }
function saveSettings(patch) { const n = { ...loadSettings(), ...patch }; try { localStorage.setItem(STORAGE_KEY, JSON.stringify(n)); } catch (e) { /* ignore */ } return n; }
function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ } }

const statusEl = document.getElementById('cam-status');
const detector = new CameraDetector({
  onStatus: (text) => { statusEl.textContent = text; statusEl.classList.remove('detected'); },
  onFrame: () => draw(),
  onDetect: (hit) => {
    statusEl.textContent = `Erkannt: ${hit.label}`;
    statusEl.classList.add('detected');
    buzz(30);
    if (auto) {
      socket.emit('throw', { value: hit.value, multiplier: hit.mult });
    } else {
      pending = hit;
      document.getElementById('cam-last-label').textContent = hit.label;
      document.getElementById('cam-last').hidden = false;
    }
  },
});

function draw() {
  const w = canvas.width = canvas.clientWidth || 320;
  const h = canvas.height = canvas.clientHeight || 240;
  const ctx = canvas.getContext('2d');
  if (calibrating) {
    ctx.clearRect(0, 0, w, h);
    if (calibPoints.length === 4) {
      const probe = new CameraDetector({ onDetect: () => {} });
      probe.setCalibration({ points: calibPoints, position: document.getElementById('cam-position').value });
      probe.drawOverlay(ctx, w, h);
    }
    calibPoints.forEach(([nx, ny], i) => {
      ctx.fillStyle = '#ffb020';
      ctx.beginPath(); ctx.arc(nx * w, ny * h, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px Manrope, sans-serif';
      ctx.fillText(String(i + 1), nx * w + 11, ny * h - 10);
    });
  } else {
    detector.drawOverlay(ctx, w, h);
  }
}

function secureContextCheck() {
  const ok = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && (window.isSecureContext || location.hostname === 'localhost');
  if (!ok) {
    document.getElementById('cam-insecure').hidden = false;
    document.getElementById('cam-origin').textContent = location.origin;
  }
  return ok;
}

async function startCamera() {
  if (!secureContextCheck()) { statusEl.textContent = 'Kamera-Zugriff gesperrt – siehe Hinweis oben'; return; }
  try {
    const s = loadSettings();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await new Promise((resolve) => { video.onloadedmetadata = resolve; setTimeout(resolve, 1500); });
    detector.setSource(video);
    detector.setCalibration(s.calibration ? { ...s.calibration, position: s.position, sensitivity: s.sensitivity } : null);
    detector.start();
    document.getElementById('cam-start').textContent = 'Kamera stoppen';
    document.getElementById('cam-start').classList.remove('btn-primary');
    if (!detector.isCalibrated) detector.setStatus('Bitte „Scheibe einrichten“ antippen');
    try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* not available */ }
  } catch (err) {
    statusEl.textContent = 'Keine Kamera: ' + (err && err.message ? err.message : err);
    if (!window.isSecureContext) { document.getElementById('cam-insecure').hidden = false; document.getElementById('cam-origin').textContent = location.origin; }
  }
}

function stopCamera() {
  detector.stop();
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  document.getElementById('cam-start').textContent = 'Kamera starten';
  document.getElementById('cam-start').classList.add('btn-primary');
  statusEl.textContent = 'Kamera aus';
}

document.getElementById('cam-start').addEventListener('click', () => (detector.running ? stopCamera() : startCamera()));
document.getElementById('cam-empty').addEventListener('click', () => {
  if (!detector.running) { statusEl.textContent = 'Bitte zuerst die Kamera starten.'; return; }
  detector.markEmpty();
  buzz(15);
});

// ---- calibration: tap the four wires on the double ring ----
function setCalibrating(on) {
  calibrating = on;
  stage.classList.toggle('calibrating', on);
  document.getElementById('cam-calib-done').hidden = !on;
  document.getElementById('cam-calib-reset').hidden = !on;
  document.getElementById('cam-calibrate').hidden = on;
  document.getElementById('cam-empty').hidden = on;
  updateInstruction();
  draw();
}
function updateInstruction() {
  const el = document.getElementById('cam-instruction');
  if (!calibrating) { el.textContent = ''; return; }
  el.textContent = calibPoints.length < 4
    ? `Punkt ${calibPoints.length + 1}/4: ${CALIB_POINTS[calibPoints.length].label}`
    : 'Gitter passt? Dann „Einrichtung fertig“.';
  document.getElementById('cam-calib-done').disabled = calibPoints.length !== 4;
}
document.getElementById('cam-calibrate').addEventListener('click', () => {
  if (!detector.running) { statusEl.textContent = 'Bitte zuerst die Kamera starten.'; return; }
  const s = loadSettings();
  calibPoints = s.calibration && s.calibration.points ? s.calibration.points.slice() : [];
  setCalibrating(true);
});
stage.addEventListener('click', (e) => {
  if (!calibrating || calibPoints.length >= 4) return;
  const r = canvas.getBoundingClientRect();
  calibPoints.push([(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]);
  buzz(10);
  updateInstruction();
  draw();
});
document.getElementById('cam-calib-reset').addEventListener('click', () => { calibPoints = []; updateInstruction(); draw(); });
document.getElementById('cam-calib-done').addEventListener('click', () => {
  if (calibPoints.length !== 4) return;
  const position = document.getElementById('cam-position').value;
  const s = saveSettings({ calibration: { points: calibPoints }, position });
  detector.setCalibration({ points: calibPoints, position, sensitivity: s.sensitivity });
  setCalibrating(false);
  detector.setStatus('Eingerichtet – jetzt bei leerer Scheibe „Scheibe ist leer“');
});

// ---- options ----
(function initOptions() {
  const s = loadSettings();
  if (s.position) document.getElementById('cam-position').value = s.position;
  if (typeof s.sensitivity === 'number') {
    document.getElementById('cam-sens').value = s.sensitivity;
    document.getElementById('cam-sens-label').textContent = s.sensitivity;
    detector.sensitivity = s.sensitivity;
  }
})();
document.getElementById('cam-position').addEventListener('change', (e) => {
  saveSettings({ position: e.target.value });
  detector.position = e.target.value;
  draw();
});
document.getElementById('cam-sens').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  detector.sensitivity = v;
  document.getElementById('cam-sens-label').textContent = v;
  saveSettings({ sensitivity: v });
});
document.getElementById('cam-auto').addEventListener('change', (e) => { auto = e.target.checked; document.getElementById('cam-last').hidden = true; });
document.getElementById('cam-accept').addEventListener('click', () => {
  if (!pending) return;
  socket.emit('throw', { value: pending.value, multiplier: pending.mult });
  pending = null;
  document.getElementById('cam-last').hidden = true;
});

// ---- game sync: pause without a game, wait for the board to be cleared after each visit ----
socket.on('state', (data) => {
  const g = data.game;
  if (!detector.running) return;
  if (!g || g.mode !== 'x01') { detector.setPaused(true); return; }
  detector.setPaused(g.status !== 'in_progress');
  const turns = g.players.reduce((s, p) => s + p.turnLog.length, 0);
  if (turns !== lastTurnCount) {
    lastTurnCount = turns;
    if (turns > 0) detector.notifyVisitEnded();
  }
});

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && detector.running && navigator.wakeLock && !wakeLock) {
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ }
  }
});

secureContextCheck();
