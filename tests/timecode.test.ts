import { describe, expect, it } from "vitest";
import { TC_FREQ, TC_PERIOD, TimecodeDecoder, generateTimecode, lfsrNext, tcTable } from "../src/engine/timecode";

const SR = 44100;

/** Lee una señal con el decodificador en bloques de 128 (como el hilo de audio). */
function read(L: Float32Array, R: Float32Array, dec = new TimecodeDecoder(SR)) {
  const out = [];
  for (let i = 0; i + 128 <= L.length; i += 128) out.push(dec.process(L.subarray(i, i + 128), R.subarray(i, i + 128)));
  return out;
}

/** Remuestrea (velocidad ≠ 1 o hacia atrás) con interpolación lineal. */
function playAt(src: [Float32Array, Float32Array], start: number, speed: number, seconds: number): [Float32Array, Float32Array] {
  const n = Math.round(seconds * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = start * SR + i * speed;
    const k = Math.floor(p);
    const f = p - k;
    L[i] = src[0][k] * (1 - f) + src[0][k + 1] * f;
    R[i] = src[1][k] * (1 - f) + src[1][k + 1] * f;
  }
  return [L, R];
}

describe("timecode propio (DVS)", () => {
  it("el LFSR recorre todos los estados (período máximo)", () => {
    const t = tcTable();
    let filled = 0;
    for (let i = 1; i < t.length; i++) if (t[i] >= 0) filled++;
    expect(filled).toBe(TC_PERIOD);
    expect(lfsrNext(1)).not.toBe(1);
  });

  const tc = generateTimecode(30, SR);

  it("lee velocidad normal y la posición absoluta", () => {
    const [L, R] = playAt(tc, 10, 1, 2);
    const r = read(L, R);
    const last = r[r.length - 1];
    expect(last.speed).toBeCloseTo(1, 1);
    expect(last.position).not.toBeNull();
    expect(Math.abs(last.position! - 12)).toBeLessThan(0.02);
    expect(last.quality).toBeGreaterThan(0.8);
  });

  it("lee a otra velocidad y hacia atrás", () => {
    const slow = read(...playAt(tc, 5, 0.92, 2));
    expect(slow[slow.length - 1].speed).toBeCloseTo(0.92, 1);
    expect(Math.abs(slow[slow.length - 1].position! - (5 + 0.92 * 2))).toBeLessThan(0.03);
    const back = read(...playAt(tc, 20, -1, 2));
    expect(back[back.length - 1].speed).toBeCloseTo(-1, 1);
    expect(Math.abs(back[back.length - 1].position! - 18)).toBeLessThan(0.03);
  });

  it("con los cables al revés gira al revés; swap lo corrige", () => {
    const [L, R] = playAt(tc, 3, 1, 1);
    expect(read(R, L).at(-1)!.speed).toBeLessThan(-0.8);
    const dec = new TimecodeDecoder(SR);
    dec.swap = true;
    expect(read(R, L, dec).at(-1)!.speed).toBeGreaterThan(0.8);
  });

  it("sin señal: velocidad cero", () => {
    const z = new Float32Array(SR / 2);
    expect(read(z, z).at(-1)!.speed).toBe(0);
    expect(TC_FREQ).toBe(2000);
  });
});

describe("WAV de timecode del proceso principal", () => {
  it("lo que genera electron/timecodegen.cjs se lee con el decodificador", async () => {
    const { createRequire } = await import("module");
    const fs = await import("fs");
    const os = await import("os");
    const path = await import("path");
    const require = createRequire(import.meta.url);
    const { writeTimecodeWav } = require(path.resolve(__dirname, "../electron/timecodegen.cjs"));
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bross-tc-")), "tc.wav");
    writeTimecodeWav(file, 4);
    const b = fs.readFileSync(file);
    const n = (b.length - 44) / 4;
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      L[i] = b.readInt16LE(44 + i * 4) / 32768;
      R[i] = b.readInt16LE(46 + i * 4) / 32768;
    }
    const r = read(L.subarray(SR * 2), R.subarray(SR * 2)).at(-1)!;
    expect(r.speed).toBeCloseTo(1, 1);
    expect(Math.abs(r.position! - 4)).toBeLessThan(0.02);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });
});
