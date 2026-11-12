import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb, type RGB } from 'pdf-lib';
import { Rng } from './rng';
import type { FieldLayout, FieldSpec, FillOptions, TemplateLayout, TemplateSpec } from './spec';

export const A4 = { width: 595.28, height: 841.89 };

/** Fuentes manuscritas: se inyectan como bytes para que el módulo funcione en Node y en navegador. */
let handFonts: Uint8Array[] = [];
export function setHandFonts(fonts: Uint8Array[]): void {
  handFonts = fonts;
}

const FONT_MAP = {
  Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  TimesRoman: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
  Courier: [StandardFonts.Courier, StandardFonts.CourierBold],
} as const;

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) > width && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  pages: PDFPage[];
  y: number; // distancia desde arriba
  reg: PDFFont;
  bold: PDFFont;
  spec: TemplateSpec;
  fields: FieldLayout[];
  accent: RGB;
}

function text(
  c: Ctx,
  s: string,
  x: number,
  y: number,
  size: number,
  font = c.reg,
  color: RGB = rgb(0, 0, 0),
) {
  c.page.drawText(s, { x, y: c.page.getHeight() - y - size * 0.8, size, font, color });
}

function drawLogo(c: Ctx, x: number, y: number) {
  const { page, accent } = c;
  const H = page.getHeight();
  const kind = c.spec.style.logo;
  if (kind === 'circle') {
    page.drawCircle({ x: x + 17, y: H - y - 17, size: 17, borderColor: accent, borderWidth: 2 });
    page.drawCircle({ x: x + 17, y: H - y - 17, size: 9, color: accent });
  } else if (kind === 'square') {
    page.drawRectangle({ x, y: H - y - 34, width: 34, height: 34, color: accent });
    page.drawRectangle({ x: x + 8, y: H - y - 26, width: 18, height: 18, color: rgb(1, 1, 1) });
  } else if (kind === 'shield') {
    page.drawSvgPath('M 0 0 L 32 0 L 32 18 Q 32 32 16 38 Q 0 32 0 18 Z', {
      x,
      y: H - y,
      color: accent,
    });
    page.drawSvgPath('M 8 8 L 24 8 L 24 18 Q 24 26 16 30 Q 8 26 8 18 Z', {
      x,
      y: H - y,
      color: rgb(1, 1, 1),
    });
  }
}

function header(c: Ctx, continuation: boolean) {
  const { spec, page } = c;
  const st = spec.style;
  const m = st.margin;
  const W = page.getWidth();
  const top = m - 10;
  const hasLogo = st.logo !== 'none';
  if (hasLogo) drawLogo(c, m, top);
  const orgSize = st.fontSize + 3;
  const ox =
    st.headerAlign === 'center'
      ? (W - c.bold.widthOfTextAtSize(spec.organismo, orgSize)) / 2
      : m + (hasLogo ? 46 : 0);
  text(c, spec.organismo, ox, top + 4, orgSize, c.bold, c.accent);
  if (spec.dept) {
    const dx = st.headerAlign === 'center' ? (W - c.reg.widthOfTextAtSize(spec.dept, st.fontSize)) / 2 : ox;
    text(c, spec.dept, dx, top + 6 + orgSize, st.fontSize, c.reg);
  }
  if (spec.code) {
    const cw = c.reg.widthOfTextAtSize(spec.code, st.fontSize) + 12;
    page.drawRectangle({
      x: W - m - cw,
      y: page.getHeight() - top - 18,
      width: cw,
      height: 18,
      borderColor: rgb(0, 0, 0),
      borderWidth: 0.8,
    });
    text(c, spec.code, W - m - cw + 6, top + 5, st.fontSize);
  }
  c.y = top + 44;
  if (st.headerBar) {
    page.drawRectangle({ x: m, y: page.getHeight() - c.y, width: W - 2 * m, height: 3, color: c.accent });
    c.y += 10;
  }
  if (continuation) {
    text(c, `${spec.title} (continuación)`, m, c.y, st.fontSize + 1, c.bold);
    c.y += st.fontSize + 12;
  }
}

function paragraph(c: Ctx, s: string, size: number, font = c.reg) {
  const m = c.spec.style.margin;
  const W = c.page.getWidth() - 2 * m;
  for (const line of wrap(s, font, size, W)) {
    text(c, line, m, c.y, size, font);
    c.y += size * 1.35;
  }
}

function newPage(c: Ctx) {
  c.page = c.doc.addPage([A4.width, A4.height]);
  c.pages.push(c.page);
  header(c, true);
}

