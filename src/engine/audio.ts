// Motor de audio de BROSS DJ — implementación Web Audio.
// La superficie es la misma que tendrá el motor nativo C++/JUCE
// (loadTrack / play / pause / seek / setGain / setEQ / setCrossfader / analyze).
//
// Hilos:
// - hilo de audio (AudioWorklet): key-lock y "vinilo" (scratch, reverse,
//   break). Nunca se traba por lo que haga la UI.
// - worker: onda, bandas, BPM y tonalidad.
// - hilo principal: solo arma el grafo y mueve parámetros.

import AnalysisWorker from "./analysis.worker?worker&inline";
import workletUrl from "./worklets/processors.ts?worker&url";
import { ANALYSIS_VERSION, type TrackAnalysis } from "./analysis";
import type { WorkerJob, WorkerResult } from "./analysis.worker";
import { ANALYSIS_RATE, type BandPeaks, type WaveDetail } from "./waveform";
import { readTags, type TrackTags } from "./tags";
import { Int16Pcm, deckChannels, jobSamples, type TrackPcm } from "./pcm";
import { decodeMp3Stream, isLongMp3 } from "./mp3stream";
import { buildStems, type StemChain, type StemGains } from "./stems";
import type { DeckMsg, DeckReport } from "./worklets/processors";
import { MeterBallistics, SILENT_METER, measure, type MeterReading } from "./meter";

export type { BandPeaks, WaveDetail };
export type DeckId = "A" | "B";

/** Puntos guardados por pista: cue principal y hot cues. */
export interface TrackPois {
  cuePoint: number;
  cues: (number | null)[];
  /** loops guardados (8 por pista) */
  loops?: (LoopRange | null)[];
}

export interface LoopRange {
  start: number;
  end: number;
}

import { crossfaderGains, type XfCurve } from "./xfCurve";
export type { XfCurve };

export interface LibraryTrack {
  id: string;
  fileName: string;
  title: string;
  artist: string;
  duration: number;
  /** vacío hasta que el worker calcula la onda */
  peaks: number[];
  bands: BandPeaks | null;
  /** null cuando la pista vino de una carpeta y todavía no se cargó */
  buffer: AudioBuffer | null;
  analysis: TrackAnalysis | null;
  /** cue y hot cues guardados de sesiones anteriores */
  pois?: TrackPois;
  /** ruta absoluta en disco (solo app de escritorio) */
  sourcePath?: string;
  /** carpeta que la contiene, para filtrar en el navegador */
  dir?: string;
  album?: string;
  genre?: string;
  year?: string;
  /** BPM y tonalidad escritos en las etiquetas del archivo */
  tagBpm?: number;
  tagKey?: string;
  /** ya se leyeron las etiquetas del archivo */
  tagged?: boolean;
}

/** Aplica las etiquetas leídas; título/artista caen al nombre del archivo. */
export function withTags<T extends { fileName: string }>(base: T, tags: TrackTags): T & {
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  year?: string;
  tagBpm?: number;
  tagKey?: string;
  tagged: boolean;
} {
  const fromName = parseFileName(base.fileName);
  return {
    ...base,
    title: tags.title ?? fromName.title,
    artist: tags.artist ?? fromName.artist,
    album: tags.album,
    genre: tags.genre,
    year: tags.year,
    tagBpm: tags.bpm,
    tagKey: tags.key,
    tagged: true,
  };
}

export type AltMode = "scratch" | "reverse" | "brake" | "resume";

export interface DeckRuntime {
  trackId: string | null;
  loaded: boolean;
  playing: boolean;
  title: string;
  artist: string;
  position: number;
  duration: number;
  peaks: number[];
  bands: BandPeaks | null;
  cuePoint: number;
  /** en pausa justo sobre el cue (LED de CUE fijo) */
  atCue: boolean;
  /** CUE apretado y sonando de prueba */
  cueHeld: boolean;
  cues: (number | null)[];
  level: number;
  /** medidor del canal en dBFS (post-fader) */
  meter: MeterReading;
  bpm: number | null;
  keyName: string | null;
  camelot: string | null;
  firstBeat: number;
  loopBeats: number | null;
  loopStart: number | null;
  loopEnd: number | null;
  /** true mientras se mantiene apretado un pad de ROLL */
  rolling: boolean;
  rollBeats: number | null;
  cue: boolean;
  sandbox: boolean;
  pitch: number;
  range: number;
  /** transposición aplicada por key-sync, en semitonos */
  keyShift: number;
  /** modo de reproducción por el "vinilo" (null = reproducción normal) */
  alt: AltMode | null;
  reverse: boolean;
  braking: boolean;
  /** LOOP IN marcado, esperando LOOP OUT */
  loopIn: number | null;
  /** largo del auto-loop en beats (◀ ▶ sin loop activo) */
  autoLoopBeats: number;
  /** hay un loop anterior para RELOOP */
  canReloop: boolean;
  savedLoops: (LoopRange | null)[];
  slip: boolean;
  /** posición "fantasma" que sigue corriendo con SLIP (null = no hay) */
  slipGhost: number | null;
}

/** Efectos de inserción del deck (además de ECHO / REVERSE / BREAK). */
export interface InsertFxConfig {
  /** período del barrido en beats */
  flanger: { on: boolean; beats: number };
  phaser: { on: boolean; beats: number };
  /** cantidad 0..1 (envío y largo de la cola) */
  reverb: { on: boolean; amount: number };
  /** bits de resolución (2 … 12) */
  crush: { on: boolean; bits: number };
  /** corte rítmico: duración de cada paso en beats */
  gate: { on: boolean; beats: number };
}

export const DEFAULT_INSERT_FX: InsertFxConfig = {
  flanger: { on: false, beats: 4 },
  phaser: { on: false, beats: 2 },
  reverb: { on: false, amount: 0.5 },
  crush: { on: false, bits: 6 },
  gate: { on: false, beats: 0.25 },
};

export interface SampleSlot {
  name: string;
  /** "builtin" = generado por la app; "path" = archivo de la biblioteca */
  kind: "builtin" | "path" | "file";
  path?: string;
  /** recorte en segundos (editor del sampler) */
  start?: number;
  end?: number;
  /** volumen propio 0..2 (1 = igual) */
  gain?: number;
  /** en loop: el pad prende y apaga */
  loop?: boolean;
}

export interface EchoConfig {
  on: boolean;
  /** duración en beats (1/8 … 2) */
  beats: number;
  /** realimentación 0..1 */
  feedback: number;
}

/** tope de la frecuencia del motor (ver cappedContext) */
const MAX_CONTEXT_RATE = 48000;

const EQ_FREQS = { low: 180, mid: 1000, high: 6000 } as const;
/** una vuelta de vinilo a 33⅓ rpm ≈ 1.8 s de pista */
export const SECONDS_PER_TURN = 1.8;

/** Corta un tiempo al rango [0, duration]; valores inválidos caen en 0. */
function clampTime(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.max(0, Math.min(duration, seconds));
}

export function parseFileName(fileName: string): { title: string; artist: string } {
  const base = fileName.replace(/\.[a-z0-9]+$/i, "");
  const m = base.match(/^\s*(.+?)\s+-\s+(.+?)\s*$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: "", title: base.trim() };
}

/** Fase dentro del beat, normalizada a 0..1 (0 = justo sobre el beat). */
function beatPhase(position: number, firstBeat: number, beatLength: number): number {
  if (!Number.isFinite(beatLength) || beatLength <= 0) return 0;
  const phase = (position - firstBeat) / beatLength;
  return ((phase % 1) + 1) % 1;
}

class DeckChannel {
  readonly analyser: AnalyserNode;
  private readonly ctx: AudioContext;
  private readonly eqLow: BiquadFilterNode;
  private readonly eqMid: BiquadFilterNode;
  private readonly eqHigh: BiquadFilterNode;
  /** filtro de 24 dB/oct (dos etapas) + ganancia que cierra del todo en los extremos */
  private readonly filterA: BiquadFilterNode;
  private readonly filterB: BiquadFilterNode;
  private readonly filterKill: GainNode;
  private readonly fxSum: GainNode;
  private readonly echoSend: GainNode;
  private readonly echoDelay: DelayNode;
  private readonly echoTone: BiquadFilterNode;
  private readonly echoFb: GainNode;
  private readonly echoWet: GainNode;
  /** inserción: flanger → phaser → crush → gate; reverb en envío */
  private readonly ins: {
    flIn: GainNode;
    flDry: GainNode;
    flWet: GainNode;
    flDelay: DelayNode;
    flFb: GainNode;
    flLfo: OscillatorNode;
    flDepth: GainNode;
    phDry: GainNode;
    phWet: GainNode;
    phStages: BiquadFilterNode[];
    phLfo: OscillatorNode;
    phDepth: GainNode;
    crDry: GainNode;
    crWet: GainNode;
    crShaper: WaveShaperNode;
    gtGain: GainNode;
    gtLfo: OscillatorNode;
    gtDepth: GainNode;
    rvSend: GainNode;
    rvConv: ConvolverNode;
    rvWet: GainNode;
  };
  insertFx: InsertFxConfig = structuredClone(DEFAULT_INSERT_FX);
  private readonly gain: GainNode;
  private readonly xfade: GainNode;
  private readonly sandboxGain: GainNode;
  private readonly cueGain: GainNode;
  private readonly levelBuf: Float32Array<ArrayBuffer>;
  private cueOn = false;
  private sandboxOn = false;

  /** reproductor en el hilo de audio (worklet "bross-deck"): única copia del PCM */
  private node: AudioWorkletNode | null = null;
  private loaded = false;
  /** PCM que espera a que cargue el módulo del worklet */
  private pending: Int16Array[] | null = null;
  /** último estado informado por el reproductor (o predicho tras un comando) */
  private rep = { pos: 0, rate: 0, t: 0 };
  private seq = 0;
  /** motor del plato encendido (play) */
  private motor = false;
  /** modo especial del plato (null = marcha normal) */
  private mode: AltMode | null = null;
  private scratchBase = 0;
  /** BREAK terminó y dejó el deck parado: apagarlo vuelve a arrancar */
  private brakeStopped = false;
  reverseOn = false;
  /** loops: marca de LOOP IN, último loop (RELOOP), guardados y auto-loop */
  loopInMark: number | null = null;
  lastLoop: LoopRange | null = null;
  savedLoops: (LoopRange | null)[] = Array(8).fill(null);
  autoBeats = 4;
  /** SLIP: la pista sigue corriendo "por debajo" mientras hacés scratch, loop o reverse */
  slip = false;
  private slipAnchor: { pos: number; t: number } | null = null;
  /** CUE apretado en pausa: suena mientras se mantiene */
  cuePreview: { latched: boolean } | null = null;
  echo: EchoConfig = { on: false, beats: 0.5, feedback: 0.45 };

  /** key lock / bloqueo de tono */
  keyLock = false;

  trackId: string | null = null;
  title = "";
  artist = "";
  duration = 0;
  peaks: number[] = [];
  bands: BandPeaks | null = null;
  /** onda detallada (vista con zoom); llega del worker después de cargar */
  detail: WaveDetail | null = null;
  cues: (number | null)[] = Array(8).fill(null);
  cuePoint = 0;
  pitch = 0.5;
  range = 8;
  /** pitch bend temporal del jog (±) */
  private bend = 0;
  loop: { start: number; end: number } | null = null;
  loopBeats: number | null = null;
  /** estado temporal del pad ROLL mientras está apretado */
  private roll: {
    start: number;
    end: number;
    beats: number;
    returnPosition: number;
    startedAt: number;
    previousLoop: { start: number; end: number } | null;
    previousBeats: number | null;
  } | null = null;
  /** transposición de key-sync en semitonos (-5..+6) */
  private keyShift = 0;
  /** separación por filtros: voz, bajo, percusión e instrumentos */
  readonly stems: StemChain;
  /** avisa al motor cuando el deck cambia solo de estado (fin de BREAK) */
  onStateChange: (() => void) | null = null;

