import { useCallback, useEffect, useMemo, useState } from "react";
import type { LibraryTrack } from "../engine/audio";
import type { BrossBridge } from "../library";
import { matchPlaylist, trackLabel, type MatchResult, type SpotifyTrack } from "../spotifyMatch";

// Pestaña SPOTIFY: se conecta la cuenta, se elige una playlist y se ve qué
// temas ya están en la biblioteca. Con los encontrados se arma una lista de
// BROSS DJ (suenan desde los archivos, con EQ, efectos y sync). No se
// reproduce nada de Spotify.

type SpotifyApi = Pick<BrossBridge, "spotifyStatus" | "spotifyLogin" | "spotifyLogout" | "spotifyGet">;

export interface SpotifyPlaylist {
  id: string;
  name: string;
  total: number;
  image: string | null;
}

/** "Temas que me gustan" no es una playlist en la API: se lee aparte. */
export const LIKED_ID = "__liked";
const MAX_ITEMS = 3000;

function bridge(): SpotifyApi | null {
  // en desarrollo los tests pueden reemplazar la conexión por datos falsos
  const mock = import.meta.env.DEV ? (window as unknown as { __brossSpotifyMock?: SpotifyApi }).__brossSpotifyMock : undefined;
  const api = mock ?? window.bross;
  return api?.spotifyGet ? api : null;
}

interface PageOf<T> {
  items?: T[];
  next?: string | null;
  total?: number;
}

type RawTrack = { id?: string | null; name?: string; duration_ms?: number; artists?: { name?: string }[]; type?: string } | null;

function toTrack(t: RawTrack): SpotifyTrack | null {
  if (!t || (t.type && t.type !== "track") || !t.name) return null;
  return {
    id: t.id ?? null,
    title: t.name,
    artists: (t.artists ?? []).map((a) => a.name ?? "").filter(Boolean),
    durationMs: t.duration_ms ?? 0,
  };
}

export interface SpotifyState {
  available: boolean;
  status: "checking" | "off" | "connecting" | "on";
  user: string | null;
  error: string | null;
  playlists: SpotifyPlaylist[] | null;
  selected: SpotifyPlaylist | null;
  items: SpotifyTrack[] | null;
  loadingItems: boolean;
  matches: MatchResult[];
  connect: () => void;
  disconnect: () => void;
  select: (p: SpotifyPlaylist) => void;
}

export function useSpotify(tracks: LibraryTrack[], active: boolean): SpotifyState {
  // se resuelve al abrir la pestaña (los tests de desarrollo pueden inyectar datos falsos antes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const api = useMemo(bridge, [active]);
  const [status, setStatus] = useState<SpotifyState["status"]>("checking");
  const [user, setUser] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[] | null>(null);
  const [selected, setSelected] = useState<SpotifyPlaylist | null>(null);
  const [items, setItems] = useState<SpotifyTrack[] | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);
  const [checked, setChecked] = useState(false);

  const get = useCallback(
    async <T,>(url: string): Promise<T> => {
      const r = await api!.spotifyGet!(url);
      if (!r.ok) throw new Error(r.error || "Error de Spotify");
      return r.data as T;
    },
    [api],
  );

  const loadPlaylists = useCallback(async () => {
    const out: SpotifyPlaylist[] = [];
    let url: string | null = "/v1/me/playlists?limit=50";
    while (url && out.length < 1000) {
      const page: PageOf<{ id: string; name: string; tracks?: { total?: number }; images?: { url: string }[] | null }> = await get(url);
      for (const p of page.items ?? []) {
        if (p) out.push({ id: p.id, name: p.name, total: p.tracks?.total ?? 0, image: p.images?.[0]?.url ?? null });
      }
      url = page.next ?? null;
    }
    let liked = 0;
    try {
      liked = (await get<PageOf<unknown>>("/v1/me/tracks?limit=1")).total ?? 0;
    } catch {
      /* sin permiso de "Me gusta": se omite */
    }
    setPlaylists([{ id: LIKED_ID, name: "Temas que me gustan", total: liked, image: null }, ...out]);
  }, [get]);

  // al abrir la pestaña por primera vez: ¿hay sesión guardada?
  useEffect(() => {
    if (!active || checked || !api) return;
    setChecked(true);
    void (async () => {
      try {
        const s = await api.spotifyStatus!();
        if (s.connected) {
          setUser(s.user ?? null);
          setStatus("on");
          await loadPlaylists();
        } else {
          setStatus("off");
          if (s.error) setError(s.error);
        }
      } catch {
        setStatus("off");
      }
    })();
  }, [active, checked, api, loadPlaylists]);

  const connect = useCallback(() => {
    if (!api) return;
    setError(null);
    setStatus("connecting");
    void (async () => {
      const r = await api.spotifyLogin!();
      if (r.ok) {
        setUser(r.user ?? null);
        setStatus("on");
        try {
          await loadPlaylists();
        } catch (e) {
          setError(String((e as Error).message));
        }
      } else {
        setStatus("off");
        setError(r.error ?? "No se pudo conectar");
      }
    })();
  }, [api, loadPlaylists]);

  const disconnect = useCallback(() => {
    void api?.spotifyLogout?.();
    setStatus("off");
    setUser(null);
    setPlaylists(null);
    setSelected(null);
    setItems(null);
  }, [api]);

  const select = useCallback(
    (p: SpotifyPlaylist) => {
      setSelected(p);
      setItems(null);
      setError(null);
      setLoadingItems(true);
      void (async () => {
        const out: SpotifyTrack[] = [];
        try {
          let url: string | null =
            p.id === LIKED_ID
              ? "/v1/me/tracks?limit=50"
              : `/v1/playlists/${encodeURIComponent(p.id)}/tracks?` +
                new URLSearchParams({ limit: "100", fields: "items(track(id,name,duration_ms,type,artists(name))),next,total" });
          while (url && out.length < MAX_ITEMS) {
            const page: PageOf<{ track: RawTrack }> = await get(url);
            for (const it of page.items ?? []) {
              const t = toTrack(it?.track ?? null);
              if (t) out.push(t);
            }
            url = page.next ?? null;
          }
          setItems(out);
        } catch (e) {
          setError(String((e as Error).message));
          setItems(out.length ? out : []);
        } finally {
          setLoadingItems(false);
        }
      })();
    },
    [get],
  );

  const matches = useMemo(
    () =>
      items
        ? matchPlaylist(
            items,
            tracks.map((t) => ({ id: t.id, title: t.title, artist: t.artist, fileName: t.fileName, duration: t.duration })),
          )
        : [],
    [items, tracks],
  );

  return {
    available: !!api,
    status,
    user,
    error,
    playlists,
    selected,
    items,
    loadingItems,
    matches,
    connect,
    disconnect,
    select,
  };
}

