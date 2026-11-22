// Codificadores y conversiones de la grabación, sin dependencias.
//
// - FLAC: codificador propio (predictores fijos de orden 0-4 + Rice), 16 bits.
//   Comprime ~40-60 % sin pérdida y lo abre cualquier reproductor.
// - OGG: el renderer graba Opus con MediaRecorder (que en Chromium solo sale
//   en WebM); acá se re-empaqueta en Ogg sin recodificar.
// - Cortes por tema: rangos de muestras del WAV o de paquetes Opus.
const fs = require("fs");

// ── FLAC ─────────────────────────────────────────────────────────────

const BLOCK = 4096;

class BitWriter {
  constructor(cap = 1 << 16) {
    this.buf = Buffer.alloc(cap);
    this.pos = 0; // bytes completos
    this.acc = 0; // bits pendientes (alineados a la izquierda)
    this.nacc = 0;
  }
  ensure(n) {
    if (this.pos + n + 8 <= this.buf.length) return;
    const next = Buffer.alloc(Math.max(this.buf.length * 2, this.pos + n + 64));
    this.buf.copy(next, 0, 0, this.pos);
    this.buf = next;
  }
  /** escribe los `n` bits bajos de `v` (n <= 32) */
  write(v, n) {
    if (n === 0) return;
    this.ensure(8);
    if (n > 24) {
      this.write(Math.floor(v / 0x1000000) & ((1 << (n - 24)) - 1), n - 24);
      this.write(v & 0xffffff, 24);
      return;
    }
    v &= n === 32 ? 0xffffffff : (1 << n) - 1;
    this.acc = (this.acc << n) | v;
    this.nacc += n;
    while (this.nacc >= 8) {
      this.nacc -= 8;
      this.buf[this.pos++] = (this.acc >>> this.nacc) & 0xff;
    }
    this.acc &= (1 << this.nacc) - 1;
  }
  /** unario: q ceros y un 1 */
  unary(q) {
    while (q >= 24) {
      this.write(0, 24);
      q -= 24;
    }
    this.write(1, q + 1);
  }
  align() {
    if (this.nacc) this.write(0, 8 - this.nacc);
  }
  bytes() {
    return this.buf.subarray(0, this.pos);
  }
}

const CRC8 = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
    t[i] = c;
  }
  return t;
})();
const CRC16 = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 8;
    for (let j = 0; j < 8; j++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff;
    t[i] = c;
  }
  return t;
})();
function crc8(b) {
  let c = 0;
  for (const x of b) c = CRC8[c ^ x];
  return c;
}
function crc16(b) {
  let c = 0;
  for (const x of b) c = ((c << 8) & 0xffff) ^ CRC16[(c >> 8) ^ x];
  return c;
}

/** Número de frame en el "UTF-8" de FLAC. */
function utf8Num(n) {
  if (n < 0x80) return [n];
  if (n < 0x800) return [0xc0 | (n >> 6), 0x80 | (n & 0x3f)];
  if (n < 0x10000) return [0xe0 | (n >> 12), 0x80 | ((n >> 6) & 0x3f), 0x80 | (n & 0x3f)];
  if (n < 0x200000) return [0xf0 | (n >> 18), 0x80 | ((n >> 12) & 0x3f), 0x80 | ((n >> 6) & 0x3f), 0x80 | (n & 0x3f)];
  return [0xf8 | (n >> 24), 0x80 | ((n >> 18) & 0x3f), 0x80 | ((n >> 12) & 0x3f), 0x80 | ((n >> 6) & 0x3f), 0x80 | (n & 0x3f)];
}

/** Residuos del predictor fijo de orden `o`. */
function residual(x, o, out) {
  const n = x.length;
  for (let i = o; i < n; i++) {
    switch (o) {
      case 0: out[i] = x[i]; break;
      case 1: out[i] = x[i] - x[i - 1]; break;
      case 2: out[i] = x[i] - 2 * x[i - 1] + x[i - 2]; break;
      case 3: out[i] = x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3]; break;
      default: out[i] = x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4];
    }
  }
}

