import { useEffect, useRef, useState } from "react";
import type { ImageOverlay, SourceKind, TextOverlay, Transition, VideoConfig, VideoMixer } from "../video/mixer";
import { videoMime } from "../hooks/useVideo";

interface VideoPanelProps {
  mixer: VideoMixer;
  config: VideoConfig;
  onConfig: (c: VideoConfig) => void;
  texts: TextOverlay[];
  onTexts: (t: TextOverlay[]) => void;
  image: ImageOverlay;
  onImage: (i: ImageOverlay) => void;
  screenOpen: boolean;
  onOpenScreen: () => void;
  onCloseScreen: () => void;
  recording: { startedAt: number } | null;
  onRec: (format: "webm" | "mp4") => void;
  rtmp: { live: boolean; error: string | null };
  onRtmp: (url: string, key: string, kbps: number) => void;
  onClose: () => void;
}

const TRANSITIONS: [Transition, string][] = [
  ["fade", "Fundido"],
  ["cut", "Corte"],
  ["wipe", "Cortina"],
  ["slide", "Desplazar"],
  ["cube", "Cubo"],
  ["zoom", "Zoom"],
  ["blur", "Desenfoque"],
];

const SOURCES: [SourceKind, string][] = [
  ["deck", "Video del deck"],
  ["camera", "Cámara"],
  ["slideshow", "Presentación de imágenes"],
  ["black", "Negro"],
];

const RTMP_KEY = "bross.rtmp.v1";

/** Datos del servidor RTMP (la clave se guarda solo en esta PC). */
function RtmpForm({ live, error, onToggle }: { live: boolean; error: string | null; onToggle: (url: string, key: string, kbps: number) => void }) {
  const [v, setV] = useState(() => {
    try {
      return { url: "rtmp://a.rtmp.youtube.com/live2", key: "", kbps: 4500, ...JSON.parse(localStorage.getItem(RTMP_KEY) ?? "{}") };
    } catch {
      return { url: "rtmp://a.rtmp.youtube.com/live2", key: "", kbps: 4500 };
    }
  });
  const [ff, setFf] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void window.bross?.rtmpCheck?.().then(setFf);
  }, []);
  const save = (patch: Partial<typeof v>) => {
    const next = { ...v, ...patch };
    setV(next);
    try {
      localStorage.setItem(RTMP_KEY, JSON.stringify(next));
    } catch {
      /* sin almacenamiento */
    }
  };
  return (
    <>
      <div className="te-grid">
        <label className="te-field">
          <span>Servidor</span>
          <input className="mono" value={v.url} disabled={live} onChange={(e) => save({ url: e.target.value })} />
        </label>
        <label className="te-field">
          <span>Clave de transmisión</span>
          <input type="password" value={v.key} disabled={live} onChange={(e) => save({ key: e.target.value })} />
        </label>
      </div>
      <div className="vp-inline">
        <select value={v.kbps} disabled={live} onChange={(e) => save({ kbps: Number(e.target.value) })} aria-label="Calidad">
          {[2500, 4500, 6000, 9000].map((k) => (
            <option key={k} value={k}>
              {k / 1000} Mbps
            </option>
          ))}
        </select>
        <button type="button" className={`settings-btn${live ? " on" : ""}`} disabled={!ff} onClick={() => onToggle(v.url, v.key, v.kbps)}>
          {live ? "■ Cortar video en vivo" : "● Transmitir video"}
        </button>
        <span className="settings-note">
          {ff === undefined ? "Buscando ffmpeg…" : ff ? `Usa ${ff.replace(/ Copyright.*/, "")}` : "Necesita ffmpeg instalado (winget install Gyan.FFmpeg)."}
          {error ? ` · ${error}` : ""}
        </span>
      </div>
    </>
  );
}

