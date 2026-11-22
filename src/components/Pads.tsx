import React, { useState } from "react";
import { useWheelStep } from "../hooks/useWheelStep";
import { press } from "./controls";
import { fmtTime, type DeckRuntime, type SampleSlot } from "../engine/audio";
import type { UserPad } from "../userActions";
import { STEM_PRESETS, type StemGains } from "../engine/stems";

interface PadsProps {
  runtime: DeckRuntime;
  onHotCue: (slot: number) => void;
  onHotCueClear: (slot: number) => void;
  onLoop: (beats: number) => void;
  onLoopPad: (beats: number) => void;
  onRollStart: (beats: number) => void;
  onRollEnd: () => void;
  onSlice?: (slot: number) => void;
  samples: (SampleSlot | null)[];
  onSamplePlay: (slot: number) => void;
  onSampleClear: (slot: number) => void;
  /** abre el editor de la ranura (recorte, volumen, loop) */
  onSampleEdit?: (slot: number) => void;
  /** página USER: pads con script */
  userPads?: UserPad[];
  onUserPad?: (slot: number) => void;
  onUserPadEdit?: (slot: number) => void;
  /** stems por filtros del deck */
  stems?: StemGains;
  onStems?: (g: StemGains) => void;
  /** pista arrastrada desde el navegador a una ranura del sampler */
  onSampleDrop: (slot: number, trackId: string) => void;
}

/** Paleta de la plantilla: fila cálida arriba, verde/cian/fría abajo. */
const PAD_COLORS = [
  "#ef4b4b", "#f08a3c", "#2f8fe8", "#f5c542",
  "#27c45f", "#e05fe0", "#22cfd6", "#a78bfa",
];

const ROLL_BEATS = [0.25, 0.5, 0.75, 1, 2, 4, 8, 16];
/** largo de cada pad de la página LOOPS */
const LOOP_BEATS = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
const beatLabel = (b: number) => (b === 0.25 ? "1/4" : b === 0.5 ? "1/2" : b === 0.75 ? "3/4" : String(b));
const ROLL_LABELS = ["1/4", "1/2", "3/4", "1", "2", "4", "8", "16"];

type PadPage = "cue" | "loop" | "roll" | "slicer" | "sampler" | "stems" | "user";

const STEM_KEYS: { key: keyof StemGains; label: string; color: string }[] = [
  { key: "vocal", label: "VOZ", color: "#f5c542" },
  { key: "bass", label: "BAJO", color: "#ef4b4b" },
  { key: "perc", label: "PERC", color: "#22cfd6" },
  { key: "instr", label: "INSTR", color: "#27c45f" },
];

const DUAL_KEY = "bross.pads16.v1";

function loadDual(): boolean {
  try {
    return localStorage.getItem(DUAL_KEY) === "1";
  } catch {
    return false;
  }
}

const PAGES: { id: PadPage; label: string; sub: string; color: string }[] = [
  { id: "cue", label: "HOT CUE", sub: "8 puntos de cue", color: "#d9a92f" },
  { id: "roll", label: "ROLL", sub: "repetir mientras se aprieta", color: "#2fa851" },
  { id: "loop", label: "LOOPS", sub: "de 1/4 a 32 beats", color: "#2d7fd6" },
  { id: "slicer", label: "SLICER", sub: "saltar a un beat de la frase", color: "#8b5cf6" },
  { id: "sampler", label: "SAMPLER", sub: "8 sonidos", color: "#c2473c" },
  { id: "stems", label: "STEMS", sub: "voz, bajo, percusión, instr.", color: "#d9a92f" },
  { id: "user", label: "USER", sub: "tus scripts", color: "#6b7280" },
];

