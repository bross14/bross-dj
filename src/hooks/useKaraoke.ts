import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioEngine, DeckId, DeckRuntime, LibraryTrack } from "../engine/audio";
import { CdgPlayer, parseLrc, type LrcLine, type Singer } from "../karaoke";
import type { Playlist } from "../library";
import type { KaraokeFrame } from "../video/mixer";

const KEY = "bross.karaoke.v1";

interface Saved {
  singers: Singer[];
  background: string | null;
  enabled: boolean;
}

function load(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Saved> | null;
    return { singers: Array.isArray(v?.singers) ? v!.singers : [], background: v?.background ?? null, enabled: !!v?.enabled };
  } catch {
    return { singers: [], background: null, enabled: false };
  }
}

interface Args {
  engine: AudioEngine;
  notify: (msg: string) => void;
  rt: { A: DeckRuntime; B: DeckRuntime };
  tracksRef: { current: LibraryTrack[] };
  playlists: Playlist[];
  handleLoad: (track: LibraryTrack, deck: DeckId) => Promise<void>;
  handleCrossfade: (v: number) => void;
}

/** El karaoke canta en el deck A; la música de fondo va por el B. */
const SING: DeckId = "A";
const BACK: DeckId = "B";

/** Karaoke: turnos de cantantes, tono por cantante, letras y música de fondo. */
export function useKaraoke({ engine, notify, rt, tracksRef, playlists, handleLoad, handleCrossfade }: Args) {
  const saved = useRef(load());
  const [enabled, setEnabled] = useState(saved.current.enabled);
  const [singers, setSingers] = useState<Singer[]>(saved.current.singers);
  const [background, setBackground] = useState<string | null>(saved.current.background);
  const [current, setCurrent] = useState<Singer | null>(null);
  const [lyrics, setLyrics] = useState<{ trackId: string; lrc: LrcLine[] | null; cdg: CdgPlayer | null } | null>(null);
  const karaokeRef = useRef<KaraokeFrame>({ deck: null, lrc: null, cdg: null, singer: null });
  const bgBusy = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ singers, background, enabled }));
    } catch {
      /* sin almacenamiento */
    }
  }, [singers, background, enabled]);

  // letras de la pista que está en el deck del karaoke (.cdg o .lrc al lado del archivo)
  const singId = rt[SING].trackId;
  useEffect(() => {
    if (!enabled || !singId) {
      setLyrics(null);
      return;
    }
    if (lyrics?.trackId === singId) return;
    const t = tracksRef.current.find((x) => x.id === singId);
    const b = window.bross;
    if (!t?.sourcePath || !b?.readSidecar) {
      setLyrics({ trackId: singId, lrc: null, cdg: null });
      return;
    }
    let alive = true;
    void (async () => {
      const cdg = await b.readSidecar!(t.sourcePath!, ".cdg").catch(() => null);
      const lrc = cdg ? null : await b.readSidecar!(t.sourcePath!, ".lrc").catch(() => null);
      if (!alive) return;
      setLyrics({
        trackId: singId,
        cdg: cdg ? new CdgPlayer(new Uint8Array(cdg)) : null,
        lrc: lrc ? parseLrc(new TextDecoder().decode(lrc)) : null,
      });
    })();
    return () => {
      alive = false;
    };
  }, [enabled, singId]);

  useEffect(() => {
    karaokeRef.current = enabled
      ? { deck: SING, lrc: lyrics?.lrc ?? null, cdg: lyrics?.cdg ?? null, singer: current?.name ?? null }
      : { deck: null, lrc: null, cdg: null, singer: null };
  }, [enabled, lyrics, current]);

  /** Pasa al próximo cantante: carga su tema, le pone su tono y cruza al deck del karaoke. */
  const nextSinger = useCallback(async () => {
    const next = singers.find((s) => s.trackId);
    if (!next) {
      notify("Karaoke: no hay cantantes con tema en la lista");
      return;
    }
    const t = tracksRef.current.find((x) => x.id === next.trackId);
    if (!t) {
      notify(`Karaoke: el tema de ${next.name} ya no está en la biblioteca`);
      setSingers((prev) => prev.filter((s) => s.id !== next.id));
      return;
    }
    setSingers((prev) => prev.filter((s) => s.id !== next.id));
    await handleLoad(t, SING);
    if (engine.deckTrackId(SING) !== t.id) return;
    if (next.key) engine.setKeyShift(SING, next.key);
    else engine.clearKeyShift(SING);
    engine.seek(SING, 0);
    engine.play(SING);
    handleCrossfade(0);
    // la música de fondo baja y se para
    window.setTimeout(() => engine.pause(BACK), 1500);
    setCurrent(next);
    notify(`Karaoke: canta ${next.name}${next.key ? ` (tono ${next.key > 0 ? "+" : ""}${next.key})` : ""}`);
  }, [engine, handleCrossfade, handleLoad, notify, singers]);

  // música de fondo entre cantantes: cuando el deck del karaoke se para
  const singPlaying = rt[SING].playing;
  const backPlaying = rt[BACK].playing;
  useEffect(() => {
    if (!enabled || !background || singPlaying || backPlaying || bgBusy.current) return;
    const list = playlists.find((p) => p.id === background);
    const ids = (list?.trackIds ?? []).filter((id) => tracksRef.current.some((t) => t.id === id));
    if (!ids.length) return;
    bgBusy.current = true;
    const pick = tracksRef.current.find((t) => t.id === ids[Math.floor(Math.random() * ids.length)])!;
    void handleLoad(pick, BACK).then(() => {
      bgBusy.current = false;
      if (engine.deckTrackId(BACK) !== pick.id) return;
      engine.play(BACK);
      handleCrossfade(1);
      setCurrent(null);
    });
  }, [enabled, background, singPlaying, backPlaying, playlists, engine, handleLoad, handleCrossfade]);

  const addSinger = useCallback((name: string, trackId: string | null, key = 0) => {
    setSingers((prev) => [...prev, { id: crypto.randomUUID(), name: name.trim() || "Cantante", trackId, key }]);
  }, []);

  const updateSinger = useCallback((id: string, patch: Partial<Singer>) => {
    setSingers((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const removeSinger = useCallback((id: string) => setSingers((prev) => prev.filter((s) => s.id !== id)), []);

  const moveSinger = useCallback((id: string, dir: -1 | 1) => {
    setSingers((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);

  /** Cambia el tono del cantante que está cantando, en vivo. */
  const setCurrentKey = useCallback(
    (key: number) => {
      setCurrent((c) => (c ? { ...c, key } : c));
      if (key) engine.setKeyShift(SING, key);
      else engine.clearKeyShift(SING);
    },
    [engine],
  );

  return {
    karaoke: enabled,
    setKaraoke: setEnabled,
    singers,
    addSinger,
    updateSinger,
    removeSinger,
    moveSinger,
    nextSinger,
    currentSinger: current,
    setCurrentKey,
    background,
    setBackground,
    lyrics,
    karaokeRef,
  };
}
