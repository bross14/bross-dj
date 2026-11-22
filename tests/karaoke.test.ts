import { describe, expect, it } from "vitest";
import { CdgPlayer, lrcIndexAt, lrcProgress, parseLrc } from "../src/karaoke";

describe("karaoke", () => {
  it("lee LRC con varias marcas, offset y palabras", () => {
    const lines = parseLrc(
      "[ar:Artista]\n[offset:+500]\n[00:10.50]Primera línea\n[00:05.00][00:20.00]Coro\n[00:30.00]<00:30.00>Pa<00:30.50>la<00:31.00>bras",
    );
    expect(lines.map((l) => [l.t, l.text])).toEqual([
      [4.5, "Coro"],
      [10, "Primera línea"],
      [19.5, "Coro"],
      [29.5, "Palabras"],
    ]);
    expect(lrcIndexAt(lines, 3)).toBe(-1);
    expect(lrcIndexAt(lines, 12)).toBe(1);
    expect(lrcProgress(lines, 3, 29.5 + 0.5)).toBeCloseTo(2 / 8, 2);
  });

  it("decodifica CD+G: paleta, borrado y tiles", () => {
    const pk = (inst: number, data: number[]) => {
      const p = new Uint8Array(24);
      p[0] = 0x09;
      p[1] = inst;
      data.forEach((v, i) => (p[4 + i] = v));
      return p;
    };
    // color 1 = rojo puro (r=15): hi = 15<<2 = 0x3c, lo = 0
    const colors = [0, 0, 0x3c, 0, ...Array(12).fill(0)];
    const tile = [0, 1, 2, 3, ...Array(12).fill(0b101010)];
    const packets = [pk(30, colors), pk(1, [0, 0]), pk(6, tile)];
    const buf = new Uint8Array(packets.length * 24);
    packets.forEach((p, i) => buf.set(p, i * 24));
    const cdg = new CdgPlayer(buf);
    cdg.seek(1);
    // fila 2, columna 3: x = 18.., y = 24..
    expect(cdg.pixelAt(18, 24)).toBe(1);
    expect(cdg.pixelAt(19, 24)).toBe(0);
    expect(cdg.pixelAt(0, 0)).toBe(0);
    // volver atrás reinicia
    cdg.seek(0);
    expect(cdg.pixelAt(18, 24)).toBe(0);
  });
});
