import { describe, expect, it } from "vitest";
import { crossfaderGains, type XfCurve } from "../src/engine/xfCurve";

const CURVES: XfCurve[] = ["mix", "smooth", "cut"];

describe("crossfader", () => {
  it("en el centro los dos decks suenan al 100 % (todas las curvas)", () => {
    for (const c of CURVES) expect(crossfaderGains(0.5, c)).toEqual({ a: 1, b: 1 });
  });

  it("en cada borde suena solo ese deck", () => {
    for (const c of CURVES) {
      expect(crossfaderGains(0, c)).toEqual({ a: 1, b: 0 });
      const r = crossfaderGains(1, c);
      expect(r.a).toBeCloseTo(0, 9);
      expect(r.b).toBe(1);
    }
  });

  it("hacia la derecha baja solo el deck A, y de forma continua", () => {
    let prev = 1;
    for (let x = 0.5; x <= 1.0001; x += 0.05) {
      const { a, b } = crossfaderGains(x, "mix");
      expect(b).toBe(1);
      expect(a).toBeLessThanOrEqual(prev + 1e-12);
      prev = a;
    }
    expect(crossfaderGains(0.75, "mix").a).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("hacia la izquierda baja solo el deck B (simétrico)", () => {
    for (let x = 0; x <= 0.5; x += 0.05) {
      const l = crossfaderGains(x, "mix");
      const r = crossfaderGains(1 - x, "mix");
      expect(l.a).toBe(1);
      expect(l.b).toBeCloseTo(r.a, 9);
    }
  });

  it("valores fuera de rango no rompen", () => {
    expect(crossfaderGains(-3)).toEqual({ a: 1, b: 0 });
    expect(crossfaderGains(Number.NaN)).toEqual({ a: 1, b: 1 });
  });
});
