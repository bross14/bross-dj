// Ajustes generales de BROSS DJ: dispositivos de audio y atajos de teclado.
// Todo se guarda en localStorage para que sobreviva al reinicio de la app.

export interface AudioPrefs {
  /** id del dispositivo de entrada (micrófono / línea) */
  inputId: string;
  /** salida general (master) */
  masterId: string;
  /** salida de auriculares (CUE) */
  cueId: string;
  /** volumen de la salida de auriculares, 0..1 */
  cueLevel: number;
  /** CUE MIX: 0 = previa, 1 = master */
  cueMix: number;
  /** curva del crossfader */
  xfCurve: "mix" | "smooth" | "cut";
  /** curva de los faders de canal */
  faderCurve: "linear" | "log" | "fast";
  /** volumen del sampler 0..1 */
  samplerVol: number;
  /** automix: largo de la transición en beats */
  automixBeats: number;
  /** automix: tipo de transición */
  automixStyle: AutomixStyle;
  /** grabación: formato del archivo */
  recFormat: RecFormat;
  /** grabación: además, un archivo por tema */
  recSplit: boolean;
  /** grabación: qué se graba */
  recSource: RecSource;
  /** grabación: volumen de la entrada externa 0..2 */
  recInputGain: number;
  /** entrada de línea: escucharla por el master */
  lineInMonitor: boolean;
}

export type RecFormat = "wav" | "flac" | "mp3" | "ogg";
/** master solo · master + micrófono/línea · todo el sonido del sistema (incluye YouTube) */
export type RecSource = "master" | "master+input" | "system";
/** smart elige según las pistas (BPM, tono, frase) */
export type AutomixStyle = "smart" | "blend" | "bassSwap" | "filter" | "echo" | "cut";

export type ShortcutId =
  | "deckA.toggle"
  | "deckA.cue"
  | "deckA.sync"
  | "deckA.keyLock"
  | "deckA.sandbox"
  | "deckB.toggle"
  | "deckB.cue"
  | "deckB.sync"
  | "deckB.keyLock"
  | "deckB.sandbox"
  | "crossfader.left"
  | "crossfader.center"
  | "crossfader.right"
  | "master.up"
  | "master.down"
  | "selected.toggle"
  | "selected.cue";

export interface ShortcutDef {
  id: ShortcutId;
  label: string;
  group: string;
}

export const SHORTCUT_DEFS: ShortcutDef[] = [
  { id: "deckA.toggle", label: "Reproducir / pausar", group: "Deck A" },
  { id: "deckA.cue", label: "CUE (volver al punto de cue)", group: "Deck A" },
  { id: "deckA.sync", label: "SYNC (igualar BPM)", group: "Deck A" },
  { id: "deckA.keyLock", label: "Key lock (bloquear tono)", group: "Deck A" },
  { id: "deckA.sandbox", label: "Sandbox (solo auriculares)", group: "Deck A" },
  { id: "deckB.toggle", label: "Reproducir / pausar", group: "Deck B" },
  { id: "deckB.cue", label: "CUE (volver al punto de cue)", group: "Deck B" },
  { id: "deckB.sync", label: "SYNC (igualar BPM)", group: "Deck B" },
  { id: "deckB.keyLock", label: "Key lock (bloquear tono)", group: "Deck B" },
  { id: "deckB.sandbox", label: "Sandbox (solo auriculares)", group: "Deck B" },
  { id: "crossfader.left", label: "Mover crossfader a la izquierda", group: "Mezclador" },
  { id: "crossfader.center", label: "Centrar crossfader", group: "Mezclador" },
  { id: "crossfader.right", label: "Mover crossfader a la derecha", group: "Mezclador" },
  { id: "master.up", label: "Subir volumen master", group: "Mezclador" },
  { id: "master.down", label: "Bajar volumen master", group: "Mezclador" },
  { id: "selected.toggle", label: "Reproducir / pausar", group: "Deck seleccionado (Shift cambia de deck)" },
  { id: "selected.cue", label: "CUE (suena mientras se mantiene)", group: "Deck seleccionado (Shift cambia de deck)" },
];

export const DEFAULT_SHORTCUTS: Record<ShortcutId, string> = {
  "deckA.toggle": "KeyQ",
  "deckA.cue": "KeyA",
  "deckA.sync": "KeyW",
  "deckA.keyLock": "KeyE",
  "deckA.sandbox": "KeyS",
  "deckB.toggle": "KeyP",
  "deckB.cue": "KeyL",
  "deckB.sync": "KeyO",
  "deckB.keyLock": "KeyI",
  "deckB.sandbox": "KeyK",
  "crossfader.left": "ArrowLeft",
  "crossfader.center": "KeyX",
  "crossfader.right": "ArrowRight",
  "master.up": "ArrowUp",
  "master.down": "ArrowDown",
  "selected.toggle": "Space",
  "selected.cue": "KeyC",
};

