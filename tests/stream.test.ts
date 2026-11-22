// Streaming: Icecast falso + servidor en la red local + pedidos.
import { createRequire } from "module";
import http from "http";
import path from "path";
import { describe, expect, it } from "vitest";
import { Mp3Encoder } from "@breezystack/lamejs";

const require = createRequire(import.meta.url);
const { createStreamer, escapeHtml } = require(path.resolve(__dirname, "../electron/stream.cjs"));

const tone = (n: number) => {
  const pcm = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) pcm[i * 2] = pcm[i * 2 + 1] = Math.round(Math.sin(i / 10) * 8000);
  return pcm;
};

describe("streaming en vivo", () => {
  it("manda MP3 a Icecast con usuario y título, y lo sirve en la red local", async () => {
    let got = 0;
    let auth = "";
    let meta = "";
    const ice = http.createServer((req, res) => {
      if (req.method === "PUT") {
        auth = req.headers.authorization ?? "";
        res.writeContinue();
        req.on("data", (c) => (got += c.length));
        req.on("end", () => res.end());
      } else {
        meta = req.url ?? "";
        res.end("ok");
      }
    });
    await new Promise<void>((r) => ice.listen(0, "127.0.0.1", () => r()));
    const icePort = (ice.address() as { port: number }).port;

    const requests: { name: string; song: string }[] = [];
    const s = createStreamer({ Mp3Encoder, onRequest: (r: { name: string; song: string }) => requests.push(r) });
    const st = await s.start({
      sampleRate: 44100,
      channels: 2,
      kbps: 128,
      name: "Prueba <b>",
      icecast: { url: `http://127.0.0.1:${icePort}`, mount: "live", user: "source", password: "clave" },
      lan: { enabled: true, port: 0, requests: true },
    });
    expect(st.live).toBe(true);
    const lan = `http://127.0.0.1:${st.lan.port}`;

    // un oyente en la red local
    let heard = 0;
    const listen = new Promise<void>((resolve) => {
      http.get(`${lan}/stream.mp3`, (res) => {
        expect(res.headers["content-type"]).toBe("audio/mpeg");
        res.on("data", (c) => {
          heard += c.length;
          if (heard > 2000) {
            res.destroy();
            resolve();
          }
        });
      });
    });
    await new Promise((r) => setTimeout(r, 150));
    for (let k = 0; k < 20; k++) s.push(tone(11025));
    await listen;
    await s.setSong("Daft Punk - One More Time");
    expect(decodeURIComponent(meta.replace(/\+/g, " "))).toContain("song=Daft Punk - One More Time");

    // página, tema actual y pedidos (con límite por IP)
    const page = await (await fetch(`${lan}/`)).text();
    expect(page).toContain("Prueba &lt;b&gt;");
    expect(await (await fetch(`${lan}/now`)).json()).toEqual({ song: "Daft Punk - One More Time" });
    const post = (body: object) => fetch(`${lan}/request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await post({ name: "Ana", song: "Tema pedido" })).status).toBe(204);
    expect((await post({ name: "Ana", song: "Otro" })).status).toBe(429);
    expect(requests).toEqual([expect.objectContaining({ name: "Ana", song: "Tema pedido" })]);
    expect((await fetch(`${lan}/../secreto`)).status).toBe(404);

    await s.stop();
    await new Promise<void>((r) => ice.close(() => r()));
    expect(auth).toBe(`Basic ${Buffer.from("source:clave").toString("base64")}`);
    expect(got).toBeGreaterThan(2000);
  });

  it("escapa el HTML de la página", () => {
    expect(escapeHtml(`<script>"x"&'`)).toBe("&lt;script&gt;&quot;x&quot;&amp;&#39;");
  });
});