/** Escribe un subframe (fijo con el mejor orden, o verbatim si no conviene). */
function writeSubframe(w, x, bps) {
  const n = x.length;
  let allSame = true;
  for (let i = 1; i < n; i++) if (x[i] !== x[0]) { allSame = false; break; }
  if (allSame) {
    w.write(0, 1); w.write(0, 6); w.write(0, 1); // CONSTANT
    w.write(x[0] & ((1 << bps) - 1), bps);
    return;
  }
  const res = new Int32Array(n);
  let best = -1;
  let bestSum = Infinity;
  for (let o = 0; o <= Math.min(4, n - 1); o++) {
    residual(x, o, res);
    let sum = 0;
    for (let i = o; i < n; i++) sum += Math.abs(res[i]);
    if (sum < bestSum) { bestSum = sum; best = o; }
  }
  residual(x, best, res);
  const count = n - best;
  const mean = bestSum / Math.max(1, count);
  let k = mean > 0 ? Math.max(0, Math.min(14, Math.floor(Math.log2(mean * 0.69 + 1)))) : 0;
  // ¿sale más largo que guardar las muestras tal cual?
  const est = count * (k + 1) + (2 * bestSum) / (1 << k);
  if (est >= n * bps) {
    w.write(0, 1); w.write(1, 6); w.write(0, 1); // VERBATIM
    for (let i = 0; i < n; i++) w.write(x[i] & ((1 << bps) - 1), bps);
    return;
  }
  w.write(0, 1); w.write(8 | best, 6); w.write(0, 1); // FIXED
  for (let i = 0; i < best; i++) w.write(x[i] & ((1 << bps) - 1), bps);
  w.write(0, 2); // RICE, parámetro de 4 bits
  w.write(0, 4); // una sola partición
  w.write(k, 4);
  w.ensure(count * 4 + 16);
  for (let i = best; i < n; i++) {
    const v = res[i];
    const u = v >= 0 ? v * 2 : -v * 2 - 1;
    const q = Math.floor(u / (1 << k));
    w.unary(q);
    if (k) w.write(u & ((1 << k) - 1), k);
  }
}

const SR_CODES = { 88200: 1, 176400: 2, 192000: 3, 8000: 4, 16000: 5, 22050: 6, 24000: 7, 32000: 8, 44100: 9, 48000: 10, 96000: 11 };

/** Un frame FLAC con `n` muestras por canal (entrada Int16 intercalada). */
function encodeFrame(pcm, off, n, channels, sampleRate, frameNo) {
  const w = new BitWriter(n * channels * 2 + 64);
  w.write(0x3ffe, 14); w.write(0, 1); w.write(0, 1); // sync, reservado, bloque fijo
  const bsCode = n === BLOCK ? 12 : 7; // 4096 o "en 16 bits al final"
  w.write(bsCode, 4);
  w.write(SR_CODES[sampleRate] ?? 0, 4);
  w.write(channels === 2 ? 10 : 0, 4); // estéreo: mid/side
  w.write(4, 3); // 16 bits
  w.write(0, 1);
  for (const b of utf8Num(frameNo)) w.write(b, 8);
  if (bsCode === 7) w.write(n - 1, 16);
  w.align();
  w.write(crc8(w.bytes()), 8);
  if (channels === 2) {
    const mid = new Int32Array(n);
    const side = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const l = pcm[off + i * 2];
      const r = pcm[off + i * 2 + 1];
      mid[i] = (l + r) >> 1;
      side[i] = l - r;
    }
    writeSubframe(w, mid, 16);
    writeSubframe(w, side, 17);
  } else {
    const x = new Int32Array(n);
    for (let i = 0; i < n; i++) x[i] = pcm[off + i];
    writeSubframe(w, x, 16);
  }
  w.align();
  const crc = crc16(w.bytes());
  w.write(crc, 16);
  return Buffer.from(w.bytes());
}

