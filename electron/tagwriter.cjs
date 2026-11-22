// Escritura de etiquetas, sin dependencias.
//
// - MP3: ID3v2 (se conserva la versión 2.3 o 2.4 que tenía el archivo y todos
//   los frames que no editamos, por ejemplo la carátula). Si el archivo tiene
//   ID3v1 al final, también se actualiza para que no contradiga al v2.
// - FLAC: bloque VORBIS_COMMENT (se conservan los demás comentarios y bloques).
//
// Se escribe a un temporal y se reemplaza el original con rename: un corte
// de luz no deja el archivo a medias.
const fs = require("fs");
const path = require("path");

/** campo de la UI → frame ID3v2 / comentario Vorbis */
const ID3_FRAMES = { title: "TIT2", artist: "TPE1", album: "TALB", genre: "TCON", bpm: "TBPM", key: "TKEY" };
const VORBIS_KEYS = { title: "TITLE", artist: "ARTIST", album: "ALBUM", genre: "GENRE", year: "DATE", bpm: "BPM", key: "INITIALKEY" };

const WRITABLE = new Set([".mp3", ".flac"]);

function syncsafeRead(b, at) {
  return ((b[at] & 0x7f) << 21) | ((b[at + 1] & 0x7f) << 14) | ((b[at + 2] & 0x7f) << 7) | (b[at + 3] & 0x7f);
}

function syncsafeWrite(n) {
  return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}

/** Texto normalizado: sin saltos de línea, recortado y con tope razonable. */
function cleanValue(v) {
  if (v == null) return "";
  return String(v).replace(/[\r\n\0]+/g, " ").trim().slice(0, 500);
}

/** Frames existentes de un tag ID3v2.3/2.4 (id + contenido crudo + flags). */
function parseId3Frames(b, ver, flags, size) {
  const frames = [];
  const end = Math.min(b.length, 10 + size);
  let p = 10;
  if (flags & 0x40) p += ver === 4 ? syncsafeRead(b, p) : b.readUInt32BE(p) + 4;
  while (p + 10 <= end) {
    const id = b.toString("latin1", p, p + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const fsize = ver === 4 ? syncsafeRead(b, p + 4) : b.readUInt32BE(p + 4);
    const start = p + 10;
    if (fsize <= 0 || start + fsize > end) break;
    frames.push({ id, flags: b.subarray(p + 8, p + 10), data: b.subarray(start, start + fsize) });
    p = start + fsize;
  }
  return frames;
}

function textFrame(id, value, ver) {
  // 2.4: UTF-8 (encoding 3) · 2.3: UTF-16 con BOM (encoding 1)
  const body =
    ver === 4
      ? Buffer.concat([Buffer.from([3]), Buffer.from(value, "utf8")])
      : Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(value, "utf16le")]);
  const size = ver === 4 ? syncsafeWrite(body.length) : u32be(body.length);
  return Buffer.concat([Buffer.from(id, "latin1"), size, Buffer.from([0, 0]), body]);
}

function rawFrame(f, ver) {
  const size = ver === 4 ? syncsafeWrite(f.data.length) : u32be(f.data.length);
  return Buffer.concat([Buffer.from(f.id, "latin1"), size, f.flags, f.data]);
}

/** Devuelve el MP3 con el tag ID3v2 nuevo (y el v1 actualizado si existía). */
function writeMp3(buf, tags) {
  let ver = 3;
  let keep = [];
  let audioStart = 0;
  if (buf.length >= 10 && buf.toString("latin1", 0, 3) === "ID3") {
    const oldVer = buf[3];
    const flags = buf[5];
    const size = syncsafeRead(buf, 6);
    audioStart = 10 + size + (flags & 0x10 ? 10 : 0);
    if ((oldVer === 3 || oldVer === 4) && !(flags & 0x80)) {
      ver = oldVer;
      keep = parseId3Frames(buf, oldVer, flags, size);
    }
    // 2.2 o con "unsynchronisation": se reescribe desde cero en 2.3
  }
  const edited = new Set(Object.entries(ID3_FRAMES).filter(([k]) => k in tags).map(([, id]) => id));
  // el año va en TYER (2.3) o TDRC (2.4)
  const yearId = ver === 4 ? "TDRC" : "TYER";
  if ("year" in tags) edited.add(yearId).add(ver === 4 ? "TYER" : "TDRC");
  const frames = keep.filter((f) => !edited.has(f.id)).map((f) => rawFrame(f, ver));
  for (const [field, id] of Object.entries(ID3_FRAMES)) {
    if (!(field in tags)) continue;
    const v = cleanValue(field === "bpm" && tags.bpm ? Math.round(Number(tags.bpm)) : tags[field]);
    if (v) frames.push(textFrame(id, v, ver));
  }
  if ("year" in tags) {
    const v = cleanValue(tags.year);
    if (v) frames.push(textFrame(yearId, v, ver));
  }
  const body = Buffer.concat([...frames, Buffer.alloc(1024)]); // padding para futuras ediciones
  const header = Buffer.concat([Buffer.from("ID3", "latin1"), Buffer.from([ver, 0, 0]), syncsafeWrite(body.length)]);
  let audio = buf.subarray(Math.min(audioStart, buf.length));
  // ID3v1 al final: se actualiza con los mismos datos (latin1, 30 bytes por campo)
  if (audio.length >= 128 && audio.toString("latin1", audio.length - 128, audio.length - 125) === "TAG") {
    const v1 = Buffer.from(audio.subarray(audio.length - 128));
    const put = (field, at, len) => {
      if (!(field in tags)) return;
      const b = Buffer.alloc(len);
      b.write(cleanValue(tags[field]).normalize("NFD").replace(/[̀-ͯ]/g, ""), "latin1");
      b.copy(v1, at);
    };
    put("title", 3, 30);
    put("artist", 33, 30);
    put("album", 63, 30);
    put("year", 93, 4);
    audio = Buffer.concat([audio.subarray(0, audio.length - 128), v1]);
  }
  return Buffer.concat([header, body, audio]);
}

