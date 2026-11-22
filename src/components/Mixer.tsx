import type { ReactNode } from "react";
import { Knob, VFader } from "./controls";
import { useWheelStep } from "../hooks/useWheelStep";
import { img } from "../assets";
import { METER_TICKS, meterPos, type MeterReading } from "../engine/meter";

export interface ChannelState {
  gain: number;
  hi: number;
  mid: number;
  low: number;
  filter: number;
  fader: number;
}

export type FxTab = "echo" | "reverse" | "brake" | "flanger" | "phaser" | "reverb" | "crush" | "gate";

/** Efectos de un deck: tres solapas, cada una con su efecto. */
export interface DeckFx {
  tab: FxTab;
  /** beat: perilla 0..1 → 1/8 … 2 beats; feedback 0..1 */
  echo: { on: boolean; beat: number; feedback: number };
  reverse: { on: boolean };
  /** time: perilla 0..1 → 0.25 … 4 s hasta parar */
  brake: { on: boolean; time: number };
  /** rate: perilla 0..1 → período del barrido (beats) */
  flanger: { on: boolean; rate: number };
  phaser: { on: boolean; rate: number };
  reverb: { on: boolean; amount: number };
  /** bits: perilla 0..1 → 12 … 2 bits */
  crush: { on: boolean; bits: number };
  /** rate: perilla 0..1 → largo de cada corte (beats) */
  gate: { on: boolean; rate: number };
}

export type DeckFxPatch =
  | { tab: FxTab }
  | { echo: Partial<DeckFx["echo"]> }
  | { reverse: Partial<DeckFx["reverse"]> }
  | { brake: Partial<DeckFx["brake"]> }
  | { flanger: Partial<DeckFx["flanger"]> }
  | { phaser: Partial<DeckFx["phaser"]> }
  | { reverb: Partial<DeckFx["reverb"]> }
  | { crush: Partial<DeckFx["crush"]> }
  | { gate: Partial<DeckFx["gate"]> };

export const ECHO_BEATS = [1 / 8, 1 / 4, 1 / 2, 3 / 4, 1, 2] as const;
const ECHO_LABELS = ["1/8", "1/4", "1/2", "3/4", "1", "2"];

export function echoBeatIndex(v: number): number {
  return Math.max(0, Math.min(ECHO_BEATS.length - 1, Math.round(v * (ECHO_BEATS.length - 1))));
}

export const SWEEP_BEATS = [1 / 2, 1, 2, 4, 8, 16] as const;
export const GATE_BEATS = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1] as const;

export function pick<T>(list: readonly T[], v: number): T {
  return list[Math.max(0, Math.min(list.length - 1, Math.round(v * (list.length - 1))))];
}

export function crushBits(v: number): number {
  return Math.round(12 - Math.max(0, Math.min(1, v)) * 10);
}

function beatText(b: number): string {
  return b >= 1 ? String(b) : `1/${Math.round(1 / b)}`;
}

export function brakeSeconds(v: number): number {
  return 0.25 * Math.pow(16, Math.max(0, Math.min(1, v)));
}

interface MixerProps {
  a: ChannelState;
  b: ChannelState;
  onChannel: (deck: "A" | "B", key: keyof ChannelState, value: number) => void;
  crossfade: number;
  onCrossfade: (v: number) => void;
  master: number;
  onMaster: (v: number) => void;
  /** panel de arriba: efectos u ondas apiladas (A arriba, B abajo) */
  panelView: "fx" | "waves";
  onPanelView: (v: "fx" | "waves") => void;
  waves: ReactNode;
  /** medidores en dBFS de cada canal (post-fader) y del master */
  meters: { A: MeterReading; B: MeterReading };
  masterMeter: MeterReading;
  cue: { A: boolean; B: boolean };
  onCue: (deck: "A" | "B") => void;
  sandbox: { A: boolean; B: boolean };
  /** deck que manejan Espacio y C (se marca encendiendo su SBX) */
  selected: "A" | "B";
  onSandbox: (deck: "A" | "B") => void;
  /** master y CUE comparten salida física: el CUE puede sangrar por parlantes */
  cueWarning?: boolean;
  fx: { A: DeckFx; B: DeckFx };
  /** 0 = auriculares solo con la previa (CUE), 1 = solo el master */
  cueMix: number;
  onCueMix: (v: number) => void;
  samplerVol: number;
  onSamplerVol: (v: number) => void;
  onFx: (deck: "A" | "B", patch: DeckFxPatch) => void;
}

