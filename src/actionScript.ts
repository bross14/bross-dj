// Mini-DSL de acciones para pads de usuario y controles MIDI.
//
//   deck.play                         acción simple ("deck" = el deck del pad / control)
//   deck.sync ; other.play            varias, en orden (también con &)
//   deck.playing ? deck.cue : deck.play
//   not deck.loaded ? deck.loadSide
//   shift ? deck.hot 2 : deck.hot 1   (shift = botón SHIFT del controlador apretado)
//   deck.loop 8 · deck.pitch 0.5 · crossfader 0 · sample 3 · deck.fx echo
//
// Acciones: las mismas del MIDI (play cue sync keylock vinyl slip loop loopIn
// loopOut loopHalf loopDouble reloop hot1..hot8 echo reverse brake pfl
// loadSide) más las que llevan valor: hot N · loop N · pitch v · volume v ·
// gain v · eqHigh v · eqMid v · eqLow v · filter v · fx nombre (alterna) ·
// crossfader v · master v · sample N · automix · rec.
// Condiciones: playing loaded synced looping keylock vinyl slip (de un deck),
// shift, automix, recording; con "not" delante.

export type DeckRef = "deck" | "other" | "deckA" | "deckB";

export type ScriptNode =
  | { t: "seq"; items: ScriptNode[] }
  | { t: "if"; cond: CondNode; then: ScriptNode; else: ScriptNode | null }
  | { t: "act"; target: DeckRef | null; name: string; arg: string | null };

export type CondNode = { not: boolean; target: DeckRef | null; name: string };

export class ScriptError extends Error {}

const DECK_ACTIONS = new Set([
  "play", "cue", "sync", "keylock", "vinyl", "slip", "loop", "loopIn", "loopOut", "loopHalf", "loopDouble",
  "reloop", "hot1", "hot2", "hot3", "hot4", "hot5", "hot6", "hot7", "hot8", "echo", "reverse", "brake",
  "pfl", "loadSide", "hot", "pitch", "volume", "gain", "eqHigh", "eqMid", "eqLow", "filter", "fx", "stop", "stem",
]);
const GLOBAL_ACTIONS = new Set(["crossfader", "master", "sample", "automix", "rec"]);
const DECK_CONDS = new Set(["playing", "loaded", "synced", "looping", "keylock", "vinyl", "slip"]);
const GLOBAL_CONDS = new Set(["shift", "automix", "recording"]);
/** acciones que necesitan un valor después */
const NEEDS_ARG = new Set(["hot", "pitch", "volume", "gain", "eqHigh", "eqMid", "eqLow", "filter", "fx", "crossfader", "master", "sample", "stem"]);
const FX_NAMES = new Set(["echo", "reverse", "brake", "flanger", "phaser", "reverb", "crush", "gate"]);

function tokenize(src: string): string[] {
  const out: string[] = [];
  const re = /\s*(\?|:|;|&|[^\s?:;&]+)/gy;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(src))) {
    last = re.lastIndex;
    out.push(m[1]);
  }
  if (src.slice(last).trim()) throw new ScriptError(`No entiendo "${src.slice(last).trim()}"`);
  return out;
}

function splitTarget(tok: string): { target: DeckRef | null; name: string } {
  const m = tok.match(/^(deck|other|deckA|deckB)\.(.+)$/);
  return m ? { target: m[1] as DeckRef, name: m[2] } : { target: null, name: tok };
}

