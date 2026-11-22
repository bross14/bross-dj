import { describe, expect, it } from "vitest";
import { bpmCompatible, compatibleKeys, isInside } from "../src/library";
import { audibleBounds, planMixIn, planMixOut } from "../src/automix";
import { computeDetail, computePeaks, downsample } from "../src/engine/waveform";
import { detectKey } from "../src/engine/analysis";
import { beatsLabel } from "../src/components/LoopBar";
import { parseYouTubeId } from "../src/components/YouTubeDeck";
import { comboFromEvent, formatCombo } from "../src/settings";
import { MidiController, type MidiEvent } from "../src/midi";
import { SR, sine } from "./helpers";

describe("biblioteca", () => {
  it("isInside respeta límites de carpeta", () => {
    expect(isInside("C:\\Musica\\House", "C:\\Musica")).toBe(true);
    expect(isInside("C:\\Musica", "c:\\musica\\")).toBe(true);
    expect(isInside("C:\\MusicaVieja", "C:\\Musica")).toBe(false);
  });

  it("claves compatibles en la rueda Camelot", () => {
    expect([...compatibleKeys("8A")].sort()).toEqual(["7A", "8A", "8B", "9A"]);
    expect(compatibleKeys("12B").has("1B")).toBe(true);
    expect(compatibleKeys("1A").has("12A")).toBe(true);
    expect(compatibleKeys("raro").size).toBe(0);
  });

  it("BPM compatible, también a mitad y al doble", () => {
    expect(bpmCompatible(126, 128)).toBe(true);
    expect(bpmCompatible(64, 128)).toBe(true);
    expect(bpmCompatible(140, 128)).toBe(false);
  });
});

describe("automix", () => {
  const detailWithSilence = (pre: number, music: number, post: number) => {
    const rate = 150;
    const n = Math.round((pre + music + post) * rate);
    const low = new Float32Array(n);
    for (let i = Math.round(pre * rate); i < Math.round((pre + music) * rate); i++) low[i] = 0.6;
    return { rate, low, mid: new Float32Array(n), high: new Float32Array(n) };
  };

  it("detecta silencio al principio y al final", () => {
    const b = audibleBounds(detailWithSilence(3, 20, 5), 28);
    expect(b.start).toBeCloseTo(3, 1);
    expect(b.end).toBeCloseTo(23, 1);
  });

  it("sin onda usa el tema entero", () => {
    expect(audibleBounds(null, 100)).toEqual({ start: 0, end: 100 });
  });

  it("la salida termina antes del silencio y cae en frase o compás", () => {
    const bounds = { start: 0, end: 200 };
    const out = planMixOut({ bounds, bpm: 120, firstBeat: 0, beats: 32, rate: 1 });
    expect(out + 16).toBeLessThanOrEqual(200);
    // a 120 BPM un compás son 2 s
    expect(out % 2).toBeCloseTo(0, 6);
  });

  it("la entrada cae en el beat donde empieza la música", () => {
    expect(planMixIn({ start: 3.0, end: 60 }, 120, 0.5)).toBeCloseTo(3.0, 6);
    // nunca después del comienzo del sonido
    expect(planMixIn({ start: 3.2, end: 60 }, 120, 0)).toBeLessThanOrEqual(3.2 + 0.03);
    expect(planMixIn({ start: 4.4, end: 60 }, null, 0)).toBe(4.4);
  });
});

