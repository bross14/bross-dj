// Login de Spotify (PKCE) sin abrir el navegador ni llamar a Spotify:
// se reemplazan ipcMain, shell y app por dobles de prueba.
import { createRequire } from "module";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, "..");
const { registerSpotifyIpc, apiPath, REDIRECT_URI } = require(path.join(root, "electron/spotify.cjs"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bross-sp-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

type Handler = (...args: unknown[]) => unknown;

function setup() {
  const handlers = new Map<string, Handler>();
  const opened: string[] = [];
  registerSpotifyIpc(
    { handle: (ch: string, fn: Handler) => handlers.set(ch, fn) },
    { app: { getPath: () => tmp }, shell: { openExternal: async (u: string) => void opened.push(u) }, safeStorage: null },
  );
  return { handlers, opened };
}

const hit = (p: string) =>
  new Promise<number>((resolve) => {
    http.get(new URL(p, REDIRECT_URI), (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
  });

const waitFor = async (fn: () => boolean) => {
  for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20));
};

describe("Spotify: solo lectura", () => {
  it("solo permite consultas de lectura de la propia cuenta", () => {
    expect(apiPath("/v1/me")).toBe("/v1/me");
    expect(apiPath("/v1/me/playlists?limit=50")).toBe("/v1/me/playlists?limit=50");
    expect(apiPath("https://api.spotify.com/v1/playlists/37i9dQ/tracks?offset=100")).toBe("/v1/playlists/37i9dQ/tracks?offset=100");
    expect(apiPath("/v1/me/player/play")).toBeNull();
    expect(apiPath("/v1/playlists/abc/followers")).toBeNull();
    expect(apiPath("https://evil.example/v1/me")).toBeNull();
  });
});

describe("Spotify: inicio de sesión con PKCE", () => {
  it("abre la autorización con PKCE y rechaza una respuesta con otro state", async () => {
    const { handlers, opened } = setup();
    const result = handlers.get("bross:spotify-login")!() as Promise<{ ok: boolean; error?: string }>;
    await waitFor(() => opened.length > 0);
    const auth = new URL(opened[0]);
    expect(auth.origin + auth.pathname).toBe("https://accounts.spotify.com/authorize");
    expect(auth.searchParams.get("client_id")).toMatch(/^[0-9a-f]{32}$/);
    expect(auth.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:41733/callback");
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(auth.searchParams.get("scope")?.split(" ").sort()).toEqual(
      ["playlist-read-collaborative", "playlist-read-private", "user-library-read"],
    );
    // nadie que no sea Spotify (con el state correcto) puede completar el login
    expect(await hit("/callback?code=falso&state=otro")).toBe(400);
    const r = await result;
    expect(r.ok).toBe(false);
  });

  it("cancelar en Spotify devuelve un error claro", async () => {
    const { handlers, opened } = setup();
    const result = handlers.get("bross:spotify-login")!() as Promise<{ ok: boolean; error?: string }>;
    await waitFor(() => opened.length > 0);
    const state = new URL(opened[0]).searchParams.get("state");
    expect(await hit(`/callback?error=access_denied&state=${state}`)).toBe(400);
    expect(await result).toEqual({ ok: false, error: "Cancelaste el acceso" });
  });

  it("sin sesión guardada informa desconectado", async () => {
    const { handlers } = setup();
    expect(await handlers.get("bross:spotify-status")!()).toEqual({ connected: false });
  });
});
