import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_DEFS,
  comboFromEvent,
  formatCombo,
  type AudioPrefs,
  type ShortcutId,
} from "../settings";

interface SettingsProps {
  audio: AudioPrefs;
  shortcuts: Record<ShortcutId, string>;
  onAudioChange: (patch: Partial<AudioPrefs>) => void;
  onShortcutsChange: (shortcuts: Record<ShortcutId, string>) => void;
  onClose: () => void;
  /** contenido de la pestaña de controladores MIDI */
  midi: ReactNode;
  /** contenido de la pestaña de biblioteca (sincronización) */
  library?: ReactNode;
  /** idioma, skin, visual de la cabina y addons */
  ui?: ReactNode;
  /** Icecast, red local y pedidos */
  streaming?: ReactNode;
  /** DVS con timecode */
  dvs?: ReactNode;
  /** pestaña con la que se abre */
  initialTab?: string;
}

type Tab = "audio" | "shortcuts" | "midi" | "library" | "ui" | "streaming" | "dvs";

const TABS: { id: Tab; label: string }[] = [
  { id: "audio", label: "Audio" },
  { id: "shortcuts", label: "Atajos de teclado" },
  { id: "midi", label: "Controladores MIDI" },
  { id: "library", label: "Biblioteca" },
  { id: "streaming", label: "Streaming" },
  { id: "dvs", label: "DVS" },
  { id: "ui", label: "Interfaz" },
];

function deviceName(device: MediaDeviceInfo, index: number): string {
  if (device.label) return device.label;
  return device.kind === "audioinput" ? `Entrada ${index + 1}` : `Salida ${index + 1}`;
}

