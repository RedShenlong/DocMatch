/**
 * Datos sintéticos para entrenar el encoder visual (packages/model).
 *
 *   tsx src/node/training.ts <salida> [familias=300] [dpi=72]
 *
 * Por cada familia de plantillas (semillas de entrenamiento, nunca las del hold-out) genera la plantilla
 * y una "prima" (mismo diseño, distinto título) como clases distintas, y para cada una la versión vacía
 * y varias rellenas (a máquina y a mano). Añade documentos ajenos (facturas, nóminas…) como clases
 * propias. Las páginas se guardan limpias en PNG gris; las degradaciones de escaneo se aplican en el
 * entrenamiento (en GPU). Escribe labels.csv: archivo,clase,grupo,tipo.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { valueFor, person } from '../fake';
import { FOREIGN_KINDS, renderForeign } from '../foreign';
import { renderDocument } from '../render';
import { Rng } from '../rng';
import { cousinOf, isHoldoutSeed, randomTemplate } from '../templates';
import type { TemplateLayout, TemplateSpec } from '../spec';
import { loadHandFonts } from './fonts';
import { renderPdfPages } from './pdfjs';

const [outDir = 'training-data', nFamArg = '300', dpiArg = '72', startArg = '1'] = process.argv.slice(2);
const N_FAM = Number(nFamArg);
const DPI = Number(dpiArg);
const START = Number(startArg);

function values(layout: TemplateLayout, r: Rng, omitP: number): Record<string, string> {
  const p = person(r);
  const v: Record<string, string> = {};
  for (const f of layout.fields) {
    if (r.bool(omitP)) continue;
    v[f.key] = f.type === 'checkbox' ? (r.bool(0.5) ? 'X' : '') : valueFor(f.type, f.key, r, p);
  }
  return v;
}

async function main() {
  mkdirSync(join(outDir, 'img'), { recursive: true });
  loadHandFonts();
  const rows: string[] = ['file,class,group,kind'];
  let n = 0;
  const save = async (
    pdf: Uint8Array,
    cls: (page: number) => string,
    group: string,
    kind: string,
    tag: string,
  ) => {
    const pages = await renderPdfPages(pdf, DPI);
    for (const [i, c] of pages.entries()) {
      const file = `img/${tag}-p${i}.png`;
      writeFileSync(join(outDir, file), await c.encode('png'));
      rows.push(`${file},${cls(i)},${group},${kind}`);
      n++;
    }
  };
  for (let fam = START; fam < START + N_FAM; fam++) {
    if (START < 900000 && isHoldoutSeed(fam)) continue; // el hold-out solo se genera a propósito
    const base = randomTemplate(fam);
    const variants: TemplateSpec[] = [base, cousinOf(base, fam * 7 + 1)];
    for (const [vi, spec] of variants.entries()) {
      const r = new Rng(fam * 1000 + vi);
      const { layout } = await renderDocument(spec);
      const cls = (p: number) => `t${fam}v${vi}p${p}`;
      const group = `fam${fam}`;
      await save((await renderDocument(spec)).bytes, cls, group, 'blank', `t${fam}v${vi}-blank`);
      for (let k = 0; k < 4; k++) {
        const hand = k >= 2;
        const pdf = (
          await renderDocument(spec, {
            values: values(layout, r, k === 3 ? 0.3 : 0.05),
            mode: hand ? 'hand' : 'typed',
            signed: r.bool(0.8),
            seed: fam * 100 + vi * 10 + k,
          })
        ).bytes;
        await save(pdf, cls, group, hand ? 'hand' : 'typed', `t${fam}v${vi}-f${k}`);
      }
    }
    // Documentos ajenos: cada instancia es su propia clase (discriminación por instancia).
    const kind = FOREIGN_KINDS[fam % FOREIGN_KINDS.length]!;
    await save(
      await renderForeign(kind, fam * 31 + 5),
      (p) => `f${fam}p${p}`,
      `foreign-${kind}`,
      'foreign',
      `f${fam}`,
    );
    if (fam % 10 === 0) process.stdout.write(`${fam} (${n} imágenes)\n`);
  }
  writeFileSync(join(outDir, 'labels.csv'), rows.join('\n') + '\n');
  console.log(`${n} imágenes → ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
