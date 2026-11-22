// Idiomas: la interfaz se escribe en español; en inglés se traduce el texto
// visible (nodos de texto y atributos title / placeholder / aria-label) con
// un diccionario de frases exactas más algunos patrones con números.
//
// Se aplica sobre el DOM con un MutationObserver: así cubre toda la app sin
// tener que pasar cada texto por una función. Solo se cambia el valor de los
// nodos de texto (nunca se agregan ni quitan nodos), que es lo que React
// tolera. Lo que es contenido del usuario (pistas, carpetas, listas) se marca
// con data-no-i18n y no se toca.

export type Lang = "es" | "en";

const EN: Record<string, string> = {
  // ── barra superior y generales ─────────────────────────────────
  "Abrir ajustes generales": "Open settings",
  "Cerrar": "Close",
  "Cancelar": "Cancel",
  "Guardar": "Save",
  "Guardando…": "Saving…",
  "Listo": "Done",
  "Editar": "Edit",
  "Borrar": "Delete",
  "Probar": "Try",
  "Restablecer": "Reset",
  "De fábrica": "Factory",
  "Nombre": "Name",
  "Color": "Color",
  "Script": "Script",
  "Script válido.": "Valid script.",
  "Carpeta": "Folder",
  "Cerrar editor": "Close editor",
  "Cerrar ajustes": "Close settings",

  // ── navegador ──────────────────────────────────────────────────
  "Todas las pistas": "All tracks",
  "Compatibles": "Compatible",
  "Sugeridas": "Suggested",
  "Historial": "History",
  "Sin carpetas": "No folders",
  "Usá el botón de carpeta con + para agregar una carpeta con toda su música.": "Use the folder button with + to add a folder with all its music.",
  "Sidelist": "Sidelist",
  "Sin listas": "No lists",
  "Nueva lista": "New list",
  "Nueva carpeta virtual (agrupa listas)": "New virtual folder (groups lists)",
  "Nueva carpeta filtro (lista automática por BPM, tono, género…)": "New filter folder (automatic list by BPM, key, genre…)",
  "Vaciar la sidelist": "Empty the sidelist",
  "VACIAR": "CLEAR",
  "Buscar en la biblioteca…": "Search the library…",
  "Buscar en la biblioteca": "Search the library",
  "Carpetas y listas": "Folders and lists",
  "Texto del filtro": "Filter text",
  "FILTRO": "FILTER",
  "Elegir columnas": "Choose columns",
  "+ ARCHIVOS": "+ FILES",
  "CARGANDO…": "LOADING…",
  "Cargar en Deck A": "Load on Deck A",
  "Cargar en Deck B": "Load on Deck B",
  "Editar etiquetas, rejilla y cues (también con clic derecho)": "Edit tags, grid and cues (also with right click)",
  "Cómo entra este tema en el automix": "How this track comes in on automix",
  "Transición de entrada": "Incoming transition",
  "Largo de la transición de entrada": "Length of the incoming transition",
  "Subir en la cola": "Move up the queue",
  "Bajar en la cola": "Move down the queue",
  "Quitar de la sidelist": "Remove from the sidelist",
  "Quitar de la lista": "Remove from the list",
  "Agregar a la sidelist (cola)": "Add to the sidelist (queue)",
  "Agregar carpeta (con sus subcarpetas y música)": "Add folder (with its subfolders and music)",
  "Agregar carpeta": "Add folder",
  "Quitar la carpeta seleccionada del navegador": "Remove the selected folder from the browser",
  "Quitar carpeta": "Remove folder",
  "Marcar la carpeta como favorita": "Mark the folder as favorite",
  "Marcar carpeta como favorita": "Mark folder as favorite",
  "Deck de YouTube (reproductor oficial)": "YouTube deck (official player)",
  "Arrastrá una lista acá para sacarla de su carpeta": "Drop a list here to take it out of its folder",
  "Título": "Title",
  "Artista": "Artist",
  "Álbum": "Album",
  "Género": "Genre",
  "Año": "Year",
  "Duración": "Length",
  "Tocada": "Played",
  "Auto": "Auto",
  "Intelig.": "Smart",
  "Fundido": "Blend",
  "Bajos": "Bass",
  "Filtro": "Filter",
  "Eco": "Echo",
  "Corte": "Cut",
  "Sin pistas cargadas": "No tracks loaded",
  "Sin resultados": "No results",
  "Probá con otro término de búsqueda.": "Try another search term.",
  "Sidelist vacía": "Sidelist is empty",
  "Usá el botón + de cada pista para ponerla en cola para después.": "Use each track's + button to queue it for later.",
  "Lista vacía": "Empty list",
  "Arrastrá pistas desde el navegador hasta el nombre de la lista.": "Drag tracks from the browser onto the list name.",
  "Sin historial": "No history",
  "Las pistas que suenan quedan registradas acá con fecha y hora.": "Tracks that play are logged here with date and time.",
  "Sin compatibles": "No compatible tracks",
  "Sin referencia": "No reference",
  "Reproducí una pista analizada para ver las que combinan con ella.": "Play an analyzed track to see the ones that match it.",
  "Reproducí una pista para ver sugerencias de tu historial.": "Play a track to see suggestions from your history.",
  "Sin sugerencias": "No suggestions",
  "Todavía no hay historial con este tema ni compatibles. Se arma solo a medida que mezclás.": "No history with this track and no compatible tracks yet. It builds up as you mix.",
  "Carpeta vacía": "Empty folder",
  "No hay archivos de audio en esta carpeta ni en sus subcarpetas.": "There are no audio files in this folder or its subfolders.",
  "Filtro con errores": "Filter has errors",
  "Sin coincidencias": "No matches",
  "Ninguna pista cumple el filtro. Probá con bpm 120..130, key ~ 8A, genre contains house…": "No track matches the filter. Try bpm 120..130, key ~ 8A, genre contains house…",
  "Enero": "January",
  "Febrero": "February",
  "Marzo": "March",
  "Abril": "April",
  "Mayo": "May",
  "Junio": "June",
  "Julio": "July",
  "Agosto": "August",
  "Septiembre": "September",
  "Octubre": "October",
  "Noviembre": "November",
  "Diciembre": "December",
  "Nombre de la lista": "List name",
  "Nombre de la carpeta": "Folder name",
  "Nombre del filtro": "Filter name",
  "Nuevo nombre": "New name",
  "YouTube": "YouTube",
  "Pegá un link de YouTube…": "Paste a YouTube link…",
  "Link de YouTube": "YouTube link",
  "Posición del video": "Video position",
  "Volumen del deck de YouTube": "YouTube deck volume",
  "Velocidad": "Speed",
  "Lado del crossfader": "Crossfader side",
  "Clic: cargar · doble clic: cargar y reproducir": "Click: load · double click: load and play",

  // ── deck, pads y mixer ─────────────────────────────────────────
  "Bajar el rango del pitch": "Lower the pitch range",
  "Bajar rango de pitch": "Lower pitch range",
  "Subir el rango del pitch": "Raise the pitch range",
  "Subir rango de pitch": "Raise pitch range",
  "Bloquear el tono (key lock)": "Lock the key (key lock)",
  "Disco (jog)": "Platter (jog)",
  "LOOP IN: marca el inicio del loop": "LOOP IN: marks the loop start",
  "LOOP OUT: cierra el loop desde IN hasta acá": "LOOP OUT: closes the loop from IN to here",
  "Largo del loop en beats": "Loop length in beats",
  "RELOOP: vuelve al último loop": "RELOOP: goes back to the last loop",
  "◀◀ PISTA HACIA ATRÁS": "◀◀ TRACK BACKWARDS",
  "Echo beat": "Echo beat",
  "Echo feedback": "Echo feedback",
  "Break tiempo": "Break time",
  "GUARDADOS": "SAVED",
  "8 SONIDOS": "8 SOUNDS",
  "VACÍO": "EMPTY",
  "Volver a 8 pads": "Back to 8 pads",
  "16 pads: dos páginas a la vez": "16 pads: two pages at once",
  "Efecto anterior": "Previous effect",
  "Efecto siguiente": "Next effect",
  "Rueda del mouse: cambiar de efecto": "Mouse wheel: change effect",
  "Página anterior": "Previous page",
  "Página siguiente": "Next page",
  "8 puntos de cue": "8 cue points",
  "repetir mientras se aprieta": "repeat while held",
  "de 1/4 a 32 beats": "1/4 to 32 beats",
  "saltar a un beat de la frase": "jump to a beat of the phrase",
  "8 sonidos": "8 sounds",
  "voz, bajo, percusión, instr.": "vocals, bass, perc., instr.",
  "tus scripts": "your scripts",
  "Página USER: cada pad corre un script de acciones.": "USER page: each pad runs an action script.",
  "Editor de pad": "Pad editor",
  "Arrastrá los bordes sobre la onda para recortar. Espacio: escuchar.": "Drag the edges over the waveform to trim. Space: listen.",
  "Inicio (s)": "Start (s)",
  "Fin (s)": "End (s)",
  "Volumen de la ranura": "Slot volume",
  "Se suma al volumen general del sampler.": "Adds to the overall sampler volume.",
  "Editor del sampler": "Sampler editor",
  "En loop (el pad prende y apaga)": "Looping (the pad toggles on and off)",
  "▶ Escuchar": "▶ Listen",
  "Rueda: zoom · arrastrar: mover la pista como un disco": "Wheel: zoom · drag: move the track like a record",
  "Acercar (zoom)": "Zoom in",
  "Alejar (zoom)": "Zoom out",
  "Rejilla 10 ms antes": "Grid 10 ms earlier",
  "Rejilla 10 ms después": "Grid 10 ms later",
  "Poner un beat donde está el cursor": "Put a beat at the cursor",
  "BPM a la mitad": "Half BPM",
  "BPM al doble": "Double BPM",
  "SIN TRACK": "NO TRACK",
  "ARTISTA DESCONOCIDO": "UNKNOWN ARTIST",

  // ── editor de pista ────────────────────────────────────────────
  "Editor de pista": "Track editor",
  "Etiquetas": "Tags",
  "Rejilla y tono": "Grid and key",
  "Cues y loops": "Cues and loops",
  "BPM (etiqueta)": "BPM (tag)",
  "Tono (etiqueta)": "Key (tag)",
  "Escribir también en el archivo (la carátula y el resto de las etiquetas se conservan)": "Also write to the file (artwork and other tags are kept)",
  "Este formato se edita solo en la biblioteca (la escritura en el archivo es para MP3 y FLAC)": "This format is edited in the library only (writing to the file is for MP3 and FLAC)",
  "BPM de la rejilla": "Grid BPM",
  "Redondear": "Round",
  "Redondear al BPM entero": "Round to the whole BPM",
  "Primer beat (segundos)": "First beat (seconds)",
  "La pista todavía no está analizada: cargala en un deck y volvé.": "The track isn't analyzed yet: load it on a deck and come back.",
  "Punto de CUE": "CUE point",
  "Hot cues": "Hot cues",
  "Loops guardados": "Saved loops",
  "Loops guardados (versión anterior)": "Saved loops (previous version)",
  "Los pads de LOOP ahora tienen un largo fijo y ya no usan estos loops. Podés borrarlos.":
    "LOOP pads now have fixed lengths and no longer use these loops. You can delete them.",
  "Borrar todos los loops guardados": "Delete all saved loops",

  // ── ajustes ────────────────────────────────────────────────────
  "Ajustes generales": "Settings",
  "Dispositivos, monitoreo y atajos de BROSS DJ": "Devices, monitoring and shortcuts for BROSS DJ",
  "Audio": "Audio",
  "Atajos de teclado": "Keyboard shortcuts",
  "Controladores MIDI": "MIDI controllers",
  "Biblioteca": "Library",
  "Interfaz": "Interface",
  "Visual": "Look",
  "Importar playlists de Spotify a tu biblioteca": "Import Spotify playlists into your library",
  "Conectar con Spotify": "Connect to Spotify",
  "Esperando a Spotify en el navegador…": "Waiting for Spotify in the browser…",
  "Se abrió tu navegador. Iniciá sesión, aceptá y volvé acá.": "Your browser opened. Sign in, accept and come back here.",
  "Conectá tu cuenta para ver tus playlists y armar listas con los temas que ya tenés. La música suena desde tus archivos, con EQ, efectos y sync; de Spotify solo se lee la lista.":
    "Connect your account to see your playlists and build lists with the tracks you already have. Music plays from your files, with EQ, effects and sync; only the list is read from Spotify.",
  "● Conectado a Spotify": "● Connected to Spotify",
  "Salir": "Sign out",
  "TUS PLAYLISTS": "YOUR PLAYLISTS",
  "Temas que me gustan": "Liked songs",
  "Leyendo playlists…": "Reading playlists…",
  "Solo se lee la lista de temas. La música se toca desde tus archivos, con EQ, efectos y sync.":
    "Only the track list is read. Music plays from your files, with EQ, effects and sync.",
  "Conectá tu cuenta de Spotify a la izquierda.": "Connect your Spotify account on the left.",
  "Elegí una playlist a la izquierda.": "Pick a playlist on the left.",
  "Leyendo los temas de la playlist…": "Reading the playlist tracks…",
  "En BROSS DJ": "In BROSS DJ",
  "Falta": "Missing",
  "Buscar en YouTube": "Search on YouTube",
  "Exportar faltantes (.txt)": "Export missing (.txt)",
  "ONDAS": "WAVES",
  "A ARRIBA · B ABAJO": "A TOP · B BOTTOM",
  "Panel del mixer": "Mixer panel",
  "Efectos de los dos decks": "Effects for both decks",
  "Las dos ondas apiladas para comparar los beats (los efectos siguen sonando)":
    "Both waveforms stacked to compare the beats (effects keep playing)",
  "Deck A arriba, Deck B abajo · rueda: acercar / alejar": "Deck A on top, Deck B below · wheel: zoom in / out",
  "Pico del master en dBFS": "Master peak in dBFS",
  "Visual de la cabina": "Booth look",
  "Elegí el estilo de la cabina. Se aplica al instante y no cambia el skin.":
    "Choose the booth style. It applies instantly and doesn't change the skin.",
  "Clásica": "Classic",
  "Minimalista": "Minimal",
  "Pads de colores y luces en cada deck.": "Colored pads and lights on each deck.",
  "Todo en grises: solo el color de cada deck en ondas, plato, pads y botones.":
    "All greys: only each deck's color on waveforms, platter, pads and buttons.",
  "En uso": "In use",
  "Secciones de ajustes": "Settings sections",
  "Dispositivos de audio": "Audio devices",
  "Salida general (master)": "Main output (master)",
  "Altavoces o interfaz principal de la mezcla.": "Speakers or main interface for the mix.",
  "Salida de auriculares (CUE)": "Headphone output (CUE)",
  "Salida aparte para monitorear. Activá CUE en el canal A o B.": "Separate output for monitoring. Turn on CUE on channel A or B.",
  "Predeterminado del sistema": "System default",
  "Curva del crossfader": "Crossfader curve",
  "En el centro los dos decks suenan a pleno; al correrlo baja el del otro lado. Mezcla: baja suave · Lineal: baja en línea recta · Corte: para scratch.":
    "In the middle both decks play at full volume; moving it lowers the other side. Mix: smooth fade · Linear: straight fade · Cut: for scratching.",
  "Mezcla (club)": "Mix (club)",
  "Suave": "Smooth",
  "Corte (scratch)": "Cut (scratch)",
  "Automix: largo de la transición": "Automix: transition length",
  "Cuántos beats dura el cruce entre un tema y el siguiente de la sidelist.": "How many beats the crossing between a track and the next one in the sidelist lasts.",
  "8 beats (2 compases)": "8 beats (2 bars)",
  "16 beats (4 compases)": "16 beats (4 bars)",
  "32 beats (8 compases)": "32 beats (8 bars)",
  "64 beats (16 compases)": "64 beats (16 bars)",
  "Tipo de transición del automix": "Automix transition type",
  "Inteligente elige según BPM, tono y la frase de cada pista.": "Smart picks based on each track's BPM, key and phrase.",
  "Inteligente": "Smart",
  "Cambio de bajos": "Bass swap",
  "Filtro (barrido)": "Filter (sweep)",
  "Salida con eco": "Echo out",
  "Corte al beat": "Cut on the beat",
  "Formato de grabación": "Recording format",
  "WAV y FLAC sin pérdida (FLAC ocupa ~la mitad) · MP3 y OGG (Opus) comprimidos a 192 kbps.": "WAV and FLAC are lossless (FLAC takes ~half) · MP3 and OGG (Opus) compressed at 192 kbps.",
  "Qué se graba": "What gets recorded",
  "Master": "Master",
  "Master + micrófono / línea": "Master + mic / line",
  "Sonido del sistema": "System audio",
  "Volumen de la entrada en la grabación": "Input volume in the recording",
  "La entrada es la que elegiste arriba (micrófono / línea).": "The input is the one you picked above (mic / line).",
  "Dividir la grabación por tema": "Split the recording by track",
  "Además del set completo, una carpeta con un archivo por pista.": "Besides the full set, a folder with one file per track.",
  "Curva de los faders": "Fader curve",
  "Lineal · Logarítmica: sube suave al principio · Rápida: llega arriba antes.": "Linear · Logarithmic: rises gently at first · Fast: reaches the top sooner.",
  "Lineal": "Linear",
  "Logarítmica": "Logarithmic",
  "Rápida": "Fast",
  "Volumen de auriculares": "Headphone volume",
  "Nivel independiente del master.": "Level independent from the master.",
  "Entrada de audio": "Audio input",
  "Micrófono o línea para grabar y monitorear.": "Mic or line to record and monitor.",
  "Clic para asignar · doble clic para borrar": "Click to assign · double click to clear",
  "Restablecer predeterminados": "Restore defaults",
  "Reproducir / pausar": "Play / pause",
  "CUE (volver al punto de cue)": "CUE (back to the cue point)",
  "SYNC (igualar BPM)": "SYNC (match BPM)",
  "Key lock (bloquear tono)": "Key lock",
  "Sandbox (solo auriculares)": "Sandbox (headphones only)",
  "Mover crossfader a la izquierda": "Move crossfader left",
  "Deck seleccionado (Shift cambia de deck)": "Selected deck (Shift switches deck)",
  "CUE (suena mientras se mantiene)": "CUE (plays while held)",
  "Centrar crossfader": "Center crossfader",
  "Mover crossfader a la derecha": "Move crossfader right",
  "Subir volumen master": "Master volume up",
  "Bajar volumen master": "Master volume down",
  "Mezclador": "Mixer",
  "Play / pausa": "Play / pause",
  "Modo vinilo": "Vinyl mode",
  "Loop a la mitad": "Halve loop",
  "Loop al doble": "Double loop",
  "CUE auriculares (PFL)": "Headphone CUE (PFL)",
  "Cargar el primero de la sidelist": "Load the first one in the sidelist",
  "Jog: tocar el plato": "Jog: touch the platter",
  "Jog: girar": "Jog: turn",
  "Volumen (fader)": "Volume (fader)",
  "EQ agudos": "EQ high",
  "EQ medios": "EQ mid",
  "EQ graves": "EQ low",

  "Volumen master": "Master volume",
  "SHIFT (para scripts: shift ? a : b)": "SHIFT (for scripts: shift ? a : b)",
  "Sin asignar": "Unassigned",
  "Aprender: después mové el control": "Learn: then move the control",
  "Mové un control…": "Move a control…",
  "Quitar asignación": "Remove assignment",
  "Borrar todas las asignaciones": "Clear all assignments",
  "Acciones con script": "Script actions",
  "+ Nueva acción con script": "+ New script action",
  "Presioná una tecla…": "Press a key…",
  "Carpeta para sincronizar": "Sync folder",
  "Última copia": "Last copy",
  "Elegir carpeta": "Choose folder",
  "Cambiar carpeta": "Change folder",
  "Subir": "Upload",
  "Bajar y combinar": "Download and merge",
  "Dejar de sincronizar": "Stop syncing",
  "sin elegir": "not chosen",
  "nunca": "never",
  "Idioma": "Language",
  "Skin": "Skin",
  "Addons": "Addons",
};

