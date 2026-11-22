import { memo, useCallback, useEffect, useRef, useState } from "react";
import { crossfaderGains } from "../engine/xfCurve";

// Deck de YouTube con el reproductor oficial (IFrame Player API).
// YouTube no entrega el audio a la página: este deck no pasa por EQ, filtro,
// efectos, sync ni grabación. Su volumen sí sigue al crossfader y al master.

interface YTPlayer {
  loadVideoById(id: string): void;
  cueVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(v: number): void;
  setPlaybackRate(r: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoData(): { title?: string; author?: string; video_id?: string };
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      width?: string | number;
      height?: string | number;
      videoId?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

/** Carga el script oficial una sola vez. */
function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    tag.onerror = () => {
      apiPromise = null;
      reject(new Error("sin conexión con YouTube"));
    };
    document.head.appendChild(tag);
  });
  return apiPromise;
}

/** Saca el id de un link de YouTube (watch, youtu.be, shorts, embed) o un id suelto. */
export function parseYouTubeId(input: string): string | null {
  const v = input.trim();
  if (/^[\w-]{11}$/.test(v)) return v;
  try {
    const u = new URL(v);
    const host = u.hostname.replace(/^www\.|^m\.|^music\./, "");
    if (host === "youtu.be") return u.pathname.slice(1, 12) || null;
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      const q = u.searchParams.get("v");
      if (q && /^[\w-]{11}$/.test(q)) return q;
      const m = u.pathname.match(/\/(?:embed|shorts|live|v)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch {
    /* no es una URL */
  }
  return null;
}

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const RECENT_KEY = "bross.youtube.recent.v1";

interface Recent {
  id: string;
  title: string;
}

function loadRecent(): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as Recent[];
    return Array.isArray(v) ? v.filter((r) => typeof r.id === "string").slice(0, 30) : [];
  } catch {
    return [];
  }
}

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "--:--";
  const t = Math.floor(s);
  return `${Math.floor(t / 60).toString().padStart(2, "0")}:${(t % 60).toString().padStart(2, "0")}`;
}

interface YouTubeDeckProps {
  visible: boolean;
  /** posición del crossfader 0..1 y volumen master 0..1 */
  crossfade: number;
  master: number;
  notify: (msg: string) => void;
}

