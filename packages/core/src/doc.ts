import type { RelBox } from './profile/types';
import { fold, normalize } from './text/normalize';
import { trigrams } from './text/fuzzy';

export interface Word {
  text: string;
  box: RelBox;
  /** Confianza 0–100 (100 en PDFs digitales). */
  conf: number;
}

/** Fragmento de línea: palabras contiguas en la misma línea base. */
export interface Segment {
  text: string;
  norm: string;
  fold: string;
  tri: Set<string>;
  box: RelBox;
  words: Word[];
  conf: number;
}

export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface PageData {
  index: number;
  width: number;
  height: number;
  words: Word[];
  segments: Segment[];
  source: 'text' | 'ocr';
  /** Rotación aplicada (grados) para enderezar la página. */
  rotation: number;
  image?: GrayImage;
}

export interface AcroValue {
  name: string;
  type: string;
  value: string | boolean | null;
  page: number;
  box?: RelBox;
}

export interface DocData {
  kind: 'digital' | 'scan';
  pages: PageData[];
  acro: AcroValue[];
  hasDigitalSignature: boolean;
  textChars: number;
  fullText: string;
}

export function union(boxes: RelBox[]): RelBox {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function makeSegment(words: Word[]): Segment {
  const text = words.map((w) => w.text).join(' ');
  const f = fold(text);
  return {
    text,
    norm: normalize(text),
    fold: f,
    tri: trigrams(f),
    box: union(words.map((w) => w.box)),
    words,
    conf: words.reduce((a, w) => a + w.conf, 0) / Math.max(1, words.length),
  };
}

/**
 * Agrupa palabras en segmentos: misma línea base y separación horizontal menor que `gapFactor`
 * veces la altura de la letra. Así "Nombre:" y su valor dentro de la caja quedan separados.
 */
export function groupWords(words: Word[], pageAspect: number, gapFactor = 1.6): Segment[] {
  const ws = words
    .filter((w) => w.text.trim())
    .sort((a, b) => a.box.y + a.box.h / 2 - (b.box.y + b.box.h / 2));
  const lines: Word[][] = [];
  for (const w of ws) {
    const cy = w.box.y + w.box.h / 2;
    let best: Word[] | undefined;
    let bestD = Infinity;
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i--) {
      const L = lines[i]!;
      const ref = L[L.length - 1]!;
      const d = Math.abs(ref.box.y + ref.box.h / 2 - cy);
      if (d < Math.min(ref.box.h, w.box.h) * 0.6 && d < bestD) {
        best = L;
        bestD = d;
      }
    }
    if (best) best.push(w);
    else lines.push([w]);
  }
  const segs: Segment[] = [];
  for (const L of lines) {
    L.sort((a, b) => a.box.x - b.box.x);
    let cur: Word[] = [];
    for (const w of L) {
      const prev = cur[cur.length - 1];
      // h es relativo a la altura y w a la anchura: se convierte con el aspecto de la página.
      const gap = prev ? (w.box.x - (prev.box.x + prev.box.w)) * pageAspect : 0;
      const hgt = prev ? Math.max(prev.box.h, w.box.h) : 0;
      if (prev && gap > hgt * gapFactor) {
        segs.push(makeSegment(cur));
        cur = [];
      }
      cur.push(w);
    }
    if (cur.length) segs.push(makeSegment(cur));
  }
  return segs;
}
