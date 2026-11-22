import type { LibraryTrack, TrackPois } from "./engine/audio";

/** Puente que expone electron/preload.cjs (no existe en el navegador). */
export interface BrossBridge {
  isDesktop: boolean;
  /** Spotify: solo lectura de playlists (no reproduce) */
  spotifyStatus?(): Promise<{ connected: boolean; user?: string | null; error?: string | null }>;
  spotifyLogin?(): Promise<{ ok: boolean; user?: string | null; error?: string }>;
  spotifyLogout?(): Promise<boolean>;
  spotifyGet?(urlOrPath: string): Promise<{ ok: boolean; data?: unknown; status?: number; error?: string }>;
  /** botones de ventana (la ventana de escritorio no tiene barra de título) */
  winMinimize?(): void;
  winToggleMaximize?(): void;
  winClose?(): void;
  winIsMaximized?(): Promise<boolean>;
  onWinState?(cb: (s: { maximized: boolean }) => void): () => void;
  pickFolder(): Promise<{ path: string; name: string } | null>;
  scanFolder(dir: string): Promise<{
    folders: { path: string; name: string; parent: string | null }[];
    files: { path: string; name: string; dir: string }[];
  } | null>;
  readFile(file: string): Promise<Uint8Array | null>;
  /** principio (512 KB) y final (128 KB) del archivo, para las etiquetas */
  readTagRegion?(file: string): Promise<{ head: Uint8Array; tail: Uint8Array; size: number } | null>;
  /** letras (.lrc), gráficos de karaoke (.cdg) o texto junto a la pista */
  readSidecar?(file: string, ext: ".lrc" | ".cdg" | ".txt"): Promise<Uint8Array | null>;
  /** pantalla de video a pantalla completa (en el segundo monitor si hay) */
  screenFullscreen?(on: boolean): Promise<boolean>;
  /** escribe etiquetas en el archivo (MP3 / FLAC) */
  writeTags?(file: string, tags: EditableTags): Promise<{ ok: boolean; error?: string }>;
  /** migración única: autoriza las carpetas ya guardadas en la biblioteca */
  registerRoots?(dirs: string[]): Promise<boolean>;
  /** ruta real de un File elegido con el selector o arrastrado */
  pathForFile?(file: File): string | null;
  /** autoriza archivos sueltos para poder releerlos en otra sesión */
  authorizeFiles?(files: string[]): Promise<string[]>;
  /** biblioteca en disco (carpeta de datos de la app) */
  loadLibraryFile?(): string | null;
  /** ajustes de la versión anterior (file://), una sola vez */
  takeStorageMigration?(): string | null;
  saveLibraryFile?(json: string): Promise<boolean>;
  /** búsqueda FTS5 en la base (ids de pista, por relevancia) */
  searchLibrary?(text: string): Promise<string[]>;
  /** sincronización de la biblioteca con una carpeta elegida por el usuario */
  librarySyncInfo?(): Promise<SyncInfo>;
  librarySyncPick?(): Promise<SyncInfo | null>;
  librarySyncClear?(): Promise<SyncInfo>;
  librarySyncPush?(): Promise<SyncInfo | null>;
  librarySyncPull?(): Promise<string | null>;
  /** grabación del set (WAV en Música/BROSS DJ) */
  recStart?(opts: { sampleRate: number; channels: number; format: string; split: boolean }): Promise<{ path: string } | null>;
  recChunk?(chunk: Uint8Array): void;
  /** video en vivo por RTMP (usa el ffmpeg instalado) */
  rtmpCheck?(): Promise<string | null>;
  rtmpStart?(opts: { url: string; key: string; kbps: number }): Promise<{ ok: boolean; error?: string; version?: string }>;
  rtmpChunk?(chunk: Uint8Array): void;
  rtmpStop?(): Promise<boolean>;
  onRtmpStatus?(cb: (s: { live: boolean; error: string | null }) => void): () => void;
  /** genera el WAV del timecode propio para DVS */
  tcGenerate?(minutes: number): Promise<{ path: string; seconds: number } | null>;
  /** grabación de video (WebM / MP4) */
  vrecStart?(opts: { format: "webm" | "mp4" }): Promise<{ path: string } | null>;
  vrecChunk?(chunk: Uint8Array): void;
  vrecStop?(): Promise<{ path: string; seconds: number; bytes: number } | null>;
  /** streaming en vivo (Icecast + servidor en la red local) */
  streamStart?(opts: StreamOptions): Promise<StreamStatus>;
  streamStop?(): Promise<void>;
  streamChunk?(chunk: Uint8Array): void;
  streamSong?(text: string): Promise<boolean>;
  streamStatus?(): Promise<StreamStatus>;
  streamRequests?(): Promise<SongRequest[]>;
  onStreamStatus?(cb: (s: StreamStatus) => void): () => void;
  onStreamRequest?(cb: (r: SongRequest) => void): () => void;
  recStop?(extra: { tracks: { sec: number; title: string; artist: string }[] }): Promise<{
    path: string;
    seconds: number;
    warning: string | null;
    split: { dir: string; count: number } | null;
  } | null>;
}