const fmtDb = (db: number) => (db <= -59.9 ? "−∞" : `${db > -0.05 ? "0.0" : db.toFixed(1).replace("-", "−")}`);

/**
 * Medidor en dBFS: barra del nivel (VU), rayita del pico retenido y luz de
 * clip arriba. Zonas: gris hasta −6 dB, ámbar hasta −3 dB, rojo hasta 0 dB.
 */
function Vu({ meter, scale }: { meter: MeterReading; scale?: boolean }) {
  const pct = (db: number) => `${(meterPos(db) * 100).toFixed(1)}%`;
  return (
    <div className={`vu${scale ? " with-scale" : ""}`}>
      <div
        className={`vmeter${meter.clip ? " clip" : ""}`}
        title={`Nivel ${fmtDb(meter.rms)} dBFS · pico ${fmtDb(meter.hold)} dBFS${meter.clip ? " · ¡SATURA!" : ""}`}
      >
        <span className="vclip" aria-hidden />
        <span className="vcover" style={{ height: `calc(100% - ${pct(meter.rms)})` }} aria-hidden />
        {meter.hold > -59.9 ? <span className="vhold" style={{ bottom: pct(meter.hold) }} aria-hidden /> : null}
      </div>
      {scale ? (
        <div className="vscale" aria-hidden>
          {METER_TICKS.filter((t) => t !== -3).map((t) => (
            <span key={t} style={{ bottom: pct(t) }}>
              {t === 0 ? "0" : `${t}`.replace("-", "−")}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const FX_TABS: { id: FxTab; label: string }[] = [
  { id: "echo", label: "ECHO" },
  { id: "reverse", label: "REVERSE" },
  { id: "brake", label: "BREAK" },
  { id: "flanger", label: "FLANGER" },
  { id: "phaser", label: "PHASER" },
  { id: "reverb", label: "REVERB" },
  { id: "crush", label: "CRUSH" },
  { id: "gate", label: "GATE" },
];

/** Media sección de efectos de un deck: solapas + ON + perillas. */
function DeckFxPanel({
  deck,
  fx,
  onFx,
}: {
  deck: "A" | "B";
  fx: DeckFx;
  onFx: (deck: "A" | "B", patch: DeckFxPatch) => void;
}) {
  const active: Record<FxTab, boolean> = {
    echo: fx.echo.on,
    reverse: fx.reverse.on,
    brake: fx.brake.on,
    flanger: fx.flanger.on,
    phaser: fx.phaser.on,
    reverb: fx.reverb.on,
    crush: fx.crush.on,
    gate: fx.gate.on,
  };
  const on = active[fx.tab];
  const idx = Math.max(0, FX_TABS.findIndex((t) => t.id === fx.tab));
  const step = (dir: 1 | -1) => onFx(deck, { tab: FX_TABS[(idx + dir + FX_TABS.length) % FX_TABS.length].id });
  const wheelRef = useWheelStep<HTMLDivElement>(step);
  const toggle = () => {
    const t = fx.tab;
    onFx(deck, { [t]: { on: !active[t] } } as DeckFxPatch);
  };
  const knob = (label: string, value: number, text: string, set: (v: number) => void) => (
    <div className="fxctl">
      <Knob label={label} value={value} onChange={set} />
      <span className="fxval">{text}</span>
    </div>
  );
  return (
    <div className={`fxdeck deck-${deck.toLowerCase()}`} aria-label={`Efectos Deck ${deck}`}>
      <div className="fxdhead">FX {deck}</div>
      {/* selector grande: flechas o rueda del mouse para cambiar de efecto */}
      <div className="fxsel" ref={wheelRef}>
        <button type="button" className="fxarrow" onClick={() => step(-1)} aria-label="Efecto anterior" title="Efecto anterior">
          ◀
        </button>
        <div className={`fxname${on ? " active" : ""}`} title="Rueda del mouse: cambiar de efecto">
          {FX_TABS[idx].label}
        </div>
        <button type="button" className="fxarrow" onClick={() => step(1)} aria-label="Efecto siguiente" title="Efecto siguiente">
          ▶
        </button>
      </div>
      <div className="fxdots" role="tablist" aria-label={`Efectos del Deck ${deck}`}>
        {FX_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={fx.tab === t.id}
            aria-label={t.label}
            className={`fxdot${fx.tab === t.id ? " sel" : ""}${active[t.id] ? " active" : ""}`}
            onClick={() => onFx(deck, { tab: t.id })}
            title={`${t.label}${active[t.id] ? " (encendido)" : ""}`}
          />
        ))}
      </div>
      <div className="fxbody">
        <button
          type="button"
          className={`fxled${on ? " on" : ""}`}
          aria-pressed={on}
          onClick={toggle}
          title={on ? "Apagar efecto" : "Encender efecto"}
        >
          ON
        </button>
        {fx.tab === "echo" ? (
          <>
            <div className="fxctl">
              <Knob label="Echo beat" value={fx.echo.beat} onChange={(v) => onFx(deck, { echo: { beat: v } })} />
              <span className="fxval">BEAT {ECHO_LABELS[echoBeatIndex(fx.echo.beat)]}</span>
            </div>
            <div className="fxctl">
              <Knob
                label="Echo feedback"
                value={fx.echo.feedback}
                onChange={(v) => onFx(deck, { echo: { feedback: v } })}
              />
              <span className="fxval">REPET. {Math.round(fx.echo.feedback * 100)}%</span>
            </div>
          </>
        ) : null}
        {fx.tab === "reverse" ? <span className="fxnote">◀◀ PISTA HACIA ATRÁS</span> : null}
        {fx.tab === "brake" ? (
          <div className="fxctl">
            <Knob label="Break tiempo" value={fx.brake.time} onChange={(v) => onFx(deck, { brake: { time: v } })} />
            <span className="fxval">TIEMPO {brakeSeconds(fx.brake.time).toFixed(1)} s</span>
          </div>
        ) : null}
        {fx.tab === "flanger"
          ? knob("Flanger velocidad", fx.flanger.rate, `VEL. ${beatText(pick(SWEEP_BEATS, fx.flanger.rate))} BEAT`, (v) =>
              onFx(deck, { flanger: { rate: v } }),
            )
          : null}
        {fx.tab === "phaser"
          ? knob("Phaser velocidad", fx.phaser.rate, `VEL. ${beatText(pick(SWEEP_BEATS, fx.phaser.rate))} BEAT`, (v) =>
              onFx(deck, { phaser: { rate: v } }),
            )
          : null}
        {fx.tab === "reverb"
          ? knob("Reverb cantidad", fx.reverb.amount, `CANT. ${Math.round(fx.reverb.amount * 100)}%`, (v) =>
              onFx(deck, { reverb: { amount: v } }),
            )
          : null}
        {fx.tab === "crush"
          ? knob("Crush bits", fx.crush.bits, `${crushBits(fx.crush.bits)} BIT`, (v) => onFx(deck, { crush: { bits: v } }))
          : null}
        {fx.tab === "gate"
          ? knob("Gate largo", fx.gate.rate, `LARGO ${beatText(pick(GATE_BEATS, fx.gate.rate))} BEAT`, (v) =>
              onFx(deck, { gate: { rate: v } }),
            )
          : null}
      </div>
    </div>
  );
}

export function Mixer({
  a,
  b,
  onChannel,
  crossfade,
  onCrossfade,
  master,
  onMaster,
  meters,
  masterMeter,
  panelView,
  onPanelView,
  waves,
  cue,
  onCue,
  sandbox,
  selected,
  onSandbox,
  cueWarning,
  fx,
  onFx,
  cueMix,
  onCueMix,
  samplerVol,
  onSamplerVol,
}: MixerProps) {
  // La perilla del crossfader es la tapa cromada del fader de volumen,
  // girada 90° para que quede vertical (14×32 px).
  const xThumb = img("xfader-thumb");

  const eq = (deck: "A" | "B", ch: ChannelState) => (
    <div className="eqcol">
      <Knob label="GAIN" value={ch.gain} onChange={(v) => onChannel(deck, "gain", v)} />
      <div className="eqknobs">
        <Knob label="HI" value={ch.hi} onChange={(v) => onChannel(deck, "hi", v)} />
        <Knob label="MID" value={ch.mid} onChange={(v) => onChannel(deck, "mid", v)} />
        <Knob label="LOW" value={ch.low} onChange={(v) => onChannel(deck, "low", v)} />
        <Knob label="FLTR" value={ch.filter} onChange={(v) => onChannel(deck, "filter", v)} />
      </div>
    </div>
  );

  // Marcas a ambos lados del riel y VU pegado al centro, como la plantilla.
  const fader = (deck: "A" | "B", ch: ChannelState) => (
    <div className="fadcol">
      <button
        type="button"
        className={`cuebtn${cue[deck] ? " on" : ""}`}
        aria-pressed={cue[deck]}
        onClick={() => onCue(deck)}
        title={
          cueWarning
            ? `CUE Deck ${deck}: comparte salida con el master, puede escucharse por los parlantes`
            : `Monitorear Deck ${deck} por auriculares (CUE)`
        }
      >
        CUE
      </button>
      <button
        type="button"
        className={`sbxbtn${sandbox[deck] ? " on" : ""}${selected === deck ? " sel" : ""}`}
        aria-pressed={sandbox[deck]}
        onClick={() => onSandbox(deck)}
        title={
          (selected === deck ? `Deck ${deck} seleccionado: Espacio = play/pausa, C = CUE, Shift cambia de deck · ` : "") +
          (cueWarning
            ? `Sandbox Deck ${deck}: sin salida de auriculares separada, esto equivale a silenciar el deck`
            : `Sandbox: ensayar Deck ${deck} solo por auriculares, sin mandarlo al master`)
        }
      >
        SBX
      </button>
      <div className="fadrow">
        {deck === "B" ? <Vu meter={meters.B} /> : null}
        <div className="fblock">
          <div className="fticks" aria-hidden />
          <VFader value={ch.fader} onChange={(v) => onChannel(deck, "fader", v)} />
        </div>
        {deck === "A" ? <Vu meter={meters.A} /> : null}
      </div>
      <div className="clab">CH {deck}</div>
    </div>
  );

  return (
    <section className="cell mixc" aria-label="Mixer">
      <div className="fxpanel">
        <div className="fxtabs" role="tablist" aria-label="Panel del mixer">
          <button
            type="button"
            role="tab"
            aria-selected={panelView === "fx"}
            className={panelView === "fx" ? "on" : undefined}
            onClick={() => onPanelView("fx")}
            title="Efectos de los dos decks"
          >
            FX
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={panelView === "waves"}
            className={panelView === "waves" ? "on" : undefined}
            onClick={() => onPanelView("waves")}
            title="Las dos ondas apiladas para comparar los beats (los efectos siguen sonando)"
          >
            ONDAS
          </button>
          {panelView === "waves" ? <span className="fxtabs-hint">A ARRIBA · B ABAJO</span> : null}
        </div>
        {panelView === "waves" ? (
          <div className="fxwaves">{waves}</div>
        ) : (
          <div className="fxsplit">
            <DeckFxPanel deck="A" fx={fx.A} onFx={onFx} />
            <DeckFxPanel deck="B" fx={fx.B} onFx={onFx} />
          </div>
        )}
      </div>

      <div className="mx">
        <div className="strip deck-a">
          {eq("A", a)}
          {fader("A", a)}
        </div>

        <div className="mcenter">
          <Knob label="MASTER" value={master} onChange={onMaster} />
          <div className="mastervu">
            <span className="xt">OUT</span>
            <Vu meter={masterMeter} scale />
            <span className={`vdb${masterMeter.clip ? " clip" : ""}`} title="Pico del master en dBFS">
              {fmtDb(masterMeter.hold)}
            </span>
          </div>
          <Knob label="CUE MIX" value={cueMix} onChange={onCueMix} />
          <Knob label="SAMPLER" value={samplerVol} onChange={onSamplerVol} />
        </div>

        <div className="strip deck-b">
          {eq("B", b)}
          {fader("B", b)}
        </div>
      </div>

      <div className="masterx">
        <span className="xarrow" aria-hidden>
          ◀
        </span>
        <div
          className="xrail"
          role="slider"
          aria-label="Crossfader"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(crossfade * 100)}
          tabIndex={0}
          onPointerDown={(e) => {
            e.preventDefault();
            const rail = e.currentTarget as HTMLElement;
            rail.setPointerCapture(e.pointerId);
            const rect = rail.getBoundingClientRect();
            const move = (ev: PointerEvent) => {
              onCrossfade(Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)));
            };
            move(e.nativeEvent);
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") onCrossfade(Math.max(0, crossfade - 0.02));
            if (e.key === "ArrowRight") onCrossfade(Math.min(1, crossfade + 0.02));
          }}
        >
          <div
            className={`fth${xThumb ? " has-art" : ""}`}
            style={{
              // la tapa se centra con translate(-50%): su centro recorre el riel
              // dejando 7 px de margen a cada lado (0.5 = centro exacto)
              left: `calc(7px + ${crossfade} * (100% - 14px))`,
              backgroundImage: xThumb ? `url(${xThumb})` : undefined,
            }}
          />
        </div>
        <span className="xarrow" aria-hidden>
          ▶
        </span>
      </div>
    </section>
  );
}
