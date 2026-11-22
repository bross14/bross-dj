// Módulos del proceso principal de Electron (CommonJS, sin Electron real).
import { createRequire } from "module";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, "..");
const { isWithin, createRootStore } = require(path.join(root, "electron/folders.cjs"));
const { serveDist } = require(path.join(root, "electron/serve.cjs"));
const { wavHeader } = require(path.join(root, "electron/recorder.cjs"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bross-test-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("carpetas autorizadas", () => {
  it("isWithin no confunde carpetas con prefijo parecido", () => {
    expect(isWithin(path.join(tmp, "Musica", "a.mp3"), path.join(tmp, "Musica"))).toBe(true);
    expect(isWithin(path.join(tmp, "MusicaVieja", "a.mp3"), path.join(tmp, "Musica"))).toBe(false);
    expect(isWithin(path.join(tmp, "Musica", "..", "x.mp3"), path.join(tmp, "Musica"))).toBe(false);
  });

  it("la migración de carpetas es única", () => {
    const store = createRootStore(path.join(tmp, "roots.json"));
    expect(store.migrate([path.join(tmp, "A")])).toBe(true);
    expect(store.migrate(["C:\\"])).toBe(false);
    expect(store.allows(path.join(tmp, "A", "b.mp3"))).toBe(true);
    expect(store.allows("C:\\Windows\\x.mp3")).toBe(false);
  });
});

describe("servidor local de la app", () => {
  it("solo entrega dist/ y valida el Host", async () => {
    const dist = path.join(tmp, "dist");
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html>ok");
    fs.writeFileSync(path.join(tmp, "secreto.txt"), "no");
    const { url, legacyUrl, server } = await serveDist(dist);
    const port = Number(new URL(url).port);
    // la app se abre como localhost (YouTube rechaza los orígenes que son una IP)
    expect(new URL(url).hostname).toBe("localhost");
    expect(new URL(legacyUrl).hostname).toBe("127.0.0.1");
    const get = (p: string, host = `127.0.0.1:${port}`) =>
      new Promise<number>((resolve) =>
        http.get({ host: "127.0.0.1", port, path: p, headers: { Host: host } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }),
      );
    expect(await get("/")).toBe(200);
    expect(await get("/", `localhost:${port}`)).toBe(200);
    expect(await get("/__storage", `127.0.0.1:${port}`)).toBe(200);
    expect(await get("/", `localhost.evil.example:${port}`)).toBe(403);
    expect(await get("/..%2fsecreto.txt")).toBe(404);
    expect(await get("/", "evil.example")).toBe(403);
    expect(await get("/nada.js")).toBe(404);
    server.close();
  });
});

describe("grabación", () => {
  it("encabezado WAV con los tamaños correctos", () => {
    const h: Buffer = wavHeader(48000, 2, 1000);
    expect(h.toString("ascii", 0, 4)).toBe("RIFF");
    expect(h.readUInt32LE(4)).toBe(1036);
    expect(h.readUInt32LE(24)).toBe(48000);
    expect(h.readUInt16LE(32)).toBe(4);
    expect(h.readUInt32LE(40)).toBe(1000);
  });
});