export interface StreamOptions {
  sampleRate: number;
  channels: number;
  kbps: number;
  name: string;
  icecast: { url: string; mount: string; user: string; password: string } | null;
  lan: { enabled: boolean; port: number; requests: boolean } | null;
}

export interface StreamStatus {
  live: boolean;
  icecast: "off" | "connecting" | "on" | "error";
  listeners: number;
  lan: { port: number; addresses: string[] } | null;
  error: string | null;
}

export interface SongRequest {
  id: string;
  name: string;
  song: string;
  at: number;
}

export interface EditableTags {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: string;
  bpm?: number | string;
  key?: string;
}

/** ¿Se pueden escribir las etiquetas en este archivo? */
export function canWriteTags(path: string | undefined): boolean {
  return !!path && /\.(mp3|flac)$/i.test(path);
}

export interface SyncInfo {
  dir: string | null;
  /** última copia en la carpeta (ms) */
  mtime: number | null;
}

declare global {
  interface Window {
    bross?: BrossBridge;
  }
}

/** Carpeta agregada al navegador (se guarda en disco, no se copia nada). */
export interface LibraryFolder {
  path: string;
  name: string;
  /** ruta de la carpeta madre dentro de la biblioteca (null = raíz) */
  parent: string | null;
  favorite: boolean;
}

const STORAGE_KEY = "bross.library.v1";

interface StoredTrack {
  id: string;
  fileName: string;
  title: string;
  artist: string;
  duration: number;
  analysis: LibraryTrack["analysis"];
  /** cue, hot cues y loops guardados */
  pois?: TrackPois;
  sourcePath?: string;
  dir?: string;
  album?: string;
  genre?: string;
  year?: string;
  tagBpm?: number;
  tagKey?: string;
  tagged?: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  /** lista común (default), carpeta virtual que agrupa listas o carpeta filtro */
  kind?: "list" | "folder" | "filter";
  /** carpeta virtual que la contiene (null / undefined = raíz) */
  parent?: string | null;
  /** texto del mini-DSL (solo carpetas filtro) */
  filter?: string;
}

/** Cuántas veces sonó cada pista y cuándo fue la última. */
export function playStats(history: HistoryEntry[]): Map<string, { count: number; last: number }> {
  const out = new Map<string, { count: number; last: number }>();
  for (const h of history) {
    const s = out.get(h.trackId);
    if (s) {
      s.count++;
      if (h.at > s.last) s.last = h.at;
    } else out.set(h.trackId, { count: 1, last: h.at });
  }
  return out;
}

/**
 * Sugerencias locales a partir del historial: qué pistas sonaron justo
 * después de `trackId` en otras sesiones (como "Genius", pero con tus sets).
 * Pesa más lo reciente y lo que se repite. Devuelve ids ordenados.
 */
