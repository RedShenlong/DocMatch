import { describe, expect, it } from 'vitest';
import { inkRatio, dhash, hashSimilarity } from '../src/image';
import { IDENTITY } from '../src/geometry/affine';
import { fuse } from '../src/fusion';
import { DEFAULT_CALIBRATION, checkProfile } from '../src/profile/types';
import { decodeF16, encodeF16, pageTensor } from '../src/vision/tensor';
import { basicChecks, hasDigitalSignature } from '../src/pdf/basic';
import { messagesFor, fmt } from '../src/i18n';

const img = (w: number, h: number, f: (x: number, y: number) => number) => {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = f(x, y);
  return { width: w, height: h, data };
};

describe('tinta', () => {
  it('distingue región vacía y con trazo', () => {
    const blank = img(200, 100, () => 250);
    const ink = img(200, 100, (x, y) => (x > 60 && x < 90 && y > 40 && y < 60 ? 20 : 250));
    const box = { x: 0.1, y: 0.2, w: 0.8, h: 0.6 };
    expect(inkRatio(blank, box, IDENTITY)).toBe(0);
    expect(inkRatio(ink, box, IDENTITY)).toBeGreaterThan(0.05);
  });
});

describe('hash perceptual', () => {
  it('idéntico = 1, distinto < 1', () => {
    const a = img(68, 64, (x) => x * 3);
    const b = img(68, 64, (x) => 255 - x * 3);
    expect(hashSimilarity(dhash(a), dhash(a))).toBe(1);
    expect(hashSimilarity(dhash(a), dhash(b))).toBeLessThan(0.9);
  });
});

describe('fusión', () => {
  it('puntúa alto un documento correcto y bajo uno ajeno', () => {
    const fw = DEFAULT_CALIBRATION.fusion.digital;
    expect(fuse([0.98, 1, 0.9, 1, NaN, NaN], fw)).toBeGreaterThan(0.9);
    expect(fuse([0.05, 0, 1, 0.5, NaN, NaN], fw)).toBeLessThan(0.05);
    expect(fuse([0.8, 0, 0.88, 1, NaN, NaN], fw)).toBeLessThan(0.5); // primo: sin título
  });
});

describe('vectores y tensores', () => {
  it('float16 ida y vuelta', () => {
    const v = new Float32Array([0.1, -0.5, 0.333, 1]);
    decodeF16(encodeF16(v)).forEach((x, i) => expect(x).toBeCloseTo(v[i]!, 2));
  });
  it('encaje (letterbox) blanco y rango [-1,1]', () => {
    const t = pageTensor(
      img(100, 200, () => 0),
      288,
      384,
    );
    expect(t[0]).toBe(1); // margen blanco
    expect(t[192 * 288 + 144]).toBe(-1); // centro negro
  });
});

describe('comprobaciones básicas y perfil', () => {
  it('magic bytes', () => {
    expect(basicChecks(new TextEncoder().encode('%PDF-1.7\n...'))).toBeNull();
    expect(basicChecks(new TextEncoder().encode('\xff\xd8\xff JPEG'))).toBe('not_pdf');
    expect(basicChecks(new Uint8Array())).toBe('empty');
  });
  it('firma electrónica', () => {
    expect(hasDigitalSignature(new TextEncoder().encode('<< /Type /Sig /ByteRange [0 1 2 3] >>'))).toBe(true);
    expect(hasDigitalSignature(new TextEncoder().encode('<< /FT /Sig >>'))).toBe(false);
  });
  it('rechaza perfiles inválidos', () => {
    expect(() => checkProfile({ schemaVersion: 99 })).toThrow();
    const p = checkProfile({
      schemaVersion: 1,
      id: 'x',
      anchors: [],
      fields: [],
      pageCount: 1,
      pages: [],
      name: 'X',
      version: '1',
      thresholds: {},
    });
    expect(p.thresholds.match).toBeGreaterThan(0);
  });
  it('mensajes es/en y personalizados', () => {
    expect(fmt(messagesFor('es').incomplete_missing, { fields: 'DNI/NIE, Firma' })).toBe(
      'Al documento le faltan datos: DNI/NIE, Firma.',
    );
    expect(messagesFor('en-GB').match).toMatch(/Correct/);
    expect(messagesFor('es', { match: 'OK' }).match).toBe('OK');
  });
});
