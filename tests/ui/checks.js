// Comprobaciones de la interfaz real. Corre dentro de la ventana de la app
// (la ejecuta tests/ui/driver.cjs) y devuelve [{ name, ok, detail }].
// Usa el hook de QA (solo en desarrollo) y eventos reales del DOM.
(async () => {
  const qa = window.__brossQA;
  const eng = qa.engine;
  const w = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: detail ?? null });
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const key = (type, code, k, extra = {}) =>
    (document.activeElement || document.body).dispatchEvent(
      new KeyboardEvent(type, { code, key: k, bubbles: true, cancelable: true, ...extra }),
    );
  const tap = async (code, k) => {
    key("keydown", code, k);
    await w(60);
    key("keyup", code, k);
    await w(150);
  };
  const pressDown = (el) => el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));

  // ── estado al arrancar (antes de cargar nada) ─────────────────────────
  {
    const rail = $(".xrail").getBoundingClientRect();
    const th = $(".xrail .fth").getBoundingClientRect();
    const offset = th.left + th.width / 2 - (rail.left + rail.width / 2);
    check("crossfader centrado al arrancar", Math.abs(offset) < 0.5 && $(".xrail").getAttribute("aria-valuenow") === "50", {
      offsetPx: +offset.toFixed(2),
    });
    check("key lock apagado al arrancar", $$(".pklock.on").length === 0);
    // ganancia real del crossfader en el motor: centro = los dos a pleno
    const g = () => [eng.deckA.xfade.gain.value, eng.deckB.xfade.gain.value].map((v) => +v.toFixed(3));
    const atCenter = g();
    qa.crossfade(0.75);
    await w(150);
    const atRight = g();
    qa.crossfade(0.5);
    await w(150);
    check(
      "crossfader: en el centro los dos al 100 %, a la derecha baja solo A",
      atCenter[0] === 1 && atCenter[1] === 1 && Math.abs(atRight[0] - Math.SQRT1_2) < 0.01 && atRight[1] === 1,
      { centro: atCenter, derecha75: atRight },
    );
    check("deck A seleccionado al arrancar (SBX)", $$(".sbxbtn").map((b) => b.classList.contains("sel")).join() === "true,false");
    const st = $("#st").getBoundingClientRect();
    check("la cabina llena la ventana", Math.abs(st.width - innerWidth) < 1 && Math.abs(st.height - innerHeight) < 1, {
      cabina: [Math.round(st.width), Math.round(st.height)],
      ventana: [innerWidth, innerHeight],
    });
  }

  // ── pistas de prueba (WAV generados) en los dos decks ─────────────────
  const sr = 44100;
  const mk = (sec, f, nm) => {
    const n = sr * sec;
    const buf = new ArrayBuffer(44 + n * 2);
    const dv = new DataView(buf);
    const ws = (o, s) => {
      for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
    };
    ws(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); ws(8, "WAVE"); ws(12, "fmt ");
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    ws(36, "data"); dv.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const b = t % 0.47 < 0.06 ? Math.sin(2 * Math.PI * 55 * t) * 0.7 : 0;
      dv.setInt16(44 + i * 2, Math.round((b + Math.sin(2 * Math.PI * f * t) * 0.2) * 0x7fff), true);
    }
    return new File([buf], nm + ".wav", { type: "audio/wav" });
  };
  const ts = await qa.importFiles([mk(60, 300, "Prueba - Uno"), mk(60, 330, "Prueba - Dos")]);
  await Promise.all(ts.map((t) => eng.analyze(t)));
  await qa.load(ts[0], "A");
  await qa.load(ts[1], "B");
  await w(800);

  // ── PLAY actúa al apretar (sin soltar) ────────────────────────────────
  {
    const pp = $$(".tb.pp")[0];
    pressDown(pp);
    check("PLAY arranca al apretar, sin soltar", eng.deckState("A").playing === true);
    await w(1200);
  }

  // ── medidores en dB ───────────────────────────────────────────────────
  {
    const m = eng.deckState("A").meter;
    const mm = eng.getMasterMeter();
    check(
      "medidores en dBFS con valores válidos",
      Number.isFinite(m.rms) && m.rms <= 0 && m.rms > -60 && Number.isFinite(mm.hold) && mm.hold <= 0,
      { deckA: +m.rms.toFixed(1), masterPico: +mm.hold.toFixed(1) },
    );
    check("medidor del master con escala y valor de pico", $$(".mastervu .vscale span").length >= 4 && !!$(".mastervu .vdb"));
  }

  // ── pads de LOOP ──────────────────────────────────────────────────────
  {
    const arrows = () => $$(".col-a .psarrow");
    for (let i = 0; i < 8 && !$(".col-a .psname").textContent.includes("LOOPS"); i++) {
      arrows()[1].click();
      await w(150);
    }
    const pad4 = () => $$(".col-a .padgrid .pad").find((p) => p.textContent.startsWith("4"));
    eng.quantize = true; // aunque Q esté activo, arranca exacto donde se toca
    const pos = eng.deckState("A").position;
    pressDown(pad4());
    let s = eng.deckState("A");
    const beat = 60 / s.bpm;
    check("loop: arranca donde se toca y va hacia adelante", Math.abs(s.loopStart - pos) < 0.02 && Math.abs(s.loopEnd - s.loopStart - 4 * beat) < 0.01, {
      pos: +pos.toFixed(3),
      loopStart: +s.loopStart.toFixed(3),
    });
    await w(300);
    check("loop: el pad se enciende", pad4().classList.contains("on"));
    await w(900);
    pressDown(pad4());
    await w(300);
    s = eng.deckState("A");
    check("loop: segundo toque sale y apaga el pad", s.loopStart == null && !pad4().classList.contains("on"));
    await w(900);
    const pos2 = eng.deckState("A").position;
    pressDown(pad4());
    s = eng.deckState("A");
    check("loop: otro toque crea uno nuevo donde está la pista", Math.abs(s.loopStart - pos2) < 0.02);
    pressDown(pad4());
    eng.quantize = false;
  }

  // ── teclado: deck seleccionado ────────────────────────────────────────
  {
    const before = eng.deckState("A").playing;
    await tap("Space", " ");
    check("Espacio: play/pausa del deck seleccionado (A)", eng.deckState("A").playing === !before);
    if (eng.deckState("A").playing) await tap("Space", " ");

    key("keydown", "ShiftLeft", "Shift", { shiftKey: true });
    await w(50);
    key("keyup", "ShiftLeft", "Shift");
    await w(200);
    check("Shift cambia al deck B y enciende su SBX", $$(".sbxbtn").map((b) => b.classList.contains("sel")).join() === "false,true");

    key("keydown", "KeyC", "c");
    await w(400);
    const held = eng.deckState("B").playing;
    key("keyup", "KeyC", "c");
    await w(300);
    check("C: el deck seleccionado suena mientras se mantiene y se corta al soltar", held && !eng.deckState("B").playing);

    key("keydown", "ShiftLeft", "Shift", { shiftKey: true });
    await w(40);
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, shiftKey: true }));
    await w(40);
    key("keyup", "ShiftLeft", "Shift");
    await w(200);
    check("Shift+clic no cambia de deck", $$(".sbxbtn").map((b) => b.classList.contains("sel")).join() === "false,true");

    const btn = $(".tb.sync");
    btn.focus();
    key("keydown", "Space", " ");
    check("Espacio funciona con el foco en un botón", eng.deckState("B").playing === true && document.activeElement !== btn);
    key("keyup", "Space", " ");
    await w(150);
    await tap("Space", " ");

    eng.setCrossfader(0.2);
    qa.crossfade(0.2);
    await w(100);
    await tap("KeyX", "x");
    check("X centra el crossfader", $(".xrail").getAttribute("aria-valuenow") === "50");
  }

  // ── SYNC: solo tempo y fase, sin transponer ni encender el key lock ─────
  {
    const lockBefore = $$(".pklock.on").length;
    qa.sync("B");
    await w(400);
    const s = eng.deckState("B");
    check("SYNC no transpone ni enciende el key lock", s.keyShift === 0 && $$(".pklock.on").length === lockBefore, {
      keyShift: s.keyShift,
    });
    qa.sync("B");
    await w(200);
  }

  // ── panel del mixer: FX | ONDAS ───────────────────────────────────────
  {
    const tab = (t) => $$(".fxtabs button").find((b) => b.textContent.trim() === t);
    tab("ONDAS").click();
    await w(500);
    const cv = $(".stackwave canvas");
    let painted = false;
    if (cv) {
      const px = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 0; i < px.length; i += 16) if (px[i] > 60 || px[i + 2] > 60) { painted = true; break; }
    }
    const saved = JSON.parse(localStorage.getItem("bross.ui.v1") || "{}");
    check("ONDAS: las dos ondas apiladas se dibujan y la elección se guarda", !!cv && painted && !$(".fxdeck") && saved.mixPanel === "waves");
    tab("FX").click();
    await w(300);
    check("FX: vuelve el panel de efectos", $$(".fxdeck").length === 2 && !$(".stackwave"));
  }

  // ── pestaña SPOTIFY (API simulada: no sale a internet) ─────────────────
  {
    let connected = false;
    const tr = (name, artist) => ({ track: { id: name, name, duration_ms: 60000, type: "track", artists: [{ name: artist }] } });
    window.__brossSpotifyMock = {
      spotifyStatus: async () => ({ connected }),
      spotifyLogin: async () => ((connected = true), { ok: true, user: "Cuenta de prueba" }),
      spotifyLogout: async () => ((connected = false), true),
      spotifyGet: async (url) => {
        url = url.replace("https://api.spotify.com", "");
        if (url.startsWith("/v1/me/playlists")) return { ok: true, data: { items: [{ id: "p1", name: "Lista de prueba", tracks: { total: 3 } }], next: null } };
        if (url.startsWith("/v1/me/tracks")) return { ok: true, data: { items: [], total: 0, next: null } };
        if (url.startsWith("/v1/playlists/p1/tracks")) {
          return url.includes("offset=2")
            ? { ok: true, data: { items: [tr("Inexistente", "Nadie")], next: null } }
            : { ok: true, data: { items: [tr("Uno", "Prueba"), tr("Dos (feat. Otro)", "Prueba")], next: "https://api.spotify.com/v1/playlists/p1/tracks?offset=2" } };
        }
        return { ok: false, error: "no" };
      },
    };
    $$(".ttab").find((b) => b.textContent.trim().endsWith("SPOTIFY")).click();
    await w(500);
    const offline = !!$(".sp-connect");
    $(".sp-connect").click();
    await w(600);
    $$(".sp-pl button").find((b) => b.textContent.includes("Lista de prueba")).click();
    await w(600);
    const found = $$(".sp-row.ok").length;
    const missing = $$(".sp-st.no").length;
    check("SPOTIFY: conecta, lee la playlist (2 páginas) y compara con la biblioteca", offline && found === 2 && missing === 1, { found, missing });
    $(".sp-foot .pri").click();
    await w(600);
    const sel = $$(".ttab.sel").map((b) => b.textContent.trim()).join();
    const rowsTxt = $$(".fr").map((r) => r.textContent);
    check(
      "SPOTIFY: «Crear lista» arma la lista con los temas encontrados",
      sel.endsWith("LISTS") && rowsTxt.length === 2 && rowsTxt.some((t) => t.includes("Uno")) && rowsTxt.some((t) => t.includes("Dos")),
      { sel, filas: rowsTxt.length },
    );
    delete window.__brossSpotifyMock;
  }

  // ── Ajustes › Interfaz › visual ───────────────────────────────────────
  {
    $('[aria-label="Abrir ajustes generales"]').click();
    await w(500);
    const tabs = $$(".settings-tab").map((b) => b.textContent.trim());
    check("no hay pestaña Visual separada", !tabs.includes("Visual") && tabs.includes("Interfaz"), { tabs });
    $$(".settings-tab").find((b) => b.textContent.trim() === "Interfaz").click();
    await w(300);
    $$(".visual-card").find((b) => b.textContent.includes("Minimalista")).click();
    await w(300);
    const saved = JSON.parse(localStorage.getItem("bross.ui.v1") || "{}");
    check("la visual Minimalista se aplica y se guarda", $("#st").classList.contains("vis-minimal") && saved.visual === "minimal");
    $$(".visual-card").find((b) => b.textContent.includes("Clásica")).click();
    await w(200);
    check("volver a Clásica", !$("#st").classList.contains("vis-minimal"));
    $(".settings-close").click();
    await w(300);
    check("Ajustes se cierra", !$(".settings-overlay"));
  }

  // ── barra de ventana ──────────────────────────────────────────────────
  {
    const labels = $$(".winbtn").map((b) => b.getAttribute("aria-label")).join(", ");
    check("botones de ventana en la barra", labels === "Minimizar, Maximizar, Cerrar", { labels });
    const cs = (el) => getComputedStyle(el).getPropertyValue("-webkit-app-region");
    check("la barra arrastra la ventana y sus botones no", cs($(".bar")) === "drag" && cs($(".winbtn")) === "no-drag" && cs($(".gear-btn")) === "no-drag");
    // Windows decide el arrastre por el elemento de arriba: una caja
    // posicionada encima de un botón (aunque ignore el mouse) lo vuelve
    // zona de arrastre. Así pasó con el reloj sobre AUTO y Q.
    const clock = $(".mckbox").getBoundingClientRect();
    const covered = $$(".bar button").filter((b) => {
      const r = b.getBoundingClientRect();
      return r.left < clock.right && r.right > clock.left && r.top < clock.bottom && r.bottom > clock.top;
    });
    check("el reloj no tapa ningún botón de la barra", covered.length === 0, { tapados: covered.map((b) => b.textContent.trim()) });
  }

  return JSON.stringify(results);
})();