export function parseScript(src: string): ScriptNode {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];

  const parseSeq = (stop: Set<string>): ScriptNode => {
    const items: ScriptNode[] = [];
    while (i < toks.length && !stop.has(peek())) {
      if (peek() === ";" || peek() === "&") {
        i++;
        continue;
      }
      items.push(parseStep(stop));
    }
    if (!items.length) throw new ScriptError("Falta una acción");
    return items.length === 1 ? items[0] : { t: "seq", items };
  };

  const parseCond = (): CondNode => {
    let not = false;
    if (peek() === "not") {
      not = true;
      i++;
    }
    const tok = toks[i++];
    if (!tok) throw new ScriptError("Falta la condición");
    const { target, name } = splitTarget(tok);
    if (target ? !DECK_CONDS.has(name) : !GLOBAL_CONDS.has(name)) throw new ScriptError(`Condición desconocida "${tok}"`);
    return { not, target, name };
  };

  const parseAction = (): ScriptNode => {
    const tok = toks[i++];
    const { target, name } = splitTarget(tok);
    if (target ? !DECK_ACTIONS.has(name) : !GLOBAL_ACTIONS.has(name)) throw new ScriptError(`Acción desconocida "${tok}"`);
    let arg: string | null = null;
    const next = peek();
    if (NEEDS_ARG.has(name) || (name === "loop" && next != null && /^[\d.]+$/.test(next))) {
      if (next == null || next === ";" || next === "&" || next === "?" || next === ":") {
        throw new ScriptError(`"${tok}" necesita un valor`);
      }
      arg = toks[i++];
      if (name === "fx" && !FX_NAMES.has(arg)) throw new ScriptError(`Efecto desconocido "${arg}"`);
      if (name === "stem" && !/^(voz|vocal|bajo|bass|perc|instr)(=[\d.]+)?$/.test(arg)) throw new ScriptError(`Stem desconocido "${arg}" (voz, bajo, perc, instr; o voz=0.5)`);
      if (name !== "fx" && name !== "stem" && !Number.isFinite(Number(arg))) throw new ScriptError(`"${arg}" no es un número`);
    }
    return { t: "act", target, name, arg };
  };

  // paso: acción, o condición ? acción(es) [: acción(es)]
  const parseStep = (stop: Set<string>): ScriptNode => {
    const save = i;
    // ¿es una condición? (seguida de "?")
    const lookNot = peek() === "not" ? 1 : 0;
    if (toks[i + lookNot + 1] === "?") {
      const cond = parseCond();
      i++; // "?"
      const thenStop = new Set([...stop, ":", ";", "&"]);
      const then = parseBranch(thenStop);
      let els: ScriptNode | null = null;
      if (peek() === ":") {
        i++;
        els = parseBranch(new Set([...stop, ";", "&"]));
      }
      return { t: "if", cond, then, else: els };
    }
    i = save;
    return parseAction();
  };

  const parseBranch = (stop: Set<string>): ScriptNode => {
    if (i >= toks.length || stop.has(peek())) throw new ScriptError("Falta la acción después de ? o :");
    return parseStep(stop);
  };

  if (!toks.length) throw new ScriptError("Script vacío");
  const tree = parseSeq(new Set());
  return tree;
}

export function tryParseScript(src: string): { tree: ScriptNode | null; error: string | null } {
  try {
    return { tree: parseScript(src), error: null };
  } catch (e) {
    return { tree: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Lo que el script necesita de la app para correr. */
export interface ScriptHost {
  /** deck del pad o del control ("deck"); "other" es el otro */
  deck: "A" | "B";
  /** acción de un deck o global, con valor opcional */
  run(deck: "A" | "B" | null, name: string, arg: string | null): void;
  /** estado para las condiciones */
  query(deck: "A" | "B" | null, name: string): boolean;
}

function resolve(target: DeckRef | null, host: ScriptHost): "A" | "B" | null {
  if (target == null) return null;
  if (target === "deckA") return "A";
  if (target === "deckB") return "B";
  if (target === "deck") return host.deck;
  return host.deck === "A" ? "B" : "A";
}

export function runScript(node: ScriptNode, host: ScriptHost): void {
  switch (node.t) {
    case "seq":
      node.items.forEach((n) => runScript(n, host));
      return;
    case "if": {
      const v = host.query(resolve(node.cond.target, host), node.cond.name);
      if (v !== node.cond.not) runScript(node.then, host);
      else if (node.else) runScript(node.else, host);
      return;
    }
    case "act":
      host.run(resolve(node.target, host), node.name, node.arg);
  }
}

/** Texto de ayuda para los editores. */
export const SCRIPT_HELP = [
  "deck = el deck del pad o del control · other = el otro · deckA / deckB",
  "Acciones: play cue sync keylock vinyl slip loop loopIn loopOut loopHalf loopDouble reloop echo reverse brake pfl loadSide stop",
  "Con valor: hot N · loop N · pitch v · volume v · gain v · eqHigh/eqMid/eqLow/filter v · fx echo|flanger|… · stem voz|bajo|perc|instr (o voz=0.5) · crossfader v · master v · sample N · automix · rec",
  "Varias en orden: a ; b   ·   condición: deck.playing ? a : b   ·   not deck.loaded ? deck.loadSide",
  "Condiciones: playing loaded synced looping keylock vinyl slip · shift automix recording",
].join("\n");
