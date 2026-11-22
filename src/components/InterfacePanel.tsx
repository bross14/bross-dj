import { useRef, useState } from "react";
import { AddonError, allSkins, parsePackage, type Addon, type UiPrefs } from "../skins";
import { VisualPanel } from "./VisualPanel";

interface InterfacePanelProps {
  ui: UiPrefs;
  onUi: (patch: Partial<UiPrefs>) => void;
  addons: Addon[];
  /** instala el addon (aplica pads, scripts, mapa MIDI y filtros que traiga) */
  onInstall: (addon: Addon) => string;
  onRemove: (name: string) => void;
  /** arma un addon con la configuración actual y lo descarga */
  onExport: () => void;
}

/** Pestaña de Ajustes: idioma, skin, visual de la cabina y addons. */
export function InterfacePanel({ ui, onUi, addons, onInstall, onRemove, onExport }: InterfacePanelProps) {
  const file = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const skins = allSkins(addons);

  return (
    <>
      <div className="settings-row">
        <div className="settings-label">
          <b>Idioma</b>
          <span>Español o inglés. Lo que es tuyo (pistas, carpetas, listas) no se traduce.</span>
        </div>
        <select value={ui.lang} onChange={(e) => onUi({ lang: e.target.value as UiPrefs["lang"] })} aria-label="Idioma">
          <option value="es">Español</option>
          <option value="en">English</option>
        </select>
      </div>

      <div className="settings-row">
        <div className="settings-label">
          <b>Skin</b>
          <span>Colores de la cabina. Se pueden instalar más desde un archivo .json.</span>
        </div>
        <select value={ui.skin} onChange={(e) => onUi({ skin: e.target.value })} aria-label="Skin">
          {skins.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="visual-block">
        <VisualPanel value={ui.visual} onChange={(visual) => onUi({ visual })} />
      </div>

      <div className="shortcut-group">
        <h3>Addons</h3>
        <p className="settings-note">
          Un addon es un archivo <code>.json</code> con skins, pads de usuario, acciones MIDI con script, asignaciones MIDI y
          carpetas filtro. Son datos (no se ejecuta código). Exportá tu configuración para llevarla a otra PC o compartirla.
        </p>
        {addons.length ? (
          addons.map((a) => (
            <div className="shortcut-row" key={a.name}>
              <span>
                {a.name}
                {a.version ? <em className="midikind"> · v{a.version}</em> : null}
                <em className="midikind">
                  {" "}
                  ·{" "}
                  {[
                    a.skins?.length ? `${a.skins.length} skin` : null,
                    a.pads ? "pads" : null,
                    a.midiScripts?.length ? `${a.midiScripts.length} acciones MIDI` : null,
                    a.midiMap ? "mapa MIDI" : null,
                    a.filters?.length ? `${a.filters.length} filtros` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </em>
              </span>
              <button type="button" className="midi-clear" onClick={() => onRemove(a.name)} title="Quitar (sus skins dejan de estar)">
                ✕
              </button>
            </div>
          ))
        ) : (
          <p className="settings-note">No hay addons instalados.</p>
        )}
        <div className="settings-inline">
          <button type="button" className="settings-btn" onClick={() => file.current?.click()}>
            Instalar skin o addon…
          </button>
          <button type="button" className="settings-btn" onClick={onExport}>
            Exportar mi configuración
          </button>
          <input
            ref={file}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                if (f.size > 2_000_000) throw new AddonError("El archivo es demasiado grande (máx. 2 MB)");
                const addon = parsePackage(await f.text());
                setStatus(onInstall(addon));
              } catch (err) {
                setStatus(err instanceof Error ? err.message : String(err));
              }
            }}
          />
        </div>
        {status ? <p className="settings-note">{status}</p> : null}
      </div>
    </>
  );
}
