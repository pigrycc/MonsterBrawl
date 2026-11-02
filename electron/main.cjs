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
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

// --- Embedded host server control (GDD §2) ---------------------------------
// The host client starts the authoritative Node server inside the main process.
// The server is ESM; load it dynamically from the packaged/dev location.
let hostServer = null;

async function loadServerModule() {
  // In dev the source lives at server/index.js relative to the project root;
  // in a packaged build it ships under resources via the asar.
  const url = require('node:url').pathToFileURL(path.join(__dirname, '..', 'server', 'index.js')).href;
  return import(url);
}

ipcMain.handle('mcb:startHost', async (_evt, opts = {}) => {
  try {
    if (hostServer) await hostServer.close();
    const { startServer } = await loadServerModule();
    hostServer = startServer({ port: opts.port, roomName: opts.roomName, playerLimit: opts.playerLimit });
    const port = hostServer.wss.options.port;
    return { url: `ws://127.0.0.1:${port}` };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
});

ipcMain.handle('mcb:stopHost', async () => {
  if (hostServer) { await hostServer.close(); hostServer = null; }
  return { ok: true };
});

app.on('before-quit', async () => { if (hostServer) await hostServer.close(); });

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
