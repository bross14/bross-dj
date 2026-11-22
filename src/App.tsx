import { useCallback, useEffect, useRef, useState } from "react";
import { Toolbar } from "./components/Toolbar";
import { Waveform } from "./components/Waveform";
import { ScrollWave, type GridEdit } from "./components/ScrollWave";
import { Deck } from "./components/Deck";
import { PITCH_RANGES } from "./components/controls";
import {
  Mixer,
  brakeSeconds,
  crushBits,
  ECHO_BEATS,
  echoBeatIndex,
  GATE_BEATS,
  pick,
  SWEEP_BEATS,
  type ChannelState,
  type DeckFx,
  type DeckFxPatch,
} from "./components/Mixer";
import { Browser, type BrowseSource } from "./components/Browser";
import { Settings } from "./components/Settings";
import { useTagScan } from "./hooks/useTagScan";
import { useSampler } from "./hooks/useSampler";
import { useMidiController } from "./hooks/useMidiController";
import { useRecording } from "./hooks/useRecording";
import { usePlayHistory } from "./hooks/usePlayHistory";
import { useAutomix } from "./hooks/useAutomix";
import { LibraryPanel } from "./components/LibraryPanel";
import { TrackEditor, type TrackEdit } from "./components/TrackEditor";
import { SamplerEditor } from "./components/SamplerEditor";
import { PadEditor } from "./components/PadEditor";
import { StackedWaves } from "./components/StackedWaves";
import { InterfacePanel } from "./components/InterfacePanel";
import { SILENT_METER, type MeterReading } from "./engine/meter";
import { fitStage } from "./stageFit";
import { StreamingPanel } from "./components/StreamingPanel";
import { loadStreamPrefs, saveStreamPrefs, useStreaming } from "./hooks/useStreaming";
import { useLineIn } from "./hooks/useLineIn";
import { useKaraoke } from "./hooks/useKaraoke";
import { useVideo } from "./hooks/useVideo";
import { useDvs } from "./hooks/useDvs";
import { DvsPanel } from "./components/DvsPanel";
import { VideoPanel } from "./components/VideoPanel";
import { KaraokePanel } from "./components/KaraokePanel";
import { setLanguage } from "./i18n";
import { allSkins, applySkin, loadAddons, loadUi, saveAddons, saveUi, type Addon, type UiPrefs } from "./skins";
import { runScript, tryParseScript } from "./actionScript";
import { FULL_STEMS, type StemGains } from "./engine/stems";
import {
  DEFAULT_USER_PADS,
  loadMidiScripts,
  loadTransitions,
  loadUserPads,
  saveMidiScripts,
  saveTransitions,
  saveUserPads,
  type TransitionOverride,
} from "./userActions";
import { MidiPanel } from "./components/MidiPanel";
import type { MidiEvent } from "./midi";
import { dispatchMidi, midiLedStates } from "./midiDispatch";
import {
  AudioEngine,
  type DeckId,
  type DeckRuntime,
  type InsertFxConfig,
  type LibraryTrack,
} from "./engine/audio";
import {
  isInside,
  loadLibrary,
  mergeLibrary,
  parseStoredLibrary,
  toStoredLibrary,
  playlistDescendants,
  restoreTracks,
  saveLibrary,
  type EditableTags,
  type HistoryEntry,
  type LibraryFolder,
  type Playlist,
} from "./library";
import {
  comboFromEvent,
  loadSettings,
  saveSettings,
  type AppSettings,
  type AudioPrefs,
  type ShortcutId,
} from "./settings";

const DEFAULT_CHANNEL: ChannelState = {
  gain: 0.4,
  hi: 0.5,
  mid: 0.5,
  low: 0.5,
  filter: 0.5,
  fader: 0.62,
};

// Color de cada onda: el mismo del botón play/pausa de su deck.
const COLOR_A = "#3a90e0"; // azul del Deck A
const COLOR_B = "#ff5dff"; // magenta del Deck B
/** objeto estable (no se recrea en cada render) para las ondas apiladas */
const DECK_COLORS = { A: COLOR_A, B: COLOR_B };

const DEFAULT_FX: DeckFx = {
  tab: "echo",
  echo: { on: false, beat: 0.4, feedback: 0.45 },
  reverse: { on: false },
  brake: { on: false, time: 0.5 },
  flanger: { on: false, rate: 0.6 },
  phaser: { on: false, rate: 0.4 },
  reverb: { on: false, amount: 0.5 },
  crush: { on: false, bits: 0.6 },
  gate: { on: false, rate: 0.5 },
};

/** Configuración de los efectos de inserción para el motor. */
function insertCfg(f: DeckFx): InsertFxConfig {
  return {
    flanger: { on: f.flanger.on, beats: pick(SWEEP_BEATS, f.flanger.rate) },
    phaser: { on: f.phaser.on, beats: pick(SWEEP_BEATS, f.phaser.rate) },
    reverb: { on: f.reverb.on, amount: f.reverb.amount },
    crush: { on: f.crush.on, bits: crushBits(f.crush.bits) },
    gate: { on: f.gate.on, beats: pick(GATE_BEATS, f.gate.rate) },
  };
}

/** Ganancia del fader según la curva elegida en ajustes. */
function faderGain(v: number, curve: "linear" | "log" | "fast"): number {
  const x = Math.max(0, Math.min(1, v));
  if (curve === "log") return x * x;
  if (curve === "fast") return Math.sqrt(x);
  return x;
}

