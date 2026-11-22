// Medidores de nivel en dBFS (0 dBFS = máximo digital).
//
// Cada lectura toma una ventana de muestras del AnalyserNode y da:
//  - rms:  nivel promedio (lo que "se escucha"), con caída suave (VU)
//  - peak: pico de muestra de la ventana
//  - hold: pico retenido 1,5 s y después cae a 20 dB/s
//  - clip: se encendió por llegar a 0 dBFS (queda prendido 2 s)

export const METER_FLOOR_DB = -60;
/** desde acá cuenta como saturación (pico de muestra en 0 dBFS) */
export const CLIP_DB = -0.1;

export interface MeterReading {
  rms: number;
  peak: number;
  hold: number;
  clip: boolean;
}

export const SILENT_METER: MeterReading = { rms: METER_FLOOR_DB, peak: METER_FLOOR_DB, hold: METER_FLOOR_DB, clip: false };

export function toDb(amp: number): number {
  if (!(amp > 0)) return METER_FLOOR_DB;
  return Math.max(METER_FLOOR_DB, 20 * Math.log10(amp));
}

/** RMS y pico de una ventana, en dBFS. */
export function measure(buf: ArrayLike<number>): { rms: number; peak: number } {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    sum += v * v;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
  }
  return { rms: toDb(buf.length ? Math.sqrt(sum / buf.length) : 0), peak: toDb(peak) };
}

/**
 * Posición 0..1 en la escala del medidor. No es lineal: los últimos 12 dB
 * (donde se mezcla) ocupan casi la mitad de la altura, como en un mixer.
 */
const SCALE: [number, number][] = [
  [METER_FLOOR_DB, 0],
  [-36, 0.12],
  [-24, 0.3],
  [-12, 0.55],
  [-6, 0.74],
  [-3, 0.86],
  [0, 1],
];

export function meterPos(db: number): number {
  if (db <= SCALE[0][0]) return 0;
  if (db >= 0) return 1;
  for (let i = 1; i < SCALE.length; i++) {
    const [d1, p1] = SCALE[i];
    if (db <= d1) {
      const [d0, p0] = SCALE[i - 1];
      return p0 + ((db - d0) / (d1 - d0)) * (p1 - p0);
    }
  }
  return 1;
}

/** marcas de la escala que se dibujan junto al medidor */
export const METER_TICKS = [0, -3, -6, -12, -24];

const HOLD_MS = 1500;
const HOLD_FALL_DB_PER_S = 20;
const CLIP_MS = 2000;
/** caída del RMS (VU): ~300 ms para bajar 20 dB */
const RMS_FALL_DB_PER_S = 65;

/** Balística de un medidor: retención de pico, caída del VU y luz de clip. */
export class MeterBallistics {
  private rms = METER_FLOOR_DB;
  private hold = METER_FLOOR_DB;
  private holdAt = 0;
  private clipAt = -Infinity;
  private last = 0;

  update(sample: { rms: number; peak: number }, now: number): MeterReading {
    const dt = this.last ? Math.min(0.5, (now - this.last) / 1000) : 0;
    this.last = now;
    // el VU sube al instante y baja con caída
    this.rms = sample.rms >= this.rms ? sample.rms : Math.max(sample.rms, this.rms - RMS_FALL_DB_PER_S * dt);
    if (sample.peak >= this.hold) {
      this.hold = sample.peak;
      this.holdAt = now;
    } else if (now - this.holdAt > HOLD_MS) {
      this.hold = Math.max(sample.peak, this.hold - HOLD_FALL_DB_PER_S * dt);
    }
    if (sample.peak >= CLIP_DB) this.clipAt = now;
    return { rms: this.rms, peak: sample.peak, hold: this.hold, clip: now - this.clipAt < CLIP_MS };
  }
}
