import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { A4, signaturePath } from './render';
import { Rng } from './rng';
import * as fake from './fake';

/** Documentos "ajenos" ficticios: facturas, certificados, nóminas… (negativos y banco de negativos). */
export const FOREIGN_KINDS = [
  'factura',
  'matrimonio',
  'nomina',
  'contrato',
  'carta',
  'recibo',
  'certificado',
] as const;
export type ForeignKind = (typeof FOREIGN_KINDS)[number];

interface W {
  page: PDFPage;
  y: number;
  reg: PDFFont;
  bold: PDFFont;
  m: number;
  r: Rng;
}

function t(w: W, s: string, size = 10, bold = false, x = w.m) {
  w.page.drawText(s, { x, y: A4.height - w.y - size, size, font: bold ? w.bold : w.reg });
  w.y += size * 1.5;
}

function para(w: W, s: string, size = 10) {
  const max = A4.width - 2 * w.m;
  let line = '';
  for (const word of s.split(' ')) {
    const tryL = line ? `${line} ${word}` : word;
    if (w.reg.widthOfTextAtSize(tryL, size) > max) {
      t(w, line, size);
      line = word;
    } else line = tryL;
  }
  if (line) t(w, line, size);
}

function table(w: W, headers: string[], rows: string[][], size = 9) {
  const cols = headers.length;
  const colW = (A4.width - 2 * w.m) / cols;
  const H = A4.height;
  w.page.drawRectangle({
    x: w.m,
    y: H - w.y - 16,
    width: A4.width - 2 * w.m,
    height: 16,
    color: rgb(0.88, 0.88, 0.9),
  });
  headers.forEach((h, i) =>
    w.page.drawText(h, { x: w.m + 4 + i * colW, y: H - w.y - 11, size, font: w.bold }),
  );
  w.y += 18;
  for (const row of rows) {
    row.forEach((c, i) => w.page.drawText(c, { x: w.m + 4 + i * colW, y: H - w.y - 11, size, font: w.reg }));
    w.page.drawLine({
      start: { x: w.m, y: H - w.y - 15 },
      end: { x: A4.width - w.m, y: H - w.y - 15 },
      thickness: 0.3,
      color: rgb(0.6, 0.6, 0.6),
    });
    w.y += 16;
  }
  w.y += 8;
}

const money = (r: Rng) => `${r.int(5, 2500)},${String(r.int(0, 99)).padStart(2, '0')} €`;

