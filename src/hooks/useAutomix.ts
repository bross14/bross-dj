import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { audibleBounds, chooseStyle, mixFrame, planMixIn, planMixOut, styleBeats, type MixStyle } from "../automix";
import type { AutomixStyle } from "../settings";
import type { TransitionOverride } from "../userActions";
import type { AudioEngine, DeckId, DeckRuntime, LibraryTrack } from "../engine/audio";
import type { ChannelState } from "../components/Mixer";

type PerDeck<T> = { A: T; B: T };

const STYLE_NAMES: Record<MixStyle, string> = {
  blend: "fundido",
  bassSwap: "cambio de bajos",
  filter: "barrido de filtro (tonos que chocan)",
  echo: "salida con eco",
  cut: "corte al beat",
};

interface Args {
  engine: AudioEngine;
  rt: { A: DeckRuntime; B: DeckRuntime };
  automixBeats: number;
  automixStyle: AutomixStyle;
  /** transición elegida a mano para la entrada de cada tema */
  transitionsRef: { current: Record<string, TransitionOverride> };
  /** enciende / apaga el eco de un deck (salida con eco) */
  setEcho: (deck: DeckId, on: boolean) => void;
  tracksRef: { current: LibraryTrack[] };
  sidelistRef: { current: string[] };
  setSidelist: Dispatch<SetStateAction<string[]>>;
  crossfadeRef: { current: number };
  handleLoad: (track: LibraryTrack, deck: DeckId) => Promise<void>;
  handleCrossfade: (v: number) => void;
  handleChannel: (deck: DeckId, key: keyof ChannelState, value: number) => void;
  setPitch: Dispatch<SetStateAction<PerDeck<number>>>;
  setRange: Dispatch<SetStateAction<PerDeck<number>>>;
  setSynced: Dispatch<SetStateAction<PerDeck<boolean>>>;
  notify: (msg: string) => void;
}

/**
 * Automix desde la sidelist: sale en una frase antes del silencio final,
 * entra en el primer beat con sonido, sincronizado y enganchado, cruza con
 * intercambio de graves y le cede el cruce al DJ si toca el crossfader.
 */
