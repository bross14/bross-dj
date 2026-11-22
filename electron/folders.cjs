// Escaneo de carpetas de música y lectura de archivos para el navegador.
// Se registra desde electron/main.cjs.
//
// Seguridad: el renderer solo puede escanear y leer dentro de las carpetas
// que el usuario eligió en el diálogo nativo (se guardan en userData). Así,
// aunque el renderer se viera comprometido, no puede pedir archivos
// arbitrarios del disco por IPC.
const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const { writeTagsToFile, sanitizeTags, WRITABLE } = require("./tagwriter.cjs");

/** Extensiones que el motor puede decodificar. */
const AUDIO_EXT = new Set([
  ".mp3", ".wav", ".flac", ".ogg", ".oga", ".m4a", ".mp4",
  ".aac", ".aif", ".aiff", ".opus", ".webm",
]);

/** Carpetas que nunca conviene recorrer. */
const SKIP_DIRS = new Set([
  "node_modules", "$recycle.bin", "system volume information",
  "appdata", "windows", "program files", "program files (x86)",
]);

const MAX_FILES = 5000;
const MAX_DEPTH = 16;

async function walk(dir, parent, out, depth = 0) {
  if (depth > MAX_DEPTH || out.files.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // sin permisos o carpeta borrada
  }
  out.folders.push({
    path: dir,
    name: path.basename(dir) || dir,
    parent,
  });
  for (const entry of entries) {
    if (out.files.length >= MAX_FILES) return;
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
      await walk(full, dir, out, depth + 1);
    } else if (entry.isFile()) {
      if (!AUDIO_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      out.files.push({ path: full, name: entry.name, dir });
    }
  }
}

const norm = (p) => {
  const r = path.resolve(p);
  return process.platform === "win32" ? r.toLowerCase() : r;
};