function streamInfo(sampleRate, channels, totalSamples, minFrame, maxFrame) {
  const b = Buffer.alloc(38);
  b[0] = 0; // STREAMINFO (no es el último: después va el comentario)
  b.writeUIntBE(34, 1, 3);
  b.writeUInt16BE(BLOCK, 4);
  b.writeUInt16BE(BLOCK, 6);
  b.writeUIntBE(minFrame, 8, 3);
  b.writeUIntBE(maxFrame, 11, 3);
  // 20 bits sample rate | 3 canales-1 | 5 bps-1 | 36 total samples
  const hi = sampleRate * 16 + (channels - 1) * 2 + (15 >> 4);
  b.writeUIntBE(hi, 14, 3);
  const totHi = Math.floor(totalSamples / 2 ** 32) & 0xf;
  b[17] = ((15 & 0xf) << 4) | totHi;
  b.writeUInt32BE(totalSamples >>> 0, 18);
  // MD5 en cero: permitido ("sin calcular")
  return b;
}

function vorbisBlock(comments, last) {
  const vendor = Buffer.from("BROSS DJ");
  const parts = [Buffer.alloc(4), vendor, Buffer.alloc(4)];
  parts[0].writeUInt32LE(vendor.length);
  parts[2].writeUInt32LE(comments.length);
  for (const c of comments) {
    const cb = Buffer.from(c, "utf8");
    const l = Buffer.alloc(4);
    l.writeUInt32LE(cb.length);
    parts.push(l, cb);
  }
  const data = Buffer.concat(parts);
  const h = Buffer.from([(last ? 0x80 : 0) | 4, 0, 0, 0]);
  h.writeUIntBE(data.length, 1, 3);
  return Buffer.concat([h, data]);
}

/**
 * Codifica PCM 16 bits intercalado a FLAC, escribiendo en `fd` (sincrónico:
 * corre en un worker). `readChunk(maxFrames)` devuelve Int16Array o null.
 */
function encodeFlacTo(file, { sampleRate, channels, totalFrames, readChunk, comments = [] }) {
  const fd = fs.openSync(file, "w");
  try {
    fs.writeSync(fd, Buffer.from("fLaC"));
    const infoPos = 4;
    fs.writeSync(fd, streamInfo(sampleRate, channels, totalFrames, 0, 0));
    fs.writeSync(fd, vorbisBlock(comments, true));
    let frameNo = 0;
    let minF = Infinity;
    let maxF = 0;
    let done = 0;
    for (;;) {
      const chunk = readChunk(BLOCK);
      if (!chunk || chunk.length === 0) break;
      const n = chunk.length / channels;
      const frame = encodeFrame(chunk, 0, n, channels, sampleRate, frameNo++);
      fs.writeSync(fd, frame);
      minF = Math.min(minF, frame.length);
      maxF = Math.max(maxF, frame.length);
      done += n;
    }
    // tamaños reales en STREAMINFO
    fs.writeSync(fd, streamInfo(sampleRate, channels, done, minF === Infinity ? 0 : minF, maxF), 0, 38, infoPos);
    return done;
  } finally {
    fs.closeSync(fd);
  }
}

// ── MP3 ──────────────────────────────────────────────────────────────

/**
 * Codifica PCM 16 bits intercalado a MP3 (CBR, 192 kbps por defecto) con un
 * tag ID3v2 adelante. `Mp3Encoder` es la clase de @breezystack/lamejs (se
 * pasa desde afuera porque ese paquete solo se carga con import()).
 */
function encodeMp3To(file, { Mp3Encoder, sampleRate, channels, readChunk, tags = {}, kbps = 192 }) {
  const { writeMp3 } = require("./tagwriter.cjs");
  const enc = new Mp3Encoder(channels, sampleRate, kbps);
  const fd = fs.openSync(file, "w");
  try {
    // solo el tag (sin audio): los frames MP3 se escriben a continuación
    const id3 = { ...tags };
    delete id3.tracknumber;
    fs.writeSync(fd, writeMp3(Buffer.alloc(0), id3));
    const FRAMES = 1152 * 32;
    for (;;) {
      const chunk = readChunk(FRAMES);
      if (!chunk || chunk.length === 0) break;
      const n = chunk.length / channels;
      let mp3;
      if (channels === 2) {
        const l = new Int16Array(n);
        const r = new Int16Array(n);
        for (let i = 0; i < n; i++) {
          l[i] = chunk[i * 2];
          r[i] = chunk[i * 2 + 1];
        }
        mp3 = enc.encodeBuffer(l, r);
      } else {
        mp3 = enc.encodeBuffer(Int16Array.from(chunk));
      }
      if (mp3.length) fs.writeSync(fd, Buffer.from(mp3.buffer, mp3.byteOffset, mp3.length));
    }
    const tail = enc.flush();
    if (tail.length) fs.writeSync(fd, Buffer.from(tail.buffer, tail.byteOffset, tail.length));
  } finally {
    fs.closeSync(fd);
  }
}

