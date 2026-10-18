'use strict';

// One list of all game modes. Setup screens (PC and phone), labels, statistics and the history
// feed all read from here, so adding a mode means adding it in one place on the client.
const MODES = [
  {
    key: 'x01', group: 'Klassiker', label: 'X01', min: 1,
    desc: '301 / 501 / 701 herunterzählen, Checkout-Hilfe, Handicap möglich',
    hint: '',
  },
  {
    key: 'cricket', group: 'Klassiker', label: 'Cricket', min: 2,
    desc: '20 bis 15 und Bull schließen, Punkte sammeln · ab 2 Spieler',
    hint: 'Je 3 Marks schließen eine Zahl (Double = 2, Triple = 3). Weitere Marks auf eine Zahl, die der Gegner noch nicht geschlossen hat, geben Punkte. Wer alles geschlossen hat und mindestens gleich viele Punkte hat, gewinnt.',
  },
  {
    key: 'atc', group: 'Klassiker', label: 'Rund um die Uhr', min: 1,
    desc: '1 bis 20 und Bull der Reihe nach treffen',
    hint: 'Triff nacheinander 1, 2, 3 … 20 und zum Schluss die Bull. Wer zuerst durch ist, gewinnt.',
  },
  {
    key: 'shanghai', group: 'Alte Schule', label: 'Shanghai', min: 1, unit: 'Punkte',
    rounds: [7, 20], roundsLabel: 'Runden',
    desc: 'Runde n zählt nur die Zahl n · Single + Double + Triple gewinnt sofort',
    hint: 'In Runde 1 zählt nur die 1, in Runde 2 nur die 2 und so weiter. Single, Double und Triple zählen 1×, 2× und 3×. Wer in einer Aufnahme Single, Double und Triple derselben Zahl trifft (Shanghai), gewinnt sofort. Sonst gewinnt die höchste Punktzahl.',
  },
  {
    key: 'baseball', group: 'Alte Schule', label: 'Baseball', min: 1, unit: 'Runs',
    rounds: [6, 9], roundsLabel: 'Innings',
    desc: '9 Innings, Treffer auf die Inning-Zahl bringen Runs',
    hint: 'Inning n = Zahl n. Single bringt 1 Run, Double 2, Triple 3. Die meisten Runs gewinnen, bei Gleichstand gibt es Extra-Innings auf die Bull.',
  },
  {
    key: 'halveit', group: 'Alte Schule', label: 'Halve-It', min: 1, unit: 'Punkte',
    desc: 'Ziel treffen, sonst wird der Punktestand halbiert',
    hint: 'Ziele der Reihe nach: 15, 16, beliebiges Doppel, 17, 18, beliebiges Treble, 19, 20, Bull. Start mit 40 Punkten. Wer mit allen drei Darts das Ziel verfehlt, halbiert seinen Punktestand.',
  },
  {
    key: 'bobs27', group: 'Alte Schule', label: "Bob's 27", min: 1, unit: 'Punkte',
    desc: 'Doppel 1 bis 20 und Bull · auch allein spielbar',
    hint: 'Start mit 27 Punkten. Du wirfst auf D1, D2 … D20 und zum Schluss auf das Bull. Jeder Treffer gibt den Wert des Doppels, ohne Treffer in der Aufnahme wird er abgezogen. Unter 0 bist du raus.',
  },
  {
    key: 'golf', group: 'Alte Schule', label: 'Golf', min: 1, unit: 'Schläge', lowBest: true,
    rounds: [9, 18], roundsLabel: 'Löcher',
    desc: 'Loch n = Zahl n · wenigste Schläge gewinnen',
    hint: 'Loch n = Zahl n. Der erste Dart auf die Zahl beendet das Loch: Triple = 1 Schlag, Double = 2, Single = 3. Kein Treffer in drei Darts = 5 Schläge. Wenigste Schläge gewinnen.',
  },
  {
    key: 'killer', group: 'Alte Schule', label: 'Killer', min: 2, unit: 'Treffer',
    desc: 'Eigene Zahl, Leben abnehmen · ab 2 Spieler',
    hint: 'Jeder bekommt eine Zahl. Triff dein eigenes Doppel, um Killer zu werden. Danach nimmst du mit den Doppeln der anderen jeweils ein Leben ab, jeder hat 3. Wer als Letzter übrig bleibt, gewinnt.',
  },
];

const MODE_LABELS = Object.fromEntries(MODES.map((m) => [m.key, m.label]));
MODE_LABELS.practice = 'Training';

function modeInfo(key) { return MODES.find((m) => m.key === key) || null; }
