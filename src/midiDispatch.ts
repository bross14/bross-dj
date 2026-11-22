// Acciones MIDI → acciones de la app, y luces del controlador.
// Separado de App: el despachador recibe todo lo que usa por contexto y las
// luces son una función pura (se testea sin controlador).

import type { Dispatch, SetStateAction } from "react";
import { SECONDS_PER_TURN, type AudioEngine, type DeckId, type DeckRuntime, type LibraryTrack } from "./engine/audio";
import type { ChannelState, DeckFx, DeckFxPatch } from "./components/Mixer";
import type { AudioPrefs } from "./settings";
import type { MidiEvent } from "./midi";

type PerDeck<T> = { A: T; B: T };

export interface MidiContext {
  engine: AudioEngine;
  vinyl: PerDeck<boolean>;
  fx: PerDeck<DeckFx>;
  tracks: LibraryTrack[];
  sidelist: string[];
  jogState: { current: PerDeck<{ touch: boolean; acc: number; bendTimer: number }> };
  setVinyl: Dispatch<SetStateAction<PerDeck<boolean>>>;
  setSidelist: Dispatch<SetStateAction<string[]>>;
  patchAudio: (patch: Partial<AudioPrefs>) => void;
  handleCrossfade: (v: number) => void;
  handleMaster: (v: number) => void;
  handlePitch: (deck: DeckId, v: number) => void;
  handleChannel: (deck: DeckId, key: keyof ChannelState, value: number) => void;
  handleCueDown: (deck: DeckId) => void;
  handleCueUp: (deck: DeckId) => void;
  handleHotCue: (deck: DeckId, slot: number) => void;
  handleSync: (deck: DeckId) => void;
  handleKeyLock: (deck: DeckId) => void;
  toggleSlip: (deck: DeckId) => void;
  handleFx: (deck: DeckId, patch: DeckFxPatch) => void;
  handleCueToggle: (deck: DeckId) => void;
  handleLoad: (track: LibraryTrack, deck: DeckId) => Promise<void>;
}

