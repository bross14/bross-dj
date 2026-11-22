import { useState } from "react";
import type { UserPad } from "../userActions";
import type { StemGains } from "../engine/stems";
import { Jog } from "./Jog";
import { PitchBar, press } from "./controls";
import { fmtTime, type DeckRuntime, type SampleSlot } from "../engine/audio";
import { Pads } from "./Pads";
import { LoopBar } from "./LoopBar";
import { img } from "../assets";

interface DeckProps {
  id: "A" | "B";
  runtime: DeckRuntime;
  pitch: number;
  range: number;
  onRange: (dir: -1 | 1) => void;
  keyLock: boolean;
  onKeyLock: () => void;
  synced: boolean;
  onSync: () => void;
  canSync: boolean;
  onPitch: (v: number) => void;
  onToggle: () => void;
  /** CUE: se aprieta y se suelta */
  onCueDown: () => void;
  onCueUp: () => void;
  onLoop: (beats: number) => void;
  /** pad de loop de largo fijo (página LOOPS) */
  onLoopPad: (beats: number) => void;
  onLoopIn: () => void;
  onLoopOut: () => void;
  onAutoLoop: () => void;
  onLoopResize: (factor: number) => void;
  onLoopMove: (dir: -1 | 1) => void;
  onReloop: () => void;
  onSlip: () => void;
  onRollStart: (beats: number) => void;
  onRollEnd: () => void;
  onSlice?: (slot: number) => void;
  samples: (SampleSlot | null)[];
  onSamplePlay: (slot: number) => void;
  onSampleClear: (slot: number) => void;
  onSampleEdit?: (slot: number) => void;
  userPads?: UserPad[];
  onUserPad?: (slot: number) => void;
  onUserPadEdit?: (slot: number) => void;
  stems?: StemGains;
  onStems?: (g: StemGains) => void;
  onSampleDrop: (slot: number, trackId: string) => void;
  onSeek: (s: number) => void;
  onHotCue: (slot: number) => void;
  onHotCueClear: (slot: number) => void;
  onDropTrack: (trackId: string) => void;
  /** modo vinilo (scratch) del jog */
  scratch: boolean;
  onScratchToggle: () => void;
  onScratchStart: () => void;
  onScratchMove: (deltaSeconds: number) => void;
  onScratchEnd: () => void;
  onBend: (bend: number) => void;
}

