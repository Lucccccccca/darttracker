'use strict';

// Standard dartboard sector order, clockwise starting at the top (12 o'clock).
const DARTBOARD_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

// Realistic proportions (desktop, mouse) …
const DARTBOARD_RADII = {
  bullIn: 12,
  bullOut: 32,
  tripleIn: 98,
  tripleOut: 116,
  doubleIn: 164,
  doubleOut: 180,
  label: 196,
};

// … and "fat" rings for fingers: doubles/trebles are ~1.8x wider so they can actually be hit
// on a phone. Numbers stay in the same order, so the board still reads as a real board.
const DARTBOARD_RADII_TOUCH = {
  bullIn: 16,
  bullOut: 40,
  tripleIn: 92,
  tripleOut: 124,
  doubleIn: 152,
  doubleOut: 182,
  label: 196,
};

function polarToXY(cx, cy, r, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function wedgePath(cx, cy, rInner, rOuter, startAngle, endAngle) {
  const [x1, y1] = polarToXY(cx, cy, rOuter, startAngle);
  const [x2, y2] = polarToXY(cx, cy, rOuter, endAngle);
  const [x3, y3] = polarToXY(cx, cy, rInner, endAngle);
  const [x4, y4] = polarToXY(cx, cy, rInner, startAngle);
  return `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 0 0 ${x4} ${y4} Z`;
}

/** Geometric hit test in board units (0..400). Returns {value, mult, label} or null outside. */
function hitTest(x, y, r) {
  const dx = x - 200;
  const dy = y - 200;
  const dist = Math.hypot(dx, dy);
  if (dist > r.doubleOut) return null;
  if (dist <= r.bullIn) return { value: 25, mult: 2, label: 'Bull' };
  if (dist <= r.bullOut) return { value: 25, mult: 1, label: '25' };
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI; // -180..180, 0 = right
  angle = (angle + 90 + 9 + 360) % 360; // 0 = start of the "20" sector at the top
  const idx = Math.floor(angle / 18) % 20;
  const value = DARTBOARD_ORDER[idx];
  let mult = 1;
  if (dist > r.tripleIn && dist <= r.tripleOut) mult = 3;
  else if (dist > r.doubleIn) mult = 2;
  const label = mult === 3 ? `T${value}` : mult === 2 ? `D${value}` : `S${value}`;
  return { value, mult, label };
}

function buildBoard(NS, r, size, showLabels) {
  const cx = size / 2;
  const cy = size / 2;
  const g = document.createElementNS(NS, 'g');

  const outerRim = document.createElementNS(NS, 'circle');
  outerRim.setAttribute('cx', cx);
  outerRim.setAttribute('cy', cy);
  outerRim.setAttribute('r', r.doubleOut + 6);
  outerRim.setAttribute('class', 'db-rim');
  g.appendChild(outerRim);

  DARTBOARD_ORDER.forEach((num, i) => {
    const start = -90 - 9 + i * 18;
    const end = start + 18;
    const parity = i % 2 === 0;
    const zones = [
      { rIn: r.bullOut, rOut: r.tripleIn, mult: 1, cls: parity ? 'db-single-a' : 'db-single-b' },
      { rIn: r.tripleIn, rOut: r.tripleOut, mult: 3, cls: parity ? 'db-triple-a' : 'db-triple-b' },
      { rIn: r.tripleOut, rOut: r.doubleIn, mult: 1, cls: parity ? 'db-single-a' : 'db-single-b' },
      { rIn: r.doubleIn, rOut: r.doubleOut, mult: 2, cls: parity ? 'db-double-a' : 'db-double-b' },
    ];
    zones.forEach((z) => {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', wedgePath(cx, cy, z.rIn, z.rOut, start, end));
      path.setAttribute('class', `db-zone ${z.cls}`);
      path.dataset.value = String(num);
      path.dataset.mult = String(z.mult);
      path.dataset.key = `${num}-${z.mult}-${z.rIn}`;
      g.appendChild(path);
    });
    if (showLabels) {
      const [lx, ly] = polarToXY(cx, cy, r.label, start + 9);
      const label = document.createElementNS(NS, 'text');
      label.setAttribute('x', lx);
      label.setAttribute('y', ly);
      label.setAttribute('class', 'db-label');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'middle');
      label.textContent = num;
      g.appendChild(label);
    }
  });

  const outerBull = document.createElementNS(NS, 'circle');
  outerBull.setAttribute('cx', cx);
  outerBull.setAttribute('cy', cy);
  outerBull.setAttribute('r', r.bullOut);
  outerBull.setAttribute('class', 'db-zone db-bull-outer');
  outerBull.dataset.value = '25';
  outerBull.dataset.mult = '1';
  g.appendChild(outerBull);

  const innerBull = document.createElementNS(NS, 'circle');
  innerBull.setAttribute('cx', cx);
  innerBull.setAttribute('cy', cy);
  innerBull.setAttribute('r', r.bullIn);
  innerBull.setAttribute('class', 'db-zone db-bull-inner');
  innerBull.dataset.value = '25';
  innerBull.dataset.mult = '2';
  g.appendChild(innerBull);

  return g;
}

/**
 * Builds an interactive dartboard SVG. Calls onThrow(value, multiplier) when a segment is hit.
 *
 * options.touch = true switches to "aim & release": the finger can be dragged around while a
 * magnifier above it shows exactly which field is under it; lifting the finger throws. Rings
 * are drawn wider in that mode. Default (false) is plain click, for a mouse.
 */