/** Ejecuta una acción que llegó del controlador. */
export function dispatchMidi(e: MidiEvent, c: MidiContext): void {
  const {
    engine,
    vinyl,
    fx,
    tracks,
    sidelist,
    jogState,
    setVinyl,
    setSidelist,
    patchAudio,
    handleCrossfade,
    handleMaster,
    handlePitch,
    handleChannel,
    handleCueDown,
    handleCueUp,
    handleHotCue,
    handleSync,
    handleKeyLock,
    toggleSlip,
    handleFx,
    handleCueToggle,
    handleLoad,
  } = c;

  const m = e.action.match(/^deck([AB])\.(.+)$/);
  if (!m) {
    if (e.phase !== "value") return;
    if (e.action === "mixer.crossfader") handleCrossfade(e.value);
    if (e.action === "mixer.master") handleMaster(e.value);
    if (e.action === "mixer.cueMix") patchAudio({ cueMix: e.value });
    return;
  }
  const deck = m[1] as DeckId;
  const what = m[2];
  if (e.phase === "value") {
    const v = e.value;
    if (what === "pitch") handlePitch(deck, v);
    if (what === "volume") handleChannel(deck, "fader", v);
    if (what === "gain") handleChannel(deck, "gain", v);
    if (what === "eqHigh") handleChannel(deck, "hi", v);
    if (what === "eqMid") handleChannel(deck, "mid", v);
    if (what === "eqLow") handleChannel(deck, "low", v);
    if (what === "filter") handleChannel(deck, "filter", v);
    return;
  }
  const jog = jogState.current[deck];
  if (e.phase === "delta") {
    if (what !== "jog") return;
    // 128 pasos por vuelta (lo habitual); una vuelta = 1.8 s de pista
    const secs = (e.delta / 128) * SECONDS_PER_TURN;
    if (jog.touch && vinyl[deck]) {
      jog.acc += secs;
      engine.scratchMove(deck, jog.acc);
    } else if (engine.deckState(deck).playing) {
      engine.setBend(deck, Math.max(-0.3, Math.min(0.3, e.delta * 0.02)));
      window.clearTimeout(jog.bendTimer);
      jog.bendTimer = window.setTimeout(() => engine.setBend(deck, 0), 80);
    } else {
      engine.seek(deck, engine.deckPosition(deck) + secs);
    }
    return;
  }
  if (what === "cue") {
    if (e.phase === "press") handleCueDown(deck);
    else handleCueUp(deck);
    return;
  }
  if (what === "jogTouch") {
    if (e.phase === "press" && vinyl[deck]) {
      jog.touch = true;
      jog.acc = 0;
      engine.scratchStart(deck);
    } else if (e.phase === "release" && jog.touch) {
      jog.touch = false;
      engine.scratchEnd(deck);
    }
    return;
  }
  if (e.phase !== "press") return;
  const hot = what.match(/^hot(\d)$/);
  if (hot) return handleHotCue(deck, Number(hot[1]) - 1);
  switch (what) {
    case "play":
      engine.toggle(deck);
      break;
    case "sync":
      handleSync(deck);
      break;
    case "keylock":
      handleKeyLock(deck);
      break;
    case "vinyl":
      setVinyl((v) => ({ ...v, [deck]: !v[deck] }));
      break;
    case "slip":
      toggleSlip(deck);
      break;
    case "loop":
      engine.autoLoop(deck);
      break;
    case "loopIn":
      engine.loopIn(deck);
      break;
    case "loopOut":
      engine.loopOut(deck);
      break;
    case "loopHalf":
      engine.loopResize(deck, 0.5);
      break;
    case "loopDouble":
      engine.loopResize(deck, 2);
      break;
    case "reloop":
      engine.reloop(deck);
      break;
    case "echo":
      handleFx(deck, { echo: { on: !fx[deck].echo.on } });
      break;
    case "reverse":
      handleFx(deck, { reverse: { on: !fx[deck].reverse.on } });
      break;
    case "brake":
      handleFx(deck, { brake: { on: !fx[deck].brake.on } });
      break;
    case "pfl":
      handleCueToggle(deck);
      break;
    case "loadSide": {
      const next = tracks.find((t) => t.id === sidelist[0]);
      if (next) {
        void handleLoad(next, deck);
        setSidelist((prev) => prev.slice(1));
      }
      break;
    }
  }
}

export interface LedInput {
  rt: { A: DeckRuntime; B: DeckRuntime };
  synced: PerDeck<boolean>;
  keyLock: PerDeck<boolean>;
  vinyl: PerDeck<boolean>;
  fx: PerDeck<DeckFx>;
  cues: PerDeck<boolean>;
  /** milisegundos, para el parpadeo (performance.now()) */
  now: number;
}

/** Qué luces del controlador van encendidas según el estado de la app. */
export function midiLedStates({ rt, synced, keyLock, vinyl, fx, cues, now }: LedInput): Record<string, boolean> {
  const states: Record<string, boolean> = {};
  for (const d of ["A", "B"] as DeckId[]) {
    const s = rt[d];
    // PLAY parpadea en pausa como en la pantalla (2 Hz aprox.)
    const blink = Math.floor(now / 500) % 2 === 0;
    states[`deck${d}.play`] = s.playing || (s.loaded && blink);
    states[`deck${d}.cue`] = s.cueHeld || s.atCue || (s.loaded && !s.playing && blink);
    states[`deck${d}.sync`] = synced[d];
    states[`deck${d}.keylock`] = keyLock[d];
    states[`deck${d}.vinyl`] = vinyl[d];
    states[`deck${d}.slip`] = s.slip;
    states[`deck${d}.loop`] = s.loopStart != null;
    states[`deck${d}.echo`] = fx[d].echo.on;
    states[`deck${d}.reverse`] = fx[d].reverse.on;
    states[`deck${d}.brake`] = fx[d].brake.on;
    states[`deck${d}.pfl`] = cues[d];
    s.cues.forEach((c, i) => {
      states[`deck${d}.hot${i + 1}`] = c != null;
    });
  }
  return states;
}
