// Timecode propio de BROSS DJ para DVS (vinilos o CDs de control).
//
// Señal estéreo en cuadratura: L = A·sin θ, R = A·cos θ con θ = 2π·2000·t.
// - Velocidad y sentido: cómo gira θ (atan2(L, R)); funciona a cualquier
//   velocidad y hacia atrás.
// - Posición absoluta: cada ciclo de la portadora lleva un bit en su
//   amplitud (1 = 100 %, 0 = 65 %). Los bits salen de un LFSR de 20 bits
//   (período de 1 048 575 ciclos ≈ 8 min 44 s): 20 bits seguidos alcanzan
//   para saber exactamente en qué ciclo está la púa.
//
// Es un formato propio (no lee vinilos de timecode comerciales). Se graba en
// un vinilo o CD a partir del WAV que genera la app.

export const TC_FREQ = 2000;
export const TC_BITS = 20;
const MASK = (1 << TC_BITS) - 1;
export const TC_PERIOD = MASK; // 2^20 - 1 ciclos
export const TC_LOW = 0.65;

/** Paso del LFSR (taps 20 y 17: período máximo). */
export function lfsrNext(s: number): number {
  const fb = (s ^ (s >> 3)) & 1;
  return (s >>> 1) | (fb << (TC_BITS - 1));
}

let table: Int32Array | null = null;

/** estado (últimos 20 bits) → número de ciclo */
export function tcTable(): Int32Array {
  if (table) return table;
  const t = new Int32Array(1 << TC_BITS).fill(-1);
  let s = 1;
  for (let n = 0; n < TC_PERIOD; n++) {
    t[s] = n;
    s = lfsrNext(s);
  }
  table = t;
  return t;
}

/** Bit que lleva cada ciclo (bit 0 del estado del LFSR en ese ciclo). */
export function tcBits(cycles: number): Uint8Array {
  const out = new Uint8Array(cycles);
  let s = 1;
  for (let n = 0; n < cycles; n++) {
    out[n] = s & 1;
    s = lfsrNext(s);
  }
  return out;
}

/** Genera `seconds` de timecode (estéreo, Float32). */
export function generateTimecode(seconds: number, sampleRate: number, level = 0.8): [Float32Array, Float32Array] {
  const n = Math.round(Math.min(seconds, TC_PERIOD / TC_FREQ) * sampleRate);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const bits = tcBits(Math.ceil((n / sampleRate) * TC_FREQ) + 1);
  const w = (2 * Math.PI * TC_FREQ) / sampleRate;
  for (let i = 0; i < n; i++) {
    const th = w * i;
    const cycle = Math.floor((i * TC_FREQ) / sampleRate);
    const a = level * (bits[cycle] ? 1 : TC_LOW);
    L[i] = a * Math.sin(th);
    R[i] = a * Math.cos(th);
  }
  return [L, R];
}

export interface TcReading {
  /** velocidad del plato (1 = normal, negativa = atrás) */
  speed: number;
  /** posición absoluta en segundos (null hasta que se lee el código) */
  position: number | null;
  /** 0..1: qué tan bien se está leyendo la señal */
  quality: number;
  /** nivel de la señal (amplitud media) */
  level: number;
}

/**
 * Decodificador: se alimenta con bloques de muestras y devuelve velocidad,
 * posición y calidad. Corre igual en el hilo de audio o en un test.
 */
export class TimecodeDecoder {
  private readonly sr: number;
  private theta = 0;
  private lastRaw = 0;
  private started = false;
  private cycle = 0;
  private ampSum = 0;
  private ampN = 0;
  /** picos y valles de amplitud por ciclo (el umbral queda en el medio) */
  private hi = 0;
  private lo = Infinity;
  private reg = 0;
  private regLen = 0;
  private regDir = 0;
  private lockedCycle: number | null = null;
  private good = 0;
  private total = 0;
  private speedSm = 0;
  private levelSm = 0;
  /** ganancia de entrada (calibración) */
  gain = 1;
  /** invertir izquierda/derecha (cables al revés) */
  swap = false;

