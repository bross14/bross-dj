import { useEffect, useRef, useState } from "react";
import type { SampleSlot } from "../engine/audio";

interface SamplerEditorProps {
  slot: number;
  info: SampleSlot;
  wave: { duration: number; peaks: number[] };
  onChange: (patch: Partial<Pick<SampleSlot, "name" | "start" | "end" | "gain" | "loop">>) => void;
  onPreview: () => void;
  onClose: () => void;
}

/** Editor de una ranura del sampler: nombre, recorte, volumen y loop. */
export function SamplerEditor({ slot, info, wave, onChange, onPreview, onClose }: SamplerEditorProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const dur = wave.duration;
  const start = Math.max(0, Math.min(dur, info.start ?? 0));
  const end = Math.max(start, Math.min(dur, info.end ?? dur));
  const [drag, setDrag] = useState<"start" | "end" | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === " ") {
        e.preventDefault();
        onPreview();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPreview]);

  // forma de onda con la zona recortada atenuada
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(c);
    const on = css.getPropertyValue("--accent").trim() || "#2f8fe8";
    const off = css.getPropertyValue("--text-muted").trim() || "#777";
    const n = wave.peaks.length;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * dur;
      const ph = Math.max(1, wave.peaks[i] * (h - 4));
      ctx.fillStyle = t >= start && t <= end ? on : off;
      ctx.globalAlpha = t >= start && t <= end ? 1 : 0.35;
      ctx.fillRect((i / n) * w, (h - ph) / 2, Math.max(1, w / n - 0.5), ph);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect((start / dur) * w - 1, 0, 2, h);
    ctx.fillRect((end / dur) * w - 1, 0, 2, h);
  }, [wave, dur, start, end]);

  const timeAt = (clientX: number) => {
    const r = canvas.current!.getBoundingClientRect();
    return Math.max(0, Math.min(dur, ((clientX - r.left) / r.width) * dur));
  };

  const setPoint = (which: "start" | "end", t: number) => {
    if (which === "start") onChange({ start: Math.min(t, end - 0.01) });
    else onChange({ end: Math.max(t, start + 0.01) });
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-card sampler-editor" role="dialog" aria-modal="true" aria-label="Editor del sampler" onClick={(e) => e.stopPropagation()}>
        <header className="settings-head">
          <div>
            <h2>Sampler · ranura {slot + 1}</h2>
            <p>Arrastrá los bordes sobre la onda para recortar. Espacio: escuchar.</p>
          </div>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Cerrar editor">
            ✕
          </button>
        </header>
        <div className="settings-body">
          <section className="settings-section">
            <label className="te-field">
              <span>Nombre</span>
              <input value={info.name} onChange={(e) => onChange({ name: e.target.value })} />
            </label>
            <canvas
              ref={canvas}
              className="se-wave"
              width={560}
              height={90}
              onPointerDown={(e) => {
                const t = timeAt(e.clientX);
                const which = Math.abs(t - start) <= Math.abs(t - end) ? "start" : "end";
                setDrag(which);
                setPoint(which, t);
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => drag && setPoint(drag, timeAt(e.clientX))}
              onPointerUp={() => setDrag(null)}
              onPointerCancel={() => setDrag(null)}
            />
            <div className="te-grid">
              <label className="te-field">
                <span>Inicio (s)</span>
                <input
                  className="mono"
                  type="number"
                  step={0.01}
                  min={0}
                  max={dur}
                  value={start.toFixed(3)}
                  onChange={(e) => setPoint("start", Number(e.target.value) || 0)}
                />
              </label>
              <label className="te-field">
                <span>Fin (s)</span>
                <input
                  className="mono"
                  type="number"
                  step={0.01}
                  min={0}
                  max={dur}
                  value={end.toFixed(3)}
                  onChange={(e) => setPoint("end", Number(e.target.value) || dur)}
                />
              </label>
            </div>
            <div className="settings-row">
              <div className="settings-label">
                <b>Volumen de la ranura</b>
                <span>Se suma al volumen general del sampler.</span>
              </div>
              <div className="settings-range">
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={info.gain ?? 1}
                  onChange={(e) => onChange({ gain: Number(e.target.value) })}
                  aria-label="Volumen de la ranura"
                />
                <b>{Math.round((info.gain ?? 1) * 100)}%</b>
              </div>
            </div>
            <label className="te-check">
              <input type="checkbox" checked={!!info.loop} onChange={(e) => onChange({ loop: e.target.checked })} />
              En loop (el pad prende y apaga)
            </label>
            <div className="settings-inline te-actions">
              <button type="button" className="settings-btn" onClick={() => onChange({ start: 0, end: dur, gain: 1, loop: false })}>
                Restablecer
              </button>
              <button type="button" className="settings-btn" onClick={onPreview}>
                ▶ Escuchar
              </button>
              <button type="button" className="settings-btn primary" onClick={onClose}>
                Listo
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
