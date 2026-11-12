import { groupWords, type AcroValue, type DocData, type PageData, type Word } from '../doc';
import type { CanvasLike, Env, OcrWord, PdfDocument, PdfPage, PdfTextItem } from '../env';
import { binarizeForOcr, estimateSkew, renderPage, rotateCanvas, scaleCanvas, toGray } from '../image';
import { hasDigitalSignature } from './basic';

export class PdfOpenError extends Error {
  constructor(
    public readonly kind: 'encrypted' | 'corrupt',
    cause?: unknown,
  ) {
    super(kind);
    this.cause = cause;
  }
}

export async function openPdf(bytes: Uint8Array, env: Env): Promise<PdfDocument> {
  const pdfjs = await env.pdfjs();
  try {
    const task = pdfjs.getDocument({
      data: bytes.slice(),
      isEvalSupported: false,
      stopAtErrors: false,
      verbosity: 0,
      ...env.pdfOptions,
    });
    return await task.promise;
  } catch (e) {
    const name = (e as { name?: string })?.name ?? '';
    if (name === 'PasswordException') throw new PdfOpenError('encrypted', e);
    throw new PdfOpenError('corrupt', e);
  }
}

/** Palabras con caja relativa a partir del contenido de texto de pdf.js. */
export async function textWords(
  page: PdfPage,
): Promise<{ words: Word[]; width: number; height: number; chars: number }> {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const words: Word[] = [];
  let chars = 0;
  for (const it of tc.items) {
    const item = it as PdfTextItem;
    if (typeof item.str !== 'string' || !item.str.trim()) continue;
    const [a, b, c, d, e, f] = item.transform as [number, number, number, number, number, number];
    const size = Math.hypot(c, d) || Math.hypot(a, b) || item.height || 10;
    const [vx, vy] = vp.convertToViewportPoint(e, f);
    const totalW = item.width || size * 0.5 * item.str.length;
    const perChar = totalW / item.str.length;
    let offset = 0;
    for (const part of item.str.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        offset += part.length;
        continue;
      }
      chars += part.length;
      words.push({
        text: part,
        box: {
          x: (vx + offset * perChar) / vp.width,
          y: (vy - size * 0.8) / vp.height,
          w: (part.length * perChar) / vp.width,
          h: size / vp.height,
        },
        conf: 100,
      });
      offset += part.length;
    }
  }
  return { words, width: vp.width, height: vp.height, chars };
}

export async function acroValues(pdf: PdfDocument): Promise<AcroValue[]> {
  const out: AcroValue[] = [];
  let objs: Record<string, Record<string, unknown>[]> | null = null;
  try {
    objs = await pdf.getFieldObjects();
  } catch {
    return out;
  }
  if (!objs) return out;
  const sizes = new Map<number, { w: number; h: number }>();
  for (const [name, arr] of Object.entries(objs)) {
    for (const o of arr) {
      const page = typeof o.page === 'number' ? o.page : -1;
      const rect = o.rect as number[] | undefined;
      let box;
      if (rect && page >= 0) {
        let s = sizes.get(page);
        if (!s) {
          const p = await pdf.getPage(page + 1);
          const vp = p.getViewport({ scale: 1 });
          s = { w: vp.width, h: vp.height };
          sizes.set(page, s);
        }
        const [x0, y0, x1, y1] = rect as [number, number, number, number];
        box = {
          x: Math.min(x0, x1) / s.w,
          y: (s.h - Math.max(y0, y1)) / s.h,
          w: Math.abs(x1 - x0) / s.w,
          h: Math.abs(y1 - y0) / s.h,
        };
      }
      const type = String(o.type ?? '');
      let value = o.value as string | boolean | null | undefined;
      if (type === 'checkbox' || type === 'radiobutton') {
        const ex = o.exportValues ?? o.exportValue;
        value =
          value != null &&
          value !== 'Off' &&
          value !== false &&
          (ex === undefined || value === ex || value === true || typeof value === 'string');
      }
      out.push({ name, type, value: value ?? null, page, box });
    }
  }
  return out;
}

export interface ExtractOptions {
  ocr: 'auto' | 'off';
  /** Caracteres mínimos por página para considerarla digital. */
  textChars: number;
  /** Orientación esperada de la página (según el perfil): true = vertical. */
  portrait?: boolean;
  /** Anchura (px) a la que se renderiza un escaneo para el OCR. */
  ocrWidth?: number;
  onProgress?: (stage: string) => void;
}

/** Estado interno para reutilizar el PDF abierto y las imágenes renderizadas. */
export interface DocContext {
  pdf: PdfDocument;
  data: DocData;
  /** Imagen (escala de grises) de una página, alineada con las coordenadas de `PageData`. */
  pageImage(i: number): Promise<CanvasLike>;
  close(): Promise<void>;
}

const RENDER_SCALE = 150 / 72;

type OcrRes = { words: OcrWord[]; confidence: number };
const dbg = () => !!(globalThis as { DOCMATCH_DEBUG?: unknown }).DOCMATCH_DEBUG;

function ocrQuality(res: OcrRes): number {
  const good = res.words.filter((w) => w.conf > 60 && w.text.replace(/[^\p{L}\p{N}]/gu, '').length >= 3);
  return (good.length / Math.max(8, res.words.length)) * (res.confidence / 100);
}

function toWords(res: OcrRes, c: CanvasLike): Word[] {
  return res.words
    .filter((w) => /[\p{L}\p{N}]/u.test(w.text) && w.bbox.y1 - w.bbox.y0 > c.height * 0.004)
    .map((w) => ({
      text: w.text,
      conf: w.conf,
      box: {
        x: w.bbox.x0 / c.width,
        y: w.bbox.y0 / c.height,
        w: (w.bbox.x1 - w.bbox.x0) / c.width,
        h: (w.bbox.y1 - w.bbox.y0) / c.height,
      },
    }));
}

