// Mini-DSL de las carpetas filtro.
//
//   bpm 120..128 and key ~ 8A
//   genre contains house or genre contains techno
//   played > 3 and not artist = "Daft Punk"
//   year >= 2020 lastplayed > 30
//   deep house                       (palabras sueltas: buscan en cualquier campo)
//
// Campos: title artist album genre year bpm key length played lastplayed file
// Operadores: = != > < >= <= ~ (compatible / contiene) contains starts a..b
// Conectores: and (o nada), or, not, paréntesis. Comillas para textos con espacios.

import { bpmCompatible, compatibleKeys } from "./library";

export interface FilterTrack {
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  year?: string;
  fileName?: string;
  duration?: number;
  bpm: number | null;
  key: string | null;
  /** veces que sonó (historial) */
  played: number;
  /** milisegundos de la última vez que sonó */
  lastPlayed: number | null;
}

type Field = "title" | "artist" | "album" | "genre" | "year" | "bpm" | "key" | "length" | "played" | "lastplayed" | "file";
type Op = "=" | "!=" | ">" | "<" | ">=" | "<=" | "~" | "contains" | "starts" | "range";

export type FilterNode =
  | { t: "and" | "or"; a: FilterNode; b: FilterNode }
  | { t: "not"; a: FilterNode }
  | { t: "cond"; field: Field; op: Op; value: string; value2?: string }
  | { t: "text"; value: string };

const FIELDS: Record<string, Field> = {
  title: "title", titulo: "title", "título": "title",
  artist: "artist", artista: "artist",
  album: "album", "álbum": "album",
  genre: "genre", genero: "genre", "género": "genre",
  year: "year", ano: "year", "año": "year",
  bpm: "bpm",
  key: "key", tono: "key", clave: "key",
  length: "length", duration: "length", duracion: "length", "duración": "length",
  played: "played", tocada: "played", plays: "played",
  lastplayed: "lastplayed", ultima: "lastplayed",
  file: "file", archivo: "file",
};

const OPS = new Set(["=", "!=", ">", "<", ">=", "<=", "~", "contains", "contiene", "starts", "empieza", "is", "es"]);

export class FilterError extends Error {}

function tokenize(src: string): string[] {
  const out: string[] = [];
  const re = /\s*("([^"]*)"|\(|\)|>=|<=|!=|=|>|<|~|[^\s()"=<>!~]+)/gy;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(src))) {
    last = re.lastIndex;
    out.push(m[2] != null ? `"${m[2]}` : m[1]);
  }
  if (src.slice(last).trim()) throw new FilterError(`No entiendo "${src.slice(last).trim()}"`);
  return out;
}

const unq = (tok: string) => (tok.startsWith('"') ? tok.slice(1) : tok);

/** Convierte el texto del filtro en un árbol. Lanza FilterError si no se entiende. */
export function parseFilter(src: string): FilterNode | null {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i]?.toLowerCase();
  const atEnd = () => i >= toks.length;

  const parseOr = (): FilterNode => {
    let a = parseAnd();
    while (peek() === "or") {
      i++;
      a = { t: "or", a, b: parseAnd() };
    }
    return a;
  };
  const parseAnd = (): FilterNode => {
    let a = parseUnary();
    for (;;) {
      const p = peek();
      if (p === "and") {
        i++;
        a = { t: "and", a, b: parseUnary() };
      } else if (!atEnd() && p !== ")" && p !== "or") {
        a = { t: "and", a, b: parseUnary() };
      } else return a;
    }
  };
  const parseUnary = (): FilterNode => {
    const p = peek();
    if (p === "not") {
      i++;
      return { t: "not", a: parseUnary() };
    }
    if (p === "(") {
      i++;
      const e = parseOr();
      if (peek() !== ")") throw new FilterError("Falta cerrar el paréntesis");
      i++;
      return e;
    }
    if (p == null) throw new FilterError("El filtro termina de golpe");
    if (p === ")") throw new FilterError("Paréntesis de más");
    const tok = toks[i++];
    const field = tok.startsWith('"') ? undefined : FIELDS[tok.toLowerCase()];
    const next = peek();
    if (field && next != null && OPS.has(next)) {
      i++;
      let op = next as string;
      if (op === "contiene") op = "contains";
      if (op === "empieza") op = "starts";
      if (op === "is" || op === "es") op = "=";
      const v = toks[i++];
      if (v == null) throw new FilterError(`Falta el valor después de "${tok} ${next}"`);
      return { t: "cond", field, op: op as Op, value: unq(v) };
    }
    // campo seguido de un rango o un valor directo: "bpm 120..128", "key 8A"
    if (field && next != null && next !== ")" && next !== "and" && next !== "or" && next !== "not") {
      const v = unq(toks[i++]);
      const r = v.match(/^(-?[\d.]+)\.\.(-?[\d.]+)$/);
      if (r) return { t: "cond", field, op: "range", value: r[1], value2: r[2] };
      return { t: "cond", field, op: field === "key" ? "=" : "contains", value: v };
    }
    return { t: "text", value: unq(tok) };
  };

  if (!toks.length) return null;
  const tree = parseOr();
  if (!atEnd()) throw new FilterError(`Sobra "${toks[i]}"`);
  return tree;
}

