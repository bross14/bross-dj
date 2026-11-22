// Procesadores de audio que corren en el hilo de audio (AudioWorklet).
// Nada de lo que pase en la UI (cargar una pista, dibujar la onda, React)
// puede trabar este código.

import { TimecodeDecoder } from "../timecode";

export {};

declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: unknown): void;

export type DeckMsg =
  | { type: "buffer"; channels: Float32Array[] }
  | { type: "clear" }
  | { type: "start"; pos: number; rate: number; seq: number }
  | { type: "rate"; rate: number; tau: number; seq: number }
  | { type: "follow"; pos: number; seq: number }
  | { type: "seek"; pos: number; seq: number }
  | { type: "stop"; seq: number }
  | { type: "keylock"; on: boolean; pitch: number }
  | { type: "loop"; start: number | null; end: number | null };

export interface DeckReport {
  pos: number;
  rate: number;
  t: number;
  active: boolean;
  ended: boolean;
  /** último comando procesado (los reportes viejos se descartan) */
  seq: number;
}

/**
 * Reproductor del deck. Una sola copia del PCM, todo en el hilo de audio:
 *
 * - Varispeed (key-lock apagado, scratch, reverse, break): lee la pista a
 *   cualquier velocidad, incluso hacia atrás, con interpolación cúbica.
 * - Key-lock (WSOLA): arma tramos de 50 ms y, para
 *   cada uno, busca en ±10 ms el punto que mejor empalma con el final del
 *   tramo anterior antes de solaparlos. Así cambia el tempo sin cambiar el
 *   tono (y transpone para el key-sync) sin el "chirrido" de un shifter
 *   granular.
 */
