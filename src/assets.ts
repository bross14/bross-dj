// assets.ts — puente entre las imágenes reales del usuario y el código.
//
// Todo archivo que dejes en src/assets/img/ se importa automáticamente
// (Vite le asigna una URL relativa, compatible con Electron/file://).
// Si el archivo no existe, la función devuelve undefined y la app usa
// el diseño CSS de respaldo. No se redibuja ni se regenera ninguna imagen.

const files = import.meta.glob("./assets/img/*.{png,webp,jpg,jpeg,svg}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** Devuelve la URL del archivo con ese nombre, o undefined.
 *  - img("vinyl")     → vinyl.png / vinyl.jpg / vinyl.webp (el que exista)
 *  - img("vinyl.jpg") → solo ese archivo exacto
 */
export function img(name: string): string | undefined {
  const target = name.toLowerCase();
  const wantsExt = target.includes(".");
  for (const [path, url] of Object.entries(files)) {
    const file = (path.split("/").pop() ?? "").toLowerCase();
    const match = wantsExt ? file === target : file.replace(/\.[^.]+$/, "") === target;
    if (match) return url;
  }
  return undefined;
}

/** true si el archivo existe en src/assets/img/. */
export function hasImg(name: string): boolean {
  return img(name) !== undefined;
}

/** Lista de nombres de archivo disponibles (útil para depurar). */
export function imgList(): string[] {
  return Object.keys(files).map((p) => p.split("/").pop() ?? p);
}