  constructor(ctx: AudioContext, out: AudioNode, cueBus: AudioNode, reverbIr: AudioBuffer) {
    this.ctx = ctx;
    this.eqLow = ctx.createBiquadFilter();
    this.eqLow.type = "lowshelf";
    this.eqLow.frequency.value = EQ_FREQS.low;
    this.eqMid = ctx.createBiquadFilter();
    this.eqMid.type = "peaking";
    this.eqMid.frequency.value = EQ_FREQS.mid;
    this.eqMid.Q.value = 0.9;
    this.eqHigh = ctx.createBiquadFilter();
    this.eqHigh.type = "highshelf";
    this.eqHigh.frequency.value = EQ_FREQS.high;
    this.filterA = ctx.createBiquadFilter();
    this.filterB = ctx.createBiquadFilter();
    for (const f of [this.filterA, this.filterB]) {
      f.type = "allpass";
      f.frequency.value = 22000;
      f.Q.value = 0.707;
    }
    this.filterKill = ctx.createGain();
    this.fxSum = ctx.createGain();
    // ECHO por deck: envío → delay realimentado (con un paso bajo en el lazo
    // para que las repeticiones se oscurezcan) → retorno
    this.echoSend = ctx.createGain();
    this.echoSend.gain.value = 0;
    this.echoDelay = ctx.createDelay(4);
    this.echoDelay.delayTime.value = 0.25;
    this.echoTone = ctx.createBiquadFilter();
    this.echoTone.type = "lowpass";
    this.echoTone.frequency.value = 6500;
    this.echoFb = ctx.createGain();
    this.echoFb.gain.value = 0.45;
    this.echoWet = ctx.createGain();
    this.echoWet.gain.value = 0.7;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0.85;
    this.xfade = ctx.createGain();
    this.sandboxGain = ctx.createGain();
    this.sandboxGain.gain.value = 1;
    this.cueGain = ctx.createGain();
    this.cueGain.gain.value = 0; // PFL silencioso hasta que se active CUE
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.levelBuf = new Float32Array(this.analyser.fftSize);

    this.stems = buildStems(ctx);
    this.stems.output.connect(this.eqLow);
    this.ins = this.buildInserts(reverbIr);
    const i = this.ins;
    this.eqLow.connect(this.eqMid).connect(this.eqHigh).connect(this.filterA)
      .connect(this.filterB).connect(this.filterKill).connect(i.flIn);
    // la salida del gate es el final de la cadena de inserción
    i.gtGain.connect(this.fxSum);
    i.gtGain.connect(i.rvSend).connect(i.rvConv).connect(i.rvWet).connect(this.fxSum);
    this.filterKill.connect(this.echoSend).connect(this.echoDelay);
    this.echoDelay.connect(this.echoTone).connect(this.echoFb).connect(this.echoDelay);
    this.echoDelay.connect(this.echoWet).connect(this.fxSum);
    this.fxSum.connect(this.gain).connect(this.xfade).connect(this.sandboxGain).connect(this.analyser);
    this.analyser.connect(out);
    // Toma pre-fader (después de EQ, filtro y FX) para los auriculares.
    this.fxSum.connect(this.cueGain).connect(cueBus);
  }

  /** Arma flanger, phaser, crush, gate y reverb (todos apagados = transparentes). */
  private buildInserts(reverbIr: AudioBuffer) {
    const c = this.ctx;
    const g = (v: number) => {
      const n = c.createGain();
      n.gain.value = v;
      return n;
    };
    // FLANGER: delay corto modulado por un LFO + realimentación
    const flIn = g(1);
    const flDry = g(1);
    const flWet = g(0);
    const flOut = g(1);
    const flDelay = c.createDelay(0.05);
    flDelay.delayTime.value = 0.004;
    const flFb = g(0);
    const flLfo = c.createOscillator();
    flLfo.frequency.value = 0.25;
    const flDepth = g(0.0028);
    flLfo.connect(flDepth).connect(flDelay.delayTime);
    flIn.connect(flDry).connect(flOut);
    flIn.connect(flDelay).connect(flWet).connect(flOut);
    flDelay.connect(flFb).connect(flDelay);
    // PHASER: 4 pasa-todo con la frecuencia barrida por un LFO
    const phDry = g(1);
    const phWet = g(0);
    const phOut = g(1);
    const phStages = Array.from({ length: 4 }, () => {
      const f = c.createBiquadFilter();
      f.type = "allpass";
      f.frequency.value = 900;
      f.Q.value = 0.6;
      return f;
    });
    const phLfo = c.createOscillator();
    phLfo.frequency.value = 0.5;
    const phDepth = g(700);
    phLfo.connect(phDepth);
    for (const f of phStages) phDepth.connect(f.frequency);
    flOut.connect(phDry).connect(phOut);
    flOut.connect(phStages[0]);
    for (let k = 0; k < phStages.length - 1; k++) phStages[k].connect(phStages[k + 1]);
    phStages[phStages.length - 1].connect(phWet).connect(phOut);
    // CRUSH: cuantización con un waveshaper escalonado
    const crDry = g(1);
    const crWet = g(0);
    const crOut = g(1);
    const crShaper = c.createWaveShaper();
    phOut.connect(crDry).connect(crOut);
    phOut.connect(crShaper).connect(crWet).connect(crOut);
    // GATE: ganancia cortada por una onda cuadrada al ritmo
    const gtGain = g(1);
    const gtLfo = c.createOscillator();
    gtLfo.type = "square";
    gtLfo.frequency.value = 4;
    const gtDepth = g(0);
    gtLfo.connect(gtDepth).connect(gtGain.gain);
    crOut.connect(gtGain);
    // REVERB (envío): la cola sigue sonando al apagarlo
    const rvSend = g(0);
    const rvConv = c.createConvolver();
    rvConv.buffer = reverbIr;
    const rvWet = g(0.8);
    for (const o of [flLfo, phLfo, gtLfo]) o.start();
    return {
      flIn, flDry, flWet, flDelay, flFb, flLfo, flDepth,
      phDry, phWet, phStages, phLfo, phDepth,
      crDry, crWet, crShaper,
      gtGain, gtLfo, gtDepth,
      rvSend, rvConv, rvWet,
    };
  }

