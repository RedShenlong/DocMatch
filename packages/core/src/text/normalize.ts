/** Minúsculas, sin acentos, espacios colapsados. Conserva la puntuación útil para leer valores. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Forma "plegada" para comparar texto de plantilla con texto de OCR: además de normalizar,
 * elimina la puntuación y unifica las confusiones típicas (0/O, 1/l/I, 5/S).
 */
export function fold(s: string): string {
  return normalize(s)
    .replace(/[0]/g, 'o')
    .replace(/[1|!i]/g, 'l')
    .replace(/[5]/g, 's')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Corrige confusiones de OCR en un valor que debería ser numérico (posiciones de dígitos). */
export function digitsFromOcr(s: string): string {
  return s
    .replace(/[oOQD]/g, '0')
    .replace(/[lLI|!i]/g, '1')
    .replace(/[sS]/g, '5')
    .replace(/[B]/g, '8')
    .replace(/[zZ]/g, '2')
    .replace(/[g]/g, '9');
}

export function compact(s: string): string {
  return s.replace(/[\s.\-_/]+/g, '').toUpperCase();
}
