// Pads de usuario y acciones MIDI con script: guardado y valores por defecto.
import type { DeckId } from "./engine/audio";

export interface UserPad {
  label: string;
  script: string;
  color: string;
}

export interface MidiScript {
  id: string;
  name: string;
  script: string;
  /** deck al que se refiere "deck" en el script */
  deck: "A" | "B";
}

export const USER_PAD_COLORS = ["#ef4b4b", "#f08a3c", "#2f8fe8", "#f5c542", "#27c45f", "#e05fe0", "#22cfd6", "#a78bfa"];

/** Pads de fábrica: ejemplos útiles que se pueden editar. */
export const DEFAULT_USER_PADS: UserPad[] = [
  { label: "PLAY/CUE", script: "deck.playing ? deck.cue : deck.play", color: USER_PAD_COLORS[0] },
  { label: "SYNC+PLAY", script: "deck.sync ; deck.play", color: USER_PAD_COLORS[1] },
  { label: "LOOP 4", script: "deck.loop 4", color: USER_PAD_COLORS[2] },
  { label: "LOOP 8", script: "deck.loop 8", color: USER_PAD_COLORS[3] },
  { label: "ECHO", script: "deck.fx echo", color: USER_PAD_COLORS[4] },
  { label: "FLANGER", script: "deck.fx flanger", color: USER_PAD_COLORS[5] },
  { label: "CARGAR", script: "not deck.playing ? deck.loadSide", color: USER_PAD_COLORS[6] },
  { label: "AL OTRO", script: "crossfader 0.5 ; other.sync", color: USER_PAD_COLORS[7] },
];

/** Transición elegida a mano para la entrada de un tema (editor del automix). */
export interface TransitionOverride {
  style?: "smart" | "blend" | "bassSwap" | "filter" | "echo" | "cut";
  beats?: number;
}

const TRANS_KEY = "bross.transitions.v1";

export function loadTransitions(): Record<string, TransitionOverride> {
  try {
    const v = JSON.parse(localStorage.getItem(TRANS_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function saveTransitions(t: Record<string, TransitionOverride>) {
  try {
    localStorage.setItem(TRANS_KEY, JSON.stringify(t));
  } catch {
    /* sin almacenamiento */
  }
}

const PADS_KEY = "bross.userPads.v1";
const SCRIPTS_KEY = "bross.midiScripts.v1";

export function loadUserPads(): Record<DeckId, UserPad[]> {
  const fresh = () => DEFAULT_USER_PADS.map((p) => ({ ...p }));
  try {
    const v = JSON.parse(localStorage.getItem(PADS_KEY) ?? "null") as Record<DeckId, UserPad[]> | null;
    const ok = (l: unknown): l is UserPad[] =>
      Array.isArray(l) && l.length === 8 && l.every((p) => p && typeof p.script === "string" && typeof p.label === "string");
    if (v && ok(v.A) && ok(v.B)) return v;
  } catch {
    /* sin datos guardados */
  }
  return { A: fresh(), B: fresh() };
}

export function saveUserPads(p: Record<DeckId, UserPad[]>) {
  try {
    localStorage.setItem(PADS_KEY, JSON.stringify(p));
  } catch {
    /* sin almacenamiento */
  }
}

export function loadMidiScripts(): MidiScript[] {
  try {
    const v = JSON.parse(localStorage.getItem(SCRIPTS_KEY) ?? "[]") as MidiScript[];
    return Array.isArray(v) ? v.filter((s) => s && typeof s.id === "string" && typeof s.script === "string") : [];
  } catch {
    return [];
  }
}

export function saveMidiScripts(s: MidiScript[]) {
  try {
    localStorage.setItem(SCRIPTS_KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento */
  }
}
