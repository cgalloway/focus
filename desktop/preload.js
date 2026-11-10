/* ---------------------------------------------------------------------------
 * preload.js — exposes the focusAPI bridge the page checks for.
 *
 * index.html treats the mere presence of window.focusAPI as "running under
 * Electron" (no is-web class, native vibrancy background, compact mode
 * enabled), so this must expose exactly the surface the page calls and
 * nothing more.
 * ------------------------------------------------------------------------- */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('focusAPI', {
  getVersion: () => ipcRenderer.invoke('focus:get-version'),
  getToken: () => ipcRenderer.invoke('focus:get-token'),
  setToken: (token) => ipcRenderer.invoke('focus:set-token', token),
  toggleCompact: (isCompact, layout) => ipcRenderer.invoke('focus:toggle-compact', !!isCompact, layout),
  fitCompactContent: (width, height) => ipcRenderer.invoke('focus:fit-compact-content', width, height),
  compactMenu: (options) => ipcRenderer.invoke('focus:compact-menu', options),
  setCompactLayout: (layout) => ipcRenderer.invoke('focus:set-compact-layout', layout),
  showConfetti: () => ipcRenderer.invoke('focus:show-confetti'),
  openExternal: (url) => ipcRenderer.invoke('focus:open-external', url)
});