export interface AppSettings {
  audio: AudioPrefs;
  shortcuts: Record<ShortcutId, string>;
}

const DEFAULT_AUDIO: AudioPrefs = {
  inputId: "",
  masterId: "",
  cueId: "",
  cueLevel: 0.85,
  cueMix: 0,
  xfCurve: "mix",
  faderCurve: "linear",
  samplerVol: 0.7,
  automixBeats: 32,
  automixStyle: "smart",
  recFormat: "wav",
  recSplit: false,
  recSource: "master",
  recInputGain: 1,
  lineInMonitor: false,
};

const STORAGE_KEY = "bross.settings.v1";

function freshDefaults(): AppSettings {
  return {
    audio: { ...DEFAULT_AUDIO },
    shortcuts: { ...DEFAULT_SHORTCUTS },
  };
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshDefaults();
    const data = JSON.parse(raw) as Partial<AppSettings> | null;
    const audio = { ...DEFAULT_AUDIO, ...(data?.audio ?? {}) };
    const saved = data?.shortcuts ?? {};
    const shortcuts = { ...DEFAULT_SHORTCUTS, ...saved };
    // antes la C centraba el crossfader; ahora es el CUE del deck seleccionado
    if (!("selected.cue" in saved) && shortcuts["crossfader.center"] === "KeyC") {
      shortcuts["crossfader.center"] = DEFAULT_SHORTCUTS["crossfader.center"];
    }
    if (!Number.isFinite(audio.cueLevel)) audio.cueLevel = DEFAULT_AUDIO.cueLevel;
    audio.cueLevel = Math.max(0, Math.min(1, audio.cueLevel));
    if (!Number.isFinite(audio.cueMix)) audio.cueMix = DEFAULT_AUDIO.cueMix;
    if (!["mix", "smooth", "cut"].includes(audio.xfCurve)) audio.xfCurve = DEFAULT_AUDIO.xfCurve;
    if (!["linear", "log", "fast"].includes(audio.faderCurve)) audio.faderCurve = DEFAULT_AUDIO.faderCurve;
    if (!Number.isFinite(audio.samplerVol)) audio.samplerVol = DEFAULT_AUDIO.samplerVol;
    if (![8, 16, 32, 64].includes(audio.automixBeats)) audio.automixBeats = DEFAULT_AUDIO.automixBeats;
    if (!["smart", "blend", "bassSwap", "filter", "echo", "cut"].includes(audio.automixStyle)) audio.automixStyle = "smart";
    if (!["wav", "flac", "mp3", "ogg"].includes(audio.recFormat)) audio.recFormat = "wav";
    if (!["master", "master+input", "system"].includes(audio.recSource)) audio.recSource = "master";
    audio.recSplit = !!audio.recSplit;
    audio.lineInMonitor = !!audio.lineInMonitor;
    if (!Number.isFinite(audio.recInputGain)) audio.recInputGain = 1;
    audio.recInputGain = Math.max(0, Math.min(2, audio.recInputGain));
    for (const id of Object.keys(DEFAULT_SHORTCUTS) as ShortcutId[]) {
      if (typeof shortcuts[id] !== "string") shortcuts[id] = DEFAULT_SHORTCUTS[id];
    }
    return { audio, shortcuts };
  } catch {
    return freshDefaults();
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* almacenamiento lleno o bloqueado: la app sigue andando */
  }
}

const MODIFIER_CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
  "CapsLock",
  "NumLock",
  "ScrollLock",
]);

const KEY_LABELS: Record<string, string> = {
  Space: "Espacio",
  Escape: "Esc",
  Enter: "Enter",
  Backspace: "Retroceso",
  Delete: "Supr",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Home: "Inicio",
  End: "Fin",
  PageUp: "RePág",
  PageDown: "AvPág",
  Insert: "Insert",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
};

function partLabel(part: string): string {
  if (part === "Ctrl" || part === "Alt" || part === "Shift" || part === "Meta") return part;
  if (KEY_LABELS[part]) return KEY_LABELS[part];
  if (part.startsWith("Key")) return part.slice(3);
  if (part.startsWith("Digit")) return part.slice(5);
  if (part.startsWith("Numpad")) return `Num ${part.slice(6)}`;
  return part;
}

/** Texto legible para mostrar el atajo en la interfaz. */
export function formatCombo(combo: string): string {
  if (!combo) return "Sin asignar";
  return combo.split("+").map(partLabel).join(" + ");
}

/** Convierte un keydown en un identificador estable como "Ctrl+KeyS". */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (!e.code || e.code === "Unidentified" || MODIFIER_CODES.has(e.code)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  parts.push(e.code);
  return parts.join("+");
}