function YouTubeDeckImpl({ visible, crossfade, master, notify }: YouTubeDeckProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState("");
  const [title, setTitle] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState({ pos: 0, dur: 0 });
  const [volume, setVolume] = useState(0.8);
  const [rate, setRate] = useState(1);
  const [side, setSide] = useState<"A" | "THRU" | "B">("THRU");
  const [recent, setRecent] = useState<Recent[]>(loadRecent);
  const [failed, setFailed] = useState<string | null>(null);

  // el reproductor se crea la primera vez que se abre la pestaña
  useEffect(() => {
    if (!visible || playerRef.current || !hostRef.current) return;
    let cancelled = false;
    const mount = document.createElement("div");
    hostRef.current.appendChild(mount);
    loadApi()
      .then((YT) => {
        if (cancelled) return;
        const origin = /^https?:/.test(location.origin) ? location.origin : undefined;
        playerRef.current = new YT.Player(mount, {
          width: "100%",
          height: "100%",
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, ...(origin ? { origin } : {}) },
          events: {
            onReady: () => setReady(true),
            onStateChange: (e) => {
              setPlaying(e.data === 1);
              const data = playerRef.current?.getVideoData();
              if (data?.title) setTitle(data.title);
            },
            onError: (e) => {
              const why =
                e.data === 101 || e.data === 150
                  ? "el dueño no permite reproducirlo fuera de YouTube"
                  : e.data === 100
                    ? "el video no existe o es privado"
                    : `error ${e.data} del reproductor`;
              setFailed(why);
              notify(`YouTube: ${why}`);
            },
          },
        });
      })
      .catch(() => setFailed("no se pudo conectar con YouTube (¿hay internet?)"));
    return () => {
      cancelled = true;
    };
  }, [visible, notify]);

  useEffect(
    () => () => {
      playerRef.current?.destroy();
      playerRef.current = null;
    },
    [],
  );

  // posición y título mientras suena
  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      setTime({ pos: p.getCurrentTime() || 0, dur: p.getDuration() || 0 });
    }, 250);
    return () => window.clearInterval(id);
  }, [ready]);

  // volumen efectivo: fader propio × crossfader (si está asignado) × master
  useEffect(() => {
    const p = playerRef.current;
    if (!ready || !p) return;
    // misma curva que los decks: en el centro a pleno
    const g = crossfaderGains(crossfade);
    const xf = side === "A" ? g.a : side === "B" ? g.b : 1;
    p.setVolume(Math.round(Math.max(0, Math.min(1, volume * xf * Math.min(1, master * 1.6))) * 100));
  }, [ready, volume, crossfade, master, side]);

  useEffect(() => {
    if (ready) playerRef.current?.setPlaybackRate(rate);
  }, [ready, rate]);

  useEffect(() => {
    if (!videoId || !title) return;
    setRecent((prev) => {
      const next = [{ id: videoId, title }, ...prev.filter((r) => r.id !== videoId)].slice(0, 30);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* sin almacenamiento */
      }
      return next;
    });
  }, [videoId, title]);

  const open = useCallback(
    (id: string, play: boolean) => {
      const p = playerRef.current;
      if (!p) return;
      setFailed(null);
      setTitle("");
      setVideoId(id);
      if (play) p.loadVideoById(id);
      else p.cueVideoById(id);
    },
    [],
  );

  const submit = () => {
    const id = parseYouTubeId(input);
    if (!id) {
      notify("Pegá un link de YouTube (youtube.com/watch?v=… o youtu.be/…)");
      return;
    }
    open(id, false);
    setInput("");
  };

  return (
    <div className="ytdeck" hidden={!visible}>
      <div className="ytleft">
        <div className="ytframe" ref={hostRef}>
          {!ready ? <div className="ytwait">{failed ?? "Cargando el reproductor de YouTube…"}</div> : null}
        </div>
      </div>
      <div className="ytright">
        <form
          className="yturl"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pegá un link de YouTube…"
            aria-label="Link de YouTube"
            disabled={!ready}
          />
          <button type="submit" disabled={!ready || !input.trim()}>
            CARGAR
          </button>
        </form>
        <div className="yttitle" title={title}>
          {title || (videoId ? "…" : "Sin video")}
          {failed && ready ? <span className="yterr"> · {failed}</span> : null}
        </div>
        <div className="ytctl">
          <button
            type="button"
            className={`ytplay${playing ? " on" : ""}`}
            disabled={!videoId}
            onClick={() => (playing ? playerRef.current?.pauseVideo() : playerRef.current?.playVideo())}
            title={playing ? "Pausa" : "Play"}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <span className="yttime">{fmt(time.pos)}</span>
          <input
            className="ytseek"
            type="range"
            min={0}
            max={Math.max(1, time.dur)}
            step={0.1}
            value={Math.min(time.pos, time.dur || 0)}
            disabled={!videoId || !time.dur}
            onChange={(e) => playerRef.current?.seekTo(Number(e.target.value), true)}
            aria-label="Posición del video"
          />
          <span className="yttime">-{fmt(Math.max(0, time.dur - time.pos))}</span>
        </div>
        <div className="ytctl">
          <label className="ytlab">
            VOL
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Volumen del deck de YouTube"
            />
          </label>
          <label className="ytlab">
            VEL
            <select value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Velocidad">
              {RATES.map((r) => (
                <option key={r} value={r}>
                  {r}×
                </option>
              ))}
            </select>
          </label>
          <div className="ytside" role="group" aria-label="Lado del crossfader">
            {(["A", "THRU", "B"] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={side === s ? "on" : ""}
                onClick={() => setSide(s)}
                title={
                  s === "THRU"
                    ? "No sigue al crossfader (solo al master)"
                    : `Sigue al crossfader del lado ${s}`
                }
              >
                {s === "THRU" ? "—" : s}
              </button>
            ))}
          </div>
        </div>
        <div className="ytnote">
          Reproductor oficial de YouTube: sin EQ, filtro, efectos, sync ni grabación.
        </div>
        <div className="ytrecent">
          {recent.map((r) => (
            <button
              key={r.id}
              type="button"
              className={r.id === videoId ? "on" : ""}
              onClick={() => open(r.id, false)}
              onDoubleClick={() => open(r.id, true)}
              title="Clic: cargar · doble clic: cargar y reproducir"
              disabled={!ready}
            >
              {r.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export const YouTubeDeck = memo(YouTubeDeckImpl);