class DeckProcessor extends AudioWorkletProcessor {
  private ch: Float32Array[] = [];
  private len = 0;
  /** posición de lectura en frames */
  private pos = 0;
  /** velocidad: segundos de pista por segundo (negativa = hacia atrás) */
  private rate = 0;
  private targetRate = 0;
  private rateCoef = 1;
  private mode: "rate" | "follow" = "rate";
  private followTarget = 0;
  private active = false;
  private ended = false;
  private seq = 0;
  /** fade de arranque/parada y fade de cambio de motor (varispeed ↔ WSOLA) */
  private gain = 0;
  private gainTarget = 0;
  private xf = 1;
  private xfTarget = 1;
  private readonly fadeStep = 1 / (sampleRate * 0.005);
  private keylock = false;
  private pitch = 1;
  private loopStart = -1;
  private loopEnd = -1;
  private engine: 0 | 1 = 0;
  private wanted: 0 | 1 = 0;
  // WSOLA
  private readonly N = Math.round(sampleRate * 0.05);
  private readonly O = Math.round(sampleRate * 0.012);
  private readonly S = Math.round(sampleRate * 0.01);
  private readonly frameL = new Float32Array(this.N);
  private readonly frameR = new Float32Array(this.N);
  private readonly tailL = new Float32Array(this.O);
  private readonly tailR = new Float32Array(this.O);
  private readonly tailM = new Float32Array(this.O);
  private hasTail = false;
  private readonly outL = new Float32Array(this.N);
  private readonly outR = new Float32Array(this.N);
  private outIdx = 0;
  private outLen = 0;
  /** posición musical del primer sample del tramo que está sonando */
  private outBase = 0;
  private outRate = 0;
  private quanta = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<DeckMsg>) => this.onMessage(e.data);
  }

  private onMessage(m: DeckMsg) {
    if ("seq" in m) this.seq = m.seq;
    switch (m.type) {
      case "buffer":
        this.ch = m.channels;
        this.len = m.channels[0]?.length ?? 0;
        this.pos = 0;
        this.active = false;
        this.gain = 0;
        this.ended = false;
        this.resetStretch();
        break;
      case "clear":
        this.ch = [];
        this.len = 0;
        this.active = false;
        this.gain = 0;
        break;
      case "start":
        this.pos = m.pos * sampleRate;
        this.rate = m.rate;
        this.targetRate = m.rate;
        this.rateCoef = 1;
        this.mode = "rate";
        this.active = true;
        this.ended = false;
        this.gain = 0;
        this.gainTarget = 1;
        this.resetStretch();
        break;
      case "rate":
        this.mode = "rate";
        this.targetRate = m.rate;
        this.rateCoef = m.tau > 0 ? 1 - Math.exp(-1 / (m.tau * sampleRate)) : 1;
        break;
      case "follow":
        this.mode = "follow";
        this.followTarget = m.pos * sampleRate;
        if (!this.active) {
          this.active = true;
          this.gain = 0;
          this.gainTarget = 1;
          this.rate = 0;
        }
        break;
      case "seek":
        this.pos = m.pos * sampleRate;
        this.ended = false;
        if (this.mode === "follow") this.followTarget = this.pos;
        this.resetStretch();
        // micro-fade para que el salto no haga click
        this.xf = 0;
        break;
      case "stop":
        this.gainTarget = 0;
        break;
      case "keylock":
        this.keylock = m.on;
        this.pitch = Math.max(0.5, Math.min(2, m.pitch));
        break;
      case "loop":
        this.loopStart = m.start == null ? -1 : m.start * sampleRate;
        this.loopEnd = m.end == null ? -1 : m.end * sampleRate;
        break;
    }
  }

  /** WSOLA arranca de nuevo desde `pos` (sin empalme con lo anterior). */
  private resetStretch() {
    this.hasTail = false;
    this.outIdx = 0;
    this.outLen = 0;
  }

  private readAt(c: Float32Array, p: number): number {
    const i = Math.floor(p);
    if (i < 1 || i >= this.len - 2) return i >= 0 && i < this.len ? c[i] : 0;
    const f = p - i;
    const y0 = c[i - 1];
    const y1 = c[i];
    const y2 = c[i + 1];
    const y3 = c[i + 2];
    // Catmull-Rom: más limpio que la interpolación lineal al cambiar la velocidad
    return y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)));
  }

  private loopActive(): boolean {
    return this.loopEnd > this.loopStart && this.loopStart >= 0;
  }

  /** Arma el próximo tramo WSOLA a partir de `pos` y avanza `pos` según el tempo. */
  private nextFrame() {
    const { N, O, S } = this;
    const hop = N - O;
    const p = this.pitch;
    const cL = this.ch[0];
    const cR = this.ch[1] ?? cL;
    const A = this.pos;
    let F = A;
    if (this.hasTail) {
      // el desplazamiento que mejor continúa el final del tramo anterior
      let best = -Infinity;
      let bestD = 0;
      for (let d = -S; d <= S; d += 2) {
        const start = A + d;
        if (start < 0 || start + O * p >= this.len - 2) continue;
        let xy = 0;
        let yy = 0;
        for (let k = 0; k < O; k += 4) {
          const idx = Math.floor(start + k * p);
          const y = cL[idx] + cR[idx];
          xy += this.tailM[k] * y;
          yy += y * y;
        }
        const score = xy / Math.sqrt(yy + 1e-9);
        if (score > best) {
          best = score;
          bestD = d;
        }
      }
      F = A + bestD;
    }
    for (let k = 0; k < N; k++) {
      const sp = F + k * p;
      this.frameL[k] = this.readAt(cL, sp);
      this.frameR[k] = this.readAt(cR, sp);
    }
    // salida = solape (ventana coseno) + tramo; el final queda para el próximo
    for (let k = 0; k < hop; k++) {
      if (k < O && this.hasTail) {
        const w = 0.5 - 0.5 * Math.cos((Math.PI * (k + 0.5)) / O);
        this.outL[k] = this.tailL[k] * (1 - w) + this.frameL[k] * w;
        this.outR[k] = this.tailR[k] * (1 - w) + this.frameR[k] * w;
      } else {
        this.outL[k] = this.frameL[k];
        this.outR[k] = this.frameR[k];
      }
    }
    for (let k = 0; k < O; k++) {
      this.tailL[k] = this.frameL[hop + k];
      this.tailR[k] = this.frameR[hop + k];
      this.tailM[k] = this.tailL[k] + this.tailR[k];
    }
    this.hasTail = true;
    this.outIdx = 0;
    this.outLen = hop;
    this.outBase = A;
    this.outRate = this.rate;
    this.pos = A + hop * this.rate;
    // el tramo siguiente arranca al inicio del loop y se solapa con este final
    if (this.loopActive() && this.pos >= this.loopEnd && A < this.loopEnd) {
      this.pos -= this.loopEnd - this.loopStart;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] ?? out[0];
    if (!this.active || this.len === 0) {
      L.fill(0);
      R.fill(0);
      return true;
    }
    const cL = this.ch[0];
    const cR = this.ch[1] ?? cL;
    const last = this.len - 1;

    // ¿qué motor corresponde? WSOLA solo en marcha estable con key-lock
    this.wanted =
      this.keylock && this.mode === "rate" && this.rate > 0.3 && Math.abs(this.rate - this.targetRate) < 0.15 ? 1 : 0;
    if (this.wanted !== this.engine) this.xfTarget = 0;

    const followCoef = 1 - Math.exp(-1 / (0.008 * sampleRate));
    let posOut = this.pos;
    for (let i = 0; i < L.length; i++) {
      if (this.mode === "follow") {
        const err = (this.followTarget - this.pos) / sampleRate;
        const desired = Math.max(-12, Math.min(12, err / 0.025));
        this.rate += (desired - this.rate) * followCoef;
      } else {
        this.rate += (this.targetRate - this.rate) * this.rateCoef;
      }
      if (this.gain < this.gainTarget) this.gain = Math.min(this.gainTarget, this.gain + this.fadeStep);
      else if (this.gain > this.gainTarget) this.gain = Math.max(this.gainTarget, this.gain - this.fadeStep);
      if (this.xf < this.xfTarget) this.xf = Math.min(this.xfTarget, this.xf + this.fadeStep);
      else if (this.xf > this.xfTarget) this.xf = Math.max(this.xfTarget, this.xf - this.fadeStep);
      // cambio de motor en silencio (fade de 5 ms)
      if (this.xf === 0 && this.wanted !== this.engine) {
        if (this.engine === 1) this.pos = this.outBase + this.outIdx * this.outRate;
        this.engine = this.wanted;
        this.resetStretch();
        this.xfTarget = 1;
      } else if (this.xf === 0 && this.xfTarget === 0 && this.wanted === this.engine) {
        this.xfTarget = 1;
      }

      let l: number;
      let r: number;
      if (this.engine === 1) {
        if (this.outIdx >= this.outLen) this.nextFrame();
        l = this.outL[this.outIdx];
        r = this.outR[this.outIdx];
        posOut = this.outBase + this.outIdx * this.outRate;
        this.outIdx++;
        if (posOut >= last) {
          this.ended = !this.loopActive();
        }
      } else {
        l = this.readAt(cL, this.pos);
        r = this.readAt(cR, this.pos);
        this.pos += this.rate;
        if (this.loopActive() && this.rate > 0 && this.pos >= this.loopEnd && this.pos - this.rate < this.loopEnd) {
          this.pos -= this.loopEnd - this.loopStart;
        }
        if (this.pos < 0) {
          this.pos = 0;
          if (this.rate < 0) this.rate = 0;
        } else if (this.pos > last) {
          this.pos = last;
          if (this.rate > 0) {
            this.rate = 0;
            if (this.mode === "rate") this.ended = true;
          }
        }
        posOut = this.pos;
      }
      const g = this.gain * this.xf;
      L[i] = l * g;
      R[i] = r * g;
      if (this.ended && this.gainTarget !== 0) this.gainTarget = 0;
    }
    if (this.gainTarget === 0 && this.gain === 0) this.active = false;
    if (++this.quanta % 4 === 0 || !this.active) {
      const report: DeckReport = {
        pos: Math.max(0, Math.min(last, posOut)) / sampleRate,
        rate: this.active ? (this.engine === 1 ? this.outRate : this.rate) : 0,
        t: currentTime + L.length / sampleRate,
        active: this.active,
        ended: this.ended,
        seq: this.seq,
      };
      this.port.postMessage(report);
    }
    return true;
  }
}

