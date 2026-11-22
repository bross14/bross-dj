// Migración única de los ajustes guardados en el navegador interno.
// Hasta la versión que servía dist/ por file://, los ajustes (atajos, mapeo
// MIDI, columnas, sampler…) vivían en el localStorage del origen "file://".
// Ahora la app se sirve por http://127.0.0.1, que es otro origen: sin esto,
// esos ajustes se perderían una vez.
const fs = require("fs");
const path = require("path");

/**
 * Lee (una sola vez) las claves bross.* del origen file:// con una ventana
 * invisible y las deja en un archivo para que la app nueva las tome.
 */
async function collectLegacyStorage(app, BrowserWindow) {
  const dir = app.getPath("userData");
  const doneFlag = path.join(dir, "storage-migrated.flag");
  const out = path.join(dir, "storage-migration.json");
  if (fs.existsSync(doneFlag)) return;
  const page = path.join(dir, "migrate-storage.html");
  let win = null;
  try {
    fs.writeFileSync(page, "<!doctype html><meta charset=utf-8><title>migración</title>");
    win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    await win.loadFile(page);
    const json = await win.webContents.executeJavaScript(`(() => {
      const o = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        // la biblioteca ya está en su propio archivo
        if (k && k.startsWith("bross.") && k !== "bross.library.v1") o[k] = localStorage.getItem(k);
      }
      return JSON.stringify(o);
    })()`);
    if (json && json !== "{}") fs.writeFileSync(out, json, "utf8");
    fs.writeFileSync(doneFlag, new Date().toISOString());
  } catch (e) {
    console.warn("No se pudieron migrar los ajustes", e);
  } finally {
    win?.destroy();
    try {
      fs.unlinkSync(page);
    } catch {
      /* ya no está */
    }
  }
}

/**
 * Ajustes guardados cuando la app se abría como http://127.0.0.1:puerto:
 * ahora se abre como http://localhost:puerto (otro origen, otro
 * localStorage). Se leen una sola vez con una ventana oculta y se suman a
 * storage-migration.json; la app los toma al arrancar sin pisar nada.
 */
async function collectLoopbackStorage(app, BrowserWindow, legacyUrl) {
  const dir = app.getPath("userData");
  const doneFlag = path.join(dir, "storage-localhost.flag");
  const out = path.join(dir, "storage-migration.json");
  if (!legacyUrl || fs.existsSync(doneFlag)) return;
  let win = null;
  try {
    win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    await win.loadURL(new URL("__storage", legacyUrl).toString());
    const json = await win.webContents.executeJavaScript(`(() => {
      const o = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("bross.") && k !== "bross.library.v1") o[k] = localStorage.getItem(k);
      }
      return JSON.stringify(o);
    })()`);
    const found = JSON.parse(json || "{}");
    if (Object.keys(found).length) {
      let prev = {};
      try {
        prev = JSON.parse(fs.readFileSync(out, "utf8"));
      } catch {
        /* no había otra migración pendiente */
      }
      // lo más nuevo (127.0.0.1) gana sobre lo de file://
      fs.writeFileSync(out, JSON.stringify({ ...prev, ...found }), "utf8");
    }
    fs.writeFileSync(doneFlag, new Date().toISOString());
  } catch (e) {
    console.warn("No se pudieron migrar los ajustes de 127.0.0.1", e);
  } finally {
    win?.destroy();
  }
}

/** La app nueva pide los ajustes migrados (una sola vez). */
function registerMigrationIpc(ipcMain, app) {
  const out = path.join(app.getPath("userData"), "storage-migration.json");
  ipcMain.on("bross:storage-migration", (event) => {
    try {
      const json = fs.readFileSync(out, "utf8");
      fs.unlinkSync(out);
      event.returnValue = json;
    } catch {
      event.returnValue = null;
    }
  });
}

module.exports = { collectLegacyStorage, collectLoopbackStorage, registerMigrationIpc };
