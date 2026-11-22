import { useEffect, useRef, useState } from "react";

interface WaveformProps {
  peaks: number[];
  bands: { low: number[]; mid: number[]; high: number[] } | null;
  position: number;
  duration: number;
  color: string;
  cues?: (number | null)[];
  cuePoint?: number;
  loop?: { start: number; end: number } | null;
  onSeek?: (seconds: number) => void;
  compact?: boolean;
  label?: string;
  /** alto en px (62 por defecto) */
  height?: number;
  /** mostrar los tiempos transcurrido/restante */
  showTimes?: boolean;
}

const HOT_COLORS = ["#ff4d6d", "#ff7a45", "#ffb020", "#ffe14d", "#5fd35a", "#2ee6a8", "#2ec5e6", "#3d7bff", "#8b5cf6", "#d24bff", "#ff4fd8", "#ff6f9c"];

/** #rrggbb → [r,g,b]; tolera #rgb. */
function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  const full = v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Aclara (k>0) u oscurece (k<0) un color, como las tres bandas de la plantilla. */
function shade(rgb: [number, number, number], k: number) {
  const m = rgb.map((c) => Math.round(Math.max(0, Math.min(255, k > 0 ? c + (255 - c) * k : c * (1 + k)))));
  return `rgb(${m[0]},${m[1]},${m[2]})`;
}

/** Aplica alfa a un color `rgb(...)`, `#rrggbb` o `#rgb`. */
function withAlpha(col: string, a: number): string {
  if (col.startsWith("rgb(")) return col.replace("rgb(", "rgba(").replace(")", `,${a})`);
  if (col.startsWith("#")) {
    const v = col.slice(1);
    const hex = v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
    return `#${hex}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0")}`;
  }
  return col;
}

/** Onda del deck. Sin pista cargada queda vacía: no se inventa audio. */
export function Waveform({
  peaks,
  bands,
  position,
  duration,
  color,
  cues,
  cuePoint,
  loop,
  onSeek,
  compact,
  label,
  height,
  showTimes = true,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setWidth(Math.round(entries[0].contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const h = compact ? 20 : (height ?? 62);
    canvas.width = width * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, h);

    const hasTrack = peaks.length > 0 && duration > 0;
    // deck vacío: panel limpio, sin onda ni rejilla
    if (!hasTrack) return;

    // rejilla
    ctx.fillStyle = "rgba(255,255,255,.045)";
    const step = compact ? 0 : Math.max(24, width / 12);
    if (!compact && h > 30) {
      for (let x = step; x < width; x += step) ctx.fillRect(Math.round(x), 0, 1, h);
    }

    const mid = h / 2;
    const progress = duration > 0 ? Math.min(1, position / duration) : 0;
    const playedX = progress * width;
    const data = peaks;

    // Color por banda derivado del color del deck: el cuerpo de la onda queda
    // en el color base y las bandas solo matizan los bordes (grave más oscuro,
    // agudo más claro).
    const base = hexToRgb(color);
    const BAND_COLORS = { low: shade(base, -0.42), mid: shade(base, 0.04), high: shade(base, 0.45) };
    const buckets = Math.min(data.length, Math.max(1, Math.floor(width)));
    const ampScale = mid - (compact ? 2 : 2);
    const drawBand = (arr: number[], col: string, played: boolean) => {
      ctx.fillStyle = played ? col : withAlpha(col, 0.82);
      for (let x = 0; x < buckets; x++) {
        const p = arr[Math.floor((x / buckets) * arr.length)] ?? 0;
        const amp = Math.max(0.6, p * ampScale);
        ctx.fillRect(x, mid - amp, 1, amp * 2);
      }
    };
    if (bands) {
      const drawBands = (played: boolean) => {
        drawBand(bands.high, BAND_COLORS.high, played);
        drawBand(bands.low, BAND_COLORS.low, played);
        drawBand(bands.mid, BAND_COLORS.mid, played);
      };
      drawBands(false);
      if (playedX > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, playedX, h);
        ctx.clip();
        drawBands(true);
        ctx.restore();
      }
    } else {
      drawBand(data, color, false);
      if (playedX > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, playedX, h);
        ctx.clip();
        drawBand(data, color, true);
        ctx.restore();
      }
    }

    // marcadores de hot cue
    if (cues && hasTrack && !compact) {
      cues.forEach((c, i) => {
        if (c == null) return;
        const x = Math.round((c / duration) * width);
        ctx.fillStyle = HOT_COLORS[i];
        ctx.fillRect(x, 0, 2, h);
      });
    }
    if (cuePoint != null && hasTrack && !compact) {
      const x = Math.round((cuePoint / duration) * width);
      ctx.fillStyle = "#b6d6f1";
      ctx.fillRect(x, 0, 2, h);
    }

    // región del loop activo
    if (loop && hasTrack && !compact) {
      const x1 = (loop.start / duration) * width;
      const x2 = (loop.end / duration) * width;
      ctx.fillStyle = "rgba(182,214,241,.10)";
      ctx.fillRect(x1, 0, Math.max(1, x2 - x1), h);
      ctx.fillStyle = "rgba(182,214,241,.8)";
      ctx.fillRect(Math.round(x1), 0, 1, h);
      ctx.fillRect(Math.round(x2) - 1, 0, 1, h);
    }

    // playhead (solo con pista cargada)
    if (hasTrack) {
      const px = Math.round(progress * width);
      ctx.fillStyle = "rgba(255,255,255,.92)";
      ctx.fillRect(Math.max(0, Math.min(width - 2, px - 1)), 0, 2, h);
    }
  }, [peaks, bands, position, duration, color, cues, cuePoint, loop, width, compact, height]);

  return (
    <div
      ref={wrapRef}
      className={`wv${compact ? " wv-compact" : ""}`}
      onPointerDown={(e) => {
        if (compact || !onSeek || !duration) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        onSeek(((e.clientX - rect.left) / rect.width) * duration);
      }}
      role={compact ? undefined : "slider"}
      aria-label={compact ? undefined : "Waveform"}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(position)}
    >
      <canvas ref={canvasRef} />
      {label ? <div className="tag">{label}</div> : null}
      {!compact && showTimes && duration > 0 ? (
        <>
          <div className="time left">{formatRuler(position)}</div>
          <div className="time right">{`-${formatRuler(Math.max(0, duration - position))}`}</div>
        </>
      ) : null}
    </div>
  );
}

function formatRuler(s: number): string {
  const total = Math.max(0, Math.floor(s));
  const m = Math.floor(total / 60);
  const r = total % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}
