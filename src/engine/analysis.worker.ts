// Worker de análisis: todo el trabajo pesado sobre el PCM de una pista
// (onda, bandas, downsample, BPM y tonalidad) fuera del hilo principal.
import { analyzeTrack, type TrackAnalysis } from "./analysis";
import { computeBands, computeDetail, computePeaks, downsample, type BandPeaks, type WaveDetail } from "./waveform";

export interface WorkerJob {
  id: number;
  /** canal de audio (mono o canal izquierdo) */
  samples: Float32Array;
  sampleRate: number;
  /** calcular picos y bandas para el waveform */
  waveform: boolean;
  /** calcular BPM y tonalidad */
  analyze: boolean;
}

export interface WorkerResult {
  id: number;
  analysis: TrackAnalysis | null;
  peaks: number[] | null;
  bands: BandPeaks | null;
  /** onda detallada para la vista con zoom */
  detail: WaveDetail | null;
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerJob>) => void) | null;
  postMessage: (message: WorkerResult, transfer?: Transferable[]) => void;
};

ctx.onmessage = (e) => {
  const { id, samples, sampleRate, waveform, analyze } = e.data;
  const peaks = waveform ? computePeaks(samples) : null;
  const bands = waveform ? computeBands(samples, sampleRate) : null;
  const detail = waveform ? computeDetail(samples, sampleRate) : null;
  let analysis: TrackAnalysis | null = null;
  if (analyze) {
    const mono = downsample(samples, sampleRate);
    analysis = analyzeTrack(mono, Math.min(sampleRate, 22050));
  }
  ctx.postMessage(
    { id, analysis, peaks, bands, detail },
    detail ? [detail.low.buffer, detail.mid.buffer, detail.high.buffer] : [],
  );
};
