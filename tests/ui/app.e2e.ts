// Tests de interfaz de punta a punta: levanta Vite, abre la app real en
// Electron con un perfil temporal (no toca tu biblioteca) y verifica lo que
// se arregló a mano: crossfader, PLAY al apretar, loops, teclado, visual,
// medidores, botones de ventana y que la cabina llene la ventana.
//
// npm run test:ui
import { spawn } from "child_process";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, "../..");
const electronBin = require("electron") as unknown as string;

type Result = { name: string; ok: boolean; detail?: unknown };

let server: ViteDevServer;
let results: Result[] = [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bross-ui-"));

beforeAll(async () => {
  server = await createServer({ root, server: { port: 0, strictPort: false }, logLevel: "error" });
  await server.listen();
  const url = server.resolvedUrls?.local[0] ?? `http://localhost:${server.config.server.port}/`;
  const out = path.join(tmp, "results.json");
  // si este proceso corre dentro de otro Electron, ELECTRON_RUN_AS_NODE haría
  // que la app arranque como Node: se quita del entorno (vacía no alcanza)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VITE_DEV_SERVER_URL: url.replace(/\/$/, ""),
    BROSS_USER_DATA: path.join(tmp, "profile"),
    BROSS_UI_OUT: out,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  let stderr = "";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(electronBin, [path.join(__dirname, "driver.cjs")], { cwd: root, env, stdio: ["ignore", "ignore", "pipe"] });
    child.stderr?.on("data", (d) => (stderr += String(d)));
    child.on("error", reject);
    child.on("exit", () => resolve());
  });
  results = fs.existsSync(out)
    ? (JSON.parse(fs.readFileSync(out, "utf8")) as Result[])
    : [{ name: "error en el driver", ok: false, detail: `sin resultados; stderr: ${stderr.slice(-1500)}` }];
}, 150000);

afterAll(async () => {
  await server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const EXPECTED = [
  "crossfader centrado al arrancar",
  "key lock apagado al arrancar",
  "crossfader: en el centro los dos al 100 %, a la derecha baja solo A",
  "deck A seleccionado al arrancar (SBX)",
  "la cabina llena la ventana",
  "PLAY arranca al apretar, sin soltar",
  "medidores en dBFS con valores válidos",
  "medidor del master con escala y valor de pico",
  "loop: arranca donde se toca y va hacia adelante",
  "loop: el pad se enciende",
  "loop: segundo toque sale y apaga el pad",
  "loop: otro toque crea uno nuevo donde está la pista",
  "Espacio: play/pausa del deck seleccionado (A)",
  "Shift cambia al deck B y enciende su SBX",
  "C: el deck seleccionado suena mientras se mantiene y se corta al soltar",
  "Shift+clic no cambia de deck",
  "Espacio funciona con el foco en un botón",
  "X centra el crossfader",
  "SYNC no transpone ni enciende el key lock",
  "ONDAS: las dos ondas apiladas se dibujan y la elección se guarda",
  "FX: vuelve el panel de efectos",
  "SPOTIFY: conecta, lee la playlist (2 páginas) y compara con la biblioteca",
  "SPOTIFY: «Crear lista» arma la lista con los temas encontrados",
  "no hay pestaña Visual separada",
  "la visual Minimalista se aplica y se guarda",
  "volver a Clásica",
  "Ajustes se cierra",
  "botones de ventana en la barra",
  "la barra arrastra la ventana y sus botones no",
  "el reloj no tapa ningún botón de la barra",
  "Maximizar maximiza y el botón pasa a Restaurar",
  "maximizada, la cabina llena la ventana",
  "Restaurar",
  "Minimizar",
  "Cerrar cierra la ventana",
];

describe("interfaz de BROSS DJ (Electron)", () => {
  it("el driver no falló", () => {
    const bad = results.filter((r) => r.name === "error en el driver" || r.name === "tiempo agotado");
    expect(bad, JSON.stringify(bad)).toEqual([]);
  });

  for (const name of EXPECTED) {
    it(name, () => {
      const r = results.find((x) => x.name === name);
      expect(r, `no se ejecutó: ${name}`).toBeDefined();
      expect(r!.ok, `${name} → ${JSON.stringify(r!.detail)}`).toBe(true);
    });
  }
});
