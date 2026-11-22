import { useEffect, useRef, useState } from "react";
import type { AudioEngine, DeckId } from "../engine/audio";

const HOT_COLORS = ["#ff4d6d", "#ff7a45", "#ffb020", "#ffe14d", "#5fd35a", "#2ee6a8", "#2ec5e6", "#3d7bff"];

export interface GridEdit {
  shift?: number;
  setHere?: boolean;
  bpmFactor?: number;
  bpmDelta?: number;
}

interface ScrollWaveProps {
  deck: DeckId;
  engine: AudioEngine;
  color: string;
  /** marcadores (llegan a ~30 fps desde el estado de la app) */
  cues: (number | null)[];
  cuePoint: number;
  loop: { start: number; end: number } | null;
  /** LOOP IN marcado */
  loopIn: number | null;
  position: number;
  duration: number;
  hasGrid: boolean;
  onScratchStart: () => void;
  onScratchMove: (deltaSeconds: number) => void;
  onScratchEnd: () => void;
  onGrid: (edit: GridEdit) => void;
}

const MIN_ZOOM = 2;
const MAX_ZOOM = 32;

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade([r, g, b]: [number, number, number], k: number): string {
  const f = (c: number) => Math.round(Math.max(0, Math.min(255, k > 0 ? c + (255 - c) * k : c * (1 + k))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function fmt(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60).toString().padStart(2, "0")}:${(t % 60).toString().padStart(2, "0")}`;
}

/**
 * Onda grande que avanza bajo un cursor fijo en el centro: zoom con la rueda, rejilla de beats (compás marcado), cues y
 * loop. Se dibuja con requestAnimationFrame leyendo la posición del motor,
 * así el desplazamiento es fluido aunque React refresque a 30 fps.
 */
export function ScrollWave({
  deck,
  engine,
  color,
  cues,
  cuePoint,
  loop,
  loopIn,
  position,
  duration,
  hasGrid,
  onScratchStart,
  onScratchMove,
  onScratchEnd,
  onGrid,
}: ScrollWaveProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(8);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const markers = useRef({ cues, cuePoint, loop, loopIn });
  markers.current = { cues, cuePoint, loop, loopIn };
  const drag = useRef<{ x0: number; spp: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const { w, h } = size;
    if (!canvas || w === 0 || h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const base = rgb(color);
    const cLow = shade(base, -0.45);
    const cMid = shade(base, 0.05);
    const cHigh = shade(base, 0.55);
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const dur = engine.deckDuration(deck);
      if (dur <= 0) return;
      const pos = engine.deckPosition(deck);
      const detail = engine.deckDetail(deck);
      const grid = engine.deckGrid(deck);
      const spp = zoomRef.current / w; // segundos por pixel
      const cx = Math.round(w / 2);
      const mid = h / 2;
      const amp = mid - 1;
      const tAt = (x: number) => pos + (x - cx) * spp;
      const xAt = (t: number) => cx + (t - pos) / spp;
      const { cues: cs, cuePoint: cp, loop: lp, loopIn: li } = markers.current;

      // región del loop
      if (lp) {
        const x1 = xAt(lp.start);
        const x2 = xAt(lp.end);
        ctx.fillStyle = "rgba(182,214,241,.12)";
        ctx.fillRect(x1, 0, x2 - x1, h);
      }

      // onda por bandas: grave oscuro, medio en el color del deck, agudo claro
      if (detail) {
        const r = detail.rate;
        const n = detail.low.length;
        const layers: [Float32Array, string, number][] = [
          [detail.low, cLow, 1],
          [detail.mid, cMid, 0.85],
          [detail.high, cHigh, 0.6],
        ];
        for (const [arr, col, k] of layers) {
          ctx.fillStyle = col;
          for (let x = 0; x < w; x++) {
            const t0 = tAt(x);
            if (t0 < 0 || t0 > dur) continue;
            const i0 = Math.floor(t0 * r);
            const i1 = Math.max(i0 + 1, Math.floor((t0 + spp) * r));
            let v = 0;
            for (let i = i0; i < i1 && i < n; i++) if (arr[i] > v) v = arr[i];
            const a = Math.max(0.5, v * amp * k);
            ctx.fillRect(x, mid - a, 1, a * 2);
          }
        }
      } else {
        ctx.fillStyle = "rgba(255,255,255,.12)";
        ctx.fillRect(Math.max(0, xAt(0)), mid - 0.5, Math.min(w, xAt(dur)) - Math.max(0, xAt(0)), 1);
      }

      // rejilla de beats: el primero de cada compás de 4 más marcado
      if (grid) {
        const beat = 60 / grid.bpm;
        const tStart = Math.max(0, tAt(0));
        const tEnd = Math.min(dur, tAt(w));
        let k = Math.ceil((tStart - grid.firstBeat) / beat);
        for (let t = grid.firstBeat + k * beat; t <= tEnd; t += beat, k++) {
          const x = Math.round(xAt(t));
          const bar = ((k % 4) + 4) % 4 === 0;
          ctx.fillStyle = bar ? "rgba(255,255,255,.62)" : "rgba(255,255,255,.2)";
          ctx.fillRect(x, 0, bar ? 2 : 1, h);
          if (bar) {
            ctx.fillRect(x - 2, 0, 6, 2);
            ctx.fillRect(x - 2, h - 2, 6, 2);
          }
        }
      }

      // cue principal y hot cues: línea + bandera arriba
      const flag = (t: number, col: string) => {
        const x = Math.round(xAt(t));
        if (x < -6 || x > w + 6) return;
        ctx.fillStyle = col;
        ctx.fillRect(x, 0, 2, h);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 7, 0);
        ctx.lineTo(x, 7);
        ctx.closePath();
        ctx.fill();
      };
      flag(cp, "#ff9a1f");
      cs.forEach((c, i) => {
        if (c != null) flag(c, HOT_COLORS[i % HOT_COLORS.length]);
      });
      if (lp) {
        ctx.fillStyle = "rgba(182,214,241,.85)";
        ctx.fillRect(Math.round(xAt(lp.start)), 0, 1, h);
        ctx.fillRect(Math.round(xAt(lp.end)) - 1, 0, 1, h);
      }

      // LOOP IN marcado: línea punteada
      if (li != null) {
        const x = Math.round(xAt(li));
        ctx.fillStyle = "rgba(120,220,255,.9)";
        for (let y = 0; y < h; y += 4) ctx.fillRect(x, y, 2, 2);
      }

      // SLIP: dónde estaría la pista (cursor fantasma)
      const ghost = engine.deckSlipGhost(deck);
      if (ghost != null) {
        const gx = Math.round(xAt(ghost));
        ctx.fillStyle = "rgba(255,210,90,.85)";
        ctx.fillRect(gx - 1, 0, 2, h);
      }

      // cursor fijo en el centro
      ctx.fillStyle = "rgba(255,255,255,.25)";
      ctx.fillRect(cx - 3, 0, 7, h);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(cx - 1, 0, 2, h);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [size, color, deck, engine]);

  const changeZoom = (factor: number) =>
    setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * factor)));

  return (
    <div
      ref={wrapRef}
      className="swave"
      onWheel={(e) => {
        e.preventDefault();
        changeZoom(e.deltaY > 0 ? 1.18 : 1 / 1.18);
      }}
      onPointerDown={(e) => {
        if (duration <= 0 || e.button !== 0) return;
        if ((e.target as HTMLElement).closest(".swtools")) return;
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x0: e.clientX, spp: zoom / Math.max(1, size.w) };
        onScratchStart();
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        // arrastrar la onda a la izquierda la hace avanzar
        onScratchMove(-(e.clientX - d.x0) * d.spp);
      }}
      onPointerUp={() => {
        if (!drag.current) return;
        drag.current = null;
        onScratchEnd();
      }}
      onPointerCancel={() => {
        if (!drag.current) return;
        drag.current = null;
        onScratchEnd();
      }}
      title="Rueda: zoom · arrastrar: mover la pista como un disco"
    >
      <canvas ref={canvasRef} />
      {duration > 0 ? (
        <>
          <div className="time left">{fmt(position)}</div>
          <div className="time right">{`-${fmt(Math.max(0, duration - position))}`}</div>
          <div className="swtools">
            <button type="button" onClick={() => changeZoom(1 / 1.5)} title="Acercar (zoom)">
              +
            </button>
            <button type="button" onClick={() => changeZoom(1.5)} title="Alejar (zoom)">
              −
            </button>
            {hasGrid ? (
              <>
                <span className="swsep" />
                <button type="button" onClick={() => onGrid({ shift: -0.01 })} title="Rejilla 10 ms antes">
                  ◂
                </button>
                <button type="button" onClick={() => onGrid({ shift: 0.01 })} title="Rejilla 10 ms después">
                  ▸
                </button>
                <button type="button" onClick={() => onGrid({ setHere: true })} title="Poner un beat donde está el cursor">
                  ⌖
                </button>
                <button type="button" onClick={() => onGrid({ bpmFactor: 0.5 })} title="BPM a la mitad">
                  ÷2
                </button>
                <button type="button" onClick={() => onGrid({ bpmFactor: 2 })} title="BPM al doble">
                  ×2
                </button>
                <button type="button" onClick={() => onGrid({ bpmDelta: -0.05 })} title="BPM −0.05">
                  B−
                </button>
                <button type="button" onClick={() => onGrid({ bpmDelta: 0.05 })} title="BPM +0.05">
                  B+
                </button>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
