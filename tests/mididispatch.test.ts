import { describe, expect, it } from "vitest";
import { dispatchMidi, midiLedStates, type MidiContext } from "../src/midiDispatch";
import type { DeckRuntime } from "../src/engine/audio";

const deck = (over: Partial<DeckRuntime> = {}): DeckRuntime =>
  ({ loaded: true, playing: false, atCue: false, cueHeld: false, slip: false, loopStart: null, cues: Array(8).fill(null), ...over }) as DeckRuntime;
const fxOff = {
  tab: "echo",
  echo: { on: false, beat: 0.4, feedback: 0.4 },
  reverse: { on: false },
  brake: { on: false, time: 0.5 },
  flanger: { on: false, rate: 0.5 },
  phaser: { on: false, rate: 0.5 },
  reverb: { on: false, amount: 0.5 },
  crush: { on: false, bits: 0.5 },
  gate: { on: false, rate: 0.5 },
} as const;
const both = <T,>(v: T) => ({ A: v, B: v });

describe("luces MIDI", () => {
  it("PLAY fijo sonando, parpadea en pausa, apagado sin pista", () => {
    const base = { synced: both(false), keyLock: both(false), vinyl: both(false), fx: both(fxOff as never), cues: both(false) };
    const on = midiLedStates({ ...base, rt: { A: deck({ playing: true }), B: deck({ loaded: false }) }, now: 600 });
    expect(on["deckA.play"]).toBe(true);
    expect(on["deckB.play"]).toBe(false);
    const blinkOn = midiLedStates({ ...base, rt: { A: deck(), B: deck() }, now: 100 });
    const blinkOff = midiLedStates({ ...base, rt: { A: deck(), B: deck() }, now: 600 });
    expect(blinkOn["deckA.play"]).not.toBe(blinkOff["deckA.play"]);
  });

  it("hot cues encendidos solo si están marcados", () => {
    const cues = [1.5, null, 3, null, null, null, null, null];
    const st = midiLedStates({
      rt: { A: deck({ cues }), B: deck() },
      synced: both(false),
      keyLock: both(true),
      vinyl: both(true),
      fx: both(fxOff as never),
      cues: both(false),
      now: 0,
    });
    expect([st["deckA.hot1"], st["deckA.hot2"], st["deckA.hot3"]]).toEqual([true, false, true]);
    expect(st["deckA.keylock"]).toBe(true);
  });
});

describe("despachador MIDI", () => {
  it("lleva cada control a su acción", () => {
    const calls: string[] = [];
    const log = (name: string) => (...a: unknown[]) => void calls.push(`${name}(${a.join(",")})`);
    const ctx = {
      engine: { toggle: log("toggle"), autoLoop: log("autoLoop"), deckState: () => ({ playing: false }) },
      vinyl: both(true),
      fx: both(fxOff),
      tracks: [],
      sidelist: [],
      jogState: { current: both({ touch: false, acc: 0, bendTimer: 0 }) },
      setVinyl: log("setVinyl"),
      setSidelist: log("setSidelist"),
      patchAudio: (p: object) => calls.push(`patchAudio(${JSON.stringify(p)})`),
      handleCrossfade: log("crossfade"),
      handleMaster: log("master"),
      handlePitch: log("pitch"),
      handleChannel: log("channel"),
      handleCueDown: log("cueDown"),
      handleCueUp: log("cueUp"),
      handleHotCue: log("hotCue"),
      handleSync: log("sync"),
      handleKeyLock: log("keyLock"),
      toggleSlip: log("slip"),
      handleFx: (d: string, p: object) => calls.push(`fx(${d},${JSON.stringify(p)})`),
      handleCueToggle: log("pfl"),
      handleLoad: async () => undefined,
    } as unknown as MidiContext;
    dispatchMidi({ action: "deckA.play", phase: "press" }, ctx);
    dispatchMidi({ action: "deckA.play", phase: "release" }, ctx);
    dispatchMidi({ action: "deckB.cue", phase: "press" }, ctx);
    dispatchMidi({ action: "deckB.cue", phase: "release" }, ctx);
    dispatchMidi({ action: "deckA.hot3", phase: "press" }, ctx);
    dispatchMidi({ action: "deckA.volume", phase: "value", value: 0.25 }, ctx);
    dispatchMidi({ action: "mixer.crossfader", phase: "value", value: 1 }, ctx);
    dispatchMidi({ action: "mixer.cueMix", phase: "value", value: 0.5 }, ctx);
    dispatchMidi({ action: "deckB.echo", phase: "press" }, ctx);
    dispatchMidi({ action: "deckA.loop", phase: "press" }, ctx);
    expect(calls).toEqual([
      "toggle(A)",
      "cueDown(B)",
      "cueUp(B)",
      "hotCue(A,2)",
      "channel(A,fader,0.25)",
      "crossfade(1)",
      'patchAudio({"cueMix":0.5})',
      'fx(B,{"echo":{"on":true}})',
      "autoLoop(A)",
    ]);
  });
});