/** ¿La etiqueta va encima del campo? (por estilo o porque no cabe a la izquierda) */
function labelAbove(c: Ctx, row: FieldSpec[], f: FieldSpec): boolean {
  const st = c.spec.style;
  if (st.labelPos === 'above') return true;
  const total = c.page.getWidth() - 2 * st.margin;
  const sumW = row.reduce((a, g) => a + (g.w ?? 1), 0);
  const fw = ((f.w ?? 1) / sumW) * (total - 10 * (row.length - 1));
  return c.reg.widthOfTextAtSize(f.label, st.fontSize) + 6 > fw - 60;
}

function rowHeight(c: Ctx, row: FieldSpec[]): number {
  const st = c.spec.style;
  const above = row.some((f) => f.type !== 'checkbox' && labelAbove(c, row, f));
  if (row.some((f) => f.type === 'signature')) return 70 + (above ? st.fontSize + 4 : 0);
  if (row.every((f) => f.type === 'checkbox')) return 14;
  return above ? st.fontSize + 22 : 20;
}

function drawRow(c: Ctx, row: FieldSpec[]) {
  const st = c.spec.style;
  const m = st.margin;
  const H = c.page.getHeight();
  const W = c.page.getWidth();
  const total = W - 2 * m;
  const gap = 10;
  const sumW = row.reduce((a, f) => a + (f.w ?? 1), 0);
  let x = m;
  const y0 = c.y;
  const pageIdx = c.pages.length - 1;
  for (const f of row) {
    const fw = ((f.w ?? 1) / sumW) * (total - gap * (row.length - 1));
    let box = { x: 0, y: 0, w: 0, h: 0 };
    if (f.type === 'checkbox') {
      c.page.drawRectangle({
        x,
        y: H - y0 - 11,
        width: 10,
        height: 10,
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.8,
      });
      text(c, f.label, x + 16, y0 + 1, st.fontSize);
      box = { x, y: y0 + 1, w: 10, h: 10 };
    } else {
      // Si la etiqueta no cabe a la izquierda dejando sitio al valor, se coloca encima.
      const above = labelAbove(c, row, f);
      const lw = above ? 0 : c.reg.widthOfTextAtSize(f.label, st.fontSize) + 6;
      const bh = f.type === 'signature' ? 62 : above ? 16 : 18;
      const by = above ? y0 + st.fontSize + 4 : y0;
      text(
        c,
        f.label,
        x,
        above ? y0 : y0 + (f.type === 'signature' ? 2 : (18 - st.fontSize) / 2),
        st.fontSize,
      );
      const bx = x + lw;
      const bw = fw - lw;
      if (st.fieldStyle === 'box' || f.type === 'signature') {
        c.page.drawRectangle({
          x: bx,
          y: H - by - bh,
          width: bw,
          height: bh,
          borderColor: rgb(0.2, 0.2, 0.2),
          borderWidth: 0.7,
        });
      } else {
        c.page.drawLine({
          start: { x: bx, y: H - by - bh + 2 },
          end: { x: bx + bw, y: H - by - bh + 2 },
          thickness: 0.7,
          color: rgb(0.2, 0.2, 0.2),
        });
      }
      box = { x: bx, y: by, w: bw, h: bh };
    }
    c.fields.push({
      ...f,
      page: pageIdx,
      box: { x: box.x / W, y: box.y / H, w: box.w / W, h: box.h / H },
    });
    x += fw + gap;
  }
  c.y += rowHeight(c, row) + st.rowGap;
}

