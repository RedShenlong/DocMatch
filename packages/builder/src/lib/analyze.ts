import {
  acroValues,
  groupWords,
  openPdf,
  textWords,
  type Env,
  type PdfPage,
  type RelBox,
  type Segment,
} from 'docmatch/internal';

export interface Shape {
  kind: 'rect' | 'hline';
  box: RelBox;
}

export interface TemplatePage {
  index: number;
  width: number;
  height: number;
  segments: Segment[];
  shapes: Shape[];
  /** Altura media de letra de cada segmento, en puntos. */
}

export interface AcroInfo {
  name: string;
  type: string;
  page: number;
  box?: RelBox;
}

export interface TemplateAnalysis {
  pages: TemplatePage[];
  acro: AcroInfo[];
  textChars: number;
}

type M = [number, number, number, number, number, number];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
const tp = (m: M, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] as const;

/**
 * Rectángulos y líneas horizontales dibujados en la página (cajas de campos, subrayados, casillas),
 * a partir de la lista de operadores de pdf.js.
 */
export async function extractShapes(page: PdfPage, OPS: Record<string, number>): Promise<Shape[]> {
  const vp = page.getViewport({ scale: 1 });
  const W = vp.width,
    H = vp.height;
  const ol = await page.getOperatorList();
  const shapes: Shape[] = [];
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  let pending: [number, number][][] = [];
  const finish = () => {
    for (const pts of pending) {
      if (pts.length < 2) continue;
      const xs = pts.map((p) => p[0]),
        ys = pts.map((p) => p[1]);
      const x0 = Math.min(...xs),
        x1 = Math.max(...xs),
        y0 = Math.min(...ys),
        y1 = Math.max(...ys);
      const w = x1 - x0,
        h = y1 - y0;
      const axis = pts.every((p, i) => {
        const q = pts[(i + 1) % pts.length]!;
        return Math.abs(p[0] - q[0]) < 0.5 || Math.abs(p[1] - q[1]) < 0.5;
      });
      // PDF: origen abajo-izquierda → relativo arriba-izquierda.
      const box = { x: x0 / W, y: (H - y1) / H, w: w / W, h: h / H };
      if (h < 1.2 && w > 15) shapes.push({ kind: 'hline', box });
      else if (axis && pts.length >= 4 && w > 4 && h > 4 && w < W * 0.98) shapes.push({ kind: 'rect', box });
    }
    pending = [];
  };
  const { fnArray, argsArray } = ol;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = mul(args as M, ctm);
    else if (fn === OPS.constructPath) {
      const ops = args[0] as number[];
      const coords = args[1] as number[];
      let k = 0;
      let cur: [number, number][] = [];
      for (const op of ops) {
        if (op === OPS.rectangle) {
          const [x, y, w, h] = coords.slice(k, k + 4) as [number, number, number, number];
          k += 4;
          pending.push(
            [tp(ctm, x, y), tp(ctm, x + w, y), tp(ctm, x + w, y + h), tp(ctm, x, y + h)].map(
              (p) => [p[0], p[1]] as [number, number],
            ),
          );
        } else if (op === OPS.moveTo) {
          if (cur.length) pending.push(cur);
          const p = tp(ctm, coords[k]!, coords[k + 1]!);
          cur = [[p[0], p[1]]];
          k += 2;
        } else if (op === OPS.lineTo) {
          const p = tp(ctm, coords[k]!, coords[k + 1]!);
          cur.push([p[0], p[1]]);
          k += 2;
        } else if (op === OPS.curveTo) {
          k += 6;
          cur = [];
        } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
          k += 4;
          cur = [];
        } else if (op === OPS.closePath) {
          /* el polígono ya está en cur */
        }
      }
      if (cur.length) pending.push(cur);
    } else if (
      fn === OPS.stroke ||
      fn === OPS.closeStroke ||
      fn === OPS.fill ||
      fn === OPS.eoFill ||
      fn === OPS.fillStroke ||
      fn === OPS.eoFillStroke ||
      fn === OPS.closeFillStroke ||
      fn === OPS.closeEOFillStroke
    ) {
      finish();
    } else if (fn === OPS.endPath) pending = [];
  }
  finish();
  // Elimina duplicados (relleno + trazo del mismo rectángulo).
  const out: Shape[] = [];
  for (const s of shapes) {
    if (
      !out.some(
        (o) =>
          o.kind === s.kind &&
          Math.abs(o.box.x - s.box.x) < 0.002 &&
          Math.abs(o.box.y - s.box.y) < 0.002 &&
          Math.abs(o.box.w - s.box.w) < 0.003 &&
          Math.abs(o.box.h - s.box.h) < 0.003,
      )
    )
      out.push(s);
  }
  return out;
}

export async function analyzeTemplate(bytes: Uint8Array, env: Env): Promise<TemplateAnalysis> {
  const pdfjs = await env.pdfjs();
  const pdf = await openPdf(bytes, env);
  const pages: TemplatePage[] = [];
  let textChars = 0;
  try {
    for (let i = 0; i < pdf.numPages; i++) {
      const page = await pdf.getPage(i + 1);
      const tw = await textWords(page);
      textChars += tw.chars;
      pages.push({
        index: i,
        width: tw.width,
        height: tw.height,
        segments: groupWords(tw.words, tw.width / tw.height),
        shapes: await extractShapes(page, pdfjs.OPS),
      });
    }
    const acro = (await acroValues(pdf)).map(({ name, type, page, box }) => ({ name, type, page, box }));
    return { pages, acro, textChars };
  } finally {
    await pdf.destroy();
  }
}
