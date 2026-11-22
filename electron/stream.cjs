// Streaming en vivo del master.
//
// El renderer manda PCM 16 bits (como en la grabación); acá se codifica a MP3
// en vivo (LAME en JS) y se reparte a:
//  - un servidor Icecast (PUT al punto de montaje, con usuario "source"),
//    con el título del tema en vivo por /admin/metadata;
//  - un servidor propio en la red local: /stream.mp3 para escuchar desde otra
//    PC o el celular (PC-a-PC), / con un reproductor y el formulario de
//    pedidos, /now con el tema que suena y /request para pedir temas.
//
// El servidor local solo se abre si el usuario lo activa, y no sirve archivos:
// solo el stream, la página y los pedidos (con límites de tamaño y de ritmo).
const http = require("http");
const https = require("https");
const os = require("os");

const MAX_REQUESTS = 200;
const MAX_LISTENERS = 50;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Direcciones IPv4 de la PC en la red local (para mostrar el link). */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  }
  return out;
}

function pageHtml(title, requests) {
  const t = escapeHtml(title || "BROSS DJ");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t}</title><style>
body{margin:0;font:15px system-ui,sans-serif;background:#0b0b0b;color:#e8e8e8;display:flex;justify-content:center}
main{width:min(520px,100%);padding:20px 16px}h1{font-size:20px;margin:0 0 4px}p{color:#9a9a9a;margin:4px 0 16px}
audio{width:100%;margin:8px 0 18px}.now{padding:12px;border:1px solid #2b2b2b;border-radius:6px;background:#141414;margin-bottom:18px}
form{display:grid;gap:8px}input{font:inherit;padding:10px;border-radius:5px;border:1px solid #5e5e5e;background:#101010;color:#e8e8e8}
button{font:inherit;padding:10px;border:0;border-radius:5px;background:#2f8fe8;color:#fff;font-weight:600}#ok{color:#4ade64;min-height:1.2em}
</style></head><body><main><h1>${t}</h1><p>Escuchá en vivo y pedí un tema.</p>
<audio controls preload="none" src="/stream.mp3"></audio>
<div class="now">Suena: <b id="now">—</b></div>
${requests ? `<form id="f"><input name="name" maxlength="40" placeholder="Tu nombre" required><input name="song" maxlength="120" placeholder="Artista - tema" required><button>Pedir</button><div id="ok"></div></form>` : ""}
<script>
async function now(){try{const r=await fetch('/now');const j=await r.json();document.getElementById('now').textContent=j.song||'—'}catch(e){}}
now();setInterval(now,5000);
const f=document.getElementById('f');if(f)f.onsubmit=async(e)=>{e.preventDefault();const d=Object.fromEntries(new FormData(f));
const r=await fetch('/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d)});
document.getElementById('ok').textContent=r.ok?'¡Pedido enviado!':'No se pudo enviar (probá en un rato)';if(r.ok)f.reset()};
</script></main></body></html>`;
}

/**
 * Motor del streaming (sin Electron: se testea solo). `Mp3Encoder` es la
 * clase de @breezystack/lamejs.
 */
function createStreamer({ Mp3Encoder, onStatus, onRequest }) {
  let enc = null;
  let opts = null;
  let ice = null; // conexión a Icecast
  let server = null; // servidor local
  const listeners = new Set();
  let song = "";
  const requests = [];
  const lastRequestAt = new Map();
  const status = { live: false, icecast: "off", listeners: 0, lan: null, error: null };
  const emit = () => onStatus?.({ ...status, listeners: listeners.size });

  function sendMp3(buf) {
    if (!buf.length) return;
    const b = Buffer.from(buf.buffer, buf.byteOffset, buf.length);
    if (ice && status.icecast === "on") ice.write(b);
    for (const res of listeners) res.write(b);
  }

  function iceUrl() {
    const u = new URL(opts.icecast.url);
    const mount = opts.icecast.mount.startsWith("/") ? opts.icecast.mount : `/${opts.icecast.mount}`;
    return { u, mount };
  }

  function connectIcecast() {
    const { u, mount } = iceUrl();
    const lib = u.protocol === "https:" ? https : http;
    const auth = Buffer.from(`${opts.icecast.user || "source"}:${opts.icecast.password}`).toString("base64");
    status.icecast = "connecting";
    emit();
    const req = lib.request({
      method: "PUT",
      host: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: mount,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "audio/mpeg",
        "Ice-Name": opts.name || "BROSS DJ",
        "Ice-Description": "En vivo desde BROSS DJ",
        "Ice-Public": "0",
        "Ice-Audio-Info": `bitrate=${opts.kbps}`,
        Expect: "100-continue",
      },
    });
    req.on("continue", () => {
      status.icecast = "on";
      status.error = null;
      emit();
      if (song) void sendMetadata(song);
    });
    // Icecast viejos no mandan 100-continue: si en 1,5 s no respondió, se empieza igual
    const t = setTimeout(() => {
      if (status.icecast === "connecting" && ice === req) {
        status.icecast = "on";
        emit();
      }
    }, 1500);
    req.on("response", (res) => {
      clearTimeout(t);
      if (res.statusCode && res.statusCode >= 400) {
        status.icecast = "error";
        status.error = res.statusCode === 401 ? "Icecast rechazó el usuario o la contraseña" : `Icecast respondió ${res.statusCode}`;
        emit();
      }
      res.resume();
    });
    req.on("error", (e) => {
      clearTimeout(t);
      if (ice !== req) return;
      status.icecast = "error";
      status.error = `Sin conexión con Icecast: ${e.message}`;
      emit();
    });
    req.on("close", () => {
      if (ice === req && status.live && status.icecast !== "error") {
        status.icecast = "error";
        status.error = "Se cortó la conexión con Icecast";
        emit();
      }
    });
    ice = req;
  }

  function sendMetadata(text) {
    if (!opts?.icecast || status.icecast !== "on") return Promise.resolve(false);
    const { u, mount } = iceUrl();
    const lib = u.protocol === "https:" ? https : http;
    const auth = Buffer.from(`${opts.icecast.user || "source"}:${opts.icecast.password}`).toString("base64");
    const qs = new URLSearchParams({ mount, mode: "updinfo", song: text, charset: "UTF-8" });
    return new Promise((resolve) => {
      const r = lib.request(
        { method: "GET", host: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: `/admin/metadata?${qs}`, headers: { Authorization: `Basic ${auth}` } },
        (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        },
      );
      r.on("error", () => resolve(false));
      r.end();
    });
  }

  function startLan(port, allowRequests) {
    return new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://x");
        res.setHeader("X-Content-Type-Options", "nosniff");
        if (req.method === "GET" && url.pathname === "/") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          res.end(pageHtml(opts?.name, allowRequests));
        } else if (req.method === "GET" && url.pathname === "/stream.mp3") {
          if (listeners.size >= MAX_LISTENERS) {
            res.writeHead(503);
            res.end();
            return;
          }
          res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", Connection: "keep-alive", "icy-name": opts?.name || "BROSS DJ" });
          listeners.add(res);
          emit();
          req.on("close", () => {
            listeners.delete(res);
            emit();
          });
        } else if (req.method === "GET" && url.pathname === "/now") {
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ song }));
        } else if (req.method === "POST" && url.pathname === "/request" && allowRequests) {
          const ip = req.socket.remoteAddress ?? "?";
          const last = lastRequestAt.get(ip) ?? 0;
          if (Date.now() - last < 20000) {
            res.writeHead(429);
            res.end();
            return;
          }
          let body = "";
          req.on("data", (c) => {
            body += c;
            if (body.length > 2000) req.destroy();
          });
          req.on("end", () => {
            try {
              const d = JSON.parse(body);
              const name = String(d.name ?? "").trim().slice(0, 40);
              const songReq = String(d.song ?? "").trim().slice(0, 120);
              if (!name || !songReq) throw new Error("vacío");
              lastRequestAt.set(ip, Date.now());
              const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, song: songReq, at: Date.now() };
              requests.push(item);
              if (requests.length > MAX_REQUESTS) requests.shift();
              onRequest?.(item);
              res.writeHead(204);
              res.end();
            } catch {
              res.writeHead(400);
              res.end();
            }
          });
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      server.once("error", reject);
      server.listen(port, "0.0.0.0", () => {
        status.lan = { port: server.address().port, addresses: lanAddresses() };
        emit();
        resolve(status.lan);
      });
    });
  }

  return {
    status: () => ({ ...status, listeners: listeners.size }),
    requests: () => [...requests],
    async start(o) {
      if (status.live) await this.stop();
      opts = { kbps: 128, sampleRate: 48000, channels: 2, ...o };
      enc = new Mp3Encoder(opts.channels, opts.sampleRate, opts.kbps);
      status.live = true;
      status.error = null;
      if (opts.lan?.enabled) {
        try {
          await startLan(opts.lan.port || 8000, !!opts.lan.requests);
        } catch (e) {
          status.error = `No se pudo abrir el puerto ${opts.lan.port}: ${e.message}`;
        }
      }
      if (opts.icecast?.url) connectIcecast();
      emit();
      return this.status();
    },
    /** bloque PCM 16 bits intercalado */
    push(pcm) {
      if (!status.live || !enc) return;
      const n = pcm.length / opts.channels;
      let mp3;
      if (opts.channels === 2) {
        const l = new Int16Array(n);
        const r = new Int16Array(n);
        for (let i = 0; i < n; i++) {
          l[i] = pcm[i * 2];
          r[i] = pcm[i * 2 + 1];
        }
        mp3 = enc.encodeBuffer(l, r);
      } else mp3 = enc.encodeBuffer(pcm);
      sendMp3(mp3);
    },
    async setSong(text) {
      song = String(text ?? "").slice(0, 200);
      return sendMetadata(song);
    },
    async stop() {
      if (enc) sendMp3(enc.flush());
      enc = null;
      status.live = false;
      status.icecast = "off";
      if (ice) {
        const r = ice;
        ice = null;
        r.end();
      }
      for (const res of listeners) res.end();
      listeners.clear();
      if (server) {
        const s = server;
        server = null;
        await new Promise((r) => s.close(() => r()));
      }
      status.lan = null;
      emit();
    },
  };
}

function registerStreamIpc(ipcMain, BrowserWindow) {
  let streamer = null;
  const broadcast = (channel, data) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, data);
  };
  const get = async () => {
    if (!streamer) {
      const { Mp3Encoder } = await import("@breezystack/lamejs");
      streamer = createStreamer({
        Mp3Encoder,
        onStatus: (s) => broadcast("bross:stream-status", s),
        onRequest: (r) => broadcast("bross:stream-request", r),
      });
    }
    return streamer;
  };
  const clean = (o) => ({
    sampleRate: Number(o?.sampleRate) || 48000,
    channels: o?.channels === 1 ? 1 : 2,
    kbps: [96, 128, 160, 192, 256, 320].includes(o?.kbps) ? o.kbps : 128,
    name: String(o?.name ?? "BROSS DJ").slice(0, 80),
    icecast:
      o?.icecast?.url && /^https?:\/\//i.test(o.icecast.url)
        ? { url: String(o.icecast.url), mount: String(o.icecast.mount || "/live").slice(0, 100), user: String(o.icecast.user || "source").slice(0, 60), password: String(o.icecast.password ?? "").slice(0, 200) }
        : null,
    lan: o?.lan?.enabled ? { enabled: true, port: Math.max(1024, Math.min(65535, Number(o.lan.port) || 8000)), requests: !!o.lan.requests } : null,
  });
  ipcMain.handle("bross:stream-start", async (_e, o) => (await get()).start(clean(o)));
  ipcMain.handle("bross:stream-stop", async () => (streamer ? streamer.stop() : null));
  ipcMain.on("bross:stream-chunk", (_e, chunk) => {
    if (streamer && chunk instanceof Uint8Array && chunk.byteLength % 2 === 0) {
      streamer.push(new Int16Array(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)));
    }
  });
  ipcMain.handle("bross:stream-song", async (_e, text) => (streamer ? streamer.setSong(text) : false));
  ipcMain.handle("bross:stream-status", () => (streamer ? streamer.status() : { live: false, icecast: "off", listeners: 0, lan: null, error: null }));
  ipcMain.handle("bross:stream-requests", () => (streamer ? streamer.requests() : []));
  return { stop: () => streamer?.stop() };
}

module.exports = { createStreamer, registerStreamIpc, pageHtml, escapeHtml, lanAddresses };
