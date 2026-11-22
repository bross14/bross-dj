import { useCallback, useEffect, useState } from "react";
import type { AudioEngine, LibraryTrack, SampleSlot } from "../engine/audio";

interface Args {
  engine: AudioEngine;
  tracksRef: { current: LibraryTrack[] };
  notify: (msg: string) => void;
  samplerVol: number;
}

/** Ranuras del sampler: estado, guardado entre sesiones y carga desde la biblioteca. */
export function useSampler({ engine, tracksRef, notify, samplerVol }: Args) {
  // ── SAMPLER ─────────────────────────────────────────────────────────
  const [samples, setSamples] = useState<(SampleSlot | null)[]>(() => engine.sampleSlots());
  useEffect(() => {
    engine.onSamplesChange = () => setSamples(engine.sampleSlots());
    setSamples(engine.sampleSlots());
    // ranuras con archivos de la biblioteca guardadas de la sesión anterior
    const bridge = window.bross;
    let saved: (SampleSlot | null)[] = [];
    try {
      saved = JSON.parse(localStorage.getItem("bross.sampler.v1") ?? "[]") as (SampleSlot | null)[];
    } catch {
      saved = [];
    }
    saved.forEach((slot, i) => {
      if (slot?.kind === "builtin") {
        const { name, start, end, gain, loop } = slot;
        engine.updateSampleSlot(i, { name, start, end, gain, loop });
        return;
      }
      if (slot?.kind !== "path" || !slot.path || !bridge) return;
      void bridge.readFile(slot.path).then((data) => {
        if (!data) return;
        const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        void engine.loadSample(i, buf, slot);
      });
    });
    return () => {
      engine.onSamplesChange = null;
    };
  }, [engine]);

  useEffect(() => {
    try {
      // las ranuras de archivo se guardan enteras; las de fábrica, solo sus ajustes
      localStorage.setItem("bross.sampler.v1", JSON.stringify(samples.map((s) => (s?.kind === "path" || s?.kind === "builtin" ? s : null))));
    } catch {
      /* sin almacenamiento */
    }
  }, [samples]);

  useEffect(() => {
    engine.setSamplerVolume(samplerVol);
  }, [engine, samplerVol]);

  const handleSampleDrop = useCallback(
    async (slot: number, trackId: string) => {
      const t = tracksRef.current.find((x) => x.id === trackId);
      if (!t) return;
      const info: SampleSlot = {
        name: t.title || t.fileName,
        kind: t.sourcePath ? "path" : "file",
        path: t.sourcePath,
      };
      if (engine.sampleFromTrack(slot, t.id, info)) return;
      const bridge = window.bross;
      if (!bridge || !t.sourcePath) {
        notify("Esa pista no se puede usar como sample");
        return;
      }
      const data = await bridge.readFile(t.sourcePath);
      if (!data) return;
      const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      if (!(await engine.loadSample(slot, buf, info))) notify("No se pudo cargar el sample");
    },
    [engine, notify],
  );

  return { samples, handleSampleDrop };
}
