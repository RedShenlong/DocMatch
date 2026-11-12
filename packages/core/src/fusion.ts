import type { MatchSignal } from './matchers/types';
import { DEFAULT_CALIBRATION, FUSION_FEATURES, type FusionWeights, type Profile } from './profile/types';

/** Vector de características en el orden de FUSION_FEATURES. Las señales ausentes valen NaN. */
export function featureVector(signals: MatchSignal[]): number[] {
  return FUSION_FEATURES.map((f) => {
    const s = signals.find((x) => x.id === f);
    return s ? s.score : NaN;
  });
}

/**
 * Fusión calibrada: regresión logística sobre las señales. Si falta una señal (p. ej. no hay
 * modelo visual), su contribución se sustituye por el valor neutro 0,5 ponderado por su peso.
 */
export function fuse(x: number[], fw: FusionWeights): number {
  let z = fw.b;
  for (let i = 0; i < fw.features.length; i++) {
    const j = FUSION_FEATURES.indexOf(fw.features[i] as (typeof FUSION_FEATURES)[number]);
    const v = j >= 0 ? x[j]! : NaN;
    z += fw.w[i]! * (Number.isNaN(v) ? 0.5 : v);
  }
  return 1 / (1 + Math.exp(-z));
}

export function fusionFor(profile: Profile, kind: 'digital' | 'scan'): FusionWeights {
  return profile.calibration?.fusion?.[kind] ?? DEFAULT_CALIBRATION.fusion[kind];
}
