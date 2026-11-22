import { useEffect, useMemo, useState } from "react";
import type { LibraryTrack } from "../engine/audio";
import { lrcIndexAt, type LrcLine, type Singer } from "../karaoke";
import type { Playlist } from "../library";

interface KaraokePanelProps {
  enabled: boolean;
  onEnabled: (on: boolean) => void;
  tracks: LibraryTrack[];
  playlists: Playlist[];
  singers: Singer[];
  current: Singer | null;
  onAdd: (name: string, trackId: string | null, key: number) => void;
  onUpdate: (id: string, patch: Partial<Singer>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onNext: () => void;
  onCurrentKey: (k: number) => void;
  background: string | null;
  onBackground: (id: string | null) => void;
  lyrics: { lrc: LrcLine[] | null; cdg: unknown } | null;
  /** posición del deck A (para mostrar la letra) */
  position: () => number;
  onOpenVideo: () => void;
  onClose: () => void;
}

const KEYS = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];

/** Panel de karaoke: turnos, tono por cantante, letras y música de fondo. */
export function KaraokePanel(p: KaraokePanelProps) {
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const [line, setLine] = useState<{ cur: string; next: string }>({ cur: "", next: "" });

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return p.tracks.filter((t) => `${t.title} ${t.artist} ${t.fileName}`.toLowerCase().includes(q)).slice(0, 8);
  }, [query, p.tracks]);

  // letra en vivo en el panel
  useEffect(() => {
    const lrc = p.lyrics?.lrc;
    if (!lrc?.length) {
      setLine({ cur: "", next: "" });
      return;
    }
    const id = window.setInterval(() => {
      const i = lrcIndexAt(lrc, p.position());
      setLine({ cur: lrc[i]?.text ?? "", next: lrc[i + 1]?.text ?? "" });
    }, 150);
    return () => window.clearInterval(id);
  }, [p.lyrics, p.position]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p]);

  const trackName = (id: string | null) => {
    const t = p.tracks.find((x) => x.id === id);
    return t ? `${t.artist ? `${t.artist} - ` : ""}${t.title}` : "sin tema";
  };

  return (
    <div className="settings-overlay" onClick={p.onClose}>
      <div className="settings-card karaoke-panel" role="dialog" aria-modal="true" aria-label="Karaoke" onClick={(e) => e.stopPropagation()}>
        <header className="settings-head">
          <div>
            <h2>Karaoke</h2>
            <p>Canta el deck A; la música de fondo suena por el B entre cantantes.</p>
          </div>
          <button type="button" className="settings-close" onClick={p.onClose} aria-label="Cerrar karaoke">
            ✕
          </button>
        </header>
        <div className="settings-body">
          <section className="settings-section">
            <div className="vp-inline">
              <label className="te-check">
                <input type="checkbox" checked={p.enabled} onChange={(e) => p.onEnabled(e.target.checked)} />
                Modo karaoke
              </label>
              <button type="button" className="settings-btn primary" disabled={!p.enabled || !p.singers.some((s) => s.trackId)} onClick={p.onNext}>
                ▶ Próximo cantante
              </button>
              <button type="button" className="settings-btn" onClick={p.onOpenVideo}>
                Pantalla con la letra…
              </button>
            </div>

            {p.current ? (
              <div className="kp-now">
                <div>
                  🎤 <b data-no-i18n>{p.current.name}</b> · <span data-no-i18n>{trackName(p.current.trackId)}</span>
                </div>
                <label className="te-field vp-small">
                  <span>Tono</span>
                  <select value={p.current.key} onChange={(e) => p.onCurrentKey(Number(e.target.value))}>
                    {KEYS.map((k) => (
                      <option key={k} value={k}>
                        {k > 0 ? `+${k}` : k}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
            {p.enabled ? (
              <div className="kp-lyrics" data-no-i18n>
                {p.lyrics?.cdg ? (
                  <span className="settings-note">Gráficos CD+G cargados: se ven en la pantalla de video.</span>
                ) : p.lyrics?.lrc?.length ? (
                  <>
                    <b>{line.cur || "…"}</b>
                    <span>{line.next}</span>
                  </>
                ) : (
                  <span className="settings-note">Sin letra: poné un .lrc o .cdg con el mismo nombre que el tema, en la misma carpeta.</span>
                )}
              </div>
            ) : null}

            <h3 className="te-h">Turnos ({p.singers.length})</h3>
            {p.singers.map((s, i) => (
              <div className="shortcut-row" key={s.id}>
                <span data-no-i18n>
                  {i + 1}. <b>{s.name}</b> <em className="midikind">· {trackName(s.trackId)}</em>
                </span>
                <span className="midi-bind">
                  <select value={s.key} onChange={(e) => p.onUpdate(s.id, { key: Number(e.target.value) })} aria-label="Tono del cantante">
                    {KEYS.map((k) => (
                      <option key={k} value={k}>
                        {k > 0 ? `+${k}` : k}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="midi-clear" onClick={() => p.onMove(s.id, -1)} title="Subir">
                    ▲
                  </button>
                  <button type="button" className="midi-clear" onClick={() => p.onMove(s.id, 1)} title="Bajar">
                    ▼
                  </button>
                  <button type="button" className="midi-clear" onClick={() => p.onRemove(s.id)} title="Quitar">
                    ✕
                  </button>
                </span>
              </div>
            ))}

            <div className="kp-add">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del cantante" aria-label="Nombre del cantante" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar el tema…" aria-label="Buscar tema" />
              <select value={key} onChange={(e) => setKey(Number(e.target.value))} aria-label="Tono">
                {KEYS.map((k) => (
                  <option key={k} value={k}>
                    {k > 0 ? `+${k}` : k}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="settings-btn"
                disabled={!name.trim() || !pick}
                onClick={() => {
                  p.onAdd(name, pick, key);
                  setName("");
                  setQuery("");
                  setPick(null);
                  setKey(0);
                }}
              >
                + Agregar
              </button>
            </div>
            {matches.length ? (
              <div className="kp-matches" data-no-i18n>
                {matches.map((t) => (
                  <button type="button" key={t.id} className={`kp-match${pick === t.id ? " on" : ""}`} onClick={() => setPick(t.id)}>
                    {t.artist ? `${t.artist} - ` : ""}
                    {t.title}
                  </button>
                ))}
              </div>
            ) : null}

            <h3 className="te-h">Música de fondo</h3>
            <div className="vp-inline">
              <select value={p.background ?? ""} onChange={(e) => p.onBackground(e.target.value || null)} aria-label="Lista de música de fondo">
                <option value="">Sin música de fondo</option>
                {p.playlists
                  .filter((l) => (l.kind ?? "list") === "list")
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
              <span className="settings-note">Suena al azar de esa lista por el deck B cuando no canta nadie.</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
