// Cálculo de la onda (picos y bandas) y del mono para el análisis.
// Corre dentro del worker: recorrer millones de muestras en el hilo
// principal trababa la UI cada vez que se cargaba una pista.

export interface BandPeaks {
  low: number[];
  mid: number[];
  high: number[];
}

export const PEAK_BUCKETS = 1400;
export const ANALYSIS_RATE = 22050;

export function computePeaks(ch: Float32Array): number[] {
  const size = Math.max(1, Math.floor(ch.length / PEAK_BUCKETS));
  const peaks: number[] = new Array(PEAK_BUCKETS).fill(0);
  for (let i = 0; i < PEAK_BUCKETS; i++) {
    let max = 0;
    const start = i * size;
    const end = Math.min(start + size, ch.length);
    for (let j = start; j < end; j += 4) {
      const v = Math.abs(ch[j]);
      if (v > max) max = v;
    }
    peaks[i] = Math.min(1, max);
  }
  let top = 0.001;
  for (const p of peaks) if (p > top) top = p;
  return peaks.map((p) => Math.min(1, p / top));
}

/**
 * Energía por banda para pintar el waveform por frecuencia.
 * Filtros de un polo (lowpass 200 Hz y 4 kHz): low = LP200,
 * mid = LP4k - LP200, high = señal - LP4k.
 */
export function computeBands(ch: Float32Array, sr: number): BandPeaks {
  const size = Math.max(1, Math.floor(ch.length / PEAK_BUCKETS));
  const low = new Array(PEAK_BUCKETS).fill(0);
  const mid = new Array(PEAK_BUCKETS).fill(0);
  const high = new Array(PEAK_BUCKETS).fill(0);
  const aLow = 1 - Math.exp((-2 * Math.PI * 200) / sr);
  const aMid = 1 - Math.exp((-2 * Math.PI * 4000) / sr);
  let yLow = 0;
  let yMid = 0;
  let sumLow = 0;
  let sumMid = 0;
  let sumHigh = 0;
  let bucket = 0;
  let count = 0;
  for (let i = 0; i < ch.length; i++) {
    const x = ch[i];
    yLow += aLow * (x - yLow);
    yMid += aMid * (x - yMid);
    const l = yLow;
    const m = yMid - yLow;
    const h = x - yMid;
    sumLow += l * l;
    sumMid += m * m;
    sumHigh += h * h;
    if (++count === size) {
      if (bucket < PEAK_BUCKETS) {
        low[bucket] = Math.sqrt(sumLow / count);
        mid[bucket] = Math.sqrt(sumMid / count);
        high[bucket] = Math.sqrt(sumHigh / count);
      }
      sumLow = sumMid = sumHigh = 0;
      count = 0;
      bucket++;
    }
  }
  if (count > 0 && bucket < PEAK_BUCKETS) {
    low[bucket] = Math.sqrt(sumLow / count);
    mid[bucket] = Math.sqrt(sumMid / count);
    high[bucket] = Math.sqrt(sumHigh / count);
  }
  // normalización global: la banda con más energía manda
  let top = 1e-6;
  for (const arr of [low, mid, high]) for (const v of arr) if (v > top) top = v;
  return {
    low: low.map((v) => Math.min(1, v / top)),
    mid: mid.map((v) => Math.min(1, v / top)),
    high: high.map((v) => Math.min(1, v / top)),
  };
}

/** Baja a la tasa de análisis promediando bloques. */
export function downsample(ch: Float32Array, sr: number, target = ANALYSIS_RATE): Float32Array {
  const ratio = sr / target;
  if (ratio <= 1.0001) return ch;
  const outLen = Math.max(1, Math.floor(ch.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(ch.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += ch[j];
    out[i] = sum / (end - start);
  }
  return out;
}

/** Onda detallada para la vista con zoom: puntos por segundo de pista. */
export const DETAIL_RATE = 150;

export interface WaveDetail {
  /** puntos por segundo */
  rate: number;
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
}

/**
 * Energía por banda a `DETAIL_RATE` puntos por segundo (mismo filtrado que
 * computeBands). La normalización es global para que el color indique qué
 * banda domina en cada momento.
 */
export function computeDetail(ch: Float32Array, sr: number, rate = DETAIL_RATE): WaveDetail {
  const size = Math.max(1, Math.round(sr / rate));
  const n = Math.ceil(ch.length / size);
  const low = new Float32Array(n);
  const mid = new Float32Array(n);
  const high = new Float32Array(n);
  const aLow = 1 - Math.exp((-2 * Math.PI * 200) / sr);
  const aMid = 1 - Math.exp((-2 * Math.PI * 4000) / sr);
  let yLow = 0;
  let yMid = 0;
  let top = 1e-6;
  for (let b = 0; b < n; b++) {
    const start = b * size;
    const end = Math.min(ch.length, start + size);
    let sl = 0;
    let sm = 0;
    let sh = 0;
    for (let i = start; i < end; i++) {
      const x = ch[i];
      yLow += aLow * (x - yLow);
      yMid += aMid * (x - yMid);
      const l = yLow;
      const m = yMid - yLow;
      const h = x - yMid;
      sl += l * l;
      sm += m * m;
      sh += h * h;
    }
    const c = Math.max(1, end - start);
    low[b] = Math.sqrt(sl / c);
    mid[b] = Math.sqrt(sm / c);
    high[b] = Math.sqrt(sh / c);
    if (low[b] > top) top = low[b];
    if (mid[b] > top) top = mid[b];
    if (high[b] > top) top = high[b];
  }
  // un poco de compresión visual: los pasajes suaves también se ven
  for (const arr of [low, mid, high]) {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.min(1, Math.pow(arr[i] / top, 0.8));
  }
  return { rate: sr / size, low, mid, high };
}
