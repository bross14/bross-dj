import { useEffect, useState } from "react";
import type { LibraryTrack, LoopRange, TrackPois } from "../engine/audio";
import type { TrackAnalysis } from "../engine/analysis";
import { canWriteTags, type EditableTags } from "../library";

export interface TrackEdit {
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  year?: string;
  tagBpm?: number;
  tagKey?: string;
  analysis: TrackAnalysis | null;
  pois: TrackPois;
}

interface TrackEditorProps {
  track: LibraryTrack;
  onSave: (edit: TrackEdit, writeFile: EditableTags | null) => Promise<string | null>;
  onClose: () => void;
}

type Tab = "tags" | "grid" | "cues";

/** 83.5 → "1:23.500" */
export function fmtPoint(t: number | null | undefined): string {
  if (t == null || !Number.isFinite(t)) return "";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

/** "1:23.5" / "83.5" → segundos (null si está vacío o no se entiende) */
export function parsePoint(v: string): number | null {
  const x = v.trim().replace(",", ".");
  if (!x) return null;
  const m = x.match(/^(\d+):(\d{1,2}(?:\.\d*)?)$/);
  const n = m ? Number(m[1]) * 60 + Number(m[2]) : Number(x);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const CUE_COLORS = ["#e04b4b", "#e08a2f", "#d9c22f", "#4ade64", "#2fd9c2", "#2f8fe8", "#8a5cf0", "#e04bb0"];

/** Editor de pista: etiquetas (se escriben en MP3/FLAC), rejilla de beats y puntos. */
export function TrackEditor({ track, onSave, onClose }: TrackEditorProps) {
  const [tab, setTab] = useState<Tab>("tags");
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const [album, setAlbum] = useState(track.album ?? "");
  const [genre, setGenre] = useState(track.genre ?? "");
  const [year, setYear] = useState(track.year ?? "");
  const [tagBpm, setTagBpm] = useState(track.tagBpm ? String(track.tagBpm) : "");
  const [tagKey, setTagKey] = useState(track.tagKey ?? "");
  const [writeFile, setWriteFile] = useState(canWriteTags(track.sourcePath));
  const [bpm, setBpm] = useState(track.analysis?.bpm ? track.analysis.bpm.toFixed(2) : "");
  const [firstBeat, setFirstBeat] = useState(track.analysis ? track.analysis.firstBeat.toFixed(3) : "");
  const [cuePoint, setCuePoint] = useState(fmtPoint(track.pois?.cuePoint ?? 0));
  const [cues, setCues] = useState<string[]>(() => Array.from({ length: 8 }, (_, i) => fmtPoint(track.pois?.cues?.[i])));
  const [loops, setLoops] = useState<(LoopRange | null)[]>(() =>
    Array.from({ length: 8 }, (_, i) => track.pois?.loops?.[i] ?? null),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const writable = canWriteTags(track.sourcePath);

  const save = async () => {
    setError(null);
    const tb = tagBpm.trim() ? Number(tagBpm.replace(",", ".")) : undefined;
    if (tb != null && !(tb > 30 && tb < 300)) return setError("El BPM de la etiqueta tiene que estar entre 30 y 300.");
    let analysis = track.analysis;
    if (analysis && bpm.trim()) {
      const b = Number(bpm.replace(",", "."));
      const f = Number(firstBeat.replace(",", "."));
      if (!(b >= 40 && b <= 250)) return setError("El BPM de la rejilla tiene que estar entre 40 y 250.");
      if (!Number.isFinite(f) || f < 0) return setError("El primer beat tiene que ser un tiempo en segundos.");
      if (Math.abs(b - analysis.bpm) > 1e-6 || Math.abs(f - analysis.firstBeat) > 1e-6) {
        const beat = 60 / b;
        analysis = { ...analysis, bpm: b, firstBeat: ((f % beat) + beat) % beat, edited: true };
      }
    }
    const cp = parsePoint(cuePoint);
    const parsedCues = cues.map((c) => (c.trim() ? parsePoint(c) : null));
    if (cues.some((c, i) => c.trim() && parsedCues[i] == null)) return setError("Hay un hot cue con un tiempo que no se entiende (usá 1:23.500).");
    const clamp = (t: number) => Math.min(Math.max(0, t), track.duration || t);
    const pois: TrackPois = {
      cuePoint: clamp(cp ?? 0),
      cues: parsedCues.map((c) => (c == null ? null : clamp(c))),
      loops,
    };
    const edit: TrackEdit = {
      title: title.trim() || track.fileName,
      artist: artist.trim(),
      album: album.trim() || undefined,
      genre: genre.trim() || undefined,
      year: year.trim() || undefined,
      tagBpm: tb,
      tagKey: tagKey.trim() || undefined,
      analysis,
      pois,
    };
    const fileTags: EditableTags | null =
      writable && writeFile
        ? {
            title: edit.title,
            artist: edit.artist,
            album: edit.album ?? "",
            genre: edit.genre ?? "",
            year: edit.year ?? "",
            bpm: tb ?? "",
            key: edit.tagKey ?? "",
          }
        : null;
    setSaving(true);
    const err = await onSave(edit, fileTags);
    setSaving(false);
    if (err) setError(err);
    else onClose();
  };

  const field = (label: string, value: string, set: (v: string) => void, opts: { mono?: boolean; placeholder?: string } = {}) => (
    <label className="te-field">
      <span>{label}</span>
      <input
        value={value}
        spellCheck={false}
        className={opts.mono ? "mono" : ""}
        placeholder={opts.placeholder}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void save()}
      />
    </label>
  );

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-card track-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Editor de pista"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="settings-head">
          <div>
            <h2>{track.title}</h2>
            <p title={track.sourcePath}>{track.sourcePath ?? track.fileName}</p>
          </div>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Cerrar editor">
            ✕
          </button>
        </header>
        <nav className="settings-tabs" role="tablist">
          {(
            [
              ["tags", "Etiquetas"],
              ["grid", "Rejilla y tono"],
              ["cues", "Cues y loops"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`settings-tab${tab === id ? " on" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          {tab === "tags" ? (
            <section className="settings-section te-grid">
              {field("Título", title, setTitle)}
              {field("Artista", artist, setArtist)}
              {field("Álbum", album, setAlbum)}
              {field("Género", genre, setGenre)}
              {field("Año", year, setYear, { mono: true })}
              {field("BPM (etiqueta)", tagBpm, setTagBpm, { mono: true })}
              {field("Tono (etiqueta)", tagKey, setTagKey, { mono: true, placeholder: "8A, Am…" })}
              <label className="te-check">
                <input type="checkbox" checked={writable && writeFile} disabled={!writable} onChange={(e) => setWriteFile(e.target.checked)} />
                {writable
                  ? "Escribir también en el archivo (la carátula y el resto de las etiquetas se conservan)"
                  : "Este formato se edita solo en la biblioteca (la escritura en el archivo es para MP3 y FLAC)"}
              </label>
            </section>
          ) : tab === "grid" ? (
            <section className="settings-section te-grid">
              {track.analysis ? (
                <>
                  {field("BPM de la rejilla", bpm, setBpm, { mono: true })}
                  <div className="te-inline">
                    <button type="button" className="settings-btn" onClick={() => setBpm((v) => (Number(v) * 2).toFixed(2))}>
                      ×2
                    </button>
                    <button type="button" className="settings-btn" onClick={() => setBpm((v) => (Number(v) / 2).toFixed(2))}>
                      ÷2
                    </button>
                    <button
                      type="button"
                      className="settings-btn"
                      onClick={() => setBpm((v) => String(Math.round(Number(v))))}
                      title="Redondear al BPM entero"
                    >
                      Redondear
                    </button>
                  </div>
                  {field("Primer beat (segundos)", firstBeat, setFirstBeat, { mono: true })}
                  <p className="settings-note">
                    Tono detectado: <b>{track.analysis.camelot}</b> ({track.analysis.keyName}) · confianza{" "}
                    {Math.round(track.analysis.keyConfidence * 100)} %. Una rejilla editada a mano no se vuelve a analizar.
                    Para ajustar con el oído, usá los botones de rejilla del waveform con la pista en un deck.
                  </p>
                </>
              ) : (
                <p className="settings-intro">La pista todavía no está analizada: cargala en un deck y volvé.</p>
              )}
            </section>
          ) : (
            <section className="settings-section">
              <div className="te-grid">{field("Punto de CUE", cuePoint, setCuePoint, { mono: true, placeholder: "0:00.000" })}</div>
              <h3 className="te-h">Hot cues</h3>
              <div className="te-cues">
                {cues.map((c, i) => (
                  <label key={i} className="te-cue">
                    <span className="te-dot" style={{ background: CUE_COLORS[i] }}>
                      {i + 1}
                    </span>
                    <input
                      className="mono"
                      value={c}
                      placeholder="—"
                      onChange={(e) => setCues((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                    />
                    {c ? (
                      <button
                        type="button"
                        className="midi-clear"
                        onClick={() => setCues((prev) => prev.map((x, j) => (j === i ? "" : x)))}
                        title="Borrar"
                      >
                        ✕
                      </button>
                    ) : null}
                  </label>
                ))}
              </div>
              {/* Loops que guardaban los pads de la versión anterior. Los pads
                  de LOOP ahora tienen largo fijo y ya no los usan: se muestran
                  solo si quedó alguno, para poder borrarlos. */}
              {loops.some(Boolean) ? (
                <>
                  <h3 className="te-h">Loops guardados (versión anterior)</h3>
                  <p className="settings-note te-oldloops">
                    Los pads de LOOP ahora tienen un largo fijo y ya no usan estos loops. Podés borrarlos.
                  </p>
                  <div className="te-cues">
                    {loops.map((l, i) =>
                      l ? (
                        <div key={i} className="te-cue">
                          <span className="te-dot loop">{i + 1}</span>
                          <span className="mono te-loop">{`${fmtPoint(l.start)} → ${fmtPoint(l.end)}`}</span>
                          <button
                            type="button"
                            className="midi-clear"
                            onClick={() => setLoops((prev) => prev.map((x, j) => (j === i ? null : x)))}
                            title="Borrar"
                          >
                            ✕
                          </button>
                        </div>
                      ) : null,
                    )}
                  </div>
                  <div className="settings-inline">
                    <button type="button" className="settings-btn" onClick={() => setLoops(Array(8).fill(null))}>
                      Borrar todos los loops guardados
                    </button>
                  </div>
                </>
              ) : null}
            </section>
          )}
          {error ? <p className="settings-error">{error}</p> : null}
          <div className="settings-inline te-actions">
            <button type="button" className="settings-btn" onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className="settings-btn primary" disabled={saving} onClick={() => void save()}>
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
