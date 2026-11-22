// Biblioteca en disco: SQLite (node:sqlite, incluido en Electron) en la
// carpeta de datos de la app, con búsqueda FTS5.
//
// El renderer sigue hablando el mismo formato de siempre (un objeto
// StoredLibrary en JSON): al guardar, acá se compara con lo que ya hay y solo
// se escriben las filas que cambiaron. Si existe un `library.json` de una
// versión anterior se importa una vez y queda como `library.json.bak`.
const fs = require("fs");
const path = require("path");

const MAX_BYTES = 200 * 1024 * 1024;
const SCHEMA_VERSION = 1;

function openDb(file) {
  // require diferido: node:sqlite imprime una advertencia experimental al cargarse
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS folders (
      path TEXT PRIMARY KEY, name TEXT NOT NULL, parent TEXT, favorite INTEGER NOT NULL DEFAULT 0, pos INTEGER
    );
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      source_path TEXT,
      title TEXT, artist TEXT, album TEXT, genre TEXT, file_name TEXT,
      data TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
      id UNINDEXED, title, artist, album, genre, file_name,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, pos INTEGER, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS history (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, track_id TEXT, title TEXT, artist TEXT, at INTEGER
    );
    CREATE INDEX IF NOT EXISTS history_at ON history(at);
    CREATE TABLE IF NOT EXISTS sidelist (pos INTEGER PRIMARY KEY, track_id TEXT NOT NULL);
  `);
  db.prepare("INSERT OR IGNORE INTO meta(key, value) VALUES ('schema', ?)").run(String(SCHEMA_VERSION));
  return db;
}

function tx(db, fn) {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Arma el objeto StoredLibrary a partir de las tablas. */
function readLibrary(db) {
  const folders = db
    .prepare("SELECT path, name, parent, favorite FROM folders ORDER BY pos, rowid")
    .all()
    .map((r) => ({ path: r.path, name: r.name, parent: r.parent ?? null, favorite: !!r.favorite }));
  const tracks = db
    .prepare("SELECT data FROM tracks ORDER BY rowid")
    .all()
    .map((r) => JSON.parse(r.data));
  const playlists = db
    .prepare("SELECT data FROM playlists ORDER BY pos, rowid")
    .all()
    .map((r) => JSON.parse(r.data));
  const history = db
    .prepare("SELECT * FROM (SELECT seq, track_id, title, artist, at FROM history ORDER BY seq DESC LIMIT 50000) ORDER BY seq")
    .all()
    .map((r) => ({ trackId: r.track_id, title: r.title ?? "", artist: r.artist ?? "", at: r.at }));
  const sidelist = db
    .prepare("SELECT track_id FROM sidelist ORDER BY pos")
    .all()
    .map((r) => r.track_id);
  return { folders, tracks, playlists, history, sidelist };
}

function isEmpty(db) {
  return (
    !db.prepare("SELECT 1 FROM tracks LIMIT 1").get() &&
    !db.prepare("SELECT 1 FROM folders LIMIT 1").get() &&
    !db.prepare("SELECT 1 FROM playlists LIMIT 1").get()
  );
}

const str = (v) => (typeof v === "string" ? v : "");

/** Sincroniza las tablas con el objeto que manda la UI (solo escribe diferencias). */
function writeLibrary(db, lib) {
  const tracks = Array.isArray(lib.tracks) ? lib.tracks.filter((t) => t && typeof t.id === "string") : [];
  const folders = Array.isArray(lib.folders) ? lib.folders.filter((f) => f && typeof f.path === "string") : [];
  const playlists = Array.isArray(lib.playlists) ? lib.playlists.filter((p) => p && typeof p.id === "string") : [];
  const history = Array.isArray(lib.history) ? lib.history : [];
  const sidelist = Array.isArray(lib.sidelist) ? lib.sidelist.filter((id) => typeof id === "string") : [];

  tx(db, () => {
    // pistas: se compara el JSON guardado con el nuevo
    const existing = new Map(db.prepare("SELECT id, data FROM tracks").all().map((r) => [r.id, r.data]));
    const upsert = db.prepare(
      `INSERT INTO tracks(id, source_path, title, artist, album, genre, file_name, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET source_path = excluded.source_path, title = excluded.title,
         artist = excluded.artist, album = excluded.album, genre = excluded.genre,
         file_name = excluded.file_name, data = excluded.data`,
    );
    const ftsDel = db.prepare("DELETE FROM tracks_fts WHERE id = ?");
    const ftsIns = db.prepare("INSERT INTO tracks_fts(id, title, artist, album, genre, file_name) VALUES (?, ?, ?, ?, ?, ?)");
    const del = db.prepare("DELETE FROM tracks WHERE id = ?");
    const seen = new Set();
    for (const t of tracks) {
      seen.add(t.id);
      const data = JSON.stringify(t);
      if (existing.get(t.id) === data) continue;
      const row = [str(t.title), str(t.artist), str(t.album), str(t.genre), str(t.fileName)];
      upsert.run(t.id, str(t.sourcePath) || null, ...row, data);
      ftsDel.run(t.id);
      ftsIns.run(t.id, ...row);
    }
    for (const id of existing.keys()) {
      if (seen.has(id)) continue;
      del.run(id);
      ftsDel.run(id);
    }

    // carpetas, listas y sidelist son chicas: se reescriben
    db.exec("DELETE FROM folders");
    const insF = db.prepare("INSERT OR REPLACE INTO folders(path, name, parent, favorite, pos) VALUES (?, ?, ?, ?, ?)");
    folders.forEach((f, i) => insF.run(f.path, str(f.name), f.parent ?? null, f.favorite ? 1 : 0, i));
    db.exec("DELETE FROM playlists");
    const insP = db.prepare("INSERT OR REPLACE INTO playlists(id, pos, data) VALUES (?, ?, ?)");
    playlists.forEach((p, i) => insP.run(p.id, i, JSON.stringify(p)));
    db.exec("DELETE FROM sidelist");
    const insS = db.prepare("INSERT INTO sidelist(pos, track_id) VALUES (?, ?)");
    sidelist.forEach((id, i) => insS.run(i, id));

    // historial: solo se agrega lo nuevo (la UI manda los últimos N)
    const last = db.prepare("SELECT MAX(at) AS at FROM history").get()?.at ?? -1;
    const insH = db.prepare("INSERT INTO history(track_id, title, artist, at) VALUES (?, ?, ?, ?)");
    for (const h of history) {
      if (!h || typeof h.at !== "number" || h.at <= last) continue;
      insH.run(str(h.trackId), str(h.title), str(h.artist), h.at);
    }
  });
}

/**
 * Texto del buscador → consulta FTS5: cada palabra es un prefijo y todas
 * tienen que aparecer (en cualquier campo). Se quitan los caracteres que
 * FTS5 interpreta como operadores.
 */
function ftsQuery(text) {
  const words = String(text ?? "")
    .normalize("NFKC")
    .split(/[\s"'()*:^+\-.,;/\\[\]{}<>|!?&@#$%=~`]+/)
    .filter(Boolean)
    .slice(0, 12);
  if (!words.length) return null;
  return words.map((w) => `"${w.replace(/"/g, "")}"*`).join(" ");
}

