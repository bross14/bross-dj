// Compara los temas de una playlist de Spotify con la biblioteca local.
//
// Solo se usan datos (artista, título, duración): la música siempre se toca
// desde los archivos del usuario. La comparación ignora mayúsculas, acentos,
// signos, "feat./ft.", y agregados como "Remastered 2011" o "Radio Edit";
// los nombres de remix SÍ cuentan (un remix es otro tema para un DJ).

export interface SpotifyTrack {
  id: string | null;
  title: string;
  artists: string[];
  durationMs: number;
}

export interface LocalTrackRef {
  id: string;
  title: string;
  artist: string;
  fileName: string;
  duration: number;
}

export interface MatchResult {
  track: SpotifyTrack;
  /** pista local encontrada (o null si falta) */
  local: LocalTrackRef | null;
}

const NOISE = [
  /\b(19|20)\d\d\s+remaster(ed)?\b/g,
  /\bremaster(ed)?(\s+(19|20)\d\d)?(\s+version)?\b/g,
  /\bradio\s+(edit|version|mix)\b/g,
  /\boriginal\s+mix\b/g,
  /\bsingle\s+version\b/g,
  /\balbum\s+version\b/g,
  /\bmono\b|\bstereo\b/g,
  /\bexplicit\b|\bclean\b/g,
  /\bofficial\s+(music\s+)?(video|audio)\b/g,
];

/** Texto comparable: minúsculas, sin acentos ni signos, sin "feat." ni agregados. */
export function normalize(s: string): string {
  let t = (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  // "feat. X" / "ft. X" / "featuring X" hasta el final o hasta un paréntesis
  t = t.replace(/[([]?\s*\b(feat|ft|featuring)\b\.?[^)\]]*[)\]]?/g, " ");
  for (const re of NOISE) t = t.replace(re, " ");
  t = t
    .replace(/&|\+|\by\b|\band\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}

/** Artistas de un campo local ("A, B & C", "A feat. B", "A x B"). */
function splitArtists(s: string): string[] {
  return (s || "")
    .split(/\s*(?:,|;|\/|&|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bvs\.?)\s*/i)
    .map(normalize)
    .filter(Boolean);
}

/** Artista y título de una pista local (con lo que hay en el nombre de archivo si faltan). */
function localParts(t: LocalTrackRef): { title: string; artists: string[] } {
  let title = t.title;
  let artist = t.artist;
  if (!artist || !title) {
    const base = t.fileName.replace(/\.[a-z0-9]+$/i, "");
    const m = base.match(/^\s*(.+?)\s+-\s+(.+?)\s*$/);
    if (m) {
      artist = artist || m[1];
      title = title || m[2];
    } else title = title || base;
  }
  return { title: normalize(title), artists: splitArtists(artist) };
}

/** Puntaje 0..1 de que la pista local sea ese tema de Spotify. */
export function matchScore(sp: SpotifyTrack, local: LocalTrackRef): number {
  const a = normalize(sp.title);
  const b = localParts(local);
  if (!a || !b.title) return 0;
  const titleOk = a === b.title || (a.length >= 4 && b.title.length >= 4 && (a.startsWith(b.title) || b.title.startsWith(a)));
  if (!titleOk) return 0;
  const spArtists = sp.artists.map(normalize).filter(Boolean);
  const artistOk =
    spArtists.length === 0 ||
    b.artists.length === 0 ||
    spArtists.some((x) => b.artists.some((y) => x === y || x.includes(y) || y.includes(x)));
  if (!artistOk) return 0;
  let score = a === b.title ? 0.8 : 0.6;
  if (spArtists.length && b.artists.length) score += 0.15;
  // duración parecida (±8 s): misma versión
  if (local.duration > 0 && sp.durationMs > 0 && Math.abs(local.duration - sp.durationMs / 1000) <= 8) score += 0.05;
  return Math.min(1, score);
}

/** Busca cada tema de la playlist en la biblioteca (el mejor puntaje gana). */
export function matchPlaylist(spTracks: SpotifyTrack[], library: LocalTrackRef[]): MatchResult[] {
  // índice por la primera palabra del título para no comparar todo contra todo
  const index = new Map<string, LocalTrackRef[]>();
  for (const t of library) {
    const key = localParts(t).title.split(" ")[0] || "";
    const list = index.get(key);
    if (list) list.push(t);
    else index.set(key, [t]);
  }
  return spTracks.map((track) => {
    const key = normalize(track.title).split(" ")[0] || "";
    const candidates = index.get(key) ?? [];
    let best: LocalTrackRef | null = null;
    let bestScore = 0;
    for (const c of candidates) {
      const s = matchScore(track, c);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return { track, local: bestScore >= 0.6 ? best : null };
  });
}

/** Texto para buscar el tema (YouTube, tienda) o listar los faltantes. */
export function trackLabel(t: SpotifyTrack): string {
  return `${t.artists.join(", ")} - ${t.title}`;
}
