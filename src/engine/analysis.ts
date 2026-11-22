// Análisis local de pistas: BPM, primer beat y tonalidad.
// Corre en un worker (analysis.worker.ts) sobre audio mono a 22.05 kHz, así la
// UI no se bloquea al importar. Todo es DSP propio, sin servicios externos.

/**
 * Versión del algoritmo. Sube cuando el análisis mejora: las pistas
 * analizadas con una versión anterior se vuelven a analizar al cargarlas.
 * 2 = ataques de graves + desempate de períodos (antes 128 salía como 85).
 */
export const ANALYSIS_VERSION = 2;

export interface TrackAnalysis {
  bpm: number;
  bpmConfidence: number;
  firstBeat: number;
  keyName: string;
  camelot: string;
  keyConfidence: number;
  /** versión del algoritmo que lo calculó (sin valor = versión 1) */
  version?: number;
  /** el DJ corrigió la rejilla a mano: no se reanaliza */
  edited?: boolean;
}

export interface BpmEstimate {
  bpm: number;
  confidence: number;
  firstBeat: number;
}

const MIN_BPM = 70;
const MAX_BPM = 180;

/**
 * Estima el tempo por autocorrelación del envelope de ataques.
 * Envelope: RMS por ventanas de 10 ms. Ataques: diferencia positiva de la
 * energía logarítmica. La correlación se combina con sus múltiplos (2x, 3x, 4x)
 * para no quedarse con el medio tempo.
 */
