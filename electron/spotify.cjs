// Spotify: inicio de sesión (OAuth con PKCE) y lectura de playlists.
//
// Solo se leen datos (playlists y sus temas) para armar listas con los
// archivos del usuario. No se reproduce nada de Spotify: sus términos no
// permiten mezclar su música y tampoco entrega el audio a otras apps.
//
// PKCE: la app de escritorio no guarda ningún secreto. El Client ID es
// público por diseño. El login se hace en el navegador del sistema (la app
// nunca ve la contraseña) y la respuesta vuelve a un servidor que escucha
// solo en 127.0.0.1 durante el login. Las credenciales se guardan cifradas
// con safeStorage (DPAPI en Windows) en la carpeta de datos de la app.
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const CLIENT_ID = "563daac4d62c46b9a1bdb6d5465adffe";
const PORT = 41733;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = "playlist-read-private playlist-read-collaborative user-library-read";
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Solo estas lecturas de la API (nada que modifique la cuenta). */
const ALLOWED = [
  /^\/v1\/me$/,
  /^\/v1\/me\/playlists(\?[^#]*)?$/,
  /^\/v1\/me\/tracks(\?[^#]*)?$/,
  /^\/v1\/playlists\/[A-Za-z0-9]+\/tracks(\?[^#]*)?$/,
];

function apiPath(urlOrPath) {
  try {
    const u = new URL(urlOrPath, "https://api.spotify.com");
    if (u.origin !== "https://api.spotify.com") return null;
    const p = u.pathname + u.search;
    return ALLOWED.some((re) => re.test(p)) ? p : null;
  } catch {
    return null;
  }
}

const PAGE = (title, text) => `<!doctype html><meta charset="utf-8"><title>BROSS DJ</title>
<body style="font-family:system-ui,sans-serif;background:#141414;color:#eee;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h2 style="margin:0 0 8px">${title}</h2><p style="color:#aaa;margin:0">${text}</p></div></body>`;

function registerSpotifyIpc(ipcMain, { app, shell, safeStorage }) {
  const file = path.join(app.getPath("userData"), "spotify.bin");
  let tokens = null;
  let loginInProgress = null;

  const load = () => {
    if (tokens) return tokens;
    try {
      const raw = fs.readFileSync(file);
      const json = safeStorage?.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString("utf8");
      tokens = JSON.parse(json);
    } catch {
      tokens = null;
    }
    return tokens;
  };
  const save = (t) => {
    tokens = t;
    const json = JSON.stringify(t);
    const data = safeStorage?.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, "utf8");
    fs.writeFileSync(file, data);
  };
  const clear = () => {
    tokens = null;
    try {
      fs.unlinkSync(file);
    } catch {
      /* no había sesión */
    }
  };

  const tokenRequest = async (params) => {
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: CLIENT_ID, ...params }).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    };
  };

  const accessToken = async () => {
    const t = load();
    if (!t) return null;
    if (Date.now() < t.expires_at - 60_000) return t.access_token;
    if (!t.refresh_token) return null;
    try {
      const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token });
      save({ ...t, ...fresh, refresh_token: fresh.refresh_token || t.refresh_token });
      return tokens.access_token;
    } catch {
      clear();
      return null;
    }
  };

  const apiGet = async (p) => {
    let token = await accessToken();
    if (!token) return { ok: false, status: 401, error: "Sin sesión de Spotify" };
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`https://api.spotify.com${p}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401 && attempt === 0 && tokens) {
        tokens.expires_at = 0; // forzar renovación
        token = await accessToken();
        if (!token) return { ok: false, status: 401, error: "La sesión de Spotify venció" };
        continue;
      }
      if (res.status === 429) {
        const wait = Math.min(10, Number(res.headers.get("retry-after")) || 2);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) return { ok: false, status: res.status, error: data?.error?.message || `HTTP ${res.status}` };
      return { ok: true, data };
    }
    return { ok: false, status: 429, error: "Spotify pidió esperar; probá de nuevo en un momento" };
  };

  const login = () =>
    new Promise((resolve) => {
      const verifier = b64url(crypto.randomBytes(48));
      const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
      const state = b64url(crypto.randomBytes(16));
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        // close() espera las conexiones keep-alive del navegador: se cortan
        // para liberar el puerto (si no, el próximo login diría "ocupado")
        server.close();
        setTimeout(() => server.closeAllConnections?.(), 500);
        resolve(result);
      };
      const server = http.createServer(async (req, res) => {
        res.setHeader("Connection", "close");
        const u = new URL(req.url, REDIRECT_URI);
        if (u.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        const err = u.searchParams.get("error");
        if (err || u.searchParams.get("state") !== state || !u.searchParams.get("code")) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(PAGE("No se conectó", "Cancelaste el acceso o la respuesta no era válida. Podés cerrar esta pestaña."));
          finish({ ok: false, error: err === "access_denied" ? "Cancelaste el acceso" : "Respuesta de Spotify no válida" });
          return;
        }
        try {
          const t = await tokenRequest({
            grant_type: "authorization_code",
            code: u.searchParams.get("code"),
            redirect_uri: REDIRECT_URI,
            code_verifier: verifier,
          });
          save(t);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(PAGE("Listo, Spotify conectado", "Podés cerrar esta pestaña y volver a BROSS DJ."));
          const me = await apiGet("/v1/me");
          finish({ ok: true, user: me.ok ? me.data.display_name || me.data.id : null });
        } catch (e) {
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          res.end(PAGE("No se conectó", "Spotify no aceptó el inicio de sesión. Probá de nuevo desde BROSS DJ."));
          finish({ ok: false, error: String(e.message || e) });
        }
      });
      const timer = setTimeout(() => finish({ ok: false, error: "Se agotó el tiempo para iniciar sesión" }), LOGIN_TIMEOUT_MS);
      server.on("error", (e) =>
        finish({ ok: false, error: e.code === "EADDRINUSE" ? `El puerto ${PORT} está ocupado por otro programa` : String(e.message || e) }),
      );
      server.listen(PORT, "127.0.0.1", () => {
        const auth = new URL("https://accounts.spotify.com/authorize");
        auth.search = new URLSearchParams({
          client_id: CLIENT_ID,
          response_type: "code",
          redirect_uri: REDIRECT_URI,
          code_challenge_method: "S256",
          code_challenge: challenge,
          state,
          scope: SCOPES,
        }).toString();
        void shell.openExternal(auth.toString());
      });
    });

  ipcMain.handle("bross:spotify-status", async () => {
    if (!load()) return { connected: false };
    const me = await apiGet("/v1/me");
    if (!me.ok) return { connected: false, error: me.status === 401 ? null : me.error };
    return { connected: true, user: me.data.display_name || me.data.id };
  });
  ipcMain.handle("bross:spotify-login", async () => {
    if (!loginInProgress) loginInProgress = login().finally(() => (loginInProgress = null));
    return loginInProgress;
  });
  ipcMain.handle("bross:spotify-logout", () => {
    clear();
    return true;
  });
  ipcMain.handle("bross:spotify-get", async (_e, urlOrPath) => {
    const p = apiPath(String(urlOrPath || ""));
    if (!p) return { ok: false, status: 400, error: "Consulta no permitida" };
    try {
      return await apiGet(p);
    } catch (e) {
      return { ok: false, status: 0, error: "Sin conexión con Spotify" };
    }
  });
}

module.exports = { registerSpotifyIpc, apiPath, REDIRECT_URI };
