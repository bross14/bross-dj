import { useEffect, useState } from "react";
import { SCRIPT_HELP, tryParseScript } from "../actionScript";
import { USER_PAD_COLORS, type UserPad } from "../userActions";

interface PadEditorProps {
  deck: "A" | "B";
  slot: number;
  pad: UserPad;
  onSave: (pad: UserPad) => void;
  /** prueba el script sin guardarlo */
  onTry: (script: string) => void;
  onReset: () => void;
  onClose: () => void;
}

/** Editor de un pad de usuario: nombre, color y script de acciones. */
export function PadEditor({ deck, slot, pad, onSave, onTry, onReset, onClose }: PadEditorProps) {
  const [label, setLabel] = useState(pad.label);
  const [script, setScript] = useState(pad.script);
  const [color, setColor] = useState(pad.color);
  const parsed = tryParseScript(script);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-card track-editor" role="dialog" aria-modal="true" aria-label="Editor de pad" onClick={(e) => e.stopPropagation()}>
        <header className="settings-head">
          <div>
            <h2>
              Pad {slot + 1} · Deck {deck}
            </h2>
            <p>Página USER: cada pad corre un script de acciones.</p>
          </div>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Cerrar editor">
            ✕
          </button>
        </header>
        <div className="settings-body">
          <section className="settings-section">
            <div className="te-grid">
              <label className="te-field">
                <span>Nombre</span>
                <input value={label} maxLength={12} onChange={(e) => setLabel(e.target.value)} />
              </label>
              <div className="te-field">
                <span>Color</span>
                <div className="pe-colors">
                  {USER_PAD_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`pe-color${c === color ? " on" : ""}`}
                      style={{ background: c }}
                      onClick={() => setColor(c)}
                      aria-label={`Color ${c}`}
                    />
                  ))}
                </div>
              </div>
            </div>
            <label className="te-field pe-script">
              <span>Script</span>
              <textarea
                value={script}
                spellCheck={false}
                rows={3}
                className={`mono${parsed.error ? " bad" : ""}`}
                onChange={(e) => setScript(e.target.value)}
              />
            </label>
            <p className={parsed.error ? "settings-error" : "settings-note"}>{parsed.error ?? "Script válido."}</p>
            <pre className="pe-help">{SCRIPT_HELP}</pre>
            <div className="settings-inline te-actions">
              <button type="button" className="settings-btn" onClick={onReset}>
                De fábrica
              </button>
              <button type="button" className="settings-btn" disabled={!!parsed.error} onClick={() => onTry(script)}>
                Probar
              </button>
              <button
                type="button"
                className="settings-btn primary"
                disabled={!!parsed.error}
                onClick={() => {
                  onSave({ label: label.trim() || `PAD ${slot + 1}`, script, color });
                  onClose();
                }}
              >
                Guardar
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