function searchLibrary(db, text, limit = 5000) {
  const q = ftsQuery(text);
  if (!q) return [];
  try {
    return db
      .prepare("SELECT id FROM tracks_fts WHERE tracks_fts MATCH ? ORDER BY rank LIMIT ?")
      .all(q, limit)
      .map((r) => r.id);
  } catch {
    return [];
  }
}

/** Importa el library.json de versiones anteriores (una sola vez). */
function migrateJson(db, jsonFile) {
  if (!fs.existsSync(jsonFile) || !isEmpty(db)) return false;
  try {
    const lib = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
    writeLibrary(db, lib);
    fs.renameSync(jsonFile, `${jsonFile}.bak`);
    return true;
  } catch (e) {
    console.warn("No se pudo migrar library.json", e);
    return false;
  }
}

/** Copia consistente de la base (para sincronizar con una carpeta). */
function backupTo(db, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  try {
    fs.rmSync(tmp, { force: true });
  } catch {
    /* sin temporal previo */
  }
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  fs.renameSync(tmp, target);
}

/** Lee otra base (la de la carpeta de sincronización) como StoredLibrary. */
function readOther(file) {
  const { DatabaseSync } = require("node:sqlite");
  const other = new DatabaseSync(file, { readOnly: true });
  try {
    return readLibrary(other);
  } finally {
    other.close();
  }
}

