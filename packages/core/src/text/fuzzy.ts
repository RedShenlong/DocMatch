/** Distancia de Levenshtein con una sola fila (O(n·m) tiempo, O(m) memoria). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] as number;
    row[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j] as number;
      row[j] = Math.min(
        (row[j] as number) + 1,
        (row[j - 1] as number) + 1,
        prev + (ca === b.charCodeAt(j - 1) ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return row[b.length] as number;
}

/** Similitud 0–1 basada en Levenshtein. */
export function levRatio(a: string, b: string): number {
  const m = Math.max(a.length, b.length);
  return m === 0 ? 1 : 1 - levenshtein(a, b) / m;
}

export function trigrams(s: string): Set<string> {
  const t = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

/** Coeficiente de Dice sobre trigramas (rápido, para preseleccionar candidatos). */
export function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  const [s, l] = a.size < b.size ? [a, b] : [b, a];
  for (const g of s) if (l.has(g)) inter++;
  return (2 * inter) / (a.size + b.size);
}

/** Fracción de los trigramas de `a` contenidos en `b` (para buscar `a` dentro de una línea larga). */
export function containment(a: Set<string>, b: Set<string>): number {
  if (!a.size) return 1;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  return inter / a.size;
}
