// Decodificación por partes de MP3 largos (mezclas de una o más horas).
//
// decodeAudioData entrega todo el tema en float a la frecuencia del motor:
// una mezcla de 2 horas son ~2,7 GB, y con las copias para el deck y la onda
// la ventana se queda sin memoria. Acá se separan los frames del MP3, se
// decodifican con WebCodecs (AudioDecoder) de a poco y cada bloque se
// remuestrea y se guarda directo en el formato final (16 bits para el deck,
// float mono para el análisis). Nunca hay más que unos pocos bloques en float.

import { Int16Pcm } from "./pcm";

/** Desde esta duración estimada un MP3 se decodifica por partes. */
export const STREAM_MIN_SECONDS = 20 * 60;

const BITRATES: Record<string, number[]> = {
  // MPEG-1 capa III / MPEG-2 y 2.5 capa III (kbps, índice 1..14)
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

interface FrameHeader {
  length: number;
  sampleRate: number;
  channels: number;
  samples: number;
}

/** Cabecera de un frame MPEG capa III en `i`, o null si no hay una válida. */
function header(b: Uint8Array, i: number): FrameHeader | null {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[i + 1] >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  const layer = (b[i + 1] >> 1) & 3; // 1 = capa III
  if (version === 1 || layer !== 1) return null;
  const brIdx = (b[i + 2] >> 4) & 15;
  const srIdx = (b[i + 2] >> 2) & 3;
  if (brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
  const pad = (b[i + 2] >> 1) & 1;
  const kbps = (version === 3 ? BITRATES.v1 : BITRATES.v2)[brIdx];
  const sampleRate = RATES[version][srIdx];
  const samples = version === 3 ? 1152 : 576;
  const length = Math.floor(((samples / 8) * kbps * 1000) / sampleRate) + pad;
  const channels = ((b[i + 3] >> 6) & 3) === 3 ? 1 : 2;
  return length > 4 ? { length, sampleRate, channels, samples } : null;
}

/** Salta la etiqueta ID3v2 del principio (si la hay). */
function audioStart(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
  return 10 + size + (b[5] & 0x10 ? 10 : 0);
}

/** Primer frame válido a partir de `from` (dos frames seguidos, para no confundir datos con una cabecera). */
function sync(b: Uint8Array, from: number, limit = 1 << 16): number {
  const end = Math.min(b.length - 4, from + limit);
  for (let i = from; i < end; i++) {
    const h = header(b, i);
    if (h && header(b, i + h.length)) return i;
  }
  return -1;
}

export interface Mp3Layout {
  sampleRate: number;
  channels: number;
  samplesPerFrame: number;
  /** inicio y largo de cada frame */
  offsets: Uint32Array;
  lengths: Uint16Array;
  count: number;
}

/** Recorre el archivo y anota dónde está cada frame. null si no parece un MP3 capa III. */
export function scanMp3(bytes: Uint8Array): Mp3Layout | null {
  let i = sync(bytes, audioStart(bytes));
  if (i < 0) return null;
  const first = header(bytes, i)!;
  let cap = Math.ceil(bytes.length / Math.max(24, first.length * 0.5)) + 16;
  let offsets = new Uint32Array(cap);
  let lengths = new Uint16Array(cap);
  let count = 0;
  while (i < bytes.length) {
    const h = header(bytes, i);
    if (!h || h.sampleRate !== first.sampleRate || i + h.length > bytes.length) {
      // basura en el medio (o la etiqueta ID3v1 del final): buscar el próximo frame
      const next = sync(bytes, i + 1);
      if (next < 0) break;
      i = next;
      continue;
    }
    if (count === cap) {
      cap *= 2;
      const o = new Uint32Array(cap);
      o.set(offsets);
      offsets = o;
      const l = new Uint16Array(cap);
      l.set(lengths);
      lengths = l;
    }
    offsets[count] = i;
    lengths[count] = h.length;
    count++;
    i += h.length;
  }
  if (count < 2) return null;
  return { sampleRate: first.sampleRate, channels: first.channels, samplesPerFrame: first.samples, offsets, lengths, count };
}

/** Duración aproximada mirando solo el principio (bitrate del primer frame). */
export function estimateMp3Seconds(bytes: Uint8Array): number | null {
  const i = sync(bytes, audioStart(bytes));
  if (i < 0) return null;
  const h = header(bytes, i)!;
  const kbps = ((h.length - 1) * h.sampleRate * 8) / (h.samples * 1000);
  return ((bytes.length - i) * 8) / (kbps * 1000);
}

export function isLongMp3(bytes: Uint8Array): boolean {
  if (typeof AudioDecoder === "undefined") return false;
  const s = estimateMp3Seconds(bytes);
  return s != null && s >= STREAM_MIN_SECONDS;
}

interface Sink {
  /** recibe un bloque de muestras ya remuestreadas, canal por canal */
  write(chs: Float32Array[], n: number): void;
}

/**
 * Remuestreo continuo (Catmull-Rom) entre bloques que llegan de a poco.
 * Con la misma frecuencia de entrada y salida copia directo.
 */
class Resampler {
  private readonly step: number;
  private hist: Float32Array[];
  /** índice global (en muestras de entrada) del primer elemento de `hist` */
  private histStart = -3;
  private nextOut = 0;
  private readonly tmp: Float32Array[];

  constructor(
    inRate: number,
    outRate: number,
    private readonly chans: number,
    private readonly sink: Sink,
  ) {
    this.step = inRate / outRate;
    this.hist = Array.from({ length: chans }, () => new Float32Array(3));
    this.tmp = Array.from({ length: chans }, () => new Float32Array(8192));
  }

  push(block: Float32Array[], n: number) {
    if (this.step === 1) {
      this.sink.write(block, n);
      return;
    }
    // ventana = 3 muestras anteriores + bloque nuevo
    const work = block.map((b, c) => {
      const w = new Float32Array(3 + n);
      w.set(this.hist[c]);
      w.set(b.subarray(0, n), 3);
      return w;
    });
    const base = this.histStart;
    const last = base + work[0].length - 1;
    let outN = 0;
    for (;;) {
      const x = this.nextOut * this.step;
      const i = Math.floor(x);
      if (i + 2 > last) break;
      const f = x - i;
      const k = i - base;
      for (let c = 0; c < this.chans; c++) {
        const w = work[c];
        const y0 = k - 1 >= 0 ? w[k - 1] : w[k];
        const y1 = w[k];
        const y2 = w[k + 1];
        const y3 = w[k + 2];
        this.tmp[c][outN] = y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)));
      }
      outN++;
      this.nextOut++;
      if (outN === this.tmp[0].length) {
        this.sink.write(this.tmp, outN);
        outN = 0;
      }
    }
    if (outN) this.sink.write(this.tmp, outN);
    for (let c = 0; c < this.chans; c++) this.hist[c] = work[c].slice(work[c].length - 3);
    this.histStart = base + work[0].length - 3;
  }

  /** las últimas muestras (necesitan dos de más para interpolar) */
  end() {
    if (this.step === 1) return;
    const pad = Array.from({ length: this.chans }, () => new Float32Array(3));
    this.push(pad, 3);
  }
}

