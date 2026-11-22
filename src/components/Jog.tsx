import React, { useRef } from "react";
import { img } from "../assets";
import { SECONDS_PER_TURN } from "../engine/audio";

interface JogProps {
  deck: "A" | "B";
  playing: boolean;
  position: number;
  duration: number;
  bpm?: number | null;
  /** URL de una imagen real del vinilo (src/assets/img/vinyl-a.png, etc.). */
  art?: string;
  /** modo vinilo: la mano sobre el plato mueve el audio como un disco real */
  scratch: boolean;
  onSeek: (seconds: number) => void;
  onToggle: () => void;
  onScratchStart: () => void;
  /** segundos de pista que se movió el plato desde que se apoyó la mano */
  onScratchMove: (deltaSeconds: number) => void;
  onScratchEnd: () => void;
  /** pitch bend (nudge) mientras se gira el plato con el modo vinilo apagado */
  onBend: (bend: number) => void;
}

/** Tiempo restante con décimas, como la etiqueta del vinilo de la plantilla. */
function fmtRemaining(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--.-";
  const total = Math.max(0, seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

/** velocidad angular de un plato a 33⅓ rpm, en rad/s */
const PLATTER_RAD_S = (2 * Math.PI) / SECONDS_PER_TURN;

interface Drag {
  mode: "scratch" | "bend" | "seek";
  cx: number;
  cy: number;
  last: number;
  lastT: number;
  acc: number;
  startPos: number;
  moved: boolean;
  bend: number;
  bendTimer: number;
}

export function Jog({
  deck,
  playing,
  position,
  duration,
  bpm,
  art,
  scratch,
  onSeek,
  onToggle,
  onScratchStart,
  onScratchMove,
  onScratchEnd,
  onBend,
}: JogProps) {
  const drag = useRef<Drag | null>(null);
  const angle = ((position / SECONDS_PER_TURN) * 360) % 360;
  // La luz del aro es una capa aparte: gira ella sola y el disco (con la
  // palabra BROSSDJ) queda fijo. Deck A azul marino, Deck B magenta flúor.
  const lightArt = art ? img(deck === "A" ? "vinyl-light-a" : "vinyl-light-b") : undefined;
  const spinDisc = !lightArt;

  const down = (e: React.PointerEvent) => {
    if (duration <= 0) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const mode = scratch ? "scratch" : playing ? "bend" : "seek";
    drag.current = {
      mode,
      cx,
      cy,
      last: Math.atan2(e.clientY - cy, e.clientX - cx),
      lastT: performance.now(),
      acc: 0,
      startPos: position,
      moved: false,
      bend: 0,
      bendTimer: 0,
    };
    // mano sobre el plato: en modo vinilo el disco se frena bajo la mano
    if (mode === "scratch") onScratchStart();
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const a = Math.atan2(e.clientY - d.cy, e.clientX - d.cx);
    let da = a - d.last;
    // el ángulo salta de π a −π al cruzar el eje: se desenrolla
    if (da > Math.PI) da -= 2 * Math.PI;
    if (da < -Math.PI) da += 2 * Math.PI;
    d.last = a;
    d.acc += da;
    if (Math.abs(d.acc) > 0.04) d.moved = true;
    // sentido horario = hacia adelante, como un plato real
    const delta = (d.acc / (2 * Math.PI)) * SECONDS_PER_TURN;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT) / 1000;
    d.lastT = now;

    if (d.mode === "scratch") {
      onScratchMove(delta);
    } else if (d.mode === "bend") {
      // girar el aro acelera o frena en proporción a la velocidad de la mano
      const raw = Math.max(-0.4, Math.min(0.4, ((da / dt) / PLATTER_RAD_S) * 0.25));
      d.bend = d.bend * 0.6 + raw * 0.4;
      onBend(d.bend);
      window.clearTimeout(d.bendTimer);
      d.bendTimer = window.setTimeout(() => {
        if (drag.current === d) {
          d.bend = 0;
          onBend(0);
        }
      }, 70);
    } else {
      onSeek(Math.max(0, Math.min(duration, d.startPos + delta)));
    }
  };

  const finish = (allowToggle: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    window.clearTimeout(d.bendTimer);
    if (d.mode === "scratch") onScratchEnd();
    if (d.mode === "bend") onBend(0);
    // toque sin mover (fuera del modo vinilo): play / pausa
    if (allowToggle && !d.moved && d.mode !== "scratch") onToggle();
  };

  const shownBpm = bpm && Number.isFinite(bpm) ? bpm.toFixed(1) : null;
  const remaining = duration > 0 ? fmtRemaining(Math.max(0, duration - position)) : null;

  return (
    <div
      className={`jog${playing ? " is-playing" : ""}${art ? " has-art" : ""}${scratch ? " is-vinyl" : ""}`}
      // avance del tema (lo usa el relleno del vinilo en la visual Minimalista)
      style={{ "--prog": `${duration > 0 ? Math.min(100, (position / duration) * 100).toFixed(2) : 0}%` } as React.CSSProperties}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={() => finish(true)}
      onPointerCancel={() => finish(false)}
      onWheel={(e) => {
        e.preventDefault();
        onSeek(Math.max(0, Math.min(duration, position - e.deltaY * 0.05)));
      }}
      title={
        scratch
          ? "Modo vinilo: apoyá y girá el disco para hacer scratch"
          : "Girá el aro para acelerar/frenar (nudge) · en pausa mueve la posición · clic para play/pausa"
      }
      role="slider"
      aria-label="Disco (jog)"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(position)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onToggle();
        }
        if (e.key === "ArrowRight") onSeek(Math.min(duration, position + 1));
        if (e.key === "ArrowLeft") onSeek(Math.max(0, position - 1));
      }}
    >
      <div className="ring" />
      <div className="disc" style={spinDisc ? { transform: `rotate(${angle}deg)` } : undefined}>
        {art ? <img className="art" src={art} alt="" draggable={false} /> : null}
        <div className="mark" style={{ "--rot": "24deg" } as React.CSSProperties} />
        <div className="label" />
      </div>
      {lightArt ? (
        <div
          className="light"
          aria-hidden
          style={{ transform: `rotate(${angle}deg)`, backgroundImage: `url(${lightArt})` }}
        />
      ) : null}
      <div className="gloss" />
      <div className="jog-face" aria-hidden>
        {shownBpm ? <span className="ji-bpm">BPM {shownBpm}</span> : null}
        <span className="ji-title">BROSSDJ</span>
        {remaining ? <span className="ji-time">-{remaining}</span> : null}
      </div>
    </div>
  );
}
