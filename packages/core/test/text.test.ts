import { describe, expect, it } from 'vitest';
import { compact, digitsFromOcr, fold, normalize } from '../src/text/normalize';
import { containment, dice, levenshtein, levRatio, trigrams } from '../src/text/fuzzy';
import { groupWords } from '../src/doc';

describe('normalización', () => {
  it('minúsculas, sin acentos y espacios colapsados', () =>
    expect(normalize('  Solicitud   de LICENCIA  ÁÉÍÓÚ ')).toBe('solicitud de licencia aeiou'));
  it('pliega confusiones de OCR (0/O, 1/l/I, 5/S) y puntuación', () => {
    expect(fold('MODELO EJ-101')).toBe(fold('M0DELO EJ lOl'));
    expect(fold('Sí: 5 euros')).toBe(fold('si s euros'));
  });
  it('dígitos desde OCR', () => expect(digitsFromOcr('l2O4S6B')).toBe('1204568'));
  it('compacta', () => expect(compact('12.345.678-z')).toBe('12345678Z'));
});

describe('coincidencia difusa', () => {
  it('Levenshtein', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levRatio('solicitud', 'solicitud')).toBe(1);
    expect(levRatio('solicitud de licencia', 'so1icitud de licenda')).toBeGreaterThan(0.85);
  });
  it('trigramas', () => {
    const a = trigrams('datos de la persona');
    expect(dice(a, trigrams('datos de la persona'))).toBe(1);
    expect(dice(a, trigrams('factura simplificada'))).toBeLessThan(0.2);
    expect(containment(trigrams('nombre'), trigrams('nombre lucia garcia'))).toBe(1);
  });
});

describe('agrupación de palabras en segmentos', () => {
  const w = (text: string, x: number, y: number, ww = 0.05) => ({
    text,
    conf: 100,
    box: { x, y, w: ww, h: 0.012 },
  });
  it('separa etiqueta y valor alejados en la misma línea', () => {
    const segs = groupWords([w('Nombre:', 0.1, 0.2), w('Lucía', 0.3, 0.2), w('García', 0.36, 0.201)], 0.707);
    expect(segs.map((s) => s.text)).toEqual(['Nombre:', 'Lucía García']);
  });
  it('líneas distintas', () => {
    const segs = groupWords([w('A', 0.1, 0.2), w('B', 0.1, 0.25)], 0.707);
    expect(segs).toHaveLength(2);
  });
});
