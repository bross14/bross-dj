import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioEngine, DeckId } from "../engine/audio";
import type { HistoryEntry } from "../library";
import type { RecFormat, RecSource } from "../settings";

interface Args {
  engine: AudioEngine;
  notify: (msg: string) => void;
  history: HistoryEntry[];
  format: RecFormat;
  split: boolean;
  source: RecSource;
  inputId: string;
  inputGain: number;
}

const MIME: Partial<Record<RecFormat, string>> = {
  ogg: "audio/webm;codecs=opus",
};

const mmss = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

/** Abre la entrada externa o la captura del sonido del sistema. */
async function openSource(source: RecSource, inputId: string): Promise<MediaStream | null> {
  if (source === "master+input") {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: inputId ? { exact: inputId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  }
  if (source === "system") {
    // el proceso principal responde con la pantalla + "loopback" de Windows
    const s = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    s.getVideoTracks().forEach((t) => {
      t.stop();
      s.removeTrack(t);
    });
    if (!s.getAudioTracks().length) throw new Error("La captura del sistema no trajo audio");
    return s;
  }
  return null;
}

/** Grabación del set (WAV, FLAC, MP3 u OGG) con lista de temas, hoja CUE y cortes por tema. */
export function useRecording({ engine, notify, history, format, split, source, inputId, inputGain }: Args) {
  const [rec, setRec] = useState<{ startedAt: number; path: string } | null>(null);
  const recTracks = useRef<{ at: number; title: string; artist: string }[]>([]);

  // lo que va entrando al historial mientras se graba arma la lista de temas
  useEffect(() => {
    if (!rec) return;
    const last = history[history.length - 1];
    if (last && last.at >= rec.startedAt && !recTracks.current.some((t) => t.at === last.at)) {
      recTracks.current.push({ at: last.at, title: last.title, artist: last.artist });
    }
  }, [history, rec]);

  useEffect(() => {
    engine.setRecordInputGain(inputGain);
  }, [engine, inputGain]);

  const toggleRec = useCallback(async () => {
    const bridge = window.bross;
    if (!bridge?.recStart || !bridge.recChunk || !bridge.recStop) {
      notify("La grabación está disponible en la app de escritorio");
      return;
    }
    if (rec) {
      await engine.stopRecording();
      engine.setRecordSource(null);
      const startedAt = rec.startedAt;
      setRec(null);
      notify(format !== "wav" || split ? "Guardando la grabación…" : "Grabación cortada");
      const tracks = recTracks.current.map((t) => ({
        sec: Math.max(0, (t.at - startedAt) / 1000),
        title: t.title,
        artist: t.artist,
      }));
      const res = await bridge.recStop({ tracks }).catch(() => null);
      if (!res) notify("No se pudo guardar la grabación");
      else if (res.warning) notify(`${res.warning}. Quedó en ${res.path}`);
      else
        notify(
          `Grabación guardada (${mmss(res.seconds)}): ${res.path}${res.split ? ` · ${res.split.count} temas en su carpeta` : ""}`,
        );
      return;
    }

    // fuente: master, master + entrada, o el sonido del sistema
    let stream: MediaStream | null = null;
    try {
      stream = await openSource(source, inputId);
    } catch (e) {
      notify(`No se pudo abrir la fuente de grabación: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    engine.setRecordSource(stream, { gain: inputGain, withMaster: source !== "system" });

    const mime = MIME[format];
    if (mime && !(typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime))) {
      engine.setRecordSource(null);
      notify(`Este equipo no puede grabar en ${format.toUpperCase()}`);
      return;
    }
    const started = await bridge.recStart({ sampleRate: engine.sampleRate, channels: 2, format, split });
    if (!started) {
      engine.setRecordSource(null);
      notify("No se pudo empezar a grabar");
      return;
    }
    const ok = mime
      ? engine.startEncodedRecording(mime, (data) => bridge.recChunk!(data))
      : await engine.startRecording((pcm) => bridge.recChunk!(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)));
    if (!ok) {
      engine.setRecordSource(null);
      await bridge.recStop({ tracks: [] });
      notify("No se pudo empezar a grabar");
      return;
    }
    const now = Date.now();
    // lo que ya está sonando entra como primer tema de la grabación
    recTracks.current = (["A", "B"] as DeckId[])
      .map((d) => engine.deckState(d))
      .filter((s) => s.playing && s.trackId)
      .map((s) => ({ at: now, title: s.title, artist: s.artist }));
    setRec({ startedAt: now, path: started.path });
  }, [engine, notify, rec, format, split, source, inputId, inputGain]);

  return { rec, toggleRec };
}
