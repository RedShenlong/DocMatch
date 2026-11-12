import { Rng } from './rng';
import type { FieldSpec, SectionSpec, StyleSpec, TemplateSpec } from './spec';

const f = (
  key: string,
  label: string,
  type: FieldSpec['type'] = 'text',
  required = true,
  w = 1,
): FieldSpec => ({
  key,
  label,
  type,
  required,
  w,
});

export const BASE_STYLE: StyleSpec = {
  font: 'Helvetica',
  accent: [0.12, 0.27, 0.45],
  headerBar: true,
  headerAlign: 'left',
  fieldStyle: 'box',
  labelPos: 'left',
  logo: 'shield',
  sectionStyle: 'bar',
  fontSize: 9,
  margin: 48,
  rowGap: 8,
};

const DATOS_SOLICITANTE: SectionSpec = {
  title: '1. Datos de la persona solicitante',
  rows: [
    [f('nombre', 'Nombre:', 'text', true, 1), f('apellidos', 'Apellidos:', 'text', true, 1.6)],
    [
      f('dni', 'DNI/NIE:', 'dni_nie', true, 1),
      f('fecha_nacimiento', 'Fecha de nacimiento:', 'date', true, 1.2),
    ],
    [f('domicilio', 'Domicilio:', 'text', true, 2), f('cp', 'C.P.:', 'postal_code', true, 0.6)],
    [f('municipio', 'Municipio:', 'text', true, 1), f('provincia', 'Provincia:', 'text', false, 1)],
    [f('telefono', 'Teléfono:', 'phone', true, 1), f('email', 'Correo electrónico:', 'email', false, 1.6)],
  ],
};

/** Plantilla principal de los ejemplos: solicitud de licencia (2 páginas). */
export const LICENCIA: TemplateSpec = {
  id: 'organismo-ejemplo-licencia',
  organismo: 'ORGANISMO DE EJEMPLO',
  dept: 'Dirección General de Intervención de Ejemplo',
  title: 'SOLICITUD DE LICENCIA DE ARMAS',
  subtitle: 'Expedición o renovación de licencia (formulario ficticio)',
  code: 'Modelo EJ-101',
  purpose:
    'Mediante el presente formulario la persona interesada solicita la expedición o renovación de la licencia indicada, declarando que los datos consignados son ciertos.',
  sections: [
    DATOS_SOLICITANTE,
    {
      title: '2. Datos de la licencia solicitada',
      rows: [
        [
          f('tipo_licencia', 'Tipo de licencia:', 'text', true, 1),
          f('num_licencia_anterior', 'Nº licencia anterior:', 'number', false, 1),
        ],
        [f('motivo', 'Motivo de la solicitud:', 'text', true, 1)],
        [
          f('primera', 'Primera solicitud', 'checkbox', false, 1),
          f('renovacion', 'Renovación', 'checkbox', false, 1),
        ],
      ],
    },
    {
      title: '3. Declaración responsable y firma',
      text: 'La persona solicitante declara bajo su responsabilidad que no ha sido condenada por delito doloso y que se compromete a comunicar cualquier variación de los datos aportados. Los datos personales serán tratados conforme a la normativa vigente de protección de datos.',
      rows: [
        [f('lugar', 'Lugar:', 'text', true, 1), f('fecha', 'Fecha:', 'date', true, 1)],
        [f('firma', 'Firma del solicitante:', 'signature', true, 1)],
      ],
    },
  ],
  pageBreakBefore: 2,
  footer: 'Organismo de Ejemplo · Calle Ficticia 1 · 28000 Villaejemplo · Documento sin validez oficial',
  style: BASE_STYLE,
};

/** "Primo": mismo organismo y diseño, distinto título y finalidad. */
export const LICENCIA_PRIMO: TemplateSpec = {
  ...LICENCIA,
  id: 'organismo-ejemplo-tarjeta-armero',
  title: 'SOLICITUD DE TARJETA EUROPEA DE ARMAS',
  subtitle: 'Expedición de tarjeta para viajes (formulario ficticio)',
  code: 'Modelo EJ-104',
  purpose:
    'Mediante el presente formulario la persona interesada solicita la expedición de la tarjeta europea para el traslado temporal de armas a otro Estado, declarando que los datos son ciertos.',
};

const CERT_STYLE: StyleSpec = {
  ...BASE_STYLE,
  font: 'TimesRoman',
  accent: [0.45, 0.1, 0.12],
  headerBar: false,
  headerAlign: 'center',
  fieldStyle: 'underline',
  logo: 'circle',
  sectionStyle: 'rule',
  fontSize: 10,
};

