import { useCallback, useEffect, useRef, useState } from "react";
import { MidiController, loadMidiMap, saveMidiMap, type MidiEvent, type MidiMap } from "../midi";

/** Conexión MIDI, mapa de controles y modo aprendizaje. */
export function useMidiController() {
  // ── controladores MIDI ──────────────────────────────────────────────
  const midiRef = useRef<MidiController | null>(null);
  if (!midiRef.current) midiRef.current = new MidiController(loadMidiMap());
  const [midiOk, setMidiOk] = useState(false);
  const [midiDevices, setMidiDevices] = useState<string[]>([]);
  const [midiMap, setMidiMap] = useState<MidiMap>(() => midiRef.current!.getMap());
  const [midiLearning, setMidiLearning] = useState<string | null>(null);
  const midiActions = useRef<(e: MidiEvent) => void>(() => undefined);
  const jogState = useRef({
    A: { touch: false, acc: 0, bendTimer: 0 },
    B: { touch: false, acc: 0, bendTimer: 0 },
  });

  useEffect(() => {
    const midi = midiRef.current!;
    midi.onEvent = (e) => midiActions.current(e);
    midi.onDevices = setMidiDevices;
    void midi.start().then(setMidiOk);
  }, []);

  const midiLearn = useCallback((action: string | null) => {
    setMidiLearning(action);
    midiRef.current!.learn(action, () => {
      const map = midiRef.current!.getMap();
      setMidiMap(map);
      saveMidiMap(map);
      setMidiLearning(null);
    });
  }, []);

  const midiClear = useCallback((action: string) => {
    const map = midiRef.current!.getMap();
    delete map[action];
    midiRef.current!.setMap(map);
    setMidiMap(map);
    saveMidiMap(map);
  }, []);

  /** reemplaza el mapa entero (addons) */
  const midiLoadMap = useCallback((map: MidiMap) => {
    midiRef.current!.setMap(map);
    setMidiMap(map);
    saveMidiMap(map);
  }, []);

  const midiClearAll = useCallback(() => {
    midiRef.current!.setMap({});
    setMidiMap({});
    saveMidiMap({});
  }, []);

  return { midiRef, midiOk, midiDevices, midiMap, midiLearning, midiActions, jogState, midiLearn, midiClear, midiClearAll, midiLoadMap };
}
