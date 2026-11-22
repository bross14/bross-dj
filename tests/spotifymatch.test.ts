import { describe, expect, it } from "vitest";
import { matchPlaylist, matchScore, normalize, type LocalTrackRef, type SpotifyTrack } from "../src/spotifyMatch";

const sp = (title: string, artists: string[], sec = 200): SpotifyTrack => ({ id: title, title, artists, durationMs: sec * 1000 });
const lib = (id: string, title: string, artist: string, fileName = `${artist} - ${title}.mp3`, duration = 200): LocalTrackRef => ({
  id,
  title,
  artist,
  fileName,
  duration,
});

describe("normalizar textos", () => {
  it("ignora mayúsculas, acentos, signos y feat.", () => {
    expect(normalize("Canción (feat. Otro Artista)")).toBe("cancion");
    expect(normalize("Despacito - Remix ft. Justin")).toBe("despacito remix");
    expect(normalize("Let It Be - Remastered 2009")).toBe("let it be");
    expect(normalize("Levels (Radio Edit)")).toBe("levels");
    expect(normalize("Simon & Garfunkel")).toBe("simon garfunkel");
  });

  it("un remix no es el original", () => {
    expect(normalize("Titanium (David Guetta Remix)")).not.toBe(normalize("Titanium"));
  });
});

describe("buscar los temas de la playlist en la biblioteca", () => {
  const library = [
    lib("1", "Midnight Run", "Nora Vale"),
    lib("2", "Calle Ocho", "Los Faros"),
    lib("3", "", "", "Tenoch - Ruido Blanco.wav"),
    lib("4", "Titanium", "David Guetta, Sia"),
    lib("5", "Otra Canción", "Nora Vale"),
  ];

  it("encuentra por artista y título, también con etiquetas vacías (nombre de archivo)", () => {
    const res = matchPlaylist(
      [sp("Midnight Run", ["Nora Vale"]), sp("Ruido Blanco", ["Tenoch"]), sp("Calle Ocho - Remastered 2011", ["Los Faros"])],
      library,
    );
    expect(res.map((r) => r.local?.id)).toEqual(["1", "3", "2"]);
  });

  it("no confunde artistas distintos con el mismo título", () => {
    const res = matchPlaylist([sp("Midnight Run", ["Otra Banda"])], library);
    expect(res[0].local).toBeNull();
  });

  it("acepta a uno de varios artistas (Spotify separa, el archivo junta)", () => {
    const res = matchPlaylist([sp("Titanium (feat. Sia)", ["David Guetta"])], library);
    expect(res[0].local?.id).toBe("4");
  });

  it("marca como faltante lo que no está", () => {
    const res = matchPlaylist([sp("Tema Inventado", ["Nadie"])], library);
    expect(res[0].local).toBeNull();
  });

  it("con dos versiones, prefiere la de duración parecida", () => {
    const two = [lib("a", "Levels", "Avicii", "a.mp3", 330), lib("b", "Levels", "Avicii", "b.mp3", 200)];
    const res = matchPlaylist([sp("Levels - Radio Edit", ["Avicii"], 199)], two);
    expect(res[0].local?.id).toBe("b");
    expect(matchScore(sp("Levels", ["Avicii"], 199), two[1])).toBeGreaterThan(matchScore(sp("Levels", ["Avicii"], 199), two[0]));
  });
});
