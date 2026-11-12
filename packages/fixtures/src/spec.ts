export type FieldType =
  | 'text'
  | 'date'
  | 'dni_nie'
  | 'nif_cif'
  | 'iban'
  | 'email'
  | 'phone'
  | 'number'
  | 'postal_code'
  | 'checkbox'
  | 'signature';

export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  /** Ancho relativo dentro de la fila (se normaliza). */
  w?: number;
}

export interface SectionSpec {
  title: string;
  /** Párrafo fijo antes de los campos (p. ej. una declaración). */
  text?: string;
  rows: FieldSpec[][];
}

export interface StyleSpec {
  font: 'Helvetica' | 'TimesRoman' | 'Courier';
  accent: [number, number, number];
  headerBar: boolean;
  headerAlign: 'left' | 'center';
  fieldStyle: 'box' | 'underline';
  labelPos: 'left' | 'above';
  logo: 'circle' | 'square' | 'shield' | 'none';
  sectionStyle: 'bar' | 'rule' | 'plain';
  fontSize: number;
  margin: number;
  rowGap: number;
}

export interface TemplateSpec {
  id: string;
  organismo: string;
  dept?: string;
  title: string;
  subtitle?: string;
  code?: string;
  purpose: string;
  sections: SectionSpec[];
  footer: string;
  /** Fuerza salto de página antes de la sección con este índice. */
  pageBreakBefore?: number;
  style: StyleSpec;
  /** Para certificados: el emisor añade CSV y firma electrónica. */
  issued?: boolean;
}

/** Caja delimitadora relativa (0–1), origen arriba-izquierda. */
export interface RelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FieldLayout extends FieldSpec {
  page: number;
  box: RelBox;
}

export interface TemplateLayout {
  pageCount: number;
  pageSize: { width: number; height: number }[];
  fields: FieldLayout[];
}

export interface FillOptions {
  values: Record<string, string>;
  /** Claves que se dejan vacías. */
  omit?: string[];
  mode: 'typed' | 'hand';
  acroform?: boolean;
  signed?: boolean;
  /** Para documentos emitidos: incluir CSV y firma electrónica. */
  csv?: boolean;
  digitalSignature?: boolean;
  seed: number;
}