export async function drawTemplate(
  spec: TemplateSpec,
): Promise<{ doc: PDFDocument; layout: TemplateLayout; fonts: { reg: PDFFont; bold: PDFFont } }> {
  const doc = await PDFDocument.create();
  doc.setTitle(spec.title);
  doc.setProducer('docmatch-fixtures');
  doc.setCreator('docmatch-fixtures');
  const [r, b] = FONT_MAP[spec.style.font];
  const reg = await doc.embedFont(r);
  const bold = await doc.embedFont(b);
  const page = doc.addPage([A4.width, A4.height]);
  const st = spec.style;
  const c: Ctx = { doc, page, pages: [page], y: 0, reg, bold, spec, fields: [], accent: rgb(...st.accent) };
  header(c, false);
  const W = page.getWidth();
  const ts = st.fontSize + 6;
  for (const line of wrap(spec.title, bold, ts, W - 2 * st.margin)) {
    const tx = st.headerAlign === 'center' ? (W - bold.widthOfTextAtSize(line, ts)) / 2 : st.margin;
    text(c, line, tx, c.y, ts, bold);
    c.y += ts * 1.3;
  }
  if (spec.subtitle) {
    const tx =
      st.headerAlign === 'center'
        ? (W - reg.widthOfTextAtSize(spec.subtitle, st.fontSize + 1)) / 2
        : st.margin;
    text(c, spec.subtitle, tx, c.y, st.fontSize + 1);
    c.y += st.fontSize * 1.6;
  }
  c.y += 4;
  paragraph(c, spec.purpose, st.fontSize);
  c.y += 8;
  const bottomLimit = A4.height - st.margin - 40;
  spec.sections.forEach((sec, i) => {
    if (i === spec.pageBreakBefore) newPage(c);
    const need = 30 + sec.rows.reduce((a, row) => a + rowHeight(c, row) + st.rowGap, 0) + (sec.text ? 40 : 0);
    if (c.y + Math.min(need, 120) > bottomLimit) newPage(c);
    const m = st.margin;
    const H = c.page.getHeight();
    if (st.sectionStyle === 'bar') {
      c.page.drawRectangle({
        x: m,
        y: H - c.y - 16,
        width: W - 2 * m,
        height: 16,
        color: rgb(...(st.accent.map((v) => 0.8 + v * 0.3) as [number, number, number])),
      });
      text(c, sec.title, m + 5, c.y + 4, st.fontSize + 1, bold);
      c.y += 24;
    } else {
      text(c, sec.title, m, c.y, st.fontSize + 1, bold, c.accent);
      c.y += st.fontSize + 5;
      if (st.sectionStyle === 'rule')
        c.page.drawLine({
          start: { x: m, y: H - c.y },
          end: { x: W - m, y: H - c.y },
          thickness: 0.8,
          color: c.accent,
        });
      c.y += 8;
    }
    if (sec.text) {
      paragraph(c, sec.text, st.fontSize - 0.5);
      c.y += 6;
    }
    for (const row of sec.rows) {
      if (c.y + rowHeight(c, row) > bottomLimit) newPage(c);
      drawRow(c, row);
    }
    c.y += 6;
  });
  const n = c.pages.length;
  c.pages.forEach((p, i) => {
    const s = st.fontSize - 1.5;
    const label = `${spec.footer}    Página ${i + 1} de ${n}`;
    p.drawLine({
      start: { x: st.margin, y: st.margin - 4 },
      end: { x: W - st.margin, y: st.margin - 4 },
      thickness: 0.4,
      color: rgb(0.5, 0.5, 0.5),
    });
    p.drawText(label, { x: st.margin, y: st.margin - 16, size: s, font: reg, color: rgb(0.3, 0.3, 0.3) });
  });
  return {
    doc,
    fonts: { reg, bold },
    layout: {
      pageCount: n,
      pageSize: c.pages.map((p) => ({ width: p.getWidth(), height: p.getHeight() })),
      fields: c.fields,
    },
  };
}

/** Garabato de firma con curvas de Bézier aleatorias (trayectoria SVG relativa a la caja). */
export function signaturePath(r: Rng, w: number, h: number): string {
  let x = w * r.range(0.08, 0.2);
  let y = h * r.range(0.4, 0.6);
  let d = `M ${x.toFixed(1)} ${y.toFixed(1)}`;
  const n = r.int(4, 8);
  const step = (w * r.range(0.45, 0.75)) / n;
  for (let i = 0; i < n; i++) {
    const nx = x + step * r.range(0.6, 1.4);
    const ny = h * r.range(0.25, 0.75);
    d += ` C ${(x + step * 0.3).toFixed(1)} ${(h * r.range(0.05, 0.95)).toFixed(1)}, ${(nx - step * 0.3).toFixed(1)} ${(h * r.range(0.05, 0.95)).toFixed(1)}, ${nx.toFixed(1)} ${ny.toFixed(1)}`;
    x = nx;
    y = ny;
  }
  if (r.bool(0.6))
    d += ` M ${(w * 0.1).toFixed(1)} ${(h * r.range(0.6, 0.8)).toFixed(1)} Q ${(w * 0.4).toFixed(1)} ${(h * 0.95).toFixed(1)}, ${(x * 0.95).toFixed(1)} ${(h * r.range(0.6, 0.85)).toFixed(1)}`;
  return d;
}

