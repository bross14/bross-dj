// Grabación del set. La ruta la decide el proceso principal (Música/BROSS DJ),
// nunca el renderer.
//
// - WAV / FLAC: el renderer manda PCM 16 bits y acá se escribe un WAV a
//   medida que llega. Al cortar, si se pidió FLAC se codifica en un worker y
//   se borra el WAV.
// - OGG: el renderer graba Opus con MediaRecorder (sale en WebM) y manda los
//   bloques ya codificados; al cortar se re-empaqueta en Ogg sin recodificar.
// - Con "dividir por tema" se arma además una carpeta con un archivo por tema,
//   cortando donde empezó cada pista del historial.
// Siempre se escribe la lista de temas (.txt) y la hoja CUE (.cue).
const fs = require("fs");
const path = require("path");
const { Worker } = require("worker_threads");
const { wavHeader } = require("./encode.cjs");

const FORMATS = new Set(["wav", "flac", "mp3", "ogg"]);

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/** Nombre de archivo seguro en Windows. */
function safeName(s) {
  return (
    String(s)
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/[. ]+$/g, "")
      .trim()
      .slice(0, 120) || "tema"
  );
}

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Temas válidos, ordenados y sin duplicados de tiempo. */
function normalizeTracks(tracks, seconds) {
  if (!Array.isArray(tracks)) return [];
  const out = [];
  for (const t of tracks) {
    if (!t || typeof t.sec !== "number" || !Number.isFinite(t.sec)) continue;
    const sec = Math.max(0, Math.min(seconds, t.sec));
    const title = typeof t.title === "string" ? t.title.slice(0, 300) : "";
    const artist = typeof t.artist === "string" ? t.artist.slice(0, 300) : "";
    out.push({ sec, title, artist });
  }
  out.sort((a, b) => a.sec - b.sec);
  return out.filter((t, i) => i === 0 || t.sec - out[i - 1].sec >= 1);
}

function buildTracklist(tracks) {
  return tracks
    .map((t, i) => `${String(i + 1).padStart(2, "0")}. [${mmss(t.sec)}] ${t.artist ? `${t.artist} - ${t.title}` : t.title}`)
    .join("\r\n");
}

