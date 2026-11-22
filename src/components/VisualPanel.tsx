import { VISUALS, type Visual } from "../skins";

interface VisualPanelProps {
  value: Visual;
  onChange: (visual: Visual) => void;
}

/** Pestaña de Ajustes: elección de la visual (estilo) de la cabina. */
export function VisualPanel({ value, onChange }: VisualPanelProps) {
  return (
    <>
      <div className="settings-label visual-intro">
        <b>Visual de la cabina</b>
        <span>Elegí el estilo de la cabina. Se aplica al instante y no cambia el skin.</span>
      </div>
      <div className="visual-grid" role="radiogroup" aria-label="Visual de la cabina">
        {VISUALS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={value === v.id}
            className={`visual-card${value === v.id ? " on" : ""}`}
            onClick={() => onChange(v.id)}
          >
            <span className={`visual-thumb vt-${v.id}`} aria-hidden>
              <span className="vt-deck a">
                <i className="vt-jog" />
                <i className="vt-pads" />
              </span>
              <span className="vt-mix" />
              <span className="vt-deck b">
                <i className="vt-pads" />
                <i className="vt-jog" />
              </span>
              <span className="vt-lib" />
            </span>
            <span className="visual-name">
              {v.name}
              {value === v.id ? <em>En uso</em> : null}
            </span>
            <span className="visual-desc">{v.desc}</span>
          </button>
        ))}
      </div>
    </>
  );
}
