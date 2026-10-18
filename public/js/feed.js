'use strict';

// Match history (Verlauf) shown next to the scoreboard and in the archive.
// (Classic script: all files in public/js share one global scope; see the script tags in index.html.)

// ---- Match history ("Verlauf"): one chronological feed for every mode.
// Newest visit on top, grouped by leg (X01) or round (everything else), with a live row for the
// visit in progress, a fixed colour per player and a short summary per player. The same builder
// shows finished matches from the archive (see recordToFeedGame).
const PLAYER_COLORS = ['#ff6b5e', '#4da3ff', '#3ccf8e', '#ffb020', '#b57cff', '#2ed3c6'];
const ROUND_WORD = { golf: 'Loch', baseball: 'Inning' };
let feedGameId = null;
let feedCount = 0;
let feedSignature = null;
let feedLiveSignature = null;
let feedSummarySignature = null;

/** The colour stored with the player; falls back to a colour by seat for players without one. */
function playerColorFor(p, idx) {
  const known = (latestState.players || []).find((x) => x.id === p.id);
  return (known && known.color) || PLAYER_COLORS[idx % PLAYER_COLORS.length];
}

function dartChip(d) {
  const miss = d.value === 0;
  const cls = d.bust ? ' bust' : miss ? ' miss' : d.multiplier === 3 ? ' t' : d.multiplier === 2 ? ' d' : '';
  return `<span class="dc${cls}">${miss ? '–' : escapeHtml(d.label)}</span>`;
}

function visitScored(t) { return t.bust ? 0 : t.scoreBefore - t.scoreAfter; }

/** Modes that play one visit per round at a target (everything except X01, Cricket, Around the Clock). */
function isRoundMode(mode) { return !!mode && !['x01', 'cricket', 'atc', 'practice'].includes(mode); }

/** All finished visits of all players in the order they were thrown, newest first. */
function collectTurns(g) {
  const all = [];
  const n = g.players.length;
  const hasSeq = g.players.every((p) => (p.turnLog || []).every((t) => typeof t.seq === 'number'));
  g.players.forEach((p, idx) => (p.turnLog || []).forEach((t, i) => {
    all.push({ p, idx, t, round: i + 1, order: hasSeq ? t.seq : i * n + idx });
  }));
  all.sort((a, b) => b.order - a.order);
  return all;
}

/** Colour class for the little tag shown for visit notes like "Shanghai!" or "Halbiert". */
function noteTag(note) {
  if (!note) return '';
  const cls = /Shanghai/.test(note) ? 'max' : /Eagle|Birdie/.test(note) ? 'out' : /Halbiert|Verfehlt|Raus|raus/.test(note) ? 'bust' : 'ton';
  const short = note.length > 18 ? `${note.slice(0, 17)}…` : note;
  return `<span class="tl-tag ${cls}" title="${escapeHtml(note)}">${escapeHtml(short)}</span>`;
}

