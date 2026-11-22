// Genera el WAV de timecode propio (ver src/engine/timecode.ts: mismo
// formato) para grabarlo en un vinilo o un CD de control. Se escribe por
// partes para no ocupar memoria (8 min ≈ 85 MB).
const fs = require("fs");
const path = require("path");
const { wavHeader } = require("./encode.cjs");

const FREQ = 2000;
const BITS = 20;
const PERIOD = (1 << BITS) - 1;
const LOW = 0.65;

function lfsrNext(s) {
  const fb = (s ^ (s >> 3)) & 1;
  return (s >>> 1) | (fb << (BITS - 1));
}

/** Escribe `seconds` de timecode estéreo 16 bits en `file`. Devuelve los segundos escritos. */
function writeTimecodeWav(file, seconds, sampleRate = 44100, level = 0.8) {
  const secs = Math.min(seconds, PERIOD / FREQ);
  const total = Math.round(secs * sampleRate);
  const fd = fs.openSync(file, "w");
  try {
    fs.writeSync(fd, wavHeader(sampleRate, 2, total * 4));
    const w = (2 * Math.PI * FREQ) / sampleRate;
    let s = 1;
    let cycle = 0;
    const CHUNK = sampleRate;
    for (let start = 0; start < total; start += CHUNK) {
      const n = Math.min(CHUNK, total - start);
      const buf = Buffer.alloc(n * 4);
      for (let k = 0; k < n; k++) {
        const i = start + k;
        const c = Math.floor((i * FREQ) / sampleRate);
        while (cycle < c) {
          s = lfsrNext(s);
          cycle++;
        }
        const a = level * (s & 1 ? 1 : LOW);
        const th = w * i;
        buf.writeInt16LE(Math.round(a * Math.sin(th) * 32767), k * 4);
        buf.writeInt16LE(Math.round(a * Math.cos(th) * 32767), k * 4 + 2);
      }
      fs.writeSync(fd, buf);
    }
  } finally {
    fs.closeSync(fd);
  }
  return secs;
}

function registerTimecodeIpc(ipcMain, app) {
  ipcMain.handle("bross:tc-generate", async (_e, minutes) => {
    const m = Math.max(1, Math.min(8.7, Number(minutes) || 8));
    const dir = process.env.BROSS_REC_DIR || path.join(app.getPath("music"), "BROSS DJ");
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, "bross-timecode.wav");
    const seconds = writeTimecodeWav(file, m * 60);
    return { path: file, seconds };
  });
}

module.exports = { writeTimecodeWav, registerTimecodeIpc };
