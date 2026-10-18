'use strict';

// Camera detection on the desktop: stream, calibration and hand-over of detected darts.
// (Classic script: all files in public/js share one global scope; see the script tags in index.html.)

// ---------------------------------------------------------------------------
// Camera detection (single webcam)
// ---------------------------------------------------------------------------

const CAMERA_STORAGE_KEY = 'darttracker-camera';
let cameraStream = null;
let cameraAuto = true;
let pendingDetection = null;
const cameraVideo = document.getElementById('camera-video');
const cameraOverlay = document.getElementById('camera-overlay');

function loadCameraSettings() {
  try { return JSON.parse(localStorage.getItem(CAMERA_STORAGE_KEY) || 'null') || {}; } catch (e) { return {}; }
}
function saveCameraSettings(patch) {
  const next = { ...loadCameraSettings(), ...patch };
  try { localStorage.setItem(CAMERA_STORAGE_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
  return next;
}

function setCameraPill(text, cls) {
  const pill = document.getElementById('camera-pill');
  pill.hidden = !cameraDetector.running;
  pill.className = 'camera-pill' + (cls ? ` ${cls}` : '');
  document.getElementById('camera-pill-text').textContent = text;
}

const cameraDetector = new CameraDetector({
  onStatus: (text, state) => {
    document.getElementById('camera-status').textContent = text;
    setCameraPill(`Kamera: ${text}`, state === 'waitClear' || state === 'motion' ? 'busy' : '');
  },
  onFrame: () => {
    if (cameraOverlay.width !== cameraOverlay.clientWidth || cameraOverlay.height !== cameraOverlay.clientHeight) {
      cameraOverlay.width = cameraOverlay.clientWidth || 320;
      cameraOverlay.height = cameraOverlay.clientHeight || 240;
    }
    cameraDetector.drawOverlay(cameraOverlay.getContext('2d'), cameraOverlay.width, cameraOverlay.height);
  },
  onDetect: (hit) => {
    setCameraPill(`Kamera: ${hit.label} erkannt`, 'detected');
    if (cameraAuto) {
      socket.emit('throw', { value: hit.value, multiplier: hit.mult });
    } else {
      pendingDetection = hit;
      document.getElementById('camera-last-label').textContent = hit.label;
      document.getElementById('camera-last').hidden = false;
    }
  },
});

async function openCameraStream(deviceId) {
  if (cameraStream) cameraStream.getTracks().forEach((t) => t.stop());
  const constraints = { video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
  cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
  return cameraStream;
}

async function startCamera() {
  const btn = document.getElementById('camera-start');
  try {
    const settings = loadCameraSettings();
    const stream = await openCameraStream(settings.deviceId);
    cameraVideo.srcObject = stream;
    await new Promise((resolve) => { cameraVideo.onloadedmetadata = resolve; setTimeout(resolve, 1500); });
    cameraDetector.setSource(cameraVideo);
    cameraDetector.setCalibration(settings.calibration ? { ...settings.calibration, position: settings.position, sensitivity: settings.sensitivity } : null);
    if (typeof settings.sensitivity === 'number') {
      document.getElementById('camera-sens').value = settings.sensitivity;
      document.getElementById('camera-sens-label').textContent = settings.sensitivity;
    }
    cameraDetector.start();
    btn.textContent = 'Kamera stoppen';
    btn.classList.remove('btn-primary');
    if (!cameraDetector.isCalibrated) cameraDetector.setStatus('Bitte zuerst „Scheibe einrichten“');
    setCameraPill('Kamera läuft', '');
  } catch (err) {
    cameraDetector.setStatus('Keine Kamera: ' + (err && err.message ? err.message : err));
    alert('Kamera konnte nicht gestartet werden: ' + (err && err.message ? err.message : err) + '\n\nIst eine Webcam angeschlossen und in den Windows-Datenschutzeinstellungen für Desktop-Apps freigegeben?');
  }
}

function stopCamera() {
  cameraDetector.stop();
  if (cameraStream) cameraStream.getTracks().forEach((t) => t.stop());
  cameraStream = null;
  cameraVideo.srcObject = null;
  const btn = document.getElementById('camera-start');
  btn.textContent = 'Kamera starten';
  btn.classList.add('btn-primary');
  document.getElementById('camera-status').textContent = 'Kamera aus';
  document.getElementById('camera-pill').hidden = true;
}

document.getElementById('camera-start').addEventListener('click', () => {
  if (cameraDetector.running) stopCamera(); else startCamera();
});
document.getElementById('camera-mark-empty').addEventListener('click', () => {
  if (!cameraDetector.running) { alert('Bitte zuerst die Kamera starten.'); return; }
  cameraDetector.markEmpty();
});
document.getElementById('camera-sens').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  cameraDetector.sensitivity = v;
  document.getElementById('camera-sens-label').textContent = v;
  saveCameraSettings({ sensitivity: v });
});
document.getElementById('camera-auto').addEventListener('change', (e) => {
  cameraAuto = e.target.checked;
  document.getElementById('camera-last').hidden = true;
});
document.getElementById('camera-accept').addEventListener('click', () => {
  if (!pendingDetection) return;
  socket.emit('throw', { value: pendingDetection.value, multiplier: pendingDetection.mult });
  pendingDetection = null;
  document.getElementById('camera-last').hidden = true;
});

// Tell the detector when a visit is over (3 darts, bust or checkout) so it waits for the board to be cleared.
let cameraLastTurnCount = 0;
function cameraNotifyGame(g) {
  if (!cameraDetector.running) return;
  if (!g || g.mode === 'practice') { cameraDetector.setPaused(true); return; }
  cameraDetector.setPaused(g.status !== 'in_progress');
  const turns = g.players.reduce((s, p) => s + p.turnLog.length, 0);
  if (turns !== cameraLastTurnCount) {
    cameraLastTurnCount = turns;
    if (turns > 0) cameraDetector.notifyVisitEnded();
  }
}

// ---- calibration modal ----
let calibPoints = [];
let calibStream = null;
const calibVideo = document.getElementById('calib-video');
const calibCanvas = document.getElementById('calib-canvas');

function drawCalib() {
  const w = calibCanvas.width = calibCanvas.clientWidth || 640;
  const h = calibCanvas.height = calibCanvas.clientHeight || 480;
  const ctx = calibCanvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (calibPoints.length === 4) {
    const probe = new CameraDetector({ onDetect: () => {} });
    probe.setCalibration({ points: calibPoints, position: document.getElementById('calib-position').value });
    probe.drawOverlay(ctx, w, h);
  }
  calibPoints.forEach(([nx, ny], i) => {
    const x = nx * w, y = ny * h;
    ctx.fillStyle = '#ffb020';
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Manrope, sans-serif';
    ctx.fillText(String(i + 1), x + 9, y - 9);
  });
  const instr = document.getElementById('calib-instruction');
  instr.textContent = calibPoints.length < 4
    ? `Punkt ${calibPoints.length + 1} von 4: ${CALIB_POINTS[calibPoints.length].label}`
    : 'Passt das rote Gitter auf die Scheibe? Dann „Fertig“ – sonst Punkte zurücksetzen.';
  document.getElementById('calib-done').disabled = calibPoints.length !== 4;
}

async function openCalibration() {
  const overlay = document.getElementById('overlay-calibrate');
  overlay.hidden = false;
  const settings = loadCameraSettings();
  calibPoints = settings.calibration && settings.calibration.points ? settings.calibration.points.slice() : [];
  document.getElementById('calib-position').value = settings.position || 'oben';
  try {
    if (cameraStream) cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
    calibStream = await navigator.mediaDevices.getUserMedia({ video: settings.deviceId ? { deviceId: { exact: settings.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    calibVideo.srcObject = calibStream;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const sel = document.getElementById('calib-device');
    sel.innerHTML = devices.map((d, i) => `<option value="${d.deviceId}">${escapeHtml(d.label || `Kamera ${i + 1}`)}</option>`).join('');
    const current = calibStream.getVideoTracks()[0].getSettings().deviceId;
    if (current) sel.value = current;
  } catch (err) {
    document.getElementById('calib-instruction').textContent = 'Keine Kamera gefunden: ' + (err && err.message ? err.message : err);
  }
  drawCalib();
}

function closeCalibration() {
  document.getElementById('overlay-calibrate').hidden = true;
  if (calibStream) calibStream.getTracks().forEach((t) => t.stop());
  calibStream = null;
  calibVideo.srcObject = null;
  if (cameraDetector.running) startCamera();
}

document.getElementById('camera-calibrate').addEventListener('click', openCalibration);
document.getElementById('calib-cancel').addEventListener('click', closeCalibration);
document.getElementById('calib-reset').addEventListener('click', () => { calibPoints = []; drawCalib(); });
document.getElementById('calib-stage').addEventListener('click', (e) => {
  if (calibPoints.length >= 4) return;
  const rect = calibCanvas.getBoundingClientRect();
  calibPoints.push([(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height]);
  drawCalib();
});
document.getElementById('calib-position').addEventListener('change', drawCalib);
document.getElementById('calib-device').addEventListener('change', async (e) => {
  saveCameraSettings({ deviceId: e.target.value });
  if (calibStream) calibStream.getTracks().forEach((t) => t.stop());
  calibStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: e.target.value }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  calibVideo.srcObject = calibStream;
  calibPoints = [];
  drawCalib();
});
document.getElementById('calib-done').addEventListener('click', () => {
  if (calibPoints.length !== 4) return;
  saveCameraSettings({ calibration: { points: calibPoints }, position: document.getElementById('calib-position').value });
  closeCalibration();
});
