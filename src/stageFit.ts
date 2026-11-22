// Escala de la cabina para llenar la ventana.
//
// La cabina se diseña a STAGE_W×STAGE_H. Se escala por el lado que manda y
// se estira por el otro: en una ventana más alta la biblioteca gana alto, en
// una más ancha los decks se ensanchan. Nunca queda más chica que el diseño.

export const STAGE_W = 1428;
export const STAGE_H = 718;

export function fitStage(winW: number, winH: number): { w: number; h: number; scale: number } {
  if (!(winW > 0) || !(winH > 0)) return { w: STAGE_W, h: STAGE_H, scale: 1 };
  if (winW / winH < STAGE_W / STAGE_H) {
    const scale = winW / STAGE_W;
    return { w: STAGE_W, h: Math.max(STAGE_H, winH / scale), scale };
  }
  const scale = winH / STAGE_H;
  return { w: Math.max(STAGE_W, winW / scale), h: STAGE_H, scale };
}
