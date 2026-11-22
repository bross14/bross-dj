// Escritura de etiquetas (electron/tagwriter.cjs), leída de vuelta con el lector de la app.
import { createRequire } from "module";
import path from "path";
import { describe, expect, it } from "vitest";
import { readTags } from "../src/engine/tags";

const require = createRequire(import.meta.url);
const { writeMp3, writeFlac } = require(path.resolve(__dirname, "../electron/tagwriter.cjs"));

const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** ID3v2.3 con un título y una "carátula" (APIC) que hay que conservar. */
function mp3WithTag(): Buffer {
  const frame = (id: string, body: Buffer) => {
    const h = Buffer.alloc(10);
    h.write(id, 0, "latin1");
    h.writeUInt32BE(body.length, 4);
    return Buffer.concat([h, body]);
  };
  const frames = Buffer.concat([
    frame("TIT2", Buffer.concat([Buffer.from([0]), Buffer.from("Viejo", "latin1")])),
    frame("APIC", Buffer.from("imagen-falsa")),
  ]);
  const size = frames.length;
  const header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
  const audio = Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4]);
  return Buffer.concat([header, frames, audio]);
}

describe("escritura de etiquetas", () => {
  it("MP3: reemplaza los campos editados, conserva el resto y el audio", () => {
    const src = mp3WithTag();
    const out: Buffer = writeMp3(src, { title: "Canción Nueva", artist: "Ñandú", year: "2024", bpm: 127.6, key: "8A" });
    const tags = readTags(ab(out));
    expect(tags).toMatchObject({ title: "Canción Nueva", artist: "Ñandú", year: "2024", bpm: 128, key: "8A" });
    expect(out.includes(Buffer.from("imagen-falsa"))).toBe(true);
    expect(out.includes(Buffer.from("Viejo", "latin1"))).toBe(false);
    expect(out.subarray(out.length - 8).equals(src.subarray(src.length - 8))).toBe(true);
  });

  it("MP3 sin tag: crea uno nuevo y actualiza el ID3v1 si existe", () => {
    const v1 = Buffer.alloc(128);
    v1.write("TAG", 0, "latin1");
    v1.write("Titulo viejo", 3, "latin1");
    const src = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), v1]);
    const out: Buffer = writeMp3(src, { title: "Nuevo" });
    expect(readTags(ab(out)).title).toBe("Nuevo");
    expect(out.toString("latin1", out.length - 125, out.length - 120)).toBe("Nuevo");
  });

  it("FLAC: actualiza los comentarios Vorbis y conserva los demás", () => {
    const streaminfo = Buffer.alloc(34);
    const vc = (() => {
      const vendor = Buffer.from("ref");
      const c = Buffer.from("COMMENT=hola");
      const t = Buffer.from("TITLE=viejo");
      const b = Buffer.alloc(4 + vendor.length + 4 + 4 + c.length + 4 + t.length);
      let p = 0;
      b.writeUInt32LE(vendor.length, p);
      vendor.copy(b, (p += 4));
      b.writeUInt32LE(2, (p += vendor.length));
      b.writeUInt32LE(c.length, (p += 4));
      c.copy(b, (p += 4));
      b.writeUInt32LE(t.length, (p += c.length));
      t.copy(b, (p += 4));
      return b;
    })();
    const head = (last: boolean, type: number, len: number) =>
      Buffer.from([(last ? 0x80 : 0) | type, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
    const audio = Buffer.from([0xff, 0xf8, 9, 9]);
    const src = Buffer.concat([Buffer.from("fLaC"), head(false, 0, 34), streaminfo, head(true, 4, vc.length), vc, audio]);
    const out: Buffer = writeFlac(src, { title: "Nuevo", genre: "House" });
    expect(readTags(ab(out))).toMatchObject({ title: "Nuevo", genre: "House" });
    expect(out.includes(Buffer.from("COMMENT=hola"))).toBe(true);
    expect(out.includes(Buffer.from("TITLE=viejo"))).toBe(false);
    expect(out.subarray(out.length - 4).equals(audio)).toBe(true);
  });
});
