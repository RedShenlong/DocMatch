import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { Rng } from './rng';

/**
 * PDF "protegido": diccionario /Encrypt (Standard, AES-128) cuyos valores O/U no validan con la
 * contraseña vacía. Cualquier lector pedirá contraseña, que es lo que queremos probar.
 */
export async function makeEncrypted(base: Uint8Array, seed: number): Promise<Uint8Array> {
  const r = new Rng(seed);
  const doc = await PDFDocument.load(base);
  const ctx = doc.context;
  const rnd = (n: number) => {
    let s = '';
    for (let i = 0; i < n; i++) s += r.int(0, 255).toString(16).padStart(2, '0');
    return PDFHexString.of(s);
  };
  const cf = ctx.obj({ StdCF: { AuthEvent: 'DocOpen', CFM: 'AESV2', Length: 16 } });
  const enc = ctx.obj({
    Filter: 'Standard',
    V: 4,
    R: 4,
    Length: 128,
    P: -1060,
    O: rnd(32),
    U: rnd(32),
    CF: cf,
    StmF: 'StdCF',
    StrF: 'StdCF',
  });
  const ref = ctx.register(enc);
  ctx.trailerInfo.Encrypt = ref;
  ctx.trailerInfo.ID = PDFArray.withContext(ctx);
  (ctx.trailerInfo.ID as PDFArray).push(rnd(16));
  (ctx.trailerInfo.ID as PDFArray).push(rnd(16));
  return doc.save({ useObjectStreams: false });
}

/** PDF corrupto: cabecera válida, cuerpo truncado y basura. */
export function makeCorrupt(base: Uint8Array, seed: number): Uint8Array {
  const r = new Rng(seed);
  const cut = Math.floor(base.length * 0.35);
  const out = new Uint8Array(cut + 2048);
  out.set(base.subarray(0, cut));
  for (let i = cut; i < out.length; i++) out[i] = r.int(0, 255);
  return out;
}

/** Archivo que no es PDF (una "foto" JPEG) con extensión .pdf. */
export function makeNotPdf(jpeg: Uint8Array): Uint8Array {
  return jpeg;
}

/**
 * Añade un campo de firma electrónica con /ByteRange y /Contents (firma ficticia, NO válida
 * criptográficamente). Sirve para probar la detección de "tiene firma electrónica".
 */
export async function addFakeDigitalSignature(pdf: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf);
  const ctx = doc.context;
  const page = doc.getPage(0);
  const sigDict = ctx.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, 1000, 2000, 1000],
    Contents: PDFHexString.of('30'.repeat(64)),
    M: PDFString.of('D:20260101120000Z'),
    Name: PDFString.of('Firma ficticia de pruebas'),
  });
  const sigRef = ctx.register(sigDict);
  const widget = ctx.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    T: PDFString.of('FirmaElectronica'),
    V: sigRef,
    Rect: [0, 0, 0, 0],
    F: 132,
    P: page.ref,
  });
  const widgetRef = ctx.register(widget);
  page.node.addAnnot(widgetRef);
  const form = doc.getForm();
  form.acroForm.addField(widgetRef);
  form.acroForm.dict.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  return doc.save({ useObjectStreams: false });
}
