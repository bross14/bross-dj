import { useEffect, type Dispatch, type SetStateAction } from "react";
import { withTags, type LibraryTrack } from "../engine/audio";
import { readTagsFromRegions } from "../engine/tags";

interface Args {
  tracksRef: { current: LibraryTrack[] };
  setTracks: Dispatch<SetStateAction<LibraryTrack[]>>;
}

export function useTagScan({ tracksRef, setTracks }: Args) {
  // Etiquetas en segundo plano para las pistas que ya estaban en la
  // biblioteca antes de que existiera la lectura de tags: de a una, sin
  // apuro, y actualizando la lista en tandas.
  useEffect(() => {
    const bridge = window.bross;
    if (!bridge?.readTagRegion) return;
    let cancelled = false;
    const run = async () => {
      // espera a que la app termine de arrancar
      await new Promise((r) => setTimeout(r, 3000));
      const pending = tracksRef.current.filter((t) => t.sourcePath && !t.tagged).map((t) => t.id);
      let batch = new Map<string, Partial<LibraryTrack>>();
      const flush = () => {
        if (!batch.size) return;
        const done = batch;
        batch = new Map();
        setTracks((prev) => prev.map((t) => (done.has(t.id) ? { ...t, ...done.get(t.id) } : t)));
      };
      for (const id of pending) {
        if (cancelled) return;
        const t = tracksRef.current.find((x) => x.id === id);
        if (!t?.sourcePath || t.tagged) continue;
        try {
          const region = await bridge.readTagRegion!(t.sourcePath);
          const tags = region ? readTagsFromRegions(region.head, region.tail) : {};
          const next = withTags(t, tags);
          batch.set(id, {
            title: next.title,
            artist: next.artist,
            album: next.album,
            genre: next.genre,
            year: next.year,
            tagBpm: next.tagBpm,
            tagKey: next.tagKey,
            tagged: true,
          });
        } catch {
          // archivo movido o ilegible: no se reintenta en cada arranque
          batch.set(id, { tagged: true });
        }
        if (batch.size >= 25) flush();
        await new Promise((r) => setTimeout(r, 15));
      }
      flush();
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

}
