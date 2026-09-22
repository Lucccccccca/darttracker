'use strict';

// Standard dartboard sector order, clockwise starting at the top (12 o'clock).
const DARTBOARD_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

const DARTBOARD_RADII = {
  bullIn: 12,
  bullOut: 32,
  tripleIn: 98,
  tripleOut: 116,
  doubleIn: 164,
  doubleOut: 180,
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

/**
 * Builds an interactive dartboard SVG. Calls onThrow(value, multiplier) when a segment is tapped.
 * Returns the SVG element (ready to append into the DOM).
 */
function createDartboardSVG(onThrow) {
  const NS = 'http://www.w3.org/2000/svg';
  const size = 400;
  const cx = size / 2;
  const cy = size / 2;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'dartboard-svg');

  const outerRim = document.createElementNS(NS, 'circle');
  outerRim.setAttribute('cx', cx);
  outerRim.setAttribute('cy', cy);
  outerRim.setAttribute('r', DARTBOARD_RADII.doubleOut + 6);
  outerRim.setAttribute('class', 'db-rim');
  svg.appendChild(outerRim);

  const r = DARTBOARD_RADII;

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
      svg.appendChild(path);
    });

    const [lx, ly] = polarToXY(cx, cy, r.label, start + 9);
    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', lx);
    label.setAttribute('y', ly);
    label.setAttribute('class', 'db-label');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'middle');
    label.textContent = num;
    svg.appendChild(label);
  });

  const outerBull = document.createElementNS(NS, 'circle');
  outerBull.setAttribute('cx', cx);
  outerBull.setAttribute('cy', cy);
  outerBull.setAttribute('r', r.bullOut);
  outerBull.setAttribute('class', 'db-zone db-bull-outer');
  outerBull.dataset.value = '25';
  outerBull.dataset.mult = '1';
  svg.appendChild(outerBull);

  const innerBull = document.createElementNS(NS, 'circle');
  innerBull.setAttribute('cx', cx);
  innerBull.setAttribute('cy', cy);
  innerBull.setAttribute('r', r.bullIn);
  innerBull.setAttribute('class', 'db-zone db-bull-inner');
  innerBull.dataset.value = '25';
  innerBull.dataset.mult = '2';
  svg.appendChild(innerBull);

  svg.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.value != null) {
      onThrow(Number(t.dataset.value), Number(t.dataset.mult));
      t.classList.add('db-hit');
      setTimeout(() => t.classList.remove('db-hit'), 180);
    }
  });

  return svg;
}