// ── WAV ──────────────────────────────────────────────────────────────

function wavHeader(sampleRate, channels, dataBytes) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

/** Lector secuencial de un rango de muestras de un WAV PCM 16 de 44 bytes de encabezado. */
function wavRangeReader(file, channels, startFrame, endFrame) {
  const fd = fs.openSync(file, "r");
  let frame = startFrame;
  return {
    read(maxFrames) {
      const n = Math.min(maxFrames, endFrame - frame);
      if (n <= 0) return null;
      const buf = Buffer.alloc(n * channels * 2);
      const got = fs.readSync(fd, buf, 0, buf.length, 44 + frame * channels * 2);
      const frames = Math.floor(got / (channels * 2));
      if (!frames) return null;
      frame += frames;
      return new Int16Array(buf.buffer, buf.byteOffset, frames * channels);
    },
    close() {
      fs.closeSync(fd);
    },
  };
}

/** Copia un rango del WAV a otro WAV. */
function writeWavRange(src, dst, sampleRate, channels, startFrame, endFrame) {
  const r = wavRangeReader(src, channels, startFrame, endFrame);
  const fd = fs.openSync(dst, "w");
  try {
    fs.writeSync(fd, wavHeader(sampleRate, channels, 0));
    let bytes = 0;
    for (let c; (c = r.read(1 << 16)); ) {
      fs.writeSync(fd, Buffer.from(c.buffer, c.byteOffset, c.byteLength));
      bytes += c.byteLength;
    }
    fs.writeSync(fd, wavHeader(sampleRate, channels, bytes), 0, 44, 0);
  } finally {
    fs.closeSync(fd);
    r.close();
  }
}

// ── WebM (Opus) → Ogg ────────────────────────────────────────────────

const EBML_MASTER = new Set([0x18538067, 0x1f43b675, 0x1654ae6b, 0xae, 0xa0]); // Segment Cluster Tracks TrackEntry BlockGroup

function readVint(b, p, keepMarker) {
  const first = b[p];
  if (first === undefined) return null;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || p + len > b.length) return null;
  let v = keepMarker ? first : first & (0xff >> len);
  let unknown = (first & (0xff >> len)) === (0xff >> len);
  for (let i = 1; i < len; i++) {
    v = v * 256 + b[p + i];
    if (b[p + i] !== 0xff) unknown = false;
  }
  return { v, len, unknown };
}

/** Paquetes Opus (con su tiempo en ms) y el OpusHead de un WebM de MediaRecorder. */
function parseWebmOpus(b) {
  let head = null;
  const packets = [];
  let clusterTime = 0;
  const walk = (start, end) => {
    let p = start;
    while (p < end) {
      const id = readVint(b, p, true);
      if (!id) return;
      const size = readVint(b, p + id.len, false);
      if (!size) return;
      const data = p + id.len + size.len;
      const stop = size.unknown ? end : Math.min(end, data + size.v);
      if (EBML_MASTER.has(id.v)) {
        walk(data, stop);
        p = stop;
        continue;
      }
      if (id.v === 0xe7) {
        // Timecode del cluster
        let t = 0;
        for (let i = data; i < stop; i++) t = t * 256 + b[i];
        clusterTime = t;
      } else if (id.v === 0x63a2) {
        head = Buffer.from(b.subarray(data, stop)); // CodecPrivate = OpusHead
      } else if (id.v === 0xa3 || id.v === 0xa1) {
        // SimpleBlock / Block: track vint, timecode int16, flags
        const tr = readVint(b, data, false);
        if (tr) {
          const q = data + tr.len;
          const rel = b.readInt16BE(q);
          const flags = b[q + 2];
          if ((flags & 0x06) === 0) packets.push({ ms: clusterTime + rel, data: Buffer.from(b.subarray(q + 3, stop)) });
        }
      }
      p = stop;
    }
  };
  walk(0, b.length);
  return { head, packets };
}

