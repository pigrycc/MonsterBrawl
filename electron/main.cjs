/**
 * Electron main process — the native desktop shell for Monster Coliseum Brawl.
 *
 * Responsibilities:
 *  - Create the game window (the Three.js renderer runs inside it).
 *  - In dev, load the Vite dev server; in a packaged build, load the built
 *    dist/index.html so the app is fully self-contained (GDD §1: extract,
 *    double-click, reach the lobby — no external redistributables).
 *  - (Later slices) spawn / manage the authoritative host server process.
 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const isDev = !app.isPackaged && process.env.VITE_DEV_SERVER_URL;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b0d12',
    title: 'Monster Coliseum Brawl',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // The renderer needs WebGL + (later) WebRTC; both are on by default.
    },
  });

  win.once('ready-to-show', () => win.show());
  win.removeMenu();

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Packaged: dist/ is bundled alongside electron/ inside the asar/resources.
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
