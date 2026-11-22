import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioEngine, DeckId, DeckRuntime, LibraryTrack } from "../engine/audio";
import { DEFAULT_VIDEO, VideoMixer, type FrameInput, type ImageOverlay, type KaraokeFrame, type TextOverlay, type VideoConfig } from "../video/mixer";

const VIDEO_EXT = /\.(mp4|m4v|webm|mkv|mov)$/i;
const KEY = "bross.video.v1";

interface SavedVideo {
  config: VideoConfig;
  texts: TextOverlay[];
  image: Omit<ImageOverlay, "url">;
}

function loadSaved(): SavedVideo {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<SavedVideo> | null;
    return {
      config: { ...DEFAULT_VIDEO, ...(v?.config ?? {}) },
      texts: Array.isArray(v?.texts) ? v!.texts : [],
      image: { x: 0.82, y: 0.08, w: 0.14, opacity: 0.9, on: false, ...(v?.image ?? {}) },
    };
  } catch {
    return { config: { ...DEFAULT_VIDEO }, texts: [], image: { x: 0.82, y: 0.08, w: 0.14, opacity: 0.9, on: false } };
  }
}

/** URL bross-media:// del video de una pista (null si es solo audio). */
export function videoUrlOf(t: LibraryTrack | undefined): string | null {
  if (!t?.sourcePath || !VIDEO_EXT.test(t.sourcePath) || !window.bross) return null;
  return `bross-media://file/${encodeURIComponent(t.sourcePath)}`;
}

/** Formato de video que puede grabar este equipo. */
export function videoMime(format: "webm" | "mp4"): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const list =
    format === "mp4"
      ? ["video/mp4;codecs=avc1,opus", "video/mp4;codecs=avc1.42E01E,opus", "video/mp4"]
      : ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return list.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

interface Args {
  engine: AudioEngine;
  notify: (msg: string) => void;
  rtRef: { current: { A: DeckRuntime; B: DeckRuntime } };
  tracksRef: { current: LibraryTrack[] };
  crossfadeRef: { current: number };
  karaokeRef: { current: KaraokeFrame };
}

