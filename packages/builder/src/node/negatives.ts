/**
 * Banco de negativos: embeddings de documentos genéricos ficticios (facturas, nóminas, contratos,
 * certificados, cartas, recibos…), calculados con el MISMO preprocesado que el navegador.
 *   tsx src/node/negatives.ts [modelDir] [porTipo=36]
 * Escribe <modelDir>/negatives.json (objetivo: ≤ 500 KB).
 */
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CORE_ASSETS, nodeEnv } from 'docmatch/node';
import { encodeF16, l2norm, openPdf, pageTensor, renderPage, toGray } from 'docmatch/internal';
import {
  FOREIGN_KINDS,
  Rng,
  degrade,
  randomScanParams,
  renderForeign,
  type CanvasLike,
} from '@docmatch/fixtures';

const modelDir = process.argv[2] ?? join(CORE_ASSETS, 'model');
const perKind = Number(process.argv[3] ?? 36);
const env = nodeEnv({ modelDir, ocr: false });
const engine = await env.vision!();
if (!engine) throw new Error(`No hay modelo en ${modelDir}`);
const r = new Rng(777);
const labels: string[] = [];
const vectors: string[] = [];
for (const kind of FOREIGN_KINDS) {
  for (let i = 0; i < perKind; i++) {
    const pdf = await openPdf(await renderForeign(kind, 100000 + i * 17), env);
    let c = await renderPage(await pdf.getPage(1), 100 / 72, env);
    await pdf.destroy();
    if (i % 2)
      c = degrade(
        c as unknown as CanvasLike,
        randomScanParams(r, 1),
        (w, h) => env.createCanvas(w, h) as unknown as CanvasLike,
        r,
      ) as never;
    const e = l2norm(await engine.embed(pageTensor(toGray(c), engine.input.width, engine.input.height)));
    labels.push(kind);
    vectors.push(encodeF16(e));
  }
  process.stdout.write(`${kind} `);
}
const out = join(modelDir, 'negatives.json');
writeFileSync(
  out,
  JSON.stringify({ modelId: engine.modelId, modelVersion: engine.modelVersion, labels, vectors }),
);
console.log(`\n${labels.length} vectores → ${out} (${(statSync(out).size / 1024).toFixed(0)} KB)`);