describe("onda y análisis", () => {
  it("picos normalizados a 1", () => {
    const p = computePeaks(sine(440, 2));
    expect(p.length).toBe(1400);
    expect(Math.max(...p)).toBeCloseTo(1, 5);
  });

  it("onda detallada a 150 puntos por segundo", () => {
    const d = computeDetail(sine(440, 4), SR);
    expect(d.low.length).toBeGreaterThan(590);
    expect(d.rate).toBeCloseTo(150, 0);
  });

  it("downsample conserva la duración", () => {
    expect(downsample(new Float32Array(44100), 44100, 22050).length).toBe(22050);
  });

  it("detecta La menor en un acorde La-Do-Mi", () => {
    const n = SR * 8;
    const x = new Float32Array(n);
    for (const f of [220, 261.63, 329.63, 110]) {
      for (let i = 0; i < n; i++) x[i] += 0.2 * Math.sin((2 * Math.PI * f * i) / SR);
    }
    const k = detectKey(downsample(x, SR, 22050), 22050);
    expect(k.keyName).toMatch(/^A min/);
    expect(k.camelot).toBe("8A");
  });
});

describe("controles", () => {
  it("lee links de YouTube", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=jNQXAC9IVRw&t=3")).toBe("jNQXAC9IVRw");
    expect(parseYouTubeId("https://youtu.be/jNQXAC9IVRw")).toBe("jNQXAC9IVRw");
    expect(parseYouTubeId("https://youtube.com/shorts/jNQXAC9IVRw")).toBe("jNQXAC9IVRw");
    expect(parseYouTubeId("jNQXAC9IVRw")).toBe("jNQXAC9IVRw");
    expect(parseYouTubeId("https://example.com/watch?v=jNQXAC9IVRw")).toBeNull();
    expect(parseYouTubeId("hola")).toBeNull();
  });

  it("largo de loop legible", () => {
    expect(beatsLabel(4)).toBe("4");
    expect(beatsLabel(0.5)).toBe("1/2");
    expect(beatsLabel(1 / 32)).toBe("1/32");
  });

  it("atajos de teclado", () => {
    const ev = { code: "KeyS", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false } as KeyboardEvent;
    expect(comboFromEvent(ev)).toBe("Ctrl+KeyS");
    expect(formatCombo("Ctrl+KeyS")).toBe("Ctrl + S");
    expect(comboFromEvent({ code: "ShiftLeft" } as KeyboardEvent)).toBeNull();
  });
});

describe("MIDI", () => {
  const msg = (m: MidiController, ...b: number[]) =>
    (m as unknown as { onMessage(e: { data: Uint8Array }): void }).onMessage({ data: Uint8Array.from(b) });

  it("aprende y traduce botones, perillas y jog", () => {
    const m = new MidiController({});
    const events: MidiEvent[] = [];
    m.onEvent = (e) => events.push(e);
    m.learn("deckA.play");
    msg(m, 0x90, 11, 127);
    m.learn("deckA.pitch");
    msg(m, 0xb0, 1, 64);
    m.learn("deckA.jog");
    msg(m, 0xb0, 33, 1);
    msg(m, 0x90, 11, 127);
    msg(m, 0x80, 11, 0);
    msg(m, 0xb0, 1, 127);
    msg(m, 0xb0, 33, 126);
    expect(events).toEqual([
      { action: "deckA.play", phase: "press" },
      { action: "deckA.play", phase: "release" },
      { action: "deckA.pitch", phase: "value", value: 1 },
      { action: "deckA.jog", phase: "delta", delta: -2 },
    ]);
  });

  it("un control tiene una sola acción", () => {
    const m = new MidiController({});
    m.learn("deckA.play");
    msg(m, 0x90, 5, 127);
    m.learn("deckB.play");
    msg(m, 0x90, 5, 127);
    expect(Object.keys(m.getMap())).toEqual(["deckB.play"]);
  });

  it("las luces solo mandan cambios", () => {
    const sent: number[][] = [];
    const m = new MidiController({ "deckA.play": { type: "note", channel: 0, number: 11 } });
    (m as unknown as { access: unknown }).access = { outputs: new Map([["o", { send: (x: number[]) => sent.push(x) }]]) };
    m.updateLeds({ "deckA.play": true });
    m.updateLeds({ "deckA.play": true });
    m.updateLeds({ "deckA.play": false });
    expect(sent).toEqual([
      [0x90, 11, 127],
      [0x90, 11, 0],
    ]);
  });
});
