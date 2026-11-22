import { useEffect, useRef, useState } from "react";
import type { AudioEngine } from "../engine/audio";

type DeckId = "A" | "B";

interface StackedWavesProps {
  engine: AudioEngine;
  colors: { A: string; B: string };
  bpm: { A: number | null; B: number | null };
}

const MIN_SPAN = 2;
const MAX_SPAN = 16;

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade([r, g, b]: [number, number, number], k: number): string {
  const f = (c: number) => Math.round(Math.max(0, Math.min(255, k > 0 ? c + (255 - c) * k : c * (1 + k))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/**
 * Las dos ondas apiladas (A arriba, B abajo) con la misma escala de tiempo y
 * el cabezal alineado al centro: se ve de un vistazo si los beats de los dos
 * temas caen juntos. Se dibuja con requestAnimationFrame leyendo el motor.
 * Rueda del mouse: acercar / alejar.
 */
export function StackedWaves({ engine, colors, bpm }: StackedWavesProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  /** segundos visibles a lo ancho */
  const [span, setSpan] = useState(4);
  const spanRef = useRef(span);
  spanRef.current = span;

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
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const palette = (["A", "B"] as DeckId[]).map((d) => {
      const base = rgb(colors[d]);
      return [shade(base, -0.45), shade(base, 0.05), shade(base, 0.55)];
    });
    const GAP = 3;
    const laneH = (h - GAP) / 2;
    let raf = 0;

    const drawLane = (deck: DeckId, top: number, cols: string[]) => {
      ctx.fillStyle = "#0b0b0b";
      ctx.fillRect(0, top, w, laneH);
      const dur = engine.deckDuration(deck);
      if (dur <= 0) return;
      const pos = engine.deckPosition(deck);
      const detail = engine.deckDetail(deck);
      const grid = engine.deckGrid(deck);
      const spp = spanRef.current / w;
      const cx = Math.round(w / 2);
      const mid = top + laneH / 2;
      const amp = laneH / 2 - 1;
      const tAt = (x: number) => pos + (x - cx) * spp;
      const xAt = (t: number) => cx + (t - pos) / spp;
      if (detail) {
        const r = detail.rate;
        const n = detail.low.length;
        const layers: [Float32Array, string, number][] = [
          [detail.low, cols[0], 1],
          [detail.mid, cols[1], 0.85],
          [detail.high, cols[2], 0.6],
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
      }
      // rejilla: el primer beat de cada compás más marcado
      if (grid) {
        const beat = 60 / grid.bpm;
        const tStart = Math.max(0, tAt(0));
        const tEnd = Math.min(dur, tAt(w));
        let k = Math.ceil((tStart - grid.firstBeat) / beat);
        for (let t = grid.firstBeat + k * beat; t <= tEnd; t += beat, k++) {
          const bar = ((k % 4) + 4) % 4 === 0;
          ctx.fillStyle = bar ? "rgba(255,255,255,.6)" : "rgba(255,255,255,.18)";
          ctx.fillRect(Math.round(xAt(t)), top, bar ? 2 : 1, laneH);
        }
      }
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawLane("A", 0, palette[0]);
      drawLane("B", laneH + GAP, palette[1]);
      // cabezal común, atravesando los dos carriles
      const cx = Math.round(w / 2);
      ctx.fillStyle = "rgba(255,255,255,.25)";
      ctx.fillRect(cx - 3, 0, 7, h);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(cx - 1, 0, 2, h);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [size, colors, engine]);

  return (
    <div
      ref={wrapRef}
      className="stackwave"
      onWheel={(e) => {
        e.preventDefault();
        setSpan((s) => Math.max(MIN_SPAN, Math.min(MAX_SPAN, s * (e.deltaY > 0 ? 1.18 : 1 / 1.18))));
      }}
      title="Deck A arriba, Deck B abajo · rueda: acercar / alejar"
    >
      <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} />
      <span className="swlab a">A</span>
      <span className="swlab b">B</span>
      {bpm.A ? <span className="swbpm a">{bpm.A.toFixed(1)}</span> : null}
      {bpm.B ? <span className="swbpm b">{bpm.B.toFixed(1)}</span> : null}
    </div>
  );
}
