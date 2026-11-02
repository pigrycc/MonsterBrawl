/**
 * Preload script — the secure bridge between the Electron main process and the
 * Three.js renderer. Runs with contextIsolation ON, so the renderer only sees
 * the explicitly exposed, minimal `window.mcb` API (never raw Node/ipc).
 *
 * Kept intentionally small for this slice; it grows as netcode / host-process
 * control and voice permissions are added in later slices.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mcb', {
  /** Build/runtime metadata the renderer can display. */
  env: {
    platform: process.platform,        // 'win32' | 'darwin' | 'linux'
    arch: process.arch,                // 'x64' | 'arm64'
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    isPackaged: process.env.NODE_ENV !== 'development',
  },
  /**
   * Host-server control (GDD §2). The host client asks the main process to
   * start the bundled authoritative Node server in-process, then connects to
   * it like any other client. Returns the ws URL to connect to.
   */
  net: {
    startHost: (opts) => ipcRenderer.invoke('mcb:startHost', opts),   // → {url} | {error}
    stopHost: () => ipcRenderer.invoke('mcb:stopHost'),
  },
});
