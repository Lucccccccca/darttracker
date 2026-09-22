'use strict';

const path = require('path');
const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

const PORT = process.env.PORT ? Number(process.env.PORT) : 4848;
let mainWindow = null;

// Avoids GPU-process crash loops on machines/VMs with flaky hardware acceleration
// (the app is a simple scoreboard UI — it doesn't need GPU compositing).
app.disableHardwareAcceleration();

// In a packaged build the source lives inside a read-only app.asar archive, so the server's
// default (next to its own files) can't be written to. Point it at a real per-user folder
// before requiring the server — must happen first, store.js reads this at module load time.
process.env.DARTTRACKER_DATA_DIR = process.env.DARTTRACKER_DATA_DIR || app.getPath('userData');

const { startServer } = require('../server/index');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  async function createWindow() {
    let port;
    try {
      ({ port } = await startServer(PORT));
    } catch (err) {
      dialog.showErrorBox(
        'DartTracker konnte nicht gestartet werden',
        `Der lokale Server konnte nicht auf Port ${PORT} starten (läuft eventuell schon eine andere Instanz?).\n\n${err.message}`
      );
      app.quit();
      return;
    }

    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      backgroundColor: '#0f1115',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    Menu.setApplicationMenu(null);
    mainWindow.on('closed', () => { mainWindow = null; });
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error('Renderer process gone:', details);
    });

    await mainWindow.loadURL(`http://localhost:${port}/`);
    setupAutoUpdate();
  }

  function sendToWindow(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  }

  // Checks GitHub Releases (via latest.yml) for a newer installer, downloads it silently and
  // installs on the next quit — or immediately when the user clicks the banner's button.
  // Only the NSIS "Setup" build can update itself; the portable exe and `electron .` skip this.
  function setupAutoUpdate() {
    if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', (info) => sendToWindow('update-status', { state: 'downloading', version: info.version }));
    autoUpdater.on('update-downloaded', (info) => sendToWindow('update-status', { state: 'ready', version: info.version }));
    autoUpdater.on('error', (err) => console.error('Auto-Update:', err && err.message ? err.message : err));
    const check = () => autoUpdater.checkForUpdates().catch(() => {});
    check();
    setInterval(check, 4 * 60 * 60 * 1000);
  }

  ipcMain.handle('get-version', () => app.getVersion());
  ipcMain.on('install-update', () => autoUpdater.quitAndInstall());

  app.whenReady().then(createWindow);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
