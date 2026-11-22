// Curvas del crossfader: ganancia de cada deck (0..1) según la posición
// (0 = todo A, 0,5 = centro, 1 = todo B).
//
// En las tres curvas el centro deja los dos decks al 100 %: correr el
// crossfader hacia un lado solo baja el deck del lado contrario.
//  - mix (club, por defecto): el otro deck baja suave (coseno) hasta el borde
//  - smooth: baja en línea recta
//  - cut (scratch): los dos a pleno hasta casi el borde; corte en el último 3 %

export type XfCurve = "mix" | "smooth" | "cut";

export function crossfaderGains(pos: number, curve: XfCurve = "mix"): { a: number; b: number } {
  const x = Math.max(0, Math.min(1, Number.isFinite(pos) ? pos : 0.5));
  if (curve === "cut") {
    return { a: x > 0.97 ? (1 - x) / 0.03 : 1, b: x < 0.03 ? x / 0.03 : 1 };
  }
  if (curve === "smooth") {
    return { a: Math.min(1, 2 * (1 - x)), b: Math.min(1, 2 * x) };
  }
  // del centro al borde, el deck contrario cae con un cuarto de coseno
  // (en el borde, silencio exacto: cos(π/2) no da 0 justo)
  const fade = (d: number) => (d >= 0.5 ? 0 : Math.cos(d * Math.PI));
  return { a: x <= 0.5 ? 1 : fade(x - 0.5), b: x >= 0.5 ? 1 : fade(0.5 - x) };
}