  /** Aplica flanger/phaser/reverb/crush/gate; los tiempos siguen al BPM. */
  setInsertFx(cfg: InsertFxConfig, beatSeconds: number) {
    this.insertFx = cfg;
    const i = this.ins;
    const now = this.ctx.currentTime;
    const t = (p: AudioParam, v: number) => p.setTargetAtTime(v, now, 0.02);
    // flanger
    t(i.flWet.gain, cfg.flanger.on ? 0.7 : 0);
    t(i.flDry.gain, cfg.flanger.on ? 0.7 : 1);
    t(i.flFb.gain, cfg.flanger.on ? 0.55 : 0);
    t(i.flLfo.frequency, 1 / Math.max(0.05, cfg.flanger.beats * beatSeconds));
    // phaser
    t(i.phWet.gain, cfg.phaser.on ? 0.75 : 0);
    t(i.phDry.gain, cfg.phaser.on ? 0.75 : 1);
    t(i.phLfo.frequency, 1 / Math.max(0.05, cfg.phaser.beats * beatSeconds));
    // crush: curva escalonada con 2^bits niveles
    if (cfg.crush.on) {
      const levels = Math.pow(2, Math.max(2, Math.min(12, Math.round(cfg.crush.bits))));
      const n = 4096;
      const curve = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        const x = (k / (n - 1)) * 2 - 1;
        curve[k] = Math.round(x * (levels / 2)) / (levels / 2);
      }
      i.crShaper.curve = curve;
    }
    t(i.crWet.gain, cfg.crush.on ? 1 : 0);
    t(i.crDry.gain, cfg.crush.on ? 0 : 1);
    // gate: la cuadrada va de -1 a 1; con base 0.5 y profundidad 0.5 → 0..1
    t(i.gtLfo.frequency, 1 / Math.max(0.02, cfg.gate.beats * 2 * beatSeconds));
    t(i.gtDepth.gain, cfg.gate.on ? 0.5 : 0);
    t(i.gtGain.gain, cfg.gate.on ? 0.5 : 1);
    // reverb
    t(i.rvSend.gain, cfg.reverb.on ? 0.25 + cfg.reverb.amount * 0.6 : 0);
  }

  /** Engancha el reproductor del hilo de audio cuando el worklet terminó de cargar. */
  attachWorklets() {
    this.node = new AudioWorkletNode(this.ctx, "bross-deck", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.node.port.onmessage = (e: MessageEvent<DeckReport>) => this.onReport(e.data);
    // stems (por filtros) antes de la EQ: con todo en 1 pasa directo
    this.node.connect(this.stems.input);
    this.sendKeylock();
    if (this.pending) {
      this.sendBuffer(this.pending);
      this.pending = null;
      this.post({ type: "seek", pos: this.rep.pos, seq: ++this.seq });
      if (this.loop) this.post({ type: "loop", start: this.loop.start, end: this.loop.end });
    }
  }

  private post(m: DeckMsg, transfer: Transferable[] = []) {
    this.node?.port.postMessage(m, transfer);
  }

  private sendBuffer(channels: Int16Array[]) {
    this.post({ type: "buffer", channels }, channels.map((c) => c.buffer as ArrayBuffer));
  }

  private sendKeylock() {
    // key-sync transpone; con key-lock el tono no depende de la velocidad
    this.post({ type: "keylock", on: this.keyLock, pitch: Math.pow(2, this.keyShift / 12) });
  }

  private setRep(pos: number, rate: number) {
    this.rep = { pos, rate, t: this.ctx.currentTime };
  }

  /** velocidad con sentido (negativa con REVERSE) */
  private dirRate(): number {
    return this.reverseOn ? -this.rate : this.rate;
  }

  private cmdStart(pos: number, rate: number) {
    this.post({ type: "start", pos, rate, seq: ++this.seq });
    this.setRep(pos, rate);
  }

  private cmdRate(rate: number, tau: number) {
    const pos = this.position;
    this.post({ type: "rate", rate, tau, seq: ++this.seq });
    this.setRep(pos, rate);
  }

  private cmdStop() {
    const pos = this.position;
    this.post({ type: "stop", seq: ++this.seq });
    this.setRep(pos, 0);
  }

  private cmdSeek(pos: number) {
    this.post({ type: "seek", pos, seq: ++this.seq });
    this.setRep(pos, this.rep.rate);
  }

  private onReport(r: DeckReport) {
    // un reporte anterior al último comando describiría el estado viejo
    if (r.seq !== this.seq) return;
    this.rep = { pos: r.pos, rate: r.active ? r.rate : 0, t: r.t };
    if (!this.motor) return;
    if (r.ended && this.mode !== "scratch") {
      this.motor = false;
      this.mode = null;
      this.onStateChange?.();
      return;
    }
    if (this.mode === "brake" && r.active && Math.abs(r.rate) < 0.004) {
      this.motor = false;
      this.mode = null;
      this.brakeStopped = true;
      this.cmdStop();
      this.onStateChange?.();
      return;
    }
    // REVERSE llegó al principio de la pista: queda en pausa
    if (this.mode === "reverse" && r.pos <= 0.0005) {
      this.motor = false;
      this.mode = null;
      this.cmdStop();
      this.onStateChange?.();
    }
  }

  get playing(): boolean {
    return this.motor;
  }

  get altMode(): AltMode | null {
    return this.mode;
  }

  get position(): number {
    if (!this.loaded) return 0;
    const r = this.rep;
    let p = r.pos + (this.ctx.currentTime - r.t) * r.rate;
    if (this.loop && r.rate > 0 && r.pos < this.loop.end) {
      const len = this.loop.end - this.loop.start;
      if (len > 0 && p >= this.loop.end) p = this.loop.start + ((p - this.loop.start) % len);
    }
    return clampTime(p, this.duration);
  }

  /** velocidad del pitch fader (±range %), sin el bend del jog */
  get baseRate(): number {
    return 1 + (this.pitch - 0.5) * (this.range / 50);
  }

  /** factor de velocidad actual, con el bend del jog */
  get rate(): number {
    return this.baseRate * (1 + this.bend);
  }

  get ready(): boolean {
    return this.loaded;
  }

  private readonly meterBall = new MeterBallistics();
  private lastMeter: MeterReading = SILENT_METER;

  /** Nivel 0..1 (para el video) y, de paso, actualiza el medidor en dB. */
  get level(): number {
    const data = this.levelBuf;
    this.analyser.getFloatTimeDomainData(data);
    const m = measure(data);
    this.lastMeter = this.meterBall.update(m, performance.now());
    return Math.min(1, Math.pow(10, m.rms / 20) * 2.6);
  }

  get meter(): MeterReading {
    return this.lastMeter;
  }

  /**
   * Carga la pista: el PCM (`channels`, copias propias) pasa al hilo de
   * audio y el motor ya no guarda otra copia.
   */
  load(
    track: LibraryTrack,
    channels: Int16Array[],
    peaks: number[] = track.peaks,
    bands: BandPeaks | null = track.bands,
    detail: WaveDetail | null = null,
  ) {
    if (this.motor) this.cmdStop();
    this.motor = false;
    this.mode = null;
    this.loaded = true;
    this.trackId = track.id;
    this.title = track.title;
    this.artist = track.artist;
    this.duration = track.duration;
    this.peaks = peaks;
    this.bands = bands;
    this.detail = detail;
    this.loop = null;
    this.loopBeats = null;
    this.roll = null;
    this.keyShift = 0;
    this.bend = 0;
    this.cuePreview = null;
    this.brakeStopped = false;
    // restaura el cue, los hot cues y los loops guardados de la pista
    const pois = track.pois;
    this.cuePoint = clampTime(pois?.cuePoint ?? 0, this.duration);
    this.cues = Array.from({ length: 8 }, (_, i) =>
      typeof pois?.cues?.[i] === "number" ? clampTime(pois.cues[i] as number, this.duration) : null,
    );
    this.savedLoops = Array.from({ length: 8 }, (_, i) => {
      const l = pois?.loops?.[i];
      return l && l.end > l.start ? { start: clampTime(l.start, this.duration), end: clampTime(l.end, this.duration) } : null;
    });
    this.loopInMark = null;
    this.lastLoop = null;
    this.slipAnchor = null;
    this.setRep(this.cuePoint, 0);
    this.sendKeylock();
    if (this.node) {
      this.sendBuffer(channels);
      this.post({ type: "loop", start: null, end: null });
      this.post({ type: "seek", pos: this.cuePoint, seq: ++this.seq });
    } else {
      this.pending = channels;
    }
  }

  unload() {
    this.post({ type: "clear" });
    this.pending = null;
    this.motor = false;
    this.mode = null;
    this.loaded = false;
    this.trackId = null;
    this.title = "";
    this.artist = "";
    this.duration = 0;
    this.peaks = [];
    this.bands = null;
    this.detail = null;
    this.loop = null;
    this.loopBeats = null;
    this.roll = null;
    this.keyShift = 0;
    this.cuePreview = null;
    this.savedLoops = Array(8).fill(null);
    this.loopInMark = null;
    this.lastLoop = null;
    this.slipAnchor = null;
    this.setRep(0, 0);
  }

  /** Estado persistible de cue/hot cues/loops de la pista cargada. */
  /** Reemplaza cue, hot cues y loops guardados (editor de pista). */
  setPois(pois: TrackPois) {
    this.cuePoint = clampTime(pois.cuePoint ?? 0, this.duration);
    this.cues = Array.from({ length: 8 }, (_, i) =>
      typeof pois.cues?.[i] === "number" ? clampTime(pois.cues[i] as number, this.duration) : null,
    );
    this.savedLoops = Array.from({ length: 8 }, (_, i) => {
      const l = pois.loops?.[i];
      return l && l.end > l.start ? { start: clampTime(l.start, this.duration), end: clampTime(l.end, this.duration) } : null;
    });
  }

  getPois(): TrackPois {
    return { cuePoint: this.cuePoint, cues: [...this.cues], loops: this.savedLoops.map((l) => (l ? { ...l } : null)) };
  }

  play() {
    if (!this.loaded) return;
    this.brakeStopped = false;
    if (this.motor) return;
    this.motor = true;
    // con la mano sobre el plato el motor queda encendido para cuando suelte
    if (this.mode === "scratch") return;
    let pos = this.position;
    if (!this.reverseOn && pos >= this.duration - 0.01) pos = 0;
    this.mode = this.reverseOn ? "reverse" : null;
    this.cmdStart(pos, this.dirRate());
  }

  pause() {
    this.brakeStopped = false;
    this.slipAnchor = null;
    if (!this.motor) return;
    this.motor = false;
    if (this.mode === "scratch") return;
    this.mode = null;
    this.cmdStop();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(seconds: number) {
    if (!this.loaded) return;
    let target = Math.max(0, Math.min(this.duration, seconds));
    if (this.mode === "scratch") {
      this.scratchBase = target;
      this.post({ type: "follow", pos: target, seq: ++this.seq });
      this.setRep(target, 0);
      return;
    }
    if (this.loop && !this.mode) {
      const len = this.loop.end - this.loop.start;
      if (len > 0 && (target < this.loop.start || target >= this.loop.end)) {
        target = this.loop.start + (((target - this.loop.start) % len) + len) % len;
      }
    }
    // clics repetidos en el mismo punto no deben cortar el audio
    if (this.motor && Math.abs(target - this.position) < 0.005) return;
    this.cmdSeek(target);
  }

  /** Activa/desactiva el bloqueo de tono en caliente. */
  setKeyLock(on: boolean) {
    if (this.keyLock === on) return;
    this.keyLock = on;
    this.sendKeylock();
  }

  // ── SLIP ─────────────────────────────────────────────────────────────

  /** Empieza a seguir la posición "fantasma" (solo con SLIP y sonando). */
  beginSlip() {
    if (!this.slip || this.slipAnchor || !this.playing) return;
    this.slipAnchor = { pos: this.position, t: this.ctx.currentTime };
  }

  get slipGhost(): number | null {
    const a = this.slipAnchor;
    if (!a) return null;
    return clampTime(a.pos + (this.ctx.currentTime - a.t) * this.baseRate, this.duration);
  }

  /** Termina el slip: devuelve dónde debería estar la pista (o null). */
  endSlip(): number | null {
    const g = this.slipGhost;
    this.slipAnchor = null;
    return g;
  }

  // ── PLATO: scratch / reverse / break ─────────────────────────────────

  /** Suelta el plato con el motor encendido: vuelve a la marcha (o hacia atrás). */
  private releaseToMotor(tau = 0.06) {
    this.mode = this.reverseOn ? "reverse" : null;
    this.cmdRate(this.dirRate(), tau);
  }

  /** Mano sobre el plato (modo scratch). */
  scratchStart(): boolean {
    if (!this.loaded || !this.node) return false;
    this.brakeStopped = false;
    this.beginSlip();
    const pos = this.position;
    this.mode = "scratch";
    this.scratchBase = pos;
    this.post({ type: "follow", pos, seq: ++this.seq });
    this.setRep(pos, 0);
    return true;
  }

  /** La mano movió el plato: `delta` segundos desde que se apoyó. */
  scratchMove(delta: number) {
    if (this.mode !== "scratch") return;
    const target = clampTime(this.scratchBase + delta, this.duration);
    this.post({ type: "follow", pos: target, seq: this.seq });
  }

  /** Mano fuera del plato. */
  scratchEnd() {
    if (this.mode !== "scratch") return;
    if (this.motor) {
      const ghost = this.endSlip();
      if (ghost != null) this.cmdSeek(ghost);
      this.releaseToMotor();
    } else {
      this.slipAnchor = null;
      this.mode = null;
      this.cmdStop();
    }
  }

  setReverse(on: boolean) {
    this.reverseOn = on;
    if (!this.loaded || !this.motor || this.mode === "scratch" || this.mode === "brake") return;
    if (on) {
      this.beginSlip();
      this.mode = "reverse";
      this.cmdRate(-this.rate, 0.05);
      return;
    }
    const ghost = this.endSlip();
    if (ghost != null) this.cmdSeek(ghost);
    this.mode = null;
    this.cmdRate(this.rate, 0.05);
  }

  /** BREAK: el motor frena hasta parar en `seconds`; apagarlo lo arranca. */
  setBrake(on: boolean, seconds: number) {
    if (!this.loaded) return;
    if (on) {
      if (!this.motor || this.mode === "scratch") return;
      this.mode = "brake";
      this.cmdRate(0, Math.max(0.05, seconds) / 4.5);
      return;
    }
    if (this.mode === "brake") {
      this.releaseToMotor(0.08);
      return;
    }
    if (this.brakeStopped) {
      // arranque del motor: el plato acelera hasta la velocidad normal
      this.brakeStopped = false;
      this.motor = true;
      this.cmdStart(this.position, 0);
      this.releaseToMotor(0.08);
    }
  }

  get braking(): boolean {
    return this.mode === "brake";
  }

  // ── MIXER ────────────────────────────────────────────────────────────

  setChannelGain(v: number) {
    this.gain.gain.setTargetAtTime(Math.max(0, Math.min(1.2, v)), this.ctx.currentTime, 0.008);
  }

  /** hi/mid/low en 0..1, 0.5 = neutro (±12 dB) */
  setEq(band: "low" | "mid" | "high", v: number) {
    const db = (v - 0.5) * 24;
    const node = band === "low" ? this.eqLow : band === "mid" ? this.eqMid : this.eqHigh;
    node.gain.setTargetAtTime(db, this.ctx.currentTime, 0.01);
  }

  /**
   * Filtro en 0..1: 0.5 neutro, hacia 0 lowpass, hacia 1 highpass.
   * Dos etapas (24 dB/oct). En el último 15 % del recorrido una ganancia
   * baja hasta 0: en el tope el canal queda completamente cerrado.
   */
  setFilter(v: number) {
    const now = this.ctx.currentTime;
    const d = Math.min(1, Math.abs(v - 0.5) * 2);
    const filters = [this.filterA, this.filterB];
    if (d < 0.04) {
      for (const f of filters) {
        f.type = "allpass";
        f.frequency.setTargetAtTime(22000, now, 0.01);
      }
      this.filterKill.gain.setTargetAtTime(1, now, 0.01);
      return;
    }
    const t = (d - 0.04) / 0.96; // 0..1
    const lowpass = v < 0.5;
    const freq = lowpass
      ? 20000 * Math.pow(20 / 20000, t) // 20 kHz → 20 Hz
      : 20 * Math.pow(1000, t); // 20 Hz → 20 kHz
    for (const f of filters) {
      const type = lowpass ? "lowpass" : "highpass";
      if (f.type !== type) f.type = type;
      f.frequency.setTargetAtTime(freq, now, 0.01);
      f.Q.value = 0.707;
    }
    const kill = t > 0.85 ? Math.max(0, 1 - (t - 0.85) / 0.15) : 1;
    this.filterKill.gain.setTargetAtTime(kill * kill, now, 0.01);
  }

  /** ECHO del deck; `beatSeconds` = duración de un beat con el pitch actual. */
  setEcho(cfg: EchoConfig, beatSeconds: number) {
    this.echo = cfg;
    const now = this.ctx.currentTime;
    // apagar corta el envío pero deja sonar la cola, como una consola real
    this.echoSend.gain.setTargetAtTime(cfg.on ? 1 : 0, now, 0.01);
    const time = Math.max(0.03, Math.min(3.9, cfg.beats * beatSeconds));
    this.echoDelay.delayTime.setTargetAtTime(time, now, 0.03);
    this.echoFb.gain.setTargetAtTime(0.15 + Math.max(0, Math.min(1, cfg.feedback)) * 0.7, now, 0.02);
  }

  setCrossfade(gain: number) {
    this.xfade.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.005);
  }

  /** CUE / PFL: manda este canal a la salida de auriculares. */
  setCue(on: boolean) {
    this.cueOn = on;
    this.cueGain.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.01);
    // Si el canal estaba en sandbox, al apagar CUE vuelve al master para no
    // dejar el deck mudo sin explicación.
    if (!on && this.sandboxOn) {
      this.setSandbox(false);
    }
  }

  get cueEnabled(): boolean {
    return this.cueOn;
  }

  /** Sandbox: el deck sigue sonando, pero no entra al master. */
  setSandbox(on: boolean) {
    this.sandboxOn = on;
    this.sandboxGain.gain.setTargetAtTime(on ? 0 : 1, this.ctx.currentTime, 0.015);
  }

  setPitch(v: number) {
    this.pitch = Math.max(0, Math.min(1, v));
    this.applyRate();
  }

  setPitchRange(pct: number) {
    this.range = pct;
    this.applyRate();
  }

  /** Pitch bend del jog (nudge): acelera o frena mientras se mueve el plato. */
  setBend(b: number) {
    const next = Math.max(-0.5, Math.min(0.5, b));
    if (Math.abs(next - this.bend) < 1e-4) return;
    this.bend = next;
    this.applyRate();
  }

  /** La velocidad nueva llega con una rampa corta: sin escalones audibles. */
  private applyRate() {
    if (!this.motor || this.mode === "scratch" || this.mode === "brake") return;
    this.cmdRate(this.dirRate(), 0.02);
  }

  /** Key-sync: transpone en semitonos manteniendo el tempo (fuerza key-lock). */
  setKeyShift(semitones: number) {
    this.keyShift = Math.round(Math.max(-5, Math.min(6, semitones)));
    if (this.keyShift !== 0 && !this.keyLock) this.keyLock = true;
    this.sendKeylock();
  }

  clearKeyShift() {
    this.keyShift = 0;
    this.sendKeylock();
  }

  setLoop(start: number, end: number, beats: number) {
    this.loop = { start, end };
    this.loopBeats = beats;
    this.post({ type: "loop", start, end });
  }

  clearLoop() {
    this.loop = null;
    this.loopBeats = null;
    this.post({ type: "loop", start: null, end: null });
  }

  get rolling(): boolean {
    return this.roll !== null;
  }

  /**
   * Loop roll: al apretar el pad se repite el fragmento actual de N beats;
   * al soltarlo se restaura el loop anterior y la pista sigue donde estaría.
   */
  startRoll(beats: number, bpm: number): boolean {
    if (!this.loaded || !this.motor || this.mode || this.roll) return false;
    if (!Number.isFinite(bpm) || bpm <= 0) return false;
    const len = (60 / bpm) * beats;
    if (len <= 0 || len >= this.duration) return false;
    const pos = this.position;
    const start = Math.max(0, Math.min(this.duration - len, pos));
    const previousLoop = this.loop ? { ...this.loop } : null;
    const previousBeats = this.loopBeats;
    this.setLoop(start, start + len, beats);
    this.roll = {
      start,
      end: start + len,
      beats,
      returnPosition: pos,
      startedAt: this.ctx.currentTime,
      previousLoop,
      previousBeats,
    };
    return true;
  }

  endRoll() {
    const r = this.roll;
    if (!r) return;
    this.roll = null;
    if (r.previousLoop) this.setLoop(r.previousLoop.start, r.previousLoop.end, r.previousBeats ?? 0);
    else this.clearLoop();
    // La pista continúa como si hubiera avanzado durante el roll.
    const elapsed = (this.ctx.currentTime - r.startedAt) * this.rate;
    this.seek(Math.min(this.duration - 0.001, r.returnPosition + elapsed));
  }

  snapshot(): Omit<DeckRuntime, "bpm" | "keyName" | "camelot" | "firstBeat"> {
    const position = this.position;
    const playing = this.playing;
    return {
      trackId: this.trackId,
      loaded: this.loaded,
      playing,
      title: this.title,
      artist: this.artist,
      position,
      duration: this.duration,
      peaks: this.peaks,
      bands: this.bands,
      cuePoint: this.cuePoint,
      atCue: this.loaded && !playing && Math.abs(position - this.cuePoint) < 0.02,
      cueHeld: this.cuePreview !== null,
      cues: [...this.cues],
      level: this.level,
      meter: this.meter,
      loopBeats: this.loopBeats,
      loopStart: this.loop ? this.loop.start : null,
      loopEnd: this.loop ? this.loop.end : null,
      rolling: this.roll !== null,
      rollBeats: this.roll?.beats ?? null,
      cue: this.cueOn,
      sandbox: this.sandboxOn,
      pitch: this.pitch,
      range: this.range,
      keyShift: this.keyShift,
      alt: this.mode,
      reverse: this.reverseOn,
      braking: this.mode === "brake",
      loopIn: this.loopInMark,
      autoLoopBeats: this.autoBeats,
      canReloop: this.lastLoop !== null,
      savedLoops: this.savedLoops.map((l) => (l ? { ...l } : null)),
      slip: this.slip,
      slipGhost: this.slipGhost,
    };
  }
}

