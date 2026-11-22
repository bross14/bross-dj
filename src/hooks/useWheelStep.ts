import { useEffect, useRef } from "react";

/**
 * Rueda del mouse sobre un elemento → paso -1 / +1, sin mover la página.
 * React registra onWheel como pasivo (no deja cancelar el scroll), por eso
 * se usa un listener propio.
 */
export function useWheelStep<T extends HTMLElement>(onStep: (dir: 1 | -1) => void) {
  const ref = useRef<T | null>(null);
  const cb = useRef(onStep);
  cb.current = onStep;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY) cb.current(e.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);
  return ref;
}