function feedEntryHtml(g, e, isNew) {
  const { p, idx, t } = e;
  let cls = '', tags = '', big = '', small = '';
  if (g.mode === 'x01') {
    const scored = visitScored(t);
    if (t.bust) { cls = ' bust'; tags = '<span class="tl-tag bust">BUST</span>'; big = '0'; small = `bleibt ${t.scoreAfter}`; }
    else if (t.checkout) { cls = ' checkout'; tags = '<span class="tl-tag out">CHECKOUT</span>'; big = String(t.scoreBefore); small = 'Leg gewonnen'; }
    else {
      if (scored === 180) { cls = ' max'; tags = '<span class="tl-tag max">180</span>'; }
      else if (scored >= 140) { cls = ' ton'; tags = '<span class="tl-tag ton">140+</span>'; }
      else if (scored >= 100) { cls = ' ton'; tags = '<span class="tl-tag ton">TON</span>'; }
      big = String(scored); small = `Rest ${t.scoreAfter}`;
    }
  } else if (g.mode === 'cricket') {
    big = String(t.marks); small = t.points ? `Marks · +${t.points}` : t.marks === 1 ? 'Mark' : 'Marks';
    if (t.marks >= 5) { cls = ' ton'; tags = '<span class="tl-tag ton">STARK</span>'; }
    if (!t.marks) cls += ' dim';
  } else if (g.mode === 'atc') {
    big = String(t.marks); small = 'Treffer';
    if (t.marks >= 3) { cls = ' ton'; tags = '<span class="tl-tag ton">3 TREFFER</span>'; }
    if (!t.marks) cls += ' dim';
  } else if (g.mode === 'killer') {
    big = String(t.points || 0); small = 'Treffer';
    tags = noteTag(t.note);
    if (/raus/.test(t.note || '')) cls = ' bust';
    else if (/Killer!/.test(t.note || '')) cls = ' ton';
    if (!t.note) cls += ' dim';
  } else {
    // round based classics: the big number is what the visit changed
    const pts = t.points || 0;
    const strokes = g.mode === 'golf';
    big = strokes ? String(pts) : pts > 0 ? `+${pts}` : String(pts);
    small = g.unit || 'Punkte';
    tags = noteTag(t.note);
    if (t.win) cls = ' max';
    else if (strokes) cls = pts <= 2 ? ' ton' : pts >= 5 ? ' bust' : '';
    else if (pts < 0) cls = ' bust';
    else if (pts === 0) cls = ' dim';
    else if (t.note) cls = ' ton';
  }
  return `<div class="tl-entry${cls}${isNew ? ' new-entry' : ''}" style="--pc:${playerColorFor(p, idx)}">
    <span class="tl-av">${escapeHtml((p.name || '?').trim().charAt(0).toUpperCase())}</span>
    <div class="tl-main">
      <div class="tl-top"><span class="tl-who">${escapeHtml(p.name)}</span>${tags}</div>
      <div class="tl-darts">${(t.darts || []).map(dartChip).join('')}</div>
    </div>
    <div class="tl-res"><b>${big}</b><small>${small}</small></div>
  </div>`;
}

function feedGroupHeader(g, e, isTop) {
  const running = g.status === 'in_progress';
  if (g.mode === 'x01') {
    const rec = (g.legHistory || []).find((l) => l.leg === e.t.leg && l.set === e.t.set);
    const winner = rec ? g.players.find((p) => p.id === rec.winnerId) : null;
    const label = `Leg ${e.t.leg}${g.setsToWin > 1 ? ` · Set ${e.t.set}` : ''}`;
    const right = winner
      ? `<span class="tl-win">Gewonnen: ${escapeHtml(winner.name)}${rec.checkoutScore ? ` · ${rec.checkoutScore}` : ''}</span>`
      : running ? '<span class="tl-now">läuft</span>' : '';
    return `<div class="tl-group"><span>${label}</span>${right}</div>`;
  }
  const word = ROUND_WORD[g.mode] || 'Runde';
  const target = e.t.target ? ` · Ziel ${escapeHtml(e.t.target)}` : '';
  return `<div class="tl-group"><span>${word} ${e.round}${target}</span>${isTop && running ? '<span class="tl-now">läuft</span>' : ''}</div>`;
}