/** Selector de página: flechas, rueda del mouse o clic para ver la lista. */
function PageSelector({
  page,
  onPage,
  hint,
  compact,
}: {
  page: PadPage;
  onPage: (p: PadPage) => void;
  hint?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const i = Math.max(0, PAGES.findIndex((p) => p.id === page));
  const cur = PAGES[i];
  const step = (dir: 1 | -1) => onPage(PAGES[(i + dir + PAGES.length) % PAGES.length].id);
  const wheelRef = useWheelStep<HTMLDivElement>(step);
  return (
    <div
      className={`padsel${compact ? " compact" : ""}`}
      style={{ "--tc": cur.color } as React.CSSProperties}
      ref={wheelRef}
      onMouseLeave={() => setOpen(false)}
    >
      <button type="button" className="psarrow" onClick={() => step(-1)} aria-label="Página anterior" title="Página anterior">
        ◀
      </button>
      <button
        type="button"
        className="psname"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${hint ? `${hint}: ` : ""}${cur.label} · rueda o flechas para cambiar, clic para la lista`}
      >
        <b>{cur.label}</b>
        {!compact ? <small>{cur.sub}</small> : null}
      </button>
      <button type="button" className="psarrow" onClick={() => step(1)} aria-label="Página siguiente" title="Página siguiente">
        ▶
      </button>
      {open ? (
        <div className="pslist" role="listbox">
          {PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={p.id === page}
              className={`psopt${p.id === page ? " on" : ""}`}
              style={{ "--tc": p.color } as React.CSSProperties}
              onClick={() => {
                onPage(p.id);
                setOpen(false);
              }}
            >
              <b>{p.label}</b>
              <small>{p.sub}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Pads({
  runtime,
  onHotCue,
  onHotCueClear,
  onLoopPad,
  onRollStart,
  onRollEnd,
  onSlice,
  samples,
  onSamplePlay,
  onSampleClear,
  onSampleDrop,
  onSampleEdit,
  userPads,
  onUserPad,
  onUserPadEdit,
  stems,
  onStems,
}: PadsProps) {
  const [page, setPage] = useState<PadPage>("cue");
  /** modo 16 pads: dos páginas a la vez (arriba y abajo) */
  const [dual, setDual] = useState(() => loadDual());
  const [page2, setPage2] = useState<PadPage>("roll");

  const padStyle = (i: number) => ({ "--pc": PAD_COLORS[i] } as React.CSSProperties);

  const toggleDual = () => {
    setDual((v) => {
      try {
        localStorage.setItem(DUAL_KEY, v ? "0" : "1");
      } catch {
        /* sin almacenamiento */
      }
      return !v;
    });
  };

  const grid = (pg: PadPage) => (
pg === "cue" ? (
        <div className="padgrid">
          {Array.from({ length: 8 }, (_, i) => {
            const c = runtime.cues[i] ?? null;
            return (
              <button
                key={i}
                type="button"
                className={`pad${c != null ? " set" : ""}`}
                style={padStyle(i)}
                title={
                  c == null
                    ? `Hot cue ${i + 1}`
                    : `Hot cue ${i + 1} · ${fmtTime(c)} · Mayús+clic borrar`
                }
                {...press((e) => (e.shiftKey ? onHotCueClear(i) : onHotCue(i)))}
              >
                {i + 1}
                {c != null ? <small>{fmtTime(c)}</small> : null}
              </button>
            );
          })}
        </div>
      ) : pg === "loop" ? (
        <div className="padgrid">
          {LOOP_BEATS.map((beats, i) => {
            const on =
              runtime.loopStart != null && runtime.loopBeats != null && Math.abs(runtime.loopBeats - beats) < 1e-3;
            return (
              <button
                key={beats}
                type="button"
                className={`pad looppad${on ? " on" : ""}`}
                style={padStyle(i)}
                disabled={!runtime.bpm}
                {...press(() => onLoopPad(beats))}
                title={
                  !runtime.bpm
                    ? "Loop: falta el BPM"
                    : on
                      ? `Loop de ${beatLabel(beats)} ${beats > 1 ? "beats" : "beat"} sonando · tocá de nuevo para salir`
                      : `Loop de ${beatLabel(beats)} ${beats > 1 ? "beats" : "beat"} desde acá hacia adelante`
                }
              >
                {beatLabel(beats)}
                <small>{beats > 1 ? "BEATS" : "BEAT"}</small>
              </button>
            );
          })}
        </div>
      ) : pg === "roll" ? (
        <div className="padgrid">
          {ROLL_BEATS.map((beats, i) => (
            <button
              key={beats}
              type="button"
              className={`pad${runtime.rolling && runtime.rollBeats === beats ? " on" : ""}`}
              style={padStyle(i)}
              disabled={!runtime.bpm || !runtime.playing}
              onContextMenu={(e) => e.preventDefault()}
              onPointerDown={(e) => {
                if (!runtime.bpm || !runtime.playing) return;
                e.preventDefault();
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  /* el puntero ya no está activo: el listener global cierra el roll */
                }
                onRollStart(beats);
              }}
              onPointerUp={(e) => {
                try {
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  }
                } catch {
                  /* captura ya liberada */
                }
                onRollEnd();
              }}
              onPointerCancel={onRollEnd}
              onLostPointerCapture={onRollEnd}
              title={
                runtime.bpm && runtime.playing
                  ? `Roll de ${ROLL_LABELS[i]} beat${ROLL_LABELS[i] === "1" ? "" : "s"} · mantené apretado`
                  : "Roll — cargá y reproducí una pista analizada"
              }
            >
              {ROLL_LABELS[i]}
              <small>ROLL</small>
            </button>
          ))}
        </div>
      ) : pg === "stems" ? (
        <div className="padgrid stemgrid">
          {STEM_KEYS.map((s) => {
            const v = stems?.[s.key] ?? 1;
            return (
              <button
                key={s.key}
                type="button"
                className={`pad stempad${v > 0.01 ? " on" : ""}`}
                style={{ "--pc": s.color } as React.CSSProperties}
                onClick={() => stems && onStems?.({ ...stems, [s.key]: v > 0.01 ? 0 : 1 })}
                title={`${s.label}: clic = sacar / poner · el control de abajo ajusta cuánto`}
              >
                {s.label}
                <small>{Math.round(v * 100)}%</small>
              </button>
            );
          })}
          {STEM_KEYS.map((s) => (
            <div key={`${s.key}-k`} className="stemknob" title={`Cuánto ${s.label}`}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={stems?.[s.key] ?? 1}
                onChange={(e) => stems && onStems?.({ ...stems, [s.key]: Number(e.target.value) })}
                aria-label={`Nivel de ${s.label}`}
              />
              <div className="stempresets">
                {STEM_PRESETS.filter((_, i) => i === STEM_KEYS.indexOf(s)).map((pr) => (
                  <button key={pr.id} type="button" onClick={() => onStems?.({ ...pr.gains })} title={`Preset ${pr.label}`}>
                    {pr.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : pg === "user" ? (
        <div className="padgrid">
          {(userPads ?? []).map((p, i) => (
            <button
              key={i}
              type="button"
              className="pad set userpad"
              style={{ "--pc": p.color } as React.CSSProperties}
              onClick={() => onUserPad?.(i)}
              onContextMenu={(e) => {
                e.preventDefault();
                onUserPadEdit?.(i);
              }}
              title={`${p.label} · ${p.script} · clic derecho: editar`}
            >
              {i + 1}
              <small>{p.label.slice(0, 10)}</small>
            </button>
          ))}
        </div>
      ) : pg === "slicer" ? (
        <div className="padgrid">
          {Array.from({ length: 8 }, (_, i) => (
            <button
              key={i}
              type="button"
              className="pad"
              style={padStyle(i)}
              disabled={!runtime.bpm}
              onClick={() => onSlice && onSlice(i)}
              title={runtime.bpm ? `Slicer: salta al beat ${i + 1} de la frase de 8 beats que suena` : "Slicer: falta el BPM"}
            >
              {i + 1}
              <small>BEAT</small>
            </button>
          ))}
        </div>
      ) : (
        <div className="padgrid">
          {samples.map((smp, i) => (
            <button
              key={i}
              type="button"
              className={`pad sampad${smp ? " set" : ""}`}
              style={padStyle(i)}
              {...press((e) => (e.shiftKey ? onSampleClear(i) : onSamplePlay(i)))}
              onContextMenu={(e) => {
                if (!smp || !onSampleEdit) return;
                e.preventDefault();
                onSampleEdit(i);
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("text/bross-track")) e.preventDefault();
              }}
              onDrop={(e) => {
                const id = e.dataTransfer.getData("text/bross-track");
                if (id) {
                  e.preventDefault();
                  e.stopPropagation();
                  onSampleDrop(i, id);
                }
              }}
              title={
                smp
                  ? `${smp.name} · clic: disparar · clic derecho: editar · Mayús+clic: vaciar · arrastrá una pista para reemplazar`
                  : "Ranura vacía: arrastrá una pista del navegador hasta acá"
              }
            >
              {i + 1}
              <small>{smp ? smp.name.slice(0, 10) : "VACÍO"}</small>
            </button>
          ))}
        </div>
      )
  );

  return (
    <div className={`pads${dual ? " dual" : ""}`}>
      <div className={`padsel-row${dual ? " dual" : ""}`}>
        <PageSelector page={page} onPage={setPage} hint={dual ? "Fila de arriba" : undefined} />
        {dual ? <PageSelector page={page2} onPage={setPage2} hint="Fila de abajo" compact /> : null}
        <button
          type="button"
          className={`p16btn${dual ? " on" : ""}`}
          aria-pressed={dual}
          onClick={toggleDual}
          title={dual ? "Volver a 8 pads" : "16 pads: dos páginas a la vez"}
        >
          16
        </button>
      </div>

      {dual ? (
        <div className="padgrid16">
          {grid(page)}
          {grid(page2)}
        </div>
      ) : (
        grid(page)
      )}
    </div>
  );
}
