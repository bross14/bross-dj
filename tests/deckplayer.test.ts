// El reproductor del hilo de audio, corriendo fuera del navegador:
// se simulan los globales del AudioWorklet y se mide lo que sale.
import { beforeAll, describe, expect, it } from "vitest";
import { SR, rms, sine, zeroCrossFreq } from "./helpers";

type Proc = {
  port: { onmessage: ((e: { data: unknown }) => void) | null; postMessage: (m: unknown) => void };
  process(i: Float32Array[][], o: Float32Array[][]): boolean;
};

const registry = new Map<string, new () => Proc>();

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.sampleRate = SR;
  g.currentTime = 0;
  g.AudioWorkletProcessor = class {
    port = { onmessage: null as ((e: { data: unknown }) => void) | null, postMessage: (_m: unknown) => undefined };
  };
  g.registerProcessor = (name: string, ctor: new () => Proc) => registry.set(name, ctor);
  await import("../src/engine/worklets/processors");
});

function deck(buffer: Float32Array) {
  const P = registry.get("bross-deck")!;
  const p = new P();
  const reports: { pos: number; rate: number; ended: boolean }[] = [];
  p.port.postMessage = (m: unknown) => reports.push(m as never);
  const send = (data: unknown) => p.port.onmessage?.({ data });
  send({ type: "buffer", channels: [buffer, buffer] });
  const render = (seconds: number) => {
    const blocks = Math.round((seconds * SR) / 128);
    const out = new Float32Array(blocks * 128);
    for (let b = 0; b < blocks; b++) {
      const L = new Float32Array(128);
      const R = new Float32Array(128);
      p.process([], [[L, R]]);
      out.set(L, b * 128);
    }
    return out;
  };
  return { send, render, reports };
}

describe("reproductor del deck", () => {
  const tone = sine(440, 20);

  it("a velocidad normal suena a 440 Hz", () => {
    const d = deck(tone);
    d.send({ type: "start", pos: 1, rate: 1, seq: 1 });
    expect(zeroCrossFreq(d.render(1).subarray(SR * 0.1))).toBeCloseTo(440, 0);
  });

  it("sin key-lock, +8 % sube el tono 8 %", () => {
    const d = deck(tone);
    d.send({ type: "start", pos: 1, rate: 1.08, seq: 1 });
    expect(zeroCrossFreq(d.render(1).subarray(SR * 0.1))).toBeCloseTo(475.2, 0);
  });

  it("con key-lock, +8 % mantiene 440 Hz y avanza 8 % más rápido", () => {
    const d = deck(tone);
    d.send({ type: "keylock", on: true, pitch: 1 });
    d.send({ type: "start", pos: 1, rate: 1.08, seq: 1 });
    const out = d.render(2);
    expect(Math.abs(zeroCrossFreq(out.subarray(SR * 0.2)) - 440)).toBeLessThan(1.5);
    const last = d.reports[d.reports.length - 1];
    expect(last.pos - 1).toBeCloseTo(2 * 1.08, 1);
    // sin cortes: el nivel se mantiene parejo de punta a punta
    const a = rms(out.subarray(SR * 0.3, SR * 0.8));
    const b = rms(out.subarray(SR * 1.3, SR * 1.8));
    expect(Math.abs(a - b) / a).toBeLessThan(0.05);
  });

  it("con key-lock, −8 % también mantiene el tono", () => {
    const d = deck(tone);
    d.send({ type: "keylock", on: true, pitch: 1 });
    d.send({ type: "start", pos: 1, rate: 0.92, seq: 1 });
    expect(Math.abs(zeroCrossFreq(d.render(2).subarray(SR * 0.2)) - 440)).toBeLessThan(1.5);
  });

  it("key-sync transpone 3 semitonos abajo", () => {
    const d = deck(tone);
    d.send({ type: "keylock", on: true, pitch: Math.pow(2, -3 / 12) });
    d.send({ type: "start", pos: 1, rate: 1, seq: 1 });
    expect(Math.abs(zeroCrossFreq(d.render(2).subarray(SR * 0.2)) - 440 * Math.pow(2, -3 / 12))).toBeLessThan(1.5);
  });

  it("reverse retrocede", () => {
    const d = deck(tone);
    d.send({ type: "start", pos: 5, rate: -1, seq: 1 });
    d.render(1);
    expect(d.reports[d.reports.length - 1].pos).toBeCloseTo(4, 1);
  });

  it("el loop vuelve al inicio", () => {
    const d = deck(tone);
    d.send({ type: "loop", start: 2, end: 3 });
    d.send({ type: "start", pos: 2, rate: 1, seq: 1 });
    d.render(2.5);
    const pos = d.reports[d.reports.length - 1].pos;
    expect(pos).toBeGreaterThanOrEqual(2);
    expect(pos).toBeLessThan(3);
  });

  it("el loop también funciona con key-lock", () => {
    const d = deck(tone);
    d.send({ type: "keylock", on: true, pitch: 1 });
    d.send({ type: "loop", start: 2, end: 3 });
    d.send({ type: "start", pos: 2, rate: 1, seq: 1 });
    d.render(2.5);
    const pos = d.reports[d.reports.length - 1].pos;
    expect(pos).toBeGreaterThanOrEqual(2);
    expect(pos).toBeLessThan(3.1);
  });

  it("al final de la pista avisa que terminó", () => {
    const d = deck(sine(440, 1));
    d.send({ type: "start", pos: 0.5, rate: 1, seq: 1 });
    d.render(1);
    expect(d.reports.some((r) => r.ended)).toBe(true);
  });

  it("stop hace fade y deja de sonar", () => {
    const d = deck(tone);
    d.send({ type: "start", pos: 1, rate: 1, seq: 1 });
    d.render(0.2);
    d.send({ type: "stop", seq: 2 });
    const out = d.render(0.2);
    expect(rms(out.subarray(SR * 0.05))).toBe(0);
  });
});
