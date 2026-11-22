// Mezclas largas: lectura de frames MP3 y PCM en 16 bits.
import { describe, expect, it } from "vitest";
import { STREAM_MIN_SECONDS, estimateMp3Seconds, scanMp3 } from "../src/engine/mp3stream";
import { Int16Pcm, deckChannels, floatToInt16, jobSamples } from "../src/engine/pcm";

/** MP3 sintético: frames MPEG-1 capa III a 128 kbps / 44,1 kHz (cabecera válida, datos en cero). */
function fakeMp3(frames: number, opts: { id3?: number; junkAt?: number } = {}): Uint8Array {
  const frameLen = Math.floor((144 * 128000) / 44100); // 417 bytes sin padding
  const id3 = opts.id3 ?? 0;
  const junk = opts.junkAt != null ? 7 : 0;
  const out = new Uint8Array((id3 ? 10 + id3 : 0) + frames * frameLen + junk);
  let p = 0;
  if (id3) {
    out.set([0x49, 0x44, 0x33, 3, 0, 0], 0);
    out[6] = (id3 >> 21) & 0x7f;
    out[7] = (id3 >> 14) & 0x7f;
    out[8] = (id3 >> 7) & 0x7f;
    out[9] = id3 & 0x7f;
    p = 10 + id3;
  }
  for (let f = 0; f < frames; f++) {
    if (f === opts.junkAt) p += junk; // bytes sueltos en el medio
    out.set([0xff, 0xfb, 0x90, 0x44], p); // MPEG-1, capa III, 128 kbps, 44,1 kHz, estéreo conjunto
    p += frameLen;
  }
  return out;
}

describe("MP3 por partes", () => {
  it("encuentra todos los frames, saltando la etiqueta ID3v2", () => {
    const layout = scanMp3(fakeMp3(500, { id3: 1234 }))!;
    expect(layout.count).toBe(500);
    expect(layout.sampleRate).toBe(44100);
    expect(layout.channels).toBe(2);
    expect(layout.samplesPerFrame).toBe(1152);
    expect(layout.offsets[0]).toBe(10 + 1234);
  });

  it("se resincroniza si hay basura entre frames", () => {
    expect(scanMp3(fakeMp3(300, { junkAt: 150 }))!.count).toBe(300);
  });

  it("estima la duración con el bitrate del primer frame", () => {
    const frames = 2000;
    const exact = (frames * 1152) / 44100;
    expect(estimateMp3Seconds(fakeMp3(frames))!).toBeCloseTo(exact, 0);
    // una mezcla de 2 horas a 128 kbps supera el umbral; un tema de 4 minutos no
    expect(STREAM_MIN_SECONDS).toBeGreaterThan(4 * 60);
    expect(STREAM_MIN_SECONDS).toBeLessThan(2 * 3600);
  });

  it("no confunde otros archivos con un MP3", () => {
    expect(scanMp3(new Uint8Array(4096))).toBeNull();
    expect(estimateMp3Seconds(new TextEncoder().encode("RIFF....WAVEfmt "))).toBeNull();
  });
});

describe("PCM en 16 bits", () => {
  it("convierte float a 16 bits recortando", () => {
    const out = floatToInt16(new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]));
    expect(Array.from(out)).toEqual([0, 16384, -16383, 32767, -32768, 32767, -32768]);
  });

  it("el deck recibe los canales sin copiar (o copiados si la pista se conserva)", () => {
    const L = new Int16Array([1, 2, 3]);
    const R = new Int16Array([4, 5, 6]);
    const pcm = new Int16Pcm([L, R], 48000);
    expect(deckChannels(pcm, false)[0]).toBe(L);
    const kept = deckChannels(pcm, true);
    expect(kept[1]).not.toBe(R);
    expect(Array.from(kept[1])).toEqual([4, 5, 6]);
  });

  it("baja la frecuencia de lo que va al análisis en pistas largas", () => {
    const n = 48000 * 2;
    const ch = new Int16Array(n).fill(16384);
    const { samples, sampleRate } = jobSamples(new Int16Pcm([ch, ch], 48000));
    expect(sampleRate).toBe(24000);
    expect(samples.length).toBe(n / 2);
    expect(samples[10]).toBeCloseTo(0.5, 5);
  });
});
