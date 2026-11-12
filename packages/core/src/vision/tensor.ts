import type { GrayImage } from '../doc';
import { downsample } from '../image';

/**
 * Página → tensor 1×1×H×W en [-1, 1], encajada (letterbox) sobre fondo blanco conservando la
 * proporción. Debe coincidir exactamente con `preprocess()` de packages/model/docmatch_model/data.py.
 */
export function pageTensor(img: GrayImage, W: number, H: number): Float32Array {
  const s = Math.min(W / img.width, H / img.height);
  const rw = Math.max(1, Math.round(img.width * s));
  const rh = Math.max(1, Math.round(img.height * s));
  const small = downsample(img, rw, rh);
  const out = new Float32Array(W * H).fill(1);
  const ox = Math.floor((W - rw) / 2);
  const oy = Math.floor((H - rh) / 2);
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) out[(y + oy) * W + x + ox] = small[y * rw + x]! / 127.5 - 1;
  return out;
}

// ---- Codificación compacta de vectores en el perfil ----

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toHalf(v: number): number {
  const f = new Float32Array([v]);
  const x = new Uint32Array(f.buffer)[0]!;
  const sign = (x >>> 16) & 0x8000;
  const exp = ((x >>> 23) & 0xff) - 127 + 15;
  const mant = x & 0x7fffff;
  if (exp <= 0) return sign;
  if (exp >= 31) return sign | 0x7c00;
  return sign | (exp << 10) | (mant >>> 13);
}
function fromHalf(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >>> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

export function encodeF16(v: ArrayLike<number>): string {
  const u = new Uint16Array(v.length);
  for (let i = 0; i < v.length; i++) u[i] = toHalf(v[i]!);
  return b64encode(new Uint8Array(u.buffer));
}
export function decodeF16(s: string): Float32Array {
  const b = b64decode(s);
  const u = new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2);
  const out = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) out[i] = fromHalf(u[i]!);
  return out;
}
export function encodeF32(v: Float32Array): string {
  return b64encode(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
}
export function decodeF32(s: string): Float32Array {
  const b = b64decode(s);
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}

export function l2norm(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!;
  n = Math.sqrt(n) || 1;
  const o = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) o[i] = v[i]! / n;
  return o;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return s / (Math.sqrt(na * nb) || 1);
}

/** Proyección lineal (cabeza por plantilla) + normalización L2. */
export function project(W: Float32Array, inDim: number, outDim: number, v: Float32Array): Float32Array {
  const o = new Float32Array(outDim);
  for (let r = 0; r < outDim; r++) {
    let s = 0;
    for (let c = 0; c < inDim; c++) s += W[r * inDim + c]! * v[c]!;
    o[r] = s;
  }
  return l2norm(o);
}