/** Une dos pasadas de OCR: si dos palabras se solapan, se queda la de mayor confianza. */
export function mergeWords(a: Word[], b: Word[]): Word[] {
  const out = [...a];
  for (const w of b) {
    const i = out.findIndex((o) => {
      const ix = Math.max(0, Math.min(o.box.x + o.box.w, w.box.x + w.box.w) - Math.max(o.box.x, w.box.x));
      const iy = Math.max(0, Math.min(o.box.y + o.box.h, w.box.y + w.box.h) - Math.max(o.box.y, w.box.y));
      return ix * iy > 0.3 * Math.min(o.box.w * o.box.h, w.box.w * w.box.h);
    });
    if (i < 0) out.push(w);
    else if (w.conf > out[i]!.conf) out[i] = w;
  }
  return out;
}

async function ocrPage(canvas: CanvasLike, env: Env, portrait: boolean | undefined) {
  const engine = await env.ocr!();
  // Orientación: candidatos según la forma de la página; texto al revés da confianza muy baja.
  const landscape = canvas.width > canvas.height * 1.05;
  const cands = portrait !== false && landscape ? [90, 270] : [0, 180];
  let best: { rot: number; canvas: CanvasLike; words: Word[]; quality: number } | null = null;
  for (const rot of cands) {
    let c = rot ? rotateCanvas(canvas, rot, env) : canvas;
    const skew = estimateSkew(toGray(scaleCanvas(c, Math.round(c.width / 2), Math.round(c.height / 2), env)));
    if (Math.abs(skew) >= 0.3) c = rotateCanvas(c, skew, env);
    // Pasada 1: binarización adaptativa propia (rápida, robusta a sombras y marcos).
    const r1 = await engine.recognize(binarizeForOcr(c, env, 0.15));
    const q1 = ocrQuality(r1);
    if (dbg()) console.log(`[ocr] rot=${rot} skew=${skew} q1=${q1.toFixed(2)} conf=${r1.confidence}`);
    let words = toWords(r1, c);
    let quality = q1;
    // Pasada 2 solo si la primera es floja y la orientación parece correcta: gris + Otsu de Tesseract.
    if (q1 >= 0.06 && q1 < 0.3) {
      const r2 = await engine.recognize(c);
      const q2 = ocrQuality(r2);
      if (dbg()) console.log(`[ocr]   pass2 q2=${q2.toFixed(2)} conf=${r2.confidence}`);
      words = mergeWords(q2 > q1 ? toWords(r2, c) : words, q2 > q1 ? words : toWords(r2, c));
      quality = Math.max(q1, q2);
    }
    if (!best || quality > best.quality) best = { rot: rot + skew, canvas: c, words, quality };
    if (quality >= 0.06) break;
  }
  return best!;
}

export async function extract(bytes: Uint8Array, env: Env, opts: ExtractOptions): Promise<DocContext> {
  const pdf = await openPdf(bytes, env);
  const pages: PageData[] = [];
  const images = new Map<number, CanvasLike>();
  let textChars = 0;
  let kind: 'digital' | 'scan' = 'digital';
  try {
    for (let i = 0; i < pdf.numPages; i++) {
      const page = await pdf.getPage(i + 1);
      const tw = await textWords(page);
      textChars += tw.chars;
      if (tw.chars >= opts.textChars || opts.ocr === 'off' || !env.ocr) {
        pages.push({
          index: i,
          width: tw.width,
          height: tw.height,
          words: tw.words,
          segments: groupWords(tw.words, tw.width / tw.height),
          source: 'text',
          rotation: 0,
        });
        continue;
      }
      kind = 'scan';
      opts.onProgress?.('ocr');
      const vp = page.getViewport({ scale: 1 });
      const ow = opts.ocrWidth ?? 1650;
      const scale = ow / Math.min(vp.width, vp.height);
      const canvas = await renderPage(page, scale, env);
      const r = await ocrPage(canvas, env, opts.portrait);
      images.set(i, r.canvas);
      pages.push({
        index: i,
        width: r.canvas.width / scale,
        height: r.canvas.height / scale,
        words: r.words,
        segments: groupWords(r.words, r.canvas.width / r.canvas.height, 1.8),
        source: 'ocr',
        rotation: r.rot,
      });
      page.cleanup();
    }
  } catch (e) {
    await pdf.destroy();
    if (dbg()) console.warn('[docmatch] error al extraer', e);
    if (e instanceof PdfOpenError) throw e;
    // Solo los fallos de pdf.js indican un PDF dañado; el resto (OCR, recursos) son errores internos.
    if (
      e &&
      typeof e === 'object' &&
      /PDF|Invalid|Missing|Unexpected/i.test(
        String((e as { name?: string }).name ?? '') + String((e as Error).message ?? ''),
      ) &&
      !/worker|fetch|import|createWorker/i.test(String((e as Error).message))
    )
      throw new PdfOpenError('corrupt', e);
    throw e;
  }
  const acro = await acroValues(pdf);
  const data: DocData = {
    kind,
    pages,
    acro,
    hasDigitalSignature:
      hasDigitalSignature(bytes) ||
      acro.some((a) => a.type === 'signature' && a.value != null && a.value !== ''),
    textChars,
    fullText: pages.map((p) => p.segments.map((s) => s.text).join('\n')).join('\n'),
  };
  return {
    pdf,
    data,
    async pageImage(i: number) {
      let c = images.get(i);
      if (!c) {
        const page = await pdf.getPage(i + 1);
        c = await renderPage(page, RENDER_SCALE, env);
        images.set(i, c);
      }
      return c;
    },
    close: () => pdf.destroy(),
  };
}
