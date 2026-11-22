const { app, BrowserWindow, ipcMain, dialog, shell, session, desktopCapturer, protocol, screen, safeStorage } = require("electron");
const { registerMediaScheme, handleMediaProtocol } = require("./media.cjs");
const path = require("path");
const { registerFolderIpc } = require("./folders.cjs");
const { registerLibraryIpc } = require("./library.cjs");
const { registerRecorderIpc } = require("./recorder.cjs");
const { registerStreamIpc } = require("./stream.cjs");
const { registerTimecodeIpc } = require("./timecodegen.cjs");
const { registerRtmpIpc } = require("./rtmp.cjs");
const { serveDist } = require("./serve.cjs");
const { collectLegacyStorage, collectLoopbackStorage, registerMigrationIpc } = require("./migrate.cjs");
const { registerSpotifyIpc } = require("./spotify.cjs");

// Una sola carpeta de datos (biblioteca, carpetas, ajustes) para la app
// instalada ("BROSS DJ") y para `npm run app` ("bross-dj"): sin esto, la
// instalada arrancaría con la biblioteca vacía.
// BROSS_USER_DATA: otra carpeta (pruebas sin tocar la biblioteca real).
app.setPath("userData", process.env.BROSS_USER_DATA || path.join(app.getPath("appData"), "bross-dj"));

const devURL = process.env.VITE_DEV_SERVER_URL;
/** origen de la app: dev server o el servidor local de dist/ */
let appURL = devURL ?? null;
/** la ventana invisible de la migración no debe cerrar la app */
let mainWindowOpened = false;

// bross-media:// (video de las carpetas) tiene que declararse antes de "ready"
registerMediaScheme(protocol);

app.whenReady().then(async () => {
  // carpetas de música autorizadas por el usuario (ver folders.cjs)
  const roots = registerFolderIpc(ipcMain, dialog, BrowserWindow, path.join(app.getPath("userData"), "music-roots.json"));
  handleMediaProtocol(protocol, (p) => roots.allows(p));
  const userData = app.getPath("userData");
  registerLibraryIpc(ipcMain, path.join(userData, "library.db"), path.join(userData, "library.json"), {
    dialog,
    BrowserWindow,
  });
  registerRecorderIpc(ipcMain, app);
  registerTimecodeIpc(ipcMain, app);
  const streaming = registerStreamIpc(ipcMain, BrowserWindow);
  const rtmp = registerRtmpIpc(ipcMain, BrowserWindow);
  app.on("before-quit", () => {
    void streaming.stop();
    rtmp.stop();
  });
  registerMigrationIpc(ipcMain, app);
  // Spotify: solo leer playlists para armar listas con los archivos propios
  registerSpotifyIpc(ipcMain, { app, shell, safeStorage });
  // botones de ventana de la barra de BROSS DJ (la ventana no tiene marco)
  ipcMain.on("bross:win", (e, action) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return;
    if (action === "minimize") w.minimize();
    else if (action === "toggle-maximize") {
      if (w.isMaximized()) w.unmaximize();
      else w.maximize();
    } else if (action === "close") w.close();
  });
  ipcMain.handle("bross:win-is-maximized", (e) => !!BrowserWindow.fromWebContents(e.sender)?.isMaximized());
  // pantalla de video: a pantalla completa en el segundo monitor (o en el actual)
  ipcMain.handle("bross:screen-fullscreen", (_e, on) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith("#screen"));
    if (!w) return false;
    if (on) {
      const displays = screen.getAllDisplays();
      const primary = screen.getPrimaryDisplay();
      const target = displays.find((d) => d.id !== primary.id) ?? primary;
      w.setBounds(target.bounds);
    }
    w.setFullScreen(!!on);
    return true;
  });
  // "grabar el sonido del sistema": getDisplayMedia devuelve la pantalla
  // principal (se descarta) con el audio en loopback de Windows. Solo la
  // propia app puede pedirlo.
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      if (!isAppUrl(request.securityOrigin ? `${request.securityOrigin}/` : request.frame?.url ?? "")) {
        callback({});
        return;
      }
      desktopCapturer
        .getSources({ types: ["screen"] })
        .then((sources) => callback(sources[0] ? { video: sources[0], audio: "loopback" } : {}))
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );
  if (!appURL) {
    // ajustes de la versión que se abría por file:// (una sola vez)
    await collectLegacyStorage(app, BrowserWindow);
    // la app compilada se sirve por HTTP local (YouTube no funciona con file://)
    const served = await serveDist(path.join(__dirname, "../dist"));
    appURL = served.url;
    // ajustes del origen anterior (127.0.0.1), una sola vez
    await collectLoopbackStorage(app, BrowserWindow, served.legacyUrl);
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/** ¿La URL es la propia app? */
function isAppUrl(url) {
  return !!appURL && url.startsWith(appURL);
}

function createWindow() {
  mainWindowOpened = true;
  const win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: "#05060a",
    autoHideMenuBar: true,
    // sin barra de título del sistema: minimizar, maximizar y cerrar están
    // en la barra de BROSS DJ. "hidden" (y no frame: false) conserva los
    // bordes para cambiar el tamaño y el acomodo de ventanas de Windows.
    titleBarStyle: "hidden",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  // la ventana nunca navega fuera de la app; los links externos van al navegador
  win.webContents.setWindowOpenHandler(({ url }) => {
    // la pantalla de video/karaoke es la propia app con #screen
    if (isAppUrl(url) && url.endsWith("#screen")) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 960,
          height: 540,
          backgroundColor: "#000000",
          autoHideMenuBar: true,
          title: "BROSS DJ · Pantalla",
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
        },
      };
    }
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });

  const sendWinState = () => {
    if (!win.isDestroyed()) win.webContents.send("bross:win-state", { maximized: win.isMaximized() });
  };
  win.on("maximize", sendWinState);
  win.on("unmaximize", sendWinState);

  win.loadURL(appURL);
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && mainWindowOpened) app.quit();
});
