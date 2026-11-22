import { describe, expect, it } from "vitest";
import { parseScript, runScript, tryParseScript, type ScriptHost } from "../src/actionScript";

function host(state: Record<string, boolean> = {}, deck: "A" | "B" = "A") {
  const calls: string[] = [];
  const h: ScriptHost = {
    deck,
    run: (d, name, arg) => calls.push(`${d ?? "-"}:${name}${arg != null ? ` ${arg}` : ""}`),
    query: (d, name) => !!state[`${d ?? "-"}:${name}`],
  };
  return { h, calls };
}

describe("scripts de acciones", () => {
  it("acciones simples, en orden y con valor", () => {
    const { h, calls } = host();
    runScript(parseScript("deck.sync ; other.play & deck.loop 8 ; crossfader 0.5 ; deck.fx flanger"), h);
    expect(calls).toEqual(["A:sync", "B:play", "A:loop 8", "-:crossfader 0.5", "A:fx flanger"]);
  });

  it("condiciones con not, shift y rama else", () => {
    const s = parseScript("deck.playing ? deck.cue : deck.play ; not deck.loaded ? deck.loadSide ; shift ? deck.hot 2 : deck.hot 1");
    const a = host({ "A:playing": true, "A:loaded": true });
    runScript(s, a.h);
    expect(a.calls).toEqual(["A:cue", "A:hot 1"]);
    const b = host({ "-:shift": true }, "B");
    runScript(s, b.h);
    expect(b.calls).toEqual(["B:play", "B:loadSide", "B:hot 2"]);
  });

  it("loop sin número es el loop automático", () => {
    const { h, calls } = host();
    runScript(parseScript("deck.loop ; deckB.reloop"), h);
    expect(calls).toEqual(["A:loop", "B:reloop"]);
  });

  it("errores claros", () => {
    expect(tryParseScript("deck.volar").error).toMatch(/desconocida/);
    expect(tryParseScript("deck.hot").error).toMatch(/necesita un valor/);
    expect(tryParseScript("deck.fx guitarra").error).toMatch(/Efecto/);
    expect(tryParseScript("deck.playing ?").error).toBeTruthy();
    expect(tryParseScript("").error).toBeTruthy();
  });
});

describe("stems en scripts", () => {
  it("acepta stem con nombre o valor", () => {
    const { h, calls } = host();
    runScript(parseScript("deck.stem voz ; other.stem bajo=0.25"), h);
    expect(calls).toEqual(["A:stem voz", "B:stem bajo=0.25"]);
    expect(tryParseScript("deck.stem guitarra").error).toMatch(/Stem/);
  });
});
