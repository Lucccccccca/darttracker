'use strict';

// ---------------------------------------------------------------------------
// Single-webcam dart detection.
//
// Idea: the board is static, so a new dart is simply "what changed" between the last
// settled frame and the current one. The changed blob's tip (the end away from the
// camera) is mapped onto the board with a homography that the user sets up by clicking
// four known points on the double ring. No ML, no OpenCV – plain pixel maths.
// ---------------------------------------------------------------------------

const BOARD_MM = { bullIn: 6.35, bullOut: 15.9, tripleIn: 99, tripleOut: 107, doubleIn: 162, doubleOut: 170 };
// Wire boundaries on the outer edge of the double ring – crisp, easy to click.
// Angles follow dartboard.js: 0° = right, clockwise (image coordinates).
const CALIB_POINTS = [
  { angle: -81, label: 'Draht zwischen 20 und 1 (oben), am äußeren Rand des Doppelrings' },
  { angle: 9, label: 'Draht zwischen 6 und 10 (rechts), außen am Doppelring' },
  { angle: 99, label: 'Draht zwischen 3 und 19 (unten), außen am Doppelring' },
  { angle: 189, label: 'Draht zwischen 11 und 14 (links), außen am Doppelring' },
];

function calibBoardPoint(i) {
  const a = (CALIB_POINTS[i].angle * Math.PI) / 180;
  return [BOARD_MM.doubleOut * Math.cos(a), BOARD_MM.doubleOut * Math.sin(a)];
}

/** Homography src(4×[x,y]) → dst(4×[u,v]) via DLT, Gaussian elimination on the 8×8 system. */
function solveHomography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    if (Math.abs(A[c][c]) < 1e-12) return null;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
}

function applyH(H, x, y) {
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w];
}

/** Board coordinates in mm (centre 0,0) → segment. null = outside the board. */
function segmentAtMm(x, y) {
  const dist = Math.hypot(x, y);
  if (dist > BOARD_MM.doubleOut) return null;
  if (dist <= BOARD_MM.bullIn) return { value: 25, mult: 2, label: 'Bull' };
  if (dist <= BOARD_MM.bullOut) return { value: 25, mult: 1, label: '25' };
  let angle = (Math.atan2(y, x) * 180) / Math.PI;
  angle = (angle + 90 + 9 + 360) % 360;
  const value = DARTBOARD_ORDER[Math.floor(angle / 18) % 20];
  let mult = 1;
  if (dist > BOARD_MM.tripleIn && dist <= BOARD_MM.tripleOut) mult = 3;
  else if (dist > BOARD_MM.doubleIn) mult = 2;
  return { value, mult, label: mult === 3 ? `T${value}` : mult === 2 ? `D${value}` : `S${value}` };
}

class CameraDetector {
  constructor({ onDetect, onStatus, onFrame }) {
    this.onDetect = onDetect;
    this.onStatus = onStatus || (() => {});
    this.onFrame = onFrame || (() => {});
    this.source = null;          // <video> or <canvas>
    this.procW = 320;
    this.procH = 240;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.timer = null;
    this.running = false;
    this.paused = false;

    this.calibration = null;     // { points: 4×[nx,ny] normalised image coords, position }
    this.H = null;               // image(normalised) → board mm
    this.Hinv = null;            // board mm → image(normalised)
    this.position = 'oben';      // where the camera sits relative to the board
    this.sensitivity = 5;        // 1 (träge) … 10 (empfindlich)

    this.prev = null;
    this.emptyRef = null;
    this.currentRef = null;
    this.stable = 0;
    this.state = 'idle';         // idle | ready | motion | waitClear
    this.dartsSinceClear = 0;
    this.lastTip = null;
    this.lastHit = null;
  }

  // ---- setup ----------------------------------------------------------------

  setSource(el) {
    this.source = el;
    const w = el.videoWidth || el.width || 640;
    const h = el.videoHeight || el.height || 480;
    this.procH = Math.max(120, Math.round((this.procW * h) / w));
    this.canvas.width = this.procW;
    this.canvas.height = this.procH;
    this.prev = null;
    this.stable = 0;
  }

  setCalibration(calib) {
    this.calibration = calib || null;
    if (calib && calib.points && calib.points.length === 4) {
      const board = [0, 1, 2, 3].map(calibBoardPoint);
      this.H = solveHomography(calib.points, board);
      this.Hinv = solveHomography(board, calib.points);
      this.position = calib.position || 'oben';
      if (typeof calib.sensitivity === 'number') this.sensitivity = calib.sensitivity;
    } else {
      this.H = null;
      this.Hinv = null;
    }
  }

  get isCalibrated() { return !!this.H; }

