/** Comprobaciones básicas sobre los bytes, antes de abrir el PDF. */

export type BasicProblem = 'not_pdf' | 'empty' | 'too_large' | 'encrypted' | null;

export const MAX_BYTES = 50 * 1024 * 1024;

export function latin1(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let s = '';
  const CH = 0x8000;
  for (let i = start; i < end; i += CH) s += String.fromCharCode(...bytes.subarray(i, Math.min(end, i + CH)));
  return s;
}

export function basicChecks(bytes: Uint8Array, maxBytes = MAX_BYTES): BasicProblem {
  if (!bytes.length) return 'empty';
  if (bytes.length > maxBytes) return 'too_large';
  // La cabecera %PDF debe aparecer en los primeros 1024 bytes (la especificación lo permite así).
  const head = latin1(bytes, 0, Math.min(1024, bytes.length));
  if (!head.includes('%PDF-')) return 'not_pdf';
  return null;
}

/** El diccionario /Encrypt aparece en el trailer, cerca del final. */
export function looksEncrypted(bytes: Uint8Array): boolean {
  const tail = latin1(bytes, Math.max(0, bytes.length - 4096));
  return (
    /\/Encrypt\s/.test(tail) ||
    /\/Encrypt\s+\d+\s+\d+\s+R/.test(latin1(bytes, 0, Math.min(bytes.length, 4096)))
  );
}

/** Firma electrónica: diccionario de firma con /ByteRange, o campo /FT /Sig con valor. */
export function hasDigitalSignature(bytes: Uint8Array): boolean {
  const s = latin1(bytes);
  if (!/\/ByteRange\s*\[/.test(s)) return false;
  return /\/Type\s*\/Sig\b/.test(s) || /\/FT\s*\/Sig\b/.test(s) || /\/SubFilter\s*\/(adbe|ETSI)/.test(s);
}
