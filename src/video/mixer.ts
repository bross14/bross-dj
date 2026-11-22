// Mezclador de video: compone en un canvas 1280×720 las dos fuentes (video
// de cada deck, cámara, presentación de imágenes o negro), la transición
// según el crossfader, los títulos, el logo/imagen y las letras de karaoke.
//
// La salida es canvas.captureStream(): se ve en la vista previa, en la
// ventana de pantalla (window.open de la propia app) y se graba con el audio
// del master. Todo corre en el hilo principal a 30 cuadros por segundo.

import { CDG_H, CDG_W, CdgPlayer, lrcIndexAt, lrcProgress, type LrcLine } from "../karaoke";

export const VW = 1280;
export const VH = 720;

export type Transition = "fade" | "cut" | "wipe" | "slide" | "cube" | "zoom" | "blur";
export type SourceKind = "deck" | "camera" | "slideshow" | "black";

export interface TextOverlay {
  id: string;
  text: string;
  /** 0..1 en la pantalla */
  x: number;
  y: number;
  size: number;
  color: string;
  anim: "none" | "scroll" | "pulse" | "fade";
  on: boolean;
}

export interface ImageOverlay {
  url: string | null;
  x: number;
  y: number;
  /** ancho relativo a la pantalla */
  w: number;
  opacity: number;
  on: boolean;
}

export interface VideoConfig {
  transition: Transition;
  /** la mezcla sigue al crossfader de audio (si no, usa `fader`) */
  followCrossfader: boolean;
  fader: number;
  sourceA: SourceKind;
  sourceB: SourceKind;
  /** tarjeta con título y artista cuando la pista no tiene video */
  showTrackCards: boolean;
  slideInterval: number;
}

export const DEFAULT_VIDEO: VideoConfig = {
  transition: "fade",
  followCrossfader: true,
  fader: 0,
  sourceA: "deck",
  sourceB: "deck",
  showTrackCards: true,
  slideInterval: 6,
};

export interface DeckFrame {
  trackId: string | null;
  /** URL del video de la pista (bross-media://) o null si es solo audio */
  videoUrl: string | null;
  title: string;
  artist: string;
  position: number;
  /** velocidad con signo (0 = parado) */
  rate: number;
  level: number;
}

export interface KaraokeFrame {
  deck: "A" | "B" | null;
  lrc: LrcLine[] | null;
  cdg: CdgPlayer | null;
  singer: string | null;
}

export interface FrameInput {
  A: DeckFrame;
  B: DeckFrame;
  crossfader: number;
  karaoke: KaraokeFrame;
}

const DECK_COLOR = { A: "#2f8fe8", B: "#e05fe0" };

