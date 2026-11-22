// Video en vivo por RTMP (YouTube, Twitch, Facebook…). La app no trae un
// codificador H.264/AAC, así que usa el ffmpeg instalado en la PC: el
// renderer graba el mezclador de video en WebM y acá se le pasa a ffmpeg por
// stdin, que lo convierte a FLV y lo manda al servidor.
const { spawn, execFile } = require("child_process");

/** ¿Hay ffmpeg? Devuelve la versión o null. */
function findFfmpeg(bin = "ffmpeg") {
  return new Promise((resolve) => {
    execFile(bin, ["-version"], { timeout: 5000, windowsHide: true }, (err, out) => {
      if (err) return resolve(null);
      resolve(String(out).split("\n")[0].trim());
    });
  });
}

/** Argumentos de ffmpeg (sin shell: la URL va como un argumento más). */
function ffmpegArgs(url, kbps = 4500) {
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-fflags", "+genpts",
    "-i", "pipe:0",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-tune", "zerolatency",
    "-pix_fmt", "yuv420p",
    "-g", "60",
    "-b:v", `${kbps}k`,
    "-maxrate", `${kbps}k`,
    "-bufsize", `${kbps * 2}k`,
    "-c:a", "aac",
    "-b:a", "160k",
    "-ar", "44100",
    "-f", "flv",
    url,
  ];
}

function registerRtmpIpc(ipcMain, BrowserWindow) {
  let proc = null;
  let lastError = "";
  const send = (s) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send("bross:rtmp-status", s);
  };

  ipcMain.handle("bross:rtmp-check", () => findFfmpeg());

  ipcMain.handle("bross:rtmp-start", async (_e, opts) => {
    if (proc) return { ok: false, error: "Ya está transmitiendo" };
    const url = String(opts?.url ?? "").trim();
    const key = String(opts?.key ?? "").trim();
    if (!/^rtmps?:\/\/[^\s]+$/i.test(url)) return { ok: false, error: "La URL tiene que empezar con rtmp:// o rtmps://" };
    if (/[\s]/.test(key)) return { ok: false, error: "La clave de transmisión no puede tener espacios" };
    const version = await findFfmpeg();
    if (!version) return { ok: false, error: "No se encontró ffmpeg. Instalalo (winget install Gyan.FFmpeg) y reiniciá la app." };
    const target = key ? `${url.replace(/\/+$/, "")}/${key}` : url;
    lastError = "";
    proc = spawn("ffmpeg", ffmpegArgs(target, Number(opts?.kbps) || 4500), { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
    proc.stderr.on("data", (d) => {
      lastError = String(d).trim().split("\n").pop() ?? lastError;
    });
    proc.on("exit", (code) => {
      const was = proc;
      proc = null;
      if (was) send({ live: false, error: code ? lastError || `ffmpeg terminó (${code})` : null });
    });
    proc.stdin.on("error", () => undefined);
    send({ live: true, error: null });
    return { ok: true, version };
  });

  ipcMain.on("bross:rtmp-chunk", (_e, chunk) => {
    if (proc && chunk instanceof Uint8Array) proc.stdin.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  });

  ipcMain.handle("bross:rtmp-stop", () => {
    if (!proc) return true;
    const p = proc;
    proc = null;
    p.stdin.end();
    setTimeout(() => p.kill(), 3000);
    send({ live: false, error: null });
    return true;
  });

  return { stop: () => proc?.kill() };
}

module.exports = { registerRtmpIpc, ffmpegArgs, findFfmpeg };
