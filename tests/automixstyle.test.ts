import { describe, expect, it } from "vitest";
import { chooseStyle, mixFrame, styleBeats } from "../src/automix";

describe("tipos de transición del automix", () => {
  const base = { fromBpm: 124, toBpm: 126, fromKey: "8A", toKey: "9A", remaining: 60 };

  it("el modo inteligente elige según BPM, tono y lo que queda", () => {
    expect(chooseStyle(base)).toBe("bassSwap");
    expect(chooseStyle({ ...base, toKey: "3B" })).toBe("filter");
    expect(chooseStyle({ ...base, toBpm: 174 })).toBe("echo");
    expect(chooseStyle({ ...base, toBpm: 62 })).toBe("bassSwap"); // mitad de tempo
    expect(chooseStyle({ ...base, toBpm: null })).toBe("echo");
    expect(chooseStyle({ ...base, remaining: 4 })).toBe("cut");
  });

  it("cada estilo arranca y termina en su lugar", () => {
    for (const s of ["blend", "bassSwap", "filter", "echo", "cut"] as const) {
      const end = mixFrame(s, 1);
      expect(mixFrame(s, 0).x).toBe(0);
      expect(end.x).toBe(1);
    }
    expect(mixFrame("bassSwap", 0).toLow).toBe(0);
    expect(mixFrame("bassSwap", 0.6)).toMatchObject({ fromLow: 0, toLow: 0.5 });
    expect(mixFrame("filter", 0).toFilter).toBeLessThan(0.2);
    expect(mixFrame("filter", 1).fromFilter).toBeGreaterThan(0.85);
    expect(mixFrame("echo", 0.4).fromEcho).toBe(true);
    expect(mixFrame("cut", 0.49).x).toBe(0);
    expect(styleBeats("cut", 32)).toBe(4);
    expect(styleBeats("blend", 32)).toBe(32);
  });
});
