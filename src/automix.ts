// Planificación del automix: dónde empieza y termina el sonido real de cada
// tema y en qué punto conviene salir y entrar (alineado a frases).
// Funciones puras: se testean sin audio.

import type { WaveDetail } from "./engine/waveform";

export interface Bounds {
  /** primer momento con sonido (s) */
  start: number;
  /** último momento con sonido (s) */
  end: number;
}

/**
 * Bordes audibles a partir de la onda detallada: se ignora el silencio (o
 * casi silencio) del principio y del final del tema.
 */
export function audibleBounds(detail: WaveDetail | null, duration: number, threshold = 0.05): Bounds {
  if (!detail || detail.low.length === 0) return { start: 0, end: duration };
  const n = detail.low.length;
  const level = (i: number) => Math.max(detail.low[i], detail.mid[i], detail.high[i]);
  // ventana de ~100 ms para que un click suelto no cuente como música
  const win = Math.max(1, Math.round(detail.rate * 0.1));
  // el punto tiene que sonar y la ventana que sigue (o la que termina ahí)
  // también: así un click suelto no cuenta y el borde no se adelanta
  const avg = (from: number) => {
    let sum = 0;
    let c = 0;
    for (let k = 0; k < win && from + k < n; k++, c++) sum += level(from + k);
    return c ? sum / c : 0;
  };
  let first = 0;
  while (first < n && !(level(first) > threshold && avg(first) > threshold)) first++;
  let last = n - 1;
  while (last > first && !(level(last) > threshold && avg(Math.max(0, last - win + 1)) > threshold)) last--;
  if (first >= n) return { start: 0, end: duration };
  return {
    start: Math.min(duration, first / detail.rate),
    end: Math.min(duration, (last + 1) / detail.rate),
  };
}

export interface MixOutInput {
  bounds: Bounds;
  bpm: number | null;
  firstBeat: number;
  /** largo del cruce en beats */
  beats: number;
  /** velocidad actual del deck (para el caso sin BPM) */
  rate: number;
}

/**
 * Momento (tiempo de pista) en que empieza el cruce: el último inicio de
 * frase de 16 beats que deja terminar el cruce antes del final audible.
 */
export function planMixOut({ bounds, bpm, firstBeat, beats, rate }: MixOutInput): number {
  if (!bpm) {
    // sin BPM: ~16 s de cruce (en tiempo de pista) antes del final audible
    return Math.max(bounds.start, bounds.end - 16 * Math.max(0.5, rate));
  }
  const beat = 60 / bpm;
  const mixLen = beats * beat;
  const latest = bounds.end - mixLen;
  const phrase = 16 * beat;
  const aligned = firstBeat + Math.floor((latest - firstBeat) / phrase) * phrase;
  // si la frase alineada queda demasiado temprano (más de una frase antes),
  // se usa el compás más cercano
  if (latest - aligned > phrase * 0.75) {
    const bar = 4 * beat;
    return Math.max(bounds.start, firstBeat + Math.floor((latest - firstBeat) / bar) * bar);
  }
  return Math.max(bounds.start, aligned);
}

/**
 * Punto de entrada del tema nuevo: el beat de la rejilla más cercano al
 * comienzo del sonido. (La rejilla sabe dónde caen los beats, no cuál es el
 * primero del compás: alinear a "compases" adivinados se comería música.)
 */
export function planMixIn(bounds: Bounds, bpm: number | null, firstBeat: number): number {
  if (!bpm) return bounds.start;
  const beat = 60 / bpm;
  const k = Math.round((bounds.start - firstBeat) / beat);
  const t = firstBeat + k * beat;
  // nunca después de que arrancó la música más de 30 ms
  return Math.max(0, t > bounds.start + 0.03 ? t - beat : t);
}

// ── tipos de transición ──────────────────────────────────────────────

export type MixStyle = "blend" | "bassSwap" | "filter" | "echo" | "cut";

export interface StyleInput {
  fromBpm: number | null;
  toBpm: number | null;
  fromKey: string | null;
  toKey: string | null;
  /** segundos de música que le quedan al tema que sale */
  remaining: number;
}

/** ¿Dos claves Camelot combinan? (misma, ±1 o relativa) */
function keysMatch(a: string | null, b: string | null): boolean {
  const pa = a?.match(/^(\d{1,2})([AB])$/i);
  const pb = b?.match(/^(\d{1,2})([AB])$/i);
  if (!pa || !pb) return true; // sin datos no se castiga
  const na = Number(pa[1]);
  const nb = Number(pb[1]);
  const la = pa[2].toUpperCase();
  const lb = pb[2].toUpperCase();
  if (la === lb) return [0, 1, 11].includes((((na - nb) % 12) + 12) % 12);
  return na === nb;
}

/**
 * Transición "inteligente": elige según lo que tienen las pistas.
 * - BPM que no se pueden sincronizar (o sin BPM) → salida con eco
 * - poco tema por delante → corte al beat
 * - tonalidades que chocan → barrido de filtro (tapa el choque armónico)
 * - todo compatible → cambio de bajos (el cruce largo clásico)
 */
export function chooseStyle({ fromBpm, toBpm, fromKey, toKey, remaining }: StyleInput): MixStyle {
  if (!fromBpm || !toBpm) return "echo";
  const ratio = toBpm / fromBpm;
  const near = [1, 0.5, 2].some((k) => Math.abs(ratio * k - 1) <= 0.08);
  if (!near) return "echo";
  if (remaining < 8) return "cut";
  if (!keysMatch(fromKey, toKey)) return "filter";
  return "bassSwap";
}

/** Largo del cruce en beats según el estilo (el eco y el corte son cortos). */
export function styleBeats(style: MixStyle, beats: number): number {
  if (style === "cut") return Math.min(beats, 4);
  if (style === "echo") return Math.min(beats, 8);
  return beats;
}

export interface MixFrame {
  /** avance del crossfader 0..1 (hacia el deck que entra) */
  x: number;
  /** EQ de graves: 0 = cortado, 0.5 = normal */
  fromLow: number;
  toLow: number;
  /** filtro: 0.5 = neutro, < 0.5 paso bajo, > 0.5 paso alto */
  fromFilter: number;
  toFilter: number;
  /** eco encendido en el que sale */
  fromEcho: boolean;
}

/** Estado de la mezcla en el punto `p` (0..1) del cruce. */
export function mixFrame(style: MixStyle, p: number): MixFrame {
  const q = Math.max(0, Math.min(1, p));
  const base: MixFrame = { x: q, fromLow: 0.5, toLow: 0.5, fromFilter: 0.5, toFilter: 0.5, fromEcho: false };
  switch (style) {
    case "blend":
      return base;
    case "bassSwap":
      // entra sin graves; a mitad de camino se cambian
      return { ...base, fromLow: q < 0.5 ? 0.5 : 0, toLow: q < 0.5 ? 0 : 0.5 };
    case "filter":
      // el que sale se va abriendo a paso alto; el que entra viene de paso bajo
      return {
        ...base,
        fromFilter: 0.5 + 0.42 * q,
        toFilter: Math.min(0.5, 0.08 + 0.42 * Math.min(1, q / 0.7)),
        fromLow: q < 0.5 ? 0.5 : 0,
      };
    case "echo":
      // eco desde un tercio y salto del crossfader al final del eco
      return { ...base, x: q < 0.5 ? q * 0.3 : q < 0.6 ? 0.15 + (q - 0.5) * 8.5 : 1, fromEcho: q >= 0.35 };
    case "cut":
      return { ...base, x: q < 0.5 ? 0 : 1 };
  }
}
