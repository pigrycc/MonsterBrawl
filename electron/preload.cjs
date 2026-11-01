/**
 * Preload script — the secure bridge between the Electron main process and the
 * Three.js renderer. Runs with contextIsolation ON, so the renderer only sees
 * the explicitly exposed, minimal `window.mcb` API (never raw Node/ipc).
 *
 * Kept intentionally small for this slice; it grows as netcode / host-process
 * control and voice permissions are added in later slices.
 */
const { contextBridge } = require('electron');

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
});