/** Certificado emitido por un ayuntamiento: lleva CSV y firma electrónica. */
export const EMPADRONAMIENTO: TemplateSpec = {
  id: 'ayto-ejemplo-empadronamiento',
  organismo: 'AYUNTAMIENTO DE EJEMPLO',
  dept: 'Secretaría General · Negociado de Estadística',
  title: 'CERTIFICADO DE EMPADRONAMIENTO',
  code: 'Ref. PAD-01',
  purpose:
    'La persona titular de la Secretaría de este Ayuntamiento CERTIFICA que, según los datos que constan en el Padrón Municipal de Habitantes, la persona que se indica figura inscrita en el domicilio que se detalla.',
  sections: [
    {
      title: 'Datos de la persona inscrita',
      rows: [
        [f('nombre_completo', 'Nombre y apellidos:', 'text', true, 1)],
        [
          f('dni', 'DNI/NIE:', 'dni_nie', true, 1),
          f('fecha_nacimiento', 'Fecha de nacimiento:', 'date', true, 1),
        ],
        [f('domicilio', 'Domicilio:', 'text', true, 1)],
        [f('fecha_alta', 'Fecha de alta en el domicilio:', 'date', true, 1)],
      ],
    },
    {
      title: 'Expedición',
      text: 'Y para que conste y surta efectos ante quien corresponda, se expide el presente certificado a petición de la persona interesada.',
      rows: [[f('fecha_expedicion', 'Fecha de expedición:', 'date', true, 1)]],
    },
  ],
  footer: 'Ayuntamiento de Ejemplo · Plaza Mayor 1 · Documento ficticio para pruebas',
  style: CERT_STYLE,
  issued: true,
};

/** Mismo certificado emitido por otro ayuntamiento con otro diseño (segunda plantilla válida). */
export const EMPADRONAMIENTO_B: TemplateSpec = {
  ...EMPADRONAMIENTO,
  id: 'ayto-muestra-empadronamiento',
  organismo: 'AYUNTAMIENTO DE MUESTRILLA',
  dept: 'Servicio de Padrón y Estadística',
  title: 'CERTIFICADO DE INSCRIPCIÓN PADRONAL',
  code: 'PADRON-CERT',
  purpose:
    'D./Dña. titular del Servicio de Padrón CERTIFICA que en el Padrón Municipal de Habitantes de este municipio consta inscrita la persona cuyos datos figuran a continuación.',
  style: {
    ...BASE_STYLE,
    accent: [0.1, 0.4, 0.25],
    logo: 'square',
    labelPos: 'above',
    sectionStyle: 'bar',
    font: 'Helvetica',
  },
  footer: 'Ayuntamiento de Muestrilla · Documento ficticio para pruebas',
};

/* ------------------------------------------------------------------ */
/* Generador aleatorio de familias de plantillas (entrenamiento y hold-out) */

