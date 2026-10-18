'use strict';

// Show mode effects: sounds, big flashes, confetti, frame-rate based effect level, leg and match overlays.
// (Classic script: all files in public/js share one global scope; see the script tags in index.html.)

function renderDartSlots(darts, animateLast = false) {
  let html = '';
  for (let i = 0; i < 3; i++) {
    const d = darts[i];
    if (!d) { html += '<div class="dart-slot"></div>'; continue; }
    const isLast = i === darts.length - 1;
    html += `<div class="dart-slot filled${d.bust ? ' bust' : ''}${animateLast && isLast ? ' dart-in' : ''}">${d.label}</div>`;
  }
  return html;
}

/** Show-mode announcements for the notes of the classic modes. */
function flashForNote(note, name) {
  if (/Shanghai/.test(note)) { showBigFlash('Shanghai!', 'gold', name); playSound('max'); }
  else if (/Killer!/.test(note)) { showBigFlash('Killer!', 'orange', name); playSound('ton'); }
  else if (/raus/i.test(note)) { showBigFlash('Raus', 'red', name); playSound('bust'); }
  else if (/^-1 /.test(note)) { showBigFlash(note, 'red', name); playSound('treble'); }
  else if (/Eagle/.test(note)) { showBigFlash('Eagle!', 'green', name); playSound('ton'); }
  else if (/Birdie/.test(note)) showBigFlash('Birdie', 'green', name);
  else if (/Halbiert/.test(note)) { showBigFlash('Halbiert', 'red', name); playSound('bust'); }
}

function showBigFlash(text, colorClass, sub) {
  const el = document.createElement('div');
  el.className = `big-flash ${colorClass}`;
  el.innerHTML = `<div>${escapeHtml(text)}${sub ? `<span class="bf-sub">${escapeHtml(sub)}</span>` : ''}</div>`;
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
  // Fallback: with reduced-motion (no animation → no animationend) or a hidden tab the flash
  // would otherwise stay on screen forever.
  setTimeout(() => el.remove(), 1800);
}

function showDartFly(dart) {
  document.querySelectorAll('.dart-fly').forEach((e) => e.remove());
  const el = document.createElement('div');
  const kind = dart.value === 25 ? 'bull' : dart.multiplier === 3 ? 'triple' : dart.multiplier === 2 ? 'double' : 'single';
  el.className = `dart-fly ${kind}`;
  el.textContent = dart.bust ? `${dart.label} ✕` : dart.label;
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
  setTimeout(() => el.remove(), 1200);
}

// ---- Sounds: synthesized with WebAudio, so no audio files are needed. Only in show mode. ----
let audioCtx = null;
let soundEnabled = true;
try { soundEnabled = localStorage.getItem('darttracker-sound') !== 'off'; } catch (e) { /* ignore */ }

function audio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function tone(ctx, { freq, start, dur, type = 'sine', gain = 0.25, slideTo }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, ctx.currentTime + start);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + start + dur);
  g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.05);
}

function playSound(name) {
  if (!soundEnabled || !document.body.classList.contains('tv-mode')) return;
  const ctx = audio();
  if (!ctx) return;
  switch (name) {
    case 'dart': tone(ctx, { freq: 170, start: 0, dur: 0.09, type: 'triangle', gain: 0.35, slideTo: 60 }); break;
    case 'treble': tone(ctx, { freq: 170, start: 0, dur: 0.09, type: 'triangle', gain: 0.35, slideTo: 60 }); tone(ctx, { freq: 880, start: 0.03, dur: 0.12, gain: 0.12 }); break;
    case 'bust': tone(ctx, { freq: 220, start: 0, dur: 0.35, type: 'sawtooth', gain: 0.18, slideTo: 70 }); break;
    case 'ton': [523, 659, 784].forEach((f, i) => tone(ctx, { freq: f, start: i * 0.09, dur: 0.22, gain: 0.18 })); break;
    case 'max': [523, 659, 784, 1047, 1319].forEach((f, i) => tone(ctx, { freq: f, start: i * 0.08, dur: 0.3, type: 'square', gain: 0.12 })); break;
    case 'checkout': [392, 523, 659, 784].forEach((f, i) => tone(ctx, { freq: f, start: i * 0.11, dur: 0.4, gain: 0.2 })); tone(ctx, { freq: 1047, start: 0.46, dur: 0.7, gain: 0.2 }); break;
    case 'win': [392, 523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(ctx, { freq: f, start: i * 0.12, dur: 0.35, gain: 0.2 })); tone(ctx, { freq: 1568, start: 0.98, dur: 1.1, gain: 0.22 }); break;
    default: break;
  }
}

