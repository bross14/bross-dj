import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioEngine } from "../engine/audio";
import type { HistoryEntry, SongRequest, StreamOptions, StreamStatus } from "../library";

export interface StreamPrefs {
  name: string;
  kbps: number;
  icecastOn: boolean;
  url: string;
  mount: string;
  user: string;
  password: string;
  lanOn: boolean;
  port: number;
  requests: boolean;
}

const KEY = "bross.stream.v1";

export const DEFAULT_STREAM: StreamPrefs = {
  name: "BROSS DJ en vivo",
  kbps: 128,
  icecastOn: false,
  url: "http://localhost:8000",
  mount: "/live",
  user: "source",
  password: "",
  lanOn: true,
  port: 8010,
  requests: true,
};

export function loadStreamPrefs(): StreamPrefs {
  try {
    return { ...DEFAULT_STREAM, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<StreamPrefs>) };
  } catch {
    return { ...DEFAULT_STREAM };
  }
}

export function saveStreamPrefs(p: StreamPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* sin almacenamiento */
  }
}

const OFF: StreamStatus = { live: false, icecast: "off", listeners: 0, lan: null, error: null };

interface Args {
  engine: AudioEngine;
  notify: (msg: string) => void;
  history: HistoryEntry[];
  prefs: StreamPrefs;
}

/** Streaming en vivo: Icecast, servidor en la red local y pedidos. */
export function useStreaming({ engine, notify, history, prefs }: Args) {
  const [status, setStatus] = useState<StreamStatus>(OFF);
  const [requests, setRequests] = useState<SongRequest[]>([]);
  const stopTap = useRef<(() => void) | null>(null);

  useEffect(() => {
    const b = window.bross;
    if (!b?.onStreamStatus || !b.onStreamRequest) return;
    const off1 = b.onStreamStatus(setStatus);
    const off2 = b.onStreamRequest((r) => {
      setRequests((prev) => [...prev, r].slice(-200));
      notify(`Pedido de ${r.name}: ${r.song}`);
    });
    void b.streamStatus?.().then(setStatus);
    void b.streamRequests?.().then(setRequests);
    return () => {
      off1();
      off2();
    };
  }, [notify]);

  // título en vivo: cada tema que entra al historial mientras se transmite
  useEffect(() => {
    if (!status.live) return;
    const last = history[history.length - 1];
    if (last) void window.bross?.streamSong?.(last.artist ? `${last.artist} - ${last.title}` : last.title);
  }, [history, status.live]);

  const toggleStream = useCallback(async () => {
    const b = window.bross;
    if (!b?.streamStart || !b.streamChunk || !b.streamStop) {
      notify("El streaming está disponible en la app de escritorio");
      return;
    }
    if (status.live) {
      stopTap.current?.();
      stopTap.current = null;
      await b.streamStop();
      notify("Transmisión cortada");
      return;
    }
    if (!prefs.icecastOn && !prefs.lanOn) {
      notify("Activá Icecast o el servidor de la red local en Ajustes → Streaming");
      return;
    }
    if (prefs.icecastOn && !prefs.password) {
      notify("Falta la contraseña de Icecast (Ajustes → Streaming)");
      return;
    }
    const opts: StreamOptions = {
      sampleRate: engine.sampleRate,
      channels: 2,
      kbps: prefs.kbps,
      name: prefs.name,
      icecast: prefs.icecastOn ? { url: prefs.url, mount: prefs.mount, user: prefs.user, password: prefs.password } : null,
      lan: prefs.lanOn ? { enabled: true, port: prefs.port, requests: prefs.requests } : null,
    };
    const st = await b.streamStart(opts).catch((e: unknown) => ({ ...OFF, error: String(e) }));
    setStatus(st);
    if (!st.live) {
      notify(st.error ?? "No se pudo empezar a transmitir");
      return;
    }
    stopTap.current = await engine.startPcmTap((pcm) => b.streamChunk!(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)));
    const last = history[history.length - 1];
    if (last) void b.streamSong?.(last.artist ? `${last.artist} - ${last.title}` : last.title);
    notify(st.lan ? `En vivo · escuchá en http://${st.lan.addresses[0] ?? "localhost"}:${st.lan.port}` : "En vivo");
  }, [engine, history, notify, prefs, status.live]);

  const dismissRequest = useCallback((id: string) => setRequests((prev) => prev.filter((r) => r.id !== id)), []);

  return { streamStatus: status, requests, toggleStream, dismissRequest };
}