export function suggestFromHistory(history: HistoryEntry[], trackId: string | null, limit = 50): string[] {
  if (!trackId) return [];
  const score = new Map<string, number>();
  const now = history.length ? history[history.length - 1].at : 0;
  for (let i = 0; i < history.length - 1; i++) {
    if (history[i].trackId !== trackId) continue;
    // las 3 que siguieron (dentro de la misma sesión: menos de 40 min de diferencia)
    for (let k = 1; k <= 3 && i + k < history.length; k++) {
      const next = history[i + k];
      if (next.at - history[i + k - 1].at > 40 * 60000) break;
      if (next.trackId === trackId) continue;
      const days = Math.max(0, (now - next.at) / 86400000);
      const w = (1 / k) * (1 / (1 + days / 60));
      score.set(next.trackId, (score.get(next.trackId) ?? 0) + w);
    }
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}

/** Historial agrupado: año → mes (0-11) → cantidad, del más nuevo al más viejo. */
export function historyTree(history: HistoryEntry[]): { year: number; count: number; months: { month: number; count: number }[] }[] {
  const years = new Map<number, Map<number, number>>();
  for (const h of history) {
    const d = new Date(h.at);
    const y = d.getFullYear();
    const m = d.getMonth();
    let ym = years.get(y);
    if (!ym) years.set(y, (ym = new Map()));
    ym.set(m, (ym.get(m) ?? 0) + 1);
  }
  return [...years.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, months]) => ({
      year,
      count: [...months.values()].reduce((a, b) => a + b, 0),
      months: [...months.entries()].sort((a, b) => b[0] - a[0]).map(([month, count]) => ({ month, count })),
    }));
}

/** Ids de las listas que quedan dentro de `id` (incluida), para borrar carpetas. */
export function playlistDescendants(playlists: Playlist[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of playlists) {
      if (p.parent && out.has(p.parent) && !out.has(p.id)) {
        out.add(p.id);
        grew = true;
      }
    }
  }
  return out;
}

export interface HistoryEntry {
  trackId: string;
  title: string;
  artist: string;
  /** milisegundos (Date.now) */
  at: number;
}

export interface StoredLibrary {
  folders: LibraryFolder[];
  tracks: StoredTrack[];
  playlists: Playlist[];
  history: HistoryEntry[];
  /** cola "sidelist": ids de pista en orden */
  sidelist: string[];
}

const EMPTY: StoredLibrary = { folders: [], tracks: [], playlists: [], history: [], sidelist: [] };

/** ¿`child` está dentro de `root` (o es la misma carpeta)? */
export function isInside(child: string, root: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase();
  const a = norm(child);
  const b = norm(root);
  return a === b || a.startsWith(b + "\\") || a.startsWith(b + "/");
}

function parseLibrary(raw: string | null | undefined): StoredLibrary | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<StoredLibrary>;
    return {
      folders: Array.isArray(p.folders) ? p.folders : [],
      tracks: Array.isArray(p.tracks) ? p.tracks : [],
      playlists: Array.isArray(p.playlists) ? p.playlists : [],
      history: Array.isArray(p.history) ? p.history : [],
      sidelist: Array.isArray(p.sidelist) ? p.sidelist : [],
    };
  } catch {
    return null;
  }
}

/**
 * En la app de escritorio la biblioteca vive en un archivo; si todavía no
 * existe, se migra la que estaba en localStorage.
 */
