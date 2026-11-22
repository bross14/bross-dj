import { describe, expect, it } from "vitest";
import { translate } from "../src/i18n";
import { AddonError, parsePackage, sanitizeCss } from "../src/skins";

describe("skins y addons", () => {
  it("lee una skin suelta como addon", () => {
    const a = parsePackage(JSON.stringify({ type: "bross-skin", name: "Mía", filter: "hue-rotate(40deg) saturate(1.2)", vars: { "--accent": "#ff0000" } }));
    expect(a.skins?.[0]).toMatchObject({ name: "Mía", filter: "hue-rotate(40deg) saturate(1.2)", vars: { "--accent": "#ff0000" } });
  });

  it("valida pads, scripts y filtros del addon", () => {
    const pad = { label: "X", script: "deck.play", color: "#112233" };
    const ok = parsePackage(
      JSON.stringify({
        type: "bross-addon",
        name: "Set",
        pads: { A: Array(8).fill(pad) },
        midiScripts: [{ id: "a b!", name: "Play", script: "deck.play", deck: "B" }],
        midiMap: { "deckA.play": { type: "note", channel: 20, number: 300 } },
        filters: [{ name: "House", filter: "genre contains house" }],
      }),
    );
    expect(ok.pads?.A).toHaveLength(8);
    expect(ok.midiScripts?.[0]).toMatchObject({ id: "ab", deck: "B" });
    expect(ok.midiMap?.["deckA.play"]).toEqual({ type: "note", channel: 4, number: 44 });
    expect(() => parsePackage(JSON.stringify({ type: "bross-addon", name: "x", pads: { A: [pad] } }))).toThrow(AddonError);
    expect(() => parsePackage(JSON.stringify({ type: "bross-addon", name: "x", midiScripts: [{ id: "a", script: "deck.volar" }] }))).toThrow(/desconocida/);
    expect(() => parsePackage(JSON.stringify({ type: "bross-skin", name: "x", filter: "url(http://x)" }))).toThrow(/no permitido/);
    expect(() => parsePackage("no es json")).toThrow(/JSON/);
  });

  it("el CSS de una skin no carga nada de afuera", () => {
    const css = sanitizeCss('@import "http://x/a.css"; .a{background:url(http://evil/x.png)} .b{background:url(data:image/png;base64,AA)}');
    expect(css).not.toMatch(/@import|evil/);
    expect(css).toContain("data:image/png");
  });

  it("traduce frases exactas y patrones, y deja lo demás", () => {
    expect(translate("Todas las pistas")).toBe("All tracks");
    expect(translate("  Historial ")).toBe("  History ");
    expect(translate("Importando 3 / 10…")).toBe("Importing 3 / 10…");
    expect(translate("Daft Punk - One More Time")).toBeNull();
  });
});
