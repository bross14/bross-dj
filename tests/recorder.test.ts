// Grabación: hoja CUE, FLAC propio, cortes por tema y Ogg Opus.
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, "..");
const rec = require(path.join(root, "electron/recorder.cjs"));
const enc = require(path.join(root, "electron/encode.cjs"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bross-rec-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** total de muestras que declara el STREAMINFO de un FLAC */
function flacFrames(file: string): number {
  const b = fs.readFileSync(file);
  expect(b.toString("latin1", 0, 4)).toBe("fLaC");
  return (b[21] & 0x0f) * 2 ** 32 + b.readUInt32BE(22);
}

function writeWav(file: string, sr: number, seconds: number) {
  const n = Math.round(sr * seconds);
  const pcm = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) {
    pcm[i * 2] = Math.round(8000 * Math.sin((2 * Math.PI * 330 * i) / sr));
    pcm[i * 2 + 1] = Math.round(6000 * Math.sin((2 * Math.PI * 220 * i) / sr));
  }
  fs.writeFileSync(file, Buffer.concat([enc.wavHeader(sr, 2, pcm.byteLength), Buffer.from(pcm.buffer)]));
  return n;
}

describe("grabación", () => {
  it("lista de temas y hoja CUE ordenadas y con nombres seguros", () => {
    const tracks = rec.normalizeTracks(
      [
        { sec: 65.5, title: 'Dos "B"', artist: "Y" },
        { sec: 0, title: "Uno", artist: "X" },
        { sec: 65.9, title: "duplicado", artist: "" },
        { sec: "x", title: "malo" },
      ],
      120,
    );
    expect(tracks.map((t: { title: string }) => t.title)).toEqual(["Uno", 'Dos "B"']);
    expect(rec.buildTracklist(tracks)).toBe("01. [00:00] X - Uno\r\n02. [01:05] Y - Dos \"B\"");
    const cue = rec.buildCue("set.flac", "flac", tracks);
    expect(cue).toContain('FILE "set.flac" WAVE');
    expect(cue).toContain("INDEX 01 01:05:37");
    expect(cue).toContain("TITLE \"Dos 'B'\"");
    expect(rec.safeName('a<b>:c?. ')).toBe("a_b__c_");
  });

  it("FLAC del set completo y un archivo por tema", async () => {
    const sr = 44100;
    const wav = path.join(tmp, "set.wav");
    const frames = writeWav(wav, sr, 3);
    const dir = path.join(tmp, "set");
    fs.mkdirSync(dir);
    const segments = [
      { start: 0, end: 1.25, file: path.join(dir, "01.flac"), title: "Uno", artist: "X", track: 1 },
      { start: 1.25, end: 3, file: path.join(dir, "02.flac"), title: "Dos", artist: "Y", track: 2 },
    ];
    await rec.runJob({ format: "flac", raw: wav, out: path.join(tmp, "set.flac"), sampleRate: sr, channels: 2, frames, segments, title: "set" });
    expect(flacFrames(path.join(tmp, "set.flac"))).toBe(frames);
    expect(flacFrames(segments[0].file) + flacFrames(segments[1].file)).toBe(frames);
    expect(flacFrames(segments[0].file)).toBe(Math.round(1.25 * sr));
    expect(fs.statSync(path.join(tmp, "set.flac")).size).toBeLessThan(fs.statSync(wav).size);
  });

  it("MP3 del set y por tema, con etiquetas ID3", async () => {
    const { readTags } = await import("../src/engine/tags");
    const sr = 44100;
    const wav = path.join(tmp, "m.wav");
    const frames = writeWav(wav, sr, 2);
    const seg = { start: 0, end: 1, file: path.join(tmp, "m-01.mp3"), title: "Uno", artist: "X", track: 1 };
    await rec.runJob({ format: "mp3", raw: wav, out: path.join(tmp, "m.mp3"), sampleRate: sr, channels: 2, frames, segments: [seg], title: "set mp3" });
    for (const [file, title] of [[path.join(tmp, "m.mp3"), "set mp3"], [seg.file, "Uno"]]) {
      const b = fs.readFileSync(file);
      expect(b.toString("latin1", 0, 3)).toBe("ID3");
      const tagLen = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]);
      // primer frame MPEG justo después del tag
      expect(b[tagLen]).toBe(0xff);
      expect(b[tagLen + 1] & 0xe0).toBe(0xe0);
      expect(readTags(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer).title).toBe(title);
    }
    // 192 kbps ≈ 24 KB por segundo
    expect(fs.statSync(path.join(tmp, "m.mp3")).size).toBeGreaterThan(40000);
  });

  it("cortes en WAV", async () => {
    const sr = 22050;
    const wav = path.join(tmp, "w.wav");
    const frames = writeWav(wav, sr, 2);
    const seg = { start: 0.5, end: 1.5, file: path.join(tmp, "w-01.wav"), title: "t", artist: "a", track: 1 };
    await rec.runJob({ format: "wav", raw: wav, out: wav, sampleRate: sr, channels: 2, frames, segments: [seg], title: "w" });
    const b = fs.readFileSync(seg.file);
    expect(b.readUInt32LE(40)).toBe(sr * 2 * 2);
    expect(b.subarray(44, 48).equals(fs.readFileSync(wav).subarray(44 + Math.round(0.5 * sr) * 4, 48 + Math.round(0.5 * sr) * 4))).toBe(true);
  });

  it("duración de paquetes Opus y páginas Ogg con CRC", () => {
    expect(enc.opusSamples(Buffer.from([0xfc]))).toBe(960); // CELT 20 ms
    expect(enc.opusSamples(Buffer.from([0x0b, 3]))).toBe(2880); // SILK 20 ms, código 3 con 3 frames
    const ogg: Buffer = enc.buildOgg(enc.defaultOpusHead(), [{ ms: 0, data: Buffer.from([0xfc, 1, 2]) }]);
    expect(ogg.toString("latin1", 0, 4)).toBe("OggS");
    expect(ogg[5]).toBe(2); // BOS
    // la última página es EOS y su granule incluye el pre-skip
    const last = ogg.lastIndexOf(Buffer.from("OggS"));
    expect(ogg[last + 5]).toBe(4);
    expect(ogg.readUInt32LE(last + 6)).toBe(312 + 960);
  });
});