function createDartboardSVG(onThrow, options = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const size = 400;
  const touch = !!options.touch;
  const r = touch ? DARTBOARD_RADII_TOUCH : DARTBOARD_RADII;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'dartboard-svg' + (touch ? ' dartboard-touch' : ''));
  svg.appendChild(buildBoard(NS, r, size, true));

  const flash = (value, mult) => {
    const sel = `[data-value="${value}"][data-mult="${mult}"]`;
    svg.querySelectorAll(sel).forEach((el) => {
      el.classList.add('db-hit');
      setTimeout(() => el.classList.remove('db-hit'), 220);
    });
  };

  if (!touch) {
    svg.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.dataset && t.dataset.value != null) {
        onThrow(Number(t.dataset.value), Number(t.dataset.mult));
        flash(Number(t.dataset.value), Number(t.dataset.mult));
      }
    });
    return svg;
  }

  // ---- touch: aim with a magnifier, throw on release ----
  const wrap = document.createElement('div');
  wrap.className = 'db-aim-wrap';
  wrap.appendChild(svg);

  const lens = document.createElement('div');
  lens.className = 'db-lens';
  lens.hidden = true;
  const lensSvg = document.createElementNS(NS, 'svg');
  lensSvg.setAttribute('class', 'db-lens-svg');
  const LENS_ZOOM = 2.6;
  const LENS_VIEW = size / LENS_ZOOM; // board units visible in the lens
  lensSvg.setAttribute('viewBox', `0 0 ${LENS_VIEW} ${LENS_VIEW}`);
  const lensBoard = buildBoard(NS, r, size, true);
  lensSvg.appendChild(lensBoard);
  const cross = document.createElementNS(NS, 'g');
  cross.setAttribute('class', 'db-lens-cross');
  cross.innerHTML = `<circle r="7" fill="none" stroke="#fff" stroke-width="2.2"/><circle r="1.6" fill="#fff"/>`;
  lensSvg.appendChild(cross);
  const lensLabel = document.createElement('div');
  lensLabel.className = 'db-lens-label';
  lens.appendChild(lensSvg);
  lens.appendChild(lensLabel);
  wrap.appendChild(lens);

  let activePointer = null;
  let current = null;
  let currentKey = null;

  const toBoard = (clientX, clientY) => {
    const rect = svg.getBoundingClientRect();
    return [((clientX - rect.left) / rect.width) * size, ((clientY - rect.top) / rect.height) * size];
  };

  const highlight = (hit) => {
    const key = hit ? `${hit.value}-${hit.mult}` : null;
    if (key === currentKey) return;
    svg.querySelectorAll('.db-aim').forEach((el) => el.classList.remove('db-aim'));
    if (hit) svg.querySelectorAll(`[data-value="${hit.value}"][data-mult="${hit.mult}"]`).forEach((el) => el.classList.add('db-aim'));
    currentKey = key;
  };

  const update = (clientX, clientY) => {
    const [bx, by] = toBoard(clientX, clientY);
    current = hitTest(bx, by, r);
    highlight(current);

    // lens shows the board region around the finger, offset upwards so the finger doesn't cover it
    const rect = svg.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const px = clientX - wrapRect.left;
    const py = clientY - wrapRect.top;
    const lensSize = lens.offsetWidth || 150;
    let lx = px - lensSize / 2;
    let ly = py - lensSize - 28;
    if (ly < 0) ly = py + 40; // near the top edge: show below the finger instead
    lx = Math.max(0, Math.min(wrapRect.width - lensSize, lx));
    lens.style.transform = `translate(${lx}px, ${ly}px)`;

    const half = LENS_VIEW / 2;
    lensBoard.setAttribute('transform', `translate(${half - bx} ${half - by})`);
    cross.setAttribute('transform', `translate(${half} ${half})`);
    lensLabel.textContent = current ? current.label : 'daneben';
    lensLabel.classList.toggle('miss', !current);
    void rect;
  };

  svg.addEventListener('pointerdown', (e) => {
    if (activePointer !== null) return;
    activePointer = e.pointerId;
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* synthetic/unknown pointer: aiming still works */ }
    lens.hidden = false;
    update(e.clientX, e.clientY);
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointer) return;
    update(e.clientX, e.clientY);
    e.preventDefault();
  });
  const finish = (e, cancelled) => {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    lens.hidden = true;
    highlight(null);
    if (!cancelled) {
      if (current) {
        onThrow(current.value, current.mult);
        flash(current.value, current.mult);
      } else if (options.onMiss) {
        options.onMiss();
      }
    }
    current = null;
  };
  svg.addEventListener('pointerup', (e) => finish(e, false));
  svg.addEventListener('pointercancel', (e) => finish(e, true));
  svg.addEventListener('contextmenu', (e) => e.preventDefault());

  return wrap;
}

/** Read-only board coloured by how often each field was hit. counts: { 'mult x value': n }, e.g. '3x20'. */
function createHeatmapSVG(counts) {
  const NS = 'http://www.w3.org/2000/svg';
  const size = 400;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'heatmap-svg');
  const board = buildBoard(NS, DARTBOARD_RADII, size, true);
  svg.appendChild(board);
  const max = Math.max(1, ...Object.values(counts));
  board.querySelectorAll('.db-zone').forEach((zone) => {
    const value = Number(zone.dataset.value);
    const mult = Number(zone.dataset.mult);
    const n = counts[`${mult}x${value}`] || 0;
    zone.setAttribute('class', 'db-zone db-heat');
    zone.style.fill = n ? `rgba(255, 65, 54, ${(0.18 + 0.82 * Math.sqrt(n / max)).toFixed(2)})` : '#22252b';
    const tip = document.createElementNS(NS, 'title');
    const name = value === 25 ? (mult === 2 ? 'Bull' : '25') : `${mult === 3 ? 'T' : mult === 2 ? 'D' : 'S'}${value}`;
    tip.textContent = `${name} · ${n}×`;
    zone.appendChild(tip);
  });
  return svg;
}