export function detectBpm(samples: Float32Array, sampleRate: number): BpmEstimate {
  const hop = Math.max(1, Math.round(sampleRate * 0.01));
  const frame = hop * 2;
  const frames = Math.floor((samples.length - frame) / hop);
  if (frames < 200) return { bpm: 0, confidence: 0, firstBeat: 0 };

  // Dos envolventes: banda completa y graves (< 150 Hz). En música de baile
  // el bombo marca el beat; los hi-hats en corcheas hacen que 1,5 beats
  // "parezca" un período (128 detectado como 85). Los graves lo desempatan.
  const lowSamples = new Float32Array(samples.length);
  const aLow = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate);
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    y1 += aLow * (samples[i] - y1);
    y2 += aLow * (y1 - y2);
    lowSamples[i] = y2;
  }

  // log = cambio relativo de energía (banda completa); lineal = cambio
  // absoluto (graves: así un ataque débil no pesa como un bombo)
  const onsetOf = (src: Float32Array, log = true): Float32Array => {
    const energy = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      const start = i * hop;
      let sum = 0;
      for (let j = start; j < start + frame; j++) sum += src[j] * src[j];
      energy[i] = Math.sqrt(sum / frame);
    }
    const o = new Float32Array(frames);
    for (let i = 1; i < frames; i++) {
      const d = log ? Math.log(1e-7 + energy[i]) - Math.log(1e-7 + energy[i - 1]) : energy[i] - energy[i - 1];
      o[i] = d > 0 ? d : 0;
    }
    // normaliza para que el tempo no dependa del nivel de la pista
    let mean = 0;
    for (let i = 0; i < frames; i++) mean += o[i];
    mean /= frames;
    let variance = 0;
    for (let i = 0; i < frames; i++) {
      const d = o[i] - mean;
      variance += d * d;
    }
    const std = Math.sqrt(variance / frames) || 1;
    for (let i = 0; i < frames; i++) o[i] = (o[i] - mean) / std;
    return o;
  };

  const full = onsetOf(samples);
  const low = onsetOf(lowSamples, false);
  const raw = new Float32Array(frames);
  for (let i = 0; i < frames; i++) raw[i] = full[i] + 2 * low[i];
  // Suavizado (±2 cuadros): un ataque dura un cuadro de 10 ms y, cuando el
  // período no es un número entero de cuadros (128 BPM = 46,9), los beats
  // caen alternados en 46 y 47 y la autocorrelación no los alinea.
  const kernel = [0.25, 0.6, 1, 0.6, 0.25];
  const smooth = (src: Float32Array) => {
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) s += (src[i + k] ?? 0) * kernel[k + 2];
      out[i] = s;
    }
    return out;
  };
  const onset = smooth(raw);
  /** solo graves: decide entre períodos emparentados (el bombo marca el beat) */
  const lowOnset = smooth(low);

  const fps = sampleRate / hop;
  const minLag = Math.max(2, Math.floor((fps * 60) / MAX_BPM));
  const maxLag = Math.min(frames - 2, Math.ceil((fps * 60) / MIN_BPM));
  if (maxLag <= minLag) return { bpm: 0, confidence: 0, firstBeat: 0 };

  const scores = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = lag; i < frames; i++) sum += onset[i] * onset[i - lag];
    let comb = sum;
    for (let m = 2; m <= 4; m++) {
      const l = lag * m;
      if (l >= frames) break;
      let sm = 0;
      for (let i = l; i < frames; i++) sm += onset[i] * onset[i - l];
      comb += sm / (m * 1.5);
    }
    scores[lag] = comb / (frames - lag);
  }

  let bestLag = minLag;
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    if (scores[lag] > scores[bestLag]) bestLag = lag;
  }

  // interpolación parabólica para afinar el período
  let lagRef = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const a = scores[bestLag - 1];
    const b = scores[bestLag];
    const c = scores[bestLag + 1];
    const den = a - 2 * b + c;
    if (Math.abs(den) > 1e-9) lagRef = bestLag + (0.5 * (a - c)) / den;
  }

  const sorted = Array.from(scores.slice(minLag, maxLag + 1)).sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)] || 1e-9;
  const confidence = Math.max(0, Math.min(1, (scores[bestLag] - median) / (Math.abs(scores[bestLag]) + 1e-9)));

  const period0 = lagRef;

  // refinamiento: busca el período y la fase que mejor pisan los ataques en
  // toda la pista (no solo la correlación local)
  const evaluate = (period: number, env: Float32Array = onset): { score: number; phase: number } => {
    let best = -Infinity;
    let bestPhase = 0;
    for (let phase = 0; phase < period; phase += 0.5) {
      let sum = 0;
      let count = 0;
      for (let t = phase; t < frames; t += period) {
        const idx = Math.round(t);
        const v = Math.max(env[idx - 1] ?? 0, env[idx] ?? 0, env[idx + 1] ?? 0);
        sum += Math.max(0, v);
        count++;
      }
      const score = count ? sum / count : 0;
      if (score > best) {
        best = score;
        bestPhase = phase;
      }
    }
    return { score: best, phase: bestPhase };
  };

  /** afina un período candidato (±1,5 cuadros) contra todos los ataques */
  const refine = (p0: number) => {
    let period = p0;
    let phase = 0;
    let score = -Infinity;
    for (let p = p0 - 1.5; p <= p0 + 1.5; p += 0.02) {
      const ev = evaluate(p);
      if (ev.score > score) {
        score = ev.score;
        period = p;
        phase = ev.phase;
      }
    }
    return { period, phase };
  };

  // Desempate entre períodos emparentados (×2/3, ×3/2, ×½, ×2): gana el que
  // mejor pisa los bombos. Un período equivocado cae en bombo solo una de
  // cada dos o tres veces. El candidato original gana los empates (5 %).
  let { period: bestPeriod, phase: bestPhase } = refine(period0);
  let bestLow = evaluate(bestPeriod, lowOnset).score;
  for (const f of [2 / 3, 3 / 2, 1 / 2, 2]) {
    const c = period0 * f;
    if (c < minLag || c > maxLag) continue;
    const r = refine(c);
    const lowScore = evaluate(r.period, lowOnset).score;
    if (lowScore > bestLow * 1.05) {
      bestLow = lowScore;
      bestPeriod = r.period;
      bestPhase = r.phase;
    }
  }

  let period = bestPeriod;
  let bpm = (fps * 60) / period;
  // la regla del doble mira los graves: hi-hats en corcheas no la disparan
  const sampleOnset = (t: number) => {
    const i = Math.round(t);
    return Math.max(lowOnset[i - 1] ?? 0, lowOnset[i] ?? 0, lowOnset[i + 1] ?? 0);
  };

  // corrección de octava: si entre los beats hay un pulso tan fuerte como en
  // los beats, el tempo real es el doble (ej. 87 detectado en una pista de 174)
  if (bpm < 100 && bpm * 2 <= 185) {
    let gridSum = 0;
    let midSum = 0;
    let hits = 0;
    for (let t = bestPhase; t + period / 2 < frames; t += period) {
      gridSum += Math.max(0, sampleOnset(t));
      midSum += Math.max(0, sampleOnset(t + period / 2));
      hits++;
    }
    if (hits > 8 && midSum > gridSum * 0.6) {
      period /= 2;
      bpm = (fps * 60) / period;
    }
  }

  const firstBeat = (bestPhase % period) / fps;

  return {
    bpm: Math.round(bpm * 10) / 10,
    confidence,
    firstBeat: Math.round(firstBeat * 1000) / 1000,
  };
}