function feedSummaryHtml(g) {
  return g.players.map((p, idx) => {
    let stats;
    if (g.mode === 'x01') {
      const scores = (p.turnLog || []).filter((t) => !t.bust).map(visitScored);
      const best = scores.length ? Math.max(...scores) : 0;
      const tons = scores.filter((s) => s >= 100).length;
      const start = g.handicap && p.startScore ? `<span>Start <b>${p.startScore}</b></span>` : '';
      stats = `${start}<span>Ø <b>${(p.average || 0).toFixed(1)}</b></span><span>Best <b>${best}</b></span><span>100+ <b>${tons}</b></span>`;
    } else if (g.mode === 'cricket') {
      stats = `<span>Punkte <b>${p.score}</b></span><span>MPR <b>${(p.mpr || 0).toFixed(2)}</b></span>`;
    } else if (g.mode === 'atc') {
      stats = `<span>Treffer <b>${p.reached}/${g.totalTargets || 21}</b></span><span>Darts <b>${p.darts != null ? p.darts : p.dartsThrownTotal}</b></span>`;
    } else if (g.mode === 'killer') {
      stats = `<span>Nr. <b>${p.number}</b></span><span>Leben <b>${p.out ? 0 : p.lives}</b></span><span>Treffer <b>${p.kills}</b></span>`;
    } else {
      stats = `<span>${escapeHtml(g.unit || 'Punkte')} <b>${p.score}</b></span>${p.out ? '<span><b>raus</b></span>' : `<span>Darts <b>${p.darts != null ? p.darts : p.dartsThrownTotal}</b></span>`}`;
    }
    const active = idx === g.activePlayerIndex && g.status === 'in_progress';
    return `<div class="tl-sum${active ? ' active' : ''}${p.out ? ' out' : ''}" style="--pc:${playerColorFor(p, idx)}"><span class="tl-dot"></span><span class="tl-sum-name">${escapeHtml(p.name)}</span>${stats}</div>`;
  }).join('');
}

function feedLiveHtml(g) {
  if (g.status !== 'in_progress') return '';
  const idx = g.activePlayerIndex;
  const p = g.players[idx];
  if (!p) return '';
  const chips = p.turnDarts.map(dartChip).join('') + '<span class="dc empty"></span>'.repeat(Math.max(0, 3 - p.turnDarts.length));
  const rest = g.mode === 'x01' ? `<div class="tl-res"><b>${p.currentScore}</b><small>Rest</small></div>` : '';
  return `<div class="tl-entry live" style="--pc:${playerColorFor(p, idx)}">
    <span class="tl-av">${escapeHtml((p.name || '?').trim().charAt(0).toUpperCase())}</span>
    <div class="tl-main"><div class="tl-top"><span class="tl-who">${escapeHtml(p.name)}</span><span class="tl-tag live">AM WURF</span></div><div class="tl-darts">${chips}</div></div>${rest}
  </div>`;
}

/** The list of visits as HTML. `newest` marks the top row as new (slide-in) when asked. */
function buildFeedHtml(g, { limit = 60, markNew = false } = {}) {
  const turns = collectTurns(g);
  if (!turns.length) return '<div class="empty-state">Noch keine Aufnahmen</div>';
  const shown = turns.slice(0, limit);
  let html = '';
  let lastGroup = null;
  shown.forEach((e, i) => {
    const group = g.mode === 'x01' ? `${e.t.set}:${e.t.leg}` : `r${e.round}`;
    if (group !== lastGroup) { html += feedGroupHeader(g, e, i === 0); lastGroup = group; }
    html += feedEntryHtml(g, e, markNew && i === 0);
  });
  if (turns.length > shown.length) html += `<div class="tl-more">+ ${turns.length - shown.length} ältere Aufnahmen</div>`;
  return html;
}

/** Turns a saved match record into something the feed functions understand. */
function recordToFeedGame(m) {
  return {
    ...m,
    status: 'finished',
    activePlayerIndex: -1,
    totalTargets: 21,
    players: m.players.map((p) => ({ ...p, turnLog: p.turnLog || [], darts: p.dartsThrownTotal })),
  };
}

function renderMatchFeed(g) {
  if (feedGameId !== g.id) { feedGameId = g.id; feedCount = 0; feedSignature = null; feedLiveSignature = null; feedSummarySignature = null; }

  const summary = feedSummaryHtml(g);
  if (summary !== feedSummarySignature) {
    feedSummarySignature = summary;
    document.getElementById('turn-summary').innerHTML = summary;
  }
  const live = feedLiveHtml(g);
  if (live !== feedLiveSignature) {
    feedLiveSignature = live;
    document.getElementById('turn-live').innerHTML = live;
  }

  const total = collectTurns(g).length;
  const signature = buildFeedHtml(g);
  if (signature !== feedSignature) {
    feedSignature = signature;
    const el = document.getElementById('turn-log');
    el.innerHTML = buildFeedHtml(g, { markNew: total > feedCount && feedCount > 0 });
    el.scrollTop = 0;
  }
  feedCount = total;
}