export function Settings({
  audio,
  shortcuts,
  onAudioChange,
  onShortcutsChange,
  onClose,
  midi,
  library,
  ui,
  streaming,
  dvs,
  initialTab,
}: SettingsProps) {
  const [tab, setTab] = useState<Tab>(() => (TABS.some((t) => t.id === initialTab) ? (initialTab as Tab) : "audio"));
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [capturing, setCapturing] = useState<ShortcutId | null>(null);
  const [micActive, setMicActive] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);

  const micCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micRafRef = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const outputsSupported = useMemo(
    () => typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype,
    [],
  );

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setDeviceError("Este entorno no permite listar dispositivos de audio.");
      return;
    }
    setLoadingDevices(true);
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === "audioinput" || d.kind === "audiooutput"));
      setDeviceError(null);
    } catch {
      setDeviceError("No se pudieron leer los dispositivos de audio.");
    } finally {
      setLoadingDevices(false);
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    const media = navigator.mediaDevices;
    if (!media) return;
    const onChange = () => void refreshDevices();
    media.addEventListener("devicechange", onChange);
    return () => media.removeEventListener("devicechange", onChange);
  }, [refreshDevices]);

  const stopMic = useCallback(() => {
    if (micRafRef.current != null) cancelAnimationFrame(micRafRef.current);
    micRafRef.current = null;
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    if (micCtxRef.current) {
      void micCtxRef.current.close().catch(() => undefined);
      micCtxRef.current = null;
    }
    setMicActive(false);
    setMicLevel(0);
    setMicError(null);
  }, []);

  useEffect(() => () => stopMic(), [stopMic]);

  // Al abrir, el foco va al modal: así los atajos no quedan atrapados en
  // el botón de la tuerca y Escape siempre puede cerrar.
  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  const requestPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      await refreshDevices();
      setDeviceError(null);
    } catch {
      setDeviceError("No se concedió permiso para usar el micrófono. Los nombres pueden quedar ocultos.");
    }
  }, [refreshDevices]);

  const toggleMicTest = useCallback(async () => {
    if (micActive) {
      stopMic();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError("Este entorno no permite abrir la entrada de audio.");
      return;
    }
    setMicError(null);
    try {
      const constraints: MediaStreamConstraints = {
        audio: audio.inputId ? { deviceId: { exact: audio.inputId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor({ latencyHint: "interactive" });
      await ctx.resume();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      micStreamRef.current = stream;
      micCtxRef.current = ctx;
      setMicActive(true);

      const data = new Float32Array(analyser.fftSize);
      const tick = () => {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        setMicLevel(Math.min(1, Math.sqrt(sum / data.length) * 3.2));
        micRafRef.current = requestAnimationFrame(tick);
      };
      tick();
      await refreshDevices();
    } catch {
      stopMic();
      setMicError("No se pudo abrir la entrada seleccionada.");
    }
  }, [audio.inputId, micActive, refreshDevices, stopMic]);

  const assignShortcut = useCallback(
    (id: ShortcutId, combo: string) => {
      const next = { ...shortcuts };
      for (const key of Object.keys(next) as ShortcutId[]) {
        if (key !== id && next[key] === combo) next[key] = "";
      }
      next[id] = combo;
      onShortcutsChange(next);
    },
    [onShortcutsChange, shortcuts],
  );

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(null);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return;
      assignShortcut(capturing, combo);
      setCapturing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [assignShortcut, capturing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !capturing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capturing, onClose]);

  const inputs = devices.filter((d) => d.kind === "audioinput");
  const outputs = devices.filter((d) => d.kind === "audiooutput");
  const labelsHidden = devices.length > 0 && devices.every((d) => !d.label);

  const deviceOptions = (list: MediaDeviceInfo[], kind: "audioinput" | "audiooutput", current: string) => {
    const options = [
      <option value="" key="__default">
        Predeterminado del sistema
      </option>,
      ...list.map((device, index) => (
        <option value={device.deviceId} key={device.deviceId || `${kind}-${index}`}>
          {deviceName(device, index)}
        </option>
      )),
    ];
    if (current && !list.some((device) => device.deviceId === current)) {
      options.push(
        <option value={current} key="__saved">
          Guardado (no disponible)
        </option>,
      );
    }
    return options;
  };

  const groups = Array.from(new Set(SHORTCUT_DEFS.map((def) => def.group)));

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        ref={cardRef}
        className="settings-card"
        role="dialog"
        aria-modal="true"
        aria-label="Ajustes generales"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="settings-head">
          <div>
            <h2>Ajustes generales</h2>
            <p>Dispositivos, monitoreo y atajos de BROSS DJ</p>
          </div>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Cerrar ajustes">
            ✕
          </button>
        </header>

        <nav className="settings-tabs" role="tablist" aria-label="Secciones de ajustes">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`settings-tab${tab === item.id ? " on" : ""}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="settings-body">
          {tab === "audio" ? (
            <section className="settings-section" aria-label="Dispositivos de audio">
              <div className="settings-row">
                <div className="settings-label">
                  <b>Salida general (master)</b>
                  <span>Altavoces o interfaz principal de la mezcla.</span>
                </div>
                <select
                  value={audio.masterId}
                  onChange={(e) => onAudioChange({ masterId: e.target.value })}
                  aria-label="Salida general de audio"
                >
                  {deviceOptions(outputs, "audiooutput", audio.masterId)}
                </select>
              </div>

              <div className="settings-row">
                <div className="settings-label">
                  <b>Salida de auriculares (CUE)</b>
                  <span>Salida aparte para monitorear. Activá CUE en el canal A o B.</span>
                </div>
                <select
                  value={audio.cueId}
                  onChange={(e) => onAudioChange({ cueId: e.target.value })}
                  aria-label="Salida de auriculares"
                >
                  {deviceOptions(outputs, "audiooutput", audio.cueId)}
                </select>
              </div>

              <div className="settings-row">
                <div className="settings-label">
                  <b>Curva del crossfader</b>
                  <span>En el centro los dos decks suenan a pleno; al correrlo baja el del otro lado. Mezcla: baja suave · Lineal: baja en línea recta · Corte: para scratch.</span>
                </div>
                <select
                  value={audio.xfCurve}
                  onChange={(e) => onAudioChange({ xfCurve: e.target.value as AudioPrefs["xfCurve"] })}
                  aria-label="Curva del crossfader"
                >
                  <option value="mix">Mezcla (club)</option>
                  <option value="smooth">Lineal</option>
                  <option value="cut">Corte (scratch)</option>
                </select>
              </div>

              <div className="settings-row">
                <div className="settings-label">
                  <b>Automix: largo de la transición</b>
                  <span>Cuántos beats dura el cruce entre un tema y el siguiente de la sidelist.</span>
                </div>
                <select
                  value={audio.automixBeats}
                  onChange={(e) => onAudioChange({ automixBeats: Number(e.target.value) })}
                  aria-label="Largo de la transición del automix"
                >
                  <option value={8}>8 beats (2 compases)</option>
                  <option value={16}>16 beats (4 compases)</option>
                  <option value={32}>32 beats (8 compases)</option>
                  <option value={64}>64 beats (16 compases)</option>
                </select>
              </div>

              <div className="settings-row">
                <div className="settings-label">
                  <b>Tipo de transición del automix</b>
                  <span>Inteligente elige según BPM, tono y la frase de cada pista.</span>
                </div>
                <select
                  value={audio.automixStyle}
                  onChange={(e) => onAudioChange({ automixStyle: e.target.value as AudioPrefs["automixStyle"] })}
                  aria-label="Tipo de transición del automix"
                >
                  <option value="smart">Inteligente</option>
                  <option value="blend">Fundido</option>
                  <option value="bassSwap">Cambio de bajos</option>
                  <option value="filter">Filtro (barrido)</option>
                  <option value="echo">Salida con eco</option>
                  <option value="cut">Corte al beat</option>
                </select>
              </div>

              <div className="settings-row">
                <div className="settings-label">
                  <b>Formato de grabación</b>
                  <span>WAV y FLAC sin pérdida (FLAC ocupa ~la mitad) · MP3 y OGG (Opus) comprimidos a 192 kbps.</span>
                </div>
                <select
                  value={audio.recFormat}
                  onChange={(e) => onAudioChange({ recFormat: e.target.value as AudioPrefs["recFormat"] })}
                  aria-label="Formato de grabación"
                >
                  <option value="wav">WAV</option>
                  <option value="flac">FLAC</option>
                  <option value="mp3">MP3</option>
                  <option value="ogg">OGG (Opus)</option>
                </select>
              </div>

              <div className="settings-row">
                <div className="settings-label">
                  <b>Qué se graba</b>
                  <span>
                    Sonido del sistema graba todo lo que suena en la PC (incluye el deck de YouTube); usa la captura de
                    Windows.
                  </span>
                </div>
                <select
                  value={audio.recSource}
                  onChange={(e) => onAudioChange({ recSource: e.target.value as AudioPrefs["recSource"] })}
                  aria-label="Fuente de la grabación"
                >
                  <option value="master">Master</option>
                  <option value="master+input">Master + micrófono / línea</option>
                  <option value="system">Sonido del sistema</option>
                </select>
              </div>

              {audio.recSource === "master+input" ? (
                <div className="settings-row">
                  <div className="settings-label">
                    <b>Volumen de la entrada en la grabación</b>
                    <span>La entrada es la que elegiste arriba (micrófono / línea).</span>
                  </div>
                  <div className="settings-range">
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.05}
                      value={audio.recInputGain}
                      onChange={(e) => onAudioChange({ recInputGain: Number(e.target.value) })}
                      aria-label="Volumen de la entrada en la grabación"
                    />
                    <b>{Math.round(audio.recInputGain * 100)}%</b>
                  </div>
                </div>
              ) : null}

              <div className="settings-row">
                <div className="settings-label">
                  <b>Escuchar la entrada de línea por el master</b>
                  <span>Para mezclar bandejas u otra consola con el botón LINE IN de la barra (que además lee su BPM).</span>
                </div>
                <input
                  type="checkbox"
                  checked={audio.lineInMonitor}
                  onChange={(e) => onAudioChange({ lineInMonitor: e.target.checked })}
                  aria-label="Escuchar la entrada de línea por el master"
                />
              </div>

              <div className="settings-row">
                <div className="settings-label">
                  <b>Dividir la grabación por tema</b>
                  <span>Además del set completo, una carpeta con un archivo por pista.</span>
                </div>
                <input
                  type="checkbox"
                  checked={audio.recSplit}
                  onChange={(e) => onAudioChange({ recSplit: e.target.checked })}
                  aria-label="Dividir la grabación por tema"
                />
              </div>

              <div className="settings-row">
                <div className="settings-label">
                  <b>Curva de los faders</b>
                  <span>Lineal · Logarítmica: sube suave al principio · Rápida: llega arriba antes.</span>
                </div>
                <select
                  value={audio.faderCurve}
                  onChange={(e) => onAudioChange({ faderCurve: e.target.value as AudioPrefs["faderCurve"] })}
                  aria-label="Curva de los faders de canal"
                >
                  <option value="linear">Lineal</option>
                  <option value="log">Logarítmica</option>
                  <option value="fast">Rápida</option>
                </select>
              </div>

              <div className="settings-row">
                <div className="settings-label">
                  <b>Volumen de auriculares</b>
                  <span>Nivel independiente del master.</span>
                </div>
                <div className="settings-range">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={audio.cueLevel}
                    onChange={(e) => onAudioChange({ cueLevel: Number(e.target.value) })}
                    aria-label="Volumen de auriculares"
                  />
                  <b>{Math.round(audio.cueLevel * 100)}%</b>
                </div>
              </div>

              {audio.masterId === audio.cueId ? (
                <p className="settings-warn">
                  Master y CUE están en la misma salida. Con esta configuración el CUE se escucha por los
                  parlantes y Sandbox equivale a silenciar el deck. Elegí una salida distinta para auriculares.
                </p>
              ) : null}

              <div className="settings-row">
                <div className="settings-label">
                  <b>Entrada de audio</b>
                  <span>Micrófono o línea para grabar y monitorear.</span>
                </div>
                <select
                  value={audio.inputId}
                  onChange={(e) => {
                    stopMic();
                    onAudioChange({ inputId: e.target.value });
                  }}
                  aria-label="Entrada de audio"
                >
                  {deviceOptions(inputs, "audioinput", audio.inputId)}
                </select>
              </div>

              <div className="settings-inline">
                <button type="button" className="settings-btn" onClick={() => void refreshDevices()} disabled={loadingDevices}>
                  {loadingDevices ? "Buscando…" : "Actualizar dispositivos"}
                </button>
                {labelsHidden ? (
                  <button type="button" className="settings-btn" onClick={() => void requestPermission()}>
                    Habilitar nombres
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`settings-btn${micActive ? " on" : ""}`}
                  onClick={() => void toggleMicTest()}
                >
                  {micActive ? "Detener prueba" : "Probar entrada"}
                </button>
                {micActive ? (
                  <div className="mic-meter" aria-label={`Nivel de entrada ${Math.round(micLevel * 100)}%`}>
                    <i style={{ width: `${Math.round(micLevel * 100)}%` }} />
                  </div>
                ) : null}
              </div>

              {micError ? <p className="settings-error">{micError}</p> : null}
              {deviceError ? <p className="settings-error">{deviceError}</p> : null}
              {!outputsSupported ? (
                <p className="settings-note">
                  Este navegador no permite elegir salidas físicas por separado. En la app de escritorio
                  (Electron/Chromium) sí está disponible.
                </p>
              ) : (
                <p className="settings-note">
                  Los ajustes se guardan automáticamente. Si usás dos placas distintas, elegí una para
                  master y otra para auriculares.
                </p>
              )}
            </section>
          ) : tab === "midi" ? (
            <section className="settings-section" aria-label="Controladores MIDI">
              {midi}
            </section>
          ) : tab === "library" ? (
            <section className="settings-section" aria-label="Biblioteca">
              {library}
            </section>
          ) : tab === "streaming" ? (
            <section className="settings-section" aria-label="Streaming">
              {streaming}
            </section>
          ) : tab === "dvs" ? (
            <section className="settings-section" aria-label="DVS">
              {dvs}
            </section>
          ) : tab === "ui" ? (
            <section className="settings-section" aria-label="Interfaz">
              {ui}
            </section>
          ) : (
            <section className="settings-section" aria-label="Atajos de teclado">
              <p className="settings-intro">
                Hacé clic en un atajo y presioná la combinación nueva. Se guarda al instante.
              </p>
              <div className="shortcut-groups">
                {groups.map((group) => (
                  <div className="shortcut-group" key={group}>
                    <h3>{group}</h3>
                    {SHORTCUT_DEFS.filter((def) => def.group === group).map((def) => (
                      <div className="shortcut-row" key={def.id}>
                        <span>{def.label}</span>
                        <button
                          type="button"
                          className={`shortcut-key${capturing === def.id ? " capturing" : ""}${
                            shortcuts[def.id] ? "" : " empty"
                          }`}
                          onClick={() => setCapturing(def.id)}
                          onDoubleClick={() => {
                            setCapturing(null);
                            const next = { ...shortcuts, [def.id]: "" };
                            onShortcutsChange(next);
                          }}
                          title="Clic para asignar · doble clic para borrar"
                        >
                          {capturing === def.id ? "Presioná una tecla…" : formatCombo(shortcuts[def.id])}
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="settings-inline shortcut-actions">
                <button
                  type="button"
                  className="settings-btn"
                  onClick={() => onShortcutsChange({ ...DEFAULT_SHORTCUTS })}
                >
                  Restablecer predeterminados
                </button>
                <span className="settings-note">
                  Escape cancela la captura. Si repetís una combinación, se quita del atajo anterior.
                </span>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
