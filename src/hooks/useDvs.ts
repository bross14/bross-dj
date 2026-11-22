import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioEngine, DeckId, DeckRuntime } from "../engine/audio";

export type DvsMode = "absolute" | "relative" | "smart";

export interface DvsDeckPrefs {
  inputId: string;
  mode: DvsMode;
  gain: number;
  swap: boolean;
}

export interface DvsReading {
  speed: number;
  position: number | null;
  quality: number;
  level: number;
}

const KEY = "bross.dvs.v1";
const DEFAULT: DvsDeckPrefs = { inputId: "", mode: "smart", gain: 1, swap: false };

function load(): Record<DeckId, DvsDeckPrefs> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Record<DeckId, DvsDeckPrefs>>;
    return { A: { ...DEFAULT, ...(v.A ?? {}) }, B: { ...DEFAULT, ...(v.B ?? {}) } };
  } catch {
    return { A: { ...DEFAULT }, B: { ...DEFAULT } };
  }
}

/** salto de púa: diferencia que se considera "la pusieron en otro lado" */
const NEEDLE_JUMP = 2.5;
/** segundos de cada lectura (2 bloques de 128 muestras) */
const blockSeconds = (sr: number) => 256 / sr;

interface Args {
  engine: AudioEngine;
  notify: (msg: string) => void;
  rt: { A: DeckRuntime; B: DeckRuntime };
}

/**
 * DVS: el plato (vinilo o CDJ con el timecode propio) maneja el deck.
 * - absoluto: la posición de la pista es la de la púa;
 * - relativo: solo cuenta el movimiento (poner la púa en otro lado no salta);
 * - inteligente: relativo, pero si mueven la púa de lugar salta igual.
 */
