// Biblioteca en SQLite (proceso principal) y carpetas filtro (mini-DSL).
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { evalFilter, parseFilter, tryParseFilter, type FilterTrack } from "../src/filterDsl";
import { historyTree, mergeLibrary, playStats, playlistDescendants, suggestFromHistory, type Playlist, type StoredLibrary } from "../src/library";

const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, "..");
const lib = require(path.join(root, "electron/library.cjs"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bross-lib-"));
const opened: { close(): void }[] = [];
const open = (name: string) => {
  const db = lib.openDb(path.join(tmp, name));
  opened.push(db);
  return db;
};
afterAll(() => {
  opened.forEach((db) => db.close());
  fs.rmSync(tmp, { recursive: true, force: true });
});

const track = (id: string, title: string, artist: string, extra: object = {}) => ({
  id,
  fileName: `${title}.mp3`,
  title,
  artist,
  duration: 200,
  analysis: null,
  sourcePath: `C:\\Musica\\${title}.mp3`,
  dir: "C:\\Musica",
  ...extra,
});

describe("biblioteca SQLite", () => {
  it("guarda y vuelve a leer el mismo contenido", () => {
    const db = open("a.db");
    const data = {
      folders: [{ path: "C:\\Musica", name: "Musica", parent: null, favorite: true }],
      tracks: [track("1", "Canción Única", "Daft Punk", { genre: "House" }), track("2", "Otra", "Justice")],
      playlists: [
        { id: "f", name: "Sets", trackIds: [], kind: "folder", parent: null },
        { id: "p", name: "Warmup", trackIds: ["2", "1"], parent: "f" },
      ],
      history: [{ trackId: "1", title: "Canción Única", artist: "Daft Punk", at: 1000 }],
      sidelist: ["2"],
    };
    lib.writeLibrary(db, data);
    expect(lib.readLibrary(db)).toEqual(data);
  });

  it("busca con FTS5 por prefijo y sin acentos, y sigue los cambios", () => {
    const db = open("b.db");
    const base = { folders: [], playlists: [], history: [], sidelist: [] };
    lib.writeLibrary(db, { ...base, tracks: [track("1", "Canción Única", "Daft Punk"), track("2", "Otra", "Justice")] });
    expect(lib.searchLibrary(db, "cancion")).toEqual(["1"]);
    expect(lib.searchLibrary(db, "daf uni")).toEqual(["1"]);
    expect(lib.searchLibrary(db, "jus")).toEqual(["2"]);
    expect(lib.searchLibrary(db, '"(*')).toEqual([]);
    // renombrar y borrar actualiza el índice
    lib.writeLibrary(db, { ...base, tracks: [track("2", "Otra", "Kavinsky")] });
    expect(lib.searchLibrary(db, "cancion")).toEqual([]);
    expect(lib.searchLibrary(db, "kavin")).toEqual(["2"]);
    expect(lib.searchLibrary(db, "justice")).toEqual([]);
  });

  it("el historial solo agrega lo nuevo aunque la UI mande una ventana", () => {
    const db = open("c.db");
    const base = { folders: [], tracks: [], playlists: [], sidelist: [] };
    const h = (at: number) => ({ trackId: "x", title: "t", artist: "a", at });
    lib.writeLibrary(db, { ...base, history: [h(1), h(2)] });
    lib.writeLibrary(db, { ...base, history: [h(2), h(3)] });
    expect(lib.readLibrary(db).history.map((x: { at: number }) => x.at)).toEqual([1, 2, 3]);
  });

  it("migra library.json una sola vez y lo deja como .bak", () => {
    const json = path.join(tmp, "library.json");
    fs.writeFileSync(json, JSON.stringify({ folders: [], tracks: [track("9", "Vieja", "X")], playlists: [], history: [], sidelist: [] }));
    const db = open("d.db");
    expect(lib.migrateJson(db, json)).toBe(true);
    expect(fs.existsSync(`${json}.bak`)).toBe(true);
    expect(lib.readLibrary(db).tracks[0].title).toBe("Vieja");
    expect(lib.migrateJson(db, json)).toBe(false);
  });

  it("copia la base a otra carpeta y la puede leer", () => {
    const db = open("e.db");
    lib.writeLibrary(db, { folders: [], tracks: [track("1", "Sync", "Y")], playlists: [], history: [], sidelist: [] });
    const target = path.join(tmp, "sync", "bross-library.db");
    lib.backupTo(db, target);
    expect(lib.readOther(target).tracks[0].title).toBe("Sync");
  });
});

const ft = (o: Partial<FilterTrack>): FilterTrack => ({
  title: "",
  artist: "",
  bpm: null,
  key: null,
  played: 0,
  lastPlayed: null,
  ...o,
});

describe("carpetas filtro", () => {
  const t = ft({ title: "Around the World", artist: "Daft Punk", genre: "French House", year: "1997", bpm: 121.3, key: "8A", played: 4, duration: 427 });

  it("entiende rangos, comparaciones y texto", () => {
    expect(evalFilter(parseFilter("bpm 120..128")!, t)).toBe(true);
    expect(evalFilter(parseFilter("bpm > 125")!, t)).toBe(false);
    expect(evalFilter(parseFilter("genre contains house and year < 2000")!, t)).toBe(true);
    expect(evalFilter(parseFilter("daft world")!, t)).toBe(true);
    expect(evalFilter(parseFilter('artist = "Daft Punk"')!, t)).toBe(true);
    expect(evalFilter(parseFilter("played >= 4 and length > 7:00")!, t)).toBe(true);
  });

  it("key ~ y bpm ~ usan compatibilidad", () => {
    expect(evalFilter(parseFilter("key ~ 9A")!, t)).toBe(true);
    expect(evalFilter(parseFilter("key ~ 8B")!, t)).toBe(true);
    expect(evalFilter(parseFilter("key ~ 3B")!, t)).toBe(false);
    expect(evalFilter(parseFilter("bpm ~ 60.5")!, t)).toBe(true);
  });

  it("or, not y paréntesis", () => {
    expect(evalFilter(parseFilter("not artist contains daft")!, t)).toBe(false);
    expect(evalFilter(parseFilter("(genre contains techno or genre contains house) and bpm < 130")!, t)).toBe(true);
    expect(evalFilter(parseFilter("lastplayed > 30")!, t)).toBe(true);
  });

  it("informa errores en vez de romperse", () => {
    expect(tryParseFilter("(bpm > 1").error).toMatch(/paréntesis/);
    expect(tryParseFilter("bpm >").error).toBeTruthy();
    expect(tryParseFilter("").tree).toBeNull();
  });
});

describe("historial y listas", () => {
  it("agrupa el historial por año y mes, y cuenta reproducciones", () => {
    const at = (y: number, m: number) => new Date(y, m, 10).getTime();
    const h = [
      { trackId: "a", title: "", artist: "", at: at(2025, 11) },
      { trackId: "a", title: "", artist: "", at: at(2026, 0) },
      { trackId: "b", title: "", artist: "", at: at(2026, 0) },
      { trackId: "a", title: "", artist: "", at: at(2026, 3) },
    ];
    expect(historyTree(h)).toEqual([
      { year: 2026, count: 3, months: [{ month: 3, count: 1 }, { month: 0, count: 2 }] },
      { year: 2025, count: 1, months: [{ month: 11, count: 1 }] },
    ]);
    expect(playStats(h).get("a")).toEqual({ count: 3, last: at(2026, 3) });
  });

  it("borrar una carpeta incluye todo lo que tiene adentro", () => {
    const p = (id: string, parent?: string): Playlist => ({ id, name: id, trackIds: [], parent });
    const lists = [p("root"), p("a", "root"), p("b", "a"), p("c")];
    expect([...playlistDescendants(lists, "root")].sort()).toEqual(["a", "b", "root"]);
  });
});

describe("sugerencias y sincronización", () => {
  it("sugiere lo que vino después del tema en otros sets", () => {
    const min = 60000;
    const h = (trackId: string, at: number) => ({ trackId, title: "", artist: "", at });
    const hist = [h("a", 0), h("b", 5 * min), h("c", 10 * min), h("a", 1000 * min), h("b", 1005 * min), h("a", 2000 * min), h("d", 2100 * min)];
    // "d" vino 100 min después (otra sesión): no cuenta
    expect(suggestFromHistory(hist, "a")).toEqual(["b", "c"]);
    expect(suggestFromHistory(hist, null)).toEqual([]);
  });

  it("combinar con la carpeta agrega lo que falta y gana lo local", () => {
    const t = (id: string, title: string, extra: object = {}) => ({ id, fileName: title, title, artist: "", duration: 1, analysis: null, ...extra });
    const local: StoredLibrary = {
      folders: [],
      tracks: [t("1", "local", { sourcePath: "C:/m/a.mp3" })],
      playlists: [{ id: "p", name: "mía", trackIds: [] }],
      history: [{ trackId: "1", title: "", artist: "", at: 5 }],
      sidelist: ["1"],
    };
    const remote: StoredLibrary = {
      folders: [{ path: "D:/m", name: "m", parent: null, favorite: false }],
      tracks: [t("9", "remoto", { sourcePath: "c:/M/A.mp3", genre: "House" }), t("2", "nueva")],
      playlists: [{ id: "p", name: "otra", trackIds: [] }, { id: "q", name: "nueva", trackIds: [] }],
      history: [{ trackId: "1", title: "", artist: "", at: 5 }, { trackId: "2", title: "", artist: "", at: 1 }],
      sidelist: [],
    };
    const m = mergeLibrary(local, remote);
    expect(m.tracks.map((x) => x.title)).toEqual(["local", "nueva"]);
    expect(m.tracks[0].genre).toBe("House");
    expect(m.playlists.map((p) => p.name)).toEqual(["mía", "nueva"]);
    expect(m.history.map((x) => x.at)).toEqual([1, 5]);
    expect(m.folders).toHaveLength(1);
    expect(m.sidelist).toEqual(["1"]);
  });
});
