// Servidor local de la app compilada (dist/), escuchando solo en 127.0.0.1.
// Con file:// el reproductor oficial de YouTube se niega a funcionar (error
// 153: la página no tiene origen web). Servida por HTTP local, la app tiene
// un origen normal y el embed funciona.
//
// La app se abre como http://localhost:puerto (no 127.0.0.1): YouTube
// rechaza con el error 150 ("el dueño no permite reproducirlo fuera de
// YouTube") los videos de discográficas insertados en un origen que es una
// IP, y con localhost los acepta. 127.0.0.1 se sigue atendiendo solo para
// migrar los ajustes guardados con ese origen (ver migrate.cjs).
// Solo escucha en la PC, solo entrega archivos de dist/ y valida el Host.
const http = require("http");
const fs = require("fs");
const path = require("path");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

/** Puerto fijo para que el origen (y lo guardado en localStorage) no cambie. */
const PREFERRED_PORT = 41731;

function serveDist(dir) {
  const root = path.resolve(dir);
  let port = 0;
  const server = http.createServer((req, res) => {
    // protección contra DNS rebinding: solo nombres de la propia PC
    if (req.headers.host !== `localhost:${port}` && req.headers.host !== `127.0.0.1:${port}`) {
      res.writeHead(403).end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    // página vacía para leer el localStorage del origen viejo (migración)
    if (rel === "/__storage") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end("<!doctype html><meta charset=utf-8><title>migración</title>");
      return;
    }
    if (rel === "/") rel = "/index.html";
    const file = path.resolve(root, "." + rel);
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(404).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    });
  });
  return new Promise((resolve, reject) => {
    const listen = (p) => {
      server.once("error", (e) => {
        if (e.code === "EADDRINUSE" && p !== 0) listen(0);
        else reject(e);
      });
      server.listen(p, "127.0.0.1", () => {
        port = server.address().port;
        resolve({ url: `http://localhost:${port}/`, legacyUrl: `http://127.0.0.1:${port}/`, server });
      });
    };
    listen(PREFERRED_PORT);
  });
}

module.exports = { serveDist };