// ---- Effects level: 'auto' measures real frame rate in show mode, 'lite'/'full' force it ----
let fxPref = 'auto';
try { fxPref = localStorage.getItem('darttracker-fx') || 'auto'; } catch (e) { /* ignore */ }
let fxMeasureToken = 0;

function isLite() { return document.body.classList.contains('lite'); }

function renderFxButton() {
  const label = fxPref === 'lite' ? 'Effekte: Sparsam' : fxPref === 'full' ? 'Effekte: Voll' : (isLite() ? 'Effekte: Auto (sparsam)' : 'Effekte: Auto');
  document.getElementById('btn-fx').textContent = label;
}

/** Average fps and share of slow frames while the stage animations run. null if the tab is hidden. */
function measureFps(durationMs) {
  return new Promise((resolve) => {
    if (document.hidden) { resolve(null); return; }
    const stamps = [];
    const t0 = performance.now();
    // rAF stops entirely when the window is covered/minimized — don't wait forever
    setTimeout(() => resolve(null), durationMs + 2500);
    const step = (t) => {
      stamps.push(t);
      if (document.hidden) { resolve(null); return; } // minimized / covered: numbers would be meaningless
      if (t - t0 < durationMs) requestAnimationFrame(step);
      else {
        let slow = 0;
        for (let i = 1; i < stamps.length; i++) if (stamps[i] - stamps[i - 1] > 34) slow++;
        const frames = stamps.length - 1;
        resolve(frames > 5 ? { fps: (frames * 1000) / (stamps[stamps.length - 1] - stamps[0]), slowShare: slow / frames } : null);
      }
    };
    requestAnimationFrame(step);
  });
}

async function applyFxPreference() {
  const token = ++fxMeasureToken;
  if (fxPref === 'lite') document.body.classList.add('lite');
  else if (fxPref === 'full') document.body.classList.remove('lite');
  else {
    document.body.classList.remove('lite');
    renderFxButton();
    await new Promise((r) => setTimeout(r, 700)); // let the show layout settle first
    const m = await measureFps(2200);
    if (token !== fxMeasureToken || fxPref !== 'auto') return;
    if (m && (m.fps < 46 || m.slowShare > 0.2)) document.body.classList.add('lite');
  }
  renderFxButton();
}

document.getElementById('btn-fx').addEventListener('click', () => {
  fxPref = fxPref === 'auto' ? 'lite' : fxPref === 'lite' ? 'full' : 'auto';
  try { localStorage.setItem('darttracker-fx', fxPref); } catch (e) { /* ignore */ }
  applyFxPreference();
});

function launchConfetti(container) {
  const colors = ['#ff4136', '#ffb020', '#2fae6b', '#f5f3ef', '#ff8a3d'];
  const wrap = document.createElement('div');
  wrap.className = 'confetti';
  const count = isLite() ? 26 : 60;
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span');
    s.style.left = `${50 + (Math.random() * 40 - 20)}%`;
    s.style.background = colors[i % colors.length];
    s.style.setProperty('--dx', `${Math.random() * 600 - 300}px`);
    s.style.setProperty('--rot', `${Math.random() * 1080 - 540}deg`);
    s.style.setProperty('--dur', `${1.6 + Math.random() * 1.4}s`);
    s.style.setProperty('--delay', `${Math.random() * 0.4}s`);
    wrap.appendChild(s);
  }
  container.appendChild(wrap);
  setTimeout(() => wrap.remove(), 3600);
}

function matchSummaryLine(g, p) {
  const name = escapeHtml(p.name);
  if (g.mode === 'cricket') return `${name}: ${p.score} Punkte · ${p.marksTotal} Marks · MPR ${p.mpr.toFixed(2)}`;
  if (g.mode === 'atc') return `${name}: ${p.reached}/${g.totalTargets} getroffen · ${p.darts} Darts`;
  if (g.mode === 'killer') return `${name}: ${p.out ? 'raus' : `${p.lives} Leben`} · ${p.kills} Treffer`;
  if (isRoundMode(g.mode)) return `${name}: ${p.score} ${escapeHtml(g.unit || 'Punkte')}${p.out ? ' · raus' : ''} · ${p.darts} Darts`;
  return `${name}: ${p.legsWon} Legs${g.setsToWin > 1 ? `, ${p.setsWon} Sets` : ''} · Ø ${p.average.toFixed(1)} · Highscore ${p.highestTurn}${p.highestCheckout ? ` · Bestes Checkout ${p.highestCheckout}` : ''}`;
}

