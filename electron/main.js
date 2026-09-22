'use strict';

const { app, BrowserWindow, Menu, dialog } = require('electron');

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
      },
    });

    Menu.setApplicationMenu(null);
    mainWindow.on('closed', () => { mainWindow = null; });
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error('Renderer process gone:', details);
    });

    await mainWindow.loadURL(`http://localhost:${port}/`);
  }

  app.whenReady().then(createWindow);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
