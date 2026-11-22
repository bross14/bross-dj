import { useEffect, useState } from "react";
import type { DvsDeckPrefs, DvsMode, DvsReading } from "../hooks/useDvs";

interface DvsPanelProps {
  prefs: Record<"A" | "B", DvsDeckPrefs>;
  on: Record<"A" | "B", boolean>;
  reading: Record<"A" | "B", DvsReading | null>;
  onToggle: (d: "A" | "B") => void;
  onCalibrate: (d: "A" | "B") => Promise<string>;
  onPatch: (d: "A" | "B", p: Partial<DvsDeckPrefs>) => void;
}

const MODES: [DvsMode, string][] = [
  ["smart", "Inteligente"],
  ["absolute", "Absoluto"],
  ["relative", "Relativo"],
];

/** Pestaña de Ajustes: DVS con el timecode propio de BROSS DJ. */
export function DvsPanel({ prefs, on, reading, onToggle, onCalibrate, onPatch }: DvsPanelProps) {
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [msg, setMsg] = useState<Record<"A" | "B", string>>({ A: "", B: "" });
  const [gen, setGen] = useState<string | null>(null);

  useEffect(() => {
    void navigator.mediaDevices?.enumerateDevices().then((d) => setInputs(d.filter((x) => x.kind === "audioinput")));
  }, []);

  return (
    <>
      <p className="settings-intro">
        Con DVS el plato maneja el deck: grabá el timecode de BROSS DJ en un vinilo o un CD, conectá el tocadiscos o el
        CDJ a una entrada estéreo de la placa de sonido y encendé el DVS del deck. <b>Inteligente</b>: el plato mueve la
        pista y, si ponés la púa en otro lado, salta. <b>Absoluto</b>: la pista está donde está la púa. <b>Relativo</b>:
        solo cuenta el movimiento.
      </p>
      <div className="settings-inline">
        <button
          type="button"
          className="settings-btn"
          onClick={async () => {
            setGen("Generando…");
            const r = await window.bross?.tcGenerate?.(8);
            setGen(r ? `Listo: ${r.path} (${Math.round(r.seconds / 60)} min)` : "Disponible en la app de escritorio");
          }}
        >
          Generar el WAV de timecode
        </button>
        {gen ? <span className="settings-note">{gen}</span> : null}
      </div>
      {(["A", "B"] as const).map((d) => {
        const p = prefs[d];
        const r = reading[d];
        return (
          <div className="shortcut-group dvs-deck" key={d}>
            <h3>Deck {d}</h3>
            <div className="te-grid">
              <label className="te-field">
                <span>Entrada</span>
                <select value={p.inputId} disabled={on[d]} onChange={(e) => onPatch(d, { inputId: e.target.value })}>
                  <option value="">Predeterminada del sistema</option>
                  {inputs.map((x, i) => (
                    <option key={x.deviceId || i} value={x.deviceId}>
                      {x.label || `Entrada ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="te-field">
                <span>Modo</span>
                <select value={p.mode} onChange={(e) => onPatch(d, { mode: e.target.value as DvsMode })}>
                  {MODES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="settings-inline">
              <button type="button" className={`settings-btn${on[d] ? " primary" : ""}`} onClick={() => onToggle(d)}>
                {on[d] ? "Apagar DVS" : "Encender DVS"}
              </button>
              <button
                type="button"
                className="settings-btn"
                disabled={!on[d]}
                onClick={async () => {
                  setMsg((m) => ({ ...m, [d]: "Midiendo 2 s: hacé girar el plato hacia adelante…" }));
                  const t = await onCalibrate(d);
                  setMsg((m) => ({ ...m, [d]: t }));
                }}
              >
                Calibrar
              </button>
              <label className="te-check">
                <input type="checkbox" checked={p.swap} onChange={(e) => onPatch(d, { swap: e.target.checked })} />
                Invertir L/R
              </label>
              <span className="settings-note">Ganancia {p.gain.toFixed(2)}×</span>
            </div>
            {on[d] ? (
              <div className="dvs-meter mono">
                <span>vel {r ? `${(r.speed * 100).toFixed(1)} %` : "—"}</span>
                <span>pos {r?.position != null ? `${r.position.toFixed(2)} s` : "sin leer"}</span>
                <span>calidad {r ? `${Math.round(r.quality * 100)} %` : "—"}</span>
                <span className="dvs-bar">
                  <i style={{ width: `${Math.min(100, (r?.level ?? 0) * 140)}%` }} />
                </span>
              </div>
            ) : null}
            {msg[d] ? <p className="settings-note">{msg[d]}</p> : null}
          </div>
        );
      })}
    </>
  );
}
