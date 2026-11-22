import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { DeckId, DeckRuntime } from "../engine/audio";
import type { HistoryEntry } from "../library";

interface Args {
  rt: { A: DeckRuntime; B: DeckRuntime };
  setHistory: Dispatch<SetStateAction<HistoryEntry[]>>;
}

/** Registra en el historial cada pista que suena ~10 s seguidos. */
export function usePlayHistory({ rt, setHistory }: Args) {
  // historial: una pista entra cuando lleva ~10 s sonando en un deck
  const playedRef = useRef<{ A: { id: string | null; since: number; logged: boolean }; B: { id: string | null; since: number; logged: boolean } }>({
    A: { id: null, since: 0, logged: false },
    B: { id: null, since: 0, logged: false },
  });
  useEffect(() => {
    for (const d of ["A", "B"] as DeckId[]) {
      const s = rt[d];
      const p = playedRef.current[d];
      if (s.trackId !== p.id) {
        playedRef.current[d] = { id: s.trackId, since: 0, logged: false };
        continue;
      }
      if (!s.trackId || p.logged) continue;
      if (s.playing) {
        if (!p.since) p.since = performance.now();
        if (performance.now() - p.since > 10000) {
          p.logged = true;
          const entry: HistoryEntry = { trackId: s.trackId, title: s.title, artist: s.artist, at: Date.now() };
          setHistory((prev) => [...prev.slice(-49999), entry]);
        }
      } else {
        p.since = 0;
      }
    }
  }, [rt]);

}