/** Panel de video: vista previa, pantalla, mezcla, cámara, títulos, imágenes y grabación. */
export function VideoPanel(p: VideoPanelProps) {
  const preview = useRef<HTMLVideoElement>(null);
  const slidesInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [camError, setCamError] = useState<string | null>(null);
  const [camOn, setCamOn] = useState(p.mixer.cameraOn);
  const [recFormat, setRecFormat] = useState<"webm" | "mp4">(videoMime("mp4") ? "mp4" : "webm");
  const [, force] = useState(0);
  const c = p.config;
  const set = (patch: Partial<VideoConfig>) => p.onConfig({ ...c, ...patch });

  useEffect(() => {
    const v = preview.current;
    if (v) {
      v.srcObject = p.mixer.output();
      void v.play().catch(() => undefined);
    }
    void navigator.mediaDevices?.enumerateDevices().then((d) => setCams(d.filter((x) => x.kind === "videoinput")));
  }, [p.mixer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p]);

  const text = (i: number, patch: Partial<TextOverlay>) => p.onTexts(p.texts.map((t, k) => (k === i ? { ...t, ...patch } : t)));

  return (
    <div className="settings-overlay" onClick={p.onClose}>
      <div className="settings-card video-panel" role="dialog" aria-modal="true" aria-label="Video" onClick={(e) => e.stopPropagation()}>
        <header className="settings-head">
          <div>
            <h2>Video</h2>
            <p>Mezcla de video al ritmo del crossfader, cámara, títulos, imágenes, karaoke y grabación.</p>
          </div>
          <button type="button" className="settings-close" onClick={p.onClose} aria-label="Cerrar video">
            ✕
          </button>
        </header>
        <div className="settings-body">
          <section className="settings-section">
            <div className="vp-top">
              <video ref={preview} className="vp-preview" muted playsInline />
              <div className="vp-actions">
                {p.screenOpen ? (
                  <>
                    <button type="button" className="settings-btn" onClick={() => void window.bross?.screenFullscreen?.(true)}>
                      Pantalla completa (2.º monitor)
                    </button>
                    <button type="button" className="settings-btn" onClick={() => void window.bross?.screenFullscreen?.(false)}>
                      Ventana
                    </button>
                    <button type="button" className="settings-btn" onClick={p.onCloseScreen}>
                      Cerrar pantalla
                    </button>
                  </>
                ) : (
                  <button type="button" className="settings-btn primary" onClick={p.onOpenScreen}>
                    Abrir pantalla
                  </button>
                )}
                <div className="vp-rec">
                  <select
                    value={recFormat}
                    onChange={(e) => setRecFormat(e.target.value as "webm" | "mp4")}
                    disabled={!!p.recording}
                    aria-label="Formato del video"
                  >
                    <option value="webm" disabled={!videoMime("webm")}>
                      WebM
                    </option>
                    <option value="mp4" disabled={!videoMime("mp4")}>
                      MP4
                    </option>
                  </select>
                  <button type="button" className={`settings-btn${p.recording ? " on" : ""}`} onClick={() => p.onRec(recFormat)}>
                    {p.recording ? "■ Cortar video" : "● Grabar video"}
                  </button>
                </div>
                <p className="settings-note">Los videos van a Música/BROSS DJ/video, con el audio del master.</p>
              </div>
            </div>

            <div className="te-grid">
              <label className="te-field">
                <span>Transición</span>
                <select value={c.transition} onChange={(e) => set({ transition: e.target.value as Transition })}>
                  {TRANSITIONS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="te-field">
                <span>Mezcla de video</span>
                <div className="vp-inline">
                  <label className="te-check">
                    <input type="checkbox" checked={c.followCrossfader} onChange={(e) => set({ followCrossfader: e.target.checked })} />
                    Sigue al crossfader
                  </label>
                  {!c.followCrossfader ? (
                    <input type="range" min={0} max={1} step={0.01} value={c.fader} onChange={(e) => set({ fader: Number(e.target.value) })} aria-label="Fader de video" />
                  ) : null}
                </div>
              </label>
              <label className="te-field">
                <span>Fuente A</span>
                <select value={c.sourceA} onChange={(e) => set({ sourceA: e.target.value as SourceKind })}>
                  {SOURCES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="te-field">
                <span>Fuente B</span>
                <select value={c.sourceB} onChange={(e) => set({ sourceB: e.target.value as SourceKind })}>
                  {SOURCES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="te-check">
              <input type="checkbox" checked={c.showTrackCards} onChange={(e) => set({ showTrackCards: e.target.checked })} />
              Si la pista no tiene video, mostrar título, artista y barras al ritmo
            </label>

            <h3 className="te-h">Video en vivo (RTMP)</h3>
            <RtmpForm live={p.rtmp.live} error={p.rtmp.error} onToggle={p.onRtmp} />

            <h3 className="te-h">Cámara</h3>
            <div className="vp-inline">
              <select
                aria-label="Cámara"
                onChange={async (e) => {
                  const err = await p.mixer.setCamera(e.target.value === "off" ? null : e.target.value);
                  setCamError(err);
                  setCamOn(p.mixer.cameraOn);
                }}
                defaultValue={camOn ? "" : "off"}
              >
                <option value="off">Apagada</option>
                <option value="">Cámara predeterminada</option>
                {cams.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Cámara ${i + 1}`}
                  </option>
                ))}
              </select>
              <span className="settings-note">{camError ?? (camOn ? "Encendida: elegila como fuente A o B." : "")}</span>
            </div>

            <h3 className="te-h">Presentación de imágenes</h3>
            <div className="vp-inline">
              <button type="button" className="settings-btn" onClick={() => slidesInput.current?.click()}>
                Elegir imágenes…
              </button>
              <span className="settings-note">{p.mixer.slideCount} imágenes</span>
              <label className="te-field vp-small">
                <span>Segundos por imagen</span>
                <input type="number" min={1} max={120} value={c.slideInterval} onChange={(e) => set({ slideInterval: Math.max(1, Number(e.target.value) || 6) })} />
              </label>
              <input
                ref={slidesInput}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (!files.length) return;
                  p.mixer.setSlides(files.map((f) => URL.createObjectURL(f)));
                  force((n) => n + 1);
                }}
              />
            </div>

            <h3 className="te-h">Logo / imagen encima</h3>
            <div className="vp-inline">
              <button type="button" className="settings-btn" onClick={() => imageInput.current?.click()}>
                {p.image.url ? "Cambiar imagen…" : "Elegir imagen…"}
              </button>
              <label className="te-check">
                <input type="checkbox" checked={p.image.on} disabled={!p.image.url} onChange={(e) => p.onImage({ ...p.image, on: e.target.checked })} />
                Mostrar
              </label>
              {(["x", "y", "w", "opacity"] as const).map((k) => (
                <label key={k} className="te-field vp-small">
                  <span>{k === "w" ? "Tamaño" : k === "opacity" ? "Opacidad" : k.toUpperCase()}</span>
                  <input type="range" min={k === "w" ? 0.03 : 0} max={1} step={0.01} value={p.image[k]} onChange={(e) => p.onImage({ ...p.image, [k]: Number(e.target.value) })} />
                </label>
              ))}
              <input
                ref={imageInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) p.onImage({ ...p.image, url: URL.createObjectURL(f), on: true });
                }}
              />
            </div>

            <h3 className="te-h">Títulos</h3>
            {p.texts.map((t, i) => (
              <div className="vp-text" key={t.id}>
                <input type="checkbox" checked={t.on} onChange={(e) => text(i, { on: e.target.checked })} aria-label="Mostrar título" />
                <input className="vp-text-input" value={t.text} onChange={(e) => text(i, { text: e.target.value })} aria-label="Texto" />
                <input type="color" value={t.color} onChange={(e) => text(i, { color: e.target.value })} aria-label="Color" />
                <select value={t.anim} onChange={(e) => text(i, { anim: e.target.value as TextOverlay["anim"] })} aria-label="Animación">
                  <option value="none">Fijo</option>
                  <option value="scroll">Marquesina</option>
                  <option value="pulse">Pulso</option>
                  <option value="fade">Parpadeo suave</option>
                </select>
                <input type="range" min={16} max={160} value={t.size} onChange={(e) => text(i, { size: Number(e.target.value) })} aria-label="Tamaño" title="Tamaño" />
                <input type="range" min={0} max={1} step={0.01} value={t.y} onChange={(e) => text(i, { y: Number(e.target.value) })} aria-label="Altura" title="Altura" />
                <button type="button" className="midi-clear" onClick={() => p.onTexts(p.texts.filter((_, k) => k !== i))} title="Borrar">
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="settings-btn"
              onClick={() =>
                p.onTexts([
                  ...p.texts,
                  { id: crypto.randomUUID(), text: "BROSS DJ", x: 0.5, y: 0.12 + 0.1 * (p.texts.length % 6), size: 64, color: "#ffffff", anim: "none", on: true },
                ])
              }
            >
              + Título
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