function formatCheckout(suggestion) {
  if (!suggestion || !suggestion.possible) return '';
  return `<span class="co-label">CHECKOUT</span><span class="co-value">${suggestion.route.map((r) => r.label).join(' · ')}</span>`;
}

let lastLegOverlayKey = null;
let lastMatchOverlayShown = false;

function handleLegAndMatchOverlays(g, prev) {
  const legOverlay = document.getElementById('overlay-leg');
  const matchOverlay = document.getElementById('overlay-match-finished');
  const justHappened = !!prev && prev.status === 'in_progress';

  if (g.status === 'leg_finished' || g.status === 'set_finished') {
    const key = `${g.legNumber}-${g.setNumber}-${g.status}`;
    if (lastLegOverlayKey !== key) {
      lastLegOverlayKey = key;
      if (justHappened) {
        showBigFlash(g.status === 'set_finished' ? 'Set!' : 'Checkout!', 'gold');
        playSound('checkout');
        setTimeout(() => launchConfetti(legOverlay), 250);
      }
      const summary = g.lastLegSummary;
      const icon = g.status === 'set_finished'
        ? '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--gold)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v4a5 5 0 0 1-10 0V4Z"/><path d="M7 5H4a3 3 0 0 0 3 5"/><path d="M17 5h3a3 3 0 0 1-3 5"/><path d="M12 13v3"/><path d="M9 20h6"/><path d="M10 17h4l.6 3H9.4l.6-3Z"/></svg>'
        : '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--green)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>';
      document.getElementById('leg-overlay-title').innerHTML =
        icon + (g.status === 'set_finished' ? ' Set gewonnen: ' : ' Leg gewonnen: ') + escapeHtml(summary ? summary.winnerName : '');
      document.getElementById('leg-overlay-checkout').textContent = summary ? `Checkout ${summary.checkoutScore}` : '';
      document.getElementById('leg-overlay-sub').textContent = summary ? summary.checkoutDarts.map((d) => d.label).join(' · ') : '';
    }
    legOverlay.hidden = false;
  } else {
    legOverlay.hidden = true;
    lastLegOverlayKey = null;
  }

  if (g.status === 'finished') {
    matchOverlay.hidden = false;
    if (!lastMatchOverlayShown) {
      lastMatchOverlayShown = true;
      if (justHappened && !g.endedEarly) {
        showBigFlash('Game Shot!', 'gold');
        playSound('win');
        setTimeout(() => launchConfetti(matchOverlay), 250);
      }
      const winner = g.players.find((p) => p.id === g.winnerId);
      const trophy = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="var(--gold)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v4a5 5 0 0 1-10 0V4Z"/><path d="M7 5H4a3 3 0 0 0 3 5"/><path d="M17 5h3a3 3 0 0 1-3 5"/><path d="M12 13v3"/><path d="M9 20h6"/><path d="M10 17h4l.6 3H9.4l.6-3Z"/></svg>';
      document.getElementById('match-overlay-title').innerHTML = winner
        ? `${trophy} ${escapeHtml(winner.name)} gewinnt!`
        : 'Unentschieden';
      document.getElementById('match-summary').innerHTML =
        (g.endedEarly ? '<div style="margin-bottom:8px;">Vorzeitig beendet – Stand wird gewertet.</div>' : '') +
        g.players.map((p) => matchSummaryLine(g, p)).join('<br/>');
    }
  } else {
    matchOverlay.hidden = true;
    lastMatchOverlayShown = false;
  }
}

document.getElementById('leg-overlay-continue').addEventListener('click', () => socket.emit('continue_after_leg'));
document.getElementById('leg-overlay-undo').addEventListener('click', () => socket.emit('undo_throw'));
document.getElementById('match-overlay-undo').addEventListener('click', () => socket.emit('undo_throw'));
document.getElementById('match-finished-close').addEventListener('click', () => socket.emit('finish_game'));
