import React, { useRef } from "react";
import { img } from "../assets";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Botón que actúa al APRETAR (pointerdown), no al soltar: PLAY, hot cues y
 * sampler tienen que sonar en el instante del clic. El teclado (Enter /
 * espacio) sigue llegando por onClick, que en ese caso trae detail 0.
 */
export function press(fn: (e: { shiftKey: boolean }) => void) {
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      fn(e);
    },
    onClick: (e: React.MouseEvent) => {
      if (e.detail === 0) fn(e);
    },
  };
}

interface KnobProps {
  value: number;
  onChange: (v: number) => void;
  label: string;
  big?: boolean;
  disabled?: boolean;
}

export function Knob({ value, onChange, label, big, disabled }: KnobProps) {
  const drag = useRef<{ y: number; v: number } | null>(null);
  const deg = -140 + clamp01(value) * 280;
  // Potenciómetro (30 px en pantalla, imagen a 4x).
  const art = img("knob");

  const down = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, v: value };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || disabled) return;
    onChange(clamp01(d.v + (d.y - e.clientY) / 160));
  };
  const up = () => {
    drag.current = null;
  };
  const wheel = (e: React.WheelEvent) => {
    if (disabled) return;
    e.preventDefault();
    onChange(clamp01(value - e.deltaY * 0.0012));
  };
  const key = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault();
      onChange(clamp01(value + 0.02));
    }
    if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault();
      onChange(clamp01(value - 0.02));
    }
  };

  return (
    <div className="kpair">
      <div className="kl">{label}</div>
      <div
        className={`k${big ? " kbig" : ""}${disabled ? " is-disabled" : ""}${art ? " has-art" : ""}`}
        style={
          {
            "--deg": `${deg}deg`,
            backgroundImage: art ? `url(${art})` : undefined,
          } as React.CSSProperties
        }
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={wheel}
        onKeyDown={key}
        onDoubleClick={() => !disabled && onChange(0.5)}
      />
    </div>
  );
}

interface VFaderProps {
  value: number;
  onChange: (v: number) => void;
  label?: string;
}

export function VFader({ value, onChange, label }: VFaderProps) {
  const drag = useRef<{ rect: DOMRect } | null>(null);
  // Tapa cromada (34×15 px).
  const thumbArt = img("fader-thumb");

  const set = (clientY: number) => {
    const r = drag.current?.rect;
    if (!r) return;
    onChange(clamp01(1 - (clientY - r.top) / r.height));
  };

  return (
    <div className="fadwrap">
      <div
        className="frail"
        role="slider"
        aria-label={label ?? "Fader"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { rect: (e.currentTarget as HTMLElement).getBoundingClientRect() };
          set(e.clientY);
        }}
        onPointerMove={(e) => drag.current && set(e.clientY)}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onWheel={(e) => {
          e.preventDefault();
          onChange(clamp01(value - e.deltaY * 0.0012));
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            onChange(clamp01(value + 0.02));
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            onChange(clamp01(value - 0.02));
          }
        }}
      >
        <div
          className={`fth${thumbArt ? " has-art" : ""}`}
          style={{
            bottom: `calc(${value} * (100% - 14px))`,
            backgroundImage: thumbArt ? `url(${thumbArt})` : undefined,
          }}
        />
      </div>
      {label ? <div className="clab">{label}</div> : null}
    </div>
  );
}

interface PitchProps {
  value: number;
  range: number;
  deck: "A" | "B";
  keyLock: boolean;
  onKeyLock: () => void;
  onRange: (dir: -1 | 1) => void;
  onChange: (v: number) => void;
  /** controles extra al final de la fila (barra de loops) */
  extra?: React.ReactNode;
}

/** Pasos del rango de pitch (± %), de menor a mayor. 50 es el modo WIDE. */
export const PITCH_RANGES = [8, 16, 50] as const;

/** Fader de pitch horizontal, como en la plantilla: pastilla PITCH + valor,
 *  riel con marcas, límites ± y los grupos RANGE / KEY al costado. */
