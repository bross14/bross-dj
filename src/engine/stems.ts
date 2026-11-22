// Stems por filtros: separa la señal en cuatro "elementos" usando el
// centro y los costados del estéreo y cruces Linkwitz-Riley de 4.º orden.
//
//   BAJO   centro < 120 Hz          (bajo y bombo)
//   VOZ    centro 120 Hz – 4,5 kHz  (la voz suele ir al centro)
//   PERC   todo > 4,5 kHz            (platillos, hi-hats, brillo)
//   INSTR  costados < 4,5 kHz        (instrumentos abiertos en estéreo)
//
// No es una separación perfecta , pero sirve
// para sacar o aislar la voz, quedarse con el beat o bajar el bajo. Con todo
// en 1 la señal pasa directo (sin pasar por los filtros).

export interface StemGains {
  vocal: number;
  bass: number;
  perc: number;
  instr: number;
}

export const FULL_STEMS: StemGains = { vocal: 1, bass: 1, perc: 1, instr: 1 };

export const STEM_CROSS = { low: 120, high: 4500 };

export interface StemChain {
  input: AudioNode;
  output: AudioNode;
  set(g: StemGains): void;
}

/** Cruce LR4: dos Butterworth de 2.º orden en cascada. */
function lr4(ctx: BaseAudioContext, type: "lowpass" | "highpass", freq: number): [BiquadFilterNode, BiquadFilterNode] {
  const a = ctx.createBiquadFilter();
  const b = ctx.createBiquadFilter();
  for (const f of [a, b]) {
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = Math.SQRT1_2;
  }
  a.connect(b);
  return [a, b];
}

export function isFull(g: StemGains): boolean {
  return g.vocal >= 0.999 && g.bass >= 0.999 && g.perc >= 0.999 && g.instr >= 0.999;
}

export function buildStems(ctx: BaseAudioContext): StemChain {
  const gain = (v: number) => {
    const n = ctx.createGain();
    n.gain.value = v;
    return n;
  };
  const input = gain(1);
  const output = gain(1);
  // camino directo (todo en 1) y camino separado; se cruzan con una rampa
  const dry = gain(1);
  const wet = gain(0);
  input.connect(dry).connect(output);

  // centro y costados
  const split = ctx.createChannelSplitter(2);
  input.connect(split);
  const mid = gain(1);
  const side = gain(1);
  const lHalf = gain(0.5);
  const rHalf = gain(0.5);
  const rNeg = gain(-0.5);
  split.connect(lHalf, 0);
  split.connect(rHalf, 1);
  split.connect(rNeg, 1);
  lHalf.connect(mid);
  rHalf.connect(mid);
  lHalf.connect(side);
  rNeg.connect(side);

  const gB = gain(1);
  const gV = gain(1);
  const gP = gain(1);
  const gPs = gain(1);
  const gI = gain(1);
  const midOut = gain(1);
  const sideOut = gain(1);

  // centro: bajo | voz | agudos
  const [lowA, lowB] = lr4(ctx, "lowpass", STEM_CROSS.low);
  const [restA, restB] = lr4(ctx, "highpass", STEM_CROSS.low);
  mid.connect(lowA);
  mid.connect(restA);
  lowB.connect(gB).connect(midOut);
  const [vocA, vocB] = lr4(ctx, "lowpass", STEM_CROSS.high);
  const [mhA, mhB] = lr4(ctx, "highpass", STEM_CROSS.high);
  restB.connect(vocA);
  restB.connect(mhA);
  vocB.connect(gV).connect(midOut);
  mhB.connect(gP).connect(midOut);
  // costados: instrumentos | agudos
  const [slA, slB] = lr4(ctx, "lowpass", STEM_CROSS.high);
  const [shA, shB] = lr4(ctx, "highpass", STEM_CROSS.high);
  side.connect(slA);
  side.connect(shA);
  slB.connect(gI).connect(sideOut);
  shB.connect(gPs).connect(sideOut);

  // vuelta a estéreo: L = centro + costados, R = centro − costados
  const merge = ctx.createChannelMerger(2);
  const sideInv = gain(-1);
  midOut.connect(merge, 0, 0);
  midOut.connect(merge, 0, 1);
  sideOut.connect(merge, 0, 0);
  sideOut.connect(sideInv).connect(merge, 0, 1);
  merge.connect(wet).connect(output);

  const ramp = (p: AudioParam, v: number) => p.setTargetAtTime(v, ctx.currentTime, 0.03);
  return {
    input,
    output,
    set(g) {
      const full = isFull(g);
      ramp(dry.gain, full ? 1 : 0);
      ramp(wet.gain, full ? 0 : 1);
      ramp(gB.gain, g.bass);
      ramp(gV.gain, g.vocal);
      ramp(gP.gain, g.perc);
      ramp(gPs.gain, g.perc);
      ramp(gI.gain, g.instr);
    },
  };
}

/** Presets de los pads de stems. */
export const STEM_PRESETS: { id: string; label: string; gains: StemGains }[] = [
  { id: "acapella", label: "ACAPELLA", gains: { vocal: 1, bass: 0, perc: 0, instr: 0 } },
  { id: "instrumental", label: "INSTRUM.", gains: { vocal: 0, bass: 1, perc: 1, instr: 1 } },
  { id: "beat", label: "BEAT", gains: { vocal: 0, bass: 1, perc: 1, instr: 0 } },
  { id: "all", label: "TODO", gains: { ...FULL_STEMS } },
];