const ORGANISMOS = [
  'AYUNTAMIENTO DE VILLAEJEMPLO',
  'AYUNTAMIENTO DE PRUEBADELRÍO',
  'DIPUTACIÓN PROVINCIAL DE EJEMPLO',
  'CONSEJERÍA DE EDUCACIÓN DE EJEMPLO',
  'CONSEJERÍA DE SANIDAD FICTICIA',
  'AGENCIA TRIBUTARIA DE MUESTRA',
  'INSTITUTO DE VIVIENDA DE EJEMPLO',
  'SERVICIO PÚBLICO DE EMPLEO FICTICIO',
  'MINISTERIO DE EJEMPLO',
  'ORGANISMO AUTÓNOMO DE PRUEBAS',
  'CABILDO DE ISLA EJEMPLO',
  'MANCOMUNIDAD DE MUNICIPIOS DE MUESTRA',
  'UNIVERSIDAD PÚBLICA DE EJEMPLO',
  'CONFEDERACIÓN HIDROGRÁFICA FICTICIA',
  'DIRECCIÓN GENERAL DE TRÁFICO DE EJEMPLO',
  'CONSEJERÍA DE AGRICULTURA DE MUESTRA',
];
const DEPTS = [
  'Servicio de Atención Ciudadana',
  'Área de Hacienda',
  'Registro General',
  'Departamento de Ayudas',
  'Sección de Licencias',
  'Unidad de Gestión',
  'Negociado de Personal',
  'Oficina de Información',
];
const ACCIONES = [
  'SOLICITUD DE',
  'DECLARACIÓN RESPONSABLE DE',
  'INSTANCIA PARA',
  'COMUNICACIÓN PREVIA DE',
  'SOLICITUD DE INSCRIPCIÓN EN',
  'RECLAMACIÓN DE',
  'SOLICITUD DE RENOVACIÓN DE',
  'AUTORIZACIÓN DE',
];
const OBJETOS = [
  'AYUDA AL ALQUILER',
  'BECA DE COMEDOR ESCOLAR',
  'LICENCIA DE OBRA MENOR',
  'TARJETA DE ESTACIONAMIENTO',
  'SUBVENCIÓN PARA AUTÓNOMOS',
  'PLAZA EN ESCUELA INFANTIL',
  'BONIFICACIÓN DEL IBI',
  'OCUPACIÓN DE VÍA PÚBLICA',
  'REGISTRO DE PAREJAS DE HECHO',
  'AYUDA POR NACIMIENTO',
  'LICENCIA DE ACTIVIDAD',
  'DEVOLUCIÓN DE INGRESOS',
  'CERTIFICADO DE CONVIVENCIA',
  'BOLSA DE EMPLEO TEMPORAL',
  'AYUDA A LA REHABILITACIÓN',
  'TARJETA DE TRANSPORTE',
  'CAMBIO DE TITULARIDAD',
  'APLAZAMIENTO DE PAGO',
  'PRESTACIÓN DE DEPENDENCIA',
  'USO DE INSTALACIONES DEPORTIVAS',
  'LICENCIA DE PESCA',
  'ALTA EN EL REGISTRO DE ASOCIACIONES',
  'AYUDA PARA LIBROS DE TEXTO',
  'VADO PERMANENTE',
];
const PURPOSE_TPL = [
  'La persona abajo firmante solicita {obj} conforme a la convocatoria vigente y declara que reúne los requisitos exigidos.',
  'Por medio de la presente se formula {obj}, aportando la documentación requerida en las bases reguladoras.',
  'El/la interesado/a comunica {obj} y se compromete a facilitar cuanta información le sea requerida por la Administración.',
  'Cumplimente este impreso con letra clara y en mayúsculas para tramitar {obj}. Los campos marcados son obligatorios.',
];
const EXTRA_FIELDS: FieldSpec[] = [
  f('iban', 'IBAN:', 'iban', true, 2),
  f('nif_entidad', 'NIF/CIF de la entidad:', 'nif_cif', true, 1),
  f('num_expediente', 'Nº de expediente:', 'number', false, 1),
  f('importe', 'Importe solicitado (€):', 'number', true, 1),
  f('referencia_catastral', 'Referencia catastral:', 'text', false, 1.5),
  f('centro', 'Centro educativo:', 'text', true, 1.5),
  f('curso', 'Curso:', 'text', false, 0.7),
  f('matricula', 'Matrícula del vehículo:', 'text', true, 1),
  f('representante', 'Nombre del representante:', 'text', false, 1.5),
  f('dni_representante', 'DNI/NIE del representante:', 'dni_nie', false, 1),
  f('fecha_inicio', 'Fecha de inicio:', 'date', true, 1),
  f('fecha_fin', 'Fecha de finalización:', 'date', false, 1),
  f('descripcion', 'Descripción de la actuación:', 'text', true, 2),
  f('miembros', 'Nº de miembros de la unidad familiar:', 'number', true, 1),
];
const CHECKS: FieldSpec[] = [
  f('acepta_notif', 'Acepto la notificación electrónica', 'checkbox', false),
  f('autoriza_consulta', 'Autorizo la consulta de mis datos', 'checkbox', true),
  f('declara_veraz', 'Declaro que los datos son ciertos', 'checkbox', true),
  f('no_otras_ayudas', 'No he recibido otras ayudas', 'checkbox', false),
];
const DECLARACIONES = [
  'Declaro bajo mi responsabilidad que son ciertos cuantos datos figuran en la presente solicitud y que dispongo de la documentación que así lo acredita.',
  'Me comprometo a comunicar cualquier modificación de las circunstancias que motivan la presente solicitud en el plazo de diez días.',
  'Los datos personales recogidos serán incorporados a un tratamiento cuya finalidad es la gestión del procedimiento indicado.',
];

