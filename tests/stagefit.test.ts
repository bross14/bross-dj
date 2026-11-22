import { describe, expect, it } from "vitest";
import { STAGE_H, STAGE_W, fitStage } from "../src/stageFit";

describe("la cabina llena la ventana", () => {
  it("con la proporción del diseño no se estira", () => {
    const f = fitStage(STAGE_W * 2, STAGE_H * 2);
    expect(f).toEqual({ w: STAGE_W, h: STAGE_H, scale: 2 });
  });

  it("en una ventana más alta, la cabina gana alto (biblioteca)", () => {
    const f = fitStage(1920, 1032);
    expect(f.w).toBe(STAGE_W);
    expect(f.h).toBeGreaterThan(STAGE_H);
    expect(f.w * f.scale).toBeCloseTo(1920, 6);
    expect(f.h * f.scale).toBeCloseTo(1032, 6);
  });

  it("en una ventana más ancha, la cabina gana ancho (decks)", () => {
    const f = fitStage(2560, 1080);
    expect(f.h).toBe(STAGE_H);
    expect(f.w).toBeGreaterThan(STAGE_W);
    expect(f.w * f.scale).toBeCloseTo(2560, 6);
    expect(f.h * f.scale).toBeCloseTo(1080, 6);
  });

  it("tamaños inválidos no rompen", () => {
    expect(fitStage(0, 0)).toEqual({ w: STAGE_W, h: STAGE_H, scale: 1 });
  });
});
