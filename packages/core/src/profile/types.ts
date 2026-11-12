import type { FieldType } from '../fields/validators';

export const SCHEMA_VERSION = 1;

/** Caja relativa a la página (0–1), origen arriba-izquierda. */
export interface RelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Línea de texto fijo de la plantilla. */
export interface Anchor {
  page: number;
  text: string;
  /** Texto normalizado y "plegado" (sin acentos, puntuación ni confusiones de OCR). */
  norm: string;
  box: RelBox;
  /** Título, código del modelo y frases que identifican el formulario. */
  distinctive?: boolean;
  /** Peso relativo (por defecto según longitud). */
  weight?: number;
}

export interface AcroFieldInfo {
  name: string;
  type: 'text' | 'checkbox' | 'radio' | 'choice' | 'signature' | 'button';
  page: number;
}

export interface FieldBlankStats {
  /** Fracción de píxeles oscuros en la región de la plantilla vacía. */
  ink: number;
  /** Embedding (base64 float16) del recorte vacío, si hay modelo. */
  emb?: string;
  /** Clasificador logístico "hay firma / no hay firma" sobre el embedding del recorte. */
  sig?: { w: string; b: number };
}

export interface ProfileField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  page: number;
  /** Región donde va el valor. */
  box: RelBox;
  /** Índice en `anchors` de la etiqueta de la que depende. */
  anchor?: number;
  pattern?: string;
  /** Nombre del campo AcroForm equivalente, si existe. */
  acroName?: string;
  blank?: FieldBlankStats;
}

export interface VisualPage {
  /** dHash de 64 bits en hexadecimal. */
  dhash: string;
  /** Prototipos (embeddings del encoder, base64 float16). */
  prototypes: string[];
}

export interface LinearHead {
  inDim: number;
  outDim: number;
  /** Matriz outDim×inDim en base64 float32 (fila mayor). */
  weights: string;
  /** Prototipos en el espacio proyectado, por página. */
  prototypes: string[][];
}

export interface FusionWeights {
  /** Pesos por señal, en el orden de `features`. */
  w: number[];
  b: number;
  features: string[];
}

export interface Calibration {
  fusion: { digital: FusionWeights; scan: FusionWeights };
  /** Umbral de diferencia de tinta (sobre la plantilla vacía) para considerar un campo relleno. */
  ink: { text: number; checkbox: number; signature: number };
  metrics?: {
    digital?: { fpr: number; fnr: number; n: number };
    scan?: { fpr: number; fnr: number; n: number };
    fields?: { fpr: number; fnr: number; n: number };
    estimatedAccuracy?: number;
  };
}

export interface Thresholds {
  /** Puntuación mínima de la fusión para aceptar la plantilla. */
  match: number;
  /** Cobertura mínima de anclas distintivas (título, código…). */
  distinctive: number;
  /** Similitud mínima para considerar encontrada un ancla. */
  anchorSim: number;
  /** Confianza mínima del OCR (0–100) para validar formatos en escaneos. */
  ocrConfidence: number;
  /** Caracteres por página por debajo de los cuales se trata como escaneo. */
  textChars: number;
}

export interface Profile {
  schemaVersion: number;
  id: string;
  name: string;
  version: string;
  issuer?: string;
  pageCount: number;
  pages: { width: number; height: number }[];
  anchors: Anchor[];
  acroFields?: AcroFieldInfo[];
  fields: ProfileField[];
  visual?: {
    modelId: string;
    modelVersion: string;
    input: { width: number; height: number };
    pages: VisualPage[];
    head?: LinearHead;
    /** Similitud [negativos p95, positivos p50] para escalar la puntuación visual a 0–1. */
    simRange?: [number, number];
  };
  calibration?: Calibration;
  modelId?: string;
  modelVersion?: string;
  expect?: { digitalSignature?: boolean; csv?: boolean };
  thresholds: Thresholds;
  generator?: { name: string; version: string; date: string };
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  match: 0.6,
  distinctive: 0.55,
  anchorSim: 0.72,
  ocrConfidence: 75,
  textChars: 40,
};

/** Características que usa la fusión (orden fijo). */
export const FUSION_FEATURES = ['anchors', 'distinctive', 'layout', 'pages', 'phash', 'vision'] as const;

export const DEFAULT_CALIBRATION: Calibration = {
  fusion: {
    digital: { features: [...FUSION_FEATURES], w: [4.5, 5, 2, 1, 0, 0], b: -8.2 },
    scan: { features: [...FUSION_FEATURES], w: [3.5, 4.5, 1.5, 0.8, 0.3, 2.5], b: -7.0 },
  },
  ink: { text: 0.025, checkbox: 0.06, signature: 0.01 },
};

/** Validación mínima en tiempo de ejecución (la validación completa con JSON Schema está en el builder). */
export function checkProfile(p: unknown): Profile {
  const o = p as Profile;
  if (!o || typeof o !== 'object') throw new Error('Perfil inválido');
  if (o.schemaVersion !== SCHEMA_VERSION)
    throw new Error(`schemaVersion ${o.schemaVersion} no soportada (esperada ${SCHEMA_VERSION})`);
  if (
    typeof o.id !== 'string' ||
    !Array.isArray(o.anchors) ||
    !Array.isArray(o.fields) ||
    !(o.pageCount > 0)
  ) {
    throw new Error('Perfil inválido: faltan id, anchors, fields o pageCount');
  }
  o.thresholds = { ...DEFAULT_THRESHOLDS, ...o.thresholds };
  return o;
}
