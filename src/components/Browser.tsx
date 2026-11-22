import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fmtTime, type LibraryTrack } from "../engine/audio";
import { YouTubeDeck } from "./YouTubeDeck";
import { SpotifySide, SpotifyTracks, useSpotify } from "./SpotifyPanel";
import { evalFilter, tryParseFilter, type FilterTrack } from "../filterDsl";
import type { TransitionOverride } from "../userActions";
import {
  bpmCompatible,
  compatibleKeys,
  historyTree,
  isInside,
  suggestFromHistory,
  playStats,
  type HistoryEntry,
  type LibraryFolder,
  type Playlist,
} from "../library";

/** Qué muestra la lista de pistas. */
export type BrowseSource =
  | { kind: "all" }
  | { kind: "folder"; path: string }
  | { kind: "playlist"; id: string }
  | { kind: "side" }
  | { kind: "history"; year?: number; month?: number }
  | { kind: "compatible" }
  | { kind: "suggest" }
  | { kind: "youtube" }
  | { kind: "spotify" };

interface BrowserProps {
  tracks: LibraryTrack[];
  folders: LibraryFolder[];
  playlists: Playlist[];
  history: HistoryEntry[];
  sidelist: string[];
  source: BrowseSource;
  onSource: (s: BrowseSource) => void;
  onAddFolder: () => void;
  onRemoveFolder: () => void;
  onToggleFavorite: (path: string) => void;
  query: string;
  onQuery: (q: string) => void;
  onImport: (files: FileList | null) => void;
  onLoad: (track: LibraryTrack, deck: "A" | "B") => void;
  busy: boolean;
  scan: { done: number; total: number } | null;
  /** pista de referencia para "Compatibles" (la que está sonando) */
  compatCamelot: string | null;
  compatBpm: number | null;
  compatDeck: "A" | "B" | null;
  /** pista que suena (para las sugerencias del historial) */
  compatTrackId: string | null;
  onCreatePlaylist: (name: string, kind?: "list" | "folder" | "filter", parent?: string | null, filter?: string) => void;
  /** crea una lista con temas (importación desde Spotify) */
  onCreatePlaylistWith: (name: string, trackIds: string[]) => void;
  onUpdatePlaylist: (id: string, patch: Partial<Pick<Playlist, "name" | "filter" | "parent">>) => void;
  onDeletePlaylist: (id: string) => void;
  onAddToPlaylist: (id: string, trackId: string) => void;
  onRemoveFromPlaylist: (id: string, index: number) => void;
  onSideAdd: (trackId: string) => void;
  /** abre el editor de pista (etiquetas, rejilla, cues) */
  onEditTrack: (track: LibraryTrack) => void;
  /** transición elegida para la entrada de cada tema de la sidelist */
  transitions: Record<string, TransitionOverride>;
  onTransition: (trackId: string, t: TransitionOverride | null) => void;
  onSideRemove: (index: number) => void;
  onSideMove: (index: number, dir: -1 | 1) => void;
  onSideClear: () => void;
  /** para el deck de YouTube: su volumen sigue al crossfader y al master */
  crossfade: number;
  master: number;
  notify: (msg: string) => void;
}

interface TreeNode extends LibraryFolder {
  children: TreeNode[];
  count: number;
}

type ColId = "title" | "artist" | "album" | "genre" | "year" | "bpm" | "key" | "length" | "played";

interface ColDef {
  id: ColId;
  label: string;
  flex: number;
  align?: "right";
  mono?: boolean;
}

const COLUMNS: ColDef[] = [
  { id: "title", label: "Título", flex: 2.3 },
  { id: "artist", label: "Artista", flex: 2 },
  { id: "album", label: "Álbum", flex: 1.6 },
  { id: "genre", label: "Género", flex: 1.1 },
  { id: "year", label: "Año", flex: 0.6, align: "right", mono: true },
  { id: "bpm", label: "BPM", flex: 0.75, align: "right", mono: true },
  { id: "key", label: "Key", flex: 0.6, align: "right", mono: true },
  { id: "length", label: "Duración", flex: 0.9, align: "right", mono: true },
];

const PLAYED_COL: ColDef = { id: "played", label: "Tocada", flex: 1.1, mono: true };

const DEFAULT_COLS: ColId[] = ["title", "artist", "bpm", "key", "length"];
const COLS_KEY = "bross.columns.v1";
const ROW_H = 25;

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const FILTER_HELP = [
  "Campos: title artist album genre year bpm key length played lastplayed file",
  "Operadores: = != > < >= <= ~ contains starts  ·  rango: bpm 120..128",
  "key ~ 8A = tonalidades compatibles · bpm ~ 124 = BPM cercano (±6 %, mitad o doble)",
  "played > 3 = sonó más de 3 veces · lastplayed > 30 = no suena hace más de 30 días",
  "Conectores: and (o nada), or, not, paréntesis · comillas para textos con espacios",
].join("\n");

function loadCols(): ColId[] {
  try {
    const raw = localStorage.getItem(COLS_KEY);
    const v = raw ? (JSON.parse(raw) as ColId[]) : null;
    if (Array.isArray(v) && v.includes("title")) return v.filter((c) => COLUMNS.some((d) => d.id === c));
  } catch {
    /* sin preferencias guardadas */
  }
  return DEFAULT_COLS;
}