const SYNC_NAME = "bross-library.db";

function registerLibraryIpc(ipcMain, dbFile, legacyJson, ui) {
  let db = null;
  const getDb = () => {
    if (!db) {
      db = openDb(dbFile);
      if (legacyJson) migrateJson(db, legacyJson);
    }
    return db;
  };

  // lectura sincrónica: la UI la necesita para arrancar con la biblioteca
  ipcMain.on("bross:library-load", (event) => {
    try {
      const d = getDb();
      event.returnValue = isEmpty(d) ? null : JSON.stringify(readLibrary(d));
    } catch (e) {
      console.warn("No se pudo abrir la biblioteca", e);
      event.returnValue = null;
    }
  });

  let pending = Promise.resolve();
  ipcMain.handle("bross:library-save", (_event, json) => {
    if (typeof json !== "string" || json.length > MAX_BYTES) return false;
    pending = pending
      .then(() => writeLibrary(getDb(), JSON.parse(json)))
      .catch((e) => console.warn("No se pudo guardar la biblioteca", e));
    return pending.then(() => true);
  });

  ipcMain.handle("bross:library-search", (_event, text) => {
    if (typeof text !== "string" || text.length > 500) return [];
    return searchLibrary(getDb(), text);
  });

  // ── sincronización con una carpeta (OneDrive, Dropbox, un pendrive…) ──
  const syncDir = () => getDb().prepare("SELECT value FROM meta WHERE key = 'syncDir'").get()?.value ?? null;
  const syncInfo = () => {
    const dir = syncDir();
    if (!dir) return { dir: null, mtime: null };
    try {
      return { dir, mtime: fs.statSync(path.join(dir, SYNC_NAME)).mtimeMs };
    } catch {
      return { dir, mtime: null };
    }
  };

  ipcMain.handle("bross:library-sync-info", () => syncInfo());

  ipcMain.handle("bross:library-sync-pick", async (event) => {
    if (!ui) return null;
    const win = ui.BrowserWindow.fromWebContents(event.sender);
    const res = await ui.dialog.showOpenDialog(win, {
      title: "Carpeta para sincronizar la biblioteca",
      buttonLabel: "Usar esta carpeta",
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || !res.filePaths.length) return null;
    getDb().prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('syncDir', ?)").run(res.filePaths[0]);
    return syncInfo();
  });

  ipcMain.handle("bross:library-sync-clear", () => {
    getDb().prepare("DELETE FROM meta WHERE key = 'syncDir'").run();
    return syncInfo();
  });

  /** Sube: copia la base actual a la carpeta (después de los guardados pendientes). */
  ipcMain.handle("bross:library-sync-push", async () => {
    const dir = syncDir();
    if (!dir) return null;
    await pending;
    backupTo(getDb(), path.join(dir, SYNC_NAME));
    return syncInfo();
  });

  /** Baja: devuelve la biblioteca de la carpeta para que la UI la combine. */
  ipcMain.handle("bross:library-sync-pull", () => {
    const dir = syncDir();
    if (!dir) return null;
    const file = path.join(dir, SYNC_NAME);
    if (!fs.existsSync(file)) return null;
    return JSON.stringify(readOther(file));
  });

  return {
    get db() {
      return getDb();
    },
    flush: () => pending,
  };
}

module.exports = {
  registerLibraryIpc,
  openDb,
  readLibrary,
  writeLibrary,
  searchLibrary,
  ftsQuery,
  migrateJson,
  backupTo,
  readOther,
};
