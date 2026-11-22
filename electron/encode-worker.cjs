// Worker de conversión de la grabación (ver recorder.cjs).
const fs = require("fs");
const { parentPort, workerData } = require("worker_threads");
const {
  encodeFlacTo,
  encodeMp3To,
  wavRangeReader,
  writeWavRange,
  parseWebmOpus,
  buildOgg,
  defaultOpusHead,
} = require("./encode.cjs");

async function run(job) {
  const { format, raw, out, sampleRate, channels, frames, segments, title } = job;
  if (format === "wav" || format === "flac" || format === "mp3") {
    // el codificador MP3 (LAME en JS) solo trae build ESM usable
    const Mp3Encoder = format === "mp3" ? (await import("@breezystack/lamejs")).Mp3Encoder : null;
    const encode = (file, start, end, tags) => {
      const r = wavRangeReader(raw, channels, start, end);
      try {
        const readChunk = (n) => r.read(n);
        if (format === "mp3") {
          encodeMp3To(file, { Mp3Encoder, sampleRate, channels, readChunk, tags });
        } else {
          const comments = Object.entries(tags).map(([k, v]) => `${k.toUpperCase()}=${v}`);
          encodeFlacTo(file, { sampleRate, channels, totalFrames: end - start, readChunk, comments });
        }
      } finally {
        r.close();
      }
    };
    if (format !== "wav") encode(out, 0, frames, { title, artist: "BROSS DJ" });
    for (const s of segments) {
      const a = Math.max(0, Math.min(frames, Math.round(s.start * sampleRate)));
      const b = Math.max(a, Math.min(frames, Math.round(s.end * sampleRate)));
      if (format === "wav") writeWavRange(raw, s.file, sampleRate, channels, a, b);
      else encode(s.file, a, b, { title: s.title, artist: s.artist, album: title, tracknumber: String(s.track) });
    }
    return;
  }
  if (format === "ogg") {
    const { head, packets } = parseWebmOpus(fs.readFileSync(raw));
    const h = head ?? defaultOpusHead();
    fs.writeFileSync(out, buildOgg(h, packets, [`TITLE=${title}`, "ARTIST=BROSS DJ"]));
    const t0 = packets.length ? packets[0].ms : 0;
    for (const s of segments) {
      const part = packets.filter((p) => p.ms - t0 >= s.start * 1000 && p.ms - t0 < s.end * 1000);
      fs.writeFileSync(
        s.file,
        buildOgg(h, part, [`TITLE=${s.title}`, `ARTIST=${s.artist}`, `TRACKNUMBER=${s.track}`, `ALBUM=${title}`]),
      );
    }
  }
}

run(workerData).then(
  () => parentPort.postMessage({ ok: true }),
  (e) => parentPort.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) }),
);
