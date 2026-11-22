import { useEffect, useState } from "react";
import type { SyncInfo } from "../library";

interface LibraryPanelProps {
  /** baja la biblioteca de la carpeta y la combina con la local */
  onPull: (json: string) => { tracks: number; playlists: number; history: number };
  trackCount: number;
}

const fmtDate = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : "nunca");

/** Pestaña de Ajustes: base de datos y sincronización con una carpeta. */
export function LibraryPanel({ onPull, trackCount }: LibraryPanelProps) {
  const bridge = window.bross;
  const [info, setInfo] = useState<SyncInfo | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void bridge?.librarySyncInfo?.().then(setInfo).catch(() => undefined);
  }, [bridge]);

  if (!bridge?.librarySyncInfo) {
    return <p className="settings-intro">La sincronización de la biblioteca solo está en la app de escritorio.</p>;
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="settings-intro">
        La biblioteca ({trackCount} pistas, listas, cues, loops e historial) vive en una base SQLite en la carpeta de
        datos de la app. Para usarla en otra PC, elegí una carpeta que se sincronice sola (OneDrive, Dropbox, Google
        Drive o un pendrive): <b>Subir</b> deja una copia ahí y <b>Bajar y combinar</b> trae lo que falte sin borrar
        nada local.
      </p>
      <div className="settings-row">
        <span className="settings-label"><b>Carpeta</b></span>
        <span className="settings-value mono" title={info?.dir ?? ""}>
          {info?.dir ?? "sin elegir"}
        </span>
      </div>
      <div className="settings-row">
        <span className="settings-label"><b>Última copia</b></span>
        <span className="settings-value">{fmtDate(info?.mtime ?? null)}</span>
      </div>
      <div className="settings-inline">
        <button
          type="button"
          className="settings-btn"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const next = await bridge.librarySyncPick!();
              if (next) setInfo(next);
            })
          }
        >
          {info?.dir ? "Cambiar carpeta" : "Elegir carpeta"}
        </button>
        <button
          type="button"
          className="settings-btn"
          disabled={busy || !info?.dir}
          onClick={() =>
            run(async () => {
              const next = await bridge.librarySyncPush!();
              if (next) {
                setInfo(next);
                setStatus("Biblioteca copiada a la carpeta.");
              }
            })
          }
        >
          Subir
        </button>
        <button
          type="button"
          className="settings-btn"
          disabled={busy || !info?.mtime}
          onClick={() =>
            run(async () => {
              const json = await bridge.librarySyncPull!();
              if (!json) {
                setStatus("No hay copia en la carpeta.");
                return;
              }
              const r = onPull(json);
              setStatus(`Combinado: +${r.tracks} pistas, +${r.playlists} listas, +${r.history} reproducciones.`);
            })
          }
        >
          Bajar y combinar
        </button>
        {info?.dir ? (
          <button
            type="button"
            className="settings-btn"
            disabled={busy}
            onClick={() => run(async () => setInfo(await bridge.librarySyncClear!()))}
          >
            Dejar de sincronizar
          </button>
        ) : null}
      </div>
      {status ? <p className="settings-note">{status}</p> : null}
      <p className="settings-note">
        Las pistas se reconocen por su ruta: si en la otra PC la música está en otra carpeta, se agregan como pistas
        nuevas que no se pueden abrir hasta que la carpeta exista.
      </p>
    </>
  );
}
