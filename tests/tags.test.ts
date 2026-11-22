import { describe, expect, it } from "vitest";
import { readTags, readTagsFromRegions } from "../src/engine/tags";
import { ab, concat, enc, u32be, u32le } from "./helpers";

function id3Frame(id: string, text: string, encoding = 3, v4 = false): Uint8Array {
  let body: Uint8Array;
  if (encoding === 1) {
    // UTF-16 con BOM little-endian
    const u = new Uint8Array(2 + text.length * 2);
    u[0] = 0xff;
    u[1] = 0xfe;
    for (let i = 0; i < text.length; i++) {
      u[2 + i * 2] = text.charCodeAt(i) & 255;
      u[3 + i * 2] = text.charCodeAt(i) >> 8;
    }
    body = concat([1], u);
  } else {
    body = concat([encoding], enc(text));
  }
  const size = v4
    ? [(body.length >> 21) & 0x7f, (body.length >> 14) & 0x7f, (body.length >> 7) & 0x7f, body.length & 0x7f]
    : u32be(body.length);
  return concat(enc(id), size, [0, 0], body);
}

function id3(version: 3 | 4, frames: Uint8Array[]): Uint8Array {
  const body = concat(...frames);
  const sz = body.length;
  return concat(enc("ID3"), [version, 0, 0, (sz >> 21) & 0x7f, (sz >> 14) & 0x7f, (sz >> 7) & 0x7f, sz & 0x7f], body);
}

function vorbis(entries: string[]): Uint8Array {
  const vendor = enc("test");
  return concat(u32le(vendor.length), vendor, u32le(entries.length), ...entries.map((e) => concat(u32le(enc(e).length), enc(e))));
}

describe("readTags", () => {
  it("lee ID3v2.3 con acentos y género numérico", () => {
    const t = readTags(
      ab(
        id3(3, [
          id3Frame("TIT2", "Canción Ñandú"),
          id3Frame("TPE1", "Artista"),
          id3Frame("TALB", "Disco"),
          id3Frame("TCON", "(17)Rock"),
          id3Frame("TYER", "2024"),
          id3Frame("TBPM", "128"),
          id3Frame("TKEY", "8A"),
        ]),
      ),
    );
    expect(t).toEqual({ title: "Canción Ñandú", artist: "Artista", album: "Disco", genre: "Rock", year: "2024", bpm: 128, key: "8A" });
  });

  it("lee ID3v2.4 (tamaños syncsafe) y UTF-16", () => {
    const t = readTags(ab(id3(4, [id3Frame("TIT2", "Hola", 1, true), id3Frame("TDRC", "2019-05-01", 3, true)])));
    expect(t.title).toBe("Hola");
    expect(t.year).toBe("2019");
  });

  it("lee ID3v1 al final del archivo", () => {
    const tag = new Uint8Array(128);
    tag.set(enc("TAG"), 0);
    tag.set(enc("Viejo"), 3);
    tag.set(enc("Autor"), 33);
    const t = readTags(ab(concat(new Uint8Array(1000), tag)));
    expect(t).toMatchObject({ title: "Viejo", artist: "Autor" });
  });

  it("lee comentarios Vorbis de FLAC", () => {
    const vb = vorbis(["TITLE=Flac", "ARTIST=Yo", "BPM=124", "INITIALKEY=5A"]);
    const flac = concat(enc("fLaC"), [0x84, (vb.length >> 16) & 255, (vb.length >> 8) & 255, vb.length & 255], vb);
    expect(readTags(ab(flac))).toMatchObject({ title: "Flac", artist: "Yo", bpm: 124, key: "5A" });
  });

  it("lee OGG Vorbis y Opus", () => {
    const ogg = concat(enc("OggS"), new Uint8Array(30), [3], enc("vorbis"), vorbis(["TITLE=Ogg"]));
    const opus = concat(enc("OggS"), new Uint8Array(30), enc("OpusTags"), vorbis(["ARTIST=Opus"]));
    expect(readTags(ab(ogg)).title).toBe("Ogg");
    expect(readTags(ab(opus)).artist).toBe("Opus");
  });

  it("lee átomos de iTunes en M4A", () => {
    // el tipo de átomo son 4 bytes latin1 ("©nam" = A9 6E 61 6D)
    const type = (t: string) => Uint8Array.from([...t].map((c) => c.charCodeAt(0)));
    const atom = (t: string, ...body: Uint8Array[]) => {
      const b = concat(...body);
      return concat(u32be(8 + b.length), type(t), b);
    };
    const data = (payload: Uint8Array) => atom("data", new Uint8Array(8), payload);
    const ilst = atom("ilst", atom("©nam", data(enc("M4A Tema"))), atom("tmpo", data(Uint8Array.from([0, 120]))));
    const meta = atom("meta", new Uint8Array(4), ilst);
    const file = concat(atom("ftyp", enc("M4A ")), atom("moov", atom("udta", meta)));
    expect(readTags(ab(file))).toMatchObject({ title: "M4A Tema", bpm: 120 });
  });

  it("lee LIST/INFO de WAV", () => {
    const sub = (id: string, text: string) => {
      const b = concat(enc(text), [0]);
      return concat(enc(id), u32le(b.length), b, b.length % 2 ? [0] : []);
    };
    const info = concat(enc("INFO"), sub("INAM", "Wav Tema"), sub("IART", "Wav Artista"));
    const wav = concat(enc("RIFF"), u32le(4 + 8 + info.length), enc("WAVE"), enc("LIST"), u32le(info.length), info);
    expect(readTags(ab(wav))).toMatchObject({ title: "Wav Tema", artist: "Wav Artista" });
  });

  it("no falla con basura", () => {
    expect(readTags(ab(Uint8Array.from([1, 2, 3, 4, 5])))).toEqual({});
    expect(readTags(new ArrayBuffer(0))).toEqual({});
  });

  it("combina principio y final (sin leer el archivo entero)", () => {
    const head = id3(3, [id3Frame("TIT2", "Del principio")]);
    const tag = new Uint8Array(128);
    tag.set(enc("TAG"), 0);
    tag.set(enc("Del final"), 3);
    tag.set(enc("Artista v1"), 33);
    const t = readTagsFromRegions(head, concat(new Uint8Array(500), tag));
    // lo del principio (ID3v2) manda; lo del final completa lo que falta
    expect(t).toMatchObject({ title: "Del principio", artist: "Artista v1" });
  });
});
