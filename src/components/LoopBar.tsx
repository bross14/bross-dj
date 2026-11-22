import type { DeckRuntime } from "../engine/audio";

interface LoopBarProps {
  runtime: DeckRuntime;
  onLoopIn: () => void;
  onLoopOut: () => void;
  onAuto: () => void;
  onResize: (factor: number) => void;
  onMove: (dir: -1 | 1) => void;
  onReloop: () => void;
  onSlip: () => void;
}

/** 1/32 … 128 beats como fracción legible. */
export function beatsLabel(b: number): string {
  if (b >= 1) return Number.isInteger(b) ? String(b) : b.toFixed(2).replace(/0+$/, "");
  const den = Math.round(1 / b);
  return Math.abs(1 / den - b) < 1e-3 ? `1/${den}` : b.toFixed(3);
}

/**
 * Controles de loop en la fila del pitch: LOOP IN / OUT,
 * ◀ largo ▶ (Mayús+clic mueve el loop), LOOP (auto), RELOOP y SLIP.
 */
export function LoopBar({ runtime, onLoopIn, onLoopOut, onAuto, onResize, onMove, onReloop, onSlip }: LoopBarProps) {
  const active = runtime.loopStart != null;
  const size = active && runtime.loopBeats ? runtime.loopBeats : runtime.autoLoopBeats;
  const disabled = !runtime.loaded;
  return (
    <div className="loopbar">
      <div className="pgroup">
        <div className="pbtns">
          <button
            type="button"
            className={`pk lb${runtime.loopIn != null ? " armed" : ""}`}
            disabled={disabled}
            onClick={onLoopIn}
            title="LOOP IN: marca el inicio del loop"
          >
            IN
          </button>
          <button
            type="button"
            className="pk lb"
            disabled={disabled || runtime.loopIn == null}
            onClick={onLoopOut}
            title="LOOP OUT: cierra el loop desde IN hasta acá"
          >
            OUT
          </button>
          <button
            type="button"
            className="pk lb"
            disabled={disabled}
            onClick={(e) => (e.shiftKey ? onMove(-1) : onResize(0.5))}
            title="Loop a la mitad · Mayús+clic: mover el loop hacia atrás"
          >
            ◀
          </button>
          <span className={`lsize${active ? " on" : ""}`} title="Largo del loop en beats">
            {beatsLabel(size)}
          </span>
          <button
            type="button"
            className="pk lb"
            disabled={disabled}
            onClick={(e) => (e.shiftKey ? onMove(1) : onResize(2))}
            title="Loop al doble · Mayús+clic: mover el loop hacia adelante"
          >
            ▶
          </button>
          <button
            type="button"
            className={`pk lb lled${active ? " on" : ""}`}
            disabled={disabled || !runtime.bpm}
            onClick={onAuto}
            aria-pressed={active}
            title={runtime.bpm ? "LOOP: activa/sale de un loop del largo elegido" : "LOOP: falta el BPM"}
          >
            LOOP
          </button>
          <button
            type="button"
            className="pk lb"
            disabled={disabled || (!active && !runtime.canReloop)}
            onClick={onReloop}
            title="RELOOP: vuelve al último loop"
          >
            ⟲
          </button>
        </div>
        <span className="pglab">LOOP</span>
      </div>
      <div className="pgroup">
        <button
          type="button"
          className={`pk lb lled slipbtn${runtime.slip ? " on" : ""}`}
          onClick={onSlip}
          aria-pressed={runtime.slip}
          title="SLIP: al soltar scratch, loop o reverse, la pista sigue donde habría estado"
        >
          SLIP
        </button>
        <span className="pglab">MODE</span>
      </div>
    </div>
  );
}
