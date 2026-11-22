// Utilidades para armar audio y archivos de prueba.

export const SR = 44100;

/** Seno puro (más un armónico suave) de `seconds` segundos. */
export function sine(freq: number, seconds: number, sr = SR): Float32Array {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] = 0.4 * Math.sin(2 * Math.PI * freq * t) + 0.08 * Math.sin(2 * Math.PI * freq * 2 * t);
  }
  return out;
}

/** Bombo + clicks a un BPM dado (para detectar tempo). */
export function beat(bpm: number, seconds: number, sr = SR, offset = 0): Float32Array {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  const period = 60 / bpm;
  for (let i = 0; i < n; i++) {
    const t = i / sr - offset;
    if (t < 0) continue;
    const tb = t % period;
    if (tb < 0.15) {
      const e = Math.exp(-tb * 30);
      out[i] += Math.sin(2 * Math.PI * (55 + 90 * e) * tb) * e * 0.8;
    }
    const th = t % (period / 2);
    if (th < 0.02) out[i] += (Math.random() * 2 - 1) * 0.2 * (1 - th / 0.02);
  }
  return out;
}

/** Frecuencia dominante por cruces por cero (alcanza para tonos puros). */
export function zeroCrossFreq(x: Float32Array, sr = SR): number {
  let crossings = 0;
  let first = -1;
  let last = -1;
  for (let i = 1; i < x.length; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      if (first < 0) first = i;
      last = i;
      crossings++;
    }
  }
  if (crossings < 2) return 0;
  return ((crossings - 1) * sr) / (last - first);
}

/** RMS de una señal. */
export function rms(x: Float32Array): number {
  let s = 0;
  for (const v of x) s += v * v;
  return Math.sqrt(s / Math.max(1, x.length));
}

export const enc = (s: string) => new TextEncoder().encode(s);

export function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const arrs = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

export function u32be(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

export function u32le(n: number): number[] {
  return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
}

export function ab(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}
