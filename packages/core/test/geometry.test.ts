import { describe, expect, it } from 'vitest';
import { apply, fitAffine, fitSimilarity, ransacAffine, type Affine } from '../src/geometry/affine';

const T: Affine = [0.98, -0.03, 0.02, 0.031, 1.01, -0.015];
const pts = Array.from({ length: 20 }, (_, i) => ({ x: ((i * 37) % 100) / 100, y: ((i * 61) % 100) / 100 }));

describe('transformación afín', () => {
  it('mínimos cuadrados recupera la afín exacta', () => {
    const t = fitAffine(
      pts,
      pts.map((p) => apply(T, p)),
    )!;
    t.forEach((v, i) => expect(v).toBeCloseTo(T[i]!, 6));
  });
  it('similaridad con 1 y 2 puntos', () => {
    expect(fitSimilarity([{ x: 0, y: 0 }], [{ x: 0.1, y: 0.2 }])).toEqual([1, 0, 0.1, 0, 1, 0.2]);
    const t = fitSimilarity(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
      ],
    )!;
    const p = apply(t, { x: 1, y: 0 });
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1);
  });
  it('RANSAC ignora correspondencias erróneas', () => {
    const dst = pts.map((p) => apply(T, p));
    for (let i = 0; i < 6; i++) dst[i] = { x: Math.random(), y: Math.random() };
    const r = ransacAffine(
      pts,
      dst,
      pts.map(() => 1),
    )!;
    expect(r.inlierRatio).toBeGreaterThanOrEqual(0.65);
    const q = apply(r.t, { x: 0.5, y: 0.5 });
    const e = apply(T, { x: 0.5, y: 0.5 });
    expect(Math.hypot(q.x - e.x, q.y - e.y)).toBeLessThan(0.003);
  });
});