const DAY = 86400000;

function fieldValue(f: Field, t: FilterTrack, now: number): string | number | null {
  switch (f) {
    case "title":
      return t.title;
    case "artist":
      return t.artist;
    case "album":
      return t.album ?? "";
    case "genre":
      return t.genre ?? "";
    case "file":
      return t.fileName ?? "";
    case "year": {
      const y = parseInt(t.year ?? "", 10);
      return Number.isFinite(y) ? y : null;
    }
    case "bpm":
      return t.bpm;
    case "key":
      return t.key;
    case "length":
      return t.duration ?? null;
    case "played":
      return t.played;
    case "lastplayed":
      // días desde la última vez (nunca = infinito)
      return t.lastPlayed == null ? Infinity : (now - t.lastPlayed) / DAY;
  }
}

/** "3:30" → 210 (para length); el resto, número tal cual. */
function toNumber(field: Field, v: string): number {
  if (field === "length" && v.includes(":")) {
    const [m, s] = v.split(":");
    return Number(m) * 60 + Number(s);
  }
  return Number(v);
}

function evalCond(n: Extract<FilterNode, { t: "cond" }>, t: FilterTrack, now: number): boolean {
  const raw = fieldValue(n.field, t, now);
  if (n.field === "key") {
    const k = (raw as string | null)?.toUpperCase() ?? "";
    const v = n.value.toUpperCase();
    if (n.op === "~") return !!k && compatibleKeys(v).has(k);
    if (n.op === "!=") return k !== v;
    return k === v;
  }
  if (typeof raw === "string") {
    const a = raw.toLowerCase();
    const v = n.value.toLowerCase();
    switch (n.op) {
      case "=":
        return a === v;
      case "!=":
        return a !== v;
      case "starts":
        return a.startsWith(v);
      case "contains":
      case "~":
        return a.includes(v);
      default: {
        // comparación de texto (">" "<"), poco usada pero coherente
        const c = a.localeCompare(v);
        return n.op === ">" ? c > 0 : n.op === "<" ? c < 0 : n.op === ">=" ? c >= 0 : c <= 0;
      }
    }
  }
  if (raw == null) return n.op === "!=";
  const num = raw;
  if (n.op === "range") {
    const lo = toNumber(n.field, n.value);
    const hi = toNumber(n.field, n.value2 ?? n.value);
    return num >= Math.min(lo, hi) && num <= Math.max(lo, hi);
  }
  const v = toNumber(n.field, n.value);
  if (!Number.isFinite(v)) return false;
  switch (n.op) {
    case "=":
    case "contains":
    case "starts":
      return n.field === "bpm" ? Math.abs(num - v) < 0.5 : num === v;
    case "~":
      return n.field === "bpm" ? bpmCompatible(num, v) : Math.abs(num - v) <= Math.abs(v) * 0.06;
    case "!=":
      return num !== v;
    case ">":
      return num > v;
    case "<":
      return num < v;
    case ">=":
      return num >= v;
    case "<=":
      return num <= v;
  }
  return false;
}

export function evalFilter(n: FilterNode, t: FilterTrack, now = Date.now()): boolean {
  switch (n.t) {
    case "and":
      return evalFilter(n.a, t, now) && evalFilter(n.b, t, now);
    case "or":
      return evalFilter(n.a, t, now) || evalFilter(n.b, t, now);
    case "not":
      return !evalFilter(n.a, t, now);
    case "text": {
      const v = n.value.toLowerCase();
      return [t.title, t.artist, t.album, t.genre, t.fileName].some((x) => x?.toLowerCase().includes(v));
    }
    case "cond":
      return evalCond(n, t, now);
  }
}

/** Devuelve el árbol o el mensaje de error (para mostrarlo al editar). */
export function tryParseFilter(src: string): { tree: FilterNode | null; error: string | null } {
  try {
    return { tree: parseFilter(src), error: null };
  } catch (e) {
    return { tree: null, error: e instanceof Error ? e.message : String(e) };
  }
}
