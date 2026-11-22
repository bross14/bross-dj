// PCM de una pista en memoria. Los temas comunes se decodifican con
// decodeAudioData (AudioBuffer en float); las mezclas largas se decodifican
// por partes directo a 16 bits (Int16Pcm) para no quedarse sin memoria.

/** PCM en 16 bits, un Int16Array por canal, a la frecuencia del motor. */
export class Int16Pcm {
  constructor(
    readonly channels: Int16Array[],
    readonly sampleRate: number,
  ) {}

  get length(): number {
    return this.channels[0]?.length ?? 0;
  }

  get numberOfChannels(): number {
    return this.channels.length;
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }
}

export type TrackPcm = AudioBuffer | Int16Pcm;

/** Desde esta duración la onda y el análisis se calculan sobre una versión reducida. */
const LONG_SECONDS = 20 * 60;
/** frecuencia máxima de la señal que va al worker para pistas largas */
const JOB_MAX_RATE = 24000;
/** muestras por tramo al convertir (para no crear arrays temporales enormes) */
const BLOCK = 1 << 16;

/** float (-1..1) → 16 bits, recortando. */
export function floatToInt16(src: Float32Array, dst: Int16Array = new Int16Array(src.length), offset = 0): Int16Array {
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    dst[offset + i] = v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767);
  }
  return dst;
}

/**
 * Canales para el reproductor del deck (como mucho dos). `keep`: el PCM de
 * origen se sigue usando después (pistas importadas a mano), así que se copia;
 * si no, los Int16Array de un Int16Pcm se pasan tal cual (se transfieren).
 */
export function deckChannels(pcm: TrackPcm, keep: boolean): Int16Array[] {
  const n = Math.min(2, pcm.numberOfChannels);
  const out: Int16Array[] = [];
  for (let c = 0; c < n; c++) {
    if (pcm instanceof Int16Pcm) {
      out.push(keep ? pcm.channels[c].slice() : pcm.channels[c]);
      continue;
    }
    const dst = new Int16Array(pcm.length);
    const tmp = new Float32Array(Math.min(BLOCK, pcm.length));
    for (let start = 0; start < pcm.length; start += BLOCK) {
      const len = Math.min(BLOCK, pcm.length - start);
      const view = len === tmp.length ? tmp : tmp.subarray(0, len);
      pcm.copyFromChannel(view, c, start);
      floatToInt16(view, dst, start);
    }
    out.push(dst);
  }
  return out;
}

/**
 * Un canal en float para el worker de onda/análisis (copia propia, se
 * transfiere). En pistas largas se promedia de a bloques para bajar la
 * frecuencia a ≤ 24 kHz: un cuarto o la mitad de memoria.
 */
export function jobSamples(pcm: TrackPcm): { samples: Float32Array; sampleRate: number } {
  const rate = pcm.sampleRate;
  const long = pcm instanceof Int16Pcm || pcm.duration > LONG_SECONDS;
  const step = long ? Math.max(1, Math.ceil(rate / JOB_MAX_RATE)) : 1;
  if (step === 1 && !(pcm instanceof Int16Pcm)) {
    return { samples: pcm.getChannelData(0).slice(), sampleRate: rate };
  }
  const outLen = Math.floor(pcm.length / step);
  const out = new Float32Array(outLen);
  if (pcm instanceof Int16Pcm) {
    const src = pcm.channels[0];
    const scale = 1 / (32768 * step);
    for (let o = 0, i = 0; o < outLen; o++) {
      let acc = 0;
      for (let k = 0; k < step; k++) acc += src[i++];
      out[o] = acc * scale;
    }
  } else {
    const src = pcm.getChannelData(0);
    for (let o = 0, i = 0; o < outLen; o++) {
      let acc = 0;
      for (let k = 0; k < step; k++) acc += src[i++];
      out[o] = acc / step;
    }
  }
  return { samples: out, sampleRate: rate / step };
}