export function loadLibrary(): StoredLibrary {
  const bridge = typeof window !== "undefined" ? window.bross : undefined;
  if (bridge?.loadLibraryFile) {
    try {
      const fromFile = parseLibrary(bridge.loadLibraryFile());
      if (fromFile) return fromFile;
    } catch {
      /* sin archivo: se intenta con localStorage */
    }
  }
  try {
    return parseLibrary(localStorage.getItem(STORAGE_KEY)) ?? { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

/** Lo serializable de la biblioteca: los AudioBuffer se recuperan de disco al cargar. */
export function toStoredLibrary(
  folders: LibraryFolder[],
  tracks: LibraryTrack[],
  extra: { playlists: Playlist[]; history: HistoryEntry[]; sidelist: string[] },
): StoredLibrary {
  const slim: StoredTrack[] = tracks
    .filter((t) => t.sourcePath)
    .map((t) => ({
      id: t.id,
      fileName: t.fileName,
      title: t.title,
      artist: t.artist,
      duration: t.duration,
      analysis: t.analysis,
      pois: t.pois,
      sourcePath: t.sourcePath,
      dir: t.dir,
      album: t.album,
      genre: t.genre,
      year: t.year,
      tagBpm: t.tagBpm,
      tagKey: t.tagKey,
      tagged: t.tagged,
    }));
  const known = new Set(slim.map((t) => t.id));
  const data: StoredLibrary = {
    folders,
    tracks: slim,
    // las listas solo guardan pistas que se pueden volver a abrir
    playlists: extra.playlists.map((p) => ({ ...p, trackIds: p.trackIds.filter((id) => known.has(id)) })),
    history: extra.history.slice(-50000),
    sidelist: extra.sidelist.filter((id) => known.has(id)),
  };
  return data;
}

export function saveLibrary(
  folders: LibraryFolder[],
  tracks: LibraryTrack[],
  extra: { playlists: Playlist[]; history: HistoryEntry[]; sidelist: string[] },
) {
  const json = JSON.stringify(toStoredLibrary(folders, tracks, extra));
  const bridge = window.bross;
  if (bridge?.saveLibraryFile) {
    void bridge.saveLibraryFile(json).catch(() => undefined);
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch {
    /* cuota llena: seguimos sin persistir */
  }
}

/**
 * Combina la biblioteca de la carpeta de sincronización con la local.
 * Gana lo local cuando existe en los dos lados; de lo remoto se toma lo que
 * falta (pistas, listas, carpetas, cues/análisis vacíos) y el historial se une.
 */
export function mergeLibrary(local: StoredLibrary, remote: StoredLibrary): StoredLibrary {
  const tracks = new Map(local.tracks.map((t) => [t.id, t]));
  const byPath = new Map(local.tracks.filter((t) => t.sourcePath).map((t) => [t.sourcePath!.toLowerCase(), t.id]));
  for (const r of remote.tracks) {
    const id = tracks.has(r.id) ? r.id : r.sourcePath ? byPath.get(r.sourcePath.toLowerCase()) : undefined;
    const l = id ? tracks.get(id) : undefined;
    if (!l) {
      tracks.set(r.id, r);
      continue;
    }
    tracks.set(l.id, {
      ...l,
      analysis: l.analysis ?? r.analysis,
      pois: l.pois && (l.pois.cuePoint > 0 || l.pois.cues.some((c) => c != null)) ? l.pois : (r.pois ?? l.pois),
      album: l.album ?? r.album,
      genre: l.genre ?? r.genre,
      year: l.year ?? r.year,
    });
  }
  const folders = [...local.folders];
  const knownF = new Set(folders.map((f) => f.path.toLowerCase()));
  for (const f of remote.folders) if (!knownF.has(f.path.toLowerCase())) folders.push(f);
  const playlists = [...local.playlists];
  const knownP = new Set(playlists.map((p) => p.id));
  for (const p of remote.playlists) if (!knownP.has(p.id)) playlists.push(p);
  const seenH = new Set(local.history.map((h) => `${h.trackId}:${h.at}`));
  const history = [...local.history, ...remote.history.filter((h) => !seenH.has(`${h.trackId}:${h.at}`))].sort(
    (a, b) => a.at - b.at,
  );
  return { folders, tracks: [...tracks.values()], playlists, history, sidelist: local.sidelist };
}

export function parseStoredLibrary(raw: string | null | undefined): StoredLibrary | null {
  return parseLibrary(raw);
}

/** Reconstruye las pistas guardadas (sin buffer: se hidratan al cargarlas). */
export function restoreTracks(stored: StoredTrack[]): LibraryTrack[] {
  return stored.map((t) => ({
    id: t.id,
    fileName: t.fileName,
    title: t.title,
    artist: t.artist,
    duration: t.duration,
    peaks: [],
    bands: null,
    buffer: null,
    analysis: t.analysis ?? null,
    pois: t.pois,
    sourcePath: t.sourcePath,
    dir: t.dir,
    album: t.album,
    genre: t.genre,
    year: t.year,
    tagBpm: t.tagBpm,
    tagKey: t.tagKey,
    tagged: t.tagged,
  }));
}

/** Claves Camelot compatibles: misma, ±1 del mismo anillo y la relativa. */
export function compatibleKeys(camelot: string | null | undefined): Set<string> {
  const out = new Set<string>();
  const m = camelot?.match(/^(\d{1,2})([AB])$/i);
  if (!m) return out;
  const n = Number(m[1]);
  const l = m[2].toUpperCase();
  const wrap = (x: number) => ((x - 1 + 12) % 12) + 1;
  out.add(`${n}${l}`);
  out.add(`${wrap(n - 1)}${l}`);
  out.add(`${wrap(n + 1)}${l}`);
  out.add(`${n}${l === "A" ? "B" : "A"}`);
  return out;
}

/** ¿El BPM entra en ±pct del de referencia (también a mitad o al doble)? */
export function bpmCompatible(bpm: number, ref: number, pct = 0.06): boolean {
  for (const k of [1, 0.5, 2]) {
    if (Math.abs(bpm * k - ref) / ref <= pct) return true;
  }
  return false;
}