const fmtMs = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Columna izquierda: cuenta y playlists. */
export function SpotifySide({ sp }: { sp: SpotifyState }) {
  if (!sp.available) {
    return (
      <div className="tree-empty">
        <span className="te-title">Spotify</span>
        <span className="te-sub">Disponible en la app de escritorio.</span>
      </div>
    );
  }
  if (sp.status !== "on") {
    return (
      <div className="sp-side">
        <div className="tree-empty">
          <span className="te-title">Spotify</span>
          <span className="te-sub">
            Conectá tu cuenta para ver tus playlists y armar listas con los temas que ya tenés. La música suena desde tus
            archivos, con EQ, efectos y sync; de Spotify solo se lee la lista.
          </span>
        </div>
        <button type="button" className="sp-connect" onClick={sp.connect} disabled={sp.status !== "off"}>
          {sp.status === "connecting" ? "Esperando a Spotify en el navegador…" : sp.status === "checking" ? "…" : "Conectar con Spotify"}
        </button>
        {sp.status === "connecting" ? (
          <span className="sp-hint">Se abrió tu navegador. Iniciá sesión, aceptá y volvé acá.</span>
        ) : null}
        {sp.error ? <span className="sp-err">{sp.error}</span> : null}
      </div>
    );
  }
  return (
    <div className="sp-side">
      <div className="sp-acc">
        <span className="sp-av">{(sp.user || "?").slice(0, 1).toUpperCase()}</span>
        <div>
          <b data-no-i18n>{sp.user || "Mi cuenta"}</b>
          <small>● Conectado a Spotify</small>
        </div>
        <button type="button" onClick={sp.disconnect} title="Desconectar la cuenta de Spotify de esta PC">
          Salir
        </button>
      </div>
      <div className="sp-h">TUS PLAYLISTS</div>
      <div className="sp-pl" role="listbox" aria-label="Playlists de Spotify">
        {sp.playlists == null ? <span className="sp-hint">Leyendo playlists…</span> : null}
        {sp.playlists?.map((p) => (
          <button
            key={p.id}
            type="button"
            role="option"
            aria-selected={sp.selected?.id === p.id}
            className={sp.selected?.id === p.id ? "sel" : undefined}
            onClick={() => sp.select(p)}
          >
            <i style={p.image ? { backgroundImage: `url(${p.image})` } : undefined} className={p.id === LIKED_ID ? "liked" : undefined} />
            <span data-no-i18n={p.id === LIKED_ID ? undefined : true}>{p.name}</span>
            <em>{p.total}</em>
          </button>
        ))}
      </div>
      <div className="sp-note">Solo se lee la lista de temas. La música se toca desde tus archivos, con EQ, efectos y sync.</div>
    </div>
  );
}