export class VideoMixer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private videos: Record<"A" | "B", HTMLVideoElement>;
  private loadedUrl: Record<"A" | "B", string | null> = { A: null, B: null };
  private camera: HTMLVideoElement;
  private cameraStream: MediaStream | null = null;
  private slides: HTMLImageElement[] = [];
  private slideStart = 0;
  private image: HTMLImageElement | null = null;
  private imageUrl: string | null = null;
  private cdgCanvas: HTMLCanvasElement;
  private timer = 0;
  private t0 = performance.now();
  config: VideoConfig = { ...DEFAULT_VIDEO };
  texts: TextOverlay[] = [];
  imageOverlay: ImageOverlay = { url: null, x: 0.82, y: 0.08, w: 0.14, opacity: 0.9, on: false };
  /** lo que necesita cada cuadro (decks, crossfader, karaoke) */
  getInput: (() => FrameInput) | null = null;
  private stream: MediaStream | null = null;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = VW;
    this.canvas.height = VH;
    this.ctx = this.canvas.getContext("2d")!;
    const mk = () => {
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.crossOrigin = "anonymous";
      v.preload = "auto";
      return v;
    };
    this.videos = { A: mk(), B: mk() };
    this.camera = mk();
    this.cdgCanvas = document.createElement("canvas");
    this.cdgCanvas.width = CDG_W;
    this.cdgCanvas.height = CDG_H;
  }

  start() {
    if (this.timer) return;
    this.timer = window.setInterval(() => this.frame(), 33);
  }

  stop() {
    window.clearInterval(this.timer);
    this.timer = 0;
    for (const v of [this.videos.A, this.videos.B]) v.pause();
  }

  /** Salida de video (30 fps). */
  output(): MediaStream {
    if (!this.stream) this.stream = this.canvas.captureStream(30);
    return this.stream;
  }

  async setCamera(deviceId: string | null): Promise<string | null> {
    this.cameraStream?.getTracks().forEach((t) => t.stop());
    this.cameraStream = null;
    this.camera.srcObject = null;
    if (deviceId == null) return null;
    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: 1280, height: 720 },
        audio: false,
      });
      this.camera.srcObject = this.cameraStream;
      await this.camera.play();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  get cameraOn(): boolean {
    return !!this.cameraStream;
  }

  setSlides(urls: string[]) {
    this.slides = urls.map((u) => {
      const img = new Image();
      img.src = u;
      return img;
    });
    this.slideStart = performance.now();
  }

  get slideCount(): number {
    return this.slides.length;
  }

  setImage(overlay: ImageOverlay) {
    this.imageOverlay = overlay;
    if (overlay.url !== this.imageUrl) {
      this.imageUrl = overlay.url;
      if (overlay.url) {
        const img = new Image();
        img.src = overlay.url;
        this.image = img;
      } else this.image = null;
    }
  }

  /** Mantiene el <video> del deck en el mismo lugar que el audio. */
  private syncDeck(d: "A" | "B", f: DeckFrame) {
    const v = this.videos[d];
    if (f.videoUrl !== this.loadedUrl[d]) {
      this.loadedUrl[d] = f.videoUrl;
      if (f.videoUrl) {
        v.src = f.videoUrl;
        v.load();
      } else {
        v.removeAttribute("src");
        v.load();
      }
    }
    if (!f.videoUrl || v.readyState < 1) return;
    const forward = f.rate > 0.05;
    const target = Math.max(0, Math.min(v.duration || Infinity, f.position));
    if (forward) {
      const r = Math.max(0.25, Math.min(4, f.rate));
      if (Math.abs(v.playbackRate - r) > 0.01) v.playbackRate = r;
      if (Math.abs(v.currentTime - target) > 0.3) v.currentTime = target;
      if (v.paused) void v.play().catch(() => undefined);
    } else {
      if (!v.paused) v.pause();
      // parado, en reversa o haciendo scratch: el cuadro sigue a la posición
      if (Math.abs(v.currentTime - target) > 0.04 && !v.seeking) v.currentTime = target;
    }
  }

  private drawCover(src: CanvasImageSource, sw: number, sh: number) {
    if (!sw || !sh) return;
    const s = Math.max(VW / sw, VH / sh);
    const w = sw * s;
    const h = sh * s;
    this.ctx.drawImage(src, (VW - w) / 2, (VH - h) / 2, w, h);
  }

  private trackCard(d: "A" | "B", f: DeckFrame) {
    const c = this.ctx;
    const g = c.createLinearGradient(0, 0, VW, VH);
    g.addColorStop(0, "#07080c");
    g.addColorStop(1, DECK_COLOR[d] + "55");
    c.fillStyle = g;
    c.fillRect(0, 0, VW, VH);
    if (!this.config.showTrackCards || !f.trackId) return;
    // barras al ritmo del nivel del deck
    const bars = 48;
    const t = (performance.now() - this.t0) / 1000;
    for (let i = 0; i < bars; i++) {
      const h = (0.15 + 0.85 * f.level) * (0.4 + 0.6 * Math.abs(Math.sin(i * 0.7 + t * 3 * (f.rate || 0)))) * VH * 0.35;
      c.fillStyle = DECK_COLOR[d] + "88";
      c.fillRect(80 + i * ((VW - 160) / bars), VH * 0.72 - h, (VW - 160) / bars - 6, h);
    }
    c.fillStyle = "#ffffff";
    c.textAlign = "center";
    c.font = "700 56px system-ui, sans-serif";
    c.fillText(f.title.slice(0, 48), VW / 2, VH * 0.36);
    c.fillStyle = "#c8c8c8";
    c.font = "400 32px system-ui, sans-serif";
    c.fillText(f.artist.slice(0, 60), VW / 2, VH * 0.36 + 52);
  }

  /** Dibuja una fuente completa en el canvas. */
  private drawSource(kind: SourceKind, d: "A" | "B", f: DeckFrame) {
    const c = this.ctx;
    if (kind === "black") {
      c.fillStyle = "#000";
      c.fillRect(0, 0, VW, VH);
      return;
    }
    if (kind === "camera") {
      if (this.cameraStream && this.camera.readyState >= 2) this.drawCover(this.camera, this.camera.videoWidth, this.camera.videoHeight);
      else this.trackCard(d, { ...f, trackId: null });
      return;
    }
    if (kind === "slideshow") {
      const n = this.slides.length;
      if (!n) return this.trackCard(d, f);
      const per = Math.max(1, this.config.slideInterval) * 1000;
      const el = performance.now() - this.slideStart;
      const i = Math.floor(el / per) % n;
      const img = this.slides[i];
      const next = this.slides[(i + 1) % n];
      const into = (el % per) / per;
      c.fillStyle = "#000";
      c.fillRect(0, 0, VW, VH);
      if (img.complete) this.drawCover(img, img.naturalWidth, img.naturalHeight);
      // fundido al siguiente en el último 15 %
      if (into > 0.85 && next.complete) {
        c.globalAlpha = (into - 0.85) / 0.15;
        this.drawCover(next, next.naturalWidth, next.naturalHeight);
        c.globalAlpha = 1;
      }
      return;
    }
    const v = this.videos[d];
    if (f.videoUrl && v.readyState >= 2) {
      c.fillStyle = "#000";
      c.fillRect(0, 0, VW, VH);
      this.drawCover(v, v.videoWidth, v.videoHeight);
    } else this.trackCard(d, f);
  }

  private layer(kind: SourceKind, d: "A" | "B", f: DeckFrame, draw: () => void) {
    const c = this.ctx;
    c.save();
    draw();
    this.drawSource(kind, d, f);
    c.restore();
  }

  private mixLayers(x: number, input: FrameInput) {
    const c = this.ctx;
    const { A, B } = input;
    const a = () => this.drawSource(this.config.sourceA, "A", A);
    const b = () => this.drawSource(this.config.sourceB, "B", B);
    c.globalAlpha = 1;
    c.filter = "none";
    switch (this.config.transition) {
      case "cut":
        return x < 0.5 ? a() : b();
      case "fade":
        a();
        if (x > 0.001) {
          c.globalAlpha = x;
          b();
          c.globalAlpha = 1;
        }
        return;
      case "wipe":
        a();
        this.layer(this.config.sourceB, "B", B, () => {
          c.beginPath();
          c.rect(0, 0, VW * x, VH);
          c.clip();
        });
        return;
      case "slide":
        this.layer(this.config.sourceA, "A", A, () => c.translate(-VW * x, 0));
        this.layer(this.config.sourceB, "B", B, () => c.translate(VW * (1 - x), 0));
        return;
      case "cube": {
        // cubo girando: cada cara se achica hacia la arista (perspectiva falsa)
        const edge = VW * (1 - x);
        this.layer(this.config.sourceA, "A", A, () => {
          c.translate(0, VH * 0.06 * x);
          c.scale(Math.max(0.001, 1 - x), 1 - 0.12 * x);
        });
        c.fillStyle = `rgba(0,0,0,${0.5 * x})`;
        c.fillRect(0, 0, edge, VH);
        this.layer(this.config.sourceB, "B", B, () => {
          c.translate(edge, VH * 0.06 * (1 - x));
          c.scale(Math.max(0.001, x), 1 - 0.12 * (1 - x));
        });
        c.fillStyle = `rgba(0,0,0,${0.5 * (1 - x)})`;
        c.fillRect(edge, 0, VW - edge, VH);
        return;
      }
      case "zoom":
        this.layer(this.config.sourceA, "A", A, () => {
          const s = 1 + x * 0.6;
          c.translate(VW / 2, VH / 2);
          c.scale(s, s);
          c.translate(-VW / 2, -VH / 2);
          c.globalAlpha = 1 - x;
        });
        this.layer(this.config.sourceB, "B", B, () => {
          const s = 0.6 + x * 0.4;
          c.translate(VW / 2, VH / 2);
          c.scale(s, s);
          c.translate(-VW / 2, -VH / 2);
          c.globalAlpha = x;
        });
        return;
      case "blur": {
        const px = Math.round(Math.sin(Math.PI * x) * 24);
        c.filter = px ? `blur(${px}px)` : "none";
        a();
        c.globalAlpha = x;
        b();
        c.globalAlpha = 1;
        c.filter = "none";
        return;
      }
    }
  }

  private drawTexts() {
    const c = this.ctx;
    const t = (performance.now() - this.t0) / 1000;
    for (const o of this.texts) {
      if (!o.on || !o.text.trim()) continue;
      c.save();
      c.font = `700 ${Math.round(o.size)}px system-ui, sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      let x = o.x * VW;
      const y = o.y * VH;
      if (o.anim === "scroll") {
        const w = c.measureText(o.text).width + VW;
        x = VW - ((t * 160) % w) + c.measureText(o.text).width / 2;
      }
      if (o.anim === "pulse") {
        const s = 1 + 0.06 * Math.sin(t * 4);
        c.translate(x, y);
        c.scale(s, s);
        c.translate(-x, -y);
      }
      if (o.anim === "fade") c.globalAlpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 1.5));
      c.lineWidth = Math.max(3, o.size / 10);
      c.strokeStyle = "rgba(0,0,0,0.75)";
      c.strokeText(o.text, x, y);
      c.fillStyle = o.color;
      c.fillText(o.text, x, y);
      c.restore();
    }
  }

  private drawImage() {
    const o = this.imageOverlay;
    const img = this.image;
    if (!o.on || !img?.complete || !img.naturalWidth) return;
    const w = o.w * VW;
    const h = (w * img.naturalHeight) / img.naturalWidth;
    this.ctx.globalAlpha = o.opacity;
    this.ctx.drawImage(img, o.x * VW - w / 2, o.y * VH - h / 2, w, h);
    this.ctx.globalAlpha = 1;
  }

  private drawKaraoke(input: FrameInput) {
    const k = input.karaoke;
    if (!k.deck) return;
    const f = input[k.deck];
    const c = this.ctx;
    if (k.cdg) {
      if (k.cdg.seek(f.position)) {
        const img = k.cdg.render();
        if (img) this.cdgCanvas.getContext("2d")!.putImageData(img, 0, 0);
      }
      c.imageSmoothingEnabled = false;
      const s = Math.min(VW / CDG_W, VH / CDG_H);
      c.drawImage(this.cdgCanvas, (VW - CDG_W * s) / 2, (VH - CDG_H * s) / 2, CDG_W * s, CDG_H * s);
      c.imageSmoothingEnabled = true;
    } else if (k.lrc?.length) {
      const i = lrcIndexAt(k.lrc, f.position);
      const cur = k.lrc[i];
      const next = k.lrc[i + 1];
      c.fillStyle = "rgba(0,0,0,0.55)";
      c.fillRect(0, VH * 0.7, VW, VH * 0.3);
      c.textAlign = "center";
      c.textBaseline = "middle";
      if (cur?.text) {
        c.font = "800 54px system-ui, sans-serif";
        const w = c.measureText(cur.text).width;
        const x0 = VW / 2 - w / 2;
        const p = lrcProgress(k.lrc, i, f.position);
        c.fillStyle = "#ffffff";
        c.fillText(cur.text, VW / 2, VH * 0.79);
        // lo ya cantado en otro color
        c.save();
        c.beginPath();
        c.rect(x0, VH * 0.72, w * p, VH * 0.14);
        c.clip();
        c.fillStyle = "#f5c542";
        c.fillText(cur.text, VW / 2, VH * 0.79);
        c.restore();
      } else if (next) {
        const left = next.t - f.position;
        if (left < 6) {
          c.fillStyle = "#f5c542";
          c.font = "700 40px system-ui, sans-serif";
          c.fillText("● ".repeat(Math.max(1, Math.ceil(left))).trim(), VW / 2, VH * 0.79);
        }
      }
      if (next?.text) {
        c.fillStyle = "#a8a8a8";
        c.font = "600 36px system-ui, sans-serif";
        c.fillText(next.text, VW / 2, VH * 0.91);
      }
    }
    if (k.singer) {
      c.textAlign = "left";
      c.fillStyle = "#f5c542";
      c.font = "700 30px system-ui, sans-serif";
      c.fillText(`🎤 ${k.singer}`, 32, 44);
    }
  }

  /** Avance de la mezcla 0 (A) … 1 (B). */
  mixAmount(crossfader: number): number {
    return Math.max(0, Math.min(1, this.config.followCrossfader ? crossfader : this.config.fader));
  }

  private frame() {
    const input = this.getInput?.();
    if (!input) return;
    this.syncDeck("A", input.A);
    this.syncDeck("B", input.B);
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.fillStyle = "#000";
    c.fillRect(0, 0, VW, VH);
    this.mixLayers(this.mixAmount(input.crossfader), input);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.filter = "none";
    this.drawKaraoke(input);
    this.drawImage();
    this.drawTexts();
  }
}
