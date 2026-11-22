import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioEngine } from "../engine/audio";
import LineInWorker from "../engine/linein.worker?worker&inline";

interface Args {
  engine: AudioEngine;
  notify: (msg: string) => void;
  inputId: string;
  /** escuchar la entrada por el master */
  monitor: boolean;
}

const WINDOW_S = 12;
const EVERY_MS = 2500;

/**
 * Entrada de línea (bandejas, otra consola, micrófono) con lectura de BPM en
 * vivo: ventana de 12 s analizada cada 2,5 s, con suavizado para que el
 * número no salte.
 */
export function useLineIn({ engine, notify, inputId, monitor }: Args) {
  const [on, setOn] = useState(false);
  const [bpm, setBpm] = useState<number | null>(null);
  const [level, setLevel] = useState(0);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => engine.setLineInMonitor(monitor), [engine, monitor]);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setOn(false);
    setBpm(null);
    setLevel(0);
  }, []);

  useEffect(() => stop, [stop]);

  const toggle = useCallback(async () => {
    if (on) return stop();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: inputId ? { exact: inputId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      notify(`No se pudo abrir la entrada: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const sr = engine.sampleRate;
    const ring = new Float32Array(Math.round(sr * WINDOW_S));
    let w = 0;
    let filled = 0;
    const worker = new LineInWorker();
    let history: number[] = [];
    worker.onmessage = (e: MessageEvent<{ bpm: number; confidence: number; level: number }>) => {
      setLevel(e.data.level);
      if (!e.data.bpm || e.data.confidence < 0.15) {
        if (e.data.level < 0.005) setBpm(null);
        return;
      }
      // mediana de las últimas lecturas: estable y rápida de corregir
      history = [...history.slice(-4), e.data.bpm];
      const sorted = [...history].sort((a, b) => a - b);
      setBpm(Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10);
    };
    const tap = await engine.startLineIn(stream, (pcm) => {
      for (let i = 0; i < pcm.length; i += 2) {
        ring[w] = (pcm[i] + pcm[i + 1]) / 65536;
        w = (w + 1) % ring.length;
      }
      filled = Math.min(ring.length, filled + pcm.length / 2);
    });
    if (!tap) {
      stream.getTracks().forEach((t) => t.stop());
      worker.terminate();
      notify("No se pudo abrir la entrada");
      return;
    }
    const timer = window.setInterval(() => {
      if (filled < sr * 4) return;
      // ventana en orden cronológico
      const n = filled;
      const out = new Float32Array(n);
      const start = (w - n + ring.length) % ring.length;
      for (let i = 0; i < n; i++) out[i] = ring[(start + i) % ring.length];
      worker.postMessage({ samples: out, sampleRate: sr }, [out.buffer]);
    }, EVERY_MS);
    stopRef.current = () => {
      window.clearInterval(timer);
      worker.terminate();
      tap();
    };
    setOn(true);
  }, [engine, inputId, notify, on, stop]);

  return { lineIn: on, lineInBpm: bpm, lineInLevel: level, toggleLineIn: toggle };
}
