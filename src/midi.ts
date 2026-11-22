// Controladores MIDI: aprendizaje (MIDI-learn), mapeo de acciones y luces
// de retorno (LED feedback). Funciona con cualquier controlador que mande
// notas o CC estándar; el usuario asigna cada control a una acción.

export type MidiKind = "button" | "absolute" | "relative";

export interface MidiActionDef {
  id: string;
  label: string;
  group: string;
  kind: MidiKind;
  /** tiene luz en el controlador (se enciende según el estado) */
  led?: boolean;
}

export interface MidiBinding {
  /** "note" o "cc" */
  type: "note" | "cc";
  channel: number;
  number: number;
}

export type MidiMap = Record<string, MidiBinding>;

const DECK_ACTIONS: Omit<MidiActionDef, "id" | "group">[] = [
  { label: "Play / pausa", kind: "button", led: true },
  { label: "CUE", kind: "button", led: true },
  { label: "SYNC", kind: "button", led: true },
  { label: "Key lock", kind: "button", led: true },
  { label: "Modo vinilo", kind: "button", led: true },
  { label: "SLIP", kind: "button", led: true },
  { label: "LOOP (auto)", kind: "button", led: true },
  { label: "LOOP IN", kind: "button" },
  { label: "LOOP OUT", kind: "button" },
  { label: "Loop a la mitad", kind: "button" },
  { label: "Loop al doble", kind: "button" },
  { label: "RELOOP", kind: "button" },
  { label: "Hot cue 1", kind: "button", led: true },
  { label: "Hot cue 2", kind: "button", led: true },
  { label: "Hot cue 3", kind: "button", led: true },
  { label: "Hot cue 4", kind: "button", led: true },
  { label: "Hot cue 5", kind: "button", led: true },
  { label: "Hot cue 6", kind: "button", led: true },
  { label: "Hot cue 7", kind: "button", led: true },
  { label: "Hot cue 8", kind: "button", led: true },
  { label: "ECHO", kind: "button", led: true },
  { label: "REVERSE", kind: "button", led: true },
  { label: "BREAK", kind: "button", led: true },
  { label: "CUE auriculares (PFL)", kind: "button", led: true },
  { label: "Cargar el primero de la sidelist", kind: "button" },
  { label: "Jog: tocar el plato", kind: "button" },
  { label: "Jog: girar", kind: "relative" },
  { label: "Pitch", kind: "absolute" },
  { label: "Volumen (fader)", kind: "absolute" },
  { label: "Gain", kind: "absolute" },
  { label: "EQ agudos", kind: "absolute" },
  { label: "EQ medios", kind: "absolute" },
  { label: "EQ graves", kind: "absolute" },
  { label: "Filtro", kind: "absolute" },
];

const DECK_IDS = [
  "play", "cue", "sync", "keylock", "vinyl", "slip", "loop", "loopIn", "loopOut", "loopHalf", "loopDouble",
  "reloop", "hot1", "hot2", "hot3", "hot4", "hot5", "hot6", "hot7", "hot8", "echo", "reverse", "brake",
  "pfl", "loadSide", "jogTouch", "jog", "pitch", "volume", "gain", "eqHigh", "eqMid", "eqLow", "filter",
];

export const MIDI_ACTIONS: MidiActionDef[] = [
  ...(["A", "B"] as const).flatMap((d) =>
    DECK_ACTIONS.map((a, i) => ({ ...a, id: `deck${d}.${DECK_IDS[i]}`, group: `Deck ${d}` })),
  ),
  { id: "mixer.crossfader", label: "Crossfader", group: "Mezclador", kind: "absolute" },
  { id: "mixer.master", label: "Volumen master", group: "Mezclador", kind: "absolute" },
  { id: "mixer.cueMix", label: "CUE MIX", group: "Mezclador", kind: "absolute" },
  { id: "global.shift", label: "SHIFT (para scripts: shift ? a : b)", group: "Mezclador", kind: "button" },
];

const MAP_KEY = "bross.midi.v1";

