// Karaoke: letras .lrc (con tiempos por línea y, si vienen, por palabra) y
// gráficos .cdg (CD+G, 300 paquetes por segundo). Sin dependencias.

export interface LrcWord {
  t: number;
  text: string;
}

export interface LrcLine {
  t: number;
  text: string;
  /** tiempos por palabra (formato "enhanced": <mm:ss.xx>) */
  words?: LrcWord[];
}

const TIME = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

function toSec(m: string, s: string, f?: string): number {
  const frac = f ? Number(f) / 10 ** f.length : 0;
  return Number(m) * 60 + Number(s) + frac;
}

/** Lee un .lrc. Respeta [offset:±ms]. Devuelve las líneas ordenadas. */
export function parseLrc(text: string): LrcLine[] {
  let offset = 0;
  const out: LrcLine[] = [];
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const off = raw.match(/^\[offset:\s*([+-]?\d+)\s*\]/i);
    if (off) {
      offset = Number(off[1]) / 1000;
      continue;
    }
    const times: number[] = [];
    let rest = raw;
    TIME.lastIndex = 0;
    let m: RegExpExecArray | null;
    let last = 0;
    while ((m = TIME.exec(raw)) && m.index === last) {
      times.push(toSec(m[1], m[2], m[3]));
      last = TIME.lastIndex;
    }
    if (!times.length) continue;
    rest = raw.slice(last);
    const words: LrcWord[] = [];
    const wordRe = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>([^<]*)/g;
    let w: RegExpExecArray | null;
    while ((w = wordRe.exec(rest))) words.push({ t: toSec(w[1], w[2], w[3]), text: w[4] });
    const plain = rest.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, "").trim();
    for (const t of times) {
      out.push({
        t: Math.max(0, t - offset),
        text: plain,
        words: words.length ? words.map((x) => ({ t: Math.max(0, x.t - offset), text: x.text })) : undefined,
      });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Índice de la línea que se canta en `t` (-1 antes de la primera). */
export function lrcIndexAt(lines: LrcLine[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Cuánto de la línea ya se cantó (0..1), para pintar el avance. */
export function lrcProgress(lines: LrcLine[], i: number, t: number): number {
  const line = lines[i];
  if (!line) return 0;
  if (line.words?.length) {
    const total = line.words.reduce((n, w) => n + w.text.length, 0) || 1;
    let done = 0;
    for (let k = 0; k < line.words.length; k++) {
      const w = line.words[k];
      const end = line.words[k + 1]?.t ?? lines[i + 1]?.t ?? w.t + 1;
      if (t >= end) done += w.text.length;
      else if (t >= w.t) done += w.text.length * ((t - w.t) / Math.max(0.05, end - w.t));
    }
    return Math.min(1, done / total);
  }
  const end = lines[i + 1]?.t ?? line.t + 4;
  return Math.max(0, Math.min(1, (t - line.t) / Math.max(0.2, end - line.t)));
}

// ── CD+G ─────────────────────────────────────────────────────────────

export const CDG_W = 300;
export const CDG_H = 216;
const PACKET = 24;
const PPS = 300; // paquetes por segundo

/** Decodificador CD+G: avanza paquete a paquete hasta el tiempo pedido. */
export class CdgPlayer {
  private data: Uint8Array;
  private pos = 0;
  private pixels = new Uint8Array(CDG_W * CDG_H);
  private palette = new Uint32Array(16);
  readonly image: ImageData | null;

  constructor(data: Uint8Array) {
    this.data = data;
    this.image = typeof ImageData !== "undefined" ? new ImageData(CDG_W, CDG_H) : null;
  }

  get duration(): number {
    return this.data.length / PACKET / PPS;
  }

  private reset() {
    this.pos = 0;
    this.pixels.fill(0);
    this.palette.fill(0);
  }

  /** Procesa hasta `t` segundos. Devuelve true si cambió algo. */
  seek(t: number): boolean {
    const target = Math.min(Math.floor(t * PPS), this.data.length / PACKET) | 0;
    if (target < this.pos) this.reset();
    let changed = false;
    for (; this.pos < target; this.pos++) changed = this.packet(this.pos * PACKET) || changed;
    return changed;
  }

  private packet(o: number): boolean {
    const d = this.data;
    if ((d[o] & 0x3f) !== 0x09) return false;
    const inst = d[o + 1] & 0x3f;
    const b = o + 4;
    switch (inst) {
      case 1: // MEMORY_PRESET
        if ((d[b + 1] & 0x0f) === 0) this.pixels.fill(d[b] & 0x0f);
        return true;
      case 2: {
        // BORDER_PRESET
        const c = d[b] & 0x0f;
        for (let y = 0; y < CDG_H; y++) {
          for (let x = 0; x < CDG_W; x++) {
            if (x < 6 || x >= CDG_W - 6 || y < 12 || y >= CDG_H - 12) this.pixels[y * CDG_W + x] = c;
          }
        }
        return true;
      }
      case 6:
      case 38: {
        // TILE_BLOCK (normal / XOR)
        const c0 = d[b] & 0x0f;
        const c1 = d[b + 1] & 0x0f;
        const row = d[b + 2] & 0x1f;
        const col = d[b + 3] & 0x3f;
        if (row >= 18 || col >= 50) return false;
        for (let y = 0; y < 12; y++) {
          const bits = d[b + 4 + y] & 0x3f;
          for (let x = 0; x < 6; x++) {
            const on = (bits >> (5 - x)) & 1;
            const i = (row * 12 + y) * CDG_W + col * 6 + x;
            if (inst === 6) this.pixels[i] = on ? c1 : c0;
            else this.pixels[i] ^= on ? c1 : c0;
          }
        }
        return true;
      }
      case 30:
      case 31: {
        // LOAD_COLOR_TABLE (0-7 / 8-15)
        const base = inst === 30 ? 0 : 8;
        for (let k = 0; k < 8; k++) {
          const hi = d[b + k * 2] & 0x3f;
          const lo = d[b + k * 2 + 1] & 0x3f;
          const r = ((hi >> 2) & 0x0f) * 17;
          const g = (((hi & 3) << 2) | ((lo >> 4) & 3)) * 17;
          const bl = (lo & 0x0f) * 17;
          this.palette[base + k] = (255 << 24) | (bl << 16) | (g << 8) | r; // RGBA en little endian
        }
        return true;
      }
    }
    return false;
  }

  /** Índice de color de un pixel (para tests). */
  pixelAt(x: number, y: number): number {
    return this.pixels[y * CDG_W + x];
  }

  /** Vuelca los pixeles a `image` (RGBA). */
  render(): ImageData | null {
    if (!this.image) return null;
    const out = new Uint32Array(this.image.data.buffer);
    for (let i = 0; i < this.pixels.length; i++) out[i] = this.palette[this.pixels[i]];
    return this.image;
  }
}

/** Cantante en la lista de turnos. */
export interface Singer {
  id: string;
  name: string;
  trackId: string | null;
  /** semitonos de transposición para este cantante */
  key: number;
}
