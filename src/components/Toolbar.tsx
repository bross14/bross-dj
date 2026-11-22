import { useEffect, useState, type ReactNode } from "react";

function clockText(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function fmtRec(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const p = (n: number) => n.toString().padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(r)}` : `${p(m)}:${p(r)}`;
}

interface ToolbarProps {
  onOpenSettings: () => void;
  quantize: boolean;
  onQuantize: () => void;
  /** segundos grabados (null = no está grabando) */
  recSeconds: number | null;
  onRec: () => void;
  automix: boolean;
  onAutomix: () => void;
  /** módulos: video, karaoke, entrada de línea */
  modules?: ReactNode;
  /** salida además de REC: en vivo, pedidos */
  output?: ReactNode;
}

export function Toolbar({
  onOpenSettings,
  quantize,
  onQuantize,
  recSeconds,
  onRec,
  automix,
  onAutomix,
  modules,
  output,
}: ToolbarProps) {
  const [clock, setClock] = useState(clockText);

  useEffect(() => {
    const id = window.setInterval(() => setClock(clockText()), 15000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="bar">
      <div className="logo">BROSS DJ</div>
      {/* mezcla: lo que cambia cómo se mezcla */}
      <div className="bargroup" aria-label="Mezcla">
        <button
          type="button"
          className={`chip autobtn${automix ? " on" : ""}`}
          aria-pressed={automix}
          onClick={onAutomix}
          title={
            automix
              ? "Automix encendido: mezcla sola los temas de la sidelist"
              : "Automix: mezcla automáticamente los temas de la sidelist (SIDE)"
          }
        >
          AUTO <b>{automix ? "ON" : "OFF"}</b>
        </button>
        <button
          type="button"
          className={`chip qbtn${quantize ? " on" : ""}`}
          aria-pressed={quantize}
          onClick={onQuantize}
          title={
            quantize
              ? "Cuantización encendida: cues y saltos caen en el beat"
              : "Cuantización apagada: cues y saltos donde los marques"
          }
        >
          Q <b>{quantize ? "ON" : "OFF"}</b>
        </button>
      </div>
      <div className="mckbox">
        <span className="mck">
          {clock}
        </span>
      </div>
      <div className="barR">
        {/* módulos: video, karaoke, entrada de línea */}
        {modules ? (
          <div className="bargroup" aria-label="Módulos">
            {modules}
          </div>
        ) : null}
        {/* salida: grabación y transmisión, bien visibles */}
        <div className="bargroup out" aria-label="Salida">
        <button
          type="button"
          className={`chip recbtn${recSeconds != null ? " on" : ""}`}
          aria-pressed={recSeconds != null}
          onClick={onRec}
          title={
            recSeconds != null
              ? "Detener la grabación (se guarda en Música/BROSS DJ)"
              : "Grabar el set con lista de temas y hoja CUE (Música/BROSS DJ · formato y fuente en Ajustes)"
          }
        >
          REC <b className="rec">● {fmtRec(recSeconds ?? 0)}</b>
        </button>
        {output}
        </div>
        <button
          type="button"
          className="gear-btn"
          onClick={onOpenSettings}
          title="Ajustes generales"
          aria-label="Abrir ajustes generales"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="currentColor"
              d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58ZM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2Z"
            />
          </svg>
        </button>
        <WindowControls />
      </div>
    </div>
  );
}

/** Minimizar, maximizar/restaurar y cerrar (solo en la app de escritorio). */
function WindowControls() {
  const bridge = typeof window !== "undefined" ? window.bross : undefined;
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!bridge?.winClose) return;
    void bridge.winIsMaximized?.().then(setMaximized);
    return bridge.onWinState?.((s) => setMaximized(s.maximized));
  }, [bridge]);
  if (!bridge?.winClose) return null;
  return (
    <div className="winctl" role="group" aria-label="Ventana">
      <button type="button" className="winbtn" onClick={() => bridge.winMinimize?.()} title="Minimizar" aria-label="Minimizar">
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 5.5h8" />
        </svg>
      </button>
      <button
        type="button"
        className="winbtn"
        onClick={() => bridge.winToggleMaximize?.()}
        title={maximized ? "Restaurar" : "Maximizar"}
        aria-label={maximized ? "Restaurar" : "Maximizar"}
      >
        {maximized ? (
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M3 3V1.5h5.5V7H7" />
            <rect x="1.5" y="3" width="5.5" height="5.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <rect x="1.5" y="1.5" width="7" height="7" />
          </svg>
        )}
      </button>
      <button type="button" className="winbtn close" onClick={() => bridge.winClose?.()} title="Cerrar" aria-label="Cerrar">
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
        </svg>
      </button>
    </div>
  );
}
