// Skins y addons propios.
//
// Skin (JSON):  { "type": "bross-skin", "name": "Rojo club",
//                 "filter": "hue-rotate(150deg)",          (opcional, sobre la cabina)
//                 "vars": { "--accent": "#e0453a" },        (opcional, variables CSS)
//                 "css": ".pad { border-radius: 50%; }" }   (opcional, CSS extra)
//
// Addon (JSON): { "type": "bross-addon", "name": "Mi setup", "version": "1",
//                 "skins": [skin...], "pads": { "A": [8 pads], "B": [8 pads] },
//                 "midiScripts": [...], "midiMap": {...}, "filters": [{ "name", "filter" }] }
//
// Son datos, nunca código: el CSS de un skin se limita a estilos (sin @import
// ni url() externas) y los scripts usan el mini-DSL de acciones.

import type { MidiMap } from "./midi";
import type { MidiScript, UserPad } from "./userActions";
import { tryParseScript } from "./actionScript";
import { tryParseFilter } from "./filterDsl";

export interface Skin {
  type: "bross-skin";
  name: string;
  filter?: string;
  vars?: Record<string, string>;
  css?: string;
  /** de fábrica (no se puede quitar) */
  builtin?: boolean;
}

export interface Addon {
  type: "bross-addon";
  name: string;
  version?: string;
  skins?: Skin[];
  pads?: Partial<Record<"A" | "B", UserPad[]>>;
  midiScripts?: MidiScript[];
  midiMap?: MidiMap;
  filters?: { name: string; filter: string }[];
}

export const BUILTIN_SKINS: Skin[] = [
  { type: "bross-skin", name: "BROSS (original)", builtin: true },
  { type: "bross-skin", name: "Rojo club", filter: "hue-rotate(150deg) saturate(1.1)", builtin: true },
  { type: "bross-skin", name: "Esmeralda", filter: "hue-rotate(300deg)", builtin: true },
  { type: "bross-skin", name: "Ámbar", filter: "hue-rotate(195deg) saturate(0.95)", builtin: true },
  { type: "bross-skin", name: "Noche (tenue)", filter: "brightness(0.82) saturate(0.75)", builtin: true },
  { type: "bross-skin", name: "Alto contraste", filter: "contrast(1.25) brightness(1.08)", vars: { "--text-muted": "#d0d0d0" }, builtin: true },
];

const SAFE_FILTER = /^(\s*(hue-rotate\(-?\d+(\.\d+)?deg\)|saturate\(\d+(\.\d+)?\)|brightness\(\d+(\.\d+)?\)|contrast\(\d+(\.\d+)?\)|grayscale\(\d+(\.\d+)?\)|sepia\(\d+(\.\d+)?\)|invert\(\d+(\.\d+)?\))\s*)+$/;