  constructor(sampleRate: number) {
    this.sr = sampleRate;
    tcTable();
  }

  private pushBit(bit: number, dir: number) {
    if (dir !== this.regDir) {
      this.reg = 0;
      this.regLen = 0;
      this.regDir = dir;
    }
    if (dir > 0) this.reg = (this.reg >>> 1) | (bit << (TC_BITS - 1));
    else this.reg = ((this.reg << 1) & MASK) | bit;
    if (this.regLen < TC_BITS) this.regLen++;
    if (this.regLen < TC_BITS) return;
    const idx = tcTable()[this.reg];
    this.total++;
    if (idx < 0) {
      this.lockedCycle = null;
      return;
    }
    const at = dir > 0 ? idx + TC_BITS - 1 : idx;
    // se confirma cuando el ciclo leído coincide con el esperado
    if (this.lockedCycle != null && Math.abs(at - this.lockedCycle) <= 1) this.good++;
    this.lockedCycle = at;
    this.cycle = at;
  }

  /** Procesa un bloque. `L` y `R` del mismo largo. */
  process(L: Float32Array, R: Float32Array): TcReading {
    const n = L.length;
    let dTheta = 0;
    let levelAcc = 0;
    for (let i = 0; i < n; i++) {
      const l = (this.swap ? R[i] : L[i]) * this.gain;
      const r = (this.swap ? L[i] : R[i]) * this.gain;
      const amp = Math.hypot(l, r);
      levelAcc += amp;
      const raw = Math.atan2(l, r);
      if (!this.started) {
        this.started = true;
        this.lastRaw = raw;
        continue;
      }
      let d = raw - this.lastRaw;
      if (d > Math.PI) d -= 2 * Math.PI;
      else if (d < -Math.PI) d += 2 * Math.PI;
      this.lastRaw = raw;
      // sin señal: no se integra ruido
      if (amp < 0.02) continue;
      dTheta += d;
      const before = Math.floor(this.theta / (2 * Math.PI));
      this.theta += d;
      const after = Math.floor(this.theta / (2 * Math.PI));
      this.ampSum += amp;
      this.ampN++;
      if (after !== before) {
        // terminó un ciclo: su amplitud media es el bit
        const a = this.ampSum / Math.max(1, this.ampN);
        this.ampSum = 0;
        this.ampN = 0;
        // umbral adaptativo: sigue al pico y al valle, que se olvidan despacio
        this.hi = a > this.hi ? a : this.hi + (a - this.hi) * 0.003;
        this.lo = a < this.lo ? a : this.lo + (a - this.lo) * 0.003;
        const bit = this.hi - this.lo > 0.08 * this.hi && a > (this.hi + this.lo) / 2 ? 1 : 0;
        const dir = after > before ? 1 : -1;
        if (this.lockedCycle != null) this.cycle += dir;
        this.pushBit(bit, dir);
      }
    }
    const level = levelAcc / Math.max(1, n);
    this.levelSm += (level - this.levelSm) * 0.2;
    const speed = level < 0.02 ? 0 : dTheta / (2 * Math.PI) / ((n / this.sr) * TC_FREQ);
    // suavizado corto: estable sin retrasar el scratch
    this.speedSm += (speed - this.speedSm) * 0.5;
    if (Math.abs(this.speedSm) < 0.002) this.speedSm = 0;
    const frac = (((this.theta / (2 * Math.PI)) % 1) + 1) % 1;
    const position = this.lockedCycle != null && this.regLen >= TC_BITS ? (this.cycle + frac) / TC_FREQ : null;
    const quality = this.total ? Math.min(1, this.good / this.total) : 0;
    // la calidad se mide sobre una ventana que se va renovando
    if (this.total > 400) {
      this.total *= 0.5;
      this.good *= 0.5;
    }
    return { speed: this.speedSm, position, quality, level: this.levelSm };
  }
}
