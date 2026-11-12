import { compact, digitsFromOcr } from '../text/normalize';

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

/** Motivos de invalidez (claves de mensaje i18n). */
export type InvalidReason =
  | 'dni_letter'
  | 'dni_format'
  | 'nif_control'
  | 'nif_format'
  | 'iban_checksum'
  | 'iban_format'
  | 'date_invalid'
  | 'email_format'
  | 'phone_format'
  | 'postal_code_format'
  | 'number_format'
  | 'pattern';

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

/** DNI (8 dígitos + letra) o NIE (X/Y/Z + 7 dígitos + letra). */
export function validateDniNie(raw: string, fromOcr = false): InvalidReason | null {
  let s = compact(raw);
  const m = /^([XYZ]?)([0-9A-Z]{7,8})([A-Z])$/.exec(s);
  if (!m) return 'dni_format';
  let digits = m[2]!;
  if (fromOcr) digits = digitsFromOcr(digits);
  if (!/^\d+$/.test(digits)) return 'dni_format';
  const prefix = m[1]!;
  if (prefix ? digits.length !== 7 : digits.length !== 8) return 'dni_format';
  s = `${prefix ? 'XYZ'.indexOf(prefix) : ''}${digits}`;
  return DNI_LETTERS[Number(s) % 23] === m[3] ? null : 'dni_letter';
}

/** NIF de persona física (DNI/NIE, K, L, M) o CIF de persona jurídica. */
export function validateNifCif(raw: string, fromOcr = false): InvalidReason | null {
  const s = compact(raw);
  if (/^[XYZ]?\d{7,8}[A-Z]$/.test(s) || (fromOcr && /^[XYZ]?[0-9A-Z]{7,8}[A-Z]$/.test(s))) {
    const r = validateDniNie(s, fromOcr);
    return r === 'dni_letter' ? 'nif_control' : r ? 'nif_format' : null;
  }
  const m = /^([ABCDEFGHJKLMNPQRSUVW])(\d{7})([0-9A-J])$/.exec(
    fromOcr ? s.slice(0, 1) + digitsFromOcr(s.slice(1, 8)) + s.slice(8) : s,
  );
  if (!m) return 'nif_format';
  const d = m[2]!;
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const n = Number(d[i]);
    if (i % 2 === 0) {
      const x = n * 2;
      sum += Math.floor(x / 10) + (x % 10);
    } else sum += n;
  }
  const ctrl = (10 - (sum % 10)) % 10;
  const c = m[3]!;
  const letterCtrl = 'JABCDEFGHI'[ctrl]!;
  const L = m[1]!;
  if ('PQRSNW'.includes(L)) return c === letterCtrl ? null : 'nif_control';
  if ('ABEH'.includes(L)) return c === String(ctrl) ? null : 'nif_control';
  return c === String(ctrl) || c === letterCtrl ? null : 'nif_control';
}

export function validateIban(raw: string): InvalidReason | null {
  const s = compact(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return 'iban_format';
  if (s.startsWith('ES') && s.length !== 24) return 'iban_format';
  const re = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of re) {
    const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const dch of v) rem = (rem * 10 + Number(dch)) % 97;
  }
  return rem === 1 ? null : 'iban_checksum';
}

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

export function parseSpanishDate(raw: string): { d: number; m: number; y: number } | null {
  const s = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  let m = /^(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2}|\d{4})$/.exec(s);
  if (m) {
    let y = Number(m[3]);
    if (m[3]!.length === 2) y += y > 50 ? 1900 : 2000;
    return { d: Number(m[1]), m: Number(m[2]), y };
  }
  m = /^(\d{1,2})\s+de\s+([a-z]+)\s+(?:de|del)\s+(\d{4})$/.exec(s);
  if (m) {
    const mi = MONTHS.indexOf(m[2] === 'setiembre' ? 'septiembre' : m[2]!);
    if (mi < 0) return null;
    return { d: Number(m[1]), m: mi + 1, y: Number(m[3]) };
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return { d: Number(m[3]), m: Number(m[2]), y: Number(m[1]) };
  return null;
}

export function validateDate(raw: string): InvalidReason | null {
  const p = parseSpanishDate(raw);
  if (!p) return 'date_invalid';
  const { d, m, y } = p;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return 'date_invalid';
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim ? null : 'date_invalid';
}

export function validateEmail(raw: string): InvalidReason | null {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(raw.trim()) ? null : 'email_format';
}

export function validatePhone(raw: string): InvalidReason | null {
  const s = raw.replace(/[\s.()-]/g, '').replace(/^(\+34|0034)/, '');
  return /^[6789]\d{8}$/.test(s) ? null : 'phone_format';
}

export function validatePostalCode(raw: string): InvalidReason | null {
  const s = raw.replace(/\s/g, '');
  if (!/^\d{5}$/.test(s)) return 'postal_code_format';
  const prov = Number(s.slice(0, 2));
  return prov >= 1 && prov <= 52 ? null : 'postal_code_format';
}

export function validateNumber(raw: string): InvalidReason | null {
  return /^[-+]?\d{1,3}([.\s]?\d{3})*([,.]\d+)?\s*(€|eur)?$/i.test(raw.trim()) || /^\d+$/.test(raw.trim())
    ? null
    : 'number_format';
}

/** Valida un valor según su tipo. `fromOcr` activa correcciones de confusiones típicas. */
export function validate(
  type: FieldType,
  value: string,
  pattern?: string,
  fromOcr = false,
): InvalidReason | null {
  const v = value.trim();
  if (pattern) {
    try {
      if (!new RegExp(pattern).test(v)) return 'pattern';
    } catch {
      /* patrón inválido en el perfil: se ignora */
    }
  }
  switch (type) {
    case 'dni_nie':
      return validateDniNie(v, fromOcr);
    case 'nif_cif':
      return validateNifCif(v, fromOcr);
    case 'iban':
      return validateIban(fromOcr ? v.slice(0, 2) + digitsFromOcr(v.slice(2)) : v);
    case 'date':
      if (!validateDate(v)) return null;
      return fromOcr ? validateDate(digitsFromOcr(v).replace(/[^\d/.-]/g, '')) : 'date_invalid';
    case 'email':
      return validateEmail(v);
    case 'phone':
      return validatePhone(fromOcr ? digitsFromOcr(v) : v);
    case 'postal_code':
      return validatePostalCode(fromOcr ? digitsFromOcr(v) : v);
    case 'number':
      return validateNumber(fromOcr ? digitsFromOcr(v) : v);
    default:
      return null;
  }
}