/**
 * Grabador: convierte la salida master a PCM 16 bits intercalado y la manda
 * en bloques de ~250 ms al hilo principal (que la escribe a disco).
 */
class RecorderProcessor extends AudioWorkletProcessor {
  private readonly frames = Math.round(sampleRate * 0.25);
  private buf = new Int16Array(this.frames * 2);
  private n = 0;
  private on = true;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<{ type: string }>) => {
      if (e.data.type === "stop") {
        this.flush();
        this.on = false;
        this.port.postMessage({ type: "done" });
      }
    };
  }

  private flush() {
    if (this.n === 0) return;
    const out = this.buf.slice(0, this.n * 2);
    this.port.postMessage({ type: "chunk", data: out }, [out.buffer]);
    this.n = 0;
  }

  process(inputs: Float32Array[][]): boolean {
    if (!this.on) return false;
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const L = input[0];
    const R = input[1] ?? input[0];
    for (let i = 0; i < L.length; i++) {
      const l = Math.max(-1, Math.min(1, L[i]));
      const r = Math.max(-1, Math.min(1, R[i]));
      this.buf[this.n * 2] = l < 0 ? l * 0x8000 : l * 0x7fff;
      this.buf[this.n * 2 + 1] = r < 0 ? r * 0x8000 : r * 0x7fff;
      if (++this.n === this.frames) this.flush();
    }
    return true;
  }
}

/**
 * DVS: lee el timecode propio de la entrada (vinilo o CD) y manda velocidad,
 * posición y calidad cada 2 bloques (~6 ms) al hilo principal.
 */
class DvsProcessor extends AudioWorkletProcessor {
  private dec = new TimecodeDecoder(sampleRate);
  private blocks = 0;

  constructor() {
    super();
    this.dec.gain = 1;
    this.port.onmessage = (e: MessageEvent<{ type: string; gain?: number; swap?: boolean }>) => {
      if (e.data.type === "config") {
        if (typeof e.data.gain === "number") this.dec.gain = e.data.gain;
        if (typeof e.data.swap === "boolean") this.dec.swap = e.data.swap;
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const L = input[0];
    const R = input[1] ?? input[0];
    const r = this.dec.process(L, R);
    if (++this.blocks % 2 === 0) this.port.postMessage(r);
    return true;
  }
}

registerProcessor("bross-deck", DeckProcessor);
registerProcessor("bross-dvs", DvsProcessor);
registerProcessor("bross-recorder", RecorderProcessor);