export interface StreamOptions {
  /** frecuencia de salida (la del motor, o la de análisis) */
  sampleRate: number;
  /** true: un solo canal (promedio) en float, para el análisis */
  mono?: boolean;
}

/** Decodifica un MP3 por partes. Para el deck: Int16Pcm estéreo a `sampleRate`. */
export async function decodeMp3Stream(data: ArrayBuffer, opts: StreamOptions & { mono?: false }): Promise<Int16Pcm>;
/** Para el análisis: un canal en float a `sampleRate`. */
export async function decodeMp3Stream(data: ArrayBuffer, opts: StreamOptions & { mono: true }): Promise<Float32Array>;
export async function decodeMp3Stream(data: ArrayBuffer, opts: StreamOptions): Promise<Int16Pcm | Float32Array> {
  const bytes = new Uint8Array(data);
  const layout = scanMp3(bytes);
  if (!layout) throw new Error("No es un MP3 que se pueda leer por partes");
  const inRate = layout.sampleRate;
  const outRate = opts.sampleRate;
  const outCh = opts.mono ? 1 : Math.min(2, layout.channels);
  const totalIn = layout.count * layout.samplesPerFrame;
  const cap = Math.ceil((totalIn * outRate) / inRate) + 8;

  const i16 = opts.mono ? null : Array.from({ length: outCh }, () => new Int16Array(cap));
  const f32 = opts.mono ? new Float32Array(cap) : null;
  let written = 0;
  const sink: Sink = {
    write(chs, n) {
      n = Math.min(n, cap - written);
      if (f32) {
        f32.set(chs[0].subarray(0, n), written);
      } else {
        for (let c = 0; c < outCh; c++) {
          const src = chs[c];
          const dst = i16![c];
          for (let k = 0; k < n; k++) {
            const v = src[k];
            dst[written + k] = v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767);
          }
        }
      }
      written += n;
    },
  };
  const resampler = new Resampler(inRate, outRate, outCh, sink);

  let failure: unknown = null;
  let planes: Float32Array[] = [];
  const decoder = new AudioDecoder({
    output: (frame) => {
      try {
        const n = frame.numberOfFrames;
        const srcCh = frame.numberOfChannels;
        if (planes.length !== srcCh || planes[0].length < n) {
          planes = Array.from({ length: srcCh }, () => new Float32Array(Math.max(n, 4608)));
        }
        for (let c = 0; c < srcCh; c++) frame.copyTo(planes[c], { planeIndex: c, format: "f32-planar" });
        let block: Float32Array[];
        if (opts.mono) {
          if (srcCh === 1) block = [planes[0]];
          else {
            const m = new Float32Array(n);
            for (let k = 0; k < n; k++) m[k] = (planes[0][k] + planes[1][k]) * 0.5;
            block = [m];
          }
        } else {
          block = outCh === 1 ? [planes[0]] : [planes[0], planes[srcCh > 1 ? 1 : 0]];
        }
        resampler.push(block, n);
      } catch (e) {
        failure = e;
      } finally {
        frame.close();
      }
    },
    error: (e) => {
      failure = e;
    },
  });
  decoder.configure({ codec: "mp3", sampleRate: inRate, numberOfChannels: layout.channels });

  const usPerFrame = (layout.samplesPerFrame / inRate) * 1e6;
  for (let f = 0; f < layout.count; f++) {
    if (failure) break;
    const off = layout.offsets[f];
    decoder.decode(
      new EncodedAudioChunk({
        type: "key",
        timestamp: Math.round(f * usPerFrame),
        data: bytes.subarray(off, off + layout.lengths[f]),
      }),
    );
    // no encolar más de lo que el decodificador va procesando
    if (decoder.decodeQueueSize > 1024) {
      await new Promise<void>((r) => decoder.addEventListener("dequeue", () => r(), { once: true }));
    }
  }
  if (!failure) await decoder.flush();
  if (decoder.state !== "closed") decoder.close();
  if (failure) throw failure instanceof Error ? failure : new Error(String(failure));
  resampler.end();

  if (f32) return f32.subarray(0, written);
  return new Int16Pcm(
    i16!.map((a) => a.subarray(0, written)),
    outRate,
  );
}
