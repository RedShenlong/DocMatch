export interface Pt {
  x: number;
  y: number;
}

/** Transformación afín: x' = a·x + b·y + c ; y' = d·x + e·y + f */
export type Affine = [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 0, 1, 0];

export function apply(t: Affine, p: Pt): Pt {
  return { x: t[0] * p.x + t[1] * p.y + t[2], y: t[3] * p.x + t[4] * p.y + t[5] };
}

function solve3(m: number[][], v: number[]): number[] | null {
  // Eliminación de Gauss con pivoteo parcial para un sistema 3×3.
  const a = m.map((r, i) => [...r, v[i] as number]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[p]![c]!)) p = r;
    if (Math.abs(a[p]![c]!) < 1e-12) return null;
    [a[c], a[p]] = [a[p]!, a[c]!];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = a[r]![c]! / a[c]![c]!;
      for (let k = c; k < 4; k++) a[r]![k]! -= f * a[c]![k]!;
    }
  }
  return [a[0]![3]! / a[0]![0]!, a[1]![3]! / a[1]![1]!, a[2]![3]! / a[2]![2]!];
}

/** Ajuste por mínimos cuadrados (ponderado) de una afín completa. Necesita ≥3 puntos no colineales. */
export function fitAffine(src: Pt[], dst: Pt[], w?: number[]): Affine | null {
  const n = src.length;
  if (n < 3) return fitSimilarity(src, dst);
  let sxx = 0,
    sxy = 0,
    sx = 0,
    syy = 0,
    sy = 0,
    s1 = 0;
  let bx0 = 0,
    bx1 = 0,
    bx2 = 0,
    by0 = 0,
    by1 = 0,
    by2 = 0;
  for (let i = 0; i < n; i++) {
    const { x, y } = src[i]!;
    const q = dst[i]!;
    const wi = w?.[i] ?? 1;
    sxx += wi * x * x;
    sxy += wi * x * y;
    sx += wi * x;
    syy += wi * y * y;
    sy += wi * y;
    s1 += wi;
    bx0 += wi * x * q.x;
    bx1 += wi * y * q.x;
    bx2 += wi * q.x;
    by0 += wi * x * q.y;
    by1 += wi * y * q.y;
    by2 += wi * q.y;
  }
  const M = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, s1],
  ];
  const r1 = solve3(M, [bx0, bx1, bx2]);
  const r2 = solve3(M, [by0, by1, by2]);
  if (!r1 || !r2) return fitSimilarity(src, dst);
  return [r1[0]!, r1[1]!, r1[2]!, r2[0]!, r2[1]!, r2[2]!];
}

/** Similaridad (escala + rotación + traslación) por mínimos cuadrados; con 1 punto, solo traslación. */
export function fitSimilarity(src: Pt[], dst: Pt[]): Affine | null {
  const n = src.length;
  if (n === 0) return null;
  let mx = 0,
    my = 0,
    nx = 0,
    ny = 0;
  for (let i = 0; i < n; i++) {
    mx += src[i]!.x;
    my += src[i]!.y;
    nx += dst[i]!.x;
    ny += dst[i]!.y;
  }
  mx /= n;
  my /= n;
  nx /= n;
  ny /= n;
  if (n === 1) return [1, 0, nx - mx, 0, 1, ny - my];
  let a = 0,
    b = 0,
    d = 0;
  for (let i = 0; i < n; i++) {
    const px = src[i]!.x - mx,
      py = src[i]!.y - my,
      qx = dst[i]!.x - nx,
      qy = dst[i]!.y - ny;
    a += px * qx + py * qy;
    b += px * qy - py * qx;
    d += px * px + py * py;
  }
  if (d < 1e-12) return [1, 0, nx - mx, 0, 1, ny - my];
  const s = a / d,
    r = b / d;
  return [s, -r, nx - (s * mx - r * my), r, s, ny - (r * mx + s * my)];
}

export interface RansacResult {
  t: Affine;
  inliers: boolean[];
  inlierRatio: number;
  rmse: number;
}

/**
 * RANSAC sencillo y determinista sobre correspondencias (src→dst). Las muestras se eligen con un
 * generador pseudoaleatorio con semilla fija para que el resultado sea reproducible.
 */
export function ransacAffine(
  src: Pt[],
  dst: Pt[],
  weights: number[],
  tol = 0.02,
  iters = 150,
): RansacResult | null {
  const n = src.length;
  if (n === 0) return null;
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const evalT = (t: Affine) => {
    const inl: boolean[] = [];
    let score = 0;
    for (let i = 0; i < n; i++) {
      const p = apply(t, src[i]!);
      const e = Math.hypot(p.x - dst[i]!.x, p.y - dst[i]!.y);
      const ok = e < tol;
      inl.push(ok);
      if (ok) score += weights[i]! * (1 - e / tol / 2);
    }
    return { inl, score };
  };
  const plausible = (t: Affine) => {
    const sx = Math.hypot(t[0], t[3]);
    const sy = Math.hypot(t[1], t[4]);
    return sx > 0.5 && sx < 2 && sy > 0.5 && sy < 2 && Math.abs(sx / sy - 1) < 0.25;
  };
  let best: { t: Affine; inl: boolean[]; score: number } | null = null;
  const k = n >= 3 ? 3 : n;
  for (let it = 0; it < (n <= k ? 1 : iters); it++) {
    const idx = new Set<number>();
    while (idx.size < k) idx.add(Math.floor(rnd() * n));
    const ii = [...idx];
    const t =
      k === 3
        ? fitAffine(
            ii.map((i) => src[i]!),
            ii.map((i) => dst[i]!),
          )
        : fitSimilarity(
            ii.map((i) => src[i]!),
            ii.map((i) => dst[i]!),
          );
    if (!t || !plausible(t)) continue;
    const e = evalT(t);
    if (!best || e.score > best.score) best = { t, ...e };
  }
  if (!best) {
    const t = fitSimilarity(src, dst);
    if (!t) return null;
    best = { t, ...evalT(t) };
  }
  // Reajuste con todos los inliers.
  const s2: Pt[] = [],
    d2: Pt[] = [],
    w2: number[] = [];
  best.inl.forEach((ok, i) => {
    if (ok) {
      s2.push(src[i]!);
      d2.push(dst[i]!);
      w2.push(weights[i]!);
    }
  });
  let t = best.t;
  if (s2.length >= 4) t = fitAffine(s2, d2, w2) ?? t;
  else if (s2.length >= 2) t = fitSimilarity(s2, d2) ?? t;
  if (!plausible(t)) t = best.t;
  const { inl } = evalT(t);
  let se = 0,
    c = 0;
  inl.forEach((ok, i) => {
    if (!ok) return;
    const p = apply(t, src[i]!);
    se += (p.x - dst[i]!.x) ** 2 + (p.y - dst[i]!.y) ** 2;
    c++;
  });
  return { t, inliers: inl, inlierRatio: c / n, rmse: c ? Math.sqrt(se / c) : 1 };
}