/** Video: mezclador, ventana de pantalla, vista previa y grabación. */
export function useVideo({ engine, notify, rtRef, tracksRef, crossfadeRef, karaokeRef }: Args) {
  const mixerRef = useRef<VideoMixer | null>(null);
  const saved = useRef(loadSaved());
  const [config, setConfig] = useState<VideoConfig>(saved.current.config);
  const [texts, setTexts] = useState<TextOverlay[]>(saved.current.texts);
  const [image, setImage] = useState<ImageOverlay>({ ...saved.current.image, url: null });
  const [screenOpen, setScreenOpen] = useState(false);
  const [recording, setRecording] = useState<{ startedAt: number } | null>(null);
  const [active, setActive] = useState(false);
  const screenWin = useRef<Window | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const rtmpRec = useRef<MediaRecorder | null>(null);
  const [rtmp, setRtmp] = useState<{ live: boolean; error: string | null }>({ live: false, error: null });

  useEffect(() => {
    const off = window.bross?.onRtmpStatus?.((s) => {
      setRtmp(s);
      if (!s.live && rtmpRec.current) {
        rtmpRec.current.stop();
        rtmpRec.current = null;
      }
      if (s.error) notify(`RTMP: ${s.error}`);
    });
    return () => off?.();
  }, [notify]);
  /** bloques en camino al proceso principal (en orden) */
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  const mixer = useCallback((): VideoMixer => {
    if (!mixerRef.current) {
      const m = new VideoMixer();
      m.getInput = (): FrameInput => {
        const rt = rtRef.current;
        const deck = (d: DeckId) => {
          const s = rt[d];
          const t = tracksRef.current.find((x) => x.id === s.trackId);
          return {
            trackId: s.trackId,
            videoUrl: videoUrlOf(t),
            title: s.title,
            artist: s.artist,
            position: engine.deckPosition(d),
            rate: engine.deckRate(d),
            level: s.level,
          };
        };
        return { A: deck("A"), B: deck("B"), crossfader: crossfadeRef.current, karaoke: karaokeRef.current };
      };
      mixerRef.current = m;
    }
    return mixerRef.current;
  }, [engine]);

  // el mezclador corre solo mientras algo lo usa (panel, pantalla o grabación)
  useEffect(() => {
    const m = mixer();
    m.config = config;
    m.texts = texts;
    m.setImage(image);
    if (active || screenOpen || recording || rtmp.live) m.start();
    else m.stop();
  }, [mixer, config, texts, image, active, screenOpen, recording, rtmp.live]);

  useEffect(() => {
    try {
      const { url: _url, ...img } = image;
      void _url;
      localStorage.setItem(KEY, JSON.stringify({ config, texts, image: img }));
    } catch {
      /* sin almacenamiento */
    }
  }, [config, texts, image]);

  // si cierran la pantalla a mano
  useEffect(() => {
    if (!screenOpen) return;
    const id = window.setInterval(() => {
      if (screenWin.current?.closed) {
        screenWin.current = null;
        setScreenOpen(false);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [screenOpen]);

  const openScreen = useCallback(async () => {
    if (screenWin.current && !screenWin.current.closed) {
      screenWin.current.focus();
      return;
    }
    const w = window.open(`${location.origin}${location.pathname}#screen`, "bross-screen");
    if (!w) {
      notify("No se pudo abrir la pantalla");
      return;
    }
    screenWin.current = w;
    setScreenOpen(true);
    const stream = mixer().output();
    // la pantalla es la misma app: se le pasa la salida del canvas directo
    for (let k = 0; k < 100; k++) {
      const v = w.document?.getElementById("screen-video") as HTMLVideoElement | null;
      if (v) {
        v.srcObject = stream;
        void v.play().catch(() => undefined);
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    notify("La pantalla no respondió");
  }, [mixer, notify]);

  const closeScreen = useCallback(() => {
    screenWin.current?.close();
    screenWin.current = null;
    setScreenOpen(false);
  }, []);

  const toggleVideoRec = useCallback(
    async (format: "webm" | "mp4") => {
      const b = window.bross;
      if (recRef.current) {
        const r = recRef.current;
        recRef.current = null;
        await new Promise<void>((resolve) => {
          r.onstop = () => resolve();
          r.stop();
        });
        await chainRef.current;
        setRecording(null);
        const res = await b?.vrecStop?.();
        notify(res ? `Video guardado: ${res.path}` : "No se pudo guardar el video");
        return;
      }
      if (!b?.vrecStart || !b.vrecChunk) {
        notify("La grabación de video está disponible en la app de escritorio");
        return;
      }
      const mime = videoMime(format);
      if (!mime) {
        notify(`Este equipo no puede grabar video en ${format.toUpperCase()}`);
        return;
      }
      const started = await b.vrecStart({ format: mime.startsWith("video/mp4") ? "mp4" : "webm" });
      if (!started) return notify("No se pudo empezar a grabar video");
      const m = mixer();
      m.start();
      const stream = new MediaStream([...m.output().getVideoTracks(), ...engine.mixStream().getAudioTracks()]);
      const r = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 192_000 });
      chainRef.current = Promise.resolve();
      r.ondataavailable = (e) => {
        if (!e.data.size) return;
        chainRef.current = chainRef.current.then(() => e.data.arrayBuffer().then((buf) => b.vrecChunk!(new Uint8Array(buf))));
      };
      r.start(1000);
      recRef.current = r;
      setRecording({ startedAt: Date.now() });
      void engine.resume();
    },
    [engine, mixer, notify],
  );

  /** Video en vivo por RTMP: el mezclador en WebM va a ffmpeg, que lo manda al servidor. */
  const toggleRtmp = useCallback(
    async (url: string, key: string, kbps: number) => {
      const b = window.bross;
      if (rtmpRec.current) {
        rtmpRec.current.stop();
        rtmpRec.current = null;
        await b?.rtmpStop?.();
        return;
      }
      if (!b?.rtmpStart || !b.rtmpChunk) return notify("El video en vivo está disponible en la app de escritorio");
      const mime = videoMime("webm");
      if (!mime) return notify("Este equipo no puede codificar video para transmitir");
      const res = await b.rtmpStart({ url, key, kbps });
      if (!res.ok) return notify(`RTMP: ${res.error}`);
      const m = mixer();
      m.start();
      const stream = new MediaStream([...m.output().getVideoTracks(), ...engine.mixStream().getAudioTracks()]);
      const r = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 });
      let chain = Promise.resolve();
      r.ondataavailable = (e) => {
        if (!e.data.size) return;
        chain = chain.then(() => e.data.arrayBuffer().then((buf) => b.rtmpChunk!(new Uint8Array(buf))));
      };
      // bloques chicos: menos demora en la transmisión
      r.start(250);
      rtmpRec.current = r;
      void engine.resume();
      notify("Video en vivo por RTMP");
    },
    [engine, mixer, notify],
  );

  return {
    rtmp,
    toggleRtmp,
    mixer,
    videoConfig: config,
    setVideoConfig: setConfig,
    videoTexts: texts,
    setVideoTexts: setTexts,
    videoImage: image,
    setVideoImage: setImage,
    screenOpen,
    openScreen,
    closeScreen,
    videoRec: recording,
    toggleVideoRec,
    setVideoActive: setActive,
  };
}