/** Frases con números o datos variables. */
const PATTERNS: [RegExp, string][] = [
  [/^Importando (\d+) \/ (\d+)…$/, "Importing $1 / $2…"],
  [/^(\d+) pistas · \?$/, "$1 tracks · ?"],
  [/^(\d+) pistas$/, "$1 tracks"],
  [/^Pad (\d+) · Deck ([AB])$/, "Pad $1 · Deck $2"],
  [/^Sampler · ranura (\d+)$/, "Sampler · slot $1"],
  [/^Hot cue (\d+)$/, "Hot cue $1"],
  [/^Grabación guardada \((.+)\): (.+)$/, "Recording saved ($1): $2"],
];

let lang: Lang = "es";
let observer: MutationObserver | null = null;

export function translate(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const hit = EN[t];
  if (hit != null) return s.replace(t, hit);
  for (const [re, out] of PATTERNS) {
    if (re.test(t)) return s.replace(t, t.replace(re, out));
  }
  return null;
}

const ATTRS = ["title", "placeholder", "aria-label"];

function skip(el: Element | null): boolean {
  return !!el?.closest("[data-no-i18n], textarea, input, script, style");
}

function fixText(node: Text) {
  if (skip(node.parentElement)) return;
  const v = node.nodeValue;
  if (!v) return;
  const t = translate(v);
  if (t != null && t !== v) node.nodeValue = t;
}

function fixAttrs(el: Element) {
  if (el.closest("[data-no-i18n]")) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const t = translate(v);
    if (t != null && t !== v) el.setAttribute(a, t);
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return fixText(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (el.matches("[data-no-i18n]")) return;
  fixAttrs(el);
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.nodeType === Node.ELEMENT_NODE && (n as Element).matches("[data-no-i18n]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) fixText(n as Text);
    else fixAttrs(n as Element);
  }
}

/** Cambia el idioma. Volver a español recarga la ventana (los textos originales vuelven solos). */
export function setLanguage(next: Lang) {
  if (next === lang) return;
  const prev = lang;
  lang = next;
  document.documentElement.lang = next;
  if (next === "en") {
    walk(document.body);
    observer = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === "characterData") fixText(m.target as Text);
        else if (m.type === "attributes") fixAttrs(m.target as Element);
        else m.addedNodes.forEach(walk);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  } else if (prev === "en") {
    observer?.disconnect();
    observer = null;
    location.reload();
  }
}

export function currentLanguage(): Lang {
  return lang;
}