export function loadMidiMap(): MidiMap {
  try {
    const raw = localStorage.getItem(MAP_KEY);
    const v = raw ? (JSON.parse(raw) as MidiMap) : null;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function saveMidiMap(map: MidiMap) {
  try {
    localStorage.setItem(MAP_KEY, JSON.stringify(map));
  } catch {
    /* sin almacenamiento */
  }
}

export function bindingLabel(b: MidiBinding | undefined): string {
  if (!b) return "Sin asignar";
  return `${b.type === "note" ? "Nota" : "CC"} ${b.number} · canal ${b.channel + 1}`;
}

/** Evento ya interpretado: botón apretado/soltado, valor 0..1 o giro relativo. */
export type MidiEvent =
  | { action: string; phase: "press" | "release" }
  | { action: string; phase: "value"; value: number }
  | { action: string; phase: "delta"; delta: number };

/**
 * Conexión con los dispositivos MIDI. Mantiene el mapa acción → control,
 * el modo aprendizaje y las luces de retorno.
 */
export class MidiController {
  private access: MIDIAccess | null = null;
  private map: MidiMap;
  /** índice inverso: "note:0:36" → acción */
  private index = new Map<string, string>();
  private learning: string | null = null;
  private onLearned: ((action: string, b: MidiBinding) => void) | null = null;
  private ledState = new Map<string, boolean>();
  devices: string[] = [];
  onEvent: ((e: MidiEvent) => void) | null = null;
  onDevices: ((names: string[]) => void) | null = null;

  constructor(map: MidiMap) {
    this.map = { ...map };
    this.reindex();
  }

  async start(): Promise<boolean> {
    if (!navigator.requestMIDIAccess) return false;
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      return false;
    }
    const attach = () => {
      if (!this.access) return;
      this.devices = [];
      this.access.inputs.forEach((input) => {
        input.onmidimessage = (e) => this.onMessage(e);
        this.devices.push(input.name ?? "MIDI");
      });
      // al conectar un controlador sus luces arrancan del estado actual
      this.ledState.clear();
      this.onDevices?.(this.devices);
    };
    attach();
    this.access.onstatechange = attach;
    return true;
  }

  getMap(): MidiMap {
    return { ...this.map };
  }

  setMap(map: MidiMap) {
    this.map = { ...map };
    this.reindex();
  }

  /** El próximo control que se mueva queda asignado a `action`. */
  learn(action: string | null, done?: (action: string, b: MidiBinding) => void) {
    this.learning = action;
    this.onLearned = done ?? null;
  }

  private reindex() {
    this.index.clear();
    for (const [action, b] of Object.entries(this.map)) {
      this.index.set(`${b.type}:${b.channel}:${b.number}`, action);
    }
  }

  private onMessage(e: MIDIMessageEvent) {
    const data = e.data;
    if (!data || data.length < 2) return;
    const status = data[0] & 0xf0;
    const channel = data[0] & 0x0f;
    const number = data[1];
    const value = data[2] ?? 0;
    let type: "note" | "cc";
    let pressed: boolean;
    if (status === 0x90) {
      type = "note";
      pressed = value > 0;
    } else if (status === 0x80) {
      type = "note";
      pressed = false;
    } else if (status === 0xb0) {
      type = "cc";
      pressed = value > 0;
    } else {
      return;
    }

    if (this.learning) {
      // se aprende con el primer "apretar" o movimiento, no con la suelta
      if (type === "note" && !pressed) return;
      const b: MidiBinding = { type, channel, number };
      const action = this.learning;
      // un control solo puede tener una acción
      for (const [a, other] of Object.entries(this.map)) {
        if (other.type === type && other.channel === channel && other.number === number) delete this.map[a];
      }
      this.map[action] = b;
      this.reindex();
      this.learning = null;
      this.onLearned?.(action, b);
      return;
    }

    const action = this.index.get(`${type}:${channel}:${number}`);
    if (!action) return;
    // las acciones con script (script.*) son botones
    const def = MIDI_ACTIONS.find((a) => a.id === action) ?? (action.startsWith("script.") ? { kind: "button" as const } : null);
    if (!def) return;
    if (def.kind === "button") {
      this.onEvent?.({ action, phase: pressed ? "press" : "release" });
    } else if (def.kind === "absolute") {
      this.onEvent?.({ action, phase: "value", value: value / 127 });
    } else {
      // relativo en complemento a 2: 1..63 adelante, 65..127 atrás
      const delta = value < 64 ? value : value - 128;
      if (delta !== 0) this.onEvent?.({ action, phase: "delta", delta });
    }
  }

  /** Enciende/apaga las luces que cambiaron (manda solo las diferencias). */
  updateLeds(states: Record<string, boolean>) {
    if (!this.access) return;
    for (const [action, on] of Object.entries(states)) {
      const b = this.map[action];
      if (!b || this.ledState.get(action) === on) continue;
      this.ledState.set(action, on);
      const msg =
        b.type === "note" ? [0x90 | b.channel, b.number, on ? 127 : 0] : [0xb0 | b.channel, b.number, on ? 127 : 0];
      this.access.outputs.forEach((out) => {
        try {
          out.send(msg);
        } catch {
          /* salida desconectada */
        }
      });
    }
  }
}
