import { describe, expect, it } from "vitest";
import { CLIP_DB, METER_FLOOR_DB, MeterBallistics, measure, meterPos, toDb } from "../src/engine/meter";

const sine = (amp: number, n = 2048) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * i) / 64));

describe("medidor en dBFS", () => {
  it("convierte amplitud a dBFS con piso en −60", () => {
    expect(toDb(1)).toBeCloseTo(0, 6);
    expect(toDb(0.5)).toBeCloseTo(-6.02, 2);
    expect(toDb(0)).toBe(METER_FLOOR_DB);
    expect(toDb(1e-9)).toBe(METER_FLOOR_DB);
  });

  it("mide RMS y pico de una senoidal", () => {
    const m = measure(sine(1));
    expect(m.peak).toBeCloseTo(0, 1);
    // RMS de una senoidal = pico − 3,01 dB
    expect(m.rms).toBeCloseTo(-3.01, 1);
    expect(measure(new Float32Array(2048)).rms).toBe(METER_FLOOR_DB);
  });

  it("la escala es creciente y llega a los extremos", () => {
    expect(meterPos(-80)).toBe(0);
    expect(meterPos(0)).toBe(1);
    expect(meterPos(3)).toBe(1);
    expect(meterPos(-6)).toBeCloseTo(0.74, 6);
    let prev = -1;
    for (let db = -60; db <= 0; db += 0.5) {
      const p = meterPos(db);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it("retiene el pico 1,5 s y después cae", () => {
    const b = new MeterBallistics();
    b.update({ rms: -10, peak: -4 }, 1000);
    expect(b.update({ rms: -30, peak: -30 }, 2000).hold).toBe(-4);
    const later = b.update({ rms: -30, peak: -30 }, 2600);
    expect(later.hold).toBeLessThan(-4);
    expect(later.hold).toBeGreaterThanOrEqual(-30);
  });

  it("el VU sube al instante y baja suave", () => {
    const b = new MeterBallistics();
    b.update({ rms: -60, peak: -60 }, 0);
    expect(b.update({ rms: -6, peak: -3 }, 33).rms).toBe(-6);
    const fall = b.update({ rms: -60, peak: -60 }, 66).rms;
    expect(fall).toBeLessThan(-6);
    expect(fall).toBeGreaterThan(-60);
  });

  it("enciende la luz de clip en 0 dBFS y la apaga a los 2 s", () => {
    const b = new MeterBallistics();
    expect(b.update({ rms: -20, peak: -1 }, 0).clip).toBe(false);
    expect(b.update({ rms: -3, peak: CLIP_DB }, 100).clip).toBe(true);
    expect(b.update({ rms: -20, peak: -20 }, 1500).clip).toBe(true);
    expect(b.update({ rms: -20, peak: -20 }, 2200).clip).toBe(false);
  });
});
