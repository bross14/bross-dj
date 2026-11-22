// Protocolo bross-media:// (video con Range) y argumentos de ffmpeg para RTMP.
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, "..");
const { respond, pathFromUrl } = require(path.join(root, "electron/media.cjs"));
const { ffmpegArgs } = require(path.join(root, "electron/rtmp.cjs"));

// ruta real (en CI la carpeta temporal viene con nombre corto 8.3, p. ej. RUNNER~1)
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "bross-media-")));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("bross-media://", () => {
  const file = path.join(tmp, "clip.mp4");
  fs.writeFileSync(file, Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256)));
  const allows = (p: string) => p.toLowerCase().startsWith(tmp.toLowerCase());

  it("traduce la URL a la ruta", () => {
    expect(pathFromUrl(`bross-media://file/${encodeURIComponent(file)}`)).toBe(file);
    expect(pathFromUrl("bross-media://otro/x")).toBeNull();
  });

  it("sirve rangos para poder adelantar", async () => {
    const r = await respond(file, "bytes=100-199", allows);
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 100-199/1000");
    const b = new Uint8Array(await r.arrayBuffer());
    expect(b.length).toBe(100);
    expect(b[0]).toBe(100);
    const full = await respond(file, null, allows);
    expect(full.status).toBe(200);
    expect((await full.arrayBuffer()).byteLength).toBe(1000);
  });

  it("no sirve nada fuera de las carpetas ni otros tipos", async () => {
    expect((await respond(file, null, () => false)).status).toBe(403);
    const txt = path.join(tmp, "secreto.txt");
    fs.writeFileSync(txt, "x");
    expect((await respond(txt, null, allows)).status).toBe(404);
  });
});

describe("RTMP", () => {
  it("la URL va como un solo argumento (sin shell)", () => {
    const a = ffmpegArgs("rtmp://x/live/clave; rm -rf /", 3000);
    expect(a[a.length - 1]).toBe("rtmp://x/live/clave; rm -rf /");
    expect(a).toContain("3000k");
    expect(a).toContain("pipe:0");
  });
});