// ── tonalidad ────────────────────────────────────────────────────────────────

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MAJOR_CAMELOT = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"];
const MINOR_CAMELOT = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"];

// perfiles de Krumhansl-Kessler
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(a: number[], b: number[]): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den > 0 ? num / den : 0;
}

/** FFT radix-2 iterativa in-place sobre arrays real/imaginario. */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      const half = len / 2;
      for (let k = 0; k < half; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + half] * cr - im[i + k + half] * ci;
        const vi = re[i + k + half] * ci + im[i + k + half] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + half] = ur - vr;
        im[i + k + half] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export interface KeyEstimate {
  keyName: string;
  camelot: string;
  confidence: number;
}

/**
 * Croma por FFT + correlación con los perfiles mayor/menor de Krumhansl.
 * Analiza como máximo 45 s desde el 10 % de la pista (evita intros y outro).
 */
export function detectKey(samples: Float32Array, sampleRate: number): KeyEstimate {
  const N = 4096;
  const hop = N / 2;
  const start = Math.floor(samples.length * 0.1);
  const maxLen = Math.floor(sampleRate * 45);
  const end = Math.min(samples.length, start + maxLen);
  if (end - start < N) return { keyName: "", camelot: "", confidence: 0 };

  const window = new Float32Array(N);
  for (let i = 0; i < N; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));

  const chroma = new Float64Array(12);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const binHz = sampleRate / N;
  const minBin = Math.max(2, Math.floor(65 / binHz));
  const maxBin = Math.min(N / 2 - 1, Math.ceil(2000 / binHz));

  for (let pos = start; pos + N <= end; pos += hop) {
    let energy = 0;
    for (let i = 0; i < N; i++) {
      const v = samples[pos + i];
      energy += v * v;
      re[i] = v * window[i];
      im[i] = 0;
    }
    if (Math.sqrt(energy / N) < 1e-4) continue;
    fft(re, im);
    for (let k = minBin; k <= maxBin; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      if (mag < 1e-6) continue;
      const freq = k * binHz;
      const midi = 69 + 12 * Math.log2(freq / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += mag;
    }
  }

  const total = chroma.reduce((a, b) => a + b, 0);
  if (total <= 0) return { keyName: "", camelot: "", confidence: 0 };
  const chromaArr = Array.from(chroma, (v) => v / total);

  let best = { score: -Infinity, tonic: 0, major: true };
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotate = (profile: number[]) => profile.map((_, i) => profile[(i - tonic + 12) % 12]);
    const majorScore = correlate(chromaArr, rotate(MAJOR_PROFILE));
    const minorScore = correlate(chromaArr, rotate(MINOR_PROFILE));
    if (majorScore > best.score) best = { score: majorScore, tonic, major: true };
    if (minorScore > best.score) best = { score: minorScore, tonic, major: false };
  }

  const keyName = `${NOTE_NAMES[best.tonic]} ${best.major ? "maj" : "min"}`;
  const camelot = best.major ? MAJOR_CAMELOT[best.tonic] : MINOR_CAMELOT[best.tonic];
  return { keyName, camelot, confidence: Math.max(0, Math.min(1, best.score)) };
}

export function analyzeTrack(samples: Float32Array, sampleRate: number): TrackAnalysis {
  const bpm = detectBpm(samples, sampleRate);
  const key = detectKey(samples, sampleRate);
  return {
    bpm: bpm.bpm,
    bpmConfidence: bpm.confidence,
    firstBeat: bpm.firstBeat,
    keyName: key.keyName,
    camelot: key.camelot,
    keyConfidence: key.confidence,
    version: ANALYSIS_VERSION,
  };
}