/** Carpeta / + , carpeta / − , carpeta / ★ */
function FolderIcon({ mark }: { mark: "plus" | "minus" | "star" }) {
  return (
    <svg className="fico" viewBox="0 0 20 20" width="15" height="15" aria-hidden focusable="false">
      <path d="M2 5.4h5.1l1.6 1.9H18v9.3H2z" fill="currentColor" fillOpacity="0.16" />
      <path
        d="M2 5.4h5.1l1.6 1.9H18v9.3H2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {mark === "plus" ? (
        <path d="M10 9.4v4.8M7.6 11.8h4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      ) : null}
      {mark === "minus" ? (
        <path d="M7.6 11.8h4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      ) : null}
      {mark === "star" ? (
        <path
          d="M10 8.5l.96 1.95 2.15.31-1.55 1.51.36 2.14L10 13.4l-1.92 1.01.36-2.14-1.55-1.51 2.15-.31z"
          fill="currentColor"
        />
      ) : null}
    </svg>
  );
}

/** Árbol de carpetas con el total de pistas (incluye subcarpetas). */
function buildTree(folders: LibraryFolder[], tracks: LibraryTrack[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const f of folders) map.set(f.path.toLowerCase(), { ...f, children: [], count: 0 });
  const roots: TreeNode[] = [];
  for (const node of map.values()) {
    const parent = node.parent ? map.get(node.parent.toLowerCase()) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  // cuenta directa por carpeta y después se suma hacia arriba: O(pistas + carpetas)
  for (const t of tracks) {
    const n = t.dir ? map.get(t.dir.toLowerCase()) : undefined;
    if (n) n.count++;
  }
  const sum = (n: TreeNode): number => {
    for (const c of n.children) n.count += sum(c);
    return n.count;
  };
  roots.forEach(sum);
  const sortNodes = (list: TreeNode[]) => {
    list.sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));
    list.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

/** Fila de la lista: la pista (si sigue en la biblioteca) y datos del historial. */
interface Row {
  key: string;
  track: LibraryTrack | null;
  title: string;
  artist: string;
  played?: number;
  /** índice dentro de la playlist o la sidelist */
  index?: number;
}

function bpmOf(t: LibraryTrack | null): number | null {
  return t?.analysis?.bpm ?? t?.tagBpm ?? null;
}

function cellValue(col: ColId, r: Row): string {
  const t = r.track;
  switch (col) {
    case "title":
      return r.title;
    case "artist":
      return r.artist || "—";
    case "album":
      return t?.album ?? "";
    case "genre":
      return t?.genre ?? "";
    case "year":
      return t?.year ?? "";
    case "bpm": {
      const b = bpmOf(t);
      return b ? b.toFixed(1) : t ? "…" : "";
    }
    case "key":
      return t?.analysis?.camelot ?? t?.tagKey ?? (t ? "…" : "");
    case "length":
      return t?.duration ? fmtTime(t.duration) : "";
    case "played": {
      if (!r.played) return "";
      const d = new Date(r.played);
      const p = (n: number) => n.toString().padStart(2, "0");
      return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
  }
}

function sortValue(col: ColId, r: Row): string | number {
  if (col === "bpm") return bpmOf(r.track) ?? 0;
  if (col === "length") return r.track?.duration ?? 0;
  if (col === "played") return r.played ?? 0;
  if (col === "key") {
    // orden Camelot: 1A, 1B, 2A … (no alfabético)
    const k = r.track?.analysis?.camelot ?? "";
    const m = k.match(/^(\d+)([AB])$/);
    return m ? Number(m[1]) * 2 + (m[2] === "B" ? 1 : 0) : 999;
  }
  return cellValue(col, r).toLowerCase();
}

function BrowserImpl(props: BrowserProps) {
  const {
    tracks,
    folders,
    playlists,
    history,
    sidelist,
    source,
    onSource,
    onAddFolder,
    onRemoveFolder,
    onToggleFavorite,
    query,
    onQuery,
    onImport,
    onLoad,
    busy,
    scan,
    compatCamelot,
    compatBpm,
    compatDeck,
  } = props;
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [cols, setCols] = useState<ColId[]>(loadCols);
  const [colMenu, setColMenu] = useState(false);
  const [sort, setSort] = useState<{ col: ColId; dir: 1 | -1 } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(200);
  /** lista / carpeta / filtro que se está creando (y dentro de qué carpeta) */
  const [newItem, setNewItem] = useState<{ kind: "list" | "folder" | "filter"; parent: string | null; name: string } | null>(
    null,
  );
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  /** carpeta virtual activa: lo nuevo se crea adentro */
  const [listFolder, setListFolder] = useState<string | null>(null);
  const [dropList, setDropList] = useState<string | null>(null);

  const tab: "browser" | "side" | "lists" | "youtube" | "spotify" =
    source.kind === "side"
      ? "side"
      : source.kind === "playlist"
        ? "lists"
        : source.kind === "youtube"
          ? "youtube"
          : source.kind === "spotify"
            ? "spotify"
            : "browser";
  /** la pestaña SPOTIFY (y la de YouTube) reemplazan la lista de pistas */
  const external = tab === "youtube" || tab === "spotify";
  const spotify = useSpotify(tracks, tab === "spotify");

  // fallback para cuando se abre en el navegador (sin puente de Electron)
  useEffect(() => {
    dirInput.current?.setAttribute("webkitdirectory", "");
    dirInput.current?.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(cols));
    } catch {
      /* sin almacenamiento: las columnas valen solo en esta sesión */
    }
  }, [cols]);

  useEffect(() => {
    const el = rowsRef.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setViewH(e[0].contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // al cambiar de vista se vuelve arriba
  useEffect(() => {
    rowsRef.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  }, [source]);

  const tree = useMemo(() => buildTree(folders, tracks), [folders, tracks]);
  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const stats = useMemo(() => playStats(history), [history]);
  const hTree = useMemo(() => historyTree(history), [history]);

  // búsqueda en la base (FTS5) con un pequeño retardo mientras se escribe
  const [ftsIds, setFtsIds] = useState<{ query: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    const q = query.trim();
    const search = window.bross?.searchLibrary;
    if (!q || !search) {
      setFtsIds(null);
      return;
    }
    let alive = true;
    const id = window.setTimeout(() => {
      search(q)
        .then((ids) => alive && setFtsIds({ query: q, ids: new Set(ids) }))
        .catch(() => undefined);
    }, 90);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [query]);

  const rows = useMemo<Row[]>(() => {
    const fromTrack = (t: LibraryTrack, key = t.id, extra: Partial<Row> = {}): Row => ({
      key,
      track: t,
      title: t.title,
      artist: t.artist,
      ...extra,
    });
    let list: Row[];
    switch (source.kind) {
      case "folder":
        list = tracks.filter((t) => t.dir && isInside(t.dir, source.path)).map((t) => fromTrack(t));
        break;
      case "playlist": {
        const p = playlists.find((x) => x.id === source.id);
        if (p?.kind === "filter") {
          const { tree } = tryParseFilter(p.filter ?? "");
          if (!tree) {
            list = [];
            break;
          }
          const now = Date.now();
          list = tracks
            .filter((t) => {
              const st = stats.get(t.id);
              const ft: FilterTrack = {
                title: t.title,
                artist: t.artist,
                album: t.album,
                genre: t.genre,
                year: t.year,
                fileName: t.fileName,
                duration: t.duration,
                bpm: bpmOf(t),
                key: t.analysis?.camelot ?? t.tagKey ?? null,
                played: st?.count ?? 0,
                lastPlayed: st?.last ?? null,
              };
              return evalFilter(tree, ft, now);
            })
            .map((t) => fromTrack(t));
          break;
        }
        list = (p?.trackIds ?? []).flatMap((id, index) => {
          const t = byId.get(id);
          return t ? [fromTrack(t, `${id}:${index}`, { index })] : [];
        });
        break;
      }
      case "side":
        list = sidelist.flatMap((id, index) => {
          const t = byId.get(id);
          return t ? [fromTrack(t, `${id}:${index}`, { index })] : [];
        });
        break;
      case "history": {
        const { year, month } = source;
        list = [...history].reverse().flatMap((h, i) => {
          if (year != null) {
            const d = new Date(h.at);
            if (d.getFullYear() !== year || (month != null && d.getMonth() !== month)) return [];
          }
          const t = byId.get(h.trackId) ?? null;
          return [{ key: `${h.at}:${i}`, track: t, title: h.title, artist: h.artist, played: h.at }];
        });
        break;
      }
      case "suggest": {
        // primero lo que vino después en tus sets; después, compatibles nunca usadas juntas
        const ids = suggestFromHistory(history, props.compatTrackId);
        const seen = new Set(ids);
        list = ids.flatMap((id) => {
          const t = byId.get(id);
          return t ? [fromTrack(t)] : [];
        });
        const keys = compatibleKeys(compatCamelot);
        if (compatBpm && keys.size) {
          for (const t of tracks) {
            if (seen.has(t.id) || t.id === props.compatTrackId) continue;
            const b = bpmOf(t);
            const k = t.analysis?.camelot;
            if (b != null && k != null && keys.has(k) && bpmCompatible(b, compatBpm)) list.push(fromTrack(t));
          }
        }
        break;
      }
      case "compatible": {
        const keys = compatibleKeys(compatCamelot);
        list =
          compatBpm && keys.size
            ? tracks
                .filter((t) => {
                  const b = bpmOf(t);
                  const k = t.analysis?.camelot;
                  return b != null && k != null && keys.has(k) && bpmCompatible(b, compatBpm);
                })
                .sort((a, b) => Math.abs((bpmOf(a) ?? 0) - compatBpm) - Math.abs((bpmOf(b) ?? 0) - compatBpm))
                .map((t) => fromTrack(t))
            : [];
        break;
      }
      default:
        list = tracks.map((t) => fromTrack(t));
    }
    const q = query.trim().toLowerCase();
    if (q) {
      // FTS5 (prefijos, sin acentos) cuando está la base; si no, búsqueda en memoria
      const fts = ftsIds && ftsIds.query === query.trim() ? ftsIds.ids : null;
      list = list.filter(
        (r) =>
          (fts != null && r.track != null && fts.has(r.track.id)) ||
          [r.title, r.artist, r.track?.album, r.track?.genre, r.track?.fileName].some((v) =>
            v?.toLowerCase().includes(q),
          ),
      );
    }
    if (sort) {
      const { col, dir } = sort;
      list = [...list].sort((a, b) => {
        const va = sortValue(col, a);
        const vb = sortValue(col, b);
        return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
      });
    }
    return list;
  }, [source, tracks, playlists, sidelist, history, byId, query, sort, compatCamelot, compatBpm, stats, ftsIds, props.compatTrackId]);

  const visibleCols = useMemo(() => {
    const list = COLUMNS.filter((c) => cols.includes(c.id));
    return source.kind === "history" ? [PLAYED_COL, ...list] : list;
  }, [cols, source.kind]);

  // lista virtual: solo se dibujan las filas que se ven
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 6);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + 6);
  const slice = rows.slice(first, last);

  const toggleCollapse = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const addFolder = () => {
    if (window.bross) onAddFolder();
    else dirInput.current?.click();
  };

  const selectedFolder = source.kind === "folder" ? source.path : null;

  const renderNode = (node: TreeNode, depth: number): ReactNode => {
    const isCollapsed = collapsed.has(node.path);
    const selected = selectedFolder === node.path;
    const hasChildren = node.children.length > 0;
    return (
      <div key={node.path}>
        <div
          className={`fitem${selected ? " sel" : ""}`}
          style={{ paddingLeft: 6 + depth * 13 }}
          role="treeitem"
          aria-selected={selected}
          aria-expanded={hasChildren ? !isCollapsed : undefined}
          tabIndex={0}
          onClick={() => onSource(selected ? { kind: "all" } : { kind: "folder", path: node.path })}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSource(selected ? { kind: "all" } : { kind: "folder", path: node.path });
            }
          }}
          title={node.path}
        >
          <span
            className={`fcaret${hasChildren ? "" : " empty"}${isCollapsed ? " closed" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) toggleCollapse(node.path);
            }}
          >
            ▾
          </span>
          {node.favorite ? (
            <span className="ffico fav" aria-hidden>
              ★
            </span>
          ) : null}
          <span className="fname" data-no-i18n>
            {node.name}
          </span>
          {node.count > 0 ? <span className="fcount">{node.count}</span> : null}
        </div>
        {hasChildren && !isCollapsed ? node.children.map((c) => renderNode(c, depth + 1)) : null}
      </div>
    );
  };

  const special = (s: BrowseSource, icon: string, label: string, count: number | null, title?: string) => {
    const sel = source.kind === s.kind && !(source.kind === "history" && source.year != null);
    return (
      <div
        className={`fitem all${sel ? " sel" : ""}`}
        role="treeitem"
        aria-selected={sel}
        tabIndex={0}
        onClick={() => onSource(s)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSource(s);
        }}
        title={title}
      >
        <span className="fcaret empty" />
        <span className="ffico" aria-hidden>
          {icon}
        </span>
        <span className="fname">{label}</span>
        {count != null ? <span className="fcount">{count}</span> : null}
      </div>
    );
  };

  const submitNew = () => {
    if (!newItem) return;
    const name = newItem.name.trim();
    if (name) {
      props.onCreatePlaylist(name, newItem.kind, newItem.parent, newItem.kind === "filter" ? "bpm 120..130" : undefined);
      const parent = newItem.parent;
      if (parent) {
        setCollapsed((prev) => {
          const next = new Set(prev);
          next.delete(`l:${parent}`);
          return next;
        });
      }
    }
    setNewItem(null);
  };

  const renderNewItem = (depth: number) => (
    <form
      className="newlist"
      style={{ paddingLeft: 6 + depth * 13 }}
      onSubmit={(e) => {
        e.preventDefault();
        submitNew();
      }}
    >
      <input
        autoFocus
        value={newItem?.name ?? ""}
        placeholder={
          newItem?.kind === "folder" ? "Nombre de la carpeta" : newItem?.kind === "filter" ? "Nombre del filtro" : "Nombre de la lista"
        }
        aria-label="Nombre"
        onChange={(e) => setNewItem((n) => (n ? { ...n, name: e.target.value } : n))}
        onBlur={submitNew}
        onKeyDown={(e) => {
          if (e.key === "Escape") setNewItem(null);
        }}
      />
    </form>
  );

  const LIST_ICON = { list: "≣", folder: "▸", filter: "ƒ" } as const;
  const listIds = new Set(playlists.map((p) => p.id));

  const renderLists = (parent: string | null, depth: number): ReactNode =>
    playlists
      // una lista cuya carpeta ya no existe se muestra en la raíz
      .filter((p) => (p.parent && listIds.has(p.parent) ? p.parent : null) === parent)
      .sort((a, b) => Number(b.kind === "folder") - Number(a.kind === "folder"))
      .map((p) => {
        const kind = p.kind ?? "list";
        const isFolder = kind === "folder";
        const sel = isFolder ? listFolder === p.id : source.kind === "playlist" && source.id === p.id;
        const fKey = `l:${p.id}`;
        const open = isFolder && !collapsed.has(fKey);
        const childCount = isFolder ? playlists.filter((x) => x.parent === p.id).length : p.trackIds.length;
        return (
          <div key={p.id}>
            <div
              className={`fitem${sel ? " sel" : ""}${dropList === p.id ? " drop" : ""}`}
              style={{ paddingLeft: 6 + depth * 13 }}
              role="treeitem"
              aria-selected={sel}
              aria-expanded={isFolder ? open : undefined}
              tabIndex={0}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/bross-list", p.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => {
                if (isFolder) {
                  setListFolder(sel ? null : p.id);
                  toggleCollapse(fKey);
                } else {
                  setListFolder(p.parent && listIds.has(p.parent) ? p.parent : null);
                  onSource({ kind: "playlist", id: p.id });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "F2") setRenaming({ id: p.id, name: p.name });
              }}
              onDoubleClick={() => setRenaming({ id: p.id, name: p.name })}
              onDragOver={(e) => {
                const types = e.dataTransfer.types;
                if ((kind === "list" && types.includes("text/bross-track")) || (isFolder && types.includes("text/bross-list"))) {
                  e.preventDefault();
                  setDropList(p.id);
                }
              }}
              onDragLeave={() => setDropList(null)}
              onDrop={(e) => {
                setDropList(null);
                const track = e.dataTransfer.getData("text/bross-track");
                const list = e.dataTransfer.getData("text/bross-list");
                if (track && kind === "list") {
                  e.preventDefault();
                  props.onAddToPlaylist(p.id, track);
                } else if (list && isFolder && list !== p.id) {
                  e.preventDefault();
                  props.onUpdatePlaylist(list, { parent: p.id });
                }
              }}
              title={
                isFolder
                  ? "Carpeta virtual: arrastrá listas acá · doble clic para renombrar"
                  : kind === "filter"
                    ? `Filtro: ${p.filter ?? ""} · doble clic para renombrar`
                    : "Arrastrá pistas acá para agregarlas · doble clic para renombrar"
              }
            >
              <span className={`fcaret${isFolder ? "" : " empty"}${isFolder && !open ? " closed" : ""}`}>▾</span>
              <span className={`ffico${kind === "filter" ? " filt" : ""}`} aria-hidden>
                {LIST_ICON[kind]}
              </span>
              {renaming?.id === p.id ? (
                <input
                  className="rename"
                  autoFocus
                  value={renaming.name}
                  aria-label="Nuevo nombre"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setRenaming({ id: p.id, name: e.target.value })}
                  onBlur={() => {
                    if (renaming.name.trim()) props.onUpdatePlaylist(p.id, { name: renaming.name.trim() });
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <span className="fname" data-no-i18n>
                  {p.name}
                </span>
              )}
              {kind !== "filter" ? <span className="fcount">{childCount}</span> : null}
              <button
                type="button"
                className="fdel"
                title={`Borrar "${p.name}"`}
                aria-label={`Borrar ${p.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  const msg = isFolder
                    ? `¿Borrar la carpeta "${p.name}" y las listas que tiene adentro? Las pistas no se borran.`
                    : `¿Borrar "${p.name}"? Las pistas no se borran.`;
                  if (window.confirm(msg)) {
                    if (listFolder === p.id) setListFolder(null);
                    props.onDeletePlaylist(p.id);
                  }
                }}
              >
                ✕
              </button>
            </div>
            {open ? renderLists(p.id, depth + 1) : null}
            {open && newItem?.parent === p.id ? renderNewItem(depth + 1) : null}
          </div>
        );
      });

  const emptyText = (): [string, string] => {
    if (tracks.length === 0)
      return [
        "Sin pistas cargadas",
        "Agregá una carpeta con el botón de arriba a la izquierda, o arrastrá archivos de audio acá. Doble clic en una pista la manda al Deck A; Mayús+doble clic al Deck B.",
      ];
    if (query.trim()) return ["Sin resultados", "Probá con otro término de búsqueda."];
    switch (source.kind) {
      case "side":
        return ["Sidelist vacía", "Usá el botón + de cada pista para ponerla en cola para después."];
      case "playlist":
        if (filterList)
          return filterState?.error
            ? ["Filtro con errores", filterState.error]
            : ["Sin coincidencias", "Ninguna pista cumple el filtro. Probá con bpm 120..130, key ~ 8A, genre contains house…"];
        return ["Lista vacía", "Arrastrá pistas desde el navegador hasta el nombre de la lista."];
      case "history":
        return ["Sin historial", "Las pistas que suenan quedan registradas acá con fecha y hora."];
      case "suggest":
        return compatDeck
          ? ["Sin sugerencias", "Todavía no hay historial con este tema ni compatibles. Se arma solo a medida que mezclás."]
          : ["Sin referencia", "Reproducí una pista para ver sugerencias de tu historial."];
      case "compatible":
        return compatBpm
          ? ["Sin compatibles", `No hay pistas con tonalidad compatible con ${compatCamelot ?? "—"} y BPM cercano.`]
          : ["Sin referencia", "Reproducí una pista analizada para ver las que combinan con ella."];
      default:
        return ["Carpeta vacía", "No hay archivos de audio en esta carpeta ni en sus subcarpetas."];
    }
  };

  const current = source.kind === "playlist" ? playlists.find((p) => p.id === source.id) : undefined;
  const playlistName = current?.name ?? null;
  const filterList = current?.kind === "filter" ? current : null;
  const filterState = filterList ? tryParseFilter(filterList.filter ?? "") : null;

  return (
    <>
      <div className="bottom">
        <div className="bcell tree">
          <div className="ttabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "browser"}
              className={`ttab${tab === "browser" ? " sel" : ""}`}
              onClick={() => onSource({ kind: "all" })}
            >
              {tab === "browser" ? <span className="tri" /> : null}
              BROWSER
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "side"}
              className={`ttab${tab === "side" ? " sel" : ""}`}
              onClick={() => onSource({ kind: "side" })}
            >
              {tab === "side" ? <span className="tri" /> : null}
              SIDE{sidelist.length ? ` ${sidelist.length}` : ""}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "lists"}
              className={`ttab${tab === "lists" ? " sel" : ""}`}
              onClick={() => {
                const first = playlists.find((p) => p.kind !== "folder");
                if (first) onSource({ kind: "playlist", id: first.id });
                else {
                  onSource({ kind: "playlist", id: "" });
                  setNewItem({ kind: "list", parent: null, name: "" });
                }
              }}
            >
              {tab === "lists" ? <span className="tri" /> : null}
              LISTS
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "youtube"}
              className={`ttab yt${tab === "youtube" ? " sel" : ""}`}
              onClick={() => onSource({ kind: "youtube" })}
              title="Deck de YouTube (reproductor oficial)"
            >
              {tab === "youtube" ? <span className="tri" /> : null}
              YOUTUBE
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "spotify"}
              className={`ttab${tab === "spotify" ? " sel" : ""}`}
              onClick={() => onSource({ kind: "spotify" })}
              title="Importar playlists de Spotify a tu biblioteca"
            >
              {tab === "spotify" ? <span className="tri" /> : null}
              SPOTIFY
            </button>
            <div className="ttabs-actions">
              {tab === "browser" ? (
                <>
                  <button
                    type="button"
                    className="tbtn"
                    onClick={addFolder}
                    disabled={busy}
                    title="Agregar carpeta (con sus subcarpetas y música)"
                    aria-label="Agregar carpeta"
                  >
                    <FolderIcon mark="plus" />
                  </button>
                  <button
                    type="button"
                    className="tbtn"
                    onClick={onRemoveFolder}
                    disabled={!selectedFolder || busy}
                    title="Quitar la carpeta seleccionada del navegador"
                    aria-label="Quitar carpeta"
                  >
                    <FolderIcon mark="minus" />
                  </button>
                  <button
                    type="button"
                    className={`tbtn${folders.find((f) => f.path === selectedFolder)?.favorite ? " on" : ""}`}
                    onClick={() => selectedFolder && onToggleFavorite(selectedFolder)}
                    disabled={!selectedFolder || busy}
                    title="Marcar la carpeta como favorita"
                    aria-label="Marcar carpeta como favorita"
                  >
                    <FolderIcon mark="star" />
                  </button>
                </>
              ) : tab === "lists" ? (
                <>
                  <button
                    type="button"
                    className="tbtn glyph"
                    onClick={() => setNewItem({ kind: "list", parent: listFolder, name: "" })}
                    title="Nueva lista"
                    aria-label="Nueva lista"
                  >
                    +≣
                  </button>
                  <button
                    type="button"
                    className="tbtn glyph"
                    onClick={() => setNewItem({ kind: "folder", parent: listFolder, name: "" })}
                    title="Nueva carpeta virtual (agrupa listas)"
                  >
                    +▸
                  </button>
                  <button
                    type="button"
                    className="tbtn glyph"
                    onClick={() => setNewItem({ kind: "filter", parent: listFolder, name: "" })}
                    title="Nueva carpeta filtro (lista automática por BPM, tono, género…)"
                  >
                    +ƒ
                  </button>
                </>
              ) : external ? null : (
                <button
                  type="button"
                  className="tbtn txt"
                  onClick={props.onSideClear}
                  disabled={!sidelist.length}
                  title="Vaciar la sidelist"
                >
                  VACIAR
                </button>
              )}
            </div>
          </div>

          <div className="tsearch">
            <input
              placeholder="Buscar en la biblioteca…"
              aria-label="Buscar en la biblioteca"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
            />
            <span aria-hidden>⌕</span>
          </div>

          <div className="ttree" role="tree" aria-label="Carpetas y listas">
            {tab === "browser" ? (
              <>
                {special({ kind: "all" }, "▤", "Todas las pistas", tracks.length)}
                {special(
                  { kind: "compatible" },
                  "◎",
                  "Compatibles",
                  null,
                  compatDeck
                    ? `Combinan con el Deck ${compatDeck} (${compatCamelot ?? "—"} · ${compatBpm?.toFixed(1) ?? "—"} BPM)`
                    : "Reproducí una pista para ver las compatibles",
                )}
                {special(
                  { kind: "suggest" },
                  "✦",
                  "Sugeridas",
                  null,
                  compatDeck
                    ? "Lo que pusiste después de este tema en otros sets, y después compatibles por tono y BPM"
                    : "Reproducí una pista para ver sugerencias de tu historial",
                )}
                {special({ kind: "history" }, "◷", "Historial", history.length)}
                {hTree.map((y) => {
                  const yKey = `h:${y.year}`;
                  const ySel = source.kind === "history" && source.year === y.year && source.month == null;
                  const open = !collapsed.has(yKey) && source.kind === "history";
                  return (
                    <div key={yKey}>
                      <div
                        className={`fitem${ySel ? " sel" : ""}`}
                        style={{ paddingLeft: 19 }}
                        role="treeitem"
                        aria-selected={ySel}
                        tabIndex={0}
                        onClick={() => onSource({ kind: "history", year: y.year })}
                        onKeyDown={(e) => e.key === "Enter" && onSource({ kind: "history", year: y.year })}
                      >
                        <span
                          className={`fcaret${open ? "" : " closed"}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (source.kind !== "history") onSource({ kind: "history", year: y.year });
                            else toggleCollapse(yKey);
                          }}
                        >
                          ▾
                        </span>
                        <span className="fname">{y.year}</span>
                        <span className="fcount">{y.count}</span>
                      </div>
                      {open
                        ? y.months.map((m) => {
                            const mSel = source.kind === "history" && source.year === y.year && source.month === m.month;
                            return (
                              <div
                                key={m.month}
                                className={`fitem${mSel ? " sel" : ""}`}
                                style={{ paddingLeft: 32 }}
                                role="treeitem"
                                aria-selected={mSel}
                                tabIndex={0}
                                onClick={() => onSource({ kind: "history", year: y.year, month: m.month })}
                                onKeyDown={(e) =>
                                  e.key === "Enter" && onSource({ kind: "history", year: y.year, month: m.month })
                                }
                              >
                                <span className="fcaret empty" />
                                <span className="fname">{MONTHS[m.month]}</span>
                                <span className="fcount">{m.count}</span>
                              </div>
                            );
                          })
                        : null}
                    </div>
                  );
                })}
                <div className="tsep" />
                {tree.map((node) => renderNode(node, 0))}
                {tree.length === 0 ? (
                  <div className="tree-empty">
                    <span className="te-title">Sin carpetas</span>
                    <span className="te-sub">Usá el botón de carpeta con + para agregar una carpeta con toda su música.</span>
                  </div>
                ) : null}
              </>
            ) : tab === "spotify" ? (
              <SpotifySide sp={spotify} />
            ) : tab === "youtube" ? (
              <div className="tree-empty">
                <span className="te-title">YouTube</span>
                <span className="te-sub">
                  Pegá un link a la derecha. Elegí el lado A o B para que el volumen siga al crossfader. Este deck usa
                  el reproductor oficial: no pasa por EQ, efectos, sync ni grabación.
                </span>
              </div>
            ) : tab === "side" ? (
              <div className="tree-empty">
                <span className="te-title">Sidelist</span>
                <span className="te-sub">
                  Cola de pistas para después. Agregalas con + desde el navegador y cargalas cuando toque.
                </span>
              </div>
            ) : (
              <>
                {renderLists(null, 0)}
                {newItem && newItem.parent == null ? renderNewItem(0) : null}
                {playlists.length === 0 && !newItem ? (
                  <div className="tree-empty">
                    <span className="te-title">Sin listas</span>
                    <span className="te-sub">
                      Creá una con + LISTA y arrastrá pistas hasta su nombre. + CARPETA agrupa listas; + FILTRO arma una
                      lista automática (por ejemplo <code>bpm 120..128 and key ~ 8A</code>).
                    </span>
                  </div>
                ) : null}
                {playlists.length ? (
                  <div
                    className={`lists-root${dropList === "__root" ? " drop" : ""}`}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes("text/bross-list")) {
                        e.preventDefault();
                        setDropList("__root");
                      }
                    }}
                    onDragLeave={() => setDropList(null)}
                    onDrop={(e) => {
                      const id = e.dataTransfer.getData("text/bross-list");
                      setDropList(null);
                      if (id) props.onUpdatePlaylist(id, { parent: null });
                    }}
                  >
                    Arrastrá una lista acá para sacarla de su carpeta
                  </div>
                ) : null}
              </>
            )}
            {scan ? (
              <div className="scanline">
                Importando {scan.done} / {scan.total}…
              </div>
            ) : null}
          </div>
        </div>

        <div className="bcell files">
          <YouTubeDeck
            visible={tab === "youtube"}
            crossfade={props.crossfade}
            master={props.master}
            notify={props.notify}
          />
          {tab === "spotify" ? (
            <SpotifyTracks
              sp={spotify}
              tracks={tracks}
              onCreateList={props.onCreatePlaylistWith}
              onLoad={onLoad}
              notify={props.notify}
            />
          ) : null}
          {filterList ? (
            <div className="filterbar" hidden={external}>
              <span className="fb-label">FILTRO</span>
              <input
                key={filterList.id}
                defaultValue={filterList.filter ?? ""}
                spellCheck={false}
                aria-label="Texto del filtro"
                placeholder="bpm 120..128 and key ~ 8A and not genre contains pop"
                className={filterState?.error ? "bad" : ""}
                onChange={(e) => props.onUpdatePlaylist(filterList.id, { filter: e.target.value })}
              />
              <span className={`fb-help${filterState?.error ? " bad" : ""}`} title={FILTER_HELP}>
                {filterState?.error ?? `${rows.length} pistas · ?`}
              </span>
            </div>
          ) : null}
          <div className="fhead" hidden={external}>
            {visibleCols.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`fh${c.align === "right" ? " r" : ""}${sort?.col === c.id ? " sorted" : ""}`}
                style={{ flex: c.flex }}
                onClick={() =>
                  setSort((s) => (s?.col === c.id ? (s.dir === 1 ? { col: c.id, dir: -1 } : null) : { col: c.id, dir: 1 }))
                }
                title={`Ordenar por ${c.label}`}
              >
                {c.label}
                {sort?.col === c.id ? <span className="sortmark">{sort.dir === 1 ? "▲" : "▼"}</span> : null}
              </button>
            ))}
            <div className="fh act">
              {playlistName ? <span className="viewname" title={playlistName}>{playlistName}</span> : null}
              <button
                type="button"
                className="colbtn"
                onClick={() => setColMenu((v) => !v)}
                aria-expanded={colMenu}
                title="Elegir columnas"
              >
                ⋮
              </button>
              <button type="button" className="btn-load" onClick={() => fileInput.current?.click()} disabled={busy}>
                {busy ? "CARGANDO…" : "+ ARCHIVOS"}
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aac,.aif,.aiff"
                multiple
                hidden
                onChange={(e) => {
                  onImport(e.target.files);
                  e.target.value = "";
                }}
              />
              <input
                ref={dirInput}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  onImport(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            {colMenu ? (
              <div className="colmenu" role="menu" onMouseLeave={() => setColMenu(false)}>
                {COLUMNS.map((c) => (
                  <label key={c.id} className="colopt">
                    <input
                      type="checkbox"
                      checked={cols.includes(c.id)}
                      disabled={c.id === "title"}
                      onChange={() =>
                        setCols((prev) =>
                          prev.includes(c.id) ? prev.filter((x) => x !== c.id) : COLUMNS.map((d) => d.id).filter((id) => id === c.id || prev.includes(id)),
                        )
                      }
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
          <div
            className="frows"
            ref={rowsRef}
            hidden={external}
            onScroll={(e) => setScrollTop((e.target as HTMLElement).scrollTop)}
          >
            {rows.length === 0 ? (
              <div className="empty-state">
                <strong>{emptyText()[0]}</strong>
                <span>{emptyText()[1]}</span>
              </div>
            ) : (
              <div style={{ height: rows.length * ROW_H, position: "relative" }} data-no-i18n>
                {slice.map((r, i) => {
                  const t = r.track;
                  const idx = first + i;
                  return (
                    <div
                      key={r.key}
                      className={`fr${idx % 2 ? " odd" : ""}${t ? "" : " gone"}`}
                      style={{ position: "absolute", top: idx * ROW_H, left: 0, right: 0 }}
                      draggable={!!t}
                      tabIndex={0}
                      onDragStart={(e) => {
                        if (!t) return;
                        e.dataTransfer.setData("text/bross-track", t.id);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      onDoubleClick={(e) => t && onLoad(t, e.shiftKey ? "B" : "A")}
                      onContextMenu={(e) => {
                        if (!t) return;
                        e.preventDefault();
                        props.onEditTrack(t);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && t) onLoad(t, e.shiftKey ? "B" : "A");
                      }}
                      title={t ? "Doble clic: Deck A · Mayús+doble clic: Deck B · clic derecho: editar · o arrastrá al deck o a una lista" : "La pista ya no está en la biblioteca"}
                    >
                      {visibleCols.map((c) => (
                        <div
                          key={c.id}
                          className={`c c-${c.id}${c.align === "right" ? " r" : ""}${c.mono ? " mono" : ""}`}
                          style={{ flex: c.flex }}
                          title={c.id === "key" ? (t?.analysis?.keyName ?? "") : undefined}
                        >
                          {cellValue(c.id, r)}
                        </div>
                      ))}
                      <div className="c act">
                        {t ? (
                          <>
                            <button type="button" onClick={() => onLoad(t, "A")} title="Cargar en Deck A">
                              A
                            </button>
                            <button type="button" onClick={() => onLoad(t, "B")} title="Cargar en Deck B">
                              B
                            </button>
                            <button
                              type="button"
                              className="edit"
                              onClick={() => props.onEditTrack(t)}
                              title="Editar etiquetas, rejilla y cues (también con clic derecho)"
                            >
                              ✎
                            </button>
                          </>
                        ) : null}
                        {source.kind === "side" && r.index != null ? (
                          <>
                            {t && r.index > 0 ? (
                              <>
                                <select
                                  className="trans-sel"
                                  value={props.transitions[t.id]?.style ?? ""}
                                  onChange={(e) =>
                                    props.onTransition(t.id, {
                                      ...props.transitions[t.id],
                                      style: (e.target.value || undefined) as TransitionOverride["style"],
                                    })
                                  }
                                  title="Cómo entra este tema en el automix"
                                  aria-label="Transición de entrada"
                                >
                                  <option value="">Auto</option>
                                  <option value="smart">Intelig.</option>
                                  <option value="blend">Fundido</option>
                                  <option value="bassSwap">Bajos</option>
                                  <option value="filter">Filtro</option>
                                  <option value="echo">Eco</option>
                                  <option value="cut">Corte</option>
                                </select>
                                <select
                                  className="trans-sel"
                                  value={props.transitions[t.id]?.beats ?? 0}
                                  onChange={(e) =>
                                    props.onTransition(t.id, { ...props.transitions[t.id], beats: Number(e.target.value) || undefined })
                                  }
                                  title="Largo de la transición de entrada"
                                  aria-label="Largo de la transición"
                                >
                                  <option value={0}>—</option>
                                  <option value={4}>4</option>
                                  <option value={8}>8</option>
                                  <option value={16}>16</option>
                                  <option value={32}>32</option>
                                  <option value={64}>64</option>
                                </select>
                              </>
                            ) : null}
                            <button type="button" onClick={() => props.onSideMove(r.index!, -1)} title="Subir en la cola">
                              ▲
                            </button>
                            <button type="button" onClick={() => props.onSideMove(r.index!, 1)} title="Bajar en la cola">
                              ▼
                            </button>
                            <button type="button" onClick={() => props.onSideRemove(r.index!)} title="Quitar de la sidelist">
                              ✕
                            </button>
                          </>
                        ) : source.kind === "playlist" && r.index != null ? (
                          <button
                            type="button"
                            onClick={() => props.onRemoveFromPlaylist(source.id, r.index!)}
                            title="Quitar de la lista"
                          >
                            ✕
                          </button>
                        ) : t ? (
                          <button type="button" onClick={() => props.onSideAdd(t.id)} title="Agregar a la sidelist (cola)">
                            +
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>
    </>
  );
}

/** El navegador solo se vuelve a dibujar cuando cambian sus datos (no a 30 fps). */
export const Browser = memo(BrowserImpl);