  start() {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.tick(), 130);
    this.setStatus(this.emptyRef ? 'Bereit – wirf!' : 'Leere Scheibe als Referenz setzen');
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Call when no darts are in the board: becomes the "clean" reference. */
  markEmpty() {
    const f = this.grab();
    if (!f) return;
    this.emptyRef = f;
    this.currentRef = f;
    this.prev = f;
    this.dartsSinceClear = 0;
    this.state = 'ready';
    this.setStatus('Bereit – wirf!');
  }

  /** Game hook: after a visit ends every dart has to leave the board before we continue. */
  notifyVisitEnded() {
    if (this.dartsSinceClear > 0 && this.state !== 'waitClear') {
      this.state = 'waitClear';
      this.setStatus('Aufnahme fertig – bitte Darts aus der Scheibe ziehen');
    }
  }

  setPaused(p) {
    this.paused = p;
    if (p) this.setStatus('Pausiert (kein laufendes Spiel)');
  }

  setStatus(text) {
    this.status = text;
    this.onStatus(text, this.state);
  }

  // ---- frame maths ------------------------------------------------------------

  grab() {
    if (!this.source) return null;
    try {
      this.ctx.drawImage(this.source, 0, 0, this.procW, this.procH);
    } catch (e) { return null; }
    const { data } = this.ctx.getImageData(0, 0, this.procW, this.procH);
    const n = this.procW * this.procH;
    const g = new Uint8ClampedArray(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (data[j] * 77 + data[j + 1] * 151 + data[j + 2] * 28) >> 8;
    return g;
  }

  meanAbsDiff(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i += 3) s += Math.abs(a[i] - b[i]);
    return s / (a.length / 3);
  }