export async function renderForeign(kind: ForeignKind, seed: number): Promise<Uint8Array> {
  const r = new Rng(seed);
  const doc = await PDFDocument.create();
  doc.setProducer('docmatch-fixtures');
  const font = r.pick([
    ['Helvetica', 'HelveticaBold'],
    ['TimesRoman', 'TimesRomanBold'],
    ['Courier', 'CourierBold'],
  ] as const);
  const reg = await doc.embedFont(StandardFonts[font[0]]);
  const bold = await doc.embedFont(StandardFonts[font[1]]);
  const page = doc.addPage([A4.width, A4.height]);
  const w: W = { page, y: r.int(40, 70), reg, bold, m: r.int(45, 65), r };
  const p = fake.person(r);
  const empresa = r.pick([
    'Suministros Ejemplo S.L.',
    'Ficticia Energía S.A.',
    'Talleres Muestra S.L.',
    'Consultoría Prueba S.L.',
    'Librería Imaginaria',
    'Telecomunicaciones Demo S.A.',
  ]);
  const accent = rgb(r.range(0, 0.6), r.range(0, 0.6), r.range(0, 0.6));
  if (r.bool(0.6))
    page.drawRectangle({ x: 0, y: A4.height - r.int(8, 30), width: A4.width, height: 30, color: accent });
  switch (kind) {
    case 'factura': {
      t(w, empresa, 16, true);
      t(w, `CIF: ${fake.cif(r)} · ${p.domicilio} · ${p.municipio}`, 9);
      w.y += 10;
      t(
        w,
        r.pick(['FACTURA', 'FACTURA SIMPLIFICADA', 'Factura nº']) +
          ` ${r.int(2020, 2026)}-${r.int(100, 9999)}`,
        14,
        true,
      );
      t(w, `Fecha de emisión: ${fake.date(r)}`, 10);
      t(w, `Cliente: ${p.nombreCompleto} · NIF: ${fake.dni(r)}`, 10);
      t(w, `Dirección: ${fake.person(r).domicilio}`, 10);
      w.y += 10;
      table(
        w,
        ['Concepto', 'Cantidad', 'Precio', 'Importe'],
        Array.from({ length: r.int(3, 9) }, () => [
          r.pick([
            'Servicio de mantenimiento',
            'Material de oficina',
            'Consumo eléctrico',
            'Cuota mensual',
            'Reparación',
            'Portes',
          ]),
          String(r.int(1, 20)),
          money(r),
          money(r),
        ]),
      );
      t(w, `Base imponible: ${money(r)}`, 10, false, A4.width - 230);
      t(w, `IVA (21 %): ${money(r)}`, 10, false, A4.width - 230);
      t(w, `TOTAL: ${money(r)}`, 12, true, A4.width - 230);
      w.y += 20;
      t(w, `Forma de pago: transferencia a ${fake.iban(r)}`, 9);
      break;
    }
    case 'matrimonio': {
      t(w, 'REGISTRO CIVIL DE EJEMPLO', 14, true);
      t(w, `Sección ${r.int(1, 4)}ª · Tomo ${r.int(10, 300)} · Página ${r.int(1, 400)}`, 9);
      w.y += 14;
      t(w, 'CERTIFICADO DE MATRIMONIO', 16, true, A4.width / 2 - 120);
      w.y += 10;
      para(w, `Contrayente 1: ${p.nombreCompleto}, nacido/a el ${fake.date(r)} en ${p.municipio}.`);
      para(
        w,
        `Contrayente 2: ${fake.person(r).nombreCompleto}, nacido/a el ${fake.date(r)} en ${fake.person(r).municipio}.`,
      );
      para(
        w,
        `Fecha de celebración: ${fake.date(r)}. Lugar: ${fake.person(r).municipio}. Régimen económico: ${r.pick(['gananciales', 'separación de bienes'])}.`,
      );
      w.y += 10;
      para(
        w,
        'El presente certificado es reproducción literal del asiento obrante en este Registro (documento ficticio para pruebas).',
        9,
      );
      w.y += 20;
      t(w, 'El/La Encargado/a del Registro', 10);
      page.drawSvgPath(signaturePath(r, 180, 50), {
        x: w.m,
        y: A4.height - w.y,
        borderColor: rgb(0.1, 0.1, 0.4),
        borderWidth: 1.2,
      });
      break;
    }
    case 'nomina': {
      t(w, `${empresa} · CIF ${fake.cif(r)}`, 12, true);
      t(
        w,
        `RECIBO DE SALARIOS · Periodo: ${r.pick(['enero', 'marzo', 'junio', 'octubre'])} ${r.int(2020, 2026)}`,
        12,
        true,
      );
      t(
        w,
        `Trabajador/a: ${p.nombreCompleto} · DNI ${fake.dni(r)} · Nº SS ${r.int(10, 50)}/${r.int(10000000, 99999999)}`,
        9,
      );
      t(
        w,
        `Categoría: ${r.pick(['Oficial 1ª', 'Técnico', 'Administrativo', 'Auxiliar'])} · Antigüedad: ${fake.date(r)}`,
        9,
      );
      w.y += 8;
      table(
        w,
        ['Devengos', 'Importe', 'Deducciones', 'Importe'],
        Array.from({ length: r.int(4, 8) }, () => [
          r.pick(['Salario base', 'Plus convenio', 'Pagas extra', 'Horas extra']),
          money(r),
          r.pick(['Contingencias comunes', 'Desempleo', 'IRPF', 'Formación']),
          money(r),
        ]),
      );
      t(w, `LÍQUIDO A PERCIBIR: ${money(r)}`, 12, true, A4.width - 260);
      break;
    }
    case 'contrato': {
      t(
        w,
        r.pick([
          'CONTRATO DE ARRENDAMIENTO DE VIVIENDA',
          'CONTRATO DE PRESTACIÓN DE SERVICIOS',
          'CONTRATO DE COMPRAVENTA',
        ]),
        14,
        true,
      );
      w.y += 6;
      t(w, `En ${p.municipio}, a ${fake.date(r)}`, 10);
      t(w, 'REUNIDOS', 11, true);
      para(
        w,
        `De una parte, ${p.nombreCompleto}, mayor de edad, con DNI ${fake.dni(r)}. De otra parte, ${fake.person(r).nombreCompleto}, con DNI ${fake.dni(r)}.`,
      );
      t(w, 'CLÁUSULAS', 11, true);
      for (let i = 1; i <= r.int(4, 8); i++)
        para(
          w,
          `${['PRIMERA', 'SEGUNDA', 'TERCERA', 'CUARTA', 'QUINTA', 'SEXTA', 'SÉPTIMA', 'OCTAVA'][i - 1]}.- ${r.pick(['El plazo de duración será de un año prorrogable.', 'La renta mensual se abonará por adelantado.', 'Las partes se someten a los juzgados del lugar.', 'Cualquier modificación deberá constar por escrito.', 'La fianza asciende a una mensualidad.'])}`,
          9.5,
        );
      break;
    }
    case 'carta': {
      t(w, p.nombreCompleto, 10);
      t(w, p.domicilio, 10);
      t(w, `${p.cp} ${p.municipio}`, 10);
      w.y += 20;
      t(w, `${fake.person(r).municipio}, ${fake.date(r)}`, 10, false, A4.width - 220);
      w.y += 10;
      t(w, r.pick(['Estimado/a señor/a:', 'Muy señores míos:', 'Hola:']), 10);
      for (let i = 0; i < r.int(3, 6); i++)
        para(
          w,
          r.pick([
            'Por la presente le comunico mi interés en el asunto referido en su anterior escrito.',
            'Quedo a la espera de sus noticias y aprovecho para enviarle un cordial saludo.',
            'Adjunto la documentación que me solicitaron en su última comunicación.',
            'Le agradecería que tuviera en cuenta las circunstancias que le expongo a continuación.',
          ]),
        );
      w.y += 10;
      t(w, 'Atentamente,', 10);
      break;
    }
    case 'recibo': {
      t(w, empresa, 14, true);
      t(w, r.pick(['RECIBO', 'JUSTIFICANTE DE PAGO', 'TICKET']) + ` Nº ${r.int(1000, 99999)}`, 13, true);
      t(w, `Fecha: ${fake.date(r)}   Hora: ${r.int(8, 21)}:${String(r.int(0, 59)).padStart(2, '0')}`, 10);
      t(w, `Recibí de ${p.nombreCompleto} la cantidad de ${money(r)}`, 10);
      t(
        w,
        `en concepto de ${r.pick(['cuota de socio', 'matrícula', 'alquiler', 'reserva', 'servicios prestados'])}.`,
        10,
      );
      w.y += 20;
      t(w, 'Firma y sello', 9);
      break;
    }
    case 'certificado': {
      t(
        w,
        r.pick([
          'COLEGIO PÚBLICO DE EJEMPLO',
          'CLÍNICA FICTICIA',
          'ACADEMIA DE MUESTRA',
          'CENTRO DE FORMACIÓN PRUEBA',
        ]),
        14,
        true,
      );
      w.y += 20;
      t(
        w,
        r.pick([
          'CERTIFICADO DE ASISTENCIA',
          'CERTIFICADO MÉDICO',
          'CERTIFICADO DE NOTAS',
          'CERTIFICADO DE APROVECHAMIENTO',
        ]),
        15,
        true,
      );
      w.y += 10;
      para(
        w,
        `D./Dña. ${fake.person(r).nombreCompleto}, en calidad de ${r.pick(['director/a', 'responsable', 'secretario/a'])}, CERTIFICA que ${p.nombreCompleto}, con DNI ${fake.dni(r)}, ${r.pick(['ha asistido al curso indicado con un total de 40 horas.', 'se encuentra en buen estado de salud.', 'ha superado las asignaturas del curso.'])}`,
      );
      w.y += 10;
      para(w, 'Y para que así conste, firmo el presente certificado.');
      page.drawSvgPath(signaturePath(r, 160, 50), {
        x: w.m + 20,
        y: A4.height - w.y - 10,
        borderColor: rgb(0.1, 0.1, 0.4),
        borderWidth: 1.1,
      });
      break;
    }
  }
  return doc.save({ useObjectStreams: false });
}