export function randomStyle(r: Rng): StyleSpec {
  return {
    font: r.pick(['Helvetica', 'Helvetica', 'TimesRoman', 'Courier']),
    accent: [r.range(0, 0.55), r.range(0, 0.45), r.range(0.1, 0.6)],
    headerBar: r.bool(0.5),
    headerAlign: r.pick(['left', 'center']),
    fieldStyle: r.pick(['box', 'box', 'underline']),
    labelPos: r.pick(['left', 'left', 'above']),
    logo: r.pick(['circle', 'square', 'shield', 'none']),
    sectionStyle: r.pick(['bar', 'rule', 'plain']),
    fontSize: r.pick([8.5, 9, 9.5, 10]),
    margin: r.int(40, 60),
    rowGap: r.int(5, 11),
  };
}

export function randomTemplate(seed: number): TemplateSpec {
  const r = new Rng(seed);
  const obj = r.pick(OBJETOS);
  const accion = r.pick(ACCIONES);
  const solicitante: FieldSpec[][] = r
    .sample(DATOS_SOLICITANTE.rows, r.int(3, 5))
    .map((row) => (r.bool(0.2) && row.length > 1 ? [row[0] as FieldSpec] : row));
  const extras = r.sample(EXTRA_FIELDS, r.int(2, 6));
  const extraRows: FieldSpec[][] = [];
  for (let i = 0; i < extras.length;) {
    const n = r.bool(0.5) ? 2 : 1;
    extraRows.push(extras.slice(i, i + n));
    i += n;
  }
  const checks = r.sample(CHECKS, r.int(0, 3)).map((c) => [c]);
  const sections: SectionSpec[] = [
    {
      title: r.pick([
        '1. Datos personales',
        'DATOS DEL SOLICITANTE',
        'A) Identificación',
        'Datos de la persona interesada',
      ]),
      rows: solicitante,
    },
    {
      title: r.pick([
        '2. Datos de la solicitud',
        'DATOS ESPECÍFICOS',
        'B) Objeto de la solicitud',
        'Información adicional',
      ]),
      rows: extraRows,
    },
  ];
  if (checks.length)
    sections.push({
      title: r.pick(['3. Autorizaciones', 'CONSENTIMIENTOS', 'C) Declaraciones']),
      rows: checks,
    });
  sections.push({
    title: r.pick(['Firma', 'FECHA Y FIRMA', 'Lugar, fecha y firma']),
    text: r.pick(DECLARACIONES),
    rows: [
      [f('lugar', 'Lugar:', 'text', r.bool(0.5), 1), f('fecha', 'Fecha:', 'date', true, 1)],
      [
        f(
          'firma',
          r.pick(['Firma:', 'Firma del solicitante:', 'Firma de la persona interesada:']),
          'signature',
          true,
        ),
      ],
    ],
  });
  const org = r.pick(ORGANISMOS);
  const twoPages = r.bool(0.35);
  return {
    id: `random-${seed}`,
    organismo: org,
    dept: r.bool(0.7) ? r.pick(DEPTS) : undefined,
    title: `${accion} ${obj}`,
    subtitle: r.bool(0.3) ? `Convocatoria ${r.int(2019, 2026)}` : undefined,
    code: r.bool(0.7)
      ? `${r.pick(['Modelo', 'Mod.', 'Impreso', 'Ref.'])} ${String.fromCharCode(65 + r.int(0, 25))}${String.fromCharCode(65 + r.int(0, 25))}-${r.int(1, 999)}`
      : undefined,
    purpose: r.pick(PURPOSE_TPL).replace('{obj}', obj.toLowerCase()),
    sections,
    pageBreakBefore: twoPages ? sections.length - 1 : undefined,
    footer: `${org.charAt(0)}${org.slice(1).toLowerCase()} · Documento ficticio · ${r.int(10000, 99999)}`,
    style: randomStyle(r),
  };
}

/** Plantilla prima: mismo diseño y campos, distinto título y finalidad. */
export function cousinOf(t: TemplateSpec, seed: number): TemplateSpec {
  const r = new Rng(seed);
  let title = t.title;
  while (title === t.title) title = `${r.pick(ACCIONES)} ${r.pick(OBJETOS)}`;
  return {
    ...t,
    id: `${t.id}-primo-${seed}`,
    title,
    code: t.code ? t.code.replace(/\d+$/, (n) => String((Number(n) + r.int(1, 50)) % 1000)) : undefined,
    purpose: r.pick(PURPOSE_TPL).replace('{obj}', title.toLowerCase().replace(/^\S+( de| para| en)? /, '')),
  };
}

/** Semillas reservadas: nunca se usan para entrenar el encoder. */
export const HOLDOUT_SEEDS = [900001, 900002, 900003, 900004, 900005, 900006];
export const isHoldoutSeed = (s: number) => s >= 900000;
