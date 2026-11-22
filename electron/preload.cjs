// preload — el renderer no necesita Node: el motor vive detrás del adaptador.
// Acá solo exponemos lo justo para elegir/escanear carpetas y leer archivos.
// Corre con sandbox: true, así que solo usa contextBridge e ipcRenderer.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("bross", {
  isDesktop: true,
  spotifyStatus: () => ipcRenderer.invoke("bross:spotify-status"),
  spotifyLogin: () => ipcRenderer.invoke("bross:spotify-login"),
  spotifyLogout: () => ipcRenderer.invoke("bross:spotify-logout"),
  spotifyGet: (urlOrPath) => ipcRenderer.invoke("bross:spotify-get", urlOrPath),
  winMinimize: () => ipcRenderer.send("bross:win", "minimize"),
  winToggleMaximize: () => ipcRenderer.send("bross:win", "toggle-maximize"),
  winClose: () => ipcRenderer.send("bross:win", "close"),
  winIsMaximized: () => ipcRenderer.invoke("bross:win-is-maximized"),
  onWinState: (cb) => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on("bross:win-state", h);
    return () => ipcRenderer.removeListener("bross:win-state", h);
  },
  pickFolder: () => ipcRenderer.invoke("bross:pick-folder"),
  scanFolder: (dir) => ipcRenderer.invoke("bross:scan-folder", dir),
  readFile: (file) => ipcRenderer.invoke("bross:read-file", file),
  readTagRegion: (file) => ipcRenderer.invoke("bross:read-tag-region", file),
  writeTags: (file, tags) => ipcRenderer.invoke("bross:write-tags", file, tags),
  readSidecar: (file, ext) => ipcRenderer.invoke("bross:read-sidecar", file, ext),
  screenFullscreen: (on) => ipcRenderer.invoke("bross:screen-fullscreen", on),
  registerRoots: (dirs) => ipcRenderer.invoke("bross:register-roots", dirs),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      return null;
    }
  },
  authorizeFiles: (files) => ipcRenderer.invoke("bross:authorize-files", files),
  loadLibraryFile: () => ipcRenderer.sendSync("bross:library-load"),
  takeStorageMigration: () => ipcRenderer.sendSync("bross:storage-migration"),
  saveLibraryFile: (json) => ipcRenderer.invoke("bross:library-save", json),
  searchLibrary: (text) => ipcRenderer.invoke("bross:library-search", text),
  librarySyncInfo: () => ipcRenderer.invoke("bross:library-sync-info"),
  librarySyncPick: () => ipcRenderer.invoke("bross:library-sync-pick"),
  librarySyncClear: () => ipcRenderer.invoke("bross:library-sync-clear"),
  librarySyncPush: () => ipcRenderer.invoke("bross:library-sync-push"),
  librarySyncPull: () => ipcRenderer.invoke("bross:library-sync-pull"),
  recStart: (opts) => ipcRenderer.invoke("bross:rec-start", opts),
  recChunk: (chunk) => ipcRenderer.send("bross:rec-chunk", chunk),
  recStop: (extra) => ipcRenderer.invoke("bross:rec-stop", extra),
  tcGenerate: (minutes) => ipcRenderer.invoke("bross:tc-generate", minutes),
  rtmpCheck: () => ipcRenderer.invoke("bross:rtmp-check"),
  rtmpStart: (opts) => ipcRenderer.invoke("bross:rtmp-start", opts),
  rtmpChunk: (chunk) => ipcRenderer.send("bross:rtmp-chunk", chunk),
  rtmpStop: () => ipcRenderer.invoke("bross:rtmp-stop"),
  onRtmpStatus: (cb) => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on("bross:rtmp-status", h);
    return () => ipcRenderer.removeListener("bross:rtmp-status", h);
  },
  vrecStart: (opts) => ipcRenderer.invoke("bross:vrec-start", opts),
  vrecChunk: (chunk) => ipcRenderer.send("bross:vrec-chunk", chunk),
  vrecStop: () => ipcRenderer.invoke("bross:vrec-stop"),
  streamStart: (opts) => ipcRenderer.invoke("bross:stream-start", opts),
  streamStop: () => ipcRenderer.invoke("bross:stream-stop"),
  streamChunk: (chunk) => ipcRenderer.send("bross:stream-chunk", chunk),
  streamSong: (text) => ipcRenderer.invoke("bross:stream-song", text),
  streamStatus: () => ipcRenderer.invoke("bross:stream-status"),
  streamRequests: () => ipcRenderer.invoke("bross:stream-requests"),
  onStreamStatus: (cb) => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on("bross:stream-status", h);
    return () => ipcRenderer.removeListener("bross:stream-status", h);
  },
  onStreamRequest: (cb) => {
    const h = (_e, r) => cb(r);
    ipcRenderer.on("bross:stream-request", h);
    return () => ipcRenderer.removeListener("bross:stream-request", h);
  },
});
