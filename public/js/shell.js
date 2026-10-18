'use strict';

// Connection banner, backup, remote QR, show mode toggle and the Electron bridge.
// (Classic script: all files in public/js share one global scope; see the script tags in index.html.)

// ---------------------------------------------------------------------------
// Connection indicator
// ---------------------------------------------------------------------------

socket.on('disconnect', () => { document.getElementById('conn-banner').hidden = false; });
socket.on('connect', () => { document.getElementById('conn-banner').hidden = true; });

// ---------------------------------------------------------------------------
// Backup: export / import all data as one JSON file
// ---------------------------------------------------------------------------

document.getElementById('btn-export-data').addEventListener('click', () => {
  socket.emit('export_data', (data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `darttracker-sicherung-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
});

document.getElementById('btn-import-data').addEventListener('click', () => {
  document.getElementById('import-file').click();
});

document.getElementById('import-file').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  file.text().then((text) => {
    let data;
    try { data = JSON.parse(text); } catch (err) { alert('Datei konnte nicht gelesen werden.'); return; }
    socket.emit('import_data', data, (res) => {
      if (!res || !res.ok) { alert(res && res.error ? res.error : 'Import fehlgeschlagen.'); return; }
      alert(`Sicherung geladen: ${res.players} Spieler, ${res.matches} Spiele, ${res.practiceSessions} Trainings neu übernommen.`);
      renderStats();
    });
  });
});

// ---------------------------------------------------------------------------
// Remote QR overlay
// ---------------------------------------------------------------------------

document.getElementById('btn-remote-qr').addEventListener('click', () => {
  socket.emit('get_remote_url', (res) => {
    if (res.qr) document.getElementById('remote-qr-img').src = res.qr;
    document.getElementById('remote-qr-url').textContent = res.url;
    document.getElementById('overlay-remote-qr').hidden = false;
  });
});
document.getElementById('overlay-remote-close').addEventListener('click', () => {
  document.getElementById('overlay-remote-qr').hidden = true;
});

// ---------------------------------------------------------------------------
// TV mode (fullscreen scoreboard, phones do the input)
// ---------------------------------------------------------------------------

function renderSoundButton() {
  document.getElementById('btn-sound-label').textContent = soundEnabled ? 'Sound an' : 'Sound aus';
  document.getElementById('btn-sound').style.opacity = soundEnabled ? '' : '0.6';
}

document.getElementById('btn-sound').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  try { localStorage.setItem('darttracker-sound', soundEnabled ? 'on' : 'off'); } catch (e) { /* ignore */ }
  renderSoundButton();
  if (soundEnabled) playSound('ton');
});

function enterTvMode() {
  document.body.classList.add('tv-mode');
  document.getElementById('show-bar').hidden = false;
  renderSoundButton();
  applyFxPreference();
  audio();
  socket.emit('get_remote_url', (res) => {
    if (res.qr) document.getElementById('tv-qr-img').src = res.qr;
    document.getElementById('tv-qr-url').textContent = res.url;
  });
  const el = document.documentElement;
  if (el.requestFullscreen && !document.fullscreenElement) {
    el.requestFullscreen().catch(() => { /* fullscreen is a nice-to-have */ });
  }
}

function exitTvMode() {
  document.body.classList.remove('tv-mode');
  document.getElementById('show-bar').hidden = true;
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => { /* ignore */ });
  }
}

document.getElementById('btn-tv-mode').addEventListener('click', enterTvMode);
document.getElementById('btn-tv-exit').addEventListener('click', exitTvMode);
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && document.body.classList.contains('tv-mode')) exitTvMode();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('tv-mode')) exitTvMode();
});

// ---------------------------------------------------------------------------
// Press feedback for pads
// ---------------------------------------------------------------------------

document.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('.numpad-grid button, .numpad-actions .btn, .multiplier-row button');
  if (!btn) return;
  btn.classList.add('pressed');
  setTimeout(() => btn.classList.remove('pressed'), 160);
});

// ---------------------------------------------------------------------------
// Desktop integration (only present inside the Electron app, not in a plain browser)
// ---------------------------------------------------------------------------

if (window.darttracker) {
  window.darttracker.getVersion().then((v) => {
    document.getElementById('app-version').textContent = `v${v}`;
  }).catch(() => {});

  const banner = document.getElementById('update-banner');
  const bannerText = document.getElementById('update-banner-text');
  const installBtn = document.getElementById('update-install');
  window.darttracker.onUpdateStatus((info) => {
    if (info.state === 'downloading') {
      bannerText.textContent = `Update auf v${info.version} wird im Hintergrund geladen…`;
      installBtn.hidden = true;
      banner.hidden = false;
    } else if (info.state === 'ready') {
      bannerText.textContent = `Update auf v${info.version} ist bereit.`;
      installBtn.hidden = false;
      banner.hidden = false;
    }
  });
  installBtn.addEventListener('click', () => window.darttracker.installUpdate());
}