  /** Binary change mask with the global brightness drift removed (auto-exposure, lamps). */
  diffMask(a, b) {
    const n = a.length;
    let drift = 0;
    for (let i = 0; i < n; i += 7) drift += a[i] - b[i];
    drift = drift / Math.ceil(n / 7);
    const threshold = 18 + (10 - this.sensitivity) * 4; // 22 (empfindlich) … 58 (träge)
    const mask = new Uint8Array(n);
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (Math.abs(a[i] - b[i] - drift) > threshold) { mask[i] = 1; count++; }
    }
    return { mask, count };
  }

  /** Morphological closing: a dart crossing a dark wire loses a row or two of pixels there,
   *  which would split the tip off into its own tiny blob. Bridge gaps up to ~4 px. */
  closeMask(mask) {
    const w = this.procW;
    const n = mask.length;
    const grow = (src) => {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        if (!src[i]) continue;
        const x = i % w;
        out[i] = 1;
        if (x > 0) out[i - 1] = 1;
        if (x < w - 1) out[i + 1] = 1;
        if (i >= w) out[i - w] = 1;
        if (i + w < n) out[i + w] = 1;
      }
      return out;
    };
    return grow(grow(mask));
  }

  /** Connectivity comes from the gap-bridged mask, but extents/tips only from real changed
   *  pixels – otherwise the bridging would fatten the dart and shift its tip. */
  largestBlob(rawMask) {
    const mask = this.closeMask(rawMask);
    const w = this.procW;
    const h = this.procH;
    const seen = new Uint8Array(mask.length);
    let best = null;
    const stack = new Int32Array(mask.length);
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || seen[start]) continue;
      let sp = 0;
      stack[sp++] = start;
      seen[start] = 1;
      let count = 0;
      let minX = w, maxX = -1, minY = h, maxY = -1, sx = 0, sy = 0;
      let tipMinX = null, tipMaxX = null, tipMinY = null, tipMaxY = null;
      while (sp > 0) {
        const idx = stack[--sp];
        const x = idx % w;
        const y = (idx - x) / w;
        if (rawMask[idx]) {
          count++; sx += x; sy += y;
          if (x < minX) { minX = x; tipMinX = [x, y]; }
          if (x > maxX) { maxX = x; tipMaxX = [x, y]; }
          if (y < minY) { minY = y; tipMinY = [x, y]; }
          if (y > maxY) { maxY = y; tipMaxY = [x, y]; }
        }
        if (x > 0 && mask[idx - 1] && !seen[idx - 1]) { seen[idx - 1] = 1; stack[sp++] = idx - 1; }
        if (x < w - 1 && mask[idx + 1] && !seen[idx + 1]) { seen[idx + 1] = 1; stack[sp++] = idx + 1; }
        if (y > 0 && mask[idx - w] && !seen[idx - w]) { seen[idx - w] = 1; stack[sp++] = idx - w; }
        if (y < h - 1 && mask[idx + w] && !seen[idx + w]) { seen[idx + w] = 1; stack[sp++] = idx + w; }
      }
      if (!best || count > best.count) best = { count, minX, maxX, minY, maxY, cx: sx / count, cy: sy / count, tipMinX, tipMaxX, tipMinY, tipMaxY };
    }
    return best;
  }

  tipOf(blob) {
    switch (this.position) {
      case 'unten': return blob.tipMinY;
      case 'links': return blob.tipMaxX;
      case 'rechts': return blob.tipMinX;
      default: return blob.tipMaxY; // Kamera oben: Spitze ist der unterste Punkt
    }
  }

  imageToBoard(px, py) {
    return applyH(this.H, px / this.procW, py / this.procH);
  }

  // ---- main loop --------------------------------------------------------------

  tick() {
    if (!this.running || !this.source) return;
    const frame = this.grab();
    if (!frame) return;
    this.onFrame();
    if (!this.prev) { this.prev = frame; return; }

    const motion = this.meanAbsDiff(frame, this.prev);
    this.prev = frame;
    if (motion > 6) {
      this.stable = 0;
      if (this.state === 'ready') this.setStatus('Bewegung …');
      return;
    }
    this.stable++;
    if (this.stable < 3) return;
    if (!this.emptyRef || !this.H || this.paused) return;

    const vsEmpty = this.diffMask(frame, this.emptyRef);
    // "Clear" = nothing dart-sized differs from the empty board. A plain pixel count would
    // let a single dart slip under the limit and get absorbed into the reference.
    const boardClear = vsEmpty.count < frame.length * 0.02 && (vsEmpty.count === 0 || this.largestBlob(vsEmpty.mask).count < 14);

    if (this.state === 'waitClear') {
      if (boardClear) {
        this.emptyRef = frame;      // refresh: lighting may have drifted
        this.currentRef = frame;
        this.dartsSinceClear = 0;
        this.state = 'ready';
        this.setStatus('Bereit – wirf!');
      }
      return;
    }

    const vsRef = this.diffMask(frame, this.currentRef);
    if (vsRef.count < frame.length * 0.0006) {
      if (this.state !== 'ready') { this.state = 'ready'; this.setStatus('Bereit – wirf!'); }
      return;
    }

    // Darts pulled out while we were in 'ready' (e.g. after a bust): board matches "empty" again.
    if (this.dartsSinceClear > 0 && boardClear) {
      this.currentRef = frame;
      this.emptyRef = frame;
      this.dartsSinceClear = 0;
      this.state = 'ready';
      this.setStatus('Scheibe leer – bereit');
      return;
    }

    const blob = this.largestBlob(vsRef.mask);
    if (!blob || blob.count < 14) return;
    if (blob.count > frame.length * 0.12) {
      // way too big for a dart: a hand, a person, the lights – wait for it to go away
      this.setStatus('Zu viel Veränderung im Bild – kurz warten');
      return;
    }

    const tip = this.tipOf(blob);
    const [bx, by] = this.imageToBoard(tip[0], tip[1]);
    const hit = segmentAtMm(bx, by);
    const dist = Math.hypot(bx, by);
    if (!hit && dist > BOARD_MM.doubleOut * 1.5) {
      // change far outside the board (someone walked through the background) – accept as new baseline
      this.currentRef = frame;
      return;
    }

    this.currentRef = frame;
    this.dartsSinceClear++;
    this.lastTip = tip;
    this.lastHit = hit || { value: 0, mult: 1, label: 'Fehler' };
    this.state = 'ready';
    this.setStatus(`Erkannt: ${this.lastHit.label}`);
    this.onDetect(this.lastHit, { tip, board: [bx, by] });
  }

  // ---- overlay drawing (projected board + last tip) ------------------------------

  drawOverlay(ctx, width, height) {
    ctx.clearRect(0, 0, width, height);
    if (!this.Hinv) return;
    const toPx = (mmx, mmy) => { const [nx, ny] = applyH(this.Hinv, mmx, mmy); return [nx * width, ny * height]; };
    ctx.lineWidth = 1.5;
    for (const r of [BOARD_MM.doubleOut, BOARD_MM.doubleIn, BOARD_MM.tripleOut, BOARD_MM.tripleIn, BOARD_MM.bullOut]) {
      ctx.beginPath();
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const [x, y] = toPx(r * Math.cos(a), r * Math.sin(a));
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = r === BOARD_MM.doubleOut ? 'rgba(255,65,54,0.95)' : 'rgba(255,255,255,0.55)';
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 20; i++) {
      const a = ((-99 + i * 18) * Math.PI) / 180;
      const [x1, y1] = toPx(BOARD_MM.bullOut * Math.cos(a), BOARD_MM.bullOut * Math.sin(a));
      const [x2, y2] = toPx(BOARD_MM.doubleOut * Math.cos(a), BOARD_MM.doubleOut * Math.sin(a));
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    if (this.lastTip) {
      const x = (this.lastTip[0] / this.procW) * width;
      const y = (this.lastTip[1] / this.procH) * height;
      ctx.strokeStyle = '#ffb020';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 14, y); ctx.lineTo(x + 14, y); ctx.moveTo(x, y - 14); ctx.lineTo(x, y + 14); ctx.stroke();
    }
  }
}