export function Deck({
  id,
  runtime,
  pitch,
  range,
  onRange,
  keyLock,
  onKeyLock,
  synced,
  onSync,
  canSync,
  onPitch,
  onToggle,
  onCueDown,
  onCueUp,
  onLoop,
  onLoopPad,
  onLoopIn,
  onLoopOut,
  onAutoLoop,
  onLoopResize,
  onLoopMove,
  onReloop,
  onSlip,
  onRollStart,
  onRollEnd,
  onSlice,
  samples,
  onSamplePlay,
  onSampleClear,
  onSampleEdit,
  userPads,
  onUserPad,
  onUserPadEdit,
  stems,
  onStems,
  onSampleDrop,
  onSeek,
  onHotCue,
  onHotCueClear,
  onDropTrack,
  scratch,
  onScratchToggle,
  onScratchStart,
  onScratchMove,
  onScratchEnd,
  onBend,
}: DeckProps) {
  const [over, setOver] = useState(false);
  const rate = 1 + (pitch - 0.5) * (range / 50);
  const effectiveBpm = runtime.bpm ? runtime.bpm * rate : null;
  const deckClass = `deck-${id.toLowerCase()}`;
  const otherDeck = id === "A" ? "B" : "A";
  // Si existe src/assets/img/vinyl-a.(png|jpg|webp) se usa tal cual.
  // Si ambos decks comparten el mismo disco, alcanza con "vinyl.*".
  const vinylArt =
    img(id === "A" ? "vinyl-a" : "vinyl-b") ?? img("vinyl");

  return (
    <section className={`cell deck ${deckClass}`} aria-label={`Deck ${id}`}>
      <div className="dhead">
        <div className="badge">{id}</div>
        {runtime.loaded ? (
          <>
            <div className="dt">
              <div className="t" title={runtime.title} data-no-i18n>
                {runtime.title}
              </div>
              <div className="r">{runtime.artist || "ARTISTA DESCONOCIDO"}</div>
            </div>
            <div className="dclock">
              <div className="dline">
                <b>{effectiveBpm ? effectiveBpm.toFixed(1) : "—"}</b> BPM
                {runtime.camelot ? (
                  <span
                    className="dkey"
                    title={
                      keyLock && runtime.keyShift !== 0
                        ? `${runtime.keyName ?? ""} transpuesto ${runtime.keyShift > 0 ? "+" : ""}${runtime.keyShift} semitonos por SYNC`
                        : (runtime.keyName ?? "")
                    }
                  >
                    {runtime.camelot}
                    {keyLock && runtime.keyShift !== 0 ? ` ${runtime.keyShift > 0 ? "+" : ""}${runtime.keyShift}` : ""}
                  </span>
                ) : null}
              </div>
              <div>
                <span>{fmtTime(runtime.position)}</span> / {fmtTime(runtime.duration)}
              </div>
            </div>
          </>
        ) : null}
      </div>

      <PitchBar
        value={pitch}
        range={range}
        deck={id}
        keyLock={keyLock}
        onKeyLock={onKeyLock}
        onRange={onRange}
        onChange={onPitch}
        extra={
          <LoopBar
            runtime={runtime}
            onLoopIn={onLoopIn}
            onLoopOut={onLoopOut}
            onAuto={onAutoLoop}
            onResize={onLoopResize}
            onMove={onLoopMove}
            onReloop={onReloop}
            onSlip={onSlip}
          />
        }
      />

      <div
        className={`deckbody${over ? " drop" : ""}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("text/bross-track")) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          const trackId = e.dataTransfer.getData("text/bross-track");
          if (trackId) {
            e.preventDefault();
            onDropTrack(trackId);
          }
          setOver(false);
        }}
      >
        <div className="jogwrap">
          <Jog
            deck={id}
            art={vinylArt}
            playing={runtime.playing}
            position={runtime.position}
            duration={runtime.duration}
            bpm={effectiveBpm}
            scratch={scratch}
            onSeek={onSeek}
            onToggle={onToggle}
            onScratchStart={onScratchStart}
            onScratchMove={onScratchMove}
            onScratchEnd={onScratchEnd}
            onBend={onBend}
          />
          <button
            type="button"
            className={`vinylbtn${scratch ? " on" : ""}`}
            aria-pressed={scratch}
            onClick={onScratchToggle}
            title={
              scratch
                ? "Modo vinilo encendido: el disco hace scratch"
                : "Modo vinilo apagado: el disco hace pitch bend (nudge)"
            }
          >
            <span className="vinyl-ico" aria-hidden />
            VINYL
          </button>
        </div>
        <div className="padcol">
          <Pads
            runtime={runtime}
            onHotCue={onHotCue}
            onHotCueClear={onHotCueClear}
            onLoop={onLoop}
            onLoopPad={onLoopPad}
            onRollStart={onRollStart}
            onRollEnd={onRollEnd}
            onSlice={onSlice}
            samples={samples}
            onSamplePlay={onSamplePlay}
            onSampleClear={onSampleClear}
            onSampleEdit={onSampleEdit}
            userPads={userPads}
            onUserPad={onUserPad}
            onUserPadEdit={onUserPadEdit}
            stems={stems}
            onStems={onStems}
            onSampleDrop={onSampleDrop}
          />
          <div className="trans">
            <button
              type="button"
              className={`tb pp${runtime.playing ? " playing" : runtime.loaded ? " blink" : ""}`}
              {...press(onToggle)}
              title={runtime.playing ? "Pausa" : "Play"}
              aria-pressed={runtime.playing}
              aria-label={runtime.playing ? "Pausa" : "Play"}
            >
              <span className="pp-ico play" aria-hidden />
              <span className="pp-sep" aria-hidden />
              <span className="pp-ico pause" aria-hidden />
            </button>
            <button
              type="button"
              className={`tb hold cue-led${
                runtime.cueHeld || runtime.atCue ? " lit" : runtime.loaded && !runtime.playing ? " blink" : ""
              }`}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                onCueDown();
              }}
              onPointerUp={onCueUp}
              onPointerCancel={onCueUp}
              onKeyDown={(e) => {
                if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                  e.preventDefault();
                  onCueDown();
                }
              }}
              onKeyUp={(e) => {
                if (e.key === " " || e.key === "Enter") onCueUp();
              }}
              title="CUE: sonando vuelve al cue y para · en pausa fija el cue y suena mientras lo mantenés · PLAY con CUE apretado sigue sonando"
            >
              CUE
            </button>
            <button
              type="button"
              className={`tb sync${synced ? " on" : ""}`}
              onClick={onSync}
              disabled={!canSync}
              aria-pressed={synced}
              title={
                canSync
                  ? `SYNC: igualar el BPM del deck ${otherDeck}`
                  : "SYNC — necesita BPM de los dos decks"
              }
            >
              SYNC
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