export default function App() {
  const engineRef = useRef<AudioEngine | null>(null);
  if (!engineRef.current) engineRef.current = new AudioEngine();
  const engine = engineRef.current;

  // biblioteca guardada: las carpetas y las pistas quedan entre sesiones
  const initial = useRef<ReturnType<typeof loadLibrary> | null>(null);
  if (!initial.current) initial.current = loadLibrary();

  const [tracks, setTracks] = useState<LibraryTrack[]>(() => restoreTracks(initial.current!.tracks));
  // copia siempre actual para callbacks async que no deben depender de `tracks`
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const [folders, setFolders] = useState<LibraryFolder[]>(initial.current.folders);
  const [playlists, setPlaylists] = useState<Playlist[]>(initial.current.playlists);
  const [history, setHistory] = useState<HistoryEntry[]>(initial.current.history);
  const [sidelist, setSidelist] = useState<string[]>(initial.current.sidelist);
  const sidelistRef = useRef(sidelist);
  sidelistRef.current = sidelist;
  const [source, setSource] = useState<BrowseSource>({ kind: "all" });
  const [scan, setScan] = useState<{ done: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  /** pista abierta en el editor */
  const [editing, setEditing] = useState<LibraryTrack | null>(null);
  /** pads de usuario (página USER) y acciones MIDI con script */
  const [userPads, setUserPads] = useState(loadUserPads);
  const [midiScripts, setMidiScripts] = useState(loadMidiScripts);
  // idioma, skin y addons
  const [ui, setUi] = useState(loadUi);
  const [addons, setAddons] = useState(loadAddons);
  useEffect(() => {
    setLanguage(ui.lang);
    applySkin(allSkins(addons).find((s) => s.name === ui.skin) ?? null);
  }, [ui, addons]);
  const patchUi = useCallback((patch: Partial<UiPrefs>) => {
    setUi((prev) => {
      const next = { ...prev, ...patch };
      saveUi(next);
      return next;
    });
  }, []);
  // streaming en vivo
  const [streamPrefs, setStreamPrefs] = useState(loadStreamPrefs);
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined);
  const [transitions, setTransitions] = useState(loadTransitions);
  const transitionsRef = useRef(transitions);
  transitionsRef.current = transitions;
  const handleTransition = useCallback((trackId: string, t: TransitionOverride | null) => {
    setTransitions((prev) => {
      const next = { ...prev };
      if (t && (t.style || t.beats)) next[trackId] = t;
      else delete next[trackId];
      saveTransitions(next);
      return next;
    });
  }, []);
  const [stems, setStemsState] = useState<{ A: StemGains; B: StemGains }>({ A: { ...FULL_STEMS }, B: { ...FULL_STEMS } });
  const handleStems = useCallback(
    (deck: DeckId, g: StemGains) => {
      engine.setStems(deck, g);
      setStemsState((prev) => ({ ...prev, [deck]: g }));
    },
    [engine],
  );
  const [padEdit, setPadEdit] = useState<{ deck: DeckId; slot: number } | null>(null);
  const shiftRef = useRef(false);
  /** ranura del sampler abierta en el editor */
  const [samplerEdit, setSamplerEdit] = useState<number | null>(null);
  const [channels, setChannels] = useState<{ A: ChannelState; B: ChannelState }>({
    A: DEFAULT_CHANNEL,
    B: DEFAULT_CHANNEL,
  });
  const [crossfade, setCrossfade] = useState(0.5);
  const crossfadeRef = useRef(crossfade);
  crossfadeRef.current = crossfade;
  const [master, setMaster] = useState(0.5);
  const [pitch, setPitch] = useState<{ A: number; B: number }>({ A: 0.5, B: 0.5 });
  const [range, setRange] = useState<{ A: number; B: number }>({ A: 8, B: 8 });
  const [keyLock, setKeyLock] = useState<{ A: boolean; B: boolean }>({ A: false, B: false });
  /** deck que manejan Espacio y C; Shift (solo) lo alterna */
  const [selectedDeck, setSelectedDeck] = useState<DeckId>("A");
  const selectedDeckRef = useRef<DeckId>("A");
  selectedDeckRef.current = selectedDeck;
  const [synced, setSynced] = useState<{ A: boolean; B: boolean }>({ A: false, B: false });
  // el motor mantiene el tempo y la fase mientras el deck esté en SYNC
  useEffect(() => {
    engine.setSyncLock("A", synced.A);
    engine.setSyncLock("B", synced.B);
  }, [engine, synced]);
  const [fx, setFx] = useState<{ A: DeckFx; B: DeckFx }>({ A: DEFAULT_FX, B: DEFAULT_FX });
  const fxRef = useRef(fx);
  fxRef.current = fx;
  // modo vinilo (scratch) del jog, por deck
  const [vinyl, setVinyl] = useState<{ A: boolean; B: boolean }>({ A: true, B: true });
  // cuantización global (botón Q)
  const [quantize, setQuantize] = useState(false);
  const [rt, setRt] = useState<{ A: DeckRuntime; B: DeckRuntime; masterMeter: MeterReading }>(() => ({
    A: engine.deckState("A"),
    B: engine.deckState("B"),
    masterMeter: SILENT_METER,
  }));
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const faderCurveRef = useRef(settings.audio.faderCurve);
  faderCurveRef.current = settings.audio.faderCurve;
  const [cues, setCues] = useState<{ A: boolean; B: boolean }>({ A: false, B: false });
  const [sandboxes, setSandboxes] = useState<{ A: boolean; B: boolean }>({ A: false, B: false });
  const [notice, setNotice] = useState<string | null>(null);
  // pitch/rango previos al SYNC: unsync devuelve el deck a donde estaba
  const preSync = useRef<{ A: { pitch: number; range: number } | null; B: { pitch: number; range: number } | null }>({
    A: null,
    B: null,
  });

  const heldCueKeys = useRef(new Map<string, DeckId>());
  const notify = useCallback((message: string) => setNotice(message), []);

  // los avisos son transitorios y no bloquean la cabina
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(id);
  }, [notice]);

  // ajustes iniciales en el motor
  useEffect(() => {
    engine.setCrossfader(0.5);
    // debe coincidir con el estado inicial de la UI (master = 0.5)
    engine.setMasterGain(0.5);
    engine.setChannelGain("A", DEFAULT_CHANNEL.gain * faderGain(DEFAULT_CHANNEL.fader, faderCurveRef.current));
    engine.setChannelGain("B", DEFAULT_CHANNEL.gain * faderGain(DEFAULT_CHANNEL.fader, faderCurveRef.current));
    // key lock encendido de fábrica: el pitch cambia el tempo, no el tono
    engine.setKeyLock("A", false);
    engine.setKeyLock("B", false);
  }, [engine]);

  // Electron solo deja leer dentro de carpetas autorizadas. Las bibliotecas
  // guardadas antes de esa regla se registran una sola vez (después se ignora).
  useEffect(() => {
    const roots = initial.current?.folders.filter((f) => !f.parent).map((f) => f.path) ?? [];
    // se llama siempre (aunque la lista esté vacía) para cerrar la migración
    // en el primer arranque y que no quede abierta para después
    window.bross?.registerRoots?.(roots).catch(() => {
      /* versión vieja del proceso principal: no hay nada que migrar */
    });
  }, []);

  useTagScan({ tracksRef, setTracks });

  // ajustes guardados: dispositivos de audio + atajos
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    void engine.setMasterOutput(settings.audio.masterId);
  }, [engine, settings.audio.masterId]);

  useEffect(() => {
    void engine.setCueOutput(settings.audio.cueId);
  }, [engine, settings.audio.cueId]);

  useEffect(() => {
    engine.setCueLevel(settings.audio.cueLevel);
  }, [engine, settings.audio.cueLevel]);

  // refresco de estado a ~30 fps (setInterval: también corre con la ventana oculta)
  useEffect(() => {
    const id = window.setInterval(() => {
      setRt({
        A: engine.deckState("A"),
        B: engine.deckState("B"),
        masterMeter: engine.getMasterMeter(),
      });
    }, 33);
    return () => window.clearInterval(id);
  }, [engine]);

  const { samples, handleSampleDrop } = useSampler({
    engine,
    tracksRef,
    notify,
    samplerVol: settings.audio.samplerVol,
  });

  const { midiRef, midiOk, midiDevices, midiMap, midiLearning, midiActions, jogState, midiLearn, midiClear, midiClearAll, midiLoadMap } =
    useMidiController();

  const { lineIn, lineInBpm, lineInLevel, toggleLineIn } = useLineIn({
    engine,
    notify,
    inputId: settings.audio.inputId,
    monitor: settings.audio.lineInMonitor,
  });
  const { streamStatus, requests, toggleStream, dismissRequest } = useStreaming({ engine, notify, history, prefs: streamPrefs });
  const { rec, toggleRec } = useRecording({
    engine,
    notify,
    history,
    format: settings.audio.recFormat,
    split: settings.audio.recSplit,
    source: settings.audio.recSource,
    inputId: settings.audio.inputId,
    inputGain: settings.audio.recInputGain,
  });

  usePlayHistory({ rt, setHistory });

  // referencia para "Compatibles": el deck que suena (si suenan los dos, el
  // que más se escucha por el crossfader)
  const compatDeck: DeckId | null =
    rt.A.playing && rt.B.playing ? (crossfade <= 0.5 ? "A" : "B") : rt.A.playing ? "A" : rt.B.playing ? "B" : null;
  const compatState = compatDeck ? rt[compatDeck] : null;
  const compatCamelot = compatState?.camelot ?? null;
  const compatBpm = compatState?.bpm
    ? Math.round(compatState.bpm * (1 + (compatState.pitch - 0.5) * (compatState.range / 50)) * 10) / 10
    : null;

  // escala del escenario: la cabina se diseña a 1428×718 y se escala para
  // llenar la ventana sin franjas. Si la ventana es más alta que esa
  // proporción, la biblioteca gana alto (más temas a la vista); si es más
  // ancha, los decks se ensanchan.
  useEffect(() => {
    const stage = document.getElementById("st");
    const fit = () => {
      if (!stage) return;
      const { w, h, scale } = fitStage(window.innerWidth, window.innerHeight);
      stage.style.width = `${w}px`;
      stage.style.height = `${h}px`;
      stage.style.transform = `translate(-50%,-50%) scale(${scale})`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const handleImport = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return [];
      setBusy(true);
      const failed: string[] = [];
      const imported: LibraryTrack[] = [];
      // en el navegador (sin puente) una carpeta llega con webkitRelativePath:
      // la usamos como ruta virtual para que el árbol de carpetas también ande
      const virtualFolders = new Set<string>();
      // en el escritorio, cada archivo suelto guarda su ruta real: así la
      // pista sobrevive al reinicio (antes quedaba solo en memoria)
      const bridge = window.bross;
      const realPaths = new Map<File, string>();
      if (bridge?.pathForFile && bridge.authorizeFiles) {
        const list = Array.from(files);
        const paths = list.map((f) => bridge.pathForFile!(f));
        const allowed = new Set(
          (await bridge.authorizeFiles(paths.filter((p): p is string => !!p)).catch(() => [] as string[])).map((p) =>
            p.toLowerCase(),
          ),
        );
        list.forEach((f, i) => {
          const p = paths[i];
          if (p && allowed.has(p.toLowerCase())) realPaths.set(f, p);
        });
      }
      const known = new Set(tracksRef.current.map((t) => t.sourcePath?.toLowerCase()).filter(Boolean));
      for (const file of Array.from(files)) {
        const real = realPaths.get(file);
        if (real && known.has(real.toLowerCase())) continue;
        const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
        const parts = rel ? rel.split("/") : [];
        if (parts.length > 1) {
          for (let i = 1; i < parts.length; i++) virtualFolders.add(parts.slice(0, i).join("/"));
        }
        const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : undefined;
        try {
          const track = await engine.importFile(file, !real);
          // el AudioBuffer queda en el motor: la UI guarda solo metadatos
          const tagged: LibraryTrack = { ...track, buffer: null, sourcePath: real ?? (rel || undefined), dir };
          imported.push(tagged);
          setTracks((prev) => [...prev, tagged]);
        } catch {
          failed.push(file.name);
        }
      }
      if (virtualFolders.size) {
        setFolders((prev) => {
          const known = new Set(prev.map((f) => f.path.toLowerCase()));
          const added: LibraryFolder[] = [];
          for (const path of virtualFolders) {
            if (known.has(path.toLowerCase())) continue;
            known.add(path.toLowerCase());
            const segs = path.split("/");
            added.push({
              path,
              name: segs[segs.length - 1],
              parent: segs.length > 1 ? segs.slice(0, -1).join("/") : null,
              favorite: false,
            });
          }
          return added.length ? [...prev, ...added] : prev;
        });
      }
      setBusy(false);
      if (failed.length) {
        window.alert(`No se pudieron decodificar:\n${failed.join("\n")}`);
      }
      // análisis en segundo plano: actualiza BPM/tonalidad al terminar
      for (const track of imported) {
        void engine.analyze(track).then((analysis) => {
          if (!analysis) return;
          setTracks((prev) => prev.map((t) => (t.id === track.id ? { ...t, analysis } : t)));
        });
      }
      return imported;
    },
    [engine],
  );

  /** Lee una pista liviana desde disco y la deja lista para el deck. */
  const hydrateTrack = useCallback(
    async (track: LibraryTrack): Promise<LibraryTrack | null> => {
      if (track.buffer) return track;
      // importada a mano en esta sesión: el PCM ya vive en el motor
      if (engine.hasBuffer(track.id)) return track;
      const bridge = window.bross;
      if (!bridge || !track.sourcePath) return null;
      try {
        const data = await bridge.readFile(track.sourcePath);
        if (!data) return null;
        const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        const ready = await engine.hydrate(track, buf);
        // guarda picos/bandas en la biblioteca, pero nunca el AudioBuffer:
        // React no debe retener el PCM de todas las pistas cargadas
        setTracks((prev) => prev.map((t) => (t.id === ready.id ? { ...ready, buffer: null } : t)));
        return ready;
      } catch {
        return null;
      }
    },
    [engine],
  );

  /** Copia cue/hot cues del motor a la biblioteca (se guardan en localStorage). */
  const persistPois = useCallback(
    (deck: DeckId) => {
      const trackId = engine.deckTrackId(deck);
      if (!trackId) return;
      const pois = engine.deckPois(deck);
      setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, pois } : t)));
    },
    [engine],
  );

  // tema que se está leyendo/decodificando en cada deck (las mezclas largas tardan)
  const [loadingDeck, setLoadingDeck] = useState<{ A: string | null; B: string | null }>({ A: null, B: null });

  const handleLoad = useCallback(
    async (track: LibraryTrack, deck: DeckId) => {
      setLoadingDeck((prev) => ({ ...prev, [deck]: track.title || track.fileName }));
      let ready: LibraryTrack | null;
      try {
        ready = await hydrateTrack(track);
      } finally {
        setLoadingDeck((prev) => ({ ...prev, [deck]: null }));
      }
      if (!ready) {
        window.alert(`No se pudo abrir "${track.fileName}". Revisá que el archivo siga en su carpeta.`);
        return;
      }
      engine.loadTrack(deck, ready);
      void engine.resume();
      // una pista nueva no está sincronizada con el otro deck
      preSync.current[deck] = null;
      setSynced((prev) => ({ ...prev, [deck]: false }));
      // analiza si falta o si es de una versión vieja del algoritmo (rápido si ya está)
      void engine.analyze(ready).then((analysis) => {
        if (!analysis || analysis === ready.analysis) return;
        setTracks((prev) => prev.map((t) => (t.id === ready.id ? { ...t, analysis } : t)));
      });
    },
    [engine, hydrateTrack],
  );

  /** Agrega una carpeta con todas sus subcarpetas y su música. */
  const handleAddFolder = useCallback(async (forcedPath?: string) => {
    const bridge = window.bross;
    if (!bridge) return;
    let scanRes: Awaited<ReturnType<typeof bridge.scanFolder>>;
    try {
      const picked = forcedPath
        ? { path: forcedPath, name: forcedPath.split(/[\\/]/).filter(Boolean).pop() ?? forcedPath }
        : await bridge.pickFolder();
      if (!picked) return;
      scanRes = await bridge.scanFolder(picked.path);
    } catch {
      notify("No se pudo leer la carpeta");
      return;
    }
    if (!scanRes) {
      notify("No se pudo leer la carpeta");
      return;
    }

    setFolders((prev) => {
      const known = new Set(prev.map((f) => f.path.toLowerCase()));
      const added: LibraryFolder[] = [];
      for (const f of scanRes.folders) {
        const key = f.path.toLowerCase();
        if (known.has(key)) continue;
        known.add(key);
        added.push({ path: f.path, name: f.name, parent: f.parent, favorite: false });
      }
      return added.length ? [...prev, ...added] : prev;
    });

    // volver a agregar una carpeta conocida no debe re-decodificar lo que ya
    // está en la biblioteca: se filtra antes de leer nada del disco
    const known = new Set(
      tracksRef.current.map((t) => t.sourcePath?.toLowerCase()).filter((p): p is string => !!p),
    );
    const files = scanRes.files.filter((f) => !known.has(f.path.toLowerCase()));
    if (!files.length) {
      if (scanRes.files.length) notify("La carpeta ya estaba en la biblioteca");
      return;
    }

    setBusy(true);
    setScan({ done: 0, total: files.length });
    const imported: LibraryTrack[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const data = await bridge.readFile(file.path);
          if (!data) throw new Error("sin datos");
          const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
          const track = await engine.importLight(file.name, buf, {
            sourcePath: file.path,
            dir: file.dir,
          });
          imported.push(track);
        } catch {
          /* archivo ilegible o códec no soportado: se omite */
        }
        setScan({ done: i + 1, total: files.length });
      }
    } finally {
      setTracks((prev) => {
        const have = new Set(prev.map((t) => t.sourcePath?.toLowerCase()).filter(Boolean));
        return [...prev, ...imported.filter((t) => !have.has(t.sourcePath?.toLowerCase() ?? ""))];
      });
      setBusy(false);
      setScan(null);
    }
  }, [engine, notify]);

  /** Quita del navegador la carpeta seleccionada, sus subcarpetas y sus pistas. */
  const handleRemoveFolder = useCallback(() => {
    if (source.kind !== "folder") return;
    const target = source.path;
    setFolders((prev) => prev.filter((f) => !isInside(f.path, target)));
    setTracks((prev) => prev.filter((t) => !(t.dir && isInside(t.dir, target))));
    setSource({ kind: "all" });
  }, [source]);

  // ── listas, sidelist e historial ─────────────────────────────────────
  const handleCreatePlaylist = useCallback(
    (name: string, kind: "list" | "folder" | "filter" = "list", parent: string | null = null, filter?: string) => {
      const id = crypto.randomUUID();
      setPlaylists((prev) => [...prev, { id, name, trackIds: [], kind, parent, ...(kind === "filter" ? { filter: filter ?? "" } : {}) }]);
      if (kind !== "folder") setSource({ kind: "playlist", id });
    },
    [],
  );

  /** Lista nueva con temas ya elegidos (importación de una playlist de Spotify). */
  const handleCreatePlaylistWith = useCallback((name: string, trackIds: string[]) => {
    const id = crypto.randomUUID();
    setPlaylists((prev) => [...prev, { id, name, trackIds: [...trackIds], kind: "list", parent: null }]);
    setSource({ kind: "playlist", id });
  }, []);

  const handleUpdatePlaylist = useCallback((id: string, patch: Partial<Pick<Playlist, "name" | "filter" | "parent">>) => {
    setPlaylists((prev) => {
      // una carpeta no puede quedar dentro de sí misma
      if (patch.parent && playlistDescendants(prev, id).has(patch.parent)) return prev;
      return prev.map((p) => (p.id === id ? { ...p, ...patch } : p));
    });
  }, []);

  /** Borra la lista; si es una carpeta, borra también lo que tiene adentro. */
  const handleDeletePlaylist = useCallback(
    (id: string) => {
      const gone = playlistDescendants(playlists, id);
      setPlaylists((prev) => prev.filter((p) => !gone.has(p.id)));
      setSource((s) => (s.kind === "playlist" && gone.has(s.id) ? { kind: "all" } : s));
    },
    [playlists],
  );

  const handleAddToPlaylist = useCallback((id: string, trackId: string) => {
    setPlaylists((prev) => prev.map((p) => (p.id === id ? { ...p, trackIds: [...p.trackIds, trackId] } : p)));
  }, []);

  const handleRemoveFromPlaylist = useCallback((id: string, index: number) => {
    setPlaylists((prev) =>
      prev.map((p) => (p.id === id ? { ...p, trackIds: p.trackIds.filter((_, i) => i !== index) } : p)),
    );
  }, []);

  const handleSideAdd = useCallback((trackId: string) => {
    setSidelist((prev) => [...prev, trackId]);
  }, []);

  const handleSideRemove = useCallback((index: number) => {
    setSidelist((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSideMove = useCallback((index: number, dir: -1 | 1) => {
    setSidelist((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }, []);

  const handleSideClear = useCallback(() => setSidelist([]), []);

  /** Guarda lo del editor de pista: biblioteca, motor y (si se pidió) el archivo. */
  const handleTrackSave = useCallback(
    async (id: string, edit: TrackEdit, fileTags: EditableTags | null): Promise<string | null> => {
      const t = tracksRef.current.find((x) => x.id === id);
      if (!t) return "La pista ya no está en la biblioteca";
      if (fileTags && t.sourcePath && window.bross?.writeTags) {
        const res = await window.bross.writeTags(t.sourcePath, fileTags).catch((e: unknown) => ({ ok: false, error: String(e) }));
        if (!res.ok) return `No se pudo escribir en el archivo: ${res.error ?? "error desconocido"}`;
      }
      engine.updateTrackData(id, { analysis: edit.analysis, pois: edit.pois });
      setTracks((prev) => prev.map((x) => (x.id === id ? { ...x, ...edit, tagged: true } : x)));
      notify(fileTags ? "Etiquetas guardadas en el archivo" : "Pista actualizada");
      return null;
    },
    [engine, notify],
  );

  /** Combina la biblioteca de la carpeta de sincronización con la actual. */
  const handleSyncPull = useCallback(
    (json: string) => {
      const remote = parseStoredLibrary(json);
      if (!remote) throw new Error("La copia de la carpeta no se pudo leer");
      const local = toStoredLibrary(folders, tracks, { playlists, history, sidelist });
      const merged = mergeLibrary(local, remote);
      const haveIds = new Set(tracks.map((t) => t.id));
      const added = restoreTracks(merged.tracks.filter((t) => !haveIds.has(t.id)));
      const updated = new Map(merged.tracks.map((t) => [t.id, t]));
      setTracks((prev) => [
        ...prev.map((t) => {
          const m = updated.get(t.id);
          return m ? { ...t, analysis: t.analysis ?? m.analysis ?? null, pois: m.pois ?? t.pois, album: m.album, genre: m.genre, year: m.year } : t;
        }),
        ...added,
      ]);
      setFolders(merged.folders);
      setPlaylists(merged.playlists);
      setHistory(merged.history);
      return {
        tracks: added.length,
        playlists: merged.playlists.length - playlists.length,
        history: merged.history.length - history.length,
      };
    },
    [folders, tracks, playlists, history, sidelist],
  );

  const handleToggleFavorite = useCallback((path: string) => {
    setFolders((prev) =>
      prev.map((f) => (f.path === path ? { ...f, favorite: !f.favorite } : f)),
    );
  }, []);

  // guarda carpetas y metadatos (sin buffers) para la próxima sesión
  useEffect(() => {
    const id = window.setTimeout(() => saveLibrary(folders, tracks, { playlists, history, sidelist }), 600);
    return () => window.clearTimeout(id);
  }, [folders, tracks, playlists, history, sidelist]);

  const handleChannel = useCallback(
    (deck: DeckId, key: keyof ChannelState, value: number) => {
      setChannels((prev) => {
        const next = { ...prev, [deck]: { ...prev[deck], [key]: value } };
        const c = next[deck];
        engine.setChannelGain(deck, c.gain * faderGain(c.fader, faderCurveRef.current));
        if (key === "hi") engine.setEq(deck, "high", value);
        if (key === "mid" || key === "low") engine.setEq(deck, key, value);
        if (key === "filter") engine.setFilter(deck, value);
        return next;
      });
    },
    [engine],
  );

  const handleCrossfade = useCallback(
    (v: number) => {
      setCrossfade(v);
      engine.setCrossfader(v);
    },
    [engine],
  );

  const handleMaster = useCallback(
    (v: number) => {
      setMaster(v);
      engine.setMasterGain(v);
    },
    [engine],
  );

  const handlePitch = useCallback(
    (deck: DeckId, v: number) => {
      if (synced[deck]) {
        setSynced((prev) => ({ ...prev, [deck]: false }));
        preSync.current[deck] = null;
      }
      setPitch((prev) => ({ ...prev, [deck]: v }));
      engine.setPitch(deck, v);
    },
    [engine, synced],
  );

  const handleRange = useCallback(
    (deck: DeckId, dir: -1 | 1) => {
      const current = range[deck];
      const idx = (PITCH_RANGES as readonly number[]).indexOf(current);
      const base = idx < 0 ? (PITCH_RANGES as readonly number[]).indexOf(8) : idx;
      const next = PITCH_RANGES[Math.max(0, Math.min(PITCH_RANGES.length - 1, base + dir))];
      if (next === current) return;
      // cambiar el rango cambia la relación pitch→tempo: el SYNC ya no vale
      if (synced[deck]) {
        setSynced((prev) => ({ ...prev, [deck]: false }));
        preSync.current[deck] = null;
      }
      setRange((prev) => ({ ...prev, [deck]: next }));
      engine.setPitchRange(deck, next);
    },
    [engine, range, synced],
  );

  const handleKeyLock = useCallback(
    (deck: DeckId) => {
      const next = !keyLock[deck];
      setKeyLock((prev) => ({ ...prev, [deck]: next }));
      engine.setKeyLock(deck, next);
    },
    [engine, keyLock],
  );

  useEffect(() => {
    engine.quantize = quantize;
  }, [engine, quantize]);

  // curvas y CUE MIX guardados en ajustes
  useEffect(() => {
    engine.setCrossfaderCurve(settings.audio.xfCurve);
  }, [engine, settings.audio.xfCurve]);

  useEffect(() => {
    engine.setCueMix(settings.audio.cueMix);
  }, [engine, settings.audio.cueMix]);

  /** Corrige la rejilla de beats del deck y la guarda en la biblioteca. */
  const handleGrid = useCallback(
    (deck: DeckId, edit: GridEdit) => {
      const next = engine.editGrid(deck, edit);
      const trackId = engine.deckTrackId(deck);
      if (!next || !trackId) return;
      setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, analysis: next } : t)));
    },
    [engine],
  );

  /** Efectos por deck: cambia la solapa o enciende/ajusta ECHO, REVERSE o BREAK. */
  const handleFx = useCallback(
    (deck: DeckId, patch: DeckFxPatch) => {
      const prev = fxRef.current[deck];
      let next: DeckFx = prev;
      if ("tab" in patch) next = { ...prev, tab: patch.tab };
      if ("echo" in patch) {
        next = { ...prev, echo: { ...prev.echo, ...patch.echo } };
        engine.setEcho(deck, {
          on: next.echo.on,
          beats: ECHO_BEATS[echoBeatIndex(next.echo.beat)],
          feedback: next.echo.feedback,
        });
      }
      if ("reverse" in patch) {
        next = { ...prev, reverse: { ...prev.reverse, ...patch.reverse } };
        if (next.reverse.on !== prev.reverse.on) engine.setReverse(deck, next.reverse.on);
      }
      if ("brake" in patch) {
        next = { ...prev, brake: { ...prev.brake, ...patch.brake } };
        // el tiempo solo importa al encender (o mientras está frenando)
        if (next.brake.on !== prev.brake.on || next.brake.on) {
          engine.setBrake(deck, next.brake.on, brakeSeconds(next.brake.time));
        }
      }
      if ("flanger" in patch) next = { ...prev, flanger: { ...prev.flanger, ...patch.flanger } };
      if ("phaser" in patch) next = { ...prev, phaser: { ...prev.phaser, ...patch.phaser } };
      if ("reverb" in patch) next = { ...prev, reverb: { ...prev.reverb, ...patch.reverb } };
      if ("crush" in patch) next = { ...prev, crush: { ...prev.crush, ...patch.crush } };
      if ("gate" in patch) next = { ...prev, gate: { ...prev.gate, ...patch.gate } };
      if ("flanger" in patch || "phaser" in patch || "reverb" in patch || "crush" in patch || "gate" in patch) {
        engine.setInsertFx(deck, insertCfg(next));
      }
      fxRef.current = { ...fxRef.current, [deck]: next };
      setFx(fxRef.current);
    },
    [engine],
  );

  // al cambiar la curva de los faders se reaplica la ganancia de los dos canales
  useEffect(() => {
    for (const d of ["A", "B"] as DeckId[]) {
      const c = channels[d];
      engine.setChannelGain(d, c.gain * faderGain(c.fader, settings.audio.faderCurve));
    }
  }, [engine, settings.audio.faderCurve]);

  /** Pad de loop de largo fijo: loop desde acá hacia adelante, o sale. */
  const handleLoopPad = useCallback(
    (deck: DeckId, beats: number) => {
      engine.padLoop(deck, beats);
    },
    [engine],
  );

  // SLIP vive en el motor; la UI lo lee del estado del deck
  const toggleSlip = useCallback(
    (deck: DeckId) => {
      engine.setSlip(deck, !engine.deckState(deck).slip);
    },
    [engine],
  );

  const handleLoop = useCallback(
    (deck: DeckId, beats: number) => {
      engine.toggleLoop(deck, beats);
    },
    [engine],
  );

  const handleRollStart = useCallback(
    (deck: DeckId, beats: number) => {
      if (!engine.startRoll(deck, beats)) return;
      // Red de seguridad: si el puntero se suelta fuera del pad, el roll igual
      // termina (la captura de puntero puede fallar en algunos dispositivos).
      const stop = () => {
        engine.endRoll(deck);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
      };
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
    },
    [engine],
  );

  const handleRollEnd = useCallback(
    (deck: DeckId) => {
      engine.endRoll(deck);
    },
    [engine],
  );

  const handleSync = useCallback(
    (deck: DeckId) => {
      if (synced[deck]) {
        const prev = preSync.current[deck];
        const backPitch = prev?.pitch ?? 0.5;
        const backRange = prev?.range ?? range[deck];
        // primero el rango, después el pitch: el rate se recalcula con ambos
        engine.setPitchRange(deck, backRange);
        engine.setPitch(deck, backPitch);
        engine.clearKeyShift(deck);
        setPitch((p) => ({ ...p, [deck]: backPitch }));
        setRange((r) => ({ ...r, [deck]: backRange }));
        setSynced((prevSynced) => ({ ...prevSynced, [deck]: false }));
        preSync.current[deck] = null;
        notify("SYNC desactivado");
        return;
      }
      const res = engine.sync(deck);
      if (!res) {
        notify("SYNC: falta el BPM de alguno de los dos decks");
        return;
      }
      const previous = { pitch: pitch[deck], range: range[deck] };
      setPitch((p) => ({ ...p, [deck]: res.pitch }));
      setRange((r) => ({ ...r, [deck]: res.range }));
      if (!res.applied) {
        // no se tocó el audio: la diferencia no entra en el rango
        setSynced((prevSynced) => ({ ...prevSynced, [deck]: false }));
        notify(`SYNC: la diferencia de BPM supera el rango ±${res.range} %`);
        return;
      }
      preSync.current[deck] = previous;
      // el otro deck pasa a mandar: solo uno queda enganchado
      setSynced((prevSynced) => ({ ...prevSynced, [deck]: true, [deck === "A" ? "B" : "A"]: false }));
    },
    [engine, notify, pitch, range, synced],
  );

  /**
   * CUE:
   * - sonando: vuelve al cue y para;
   * - en pausa: fija el cue donde está y suena mientras se mantiene;
   * - soltar: vuelve al cue en pausa (salvo que se haya apretado PLAY).
   */
  const handleCueDown = useCallback(
    (deck: DeckId) => {
      if (engine.cueDown(deck)) persistPois(deck);
    },
    [engine, persistPois],
  );

  const handleCueUp = useCallback(
    (deck: DeckId) => {
      engine.cueUp(deck);
    },
    [engine],
  );

  /** Hot cue: vacío = fijar, ocupado = saltar. Mayús+clic borra. */
  const handleHotCue = useCallback(
    (deck: DeckId, slot: number) => {
      engine.toggleHotCue(deck, slot);
      persistPois(deck);
    },
    [engine, persistPois],
  );

  const handleHotCueClear = useCallback(
    (deck: DeckId, slot: number) => {
      engine.clearHotCue(deck, slot);
      persistPois(deck);
    },
    [engine, persistPois],
  );

  /** Preescucha del canal por la salida de auriculares. */
  const handleCueToggle = useCallback(
    (deck: DeckId) => {
      const next = !cues[deck];
      setCues((prev) => ({ ...prev, [deck]: next }));
      engine.setDeckCue(deck, next);
      // sin CUE no hay forma de escuchar el sandbox: se apaga junto con él
      if (!next && sandboxes[deck]) {
        setSandboxes((prev) => ({ ...prev, [deck]: false }));
        engine.setSandbox(deck, false);
      }
    },
    [cues, engine, sandboxes],
  );

  /** Sandbox: ensayar el deck sin que entre al master, solo por auriculares. */
  const handleSandboxToggle = useCallback(
    (deck: DeckId) => {
      const next = !sandboxes[deck];
      setSandboxes((prev) => ({ ...prev, [deck]: next }));
      engine.setSandbox(deck, next);
      if (next && !cues[deck]) {
        setCues((prev) => ({ ...prev, [deck]: true }));
        engine.setDeckCue(deck, true);
      }
    },
    [cues, engine, sandboxes],
  );

  const runShortcut = useCallback(
    (id: ShortcutId) => {
      switch (id) {
        case "deckA.toggle":
          engine.toggle("A");
          break;
        case "deckA.cue":
          handleCueDown("A");
          break;
        case "deckA.sync":
          handleSync("A");
          break;
        case "deckA.keyLock":
          handleKeyLock("A");
          break;
        case "deckA.sandbox":
          handleSandboxToggle("A");
          break;
        case "deckB.toggle":
          engine.toggle("B");
          break;
        case "deckB.cue":
          handleCueDown("B");
          break;
        case "deckB.sync":
          handleSync("B");
          break;
        case "deckB.keyLock":
          handleKeyLock("B");
          break;
        case "deckB.sandbox":
          handleSandboxToggle("B");
          break;
        case "crossfader.left":
          handleCrossfade(Math.max(0, crossfade - 0.05));
          break;
        case "crossfader.center":
          handleCrossfade(0.5);
          break;
        case "crossfader.right":
          handleCrossfade(Math.min(1, crossfade + 0.05));
          break;
        case "master.up":
          handleMaster(Math.min(1, master + 0.05));
          break;
        case "master.down":
          handleMaster(Math.max(0, master - 0.05));
          break;
        case "selected.toggle":
          engine.toggle(selectedDeckRef.current);
          break;
        case "selected.cue":
          handleCueDown(selectedDeckRef.current);
          break;
        default:
          break;
      }
    },
    [
      crossfade,
      engine,
      handleCueDown,
      handleCrossfade,
      handleKeyLock,
      handleMaster,
      handleSandboxToggle,
      handleSync,
      master,
    ],
  );

  // atajos globales: no se disparan mientras se escribe o se ajusta un control
  useEffect(() => {
    // Shift solo (apretar y soltar sin otra tecla ni clic) cambia de deck
    let shiftAlone = false;
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && !!t.closest("input, textarea, select, [contenteditable='true'], [role='textbox']");
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        if (!e.repeat) shiftAlone = !settingsOpen && !typing(e.target);
        return;
      }
      shiftAlone = false;
      if (settingsOpen || e.defaultPrevented || e.repeat) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const combo = comboFromEvent(e);
      if (!combo) return;
      const id = (Object.keys(settings.shortcuts) as ShortcutId[]).find(
        (key) => settings.shortcuts[key] === combo,
      );
      if (!id) return;
      // los atajos del deck seleccionado andan aunque el foco quede en un
      // botón o control (después de un clic); el resto no, para no pisar
      // el teclado propio de botones y deslizadores
      const onSelected = id === "selected.toggle" || id === "selected.cue";
      if (typing(target)) return;
      const onControl = !!target?.closest("button, a, [role='slider']");
      if (!onSelected && onControl) return;
      e.preventDefault();
      // un botón con foco haría su propio clic con Espacio al soltar
      if (onSelected && onControl) target?.blur();
      // el CUE se mantiene: se recuerda la tecla para soltarlo en keyup
      if (id === "deckA.cue") heldCueKeys.current.set(e.code, "A");
      if (id === "deckB.cue") heldCueKeys.current.set(e.code, "B");
      if (id === "selected.cue") heldCueKeys.current.set(e.code, selectedDeckRef.current);
      runShortcut(id);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        if (shiftAlone) setSelectedDeck((d) => (d === "A" ? "B" : "A"));
        shiftAlone = false;
        return;
      }
      const deck = heldCueKeys.current.get(e.code);
      if (!deck) return;
      heldCueKeys.current.delete(e.code);
      handleCueUp(deck);
    };
    // Mayús+clic (por ejemplo, borrar un pad) no cambia de deck
    const onPointerDown = () => {
      shiftAlone = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [runShortcut, handleCueUp, settings.shortcuts, settingsOpen]);

  const handleSlice = useCallback(
    (deck: DeckId) => (slot: number) => {
      // slicer: 8 rebanadas de un beat dentro de la frase que está sonando
      const state = engine.deckState(deck);
      if (!state.loaded) return;
      if (!engine.slice(deck, slot)) notify("SLICE: la pista todavía no tiene BPM");
    },
    [engine, notify],
  );

  const patchAudio = useCallback((patch: Partial<AudioPrefs>) => {
    setSettings((prev) => ({ ...prev, audio: { ...prev.audio, ...patch } }));
  }, []);

  const changeShortcuts = useCallback((shortcuts: Record<ShortcutId, string>) => {
    setSettings((prev) => ({ ...prev, shortcuts }));
  }, []);

  // hook de QA (solo dev): la consola puede importar/cargar usando el mismo camino que la UI
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __brossQA?: unknown };
    w.__brossQA = {
      importFiles: handleImport,
      load: handleLoad,
      engine,
      sync: handleSync,
      loop: handleLoop,
      addFolder: handleAddFolder,
      cueDown: handleCueDown,
      sideAdd: handleSideAdd,
      crossfade: handleCrossfade,
      automix: () => toggleAutomix(),
      cueUp: handleCueUp,
      fx: handleFx,
      hotCue: handleHotCue,
      deckPois: (deck: DeckId) => engine.deckPois(deck),
      deckState: (deck: DeckId) => engine.deckState(deck),
    };
    return () => {
      delete w.__brossQA;
    };
  }, [engine, handleImport, handleLoad, handleLoop, handleAddFolder, handleCueDown, handleCueUp, handleFx, handleHotCue]);

  // efectos al beat: con Q encendido, prender o apagar un efecto espera al
  // próximo beat del deck (como el FX cuantizado de los controladores)
  const fxQueue = useRef<{ A: { timer: number; patches: DeckFxPatch[] } | null; B: { timer: number; patches: DeckFxPatch[] } | null }>({
    A: null,
    B: null,
  });
  const handleFxQuantized = useCallback(
    (deck: DeckId, patch: DeckFxPatch) => {
      const toggles = Object.values(patch).some((v) => typeof v === "object" && v !== null && "on" in v);
      const pending = fxQueue.current[deck];
      // lo que llega mientras espera el beat sale junto, en orden
      if (pending) {
        pending.patches.push(patch);
        return;
      }
      const wait = toggles ? engine.msToNextBeat(deck) : 0;
      if (!wait) {
        handleFx(deck, patch);
        return;
      }
      fxQueue.current[deck] = {
        patches: [patch],
        timer: window.setTimeout(() => {
          const q = fxQueue.current[deck];
          fxQueue.current[deck] = null;
          q?.patches.forEach((p) => handleFx(deck, p));
        }, wait),
      };
    },
    [engine, handleFx],
  );

  // ── karaoke y video ───────────────────────────────────────────────
  const rtRef = useRef(rt);
  rtRef.current = rt;
  const {
    karaoke,
    setKaraoke,
    singers,
    addSinger,
    updateSinger,
    removeSinger,
    moveSinger,
    nextSinger,
    currentSinger,
    setCurrentKey,
    background,
    setBackground,
    lyrics,
    karaokeRef,
  } = useKaraoke({ engine, notify, rt, tracksRef, playlists, handleLoad, handleCrossfade });
  const { dvsPrefs, dvsOn, dvsReading, toggleDvs, calibrateDvs, patchDvs } = useDvs({ engine, notify, rt });
  const video = useVideo({ engine, notify, rtRef, tracksRef, crossfadeRef, karaokeRef });
  const [panel, setPanel] = useState<"video" | "karaoke" | null>(null);
  useEffect(() => video.setVideoActive(panel === "video"), [panel]);

  const karaokePosition = useCallback(() => engine.deckPosition("A"), [engine]);

  const automixEcho = useCallback((deck: DeckId, on: boolean) => handleFx(deck, { echo: { on } }), [handleFx]);
  const { automix, toggleAutomix } = useAutomix({
    engine,
    rt,
    automixBeats: settings.audio.automixBeats,
    automixStyle: settings.audio.automixStyle,
    transitionsRef,
    setEcho: automixEcho,
    tracksRef,
    sidelistRef,
    setSidelist,
    crossfadeRef,
    handleLoad,
    handleCrossfade,
    handleChannel,
    setPitch,
    setRange,
    setSynced,
    notify,
  });

  // scripts de pads y MIDI: corren contra el estado y los handlers vigentes
  const runAction = (src: string, deck: DeckId) => {
    const { tree, error } = tryParseScript(src);
    if (!tree) {
      notify(`Script con error: ${error}`);
      return;
    }
    const press = (action: string) => midiActions.current({ action, phase: "press" });
    runScript(tree, {
      deck,
      run: (d, name, arg) => {
        if (d) {
          const n = arg != null ? Number(arg) : NaN;
          if (name === "hot") return handleHotCue(d, Math.max(0, Math.min(7, Math.round(n) - 1)));
          if (name === "loop" && arg != null) return handleLoop(d, n);
          if (name === "stop") return engine.pause(d);
          if (name === "stem" && arg) {
            const [k, v] = arg.split("=");
            const key = ({ voz: "vocal", vocal: "vocal", bajo: "bass", bass: "bass", perc: "perc", instr: "instr" } as Record<string, keyof StemGains>)[k];
            if (key) handleStems(d, { ...stems[d], [key]: v != null ? Math.max(0, Math.min(1, Number(v))) : stems[d][key] > 0.01 ? 0 : 1 });
            return;
          }
          if (name === "cue") {
            handleCueDown(d);
            handleCueUp(d);
            return;
          }
          if (name === "fx" && arg) {
            const cur = fx[d][arg as keyof DeckFx] as { on?: boolean } | undefined;
            if (cur && typeof cur === "object" && "on" in cur) handleFxQuantized(d, { [arg]: { on: !cur.on } } as DeckFxPatch);
            return;
          }
          if (["pitch", "volume", "gain", "eqHigh", "eqMid", "eqLow", "filter"].includes(name)) {
            midiActions.current({ action: `deck${d}.${name}`, phase: "value", value: Math.max(0, Math.min(1, n)) });
            return;
          }
          return press(`deck${d}.${name}`);
        }
        const n = arg != null ? Math.max(0, Math.min(1, Number(arg))) : 0;
        if (name === "crossfader") handleCrossfade(n);
        else if (name === "master") handleMaster(n);
        else if (name === "sample") engine.playSample(Math.max(0, Math.min(7, Math.round(Number(arg)) - 1)));
        else if (name === "automix") void toggleAutomix();
        else if (name === "rec") void toggleRec();
      },
      query: (d, name) => {
        if (!d) {
          if (name === "shift") return shiftRef.current;
          if (name === "automix") return automix;
          if (name === "recording") return !!rec;
          return false;
        }
        const s = rt[d];
        switch (name) {
          case "playing":
            return s.playing;
          case "loaded":
            return s.loaded;
          case "synced":
            return synced[d];
          case "looping":
            return s.loopStart != null;
          case "keylock":
            return keyLock[d];
          case "vinyl":
            return vinyl[d];
          case "slip":
            return s.slip;
        }
        return false;
      },
    });
  };
  const runActionRef = useRef(runAction);
  runActionRef.current = runAction;
  const handleUserPad = useCallback((deck: DeckId, slot: number) => {
    runActionRef.current(userPadsRef.current[deck][slot].script, deck);
  }, []);
  const userPadsRef = useRef(userPads);
  userPadsRef.current = userPads;

  /** Instala un addon: guarda sus skins y aplica pads, scripts, mapa MIDI y filtros. */
  const handleInstallAddon = (addon: Addon): string => {
    const done: string[] = [];
    if (addon.pads) {
      const next = { A: addon.pads.A ?? userPads.A, B: addon.pads.B ?? userPads.B };
      setUserPads(next);
      saveUserPads(next);
      done.push("pads de usuario");
    }
    if (addon.midiScripts?.length) {
      const ids = new Set(addon.midiScripts.map((s) => s.id));
      const next = [...midiScripts.filter((s) => !ids.has(s.id)), ...addon.midiScripts];
      setMidiScripts(next);
      saveMidiScripts(next);
      done.push(`${addon.midiScripts.length} acciones MIDI`);
    }
    if (addon.midiMap && Object.keys(addon.midiMap).length) {
      midiLoadMap({ ...midiMap, ...addon.midiMap });
      done.push("asignaciones MIDI");
    }
    if (addon.filters?.length) {
      setPlaylists((prev) => [
        ...prev,
        ...addon.filters!.map((f) => ({ id: crypto.randomUUID(), name: f.name, trackIds: [], kind: "filter" as const, parent: null, filter: f.filter })),
      ]);
      done.push(`${addon.filters.length} carpetas filtro`);
    }
    const next = [...addons.filter((a) => a.name !== addon.name), addon];
    setAddons(next);
    saveAddons(next);
    if (addon.skins?.length) {
      patchUi({ skin: addon.skins[0].name });
      done.push(`skin "${addon.skins[0].name}"`);
    }
    return `Instalado "${addon.name}"${done.length ? `: ${done.join(", ")}` : ""}.`;
  };

  /** Descarga un addon con la configuración actual. */
  const handleExportAddon = () => {
    const skin = allSkins(addons).find((s) => s.name === ui.skin && !s.builtin);
    const pkg: Addon = {
      type: "bross-addon",
      name: "Mi configuración BROSS DJ",
      version: new Date().toISOString().slice(0, 10),
      skins: skin ? [skin] : undefined,
      pads: userPads,
      midiScripts,
      midiMap,
      filters: playlists.filter((p) => p.kind === "filter").map((p) => ({ name: p.name, filter: p.filter ?? "" })),
    };
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bross-addon.json";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  // acciones MIDI: el contexto se arma en cada render con los handlers vigentes
  midiActions.current = (e: MidiEvent) => {
    // SHIFT del controlador y acciones con script
    if (e.action === "global.shift") {
      if (e.phase === "press" || e.phase === "release") shiftRef.current = e.phase === "press";
      return;
    }
    if (e.action.startsWith("script.")) {
      if (e.phase !== "press") return;
      const s = midiScripts.find((x) => `script.${x.id}` === e.action);
      if (s) runActionRef.current(s.script, s.deck === "B" ? "B" : "A");
      return;
    }
    dispatchMidi(e, {
      engine,
      vinyl,
      fx,
      tracks,
      sidelist,
      jogState,
      setVinyl,
      setSidelist,
      patchAudio,
      handleCrossfade,
      handleMaster,
      handlePitch,
      handleChannel,
      handleCueDown,
      handleCueUp,
      handleHotCue,
      handleSync,
      handleKeyLock,
      toggleSlip,
      handleFx,
      handleCueToggle,
      handleLoad,
    });
  };

  // luces del controlador según el estado de cada deck
  useEffect(() => {
    midiRef.current?.updateLeds(midiLedStates({ rt, synced, keyLock, vinyl, fx, cues, now: performance.now() }));
  }, [rt, synced, keyLock, vinyl, fx, cues, midiRef]);

  return (
    <div className="host">
      <div id="st" className={ui.visual === "minimal" ? "vis-minimal" : undefined}>
        <Toolbar
          onOpenSettings={() => setSettingsOpen(true)}
          quantize={quantize}
          onQuantize={() => setQuantize((q) => !q)}
          recSeconds={rec ? (Date.now() - rec.startedAt) / 1000 : null}
          onRec={() => void toggleRec()}
          automix={automix}
          onAutomix={() => void toggleAutomix()}
          modules={
            <>
              <button
                type="button"
                className={`chip videobtn${video.screenOpen || video.videoRec ? " on" : ""}`}
                aria-pressed={video.screenOpen}
                onClick={() => setPanel("video")}
                title="Video: pantalla, mezcla, cámara, títulos, imágenes y grabación"
              >
                VIDEO <b>{video.videoRec ? "● REC" : video.screenOpen ? "ON" : "OFF"}</b>
              </button>
              <button
                type="button"
                className={`chip karaokebtn${karaoke ? " on" : ""}`}
                aria-pressed={karaoke}
                onClick={() => setPanel("karaoke")}
                title="Karaoke: turnos, tono por cantante, letras y música de fondo"
              >
                KARAOKE <b>{karaoke ? singers.length : "OFF"}</b>
              </button>
              <button
                type="button"
                className={`chip lineinbtn${lineIn ? " on" : ""}`}
                aria-pressed={lineIn}
                onClick={() => void toggleLineIn()}
                title={
                  lineIn
                    ? `Entrada de línea · nivel ${Math.round(lineInLevel * 100)} % · clic para cerrar`
                    : "Abrir la entrada de línea / micrófono y leer su BPM (escucharla por el master: Ajustes → Audio)"
                }
              >
                LINE IN <b>{lineIn ? (lineInBpm ? lineInBpm.toFixed(1) : "…") : "OFF"}</b>
              </button>
            </>
          }
          output={
            <>
              <button
                type="button"
                className={`chip livebtn${streamStatus.live ? " on" : ""}${streamStatus.error ? " warn" : ""}`}
                aria-pressed={streamStatus.live}
                onClick={() => void toggleStream()}
                title={
                  streamStatus.live
                    ? `En vivo · ${streamStatus.listeners} oyentes${streamStatus.error ? ` · ${streamStatus.error}` : ""} · clic para cortar`
                    : "Transmitir en vivo (Icecast / red local · configurar en Ajustes → Streaming)"
                }
              >
                LIVE <b>{streamStatus.live ? `● ${streamStatus.listeners}` : "OFF"}</b>
              </button>
              {requests.length ? (
                <button
                  type="button"
                  className="chip reqbtn on"
                  onClick={() => {
                    setSettingsTab("streaming");
                    setSettingsOpen(true);
                  }}
                  title="Pedidos de temas de la red local"
                >
                  PEDIDOS <b>{requests.length}</b>
                </button>
              ) : null}
            </>
          }
        />

        <div className="console">
          <div className="deckcol col-a">
            <div className="wvstack">
              <ScrollWave
                deck="A"
                engine={engine}
                color={COLOR_A}
                cues={rt.A.cues}
                cuePoint={rt.A.cuePoint}
                loop={rt.A.loopStart != null && rt.A.loopEnd != null ? { start: rt.A.loopStart, end: rt.A.loopEnd } : null}
                loopIn={rt.A.loopIn}
                position={rt.A.position}
                duration={rt.A.duration}
                hasGrid={!!rt.A.bpm}
                onScratchStart={() => engine.scratchStart("A")}
                onScratchMove={(delta) => engine.scratchMove("A", delta)}
                onScratchEnd={() => engine.scratchEnd("A")}
                onGrid={(edit) => handleGrid("A", edit)}
              />
              <Waveform
                peaks={rt.A.peaks}
                bands={rt.A.bands}
                position={rt.A.position}
                duration={rt.A.duration}
                color={COLOR_A}
                cues={rt.A.cues}
                cuePoint={rt.A.cuePoint}
                loop={rt.A.loopStart != null && rt.A.loopEnd != null ? { start: rt.A.loopStart, end: rt.A.loopEnd } : null}
                onSeek={(s) => engine.seek("A", s)}
                height={14}
                showTimes={false}
              />
            </div>
            <Deck
              id="A"
              runtime={rt.A}
              loading={loadingDeck.A}
              pitch={synced.A ? rt.A.pitch : pitch.A}
              range={range.A}
              onRange={(dir) => handleRange("A", dir)}
              keyLock={keyLock.A}
              onKeyLock={() => handleKeyLock("A")}
              synced={synced.A}
              onSync={() => handleSync("A")}
              canSync={!!rt.A.bpm && !!rt.B.bpm}
              onLoop={(beats) => handleLoop("A", beats)}
              onLoopPad={(beats) => handleLoopPad("A", beats)}
              onLoopIn={() => engine.loopIn("A")}
              onLoopOut={() => engine.loopOut("A")}
              onAutoLoop={() => engine.autoLoop("A")}
              onLoopResize={(f) => engine.loopResize("A", f)}
              onLoopMove={(dir) => engine.loopMove("A", dir)}
              onReloop={() => engine.reloop("A")}
              onSlip={() => toggleSlip("A")}
              onRollStart={(beats) => handleRollStart("A", beats)}
              onRollEnd={() => handleRollEnd("A")}
              onSlice={handleSlice("A")}
              samples={samples}
              onSamplePlay={(i) => engine.playSample(i)}
              onSampleClear={(i) => engine.clearSample(i)}
              onSampleEdit={setSamplerEdit}
              onSampleDrop={(i, id) => void handleSampleDrop(i, id)}
              userPads={userPads.A}
              onUserPad={(i) => handleUserPad("A", i)}
              onUserPadEdit={(i) => setPadEdit({ deck: "A", slot: i })}
              stems={stems.A}
              onStems={(g) => handleStems("A", g)}
              onPitch={(v) => handlePitch("A", v)}
              onToggle={() => engine.toggle("A")}
              onCueDown={() => handleCueDown("A")}
              onCueUp={() => handleCueUp("A")}
              onSeek={(s) => engine.seek("A", s)}
              onHotCue={(i) => handleHotCue("A", i)}
              onHotCueClear={(i) => handleHotCueClear("A", i)}
              onDropTrack={(id) => {
                const track = tracks.find((t) => t.id === id);
                if (track) handleLoad(track, "A");
              }}
              scratch={vinyl.A}
              onScratchToggle={() => setVinyl((v) => ({ ...v, A: !v.A }))}
              onScratchStart={() => engine.scratchStart("A")}
              onScratchMove={(delta) => engine.scratchMove("A", delta)}
              onScratchEnd={() => engine.scratchEnd("A")}
              onBend={(b) => engine.setBend("A", b)}
            />
          </div>

          <Mixer
            selected={selectedDeck}
            a={channels.A}
            b={channels.B}
            onChannel={handleChannel}
            crossfade={crossfade}
            onCrossfade={handleCrossfade}
            master={master}
            onMaster={handleMaster}
            panelView={ui.mixPanel}
            onPanelView={(mixPanel) => patchUi({ mixPanel })}
            waves={<StackedWaves engine={engine} colors={DECK_COLORS} bpm={{ A: rt.A.bpm, B: rt.B.bpm }} />}
            meters={{ A: rt.A.meter, B: rt.B.meter }}
            masterMeter={rt.masterMeter}
            cue={cues}
            onCue={handleCueToggle}
            sandbox={sandboxes}
            onSandbox={handleSandboxToggle}
            cueWarning={settings.audio.masterId === settings.audio.cueId}
            fx={fx}
            onFx={handleFxQuantized}
            cueMix={settings.audio.cueMix}
            onCueMix={(v) => patchAudio({ cueMix: v })}
            samplerVol={settings.audio.samplerVol}
            onSamplerVol={(v) => patchAudio({ samplerVol: v })}
          />

          <div className="deckcol col-b">
            <div className="wvstack">
              <ScrollWave
                deck="B"
                engine={engine}
                color={COLOR_B}
                cues={rt.B.cues}
                cuePoint={rt.B.cuePoint}
                loop={rt.B.loopStart != null && rt.B.loopEnd != null ? { start: rt.B.loopStart, end: rt.B.loopEnd } : null}
                loopIn={rt.B.loopIn}
                position={rt.B.position}
                duration={rt.B.duration}
                hasGrid={!!rt.B.bpm}
                onScratchStart={() => engine.scratchStart("B")}
                onScratchMove={(delta) => engine.scratchMove("B", delta)}
                onScratchEnd={() => engine.scratchEnd("B")}
                onGrid={(edit) => handleGrid("B", edit)}
              />
              <Waveform
                peaks={rt.B.peaks}
                bands={rt.B.bands}
                position={rt.B.position}
                duration={rt.B.duration}
                color={COLOR_B}
                cues={rt.B.cues}
                cuePoint={rt.B.cuePoint}
                loop={rt.B.loopStart != null && rt.B.loopEnd != null ? { start: rt.B.loopStart, end: rt.B.loopEnd } : null}
                onSeek={(s) => engine.seek("B", s)}
                height={14}
                showTimes={false}
              />
            </div>
            <Deck
              id="B"
              runtime={rt.B}
              loading={loadingDeck.B}
              pitch={synced.B ? rt.B.pitch : pitch.B}
              range={range.B}
              onRange={(dir) => handleRange("B", dir)}
              keyLock={keyLock.B}
              onKeyLock={() => handleKeyLock("B")}
              synced={synced.B}
              onSync={() => handleSync("B")}
              canSync={!!rt.B.bpm && !!rt.A.bpm}
              onLoop={(beats) => handleLoop("B", beats)}
              onLoopPad={(beats) => handleLoopPad("B", beats)}
              onLoopIn={() => engine.loopIn("B")}
              onLoopOut={() => engine.loopOut("B")}
              onAutoLoop={() => engine.autoLoop("B")}
              onLoopResize={(f) => engine.loopResize("B", f)}
              onLoopMove={(dir) => engine.loopMove("B", dir)}
              onReloop={() => engine.reloop("B")}
              onSlip={() => toggleSlip("B")}
              onRollStart={(beats) => handleRollStart("B", beats)}
              onRollEnd={() => handleRollEnd("B")}
              onSlice={handleSlice("B")}
              samples={samples}
              onSamplePlay={(i) => engine.playSample(i)}
              onSampleClear={(i) => engine.clearSample(i)}
              onSampleEdit={setSamplerEdit}
              onSampleDrop={(i, id) => void handleSampleDrop(i, id)}
              userPads={userPads.B}
              onUserPad={(i) => handleUserPad("B", i)}
              onUserPadEdit={(i) => setPadEdit({ deck: "B", slot: i })}
              stems={stems.B}
              onStems={(g) => handleStems("B", g)}
              onPitch={(v) => handlePitch("B", v)}
              onToggle={() => engine.toggle("B")}
              onCueDown={() => handleCueDown("B")}
              onCueUp={() => handleCueUp("B")}
              onSeek={(s) => engine.seek("B", s)}
              onHotCue={(i) => handleHotCue("B", i)}
              onHotCueClear={(i) => handleHotCueClear("B", i)}
              onDropTrack={(id) => {
                const track = tracks.find((t) => t.id === id);
                if (track) handleLoad(track, "B");
              }}
              scratch={vinyl.B}
              onScratchToggle={() => setVinyl((v) => ({ ...v, B: !v.B }))}
              onScratchStart={() => engine.scratchStart("B")}
              onScratchMove={(delta) => engine.scratchMove("B", delta)}
              onScratchEnd={() => engine.scratchEnd("B")}
              onBend={(b) => engine.setBend("B", b)}
            />
          </div>
        </div>

        <Browser
          tracks={tracks}
          folders={folders}
          playlists={playlists}
          history={history}
          sidelist={sidelist}
          source={source}
          onSource={setSource}
          compatCamelot={compatCamelot}
          compatBpm={compatBpm}
          compatDeck={compatDeck}
          compatTrackId={compatState?.trackId ?? null}
          onCreatePlaylist={handleCreatePlaylist}
          onCreatePlaylistWith={handleCreatePlaylistWith}
          onEditTrack={setEditing}
          transitions={transitions}
          onTransition={handleTransition}
          onUpdatePlaylist={handleUpdatePlaylist}
          onDeletePlaylist={handleDeletePlaylist}
          onAddToPlaylist={handleAddToPlaylist}
          onRemoveFromPlaylist={handleRemoveFromPlaylist}
          onSideAdd={handleSideAdd}
          onSideRemove={handleSideRemove}
          onSideMove={handleSideMove}
          onSideClear={handleSideClear}
          crossfade={crossfade}
          master={master}
          notify={notify}
          onAddFolder={handleAddFolder}
          onRemoveFolder={handleRemoveFolder}
          onToggleFavorite={handleToggleFavorite}
          query={query}
          onQuery={setQuery}
          onImport={handleImport}
          onLoad={handleLoad}
          busy={busy}
          scan={scan}
        />
        {notice ? (
          <div className="toast" role="status">
            {notice}
          </div>
        ) : null}
      </div>
      {settingsOpen ? (
        <Settings
          audio={settings.audio}
          shortcuts={settings.shortcuts}
          onAudioChange={patchAudio}
          onShortcutsChange={changeShortcuts}
          onClose={() => {
            midiLearn(null);
            setSettingsOpen(false);
            setSettingsTab(undefined);
          }}
          midi={
            <MidiPanel
              available={midiOk}
              devices={midiDevices}
              map={midiMap}
              learning={midiLearning}
              onLearn={midiLearn}
              onClear={midiClear}
              onClearAll={midiClearAll}
              scripts={midiScripts}
              onScriptsChange={(next) => {
                setMidiScripts(next);
                saveMidiScripts(next);
                // las asignaciones de scripts borrados se quitan
                for (const id of Object.keys(midiMap)) {
                  if (id.startsWith("script.") && !next.some((x) => `script.${x.id}` === id)) midiClear(id);
                }
              }}
              onTryScript={(script, deck) => runAction(script, deck)}
            />
          }
          library={<LibraryPanel onPull={handleSyncPull} trackCount={tracks.length} />}
          initialTab={settingsTab}
          dvs={
            <DvsPanel
              prefs={dvsPrefs}
              on={dvsOn}
              reading={dvsReading}
              onToggle={toggleDvs}
              onCalibrate={calibrateDvs}
              onPatch={patchDvs}
            />
          }
          streaming={
            <StreamingPanel
              prefs={streamPrefs}
              onChange={(patch) => {
                const next = { ...streamPrefs, ...patch };
                setStreamPrefs(next);
                saveStreamPrefs(next);
              }}
              status={streamStatus}
              requests={requests}
              onDismiss={dismissRequest}
              onSearch={(text) => {
                setQuery(text);
                setSource({ kind: "all" });
                setSettingsOpen(false);
              }}
            />
          }
          ui={
            <InterfacePanel
              ui={ui}
              onUi={patchUi}
              addons={addons}
              onInstall={handleInstallAddon}
              onRemove={(name) => {
                const next = addons.filter((a) => a.name !== name);
                setAddons(next);
                saveAddons(next);
              }}
              onExport={handleExportAddon}
            />
          }
        />
      ) : null}
      {panel === "video" ? (
        <VideoPanel
          mixer={video.mixer()}
          config={video.videoConfig}
          onConfig={video.setVideoConfig}
          texts={video.videoTexts}
          onTexts={video.setVideoTexts}
          image={video.videoImage}
          onImage={video.setVideoImage}
          screenOpen={video.screenOpen}
          onOpenScreen={() => void video.openScreen()}
          onCloseScreen={video.closeScreen}
          recording={video.videoRec}
          onRec={(f) => void video.toggleVideoRec(f)}
          rtmp={video.rtmp}
          onRtmp={(url, key, kbps) => void video.toggleRtmp(url, key, kbps)}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {panel === "karaoke" ? (
        <KaraokePanel
          enabled={karaoke}
          onEnabled={setKaraoke}
          tracks={tracks}
          playlists={playlists}
          singers={singers}
          current={currentSinger}
          onAdd={addSinger}
          onUpdate={updateSinger}
          onRemove={removeSinger}
          onMove={moveSinger}
          onNext={() => void nextSinger()}
          onCurrentKey={setCurrentKey}
          background={background}
          onBackground={setBackground}
          lyrics={lyrics}
          position={karaokePosition}
          onOpenVideo={() => setPanel("video")}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {padEdit ? (
        <PadEditor
          key={`${padEdit.deck}${padEdit.slot}`}
          deck={padEdit.deck}
          slot={padEdit.slot}
          pad={userPads[padEdit.deck][padEdit.slot]}
          onTry={(script) => runAction(script, padEdit.deck)}
          onReset={() => {
            const next = { ...userPads, [padEdit.deck]: userPads[padEdit.deck].map((p, i) => (i === padEdit.slot ? { ...DEFAULT_USER_PADS[i] } : p)) };
            setUserPads(next);
            saveUserPads(next);
            setPadEdit(null);
          }}
          onSave={(pad) => {
            const next = { ...userPads, [padEdit.deck]: userPads[padEdit.deck].map((p, i) => (i === padEdit.slot ? pad : p)) };
            setUserPads(next);
            saveUserPads(next);
          }}
          onClose={() => setPadEdit(null)}
        />
      ) : null}
      {samplerEdit != null && samples[samplerEdit] && engine.sampleInfo(samplerEdit) ? (
        <SamplerEditor
          slot={samplerEdit}
          info={samples[samplerEdit]!}
          wave={engine.sampleInfo(samplerEdit)!}
          onChange={(patch) => engine.updateSampleSlot(samplerEdit, patch)}
          onPreview={() => engine.playSample(samplerEdit)}
          onClose={() => setSamplerEdit(null)}
        />
      ) : null}
      {editing ? (
        <TrackEditor
          key={editing.id}
          track={tracks.find((t) => t.id === editing.id) ?? editing}
          onSave={(edit, fileTags) => handleTrackSave(editing.id, edit, fileTags)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
