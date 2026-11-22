import { useState } from "react";
import { MIDI_ACTIONS, bindingLabel, type MidiMap } from "../midi";
import { SCRIPT_HELP, tryParseScript } from "../actionScript";
import type { MidiScript } from "../userActions";

interface MidiPanelProps {
  available: boolean;
  devices: string[];
  map: MidiMap;
  learning: string | null;
  onLearn: (action: string | null) => void;
  onClear: (action: string) => void;
  onClearAll: () => void;
  scripts: MidiScript[];
  onScriptsChange: (s: MidiScript[]) => void;
  onTryScript: (script: string, deck: "A" | "B") => void;
}

/** Pestaña de Ajustes: dispositivos conectados y asignación por aprendizaje. */
export function MidiPanel({
  available,
  devices,
  map,
  learning,
  onLearn,
  onClear,
  onClearAll,
  scripts,
  onScriptsChange,
  onTryScript,
}: MidiPanelProps) {
  const [draft, setDraft] = useState<MidiScript | null>(null);
  const draftState = draft ? tryParseScript(draft.script) : null;
  const groups = Array.from(new Set(MIDI_ACTIONS.map((a) => a.group)));
  const assigned = Object.keys(map).length;
  return (
    <>
      <p className="settings-intro">
        {available
          ? devices.length
            ? `Conectado: ${devices.join(", ")}. Tocá "Aprender" en una acción y mové el control del equipo.`
            : "No hay controladores conectados. Enchufá uno por USB: aparece solo."
          : "Este equipo no permite usar MIDI."}
        {assigned ? ` · ${assigned} controles asignados.` : ""}
      </p>
      {assigned ? (
        <button
          type="button"
          className="settings-btn"
          onClick={() => {
            if (window.confirm("¿Borrar todas las asignaciones MIDI?")) onClearAll();
          }}
        >
          Borrar todas las asignaciones
        </button>
      ) : null}
      <div className="shortcut-group midi-scripts">
        <h3>Acciones con script</h3>
        <p className="settings-note">
          Un control puede correr varias acciones con condiciones, por ejemplo{" "}
          <code>deck.playing ? deck.cue : deck.play</code> o <code>shift ? deck.hot 2 : deck.hot 1</code>.
        </p>
        {scripts.map((s) => {
          const id = `script.${s.id}`;
          const b = map[id];
          const isLearning = learning === id;
          return (
            <div className="shortcut-row" key={s.id}>
              <span title={s.script}>
                {s.name} <em className="midikind"> · deck {s.deck} · {s.script}</em>
              </span>
              <span className="midi-bind">
                <button
                  type="button"
                  className={`shortcut-key${isLearning ? " capturing" : ""}${b ? "" : " empty"}`}
                  onClick={() => onLearn(isLearning ? null : id)}
                  disabled={!available}
                >
                  {isLearning ? "Mové un control…" : bindingLabel(b)}
                </button>
                <button type="button" className="midi-clear" onClick={() => setDraft({ ...s })} title="Editar">
                  ✎
                </button>
                <button
                  type="button"
                  className="midi-clear"
                  onClick={() => onScriptsChange(scripts.filter((x) => x.id !== s.id))}
                  title="Borrar"
                >
                  ✕
                </button>
              </span>
            </div>
          );
        })}
        {draft ? (
          <div className="midi-draft">
            <div className="te-grid">
              <label className="te-field">
                <span>Nombre</span>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <label className="te-field">
                <span>"deck" es el</span>
                <select value={draft.deck} onChange={(e) => setDraft({ ...draft, deck: e.target.value as "A" | "B" })}>
                  <option value="A">Deck A</option>
                  <option value="B">Deck B</option>
                </select>
              </label>
            </div>
            <label className="te-field pe-script">
              <span>Script</span>
              <textarea
                rows={2}
                spellCheck={false}
                className={`mono${draftState?.error ? " bad" : ""}`}
                value={draft.script}
                onChange={(e) => setDraft({ ...draft, script: e.target.value })}
              />
            </label>
            <p className={draftState?.error ? "settings-error" : "settings-note"}>{draftState?.error ?? "Script válido."}</p>
            <pre className="pe-help">{SCRIPT_HELP}</pre>
            <div className="settings-inline">
              <button type="button" className="settings-btn" onClick={() => setDraft(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="settings-btn"
                disabled={!!draftState?.error}
                onClick={() => onTryScript(draft.script, draft.deck)}
              >
                Probar
              </button>
              <button
                type="button"
                className="settings-btn primary"
                disabled={!!draftState?.error || !draft.name.trim()}
                onClick={() => {
                  const exists = scripts.some((x) => x.id === draft.id);
                  onScriptsChange(exists ? scripts.map((x) => (x.id === draft.id ? draft : x)) : [...scripts, draft]);
                  setDraft(null);
                }}
              >
                Guardar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="settings-btn"
            onClick={() => setDraft({ id: crypto.randomUUID().slice(0, 8), name: "Mi acción", script: "deck.sync ; deck.play", deck: "A" })}
          >
            + Nueva acción con script
          </button>
        )}
      </div>
      <div className="shortcut-groups">
        {groups.map((group) => (
          <div className="shortcut-group" key={group}>
            <h3>{group}</h3>
            {MIDI_ACTIONS.filter((a) => a.group === group).map((a) => {
              const b = map[a.id];
              const isLearning = learning === a.id;
              return (
                <div className="shortcut-row" key={a.id}>
                  <span>
                    {a.label}
                    {a.kind !== "button" ? <em className="midikind">{a.kind === "absolute" ? " · perilla/fader" : " · rueda"}</em> : null}
                  </span>
                  <span className="midi-bind">
                    <button
                      type="button"
                      className={`shortcut-key${isLearning ? " capturing" : ""}${b ? "" : " empty"}`}
                      onClick={() => onLearn(isLearning ? null : a.id)}
                      title={isLearning ? "Mové un control del equipo (clic para cancelar)" : "Aprender: después mové el control"}
                      disabled={!available}
                    >
                      {isLearning ? "Mové un control…" : bindingLabel(b)}
                    </button>
                    {b ? (
                      <button type="button" className="midi-clear" onClick={() => onClear(a.id)} title="Quitar asignación">
                        ✕
                      </button>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}