export function PitchBar({ value, range, deck, keyLock, onKeyLock, onRange, onChange, extra }: PitchProps) {
  const pct = ((value - 0.5) * 2 * range).toFixed(2);
  const wide = range >= 50;
  // Misma tapa cromada que el crossfader.
  const capArt = img("xfader-thumb");

  const rangeGroup = (
    <div className="pgroup" key="range">
      <div className="pbtns">
        <button
          type="button"
          className="pk"
          title="Bajar el rango del pitch"
          aria-label="Bajar rango de pitch"
          disabled={range <= PITCH_RANGES[0]}
          onClick={() => onRange(-1)}
        >
          −
        </button>
        <button
          type="button"
          className="pk"
          title="Subir el rango del pitch"
          aria-label="Subir rango de pitch"
          disabled={range >= PITCH_RANGES[PITCH_RANGES.length - 1]}
          onClick={() => onRange(1)}
        >
          +
        </button>
      </div>
      <span className={`pglab${wide ? " wide" : ""}`}>{wide ? "WIDE" : "RANGE"}</span>
    </div>
  );

  const keyGroup = (
    <div className={`pgroup key${keyLock ? " on" : ""}`} key="key">
      <button
        type="button"
        className={`pk pklock${keyLock ? " on" : ""}`}
        onClick={onKeyLock}
        aria-pressed={keyLock}
        aria-label="Bloquear el tono (key lock)"
        title={
          keyLock
            ? "Key lock activo: el tono no cambia al mover el pitch"
            : "Key lock apagado: el pitch cambia el tono"
        }
      >
        <svg className="lock-ico" viewBox="0 0 10 12" aria-hidden>
          {/* arco: cerrado con key lock, abierto (pata derecha suelta) sin él */}
          <path d={keyLock ? "M3 5.5V3.6a2 2 0 0 1 4 0v1.9" : "M3 5.5V3.6a2 2 0 0 1 4 0v-.4"} />
          <rect x="1.5" y="5.5" width="7" height="5.5" rx="1" />
        </svg>
        LOCK
      </button>
      <span className="pglab">KEY</span>
    </div>
  );

  return (
    <div className={`pitchbar deck-${deck.toLowerCase()}`} aria-label="Pitch">
      <div className="pinfo">
        <span className="pname">PITCH</span>
        <b className="pval">{pct}%</b>
      </div>
      <div className="pcenter">
        <div
          className="hpitch"
          role="slider"
          aria-label="Pitch"
          aria-valuemin={-range}
          aria-valuemax={range}
          aria-valuenow={Number(pct)}
          tabIndex={0}
          onPointerDown={(e) => {
            e.preventDefault();
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const move = (ev: PointerEvent) => {
              const v = (ev.clientX - rect.left) / rect.width;
              onChange(Math.max(0, Math.min(1, v)));
            };
            move(e.nativeEvent);
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
          onWheel={(e) => {
            e.preventDefault();
            onChange(Math.max(0, Math.min(1, value - e.deltaY * 0.0012)));
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              onChange(Math.max(0, Math.min(1, value - 0.005)));
            }
            if (e.key === "ArrowRight") {
              e.preventDefault();
              onChange(Math.max(0, Math.min(1, value + 0.005)));
            }
          }}
        >
          <div className="hmarks" aria-hidden />
          <div
            className={`hthumb${capArt ? " has-art" : ""}`}
            style={{
              left: `${value * 100}%`,
              backgroundImage: capArt ? `url(${capArt})` : undefined,
            }}
          />
        </div>
        <div className="plimits" aria-hidden>
          <span>{wide ? "WIDE" : `−${range}`}</span>
          <span>{wide ? "WIDE" : `+${range}`}</span>
        </div>
      </div>
      <div className="pgroups">
        {deck === "A" ? (
          <>
            {rangeGroup}
            {keyGroup}
          </>
        ) : (
          <>
            {keyGroup}
            {rangeGroup}
          </>
        )}
      </div>
      {extra}
    </div>
  );
}
