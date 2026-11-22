// Lectura de etiquetas (tags) de archivos de audio, sin dependencias:
// MP3 (ID3v2.2/2.3/2.4 e ID3v1), FLAC / OGG / Opus (comentarios Vorbis),
// M4A / MP4 (átomos de iTunes) y WAV (LIST/INFO).
// Se lee del mismo ArrayBuffer que después se decodifica: sin otra lectura.

export interface TrackTags {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: string;
  bpm?: number;
  key?: string;
}

const latin1 = new TextDecoder("latin1");
const utf8 = new TextDecoder("utf-8");
const utf16le = new TextDecoder("utf-16le");
const utf16be = new TextDecoder("utf-16be");

const clean = (s: string | undefined) => {
  const v = s?.replace(/\0+$/g, "").replace(/\0/g, " / ").trim();
  return v ? v : undefined;
};

function ascii(b: Uint8Array, at: number, len: number): string {
  let s = "";
  for (let i = 0; i < len && at + i < b.length; i++) s += String.fromCharCode(b[at + i]);
  return s;
}

function syncsafe(b: Uint8Array, at: number): number {
  return ((b[at] & 0x7f) << 21) | ((b[at + 1] & 0x7f) << 14) | ((b[at + 2] & 0x7f) << 7) | (b[at + 3] & 0x7f);
}

function u32be(b: Uint8Array, at: number): number {
  return ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
}

function u32le(b: Uint8Array, at: number): number {
  return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
}

/** Texto de un frame ID3: el primer byte indica la codificación. */
function id3Text(data: Uint8Array): string | undefined {
  if (data.length < 1) return undefined;
  const enc = data[0];
  const body = data.subarray(1);
  if (enc === 0) return clean(latin1.decode(body));
  if (enc === 3) return clean(utf8.decode(body));
  if (enc === 2) return clean(utf16be.decode(body));
  // 1: UTF-16 con BOM
  if (body[0] === 0xfe && body[1] === 0xff) return clean(utf16be.decode(body.subarray(2)));
  if (body[0] === 0xff && body[1] === 0xfe) return clean(utf16le.decode(body.subarray(2)));
  return clean(utf16le.decode(body));
}

const ID3_MAP: Record<string, keyof TrackTags> = {
  TIT2: "title",
  TPE1: "artist",
  TALB: "album",
  TCON: "genre",
  TYER: "year",
  TDRC: "year",
  TBPM: "bpm",
  TKEY: "key",
  TT2: "title",
  TP1: "artist",
  TAL: "album",
  TCO: "genre",
  TYE: "year",
  TBP: "bpm",
  TKE: "key",
};

function setTag(out: TrackTags, field: keyof TrackTags, value: string | undefined) {
  if (!value || out[field] != null) return;
  if (field === "bpm") {
    const n = Number.parseFloat(value.replace(",", "."));
    if (Number.isFinite(n) && n > 30 && n < 300) out.bpm = n;
    return;
  }
  if (field === "genre") {
    // "(17)Rock" o "(17)" → texto
    value = value.replace(/^\(\d+\)/, "").trim() || value;
  }
  if (field === "year") value = value.slice(0, 4);
  (out as Record<string, string>)[field] = value;
}

function readId3v2(b: Uint8Array, out: TrackTags): void {
  if (ascii(b, 0, 3) !== "ID3") return;
  const ver = b[3];
  const flags = b[5];
  const size = syncsafe(b, 6);
  const end = Math.min(b.length, 10 + size);
  let p = 10;
  if (flags & 0x40) {
    // encabezado extendido
    const ext = ver === 4 ? syncsafe(b, p) : u32be(b, p) + 4;
    p += ext;
  }
  const idLen = ver === 2 ? 3 : 4;
  const headLen = ver === 2 ? 6 : 10;
  while (p + headLen <= end) {
    const id = ascii(b, p, idLen);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    const fsize =
      ver === 2
        ? (b[p + 3] << 16) | (b[p + 4] << 8) | b[p + 5]
        : ver === 4
          ? syncsafe(b, p + 4)
          : u32be(b, p + 4);
    const start = p + headLen;
    if (fsize <= 0 || start + fsize > end) break;
    const field = ID3_MAP[id];
    if (field) setTag(out, field, id3Text(b.subarray(start, start + fsize)));
    p = start + fsize;
  }
}

function readId3v1(b: Uint8Array, out: TrackTags): void {
  if (b.length < 128) return;
  const at = b.length - 128;
  if (ascii(b, at, 3) !== "TAG") return;
  setTag(out, "title", clean(latin1.decode(b.subarray(at + 3, at + 33))));
  setTag(out, "artist", clean(latin1.decode(b.subarray(at + 33, at + 63))));
  setTag(out, "album", clean(latin1.decode(b.subarray(at + 63, at + 93))));
  setTag(out, "year", clean(latin1.decode(b.subarray(at + 93, at + 97))));
}

const VORBIS_MAP: Record<string, keyof TrackTags> = {
  TITLE: "title",
  ARTIST: "artist",
  ALBUM: "album",
  GENRE: "genre",
  DATE: "year",
  YEAR: "year",
  BPM: "bpm",
  TEMPO: "bpm",
  INITIALKEY: "key",
  KEY: "key",
};