type SinkCapableContext = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

export class AudioEngine {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly masterAnalyser: AnalyserNode;
  private readonly masterBuf: Float32Array<ArrayBuffer>;
  private readonly deckA: DeckChannel;
  private readonly deckB: DeckChannel;
  /** Bus de auriculares (CUE/PFL) en un contexto aparte con su propia salida. */
  private readonly cueCtx: AudioContext;
  private readonly cueGain: GainNode;
  private readonly cueBus: GainNode;
  private readonly cueStream: MediaStreamAudioDestinationNode;
  /** CUE MIX: cuánto de la previa (cue) y cuánto del master va a auriculares */
  private readonly phonesCue: GainNode;
  private readonly phonesMaster: GainNode;
  private xfCurve: XfCurve = "mix";
  private readonly samplerOut: GainNode;
  private samples: ({ buffer: AudioBuffer; slot: SampleSlot } | null)[] = Array(8).fill(null);
  private samplePlaying: (AudioBufferSourceNode | null)[] = Array(8).fill(null);
  /** avisa a la UI cuando cambian las ranuras del sampler */
  onSamplesChange: (() => void) | null = null;
  private xfPos = 0.5;
  private buffers = new Map<string, TrackPcm>();
  /** Buffers de archivos importados a mano: no se pueden re-hidratar desde disco. */
  private pinned = new Set<string>();
  private meta = new Map<string, TrackAnalysis>();
  /** onda calculada por el worker, por pista */
  private waves = new Map<string, { peaks: number[]; bands: BandPeaks; detail: WaveDetail | null }>();
  /** cuantización: cues y saltos caen en el beat */
  quantize = false;
  private waveJobs = new Map<string, Promise<void>>();
  private worker: Worker | null = null;
  private jobs = new Map<number, (r: WorkerResult | null) => void>();
  private jobId = 0;
  private offline: OfflineAudioContext | null = null;
  /** true cuando el key-lock y el vinilo ya corren en el hilo de audio */
  readonly worklets: Promise<boolean>;

  constructor() {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = cappedContext(Ctor);
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    // ataque mínimo y ratio máximo: lo más parecido a un limitador de pared
    // que da DynamicsCompressorNode (el de fábrica, 3 ms, deja pasar picos)
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 3;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.12;
    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 2048;
    this.masterBuf = new Float32Array(this.masterAnalyser.fftSize);

    this.master.connect(this.limiter).connect(this.masterAnalyser).connect(this.ctx.destination);

    // Salida de auriculares independiente: el bus CUE se convierte en un
    // stream y se reproduce en un segundo AudioContext, que es el que cambia
    // de dispositivo físico con setSinkId.
    this.cueBus = this.ctx.createGain();
    this.cueStream = this.ctx.createMediaStreamDestination();
    this.phonesCue = this.ctx.createGain();
    this.phonesMaster = this.ctx.createGain();
    this.phonesMaster.gain.value = 0;
    this.cueBus.connect(this.phonesCue).connect(this.cueStream);
    this.masterAnalyser.connect(this.phonesMaster).connect(this.cueStream);
    this.cueCtx = cappedContext(Ctor);
    this.cueGain = this.cueCtx.createGain();
    this.cueGain.gain.value = 0.85;
    this.cueCtx.createMediaStreamSource(this.cueStream.stream)
      .connect(this.cueGain)
      .connect(this.cueCtx.destination);

    const ir = impulseResponse(this.ctx, 2.6, 2.4);
    this.deckA = new DeckChannel(this.ctx, this.master, this.cueBus, ir);
    this.deckB = new DeckChannel(this.ctx, this.master, this.cueBus, ir);

    // SAMPLER: 8 ranuras que suenan directo al master
    this.samplerOut = this.ctx.createGain();
    this.samplerOut.gain.value = 0.7;
    this.samplerOut.connect(this.master);
    void this.loadBuiltinSamples();

    // arranque con el crossfader centrado: los dos decks a pleno
    this.setCrossfader(0.5);

    // sync enganchado: tempo y fase se corrigen solos 20 veces por segundo
    window.setInterval(() => this.syncTick(), 50);

    this.worklets = this.ctx.audioWorklet
      .addModule(workletUrl)
      .then(() => {
        this.deckA.attachWorklets();
        this.deckB.attachWorklets();
        return true;
      })
      .catch((error) => {
        console.warn("No se pudo cargar el AudioWorklet (sin key-lock ni scratch)", error);
        return false;
      });
  }

  private deck(id: DeckId): DeckChannel {
    return id === "A" ? this.deckA : this.deckB;
  }

  async resume() {
    if (this.ctx.state !== "running") await this.ctx.resume();
    if (this.cueCtx.state !== "running") {
      try {
        await this.cueCtx.resume();
      } catch {
        /* el navegador puede bloquear el segundo contexto hasta un gesto */
      }
    }
  }

  /** Cambia la salida física general (master). "" = predeterminada. */
  async setMasterOutput(deviceId: string): Promise<boolean> {
    return this.applySink(this.ctx, deviceId);
  }

  /** Cambia la salida física de auriculares (CUE). "" = predeterminada. */
  async setCueOutput(deviceId: string): Promise<boolean> {
    return this.applySink(this.cueCtx, deviceId);
  }

  private async applySink(ctx: AudioContext, deviceId: string): Promise<boolean> {
    const sink = ctx as SinkCapableContext;
    if (typeof sink.setSinkId !== "function") return false;
    try {
      await sink.setSinkId(deviceId || "");
      return true;
    } catch (error) {
      console.warn("No se pudo cambiar la salida de audio", error);
      return false;
    }
  }

