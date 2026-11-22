// Detección de tempo con patrones de batería típicos de música de baile.
import { describe, expect, it } from "vitest";
import { detectBpm } from "../src/engine/analysis";
import { downsample } from "../src/engine/waveform";
import { SR, beat } from "./helpers";

/** acorde + bombo en cada beat + click en corcheas */
function chordKick(bpm: number, seconds: number) {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  const b = 60 / bpm;
  let next = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 261.6 * t) + Math.sin(2 * Math.PI * 329.6 * t)) * 0.14;
    const tb = t % b;
    if (tb < 0.16) {
      const e = Math.exp(-tb * 32);
      v += Math.sin(2 * Math.PI * (52 + 80 * e) * tb) * e * 0.75;
    }
    if (t >= next) {
      v += (Math.random() * 2 - 1) * 0.2;
      next += b / 2;
    }
    out[i] = v;
  }
  return out;
}

/** house: bombo en cada beat, clap en 2 y 4, hi-hat a contratiempo */
function house(bpm: number, seconds: number) {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  const b = 60 / bpm;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const tb = t % b;
    const beatN = Math.floor(t / b) % 4;
    if (tb < 0.2) {
      const e = Math.exp(-tb * 25);
      out[i] += Math.sin(2 * Math.PI * (50 + 70 * e) * tb) * e * 0.9;
    }
    if ((beatN === 1 || beatN === 3) && tb < 0.08) out[i] += (Math.random() * 2 - 1) * 0.5 * Math.exp(-tb * 40);
    const off = (t + b / 2) % b;
    if (off < 0.03) out[i] += (Math.random() * 2 - 1) * 0.25 * (1 - off / 0.03);
  }
  return out;
}

const PATTERNS: [string, (bpm: number, s: number) => Float32Array][] = [
  ["bombo + hi-hats en corcheas", (b, s) => beat(b, s)],
  ["acorde + bombo", chordKick],
  ["house", house],
];

describe.each(PATTERNS)("tempo exacto: %s", (_name, gen) => {
  it.each([90, 120, 128, 140, 174])("%i BPM", (bpm) => {
    const est = detectBpm(downsample(gen(bpm, 30), SR, 22050), 22050);
    expect(Math.abs(est.bpm - bpm) / bpm).toBeLessThan(0.005);
  });
});

describe("primer beat", () => {
  it.each([0.1, 0.3])("arranque desplazado %f s", (offset) => {
    const bpm = 125;
    const period = 60 / bpm;
    const est = detectBpm(downsample(beat(bpm, 30, SR, offset), SR, 22050), 22050);
    // la rejilla debe caer sobre los bombos (±15 ms)
    let d = Math.abs((((est.firstBeat - offset) % period) + period) % period);
    d = Math.min(d, period - d);
    expect(d).toBeLessThan(0.015);
  });
});
