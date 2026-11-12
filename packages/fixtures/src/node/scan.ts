import type { Canvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { degrade, randomScanParams, type ScanParams } from '../augment';
import { Rng } from '../rng';
import { makeCanvas, renderPdfPages } from './pdfjs';

/** Convierte un PDF digital en un "escaneo": páginas rasterizadas degradadas y JPEG dentro de un PDF. */
export async function simulateScan(
  pdf: Uint8Array,
  seed: number,
  opts: { dpi?: number; strength?: number; override?: Partial<ScanParams> } = {},
): Promise<Uint8Array> {
  const r = new Rng(seed);
  const dpi = opts.dpi ?? 150;
  const pages = await renderPdfPages(pdf, dpi);
  const out = await PDFDocument.create();
  out.setProducer('docmatch-fixtures scanner');
  for (const page of pages) {
    const p = { ...randomScanParams(r, opts.strength ?? 1), ...opts.override };
    const c = degrade(page, p, makeCanvas, r) as unknown as Canvas;
    const jpg = await c.encode('jpeg', Math.round(p.jpegQuality * 100));
    const img = await out.embedJpg(jpg);
    const w = (c.width * 72) / dpi;
    const h = (c.height * 72) / dpi;
    const pg = out.addPage([w, h]);
    pg.drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  return out.save({ useObjectStreams: false });
}