  /** Volumen de la salida de auriculares (0..1). */
  setCueLevel(v: number) {
    this.cueGain.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), this.cueCtx.currentTime, 0.02);
  }

  private recNode: AudioWorkletNode | null = null;
  private recSink: GainNode | null = null;
  /** bus de grabación: master (o el sonido del sistema) + entrada externa */
  private recMix: GainNode | null = null;
  private recInput: { source: MediaStreamAudioSourceNode; gain: GainNode; stream: MediaStream } | null = null;
  private recMasterOn = true;
  private mediaRec: { rec: MediaRecorder; dest: MediaStreamAudioDestinationNode; done: Promise<void> } | null = null;

  private ensureRecMix(): GainNode {
    if (!this.recMix) {
      this.recMix = this.ctx.createGain();
      if (this.recMasterOn) this.masterAnalyser.connect(this.recMix);
    }
    return this.recMix;
  }

  /**
   * Fuente de la grabación. `stream`: micrófono / línea o el sonido del
   * sistema; `withMaster: false` deja afuera el master (para el sonido del
   * sistema, que ya lo incluye).
   */
  setRecordSource(stream: MediaStream | null, opts: { gain?: number; withMaster?: boolean } = {}) {
    const mix = this.ensureRecMix();
    if (this.recInput) {
      try {
        this.recInput.source.disconnect();
        this.recInput.gain.disconnect();
      } catch {
        /* ya desconectado */
      }
      this.recInput.stream.getTracks().forEach((t) => t.stop());
      this.recInput = null;
    }
    const withMaster = opts.withMaster ?? true;
    if (withMaster !== this.recMasterOn) {
      try {
        if (withMaster) this.masterAnalyser.connect(mix);
        else this.masterAnalyser.disconnect(mix);
      } catch {
        /* ya estaba así */
      }
      this.recMasterOn = withMaster;
    }
    if (stream && stream.getAudioTracks().length) {
      const source = this.ctx.createMediaStreamSource(stream);
      const gain = this.ctx.createGain();
      gain.gain.value = opts.gain ?? 1;
      source.connect(gain).connect(mix);
      this.recInput = { source, gain, stream };
    }
  }

  setRecordInputGain(v: number) {
    this.recInput?.gain.gain.setTargetAtTime(Math.max(0, Math.min(2, v)), this.ctx.currentTime, 0.02);
  }

  /**
   * Otra salida de PCM del bus de grabación (para el streaming en vivo), que
   * convive con la grabación. Devuelve la función para cortarla.
   */
  async startPcmTap(onChunk: (pcm: Int16Array) => void): Promise<(() => void) | null> {
    if (!(await this.worklets)) return null;
    const node = new AudioWorkletNode(this.ctx, "bross-recorder", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 2,
      channelCountMode: "explicit",
    });
    node.port.onmessage = (e: MessageEvent<{ type: string; data?: Int16Array }>) => {
      if (e.data.type === "chunk" && e.data.data) onChunk(e.data.data);
    };
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    const mix = this.ensureRecMix();
    mix.connect(node);
    node.connect(sink).connect(this.ctx.destination);
    void this.resume();
    return () => {
      node.port.postMessage({ type: "stop" });
      try {
        mix.disconnect(node);
        node.disconnect();
        sink.disconnect();
      } catch {
        /* ya desconectado */
      }
    };
  }

  private lineIn: { source: MediaStreamAudioSourceNode; monitor: GainNode; stream: MediaStream } | null = null;
  private lineInMonitorOn = false;

  /**
   * Entrada de línea / micrófono: PCM para leer el BPM y, si se pide, se
   * escucha por el master. Devuelve la función para cerrarla.
   */
  async startLineIn(stream: MediaStream, onChunk: (pcm: Int16Array) => void): Promise<(() => void) | null> {
    if (!(await this.worklets)) return null;
    const source = this.ctx.createMediaStreamSource(stream);
    const monitor = this.ctx.createGain();
    monitor.gain.value = this.lineInMonitorOn ? 1 : 0;
    source.connect(monitor).connect(this.master);
    const node = new AudioWorkletNode(this.ctx, "bross-recorder", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 2,
      channelCountMode: "explicit",
    });
    node.port.onmessage = (e: MessageEvent<{ type: string; data?: Int16Array }>) => {
      if (e.data.type === "chunk" && e.data.data) onChunk(e.data.data);
    };
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    source.connect(node);
    node.connect(sink).connect(this.ctx.destination);
    this.lineIn = { source, monitor, stream };
    void this.resume();
    return () => {
      node.port.postMessage({ type: "stop" });
      try {
        source.disconnect();
        monitor.disconnect();
        node.disconnect();
        sink.disconnect();
      } catch {
        /* ya desconectado */
      }
      stream.getTracks().forEach((t) => t.stop());
      if (this.lineIn?.stream === stream) this.lineIn = null;
    };
  }

  /**
   * DVS: abre un lector de timecode sobre una entrada (estéreo). `onReading`
   * recibe velocidad, posición y calidad ~150 veces por segundo.
   */
  async startDvs(
    stream: MediaStream,
    onReading: (r: { speed: number; position: number | null; quality: number; level: number }) => void,
  ): Promise<{ stop: () => void; config: (c: { gain?: number; swap?: boolean }) => void } | null> {
    if (!(await this.worklets)) return null;
    const source = this.ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(this.ctx, "bross-dvs", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 2,
      channelCountMode: "explicit",
    });
    node.port.onmessage = (e) => onReading(e.data);
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    source.connect(node).connect(sink).connect(this.ctx.destination);
    void this.resume();
    return {
      stop: () => {
        try {
          source.disconnect();
          node.disconnect();
          sink.disconnect();
        } catch {
          /* ya desconectado */
        }
        stream.getTracks().forEach((t) => t.stop());
      },
      config: (c) => node.port.postMessage({ type: "config", ...c }),
    };
  }

  /** Escuchar (o no) la entrada de línea por el master. */
  setLineInMonitor(on: boolean) {
    this.lineInMonitorOn = on;
    this.lineIn?.monitor.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.03);
  }

  /** ¿Hay una grabación en curso (PCM o codificada)? */
  get recording(): boolean {
    return !!this.recNode || !!this.mediaRec;
  }

  /**
   * Graba el bus de grabación: `onChunk` recibe PCM 16 bits estéreo intercalado
   * cada ~250 ms. Devuelve false si el worklet no está disponible.
   */
  async startRecording(onChunk: (pcm: Int16Array) => void): Promise<boolean> {
    if (this.recording) return false;
    if (!(await this.worklets)) return false;
    const node = new AudioWorkletNode(this.ctx, "bross-recorder", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 2,
      channelCountMode: "explicit",
    });
    node.port.onmessage = (e: MessageEvent<{ type: string; data?: Int16Array }>) => {
      if (e.data.type === "chunk" && e.data.data) onChunk(e.data.data);
    };
    // salida muda hacia destination: así el navegador procesa el nodo
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    this.ensureRecMix().connect(node);
    node.connect(sink).connect(this.ctx.destination);
    this.recNode = node;
    this.recSink = sink;
    void this.resume();
    return true;
  }

  /**
   * Graba codificado con MediaRecorder (Opus en WebM o AAC en MP4).
   * `onChunk` recibe los bloques del contenedor a medida que salen.
   */
  startEncodedRecording(mimeType: string, onChunk: (data: Uint8Array) => void, bitsPerSecond = 192000): boolean {
    if (this.recording || typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported(mimeType)) return false;
    const dest = this.ctx.createMediaStreamDestination();
    this.ensureRecMix().connect(dest);
    const rec = new MediaRecorder(dest.stream, { mimeType, audioBitsPerSecond: bitsPerSecond });
    // los bloques se mandan en orden aunque arrayBuffer() sea asíncrono
    let chain = Promise.resolve();
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      chain = chain.then(() => e.data.arrayBuffer().then((b) => onChunk(new Uint8Array(b))));
    };
    const done = new Promise<void>((resolve) => {
      rec.onstop = () => void chain.then(() => resolve());
    });
    rec.start(1000);
    this.mediaRec = { rec, dest, done };
    void this.resume();
    return true;
  }

  /** Corta la grabación después de mandar el último bloque. */
  stopRecording(): Promise<void> {
    const media = this.mediaRec;
    if (media) {
      this.mediaRec = null;
      media.rec.stop();
      return Promise.race([media.done, new Promise<void>((r) => window.setTimeout(r, 3000))]).then(() => {
        try {
          this.recMix?.disconnect(media.dest);
        } catch {
          /* ya desconectado */
        }
      });
    }
    const node = this.recNode;
    const sink = this.recSink;
    if (!node) return Promise.resolve();
    this.recNode = null;
    this.recSink = null;
    return new Promise((resolve) => {
      const prev = node.port.onmessage;
      node.port.onmessage = (e: MessageEvent<{ type: string; data?: Int16Array }>) => {
        prev?.call(node.port, e);
        if (e.data.type === "done") {
          try {
            this.recMix?.disconnect(node);
            node.disconnect();
            sink?.disconnect();
          } catch {
            /* ya desconectado */
          }
          resolve();
        }
      };
      node.port.postMessage({ type: "stop" });
      // red de seguridad si el contexto está suspendido
      window.setTimeout(resolve, 1500);
    });
  }

  get sampleRate(): number {
    return this.ctx.sampleRate;
  }

  /** CUE MIX: 0 = solo la previa (CUE), 1 = solo el master. */
  setCueMix(v: number) {
    const x = Math.max(0, Math.min(1, v));
    const now = this.ctx.currentTime;
    this.phonesCue.gain.setTargetAtTime(Math.cos((x * Math.PI) / 2), now, 0.02);
    this.phonesMaster.gain.setTargetAtTime(Math.sin((x * Math.PI) / 2), now, 0.02);
  }

  /** Activa o apaga el monitoreo por auriculares de un deck. */
  setDeckCue(deckId: DeckId, on: boolean) {
    this.deck(deckId).setCue(on);
    if (on) void this.resume();
  }

  /** Decodifica pasando el ArrayBuffer sin copias extra. */
  private decode(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
    return ctx.decodeAudioData(data);
  }

  /**
   * PCM para reproducir: los MP3 largos (mezclas de una hora o más) se
   * decodifican por partes a 16 bits; el resto con decodeAudioData.
   */
  private async decodeForDeck(data: ArrayBuffer): Promise<TrackPcm> {
    if (isLongMp3(new Uint8Array(data))) {
      try {
        return await decodeMp3Stream(data, { sampleRate: this.ctx.sampleRate });
      } catch {
        // MP3 raro (formato libre, capa II…): el camino de siempre
      }
    }
    return this.decode(this.ctx, data);
  }

  /** `pin`: sin ruta en disco el buffer queda vivo (no se puede releer). */
  async importFile(file: File, pin = true): Promise<LibraryTrack> {
    const data = await file.arrayBuffer();
    // las etiquetas se leen antes: decodeAudioData se queda con el buffer
    const tags = readTags(data);
    const buffer = await this.decodeForDeck(data);
    const { title, artist } = withTags({ fileName: file.name }, tags);
    const id = crypto.randomUUID();
    this.buffers.set(id, buffer);
    // un archivo suelto sin ruta en disco: su buffer debe quedar vivo
    // para poder volver a cargarlo en esta sesión
    if (pin) this.pinned.add(id);
    return withTags(
      {
        id,
        fileName: file.name,
        title,
        artist,
        duration: buffer.duration,
        peaks: [] as number[],
        bands: null,
        buffer: buffer instanceof Int16Pcm ? null : buffer,
        analysis: null,
      },
      tags,
    );
  }

  /** Contexto offline reutilizable, solo para decodificar a la tasa de análisis. */
  private analysisCtx(): OfflineAudioContext {
    if (!this.offline) this.offline = new OfflineAudioContext(1, 1, ANALYSIS_RATE);
    return this.offline;
  }

  /**
   * Importa una pista desde una carpeta: decodifica a 22.05 kHz (mitad de
   * memoria), analiza en el worker y suelta el PCM. Con una biblioteca grande
   * no podemos tener todo decodificado: se hidrata al cargarla en un deck.
   */
  async importLight(
    fileName: string,
    data: ArrayBuffer,
    extra: { sourcePath?: string; dir?: string } = {},
  ): Promise<LibraryTrack> {
    const tags = readTags(data);
    let samples: Float32Array | null = null;
    if (isLongMp3(new Uint8Array(data))) {
      try {
        samples = await decodeMp3Stream(data, { sampleRate: ANALYSIS_RATE, mono: true });
      } catch {
        samples = null;
      }
    }
    let duration: number;
    if (samples) {
      duration = samples.length / ANALYSIS_RATE;
    } else {
      const buffer = await this.decode(this.analysisCtx(), data);
      samples = buffer.getChannelData(0).slice();
      duration = buffer.duration;
    }
    const { title, artist } = withTags({ fileName }, tags);
    const id = crypto.randomUUID();
    const res = await this.runJob(samples, ANALYSIS_RATE, {
      waveform: false,
      analyze: true,
    });
    const analysis = res?.analysis ?? null;
    if (analysis) this.meta.set(id, analysis);
    return withTags(
      {
        id,
        fileName,
        title,
        artist,
        duration,
        peaks: [] as number[],
        bands: null,
        buffer: null,
        analysis,
        sourcePath: extra.sourcePath,
        dir: extra.dir,
      },
      tags,
    );
  }

  /** Decodifica a calidad completa una pista liviana para poder reproducirla. */
  async hydrate(track: LibraryTrack, data: ArrayBuffer): Promise<LibraryTrack> {
    // pistas viejas de la biblioteca: se aprovecha la lectura para las etiquetas
    const tagged = track.tagged ? track : withTags(track, readTags(data));
    const buffer = await this.decodeForDeck(data);
    this.buffers.set(track.id, buffer);
    // un Int16Pcm no es un AudioBuffer: queda solo en el motor
    return {
      ...tagged,
      buffer: buffer instanceof Int16Pcm ? null : buffer,
      duration: track.duration || buffer.duration,
    };
  }

  /** Manda un canal al worker (transferido, sin copiar dos veces). */
  private runJob(
    samples: Float32Array,
    sampleRate: number,
    opts: { waveform: boolean; analyze: boolean },
  ): Promise<WorkerResult | null> {
    const id = ++this.jobId;
    return new Promise((resolve) => {
      this.jobs.set(id, resolve);
      try {
        const job: WorkerJob = { id, samples, sampleRate, ...opts };
        this.getWorker().postMessage(job, [samples.buffer as ArrayBuffer]);
      } catch {
        this.jobs.delete(id);
        resolve(null);
      }
    });
  }

  /** Guarda la onda calculada y la pasa a los decks que tengan la pista. */
  private applyWave(trackId: string, peaks: number[], bands: BandPeaks, detail: WaveDetail | null) {
    this.waves.set(trackId, { peaks, bands, detail });
    for (const d of [this.deckA, this.deckB]) {
      if (d.trackId === trackId) {
        d.peaks = peaks;
        d.bands = bands;
        d.detail = detail;
      }
    }
  }

  /** Calcula la onda en el worker si todavía no está (una sola vez por pista). */
  private ensureWave(trackId: string, buffer: TrackPcm): Promise<void> {
    if (this.waves.get(trackId)?.detail) return Promise.resolve();
    const pending = this.waveJobs.get(trackId);
    if (pending) return pending;
    const { samples, sampleRate } = jobSamples(buffer);
    const job = this.runJob(samples, sampleRate, {
      waveform: true,
      analyze: false,
    }).then((res) => {
      this.waveJobs.delete(trackId);
      if (res?.peaks && res.bands) this.applyWave(trackId, res.peaks, res.bands, res.detail);
    });
    this.waveJobs.set(trackId, job);
    return job;
  }

  /** Analiza BPM/tonalidad en el worker (y la onda si falta); cachea por pista. */
  analyze(track: LibraryTrack): Promise<TrackAnalysis | null> {
    // vale si es de la versión actual o si el DJ corrigió la rejilla a mano
    const current = (a: TrackAnalysis | null | undefined): a is TrackAnalysis =>
      !!a && (a.version === ANALYSIS_VERSION || !!a.edited);
    const cached = this.meta.get(track.id);
    if (current(cached)) return Promise.resolve(cached);
    // pistas restauradas de la biblioteca ya traen el análisis guardado
    if (current(track.analysis)) {
      this.meta.set(track.id, track.analysis);
      return Promise.resolve(track.analysis);
    }
    // la UI guarda solo metadatos; el buffer puede estar únicamente en el motor
    const buffer = track.buffer ?? this.buffers.get(track.id);
    if (!buffer) {
      // sin PCM no se puede reanalizar: se usa el análisis viejo mientras tanto
      const old = cached ?? track.analysis ?? null;
      if (old) this.meta.set(track.id, old);
      return Promise.resolve(old);
    }
    const needWave = !this.waves.get(track.id)?.detail && !this.waveJobs.has(track.id);
    const { samples, sampleRate } = jobSamples(buffer);
    return this.runJob(samples, sampleRate, {
      waveform: needWave,
      analyze: true,
    }).then((res) => {
      if (res?.peaks && res.bands) this.applyWave(track.id, res.peaks, res.bands, res.detail);
      const analysis = res?.analysis ?? null;
      if (analysis) {
        this.meta.set(track.id, analysis);
        for (const id of ["A", "B"] as DeckId[]) {
          if (this.deck(id).trackId === track.id) this.refreshEcho(id);
        }
      }
      return analysis;
    });
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new AnalysisWorker();
      this.worker.onmessage = (e: MessageEvent<WorkerResult>) => {
        const cb = this.jobs.get(e.data.id);
        if (cb) {
          this.jobs.delete(e.data.id);
          cb(e.data);
        }
      };
      this.worker.onerror = () => {
        for (const cb of this.jobs.values()) cb(null);
        this.jobs.clear();
        // un worker roto quedaría cacheado y todos los análisis futuros
        // fallarían en silencio: se descarta para recrearlo en el próximo job
        try {
          this.worker?.terminate();
        } catch {
          /* ya estaba terminado */
        }
        this.worker = null;
      };
    }
    return this.worker;
  }

  /** Iguala BPM, fase y tonalidad del deck al del otro deck. */
  sync(deckId: DeckId): {
    pitch: number;
    range: number;
    rate: number;
    clamped: boolean;
    phaseAdjusted: boolean;
    keyShift: number;
    /** false si no se pudo igualar: no se tocó nada */
    applied: boolean;
  } | null {
    const d = this.deck(deckId);
    const other = this.deck(deckId === "A" ? "B" : "A");
    const mine = d.trackId ? this.meta.get(d.trackId) : undefined;
    const theirs = other.trackId ? this.meta.get(other.trackId) : undefined;
    if (!mine?.bpm || !theirs?.bpm || !d.ready) return null;

    // El otro deck puede estar acelerado/frenado: sincronizamos contra su BPM efectivo.
    const rate = (theirs.bpm * other.baseRate) / mine.bpm;
    let range = d.range;
    if (Math.abs(rate - 1) > range / 100) range = 16;

    const max = range / 100;
    let target = rate;
    let clamped = false;
    if (target > 1 + max) {
      target = 1 + max;
      clamped = true;
    }
    if (target < 1 - max) {
      target = 1 - max;
      clamped = true;
    }

    // Si la diferencia supera el rango máximo, no aplicamos nada: es peor
    // dejar el SYNC encendido con los BPM desalineados.
    if (clamped) {
      return {
        pitch: d.pitch,
        range,
        rate: d.baseRate,
        clamped: true,
        phaseAdjusted: false,
        keyShift: 0,
        applied: false,
      };
    }

    const pitch = 0.5 + (target - 1) / (range / 50);
    d.setPitchRange(range);
    d.setPitch(pitch);
    this.refreshEcho(deckId);

    // SYNC iguala solo el tempo y la fase: no transpone el tema ni toca el
    // key lock (cada DJ decide si bloquea el tono). Antes también hacía un
    // key-sync al tono del otro deck, que cambiaba la tonalidad sin pedirlo.
    const keyShift = 0;

    // Phase-sync: mover el playhead a la fase del beat grid del otro deck.
    let phaseAdjusted = false;
    if (other.ready) {
      const otherBeat = 60 / theirs.bpm;
      const myBeat = 60 / mine.bpm;
      const otherPhase = beatPhase(other.position, theirs.firstBeat, otherBeat);
      const myPhase = beatPhase(d.position, mine.firstBeat, myBeat);
      let diff = otherPhase - myPhase;
      while (diff > 0.5) diff -= 1;
      while (diff < -0.5) diff += 1;
      if (Math.abs(diff) > 0.002) {
        d.seek(d.position + diff * myBeat);
        phaseAdjusted = true;
      }
    }

    return { pitch, range, rate: target, clamped, phaseAdjusted, keyShift, applied: true };
  }

  // ── LOOPS ──────────────────────────────────────────────────────────

  private beatLen(deckId: DeckId): number | null {
    const g = this.deckGrid(deckId);
    return g ? 60 / g.bpm : null;
  }

  /** Activa un loop [start, end) y guarda el anterior para RELOOP. */
  private activateLoop(deckId: DeckId, start: number, end: number, jump = false) {
    const d = this.deck(deckId);
    const beat = this.beatLen(deckId);
    const beats = beat ? Math.round(((end - start) / beat) * 1000) / 1000 : 0;
    d.beginSlip();
    const pos = d.position;
    d.setLoop(start, end, beats);
    d.lastLoop = { start, end };
    if (beats > 0) d.autoBeats = beats;
    if (jump || pos < start || pos >= end) d.seek(start);
  }

  /** Sale del loop; con SLIP salta a donde estaría la pista. */
  private exitLoop(deckId: DeckId) {
    const d = this.deck(deckId);
    d.clearLoop();
    const ghost = d.endSlip();
    if (ghost != null) d.seek(ghost);
  }

  /** Loop de N beats cuantizado a la rejilla; repetir el mismo valor lo apaga. */
  toggleLoop(deckId: DeckId, beats: number): boolean {
    const d = this.deck(deckId);
    if (!d.ready || !d.trackId || d.rolling || d.altMode) return false;
    if (d.loop && d.loopBeats === beats) {
      this.exitLoop(deckId);
      return true;
    }
    const g = this.deckGrid(deckId);
    if (!g) return false;
    const period = 60 / g.bpm;
    const len = period * beats;
    if (len >= d.duration) return false;
    const pos = d.position;
    // al beat anterior (no al más cercano): redondear hacia arriba haría que
    // la pista salte hacia adelante al activar el loop
    let start = g.firstBeat + Math.floor((pos - g.firstBeat) / period + 1e-6) * period;
    start = Math.max(0, Math.min(d.duration - len, start));
    this.activateLoop(deckId, start, start + len);
    return true;
  }

  /** LOOP (auto): activa un loop del largo elegido con ◀ ▶, o lo apaga. */
  autoLoop(deckId: DeckId): boolean {
    const d = this.deck(deckId);
    if (d.loop) {
      this.exitLoop(deckId);
      return true;
    }
    return this.toggleLoop(deckId, d.autoBeats);
  }

  /** LOOP IN: marca el inicio (al beat con Q). */
  loopIn(deckId: DeckId) {
    const d = this.deck(deckId);
    if (!d.ready || d.altMode) return;
    d.loopInMark = clampTime(this.snap(deckId, d.position), d.duration);
  }

  /** LOOP OUT: cierra el loop desde LOOP IN hasta acá. */
  loopOut(deckId: DeckId): boolean {
    const d = this.deck(deckId);
    const start = d.loopInMark;
    if (start == null || !d.ready) return false;
    const end = clampTime(this.snap(deckId, d.position), d.duration);
    if (end - start < 0.03) return false;
    d.loopInMark = null;
    this.activateLoop(deckId, start, end);
    return true;
  }

  /** ◀ / ▶: divide o duplica el loop activo (o el largo del auto-loop). */
  loopResize(deckId: DeckId, factor: number) {
    const d = this.deck(deckId);
    const beat = this.beatLen(deckId);
    if (!d.loop) {
      d.autoBeats = Math.max(1 / 32, Math.min(128, d.autoBeats * factor));
      return;
    }
    const { start } = d.loop;
    const len = d.loop.end - start;
    const minLen = beat ? beat / 32 : 0.01;
    const next = Math.max(minLen, Math.min(d.duration - start, len * factor));
    const end = start + next;
    const pos = d.position;
    const beats = beat ? Math.round((next / beat) * 1000) / 1000 : 0;
    d.setLoop(start, end, beats);
    d.lastLoop = { start, end };
    if (beats > 0) d.autoBeats = beats;
    if (pos >= end) d.seek(start + ((pos - start) % next));
  }

  /** Mueve el loop activo un largo de loop hacia atrás (-1) o adelante (+1). */
  loopMove(deckId: DeckId, dir: -1 | 1) {
    const d = this.deck(deckId);
    if (!d.loop) return;
    const len = d.loop.end - d.loop.start;
    const start = Math.max(0, Math.min(d.duration - len, d.loop.start + dir * len));
    const shift = start - d.loop.start;
    if (shift === 0) return;
    const pos = d.position;
    d.setLoop(start, start + len, d.loopBeats ?? 0);
    d.lastLoop = { start, end: start + len };
    d.seek(pos + shift);
  }

  /** RELOOP: vuelve a activar el último loop desde su inicio (o sale). */
  reloop(deckId: DeckId) {
    const d = this.deck(deckId);
    if (d.loop) {
      this.exitLoop(deckId);
      return;
    }
    if (d.lastLoop) this.activateLoop(deckId, d.lastLoop.start, d.lastLoop.end, true);
  }

  /**
   * Pad de loop de largo fijo (página LOOPS): loop de N beats desde donde
   * está la pista hacia adelante, exacto (no se cuantiza). Tocar el pad
   * del loop que suena lo apaga; tocar otro largo con un loop activo cambia
   * el largo sin mover el inicio.
   */
  padLoop(deckId: DeckId, beats: number): boolean {
    const d = this.deck(deckId);
    if (!d.ready || !d.trackId || d.rolling || d.altMode) return false;
    const beat = this.beatLen(deckId);
    if (!beat || !(beats > 0)) return false;
    if (d.loop && d.loopBeats != null && Math.abs(d.loopBeats - beats) < 1e-3) {
      this.exitLoop(deckId);
      return true;
    }
    const len = beat * beats;
    if (len >= d.duration) return false;
    const start = d.loop
      ? Math.min(d.loop.start, d.duration - len)
      : Math.max(0, Math.min(d.duration - len, d.position));
    this.activateLoop(deckId, start, start + len);
    return true;
  }

  // ── SYNC ENGANCHADO ─────────────────────────────────────────────────

  private syncLocked: Record<DeckId, boolean> = { A: false, B: false };

  /**
   * Deja el deck enganchado al otro: sigue su tempo y corrige la fase de a
   * poco. El otro deck pasa a ser el que manda (nunca se corrigen los dos).
   */
  setSyncLock(deckId: DeckId, on: boolean) {
    this.syncLocked[deckId] = on;
    if (on) this.syncLocked[deckId === "A" ? "B" : "A"] = false;
    if (!on) this.deck(deckId).setBend(0);
  }

  isSyncLocked(deckId: DeckId): boolean {
    return this.syncLocked[deckId];
  }

  private syncTick() {
    for (const id of ["A", "B"] as DeckId[]) {
      if (!this.syncLocked[id]) continue;
      const d = this.deck(id);
      const o = this.deck(id === "A" ? "B" : "A");
      const md = d.trackId ? this.meta.get(d.trackId) : undefined;
      const mo = o.trackId ? this.meta.get(o.trackId) : undefined;
      if (!md?.bpm || !mo?.bpm || !d.ready || !o.ready) continue;
      // tempo: si el que manda mueve su pitch, este lo sigue
      const want = (mo.bpm * o.baseRate) / md.bpm;
      if (Math.abs(want - d.baseRate) > 1e-4) {
        const pitch = 0.5 + (want - 1) / (d.range / 50);
        if (pitch >= 0 && pitch <= 1) {
          d.setPitch(pitch);
          this.refreshEcho(id);
        }
      }
      // fase: solo con los dos sonando en marcha normal
      if (!d.playing || !o.playing || d.altMode || o.altMode || d.rolling || o.rolling) {
        d.setBend(0);
        continue;
      }
      const beatD = 60 / md.bpm;
      let diff = beatPhase(o.position, mo.firstBeat, 60 / mo.bpm) - beatPhase(d.position, md.firstBeat, beatD);
      while (diff > 0.5) diff -= 1;
      while (diff < -0.5) diff += 1;
      const errSec = diff * beatD;
      // menos de 2 ms no se escucha: no se toca nada
      if (Math.abs(errSec) < 0.002) {
        d.setBend(0);
        continue;
      }
      // se corrige en ~0.5 s con un empujoncito de velocidad (máx. ±3 %)
      const bend = Math.max(-0.03, Math.min(0.03, errSec / (0.5 * d.baseRate)));
      d.setBend(bend);
    }
  }

  /** Diferencia de fase en ms entre los decks (positivo = este va atrás). */
  phaseError(deckId: DeckId): number | null {
    const d = this.deck(deckId);
    const o = this.deck(deckId === "A" ? "B" : "A");
    const md = d.trackId ? this.meta.get(d.trackId) : undefined;
    const mo = o.trackId ? this.meta.get(o.trackId) : undefined;
    if (!md?.bpm || !mo?.bpm) return null;
    let diff = beatPhase(o.position, mo.firstBeat, 60 / mo.bpm) - beatPhase(d.position, md.firstBeat, 60 / md.bpm);
    while (diff > 0.5) diff -= 1;
    while (diff < -0.5) diff += 1;
    return diff * (60 / md.bpm) * 1000;
  }

  setSlip(deckId: DeckId, on: boolean) {
    const d = this.deck(deckId);
    d.slip = on;
    if (!on) d.endSlip();
  }

  /**
   * Slicer: divide la frase de 8 beats que está sonando en 8 rebanadas de un
   * beat, alineadas a la rejilla; el pad N salta al beat N de esa frase.
   */
  slice(deckId: DeckId, slot: number): boolean {
    const d = this.deck(deckId);
    if (!d.ready || !d.trackId || slot < 0 || slot > 7) return false;
    const m = this.meta.get(d.trackId);
    if (!m?.bpm) return false;
    const beat = 60 / m.bpm;
    const offset = m.firstBeat ?? 0;
    const phrase = offset + Math.floor((d.position - offset) / (beat * 8) + 1e-6) * beat * 8;
    d.seek(clampTime(Math.max(0, phrase) + slot * beat, d.duration));
    void this.resume();
    return true;
  }

  /** Empieza un roll temporal de N beats (se sostiene con el pad apretado). */
  startRoll(deckId: DeckId, beats: number): boolean {
    const d = this.deck(deckId);
    if (!d.trackId) return false;
    const m = this.meta.get(d.trackId);
    if (!m?.bpm) return false;
    void this.resume();
    return d.startRoll(beats, m.bpm);
  }

  endRoll(deckId: DeckId) {
    this.deck(deckId).endRoll();
  }

  /** Sandbox: escucha el deck solo por CUE, sin mandarlo al master. */
  setSandbox(deckId: DeckId, on: boolean) {
    this.deck(deckId).setSandbox(on);
  }

  /** Quita la transposición de key-sync sin tocar el pitch. */
  clearKeyShift(deckId: DeckId) {
    this.deck(deckId).clearKeyShift();
  }

  /** Stems por filtros del deck (0..1 cada uno). */
  setStems(deckId: DeckId, g: StemGains) {
    this.deck(deckId).stems.set(g);
  }

  /** Transpone el deck en semitonos (karaoke: el tono de cada cantante). */
  setKeyShift(deckId: DeckId, semitones: number) {
    this.deck(deckId).setKeyShift(semitones);
  }

  /** Velocidad real del deck (con pitch y bend; negativa en reversa). */
  deckRate(deckId: DeckId): number {
    const d = this.deck(deckId);
    if (!d.playing) return 0;
    return d.reverseOn ? -d.rate : d.rate;
  }

  private mixDest: MediaStreamAudioDestinationNode | null = null;

  /** El audio del bus de grabación como MediaStream (grabación de video). */
  mixStream(): MediaStream {
    if (!this.mixDest) {
      this.mixDest = this.ctx.createMediaStreamDestination();
      this.ensureRecMix().connect(this.mixDest);
    }
    return this.mixDest.stream;
  }

  /**
   * CUE al apretar:
   * - sonando: vuelve al cue y queda en pausa;
   * - en pausa fuera del cue: fija el cue ahí y suena mientras se mantiene;
   * - en pausa sobre el cue: suena mientras se mantiene.
   * Devuelve true si el cue cambió (para guardarlo).
   */
  cueDown(deckId: DeckId): boolean {
    const d = this.deck(deckId);
    if (!d.ready) return false;
    if (d.cuePreview) return false;
    if (d.playing) {
      d.pause();
      d.seek(d.cuePoint);
      return false;
    }
    let changed = false;
    const pos = d.position;
    if (Math.abs(pos - d.cuePoint) > 0.02) {
      d.cuePoint = clampTime(this.snap(deckId, pos), d.duration);
      changed = true;
    }
    d.seek(d.cuePoint);
    d.cuePreview = { latched: false };
    void this.resume();
    d.play();
    return changed;
  }

  /** CUE suelto: si no se apretó PLAY mientras tanto, vuelve al cue en pausa. */
  cueUp(deckId: DeckId) {
    const d = this.deck(deckId);
    const preview = d.cuePreview;
    if (!preview) return;
    d.cuePreview = null;
    if (preview.latched) return;
    d.pause();
    d.seek(d.cuePoint);
  }

  loadTrack(deckId: DeckId, track: LibraryTrack) {
    const buffer = this.buffers.get(track.id) ?? track.buffer;
    if (!buffer) return;
    const deck = this.deck(deckId);
    const wave = this.waves.get(track.id);
    // la onda se calcula en el worker (se copia el canal antes de soltar el PCM)
    if (!wave?.detail) void this.ensureWave(track.id, buffer);
    // PCM en 16 bits para el hilo de audio: el motor no guarda otra copia
    // (salvo las pistas importadas a mano, que no se pueden volver a leer)
    const channels = deckChannels(buffer, this.pinned.has(track.id));
    deck.load(track, channels, wave?.peaks ?? track.peaks, wave?.bands ?? track.bands, wave?.detail ?? null);
    this.refreshEcho(deckId);
    // los archivos importados a mano quedan "pinned": no tienen ruta para releerse
    if (!this.pinned.has(track.id)) this.buffers.delete(track.id);
  }

  /** ¿El motor ya tiene el PCM decodificado de esta pista? */
  hasBuffer(trackId: string): boolean {
    return this.buffers.has(trackId);
  }

  /** id de la pista cargada en un deck (null si está vacío). */
  deckTrackId(deckId: DeckId): string | null {
    return this.deck(deckId).trackId;
  }

  /**
   * Cambios del editor de pista: rejilla (BPM / primer beat) y puntos. Si la
   * pista está cargada en un deck, el deck los toma sin recargar el audio.
   */
  updateTrackData(trackId: string, data: { analysis?: TrackAnalysis | null; pois?: TrackPois }) {
    if (data.analysis) this.meta.set(trackId, data.analysis);
    for (const id of ["A", "B"] as DeckId[]) {
      const d = this.deck(id);
      if (d.trackId !== trackId) continue;
      if (data.pois) d.setPois(data.pois);
      if (data.analysis) this.refreshEcho(id);
    }
  }

  /** Cue/hot cues actuales del deck, listos para persistir por pista. */
  deckPois(deckId: DeckId): TrackPois {
    return this.deck(deckId).getPois();
  }

  unload(deckId: DeckId) {
    const deck = this.deck(deckId);
    const previous = deck.trackId;
    deck.unload();
    if (previous && !this.pinned.has(previous)) {
      const other = this.deck(deckId === "A" ? "B" : "A");
      if (other.trackId !== previous) this.buffers.delete(previous);
    }
  }

  toggle(deckId: DeckId) {
    const d = this.deck(deckId);
    // PLAY con CUE apretado: al soltar CUE la pista sigue sonando
    if (d.cuePreview) {
      d.cuePreview.latched = true;
      return;
    }
    void this.resume();
    d.toggle();
  }

  play(deckId: DeckId) {
    void this.resume();
    this.deck(deckId).play();
  }

  pause(deckId: DeckId) {
    this.deck(deckId).pause();
  }

  seek(deckId: DeckId, seconds: number) {
    this.deck(deckId).seek(seconds);
  }

  nudge(deckId: DeckId, deltaSeconds: number) {
    const d = this.deck(deckId);
    d.seek(d.position + deltaSeconds);
  }

  // ── JOG / VINILO ─────────────────────────────────────────────────────

  scratchStart(deckId: DeckId): boolean {
    void this.resume();
    return this.deck(deckId).scratchStart();
  }

  scratchMove(deckId: DeckId, deltaSeconds: number) {
    this.deck(deckId).scratchMove(deltaSeconds);
  }

  scratchEnd(deckId: DeckId) {
    this.deck(deckId).scratchEnd();
  }

  /** Pitch bend del jog: -0.5..0.5 (0 = sin bend). */
  setBend(deckId: DeckId, bend: number) {
    this.deck(deckId).setBend(bend);
  }

  // ── FX POR DECK ──────────────────────────────────────────────────────

  /** Duración de un beat del deck con el pitch actual (0.5 s si no hay BPM). */
  private beatSeconds(deckId: DeckId): number {
    const d = this.deck(deckId);
    const bpm = d.trackId ? this.meta.get(d.trackId)?.bpm : undefined;
    return bpm ? 60 / (bpm * d.baseRate) : 0.5;
  }

  private refreshEcho(deckId: DeckId) {
    const d = this.deck(deckId);
    const beat = this.beatSeconds(deckId);
    d.setEcho(d.echo, beat);
    d.setInsertFx(d.insertFx, beat);
  }

  setInsertFx(deckId: DeckId, cfg: InsertFxConfig) {
    this.deck(deckId).setInsertFx(cfg, this.beatSeconds(deckId));
  }

  // ── SAMPLER ──────────────────────────────────────────────────────────

  /** Bocina, sirena, láser e impacto generados en el momento (sin archivos). */
  private async loadBuiltinSamples() {
    const sr = this.ctx.sampleRate;
    const make = async (seconds: number, build: (c: OfflineAudioContext) => void) => {
      const c = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
      build(c);
      return c.startRendering();
    };
    const env = (c: OfflineAudioContext, node: AudioNode, a: number, hold: number, rel: number, peak = 0.6) => {
      const g = c.createGain();
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(peak, a);
      g.gain.setValueAtTime(peak, a + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, a + hold + rel);
      node.connect(g).connect(c.destination);
    };
    const defs: [string, number, (c: OfflineAudioContext) => void][] = [
      ["BOCINA", 1.6, (c) => {
        for (const [f, det] of [[440, 0], [554, 6], [659, -5]] as const) {
          for (const pulse of [0, 0.32, 0.64]) {
            const o = c.createOscillator();
            o.type = "sawtooth";
            o.frequency.value = f;
            o.detune.value = det;
            const lp = c.createBiquadFilter();
            lp.type = "lowpass";
            lp.frequency.value = 2600;
            o.connect(lp);
            const g = c.createGain();
            g.gain.setValueAtTime(0, pulse);
            g.gain.linearRampToValueAtTime(0.18, pulse + 0.02);
            g.gain.setValueAtTime(0.18, pulse + (pulse === 0.64 ? 0.8 : 0.22));
            g.gain.linearRampToValueAtTime(0, pulse + (pulse === 0.64 ? 0.9 : 0.28));
            lp.connect(g).connect(c.destination);
            o.start(pulse);
            o.stop(pulse + 1);
          }
        }
      }],
      ["SIRENA", 2.4, (c) => {
        const o = c.createOscillator();
        o.type = "square";
        const lfo = c.createOscillator();
        lfo.frequency.value = 1.6;
        const d = c.createGain();
        d.gain.value = 320;
        o.frequency.value = 900;
        lfo.connect(d).connect(o.frequency);
        const lp = c.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 3000;
        o.connect(lp);
        env(c, lp, 0.05, 2.0, 0.3, 0.22);
        o.start(0);
        lfo.start(0);
      }],
      ["LÁSER", 0.6, (c) => {
        const o = c.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(3200, 0);
        o.frequency.exponentialRampToValueAtTime(120, 0.45);
        env(c, o, 0.005, 0.05, 0.45, 0.3);
        o.start(0);
      }],
      ["IMPACTO", 2.2, (c) => {
        const len = Math.ceil(2.2 * sr);
        const noise = c.createBuffer(1, len, sr);
        const d = noise.getChannelData(0);
        for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / len, 3);
        const n = c.createBufferSource();
        n.buffer = noise;
        const lp = c.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(6000, 0);
        lp.frequency.exponentialRampToValueAtTime(200, 1.5);
        n.connect(lp);
        env(c, lp, 0.003, 0.05, 2, 0.8);
        const o = c.createOscillator();
        o.frequency.setValueAtTime(90, 0);
        o.frequency.exponentialRampToValueAtTime(35, 1.2);
        env(c, o, 0.003, 0.1, 1.4, 0.8);
        n.start(0);
        o.start(0);
      }],
    ];
    for (let k = 0; k < defs.length; k++) {
      if (this.samples[k]) continue;
      const [name, secs, build] = defs[k];
      try {
        const buffer = await make(secs, build);
        if (!this.samples[k]) this.samples[k] = { buffer, slot: { name, kind: "builtin" } };
      } catch {
        /* sin sonido incluido en esta ranura */
      }
    }
    this.onSamplesChange?.();
  }

  sampleSlots(): (SampleSlot | null)[] {
    return this.samples.map((s) => (s ? s.slot : null));
  }

  /**
   * Dispara la ranura (si ya sonaba, vuelve a empezar). Las ranuras en loop
   * prenden y apagan con cada toque.
   */
  playSample(slot: number) {
    const s = this.samples[slot];
    if (!s) return;
    void this.resume();
    const prev = this.samplePlaying[slot];
    if (prev) {
      try {
        prev.stop();
      } catch {
        /* ya terminó */
      }
      if (s.slot.loop) {
        this.samplePlaying[slot] = null;
        return;
      }
    }
    const dur = s.buffer.duration;
    const start = Math.max(0, Math.min(dur, s.slot.start ?? 0));
    const end = Math.max(start + 0.01, Math.min(dur, s.slot.end ?? dur));
    const src = this.ctx.createBufferSource();
    src.buffer = s.buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(2, s.slot.gain ?? 1));
    src.connect(gain).connect(this.samplerOut);
    src.onended = () => {
      if (this.samplePlaying[slot] === src) this.samplePlaying[slot] = null;
      src.disconnect();
      gain.disconnect();
    };
    if (s.slot.loop) {
      src.loop = true;
      src.loopStart = start;
      src.loopEnd = end;
      src.start(0, start);
    } else {
      src.start(0, start, end - start);
    }
    this.samplePlaying[slot] = src;
  }

  /** ¿La ranura está sonando? */
  samplePlayingNow(slot: number): boolean {
    return !!this.samplePlaying[slot];
  }

  /** Duración y forma de onda (picos 0..1) de una ranura, para el editor. */
  private sampleWaves = new WeakMap<AudioBuffer, { duration: number; peaks: number[] }>();

  sampleInfo(slot: number, buckets = 400): { duration: number; peaks: number[] } | null {
    const s = this.samples[slot];
    if (!s) return null;
    const cached = this.sampleWaves.get(s.buffer);
    if (cached) return cached;
    const ch = s.buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / buckets));
    const peaks: number[] = [];
    let max = 0;
    for (let b = 0; b < buckets; b++) {
      let m = 0;
      const from = b * step;
      for (let i = from; i < Math.min(ch.length, from + step); i += 4) m = Math.max(m, Math.abs(ch[i]));
      peaks.push(m);
      max = Math.max(max, m);
    }
    const info = { duration: s.buffer.duration, peaks: peaks.map((p) => (max ? p / max : 0)) };
    this.sampleWaves.set(s.buffer, info);
    return info;
  }

  /** Cambia nombre, recorte, volumen o loop de una ranura. */
  updateSampleSlot(slot: number, patch: Partial<Pick<SampleSlot, "name" | "start" | "end" | "gain" | "loop">>) {
    const s = this.samples[slot];
    if (!s) return;
    s.slot = { ...s.slot, ...patch };
    this.onSamplesChange?.();
  }

  /** Carga audio en una ranura (decodifica una copia del archivo). */
  async loadSample(slot: number, data: ArrayBuffer, info: SampleSlot): Promise<boolean> {
    try {
      const buffer = await this.decode(this.ctx, data);
      this.samples[slot] = { buffer, slot: info };
      this.onSamplesChange?.();
      return true;
    } catch {
      return false;
    }
  }

  /** Usa como sample una pista que ya está decodificada en el motor. */
  sampleFromTrack(slot: number, trackId: string, info: SampleSlot): boolean {
    const buffer = this.buffers.get(trackId);
    // las mezclas largas (Int16Pcm) no se usan como sample
    if (!(buffer instanceof AudioBuffer)) return false;
    this.samples[slot] = { buffer, slot: info };
    this.onSamplesChange?.();
    return true;
  }

  clearSample(slot: number) {
    this.samples[slot] = null;
    this.onSamplesChange?.();
  }

  setSamplerVolume(v: number) {
    this.samplerOut.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.02);
  }

  setEcho(deckId: DeckId, cfg: EchoConfig) {
    this.deck(deckId).setEcho(cfg, this.beatSeconds(deckId));
  }

  setReverse(deckId: DeckId, on: boolean) {
    void this.resume();
    this.deck(deckId).setReverse(on);
  }

  setBrake(deckId: DeckId, on: boolean, seconds: number) {
    void this.resume();
    this.deck(deckId).setBrake(on, seconds);
  }

  // ── REJILLA DE BEATS Y CUANTIZACIÓN ──────────────────────────────────

  /** BPM y primer beat de la pista del deck (null si no hay análisis). */
  /**
   * Milisegundos hasta el próximo beat del deck (0 si no hay rejilla, no
   * suena o la cuantización está apagada). Lo usan los efectos "al beat".
   */
  msToNextBeat(deckId: DeckId): number {
    const d = this.deck(deckId);
    const g = this.deckGrid(deckId);
    if (!this.quantize || !g || !d.playing) return 0;
    const beat = 60 / g.bpm;
    const into = (((d.position - g.firstBeat) % beat) + beat) % beat;
    const left = beat - into;
    // muy cerca del beat (o recién pasado): se aplica ya
    if (left < 0.012 || into < 0.012) return 0;
    return (left / Math.max(0.05, Math.abs(d.rate))) * 1000;
  }

  deckGrid(deckId: DeckId): { bpm: number; firstBeat: number } | null {
    const d = this.deck(deckId);
    const m = d.trackId ? this.meta.get(d.trackId) : undefined;
    return m?.bpm ? { bpm: m.bpm, firstBeat: m.firstBeat ?? 0 } : null;
  }

  /** Posición actual del deck (barato: para dibujar a 60 fps). */
  deckPosition(deckId: DeckId): number {
    return this.deck(deckId).position;
  }

  deckSlipGhost(deckId: DeckId): number | null {
    return this.deck(deckId).slipGhost;
  }

  deckDetail(deckId: DeckId): WaveDetail | null {
    return this.deck(deckId).detail;
  }

  deckDuration(deckId: DeckId): number {
    return this.deck(deckId).duration;
  }

  /**
   * Edita la rejilla de la pista cargada: corre el primer beat (shift, en
   * segundos), lo fija en la posición actual (setHere) o cambia el BPM
   * (bpmFactor x2 o /2, bpmDelta fino). Devuelve el análisis nuevo para
   * guardarlo en la biblioteca.
   */
  editGrid(
    deckId: DeckId,
    edit: { shift?: number; setHere?: boolean; bpmFactor?: number; bpmDelta?: number },
  ): TrackAnalysis | null {
    const d = this.deck(deckId);
    if (!d.trackId) return null;
    const m = this.meta.get(d.trackId);
    if (!m?.bpm) return null;
    let bpm = m.bpm;
    if (edit.bpmFactor) bpm *= edit.bpmFactor;
    if (edit.bpmDelta) bpm += edit.bpmDelta;
    bpm = Math.max(40, Math.min(250, bpm));
    const beat = 60 / bpm;
    let first = m.firstBeat ?? 0;
    if (edit.setHere) first = d.position;
    if (edit.shift) first += edit.shift;
    // el primer beat se guarda dentro del primer beat del tema
    first = ((first % beat) + beat) % beat;
    const next: TrackAnalysis = { ...m, bpm, firstBeat: first, edited: true };
    this.meta.set(d.trackId, next);
    this.refreshEcho(deckId);
    return next;
  }

  /** Lleva un tiempo al beat más cercano si la cuantización está activa. */
  private snap(deckId: DeckId, t: number): number {
    if (!this.quantize) return t;
    const g = this.deckGrid(deckId);
    if (!g) return t;
    const beat = 60 / g.bpm;
    return g.firstBeat + Math.round((t - g.firstBeat) / beat) * beat;
  }

  /**
   * Salto cuantizado: con el deck sonando, mantiene la fase del beat actual
   * para que el salto no rompa el tempo.
   */
  private quantizedJump(deckId: DeckId, target: number): number {
    const d = this.deck(deckId);
    if (!this.quantize || !d.playing) return target;
    const g = this.deckGrid(deckId);
    if (!g) return target;
    const beat = 60 / g.bpm;
    let diff = beatPhase(d.position, g.firstBeat, beat) - beatPhase(target, g.firstBeat, beat);
    while (diff > 0.5) diff -= 1;
    while (diff < -0.5) diff += 1;
    return target + diff * beat;
  }

  setCuePoint(deckId: DeckId, seconds: number) {
    const d = this.deck(deckId);
    d.cuePoint = clampTime(seconds, d.duration);
  }

  jumpToCue(deckId: DeckId) {
    const d = this.deck(deckId);
    d.seek(d.cuePoint);
  }

  toggleHotCue(deckId: DeckId, slot: number) {
    const d = this.deck(deckId);
    if (slot < 0 || slot >= d.cues.length) return;
    const cur = d.cues[slot];
    if (cur == null) {
      d.cues[slot] = clampTime(this.snap(deckId, d.position), d.duration);
    } else {
      d.seek(clampTime(this.quantizedJump(deckId, cur), d.duration));
    }
  }

  clearHotCue(deckId: DeckId, slot: number) {
    const d = this.deck(deckId);
    if (slot < 0 || slot >= d.cues.length) return;
    d.cues[slot] = null;
  }

  setChannelGain(deckId: DeckId, v: number) {
    this.deck(deckId).setChannelGain(v);
  }

  setEq(deckId: DeckId, band: "low" | "mid" | "high", v: number) {
    this.deck(deckId).setEq(band, v);
  }

  setFilter(deckId: DeckId, v: number) {
    this.deck(deckId).setFilter(v);
  }

  setPitch(deckId: DeckId, v: number) {
    this.deck(deckId).setPitch(v);
    this.refreshEcho(deckId);
  }

  setPitchRange(deckId: DeckId, pct: number) {
    this.deck(deckId).setPitchRange(pct);
    this.refreshEcho(deckId);
  }

  /** key lock: el pitch cambia el tempo pero no el tono */
  setKeyLock(deckId: DeckId, on: boolean) {
    this.deck(deckId).setKeyLock(on);
  }

  /** Crossfader: en el centro los dos decks a pleno (ver xfCurve.ts). */
  setCrossfader(v: number) {
    this.xfPos = Math.max(0, Math.min(1, v));
    const { a, b } = crossfaderGains(this.xfPos, this.xfCurve);
    this.deckA.setCrossfade(a);
    this.deckB.setCrossfade(b);
  }

  setCrossfaderCurve(curve: XfCurve) {
    this.xfCurve = curve;
    this.setCrossfader(this.xfPos);
  }

  setMasterGain(v: number) {
    this.master.gain.setTargetAtTime(Math.max(0, Math.min(1.2, v)), this.ctx.currentTime, 0.008);
  }

  private readonly masterBall = new MeterBallistics();

  /** Medidor del master en dBFS (después del limitador). */
  getMasterMeter(): MeterReading {
    const data = this.masterBuf;
    this.masterAnalyser.getFloatTimeDomainData(data);
    return this.masterBall.update(measure(data), performance.now());
  }

  deckState(id: DeckId): DeckRuntime {
    const s = this.deck(id).snapshot();
    const m = s.trackId ? this.meta.get(s.trackId) : undefined;
    return {
      ...s,
      bpm: m?.bpm ?? null,
      keyName: m?.keyName ?? null,
      camelot: m?.camelot ?? null,
      firstBeat: m?.firstBeat ?? 0,
    };
  }

  trackAnalysis(trackId: string): TrackAnalysis | null {
    return this.meta.get(trackId) ?? null;
  }

  currentTime(): number {
    return this.ctx.currentTime;
  }
}

/** Impulso sintético para el reverb: ruido estéreo con caída exponencial. */
/**
 * AudioContext a la frecuencia del dispositivo, pero nunca más de 48 kHz: con
 * placas a 96 o 192 kHz cada tema decodificado ocuparía el doble o el
 * cuádruple de memoria (y de CPU) sin ninguna diferencia audible.
 */
function cappedContext(Ctor: typeof AudioContext): AudioContext {
  const ctx = new Ctor({ latencyHint: "interactive" });
  if (ctx.sampleRate <= MAX_CONTEXT_RATE) return ctx;
  void ctx.close();
  return new Ctor({ latencyHint: "interactive", sampleRate: MAX_CONTEXT_RATE });
}

function impulseResponse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buffer;
}

export function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}