export function useAutomix({
  engine,
  rt,
  automixBeats,
  automixStyle,
  transitionsRef,
  setEcho,
  tracksRef,
  sidelistRef,
  setSidelist,
  crossfadeRef,
  handleLoad,
  handleCrossfade,
  handleChannel,
  setPitch,
  setRange,
  setSynced,
  notify,
}: Args) {
  // ── AUTOMIX ─────────────────────────────────────────────────────────
  const [automix, setAutomix] = useState(false);
  const autoRef = useRef<{
    busy: boolean;
    mix: null | {
      from: DeckId;
      to: DeckId;
      start: number;
      seconds: number;
      x0: number;
      style: MixStyle;
      /** último estado aplicado (para no repetir llamadas) */
      applied: { fromLow: number; toLow: number; fromFilter: number; toFilter: number; fromEcho: boolean };
      /** último valor que puso el automix (para detectar si lo mueve el DJ) */
      lastX: number;
    };
  }>({ busy: false, mix: null });

  /** Carga el próximo de la sidelist en `deck` y lo saca de la cola. */
  const loadNextFromSide = useCallback(
    async (deck: DeckId): Promise<boolean> => {
      const next = tracksRef.current.find((t) => t.id === sidelistRef.current[0]);
      if (!next) return false;
      setSidelist((prev) => prev.slice(1));
      sidelistRef.current = sidelistRef.current.slice(1);
      await handleLoad(next, deck);
      return engine.deckTrackId(deck) === next.id;
    },
    [engine, handleLoad],
  );

  const toggleAutomix = useCallback(async () => {
    if (automix) {
      setAutomix(false);
      autoRef.current = { busy: false, mix: null };
      return;
    }
    const a = engine.deckState("A");
    const b = engine.deckState("B");
    if (!a.playing && !b.playing) {
      // arranca: primer tema de la sidelist en A, crossfader del lado de A
      if (!sidelistRef.current.length) {
        notify("Automix: agregá temas a la sidelist (botón + en el navegador)");
        return;
      }
      autoRef.current.busy = true;
      const ok = await loadNextFromSide("A");
      autoRef.current.busy = false;
      if (!ok) return;
      handleCrossfade(0);
      engine.play("A");
    } else if (!sidelistRef.current.length) {
      notify("Automix: la sidelist está vacía; se mezcla cuando agregues temas");
    }
    setAutomix(true);
  }, [automix, engine, handleCrossfade, loadNextFromSide, notify]);

  // cada refresco: ¿hay que empezar o avanzar una transición?
  useEffect(() => {
    if (!automix) return;
    const st = autoRef.current;
    const now = performance.now();
    if (st.mix) {
      const m = st.mix;
      // el DJ movió el crossfader: el automix le deja el cruce a él
      if (Math.abs(crossfadeRef.current - m.lastX) > 0.02) {
        handleChannel(m.to, "low", 0.5);
        handleChannel(m.to, "filter", 0.5);
        handleChannel(m.from, "filter", 0.5);
        if (m.applied.fromEcho) setEcho(m.from, false);
        st.mix = null;
        notify("Automix: tomaste el control de este cruce");
        return;
      }
      const p = Math.min(1, (now - m.start) / (m.seconds * 1000));
      const target = m.to === "A" ? 0 : 1;
      const f = mixFrame(m.style, p);
      m.lastX = m.x0 + (target - m.x0) * f.x;
      handleCrossfade(m.lastX);
      // EQ, filtro y eco según el tipo de transición (solo si cambian)
      const a = m.applied;
      const step = (k: "fromLow" | "toLow" | "fromFilter" | "toFilter", deck: DeckId, key: "low" | "filter") => {
        if (Math.abs(a[k] - f[k]) > 0.004) {
          a[k] = f[k];
          handleChannel(deck, key, f[k]);
        }
      };
      step("fromLow", m.from, "low");
      step("toLow", m.to, "low");
      step("fromFilter", m.from, "filter");
      step("toFilter", m.to, "filter");
      if (a.fromEcho !== f.fromEcho) {
        a.fromEcho = f.fromEcho;
        setEcho(m.from, f.fromEcho);
      }
      if (p >= 1) {
        engine.pause(m.from);
        handleChannel(m.from, "low", 0.5);
        handleChannel(m.from, "filter", 0.5);
        handleChannel(m.to, "low", 0.5);
        handleChannel(m.to, "filter", 0.5);
        if (a.fromEcho) setEcho(m.from, false);
        st.mix = null;
      }
      return;
    }
    if (st.busy) return;
    const playingDeck: DeckId | null = rt.A.playing && !rt.B.playing ? "A" : rt.B.playing && !rt.A.playing ? "B" : null;
    if (!playingDeck) return;
    const cur = rt[playingDeck];
    if (!cur.loaded || cur.duration <= 0) return;
    const rate = 1 + (cur.pitch - 0.5) * (cur.range / 50);
    const bounds = audibleBounds(engine.deckDetail(playingDeck), cur.duration);
    // el cruce no puede durar más que el 40 % del tema
    const beats = cur.bpm
      ? Math.min(automixBeats, Math.floor(((bounds.end - bounds.start) * 0.4 * cur.bpm) / 60))
      : automixBeats;
    // sale en una frase de 16 beats, antes del silencio final
    const mixOut = planMixOut({ bounds, bpm: cur.bpm, firstBeat: cur.firstBeat, beats, rate });
    if (cur.position < mixOut) return;
    if (!sidelistRef.current.length) return;
    const to: DeckId = playingDeck === "A" ? "B" : "A";
    st.busy = true;
    void (async () => {
      const ok = await loadNextFromSide(to);
      if (!ok) {
        st.busy = false;
        return;
      }
      const next = engine.deckState(to);
      // la onda detallada llega del worker: se espera un instante para saber
      // dónde empieza el sonido del tema nuevo
      for (let k = 0; k < 20 && !engine.deckDetail(to); k++) await new Promise((r) => setTimeout(r, 50));
      const inBounds = audibleBounds(engine.deckDetail(to), next.duration);
      const out = engine.deckState(playingDeck);
      const override = next.trackId ? transitionsRef.current[next.trackId] : undefined;
      const wanted: AutomixStyle = override?.style ?? automixStyle;
      const keyOf = (id: string | null) => tracksRef.current.find((t) => t.id === id)?.analysis?.camelot ?? null;
      const style: MixStyle =
        wanted === "smart"
          ? chooseStyle({
              fromBpm: out.bpm,
              toBpm: next.bpm,
              fromKey: keyOf(out.trackId),
              toKey: keyOf(next.trackId),
              remaining: (bounds.end - out.position) / rate,
            })
          : wanted;
      const mixBeats = override?.beats ? Math.min(override.beats, beats) : styleBeats(style, beats);
      const trackSeconds = cur.bpm ? (mixBeats * 60) / cur.bpm : Math.max(0, bounds.end - out.position);
      const mixSeconds = Math.max(style === "cut" ? 0.5 : 2, Math.min(trackSeconds, bounds.end - out.position) / rate);
      const f0 = mixFrame(style, 0);
      // entra en el primer compás con sonido, en tempo, con la EQ del estilo
      engine.seek(to, planMixIn(inBounds, next.bpm, next.firstBeat));
      handleChannel(to, "low", f0.toLow);
      handleChannel(to, "filter", f0.toFilter);
      engine.play(to);
      if (next.bpm && engine.deckState(playingDeck).bpm) {
        const res = engine.sync(to);
        if (res?.applied) {
          engine.clearKeyShift(to);
          setPitch((p) => ({ ...p, [to]: res.pitch }));
          setRange((r) => ({ ...r, [to]: res.range }));
          // queda enganchado al que sale durante todo el cruce
          setSynced({ A: to === "A", B: to === "B" });
        }
      }
      st.mix = {
        from: playingDeck,
        to,
        start: performance.now(),
        seconds: mixSeconds,
        x0: crossfadeRef.current,
        style,
        applied: { fromLow: 0.5, toLow: f0.toLow, fromFilter: 0.5, toFilter: f0.toFilter, fromEcho: false },
        lastX: crossfadeRef.current,
      };
      if (wanted === "smart" || override) notify("Automix: " + STYLE_NAMES[style] + (override ? " (elegida para este tema)" : ""));
      st.busy = false;
    })();
  }, [automix, rt, engine, handleChannel, handleCrossfade, loadNextFromSide, notify, automixBeats, automixStyle, setEcho]);

  return { automix, toggleAutomix };
}