export function useDvs({ engine, notify, rt }: Args) {
  const [prefs, setPrefs] = useState(load);
  const [on, setOn] = useState<Record<DeckId, boolean>>({ A: false, B: false });
  const [reading, setReading] = useState<Record<DeckId, DvsReading | null>>({ A: null, B: null });
  const live = useRef<Record<DeckId, { stop: () => void; config: (c: { gain?: number; swap?: boolean }) => void } | null>>({ A: null, B: null });
  const state = useRef<Record<DeckId, { acc: number; base: number; lastTc: number | null; trackId: string | null; latest: DvsReading | null }>>({
    A: { acc: 0, base: 0, lastTc: null, trackId: null, latest: null },
    B: { acc: 0, base: 0, lastTc: null, trackId: null, latest: null },
  });
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* sin almacenamiento */
    }
    for (const d of ["A", "B"] as DeckId[]) live.current[d]?.config({ gain: prefs[d].gain, swap: prefs[d].swap });
  }, [prefs]);

  // la UI se refresca a ~10 Hz (el deck se mueve a ~150 Hz)
  useEffect(() => {
    if (!on.A && !on.B) return;
    const id = window.setInterval(() => setReading({ A: state.current.A.latest, B: state.current.B.latest }), 100);
    return () => window.clearInterval(id);
  }, [on]);

  // pista nueva en un deck con DVS: se vuelve a "apoyar la mano" ahí
  useEffect(() => {
    for (const d of ["A", "B"] as DeckId[]) {
      const s = state.current[d];
      if (!on[d] || rt[d].trackId === s.trackId) continue;
      s.trackId = rt[d].trackId;
      if (rt[d].loaded && engine.scratchStart(d)) {
        s.base = engine.deckPosition(d);
        s.acc = 0;
        s.lastTc = null;
      }
    }
  }, [rt, on, engine]);

  const stop = useCallback(
    (d: DeckId) => {
      live.current[d]?.stop();
      live.current[d] = null;
      engine.scratchEnd(d);
      setOn((p) => ({ ...p, [d]: false }));
    },
    [engine],
  );

  const start = useCallback(
    async (d: DeckId) => {
      const p = prefsRef.current[d];
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: p.inputId ? { exact: p.inputId } : undefined,
            channelCount: 2,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      } catch (e) {
        notify(`DVS ${d}: no se pudo abrir la entrada (${e instanceof Error ? e.message : String(e)})`);
        return;
      }
      const sr = engine.sampleRate;
      const dt = blockSeconds(sr);
      const s = state.current[d];
      s.trackId = rt[d].trackId;
      s.base = engine.deckPosition(d);
      s.acc = 0;
      s.lastTc = null;
      const started = engine.scratchStart(d);
      const h = await engine.startDvs(stream, (r) => {
        s.latest = r;
        const mode = prefsRef.current[d].mode;
        if (mode === "absolute" && r.position != null) {
          s.acc = r.position - s.base;
        } else {
          s.acc += r.speed * dt;
          if (mode === "smart" && r.position != null && s.lastTc != null) {
            const expected = s.lastTc + r.speed * dt;
            if (Math.abs(r.position - expected) > NEEDLE_JUMP) s.acc += r.position - expected;
          }
        }
        if (r.position != null) s.lastTc = r.position;
        engine.scratchMove(d, s.acc);
      });
      if (!h) {
        stream.getTracks().forEach((t) => t.stop());
        if (started) engine.scratchEnd(d);
        notify(`DVS ${d}: no se pudo iniciar`);
        return;
      }
      h.config({ gain: p.gain, swap: p.swap });
      live.current[d] = h;
      setOn((prev) => ({ ...prev, [d]: true }));
      if (!started) notify(`DVS ${d}: cargá una pista para que el plato la mueva`);
    },
    [engine, notify, rt],
  );

  const toggle = useCallback((d: DeckId) => (live.current[d] ? stop(d) : void start(d)), [start, stop]);

  useEffect(
    () => () => {
      for (const d of ["A", "B"] as DeckId[]) live.current[d]?.stop();
    },
    [],
  );

  /**
   * Calibración: 2 s con el plato girando hacia adelante. Ajusta la ganancia
   * para que la señal quede en un nivel cómodo y detecta cables invertidos.
   */
  const calibrate = useCallback(
    async (d: DeckId): Promise<string> => {
      if (!live.current[d]) return "Encendé el DVS de ese deck y hacé girar el plato hacia adelante.";
      const samples: DvsReading[] = [];
      const s = state.current[d];
      await new Promise<void>((resolve) => {
        const id = window.setInterval(() => {
          if (s.latest) samples.push(s.latest);
        }, 50);
        window.setTimeout(() => {
          window.clearInterval(id);
          resolve();
        }, 2000);
      });
      if (!samples.length) return "No llega señal de la entrada.";
      const level = samples.reduce((a, r) => a + r.level, 0) / samples.length;
      const speed = samples.reduce((a, r) => a + r.speed, 0) / samples.length;
      const quality = samples.reduce((a, r) => a + r.quality, 0) / samples.length;
      if (level < 0.005) return "No hay timecode en la entrada: revisá cables, entrada elegida y que el plato gire.";
      const cur = prefsRef.current[d];
      const raw = level / cur.gain;
      const gain = Math.max(0.3, Math.min(10, 0.6 / raw));
      const swap = speed < -0.3 ? !cur.swap : cur.swap;
      setPrefs((p) => ({ ...p, [d]: { ...p[d], gain, swap } }));
      return [
        `Ganancia ${gain.toFixed(2)}×`,
        swap !== cur.swap ? "izquierda/derecha invertidas (corregido)" : null,
        `calidad ${Math.round(quality * 100)} %`,
        Math.abs(speed) < 0.3 ? "el plato parecía quieto: repetí con el plato girando" : null,
      ]
        .filter(Boolean)
        .join(" · ");
    },
    [],
  );

  const patch = useCallback((d: DeckId, p: Partial<DvsDeckPrefs>) => setPrefs((prev) => ({ ...prev, [d]: { ...prev[d], ...p } })), []);

  return { dvsPrefs: prefs, dvsOn: on, dvsReading: reading, toggleDvs: toggle, calibrateDvs: calibrate, patchDvs: patch };
}