/** Muestras (a 48 kHz) de un paquete Opus según su TOC. */
function opusSamples(pkt) {
  if (!pkt.length) return 0;
  const toc = pkt[0];
  const config = toc >> 3;
  let frameMs;
  if (config < 12) frameMs = [10, 20, 40, 60][config % 4];
  else if (config < 16) frameMs = [10, 20][config % 2];
  else frameMs = [2.5, 5, 10, 20][config % 4];
  const c = toc & 3;
  const frames = c === 0 ? 1 : c === 3 ? (pkt[1] ?? 0) & 0x3f : 2;
  return Math.round(frames * frameMs * 48);
}

const OGG_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let j = 0; j < 8; j++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function oggPage(serial, seq, granule, type, packets) {
  const lacing = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) {
      lacing.push(255);
      n -= 255;
    }
    lacing.push(n);
  }
  const h = Buffer.alloc(27 + lacing.length);
  h.write("OggS", 0, "latin1");
  h[4] = 0;
  h[5] = type;
  h.writeUInt32LE(granule % 2 ** 32, 6);
  h.writeUInt32LE(Math.floor(granule / 2 ** 32), 10);
  h.writeUInt32LE(serial, 14);
  h.writeUInt32LE(seq, 18);
  h[26] = lacing.length;
  lacing.forEach((l, i) => (h[27 + i] = l));
  const page = Buffer.concat([h, ...packets]);
  let crc = 0;
  for (const x of page) crc = ((crc << 8) ^ OGG_CRC[((crc >>> 24) ^ x) & 0xff]) >>> 0;
  page.writeUInt32LE(crc, 22);
  return page;
}

function opusTags(comments) {
  const vendor = Buffer.from("BROSS DJ");
  const parts = [Buffer.from("OpusTags", "latin1"), Buffer.alloc(4), vendor, Buffer.alloc(4)];
  parts[1].writeUInt32LE(vendor.length);
  parts[3].writeUInt32LE(comments.length);
  for (const c of comments) {
    const cb = Buffer.from(c, "utf8");
    const l = Buffer.alloc(4);
    l.writeUInt32LE(cb.length);
    parts.push(l, cb);
  }
  return Buffer.concat(parts);
}

/** Arma un Ogg Opus con los paquetes [from, to) (tiempos en ms del WebM). */
function buildOgg(head, packets, comments = []) {
  const serial = (Math.random() * 2 ** 32) >>> 0;
  const preSkip = head.length >= 12 ? head.readUInt16LE(10) : 312;
  const pages = [oggPage(serial, 0, 0, 2, [head]), oggPage(serial, 1, 0, 0, [opusTags(comments)])];
  let seq = 2;
  let granule = preSkip;
  let batch = [];
  let batchBytes = 0;
  const flush = (last) => {
    if (!batch.length && !last) return;
    pages.push(oggPage(serial, seq++, granule, last ? 4 : 0, batch));
    batch = [];
    batchBytes = 0;
  };
  packets.forEach((p, i) => {
    granule += opusSamples(p.data);
    batch.push(p.data);
    batchBytes += p.data.length;
    // ~1 s por página y nunca más de 255 segmentos
    if (batch.length >= 50 || batchBytes > 60000 || i === packets.length - 1) flush(i === packets.length - 1);
  });
  if (!packets.length) flush(true);
  return Buffer.concat(pages);
}

function defaultOpusHead() {
  const h = Buffer.alloc(19);
  h.write("OpusHead", 0, "latin1");
  h[8] = 1;
  h[9] = 2;
  h.writeUInt16LE(312, 10);
  h.writeUInt32LE(48000, 12);
  return h;
}

/** WebM → Ogg. `cuts` (segundos) arma además un archivo por tema. */
function webmToOgg(webm, comments = []) {
  const { head, packets } = parseWebmOpus(webm);
  return buildOgg(head ?? defaultOpusHead(), packets, comments);
}

module.exports = {
  BitWriter,
  encodeFrame,
  encodeFlacTo,
  encodeMp3To,
  wavHeader,
  wavRangeReader,
  writeWavRange,
  parseWebmOpus,
  opusSamples,
  buildOgg,
  webmToOgg,
  defaultOpusHead,
  crc8,
  crc16,
  BLOCK,
};
