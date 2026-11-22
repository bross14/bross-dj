// Proceso principal para los tests de interfaz: abre la app real (contra el
// servidor de Vite que levanta el test), corre tests/ui/checks.js en la
// ventana, prueba los botones de ventana y escribe los resultados en JSON.
//
// Variables: VITE_DEV_SERVER_URL, BROSS_USER_DATA (perfil temporal),
// BROSS_UI_OUT (archivo de resultados).
const path = require("path");
const fs = require("fs");
const { app } = require("electron");

app.commandLine.appendSwitch("force-device-scale-factor", "1");
// sin audio real del sistema: el motor igual corre y mide
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const OUT = process.env.BROSS_UI_OUT;
const results = [];
const finish = (extra) => {
  if (extra) results.push(extra);
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  app.exit(0);
};

let started = false;
app.on("browser-window-created", (_e, win) => {
  win.webContents.on("did-finish-load", async () => {
    if (started || win.webContents.getURL().endsWith("#screen")) return;
    started = true;
    const js = (code) => win.webContents.executeJavaScript(code, true);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      win.setSize(1448, 860);
      await wait(2500);
      const out = JSON.parse(await js(fs.readFileSync(path.join(__dirname, "checks.js"), "utf8")));
      results.push(...out);

      // botones de ventana (el estado real lo da Electron)
      const click = (label) => js(`document.querySelector('.winbtn[aria-label="${label}"]').click()`);
      await click("Maximizar");
      await wait(900);
      const maxLabel = await js(`document.querySelectorAll('.winbtn')[1].getAttribute('aria-label')`);
      results.push({ name: "Maximizar maximiza y el botón pasa a Restaurar", ok: win.isMaximized() && maxLabel === "Restaurar" });
      const fill = await js(`(() => { const r = document.getElementById('st').getBoundingClientRect(); return [r.width, r.height, innerWidth, innerHeight]; })()`);
      results.push({
        name: "maximizada, la cabina llena la ventana",
        ok: Math.abs(fill[0] - fill[2]) < 1 && Math.abs(fill[1] - fill[3]) < 1,
        detail: fill.map(Math.round),
      });
      await click("Restaurar");
      await wait(900);
      results.push({ name: "Restaurar", ok: !win.isMaximized() });
      await click("Minimizar");
      await wait(900);
      results.push({ name: "Minimizar", ok: win.isMinimized() });
      win.restore();
      await wait(500);
      win.on("closed", () => finish({ name: "Cerrar cierra la ventana", ok: true }));
      await click("Cerrar");
      setTimeout(() => finish({ name: "Cerrar cierra la ventana", ok: false }), 5000);
    } catch (e) {
      finish({ name: "error en el driver", ok: false, detail: String(e && e.stack) });
    }
  });
});

setTimeout(() => finish({ name: "tiempo agotado", ok: false }), 90000);
require(path.resolve(__dirname, "../../electron/main.cjs"));