interface SpotifyTracksProps {
  sp: SpotifyState;
  tracks: LibraryTrack[];
  onCreateList: (name: string, trackIds: string[]) => void;
  onLoad: (track: LibraryTrack, deck: "A" | "B") => void;
  notify: (msg: string) => void;
}

/** Columna derecha: temas de la playlist y si están en la biblioteca. */
export function SpotifyTracks({ sp, tracks, onCreateList, onLoad, notify }: SpotifyTracksProps) {
  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  if (!sp.available || sp.status !== "on") {
    return (
      <div className="sp-main sp-empty">
        <span>Conectá tu cuenta de Spotify a la izquierda.</span>
      </div>
    );
  }
  if (!sp.selected) {
    return (
      <div className="sp-main sp-empty">
        <span>Elegí una playlist a la izquierda.</span>
      </div>
    );
  }
  const found = sp.matches.filter((m) => m.local);
  const missing = sp.matches.filter((m) => !m.local);
  const ids = [...new Set(found.map((m) => m.local!.id))];
  const totalMs = (sp.items ?? []).reduce((a, t) => a + t.durationMs, 0);

  const exportMissing = () => {
    const text = missing.map((m) => trackLabel(m.track)).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    a.download = `Faltantes - ${sp.selected!.name}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="sp-main">
      <div className="sp-top">
        <span
          className={`sp-cover${sp.selected.id === LIKED_ID ? " liked" : ""}`}
          style={sp.selected.image ? { backgroundImage: `url(${sp.selected.image})` } : undefined}
        />
        <div>
          <h3 data-no-i18n>{sp.selected.name}</h3>
          <p>
            Playlist de Spotify · {sp.items ? `${sp.items.length} temas · ${Math.round(totalMs / 60000)} min` : "leyendo…"}
          </p>
        </div>
        {sp.items ? (
          <div className="sp-sum">
            <span className="sp-chip ok">✓ {found.length} en tu biblioteca</span>
            {missing.length ? <span className="sp-chip no">{missing.length} faltan</span> : null}
          </div>
        ) : null}
      </div>
      <div className="sp-tbl">
        <div className="sp-row hd">
          <span>#</span>
          <span>Título</span>
          <span>Artista</span>
          <span>Dur.</span>
          <span>En BROSS DJ</span>
        </div>
        {sp.loadingItems && !sp.items ? <div className="sp-empty">Leyendo los temas de la playlist…</div> : null}
        {sp.error ? <div className="sp-empty sp-err">{sp.error}</div> : null}
        {sp.matches.map((m, i) => {
          const local = m.local ? byId.get(m.local.id) : undefined;
          return (
            <div
              key={`${m.track.id ?? m.track.title}-${i}`}
              className={`sp-row${local ? " ok" : ""}`}
              onDoubleClick={(e) => local && onLoad(local, e.shiftKey ? "B" : "A")}
              title={local ? "Doble clic: cargar en el Deck A · Mayús+doble clic: Deck B" : undefined}
            >
              <span className="n">{i + 1}</span>
              <span data-no-i18n>{m.track.title}</span>
              <span className="m" data-no-i18n>
                {m.track.artists.join(", ")}
              </span>
              <span className="d">{fmtMs(m.track.durationMs)}</span>
              {local ? (
                <span className="sp-st ok">
                  <i className="dot" />
                  <span className="file" data-no-i18n>
                    {local.fileName}
                  </span>
                </span>
              ) : (
                <span className="sp-st no">
                  <i className="dot" />
                  Falta
                  <button
                    type="button"
                    onClick={() =>
                      window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(trackLabel(m.track))}`, "_blank")
                    }
                    title="Buscar el tema en YouTube (se abre en el navegador)"
                  >
                    Buscar en YouTube
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="sp-foot">
        <span>Se compara por artista y título (sin importar mayúsculas, acentos ni "feat.").</span>
        <span className="grow" />
        <button type="button" onClick={exportMissing} disabled={!missing.length}>
          Exportar faltantes (.txt)
        </button>
        <button
          type="button"
          className="pri"
          disabled={!ids.length}
          onClick={() => {
            onCreateList(sp.selected!.name, ids);
            notify(`Lista «${sp.selected!.name}» creada con ${ids.length} temas`);
          }}
        >
          Crear lista «{sp.selected.name}» con {ids.length} temas
        </button>
      </div>
    </div>
  );
}