/** CSS de un skin sin cargas externas ni trucos (solo estilos). */
export function sanitizeCss(css: string): string {
  return css
    .slice(0, 100_000)
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*(['"]?)(?!data:image\/)[^)]*\)/gi, "none")
    .replace(/expression\s*\(/gi, "")
    .replace(/<\/?style[^>]*>/gi, "");
}

export class AddonError extends Error {}

function checkSkin(s: unknown): Skin {
  const x = s as Partial<Skin>;
  if (!x || x.type !== "bross-skin" || typeof x.name !== "string" || !x.name.trim()) throw new AddonError("Skin sin nombre o sin type: bross-skin");
  if (x.filter != null && (typeof x.filter !== "string" || !SAFE_FILTER.test(x.filter))) throw new AddonError(`Filtro de skin no permitido: ${String(x.filter)}`);
  const vars: Record<string, string> = {};
  if (x.vars) {
    for (const [k, v] of Object.entries(x.vars)) {
      if (!/^--[a-z0-9-]+$/i.test(k) || typeof v !== "string" || v.length > 200 || /url\(|;|\{|\}/i.test(v)) {
        throw new AddonError(`Variable de skin no permitida: ${k}`);
      }
      vars[k] = v;
    }
  }
  return {
    type: "bross-skin",
    name: x.name.trim().slice(0, 60),
    filter: x.filter,
    vars: Object.keys(vars).length ? vars : undefined,
    css: typeof x.css === "string" ? sanitizeCss(x.css) : undefined,
  };
}

/** Lee un archivo de skin o de addon. Lanza AddonError si algo no es válido. */
export function parsePackage(json: string): Addon {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new AddonError("El archivo no es JSON válido");
  }
  const r = raw as Partial<Addon>;
  if ((raw as { type?: string } | null)?.type === "bross-skin") return { type: "bross-addon", name: (r as unknown as Skin).name, skins: [checkSkin(r)] };
  if (r?.type !== "bross-addon" || typeof r.name !== "string") throw new AddonError("Falta type: bross-addon (o bross-skin) y un nombre");
  const out: Addon = { type: "bross-addon", name: r.name.slice(0, 60), version: typeof r.version === "string" ? r.version : undefined };
  if (r.skins) out.skins = (Array.isArray(r.skins) ? r.skins : []).map(checkSkin);
  if (r.pads) {
    out.pads = {};
    for (const d of ["A", "B"] as const) {
      const list = r.pads[d];
      if (!list) continue;
      if (!Array.isArray(list) || list.length !== 8) throw new AddonError(`Los pads del deck ${d} tienen que ser 8`);
      out.pads[d] = list.map((p, i) => {
        if (!p || typeof p.script !== "string") throw new AddonError(`Pad ${i + 1} sin script`);
        const e = tryParseScript(p.script).error;
        if (e) throw new AddonError(`Pad ${i + 1}: ${e}`);
        return { label: String(p.label ?? `PAD ${i + 1}`).slice(0, 12), script: p.script, color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : "#2f8fe8" };
      });
    }
  }
  if (r.midiScripts) {
    if (!Array.isArray(r.midiScripts)) throw new AddonError("midiScripts tiene que ser una lista");
    out.midiScripts = r.midiScripts.map((s) => {
      const e = tryParseScript(String(s?.script ?? "")).error;
      if (e || typeof s.id !== "string") throw new AddonError(`Acción MIDI "${s?.name}": ${e ?? "sin id"}`);
      return { id: s.id.replace(/[^\w-]/g, "").slice(0, 40), name: String(s.name ?? s.id).slice(0, 60), script: s.script, deck: s.deck === "B" ? "B" : "A" };
    });
  }
  if (r.midiMap && typeof r.midiMap === "object") {
    const map: MidiMap = {};
    for (const [k, b] of Object.entries(r.midiMap)) {
      if (b && (b.type === "note" || b.type === "cc") && Number.isInteger(b.channel) && Number.isInteger(b.number)) {
        map[k] = { type: b.type, channel: b.channel & 15, number: b.number & 127 };
      }
    }
    out.midiMap = map;
  }
  if (r.filters) {
    if (!Array.isArray(r.filters)) throw new AddonError("filters tiene que ser una lista");
    out.filters = r.filters.map((f) => {
      const e = tryParseFilter(String(f?.filter ?? "")).error;
      if (e) throw new AddonError(`Filtro "${f?.name}": ${e}`);
      return { name: String(f.name ?? "Filtro").slice(0, 60), filter: String(f.filter) };
    });
  }
  return out;
}

/** Aplica un skin: filtro en la cabina, variables en :root y CSS extra. */
export function applySkin(skin: Skin | null) {
  const stage = document.getElementById("st");
  if (stage) stage.style.filter = skin?.filter ?? "";
  const root = document.documentElement;
  for (const k of Array.from(root.style)) if (k.startsWith("--")) root.style.removeProperty(k);
  for (const [k, v] of Object.entries(skin?.vars ?? {})) root.style.setProperty(k, v);
  let tag = document.getElementById("bross-skin-css");
  if (!tag) {
    tag = document.createElement("style");
    tag.id = "bross-skin-css";
    document.head.appendChild(tag);
  }
  tag.textContent = skin?.css ?? "";
}

const UI_KEY = "bross.ui.v1";
const ADDONS_KEY = "bross.addons.v1";

/** distribución y estilo de la cabina (independiente del skin) */
export type Visual = "clasica" | "minimal";

export const VISUALS: { id: Visual; name: string; desc: string }[] = [
  { id: "clasica", name: "Clásica", desc: "Pads de colores y luces en cada deck." },
  {
    id: "minimal",
    name: "Minimalista",
    desc: "Todo en grises: solo el color de cada deck en ondas, plato, pads y botones.",
  },
];

/** qué muestra el panel de arriba del mixer: efectos u ondas apiladas */
export type MixPanel = "fx" | "waves";

export interface UiPrefs {
  lang: "es" | "en";
  skin: string;
  visual: Visual;
  mixPanel: MixPanel;
}

export function loadUi(): UiPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(UI_KEY) ?? "{}") as Partial<UiPrefs>;
    return {
      lang: v.lang === "en" ? "en" : "es",
      skin: typeof v.skin === "string" ? v.skin : BUILTIN_SKINS[0].name,
      visual: v.visual === "minimal" ? "minimal" : "clasica",
      mixPanel: v.mixPanel === "waves" ? "waves" : "fx",
    };
  } catch {
    return { lang: "es", skin: BUILTIN_SKINS[0].name, visual: "clasica", mixPanel: "fx" };
  }
}

export function saveUi(u: UiPrefs) {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(u));
  } catch {
    /* sin almacenamiento */
  }
}

export function loadAddons(): Addon[] {
  try {
    const v = JSON.parse(localStorage.getItem(ADDONS_KEY) ?? "[]");
    if (!Array.isArray(v)) return [];
    return v.flatMap((a) => {
      try {
        return [parsePackage(JSON.stringify(a))];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export function saveAddons(a: Addon[]) {
  try {
    localStorage.setItem(ADDONS_KEY, JSON.stringify(a));
  } catch {
    /* sin almacenamiento */
  }
}

/** Todas las skins disponibles: de fábrica + las de los addons instalados. */
export function allSkins(addons: Addon[]): Skin[] {
  return [...BUILTIN_SKINS, ...addons.flatMap((a) => a.skins ?? [])];
}
