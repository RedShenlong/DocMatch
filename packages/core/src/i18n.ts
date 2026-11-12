export type MessageKey =
  | 'checking'
  | 'match'
  | 'mismatch'
  | 'mismatch_like'
  | 'incomplete_missing'
  | 'incomplete_invalid'
  | 'unreadable'
  | 'not_pdf'
  | 'encrypted'
  | 'corrupt'
  | 'too_large'
  | 'error'
  | 'warn_csv'
  | 'warn_digitalSignature'
  | 'r_dni_letter'
  | 'r_dni_format'
  | 'r_nif_control'
  | 'r_nif_format'
  | 'r_iban_checksum'
  | 'r_iban_format'
  | 'r_date_invalid'
  | 'r_email_format'
  | 'r_phone_format'
  | 'r_postal_code_format'
  | 'r_number_format'
  | 'r_pattern'
  | 'like_factura'
  | 'like_matrimonio'
  | 'like_nomina'
  | 'like_contrato'
  | 'like_carta'
  | 'like_recibo'
  | 'like_certificado';

export type Messages = Record<MessageKey, string>;

const es: Messages = {
  checking: 'Comprobando el documento…',
  match: 'Documento correcto: {name}.',
  mismatch: 'No parece el documento solicitado ({name}). Revisa que has adjuntado el archivo correcto.',
  mismatch_like:
    'No parece el documento solicitado ({name}); parece {like}. Revisa que has adjuntado el archivo correcto.',
  incomplete_missing: 'Al documento le faltan datos: {fields}.',
  incomplete_invalid: 'Revisa estos datos: {fields}.',
  unreadable:
    'No hemos podido leer bien el documento. Prueba con un PDF descargado directamente o un escaneo más nítido.',
  not_pdf: 'El archivo no es un PDF. Adjunta el documento en formato PDF.',
  encrypted:
    'El PDF está protegido con contraseña y no se puede comprobar. Adjunta una versión sin contraseña.',
  corrupt: 'El PDF parece dañado y no se puede abrir. Prueba a descargarlo o generarlo de nuevo.',
  too_large: 'El archivo es demasiado grande para comprobarlo.',
  error: 'No se ha podido comprobar el documento. Puedes continuar igualmente.',
  warn_csv: 'No se ha encontrado el Código Seguro de Verificación (CSV).',
  warn_digitalSignature: 'El documento no tiene firma electrónica.',
  r_dni_letter: 'la letra no corresponde al número',
  r_dni_format: 'formato de DNI/NIE no válido',
  r_nif_control: 'el carácter de control no es correcto',
  r_nif_format: 'formato de NIF/CIF no válido',
  r_iban_checksum: 'los dígitos de control no son correctos',
  r_iban_format: 'formato de IBAN no válido',
  r_date_invalid: 'fecha no válida',
  r_email_format: 'correo electrónico no válido',
  r_phone_format: 'teléfono no válido',
  r_postal_code_format: 'código postal no válido',
  r_number_format: 'número no válido',
  r_pattern: 'formato no válido',
  like_factura: 'una factura',
  like_matrimonio: 'un certificado de matrimonio',
  like_nomina: 'una nómina',
  like_contrato: 'un contrato',
  like_carta: 'una carta',
  like_recibo: 'un recibo',
  like_certificado: 'un certificado',
};

const en: Messages = {
  checking: 'Checking the document…',
  match: 'Correct document: {name}.',
  mismatch:
    "This doesn't look like the requested document ({name}). Please check you attached the right file.",
  mismatch_like:
    "This doesn't look like the requested document ({name}); it looks like {like}. Please check you attached the right file.",
  incomplete_missing: 'The document is missing some data: {fields}.',
  incomplete_invalid: 'Please check these fields: {fields}.',
  unreadable: "We couldn't read the document properly. Try a PDF downloaded directly or a sharper scan.",
  not_pdf: 'The file is not a PDF. Please attach the document as a PDF.',
  encrypted:
    'The PDF is password-protected and cannot be checked. Please attach a version without a password.',
  corrupt: 'The PDF seems damaged and cannot be opened. Try downloading or generating it again.',
  too_large: 'The file is too large to be checked.',
  error: "The document couldn't be checked. You can continue anyway.",
  warn_csv: 'No Secure Verification Code (CSV) was found.',
  warn_digitalSignature: 'The document has no electronic signature.',
  r_dni_letter: 'the letter does not match the number',
  r_dni_format: 'invalid DNI/NIE format',
  r_nif_control: 'wrong control character',
  r_nif_format: 'invalid NIF/CIF format',
  r_iban_checksum: 'wrong check digits',
  r_iban_format: 'invalid IBAN format',
  r_date_invalid: 'invalid date',
  r_email_format: 'invalid email',
  r_phone_format: 'invalid phone number',
  r_postal_code_format: 'invalid postal code',
  r_number_format: 'invalid number',
  r_pattern: 'invalid format',
  like_factura: 'an invoice',
  like_matrimonio: 'a marriage certificate',
  like_nomina: 'a payslip',
  like_contrato: 'a contract',
  like_carta: 'a letter',
  like_recibo: 'a receipt',
  like_certificado: 'a certificate',
};

export const LOCALES: Record<string, Messages> = { es, en };

export function messagesFor(lang = 'es', custom?: Partial<Record<string, string>>): Messages {
  const base = LOCALES[lang.slice(0, 2).toLowerCase()] ?? es;
  return { ...base, ...(custom as Partial<Messages>) };
}

export function fmt(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}
