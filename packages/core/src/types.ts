import type { MessageKey } from './i18n';

export type Status = 'match' | 'incomplete' | 'mismatch' | 'unreadable' | 'error';

export interface FieldRef {
  key: string;
  label: string;
}

export interface Result {
  status: Status;
  profileId?: string;
  score: number;
  missingFields: FieldRef[];
  invalidFields: (FieldRef & { reason: string })[];
  /** Avisos no bloqueantes: claves estables, p. ej. "digitalSignature" o "csv". */
  warnings: string[];
  /** Textos listos para mostrar, en el idioma elegido. */
  messages: string[];
  timings: Record<string, number>;
  /** Información de depuración: señales por perfil, tipo de documento… */
  debug?: Record<string, unknown>;
  /** Clave del mensaje principal (útil para personalizar la UI). */
  messageKey?: MessageKey;
}

export type Mode = 'warn' | 'block';

export interface Options {
  mode?: Mode;
  lang?: string;
  ui?: boolean;
  /** Sustituye textos por defecto (mismas claves que los mensajes incluidos). */
  messages?: Partial<Record<MessageKey, string>>;
  /** Carpeta desde la que se cargan workers, pdf.js, datos de OCR y el modelo. */
  assetsPath?: string;
  ocr?: 'auto' | 'off';
  /** Usar el modelo visual también en PDFs digitales (en escaneos se usa siempre si el perfil lo tiene). */
  visualOnDigital?: boolean;
  /** Incluir `debug` en el resultado. */
  debug?: boolean;
}