/** Devuelve el FLAC con el bloque VORBIS_COMMENT actualizado. */
function writeFlac(buf, tags) {
  if (buf.length < 8 || buf.toString("latin1", 0, 4) !== "fLaC") throw new Error("No es un FLAC válido");
  const blocks = [];
  let p = 4;
  let last = false;
  while (!last && p + 4 <= buf.length) {
    const h = buf[p];
    last = !!(h & 0x80);
    const type = h & 0x7f;
    const len = (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3];
    if (p + 4 + len > buf.length) throw new Error("FLAC dañado");
    blocks.push({ type, data: buf.subarray(p + 4, p + 4 + len) });
    p += 4 + len;
  }
  const audio = buf.subarray(p);
  let vendor = "BROSS DJ";
  let comments = [];
  const vcIndex = blocks.findIndex((b) => b.type === 4);
  if (vcIndex >= 0) {
    const d = blocks[vcIndex].data;
    let q = 0;
    const vlen = d.readUInt32LE(q);
    q += 4;
    vendor = d.toString("utf8", q, q + vlen);
    q += vlen;
    const count = d.readUInt32LE(q);
    q += 4;
    for (let i = 0; i < count && q + 4 <= d.length; i++) {
      const len = d.readUInt32LE(q);
      q += 4;
      comments.push(d.toString("utf8", q, q + len));
      q += len;
    }
  }
  const edited = new Set(Object.entries(VORBIS_KEYS).filter(([k]) => k in tags).map(([, key]) => key));
  if ("year" in tags) edited.add("YEAR");
  if ("key" in tags) edited.add("KEY");
  comments = comments.filter((c) => !edited.has(c.slice(0, Math.max(0, c.indexOf("="))).toUpperCase()));
  for (const [field, key] of Object.entries(VORBIS_KEYS)) {
    if (!(field in tags)) continue;
    const v = cleanValue(field === "bpm" && tags.bpm ? Math.round(Number(tags.bpm)) : tags[field]);
    if (v) comments.push(`${key}=${v}`);
  }
  const parts = [];
  const vb = Buffer.from(vendor, "utf8");
  parts.push(Buffer.alloc(4), vb, Buffer.alloc(4));
  parts[0].writeUInt32LE(vb.length);
  parts[2].writeUInt32LE(comments.length);
  for (const c of comments) {
    const cb = Buffer.from(c, "utf8");
    const l = Buffer.alloc(4);
    l.writeUInt32LE(cb.length);
    parts.push(l, cb);
  }
  const vc = { type: 4, data: Buffer.concat(parts) };
  if (vcIndex >= 0) blocks[vcIndex] = vc;
  else blocks.splice(1, 0, vc); // después de STREAMINFO
  const out = [Buffer.from("fLaC", "latin1")];
  blocks.forEach((b, i) => {
    if (b.data.length >= 1 << 24) throw new Error("Bloque FLAC demasiado grande");
    const h = Buffer.from([(i === blocks.length - 1 ? 0x80 : 0) | b.type, (b.data.length >> 16) & 0xff, (b.data.length >> 8) & 0xff, b.data.length & 0xff]);
    out.push(h, b.data);
  });
  out.push(audio);
  return Buffer.concat(out);
}

/** Escribe las etiquetas en el archivo. Devuelve false si el formato no se puede escribir. */
async function writeTagsToFile(file, tags) {
  const ext = path.extname(file).toLowerCase();
  if (!WRITABLE.has(ext)) return false;
  const buf = await fs.promises.readFile(file);
  const next = ext === ".mp3" ? writeMp3(buf, tags) : writeFlac(buf, tags);
  const tmp = `${file}.bross-tmp`;
  await fs.promises.writeFile(tmp, next);
  try {
    await fs.promises.rename(tmp, file);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true });
    throw e;
  }
  return true;
}

const FIELDS = ["title", "artist", "album", "genre", "year", "bpm", "key"];

/** Solo los campos conocidos, como texto o número. */
function sanitizeTags(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const f of FIELDS) {
    if (!(f in raw)) continue;
    const v = raw[f];
    if (v == null || typeof v === "string" || typeof v === "number") out[f] = v ?? "";
  }
  return out;
}

module.exports = { writeMp3, writeFlac, writeTagsToFile, sanitizeTags, WRITABLE };
