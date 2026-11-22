// BPM de la entrada de línea / micrófono: se analiza la ventana de los
// últimos segundos fuera del hilo principal.
import { detectBpm } from "./analysis";
import { downsample } from "./waveform";

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => void) | null;
  postMessage: (m: { bpm: number; confidence: number; level: number }) => void;
};

ctx.onmessage = (e) => {
  const { samples, sampleRate } = e.data;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 8) sum += samples[i] * samples[i];
  const level = Math.sqrt(sum / Math.max(1, samples.length / 8));
  if (level < 0.005) {
    ctx.postMessage({ bpm: 0, confidence: 0, level });
    return;
  }
  const mono = downsample(samples, sampleRate);
  const est = detectBpm(mono, Math.min(sampleRate, 22050));
  ctx.postMessage({ bpm: est.bpm, confidence: est.confidence, level });
};
