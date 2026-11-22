// Protocolo bross-media:// para reproducir video de las carpetas autorizadas
// en un <video> (con Range: se puede adelantar y retroceder sin leer todo).
// Solo sirve archivos que el usuario agregó (carpetas o archivos sueltos) y
// solo de video/audio, igual que bross:read-file.
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");

const MEDIA_EXT = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
};

const SCHEME = "bross-media";

function registerMediaScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
}

/** bross-media://file/<ruta codificada> → ruta en disco */
function pathFromUrl(url) {
  const u = new URL(url);
  if (u.hostname !== "file") return null;
  return decodeURIComponent(u.pathname.slice(1));
}

async function respond(file, rangeHeader, allows) {
  const ext = path.extname(file).toLowerCase();
  const type = MEDIA_EXT[ext];
  if (!type || !path.isAbsolute(file)) return new Response(null, { status: 404 });
  let real;
  try {
    real = await fs.promises.realpath(file);
  } catch {
    return new Response(null, { status: 404 });
  }
  if (!allows(file) || !allows(real)) return new Response(null, { status: 403 });
  const { size } = await fs.promises.stat(real);
  const headers = { "Content-Type": type, "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader ?? "");
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const body = Readable.toWeb(fs.createReadStream(real, { start, end }));
    return new Response(body, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(real)), { status: 200, headers: { ...headers, "Content-Length": String(size) } });
}

function handleMediaProtocol(protocol, allows) {
  protocol.handle(SCHEME, async (req) => {
    try {
      const file = pathFromUrl(req.url);
      if (!file) return new Response(null, { status: 404 });
      return await respond(file, req.headers.get("range"), allows);
    } catch {
      return new Response(null, { status: 500 });
    }
  });
}

module.exports = { registerMediaScheme, handleMediaProtocol, pathFromUrl, respond, MEDIA_EXT, SCHEME };