/** Rellena una plantilla ya dibujada. Devuelve los bytes del PDF. */
export async function fillTemplate(
  doc: PDFDocument,
  layout: TemplateLayout,
  opts: FillOptions,
): Promise<void> {
  const r = new Rng(opts.seed);
  const pages = doc.getPages();
  const typed = await doc.embedFont(StandardFonts.Helvetica);
  let hand: PDFFont | undefined;
  if (opts.mode === 'hand') {
    if (!handFonts.length) throw new Error('setHandFonts() no se ha llamado');
    doc.registerFontkit(fontkit);
    hand = await doc.embedFont(r.pick(handFonts), { subset: true });
  }
  const ink =
    opts.mode === 'hand'
      ? r.pick([rgb(0.05, 0.1, 0.45), rgb(0.08, 0.08, 0.1), rgb(0.1, 0.15, 0.55)])
      : rgb(0, 0, 0);
  const form = opts.acroform ? doc.getForm() : undefined;
  const omit = new Set(opts.omit ?? []);
  for (const fl of layout.fields) {
    if (omit.has(fl.key)) continue;
    const page = pages[fl.page] as PDFPage;
    const W = page.getWidth();
    const H = page.getHeight();
    const bx = fl.box.x * W;
    const bw = fl.box.w * W;
    const bh = fl.box.h * H;
    const byTop = fl.box.y * H;
    const bottom = H - byTop - bh;
    if (fl.type === 'signature') {
      if (!opts.signed) continue;
      const sw = Math.min(bw, 220);
      page.drawSvgPath(signaturePath(r, sw, bh), {
        x: bx + r.range(4, Math.max(5, bw - sw)),
        y: H - byTop,
        borderColor: opts.mode === 'hand' ? ink : rgb(0.05, 0.1, 0.4),
        borderWidth: r.range(0.9, 1.6),
      });
      continue;
    }
    const value = opts.values[fl.key];
    if (value === undefined || value === '') continue;
    if (fl.type === 'checkbox') {
      if (form) {
        const cb = form.createCheckBox(`${fl.key}`);
        cb.addToPage(page, { x: bx, y: bottom, width: bw, height: bh, borderWidth: 0 });
        cb.check();
      } else if (opts.mode === 'hand') {
        const j = () => r.range(-1.5, 1.5);
        page.drawLine({
          start: { x: bx + j(), y: bottom + j() },
          end: { x: bx + bw + j(), y: bottom + bh + j() },
          thickness: 1.3,
          color: ink,
        });
        page.drawLine({
          start: { x: bx + j(), y: bottom + bh + j() },
          end: { x: bx + bw + j(), y: bottom + j() },
          thickness: 1.3,
          color: ink,
        });
      } else {
        page.drawText('X', { x: bx + 1.5, y: bottom + 1.5, size: 9, font: typed });
      }
      continue;
    }
    if (form) {
      const tf = form.createTextField(fl.key);
      tf.setText(value);
      tf.addToPage(page, {
        x: bx + 1,
        y: bottom + 1,
        width: bw - 2,
        height: bh - 2,
        borderWidth: 0,
        font: typed,
      });
      tf.setFontSize(9);
      continue;
    }
    const font = hand ?? typed;
    let size = opts.mode === 'hand' ? Math.min(bh * 0.95, r.range(12, 16)) : 9.5;
    while (font.widthOfTextAtSize(value, size) > bw - 8 && size > 5) size -= 0.5;
    page.drawText(value, {
      x: bx + (opts.mode === 'hand' ? r.range(3, 10) : 4),
      y:
        bottom +
        (opts.mode === 'hand' ? Math.max(2, (bh - size) / 2 + r.range(-1.5, 2)) : (bh - size) / 2 + 1.5),
      size,
      font,
      color: ink,
      rotate: opts.mode === 'hand' ? degrees(r.range(-2, 2)) : undefined,
    });
  }
  if (form) form.updateFieldAppearances(typed);
  if (opts.csv) {
    const p = pages[0] as PDFPage;
    let code = '';
    for (let i = 0; i < 20; i++) code += 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[r.int(0, 31)];
    p.drawRectangle({
      x: 48,
      y: 62,
      width: p.getWidth() - 96,
      height: 26,
      borderColor: rgb(0.4, 0.4, 0.4),
      borderWidth: 0.5,
    });
    p.drawText(`Código Seguro de Verificación (CSV): ${code}`, { x: 54, y: 76, size: 8, font: typed });
    p.drawText('Puede verificar este documento en https://sede.example/verificar', {
      x: 54,
      y: 66,
      size: 7,
      font: typed,
    });
  }
}

export async function renderDocument(
  spec: TemplateSpec,
  fill?: FillOptions,
): Promise<{ bytes: Uint8Array; layout: TemplateLayout }> {
  const { doc, layout } = await drawTemplate(spec);
  if (fill) await fillTemplate(doc, layout, fill);
  return { bytes: await doc.save({ useObjectStreams: false }), layout };
}