function buildCue(fileName, format, tracks) {
  const q = (v) => String(v).replace(/"/g, "'");
  const type = format === "wav" || format === "flac" ? "WAVE" : "MP3";
  return [
    `PERFORMER "BROSS DJ"`,
    `TITLE "${q(fileName.replace(/\.[^.]+$/, ""))}"`,
    `FILE "${q(fileName)}" ${type}`,
    ...tracks.flatMap((t, i) => {
      const frames = Math.floor((t.sec % 1) * 75);
      const idx = `${String(Math.floor(t.sec / 60)).padStart(2, "0")}:${String(Math.floor(t.sec % 60)).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
      return [
        `  TRACK ${String(i + 1).padStart(2, "0")} AUDIO`,
        `    TITLE "${q(t.title)}"`,
        `    PERFORMER "${q(t.artist || "Desconocido")}"`,
        `    INDEX 01 ${idx}`,
      ];
    }),
  ].join("\r\n");
}

/** Corre una conversión en un worker para no frenar la ventana. */
function runJob(job) {
  return new Promise((resolve, reject) => {
    // en la app instalada el worker vive fuera del .asar (ver asarUnpack)
    const file = path.join(__dirname, "encode-worker.cjs").replace(/app\.asar(?=[\\/])/, "app.asar.unpacked");
    const w = new Worker(file, { workerData: job });
    w.once("message", (m) => (m?.ok ? resolve(m) : reject(new Error(m?.error ?? "error"))));
    w.once("error", reject);
    w.once("exit", (code) => code !== 0 && reject(new Error(`worker ${code}`)));
  });
}

function registerRecorderIpc(ipcMain, app) {
  let rec = null;

  ipcMain.handle("bross:rec-start", async (_e, opts) => {
    if (rec) return null;
    const format = FORMATS.has(opts?.format) ? opts.format : "wav";
    const sampleRate = Number(opts?.sampleRate) || 48000;
    const channels = opts?.channels === 1 ? 1 : 2;
    // BROSS_REC_DIR: otra carpeta (pruebas)
    const dir = process.env.BROSS_REC_DIR || path.join(app.getPath("music"), "BROSS DJ");
    await fs.promises.mkdir(dir, { recursive: true });
    const base = path.join(dir, `set_${stamp()}`);
    // WAV, FLAC y MP3 se graban como WAV; OGG llega como WebM (Opus)
    const raw = format === "ogg" ? `${base}.webm` : `${base}.wav`;
    const stream = fs.createWriteStream(raw);
    if (format !== "ogg") stream.write(wavHeader(sampleRate, channels, 0));
    rec = { base, raw, format, stream, sampleRate, channels, bytes: 0, split: !!opts?.split, startedAt: Date.now() };
    return { path: `${base}.${format}` };
  });

  // bloques de audio: send (sin respuesta) para no frenar el renderer
  ipcMain.on("bross:rec-chunk", (_e, chunk) => {
    if (!rec || !(chunk instanceof Uint8Array)) return;
    rec.bytes += chunk.byteLength;
    rec.stream.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  });

  ipcMain.handle("bross:rec-stop", async (_e, extra) => {
    if (!rec) return null;
    const r = rec;
    rec = null;
    await new Promise((resolve) => r.stream.end(resolve));
    const pcm = r.format !== "ogg";
    if (pcm) {
      // tamaños reales en el encabezado
      const fd = await fs.promises.open(r.raw, "r+");
      try {
        await fd.write(wavHeader(r.sampleRate, r.channels, r.bytes), 0, 44, 0);
      } finally {
        await fd.close();
      }
    }
    const seconds = pcm ? r.bytes / (r.sampleRate * r.channels * 2) : Math.max(0, (Date.now() - r.startedAt) / 1000);
    const tracks = normalizeTracks(extra?.tracks, seconds);
    const finalFile = `${r.base}.${r.format}`;
    const fileName = path.basename(finalFile);
    await fs.promises.writeFile(`${r.base}.txt`, buildTracklist(tracks), "utf8");
    await fs.promises.writeFile(`${r.base}.cue`, buildCue(fileName, r.format, tracks), "utf8");

    // cortes por tema (solo si hay más de uno)
    const splitDir = r.split && tracks.length > 1 ? r.base : null;
    const segments = splitDir
      ? tracks.map((t, i) => ({
          start: t.sec,
          end: i + 1 < tracks.length ? tracks[i + 1].sec : seconds,
          file: path.join(splitDir, `${String(i + 1).padStart(2, "0")} - ${safeName(t.artist ? `${t.artist} - ${t.title}` : t.title)}.${r.format}`),
          title: t.title,
          artist: t.artist,
          track: i + 1,
        }))
      : [];
    if (splitDir) await fs.promises.mkdir(splitDir, { recursive: true });

    let warning = null;
    try {
      if (r.format !== "wav" || segments.length) {
        await runJob({
          format: r.format,
          raw: r.raw,
          out: finalFile,
          sampleRate: r.sampleRate,
          channels: r.channels,
          frames: pcm ? Math.floor(r.bytes / (r.channels * 2)) : 0,
          segments,
          title: path.basename(r.base),
        });
        if (r.raw !== finalFile) await fs.promises.rm(r.raw, { force: true });
      }
    } catch (e) {
      // si falla la conversión queda el archivo crudo (no se pierde el set)
      warning = `No se pudo convertir: ${e instanceof Error ? e.message : String(e)}`;
      return { path: r.raw, seconds, warning, split: null };
    }
    return { path: finalFile, seconds, warning, split: splitDir ? { dir: splitDir, count: segments.length } : null };
  });

  // ── grabación de video (WebM o MP4 ya codificado por MediaRecorder) ──
  // Va aparte de la de audio: se pueden grabar las dos a la vez.
  let vrec = null;
  ipcMain.handle("bross:vrec-start", async (_e, opts) => {
    if (vrec) return null;
    const ext = opts?.format === "mp4" ? "mp4" : "webm";
    const dir = path.join(process.env.BROSS_REC_DIR || path.join(app.getPath("music"), "BROSS DJ"), "video");
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, `video_${stamp()}.${ext}`);
    vrec = { file, stream: fs.createWriteStream(file), bytes: 0, startedAt: Date.now() };
    return { path: file };
  });
  ipcMain.on("bross:vrec-chunk", (_e, chunk) => {
    if (!vrec || !(chunk instanceof Uint8Array)) return;
    vrec.bytes += chunk.byteLength;
    vrec.stream.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  });
  ipcMain.handle("bross:vrec-stop", async () => {
    if (!vrec) return null;
    const v = vrec;
    vrec = null;
    await new Promise((resolve) => v.stream.end(resolve));
    return { path: v.file, seconds: (Date.now() - v.startedAt) / 1000, bytes: v.bytes };
  });
}

module.exports = { registerRecorderIpc, wavHeader, buildCue, buildTracklist, normalizeTracks, safeName, runJob };
