import type { SongRequest, StreamStatus } from "../library";
import type { StreamPrefs } from "../hooks/useStreaming";

interface StreamingPanelProps {
  prefs: StreamPrefs;
  onChange: (patch: Partial<StreamPrefs>) => void;
  status: StreamStatus;
  requests: SongRequest[];
  onDismiss: (id: string) => void;
  onSearch: (text: string) => void;
}

const ICE_STATE: Record<StreamStatus["icecast"], string> = {
  off: "apagado",
  connecting: "conectando…",
  on: "transmitiendo",
  error: "error",
};

/** Pestaña de Ajustes: Icecast, servidor en la red local y pedidos. */
export function StreamingPanel({ prefs, onChange, status, requests, onDismiss, onSearch }: StreamingPanelProps) {
  const disabled = status.live;
  const input = (key: keyof StreamPrefs, label: string, opts: { type?: string; placeholder?: string; mono?: boolean } = {}) => (
    <label className="te-field">
      <span>{label}</span>
      <input
        type={opts.type ?? "text"}
        className={opts.mono ? "mono" : ""}
        value={String(prefs[key])}
        placeholder={opts.placeholder}
        disabled={disabled}
        onChange={(e) => onChange({ [key]: opts.type === "number" ? Number(e.target.value) : e.target.value } as Partial<StreamPrefs>)}
      />
    </label>
  );
  return (
    <>
      <p className="settings-intro">
        El botón <b>LIVE</b> de la barra transmite el master en MP3. Podés mandarlo a un servidor Icecast (radio online) y/o
        abrir un servidor en tu red local para escuchar desde otra PC o el celular, con una página para pedir temas.
        {disabled ? " Cortá la transmisión para cambiar los datos." : ""}
      </p>
      <div className="settings-row">
        <div className="settings-label">
          <b>Estado</b>
          <span>
            {status.live
              ? `En vivo · Icecast ${ICE_STATE[status.icecast]} · ${status.listeners} oyentes en la red local`
              : "Sin transmitir"}
            {status.error ? ` · ${status.error}` : ""}
          </span>
        </div>
        {status.lan ? (
          <span className="settings-value mono">
            {(status.lan.addresses.length ? status.lan.addresses : ["localhost"]).map((a) => `http://${a}:${status.lan!.port}`).join("  ")}
          </span>
        ) : null}
      </div>
      <div className="te-grid">
        {input("name", "Nombre de la transmisión")}
        <label className="te-field">
          <span>Calidad MP3</span>
          <select value={prefs.kbps} disabled={disabled} onChange={(e) => onChange({ kbps: Number(e.target.value) })}>
            {[96, 128, 160, 192, 256, 320].map((k) => (
              <option key={k} value={k}>
                {k} kbps
              </option>
            ))}
          </select>
        </label>
      </div>

      <h3 className="te-h">Icecast</h3>
      <label className="te-check">
        <input type="checkbox" checked={prefs.icecastOn} disabled={disabled} onChange={(e) => onChange({ icecastOn: e.target.checked })} />
        Transmitir a un servidor Icecast
      </label>
      {prefs.icecastOn ? (
        <div className="te-grid">
          {input("url", "Servidor", { placeholder: "http://mi-radio.com:8000", mono: true })}
          {input("mount", "Punto de montaje", { placeholder: "/live", mono: true })}
          {input("user", "Usuario", { mono: true })}
          {input("password", "Contraseña de source", { type: "password" })}
        </div>
      ) : null}
      {prefs.icecastOn ? (
        <p className="settings-note">La contraseña se guarda solo en esta PC. El título de cada tema se manda en vivo.</p>
      ) : null}

      <h3 className="te-h">Red local</h3>
      <label className="te-check">
        <input type="checkbox" checked={prefs.lanOn} disabled={disabled} onChange={(e) => onChange({ lanOn: e.target.checked })} />
        Servidor en la red local (escuchar desde otra PC o el celular)
      </label>
      {prefs.lanOn ? (
        <>
          <div className="te-grid">
            {input("port", "Puerto", { type: "number", mono: true })}
            <label className="te-check">
              <input type="checkbox" checked={prefs.requests} disabled={disabled} onChange={(e) => onChange({ requests: e.target.checked })} />
              Aceptar pedidos de temas
            </label>
          </div>
          <p className="settings-note">Windows puede preguntar si dejás que BROSS DJ use la red: aceptá para redes privadas.</p>
        </>
      ) : null}

      <h3 className="te-h">Pedidos ({requests.length})</h3>
      {requests.length ? (
        [...requests].reverse().map((r) => (
          <div className="shortcut-row" key={r.id}>
            <span data-no-i18n>
              <b>{r.song}</b> <em className="midikind">· {r.name} · {new Date(r.at).toLocaleTimeString()}</em>
            </span>
            <span className="midi-bind">
              <button type="button" className="midi-clear" onClick={() => onSearch(r.song)} title="Buscar en la biblioteca">
                ⌕
              </button>
              <button type="button" className="midi-clear" onClick={() => onDismiss(r.id)} title="Listo / descartar">
                ✕
              </button>
            </span>
          </div>
        ))
      ) : (
        <p className="settings-note">Todavía no hay pedidos.</p>
      )}
    </>
  );
}