/** Bloque de comentarios Vorbis (little-endian): vendor + lista KEY=valor. */
function readVorbisComments(b: Uint8Array, at: number, out: TrackTags): void {
  let p = at;
  if (p + 4 > b.length) return;
  const vendor = u32le(b, p);
  p += 4 + vendor;
  if (p + 4 > b.length) return;
  const count = u32le(b, p);
  p += 4;
  for (let i = 0; i < count && p + 4 <= b.length; i++) {
    const len = u32le(b, p);
    p += 4;
    if (p + len > b.length) return;
    const entry = utf8.decode(b.subarray(p, p + len));
    p += len;
    const eq = entry.indexOf("=");
    if (eq <= 0) continue;
    const field = VORBIS_MAP[entry.slice(0, eq).toUpperCase()];
    if (field) setTag(out, field, clean(entry.slice(eq + 1)));
  }
}

function readFlac(b: Uint8Array, out: TrackTags): void {
  if (ascii(b, 0, 4) !== "fLaC") return;
  let p = 4;
  while (p + 4 <= b.length) {
    const head = b[p];
    const type = head & 0x7f;
    const len = (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3];
    if (type === 4) {
      readVorbisComments(b, p + 4, out);
      return;
    }
    if (head & 0x80) return; // último bloque
    p += 4 + len;
  }
}

function indexOf(b: Uint8Array, needle: string, from = 0, limit = b.length): number {
  const n = needle.length;
  const first = needle.charCodeAt(0);
  for (let i = from; i <= Math.min(limit, b.length) - n; i++) {
    if (b[i] !== first) continue;
    let ok = true;
    for (let j = 1; j < n; j++) {
      if (b[i + j] !== needle.charCodeAt(j)) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function readOgg(b: Uint8Array, out: TrackTags): void {
  if (ascii(b, 0, 4) !== "OggS") return;
  const limit = Math.min(b.length, 256 * 1024);
  const v = indexOf(b, "\u0003vorbis", 0, limit);
  if (v >= 0) {
    readVorbisComments(b, v + 7, out);
    return;
  }
  const o = indexOf(b, "OpusTags", 0, limit);
  if (o >= 0) readVorbisComments(b, o + 8, out);
}

const MP4_MAP: Record<string, keyof TrackTags> = {
  "©nam": "title",
  "©ART": "artist",
  "©alb": "album",
  "©gen": "genre",
  "©day": "year",
};

/** Recorre átomos MP4 hasta moov/udta/meta/ilst. */
function readMp4(b: Uint8Array, out: TrackTags): void {
  if (ascii(b, 4, 4) !== "ftyp") return;
  const walk = (start: number, end: number, depth: number) => {
    let p = start;
    while (p + 8 <= end) {
      let size = u32be(b, p);
      const type = latin1.decode(b.subarray(p + 4, p + 8));
      let head = 8;
      if (size === 1) {
        // tamaño de 64 bits: alcanza con la parte baja
        size = u32be(b, p + 12);
        head = 16;
      } else if (size === 0) {
        size = end - p;
      }
      if (size < head || p + size > end) return;
      const body = p + head;
      const stop = p + size;
      if (type === "moov" || type === "udta" || type === "ilst") {
        walk(body, stop, depth + 1);
      } else if (type === "meta") {
        walk(body + 4, stop, depth + 1); // meta tiene 4 bytes de versión/flags
      } else if (depth >= 3 && (MP4_MAP[type] || type === "tmpo")) {
        // ítem del ilst → átomo "data": 8 de encabezado + 8 de tipo/locale
        if (stop - body >= 16 && ascii(b, body + 4, 4) === "data") {
          const payload = b.subarray(body + 16, stop);
          if (type === "tmpo") {
            if (payload.length >= 2) setTag(out, "bpm", String((payload[0] << 8) | payload[1]));
          } else {
            setTag(out, MP4_MAP[type], clean(utf8.decode(payload)));
          }
        }
      }
      p = stop;
    }
  };
  walk(0, b.length, 0);
}

function readWav(b: Uint8Array, out: TrackTags): void {
  if (ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WAVE") return;
  let p = 12;
  while (p + 8 <= b.length) {
    const id = ascii(b, p, 4);
    const size = u32le(b, p + 4);
    if (id === "LIST" && ascii(b, p + 8, 4) === "INFO") {
      let q = p + 12;
      const end = Math.min(b.length, p + 8 + size);
      while (q + 8 <= end) {
        const sub = ascii(b, q, 4);
        const len = u32le(b, q + 4);
        const text = clean(latin1.decode(b.subarray(q + 8, Math.min(end, q + 8 + len))));
        if (sub === "INAM") setTag(out, "title", text);
        if (sub === "IART") setTag(out, "artist", text);
        if (sub === "IPRD") setTag(out, "album", text);
        if (sub === "IGNR") setTag(out, "genre", text);
        if (sub === "ICRD") setTag(out, "year", text);
        q += 8 + len + (len & 1);
      }
      return;
    }
    p += 8 + size + (size & 1);
  }
}

/**
 * Etiquetas a partir del principio y el final del archivo (sin leerlo
 * entero). ID3v1 está en los últimos 128 bytes; el resto, al principio.
 */
export function readTagsFromRegions(head: Uint8Array, tail: Uint8Array): TrackTags {
  const copy = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
  const front = readTags(copy(head));
  const back = tail.length >= 128 ? readTags(copy(tail.subarray(tail.length - 128))) : {};
  return { ...back, ...front };
}

/** Lee las etiquetas que encuentre; un archivo raro devuelve {} sin fallar. */
export function readTags(data: ArrayBuffer): TrackTags {
  const out: TrackTags = {};
  try {
    const b = new Uint8Array(data);
    readId3v2(b, out);
    readFlac(b, out);
    readOgg(b, out);
    readMp4(b, out);
    readWav(b, out);
    readId3v1(b, out);
  } catch {
    /* etiqueta dañada: se usa lo que se haya podido leer */
  }
  return out;
}