/** ¿`child` es `root` o está dentro de `root`? */
function isWithin(child, root) {
  const c = norm(child);
  const r = norm(root);
  if (c === r) return true;
  return c.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

/** Lista persistente de carpetas autorizadas por el usuario. */
function createRootStore(file) {
  let roots = [];
  let existed = false;
  if (file) {
    try {
      const parsed = JSON.parse(fsSync.readFileSync(file, "utf8"));
      if (Array.isArray(parsed)) roots = parsed.filter((p) => typeof p === "string");
      existed = true;
    } catch {
      /* primera vez o archivo dañado */
    }
  }
  const save = () => {
    if (!file) return;
    try {
      fsSync.mkdirSync(path.dirname(file), { recursive: true });
      fsSync.writeFileSync(file, JSON.stringify(roots, null, 2));
      existed = true;
    } catch (e) {
      console.warn("No se pudo guardar la lista de carpetas", e);
    }
  };
  // guarda la ruta tal cual y su destino real (carpetas que son accesos
  // directos o junctions, como Música dentro de OneDrive)
  const push = (dir) => {
    const r = path.resolve(dir);
    const variants = [r];
    try {
      variants.push(fsSync.realpathSync(r));
    } catch {
      /* la carpeta ya no existe */
    }
    for (const v of variants) if (!roots.some((x) => norm(x) === norm(v))) roots.push(v);
  };
  return {
    get existed() {
      return existed;
    },
    add(dir) {
      push(dir);
      save();
    },
    allows(p) {
      return roots.some((root) => isWithin(p, root));
    },
    /** Migración única: sin lista guardada, se aceptan las carpetas que ya
     *  tenía la biblioteca. Después de la primera vez se ignora. */
    migrate(dirs) {
      if (existed) return false;
      for (const d of dirs) {
        if (typeof d === "string" && path.isAbsolute(d)) push(d);
      }
      save();
      return true;
    },
  };
}

function registerFolderIpc(ipcMain, dialog, BrowserWindow, storeFile) {
  const store = createRootStore(storeFile);

  ipcMain.handle("bross:pick-folder", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showOpenDialog(win, {
      title: "Agregar carpeta de música",
      buttonLabel: "Agregar",
      properties: ["openDirectory"],
    });
    if (res.canceled || !res.filePaths.length) return null;
    const dir = res.filePaths[0];
    store.add(dir);
    return { path: dir, name: path.basename(dir) || dir };
  });

  // archivos sueltos importados con el selector o arrastrando: se autoriza
  // cada archivo (solo audio, y tiene que existir) para poder releerlo después
  ipcMain.handle("bross:authorize-files", async (_event, files) => {
    if (!Array.isArray(files)) return [];
    const ok = [];
    for (const f of files.slice(0, MAX_FILES)) {
      if (typeof f !== "string" || !path.isAbsolute(f)) continue;
      if (!AUDIO_EXT.has(path.extname(f).toLowerCase())) continue;
      try {
        const st = await fs.stat(f);
        if (!st.isFile()) continue;
      } catch {
        continue;
      }
      store.add(f);
      ok.push(f);
    }
    return ok;
  });

  ipcMain.handle("bross:register-roots", (_event, dirs) => {
    if (!Array.isArray(dirs)) return false;
    return store.migrate(dirs);
  });

  ipcMain.handle("bross:scan-folder", async (_event, dir) => {
    if (typeof dir !== "string" || dir.length === 0) return null;
    if (!store.allows(dir)) return null;
    const out = { folders: [], files: [] };
    await walk(dir, null, out);
    return out;
  });

  ipcMain.handle("bross:read-file", async (_event, file) => {
    if (typeof file !== "string" || file.length === 0) return null;
    if (!AUDIO_EXT.has(path.extname(file).toLowerCase())) return null;
    // realpath: un acceso directo dentro de la carpeta no puede apuntar afuera
    let real;
    try {
      real = await fs.realpath(file);
    } catch {
      return null;
    }
    if (!store.allows(file) || !store.allows(real)) return null;
    const data = await fs.readFile(real);
    return data; // en el renderer llega como Uint8Array
  });

  // edición de etiquetas (MP3 y FLAC) dentro de las carpetas autorizadas
  ipcMain.handle("bross:write-tags", async (_event, file, tags) => {
    if (typeof file !== "string" || file.length === 0) return { ok: false, error: "Ruta inválida" };
    if (!WRITABLE.has(path.extname(file).toLowerCase())) return { ok: false, error: "Formato sin escritura de etiquetas" };
    let real;
    try {
      real = await fs.realpath(file);
    } catch {
      return { ok: false, error: "El archivo ya no está" };
    }
    if (!store.allows(file) || !store.allows(real)) return { ok: false, error: "Archivo fuera de las carpetas de la biblioteca" };
    try {
      await writeTagsToFile(real, sanitizeTags(tags));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // solo el principio y el final del archivo: ahí van las etiquetas.
  // Leer miles de archivos completos para eso sería lentísimo.
  ipcMain.handle("bross:read-tag-region", async (_event, file) => {
    if (typeof file !== "string" || file.length === 0) return null;
    if (!AUDIO_EXT.has(path.extname(file).toLowerCase())) return null;
    let real;
    try {
      real = await fs.realpath(file);
    } catch {
      return null;
    }
    if (!store.allows(file) || !store.allows(real)) return null;
    const fd = await fs.open(real, "r");
    try {
      const { size } = await fd.stat();
      const headLen = Math.min(size, 512 * 1024);
      const head = Buffer.alloc(headLen);
      await fd.read(head, 0, headLen, 0);
      const tailLen = Math.min(size, 128 * 1024);
      const tail = Buffer.alloc(tailLen);
      await fd.read(tail, 0, tailLen, size - tailLen);
      return { head, tail, size };
    } finally {
      await fd.close();
    }
  });

  // archivo "hermano" de una pista (misma carpeta y nombre): letras .lrc,
  // gráficos de karaoke .cdg o texto .txt
  ipcMain.handle("bross:read-sidecar", async (_event, file, ext) => {
    if (typeof file !== "string" || ![".lrc", ".cdg", ".txt"].includes(ext)) return null;
    if (!AUDIO_EXT.has(path.extname(file).toLowerCase())) return null;
    const side = file.slice(0, -path.extname(file).length) + ext;
    let real;
    try {
      real = await fs.realpath(side);
    } catch {
      return null;
    }
    // vale si la pista está autorizada y el archivo hermano está en su misma carpeta
    let realTrack;
    try {
      realTrack = await fs.realpath(file);
    } catch {
      return null;
    }
    if (!store.allows(file) || !store.allows(realTrack)) return null;
    if (path.dirname(real).toLowerCase() !== path.dirname(realTrack).toLowerCase()) return null;
    const st = await fs.stat(real);
    if (!st.isFile() || st.size > 20 * 1024 * 1024) return null;
    return fs.readFile(real);
  });

  return store;
}

module.exports = { registerFolderIpc, walk, isWithin, createRootStore, AUDIO_EXT, MAX_FILES, MAX_DEPTH };
