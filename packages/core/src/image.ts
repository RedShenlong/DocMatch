import type { GrayImage } from './doc';
import { ctx2d, type CanvasLike, type Env, type PdfPage } from './env';
import { apply, type Affine } from './geometry/affine';
import type { RelBox } from './profile/types';

export function toGray(c: CanvasLike): GrayImage {
  const { data } = ctx2d(c).getImageData(0, 0, c.width, c.height);
  const g = new Uint8Array(c.width * c.height);
  for (let i = 0, j = 0; i < g.length; i++, j += 4)
    g[i] = (data[j]! * 77 + data[j + 1]! * 150 + data[j + 2]! * 29) >> 8;
  return { width: c.width, height: c.height, data: g };
}

export async function renderPage(page: PdfPage, scale: number, env: Env): Promise<CanvasLike> {
  const vp = page.getViewport({ scale });
  const c = env.createCanvas(Math.max(1, Math.round(vp.width)), Math.max(1, Math.round(vp.height)));
  const ctx = ctx2d(c);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  // annotationMode 1 = ENABLE: dibuja la apariencia de los campos AcroForm.
  await page.render({ canvasContext: ctx, viewport: vp, annotationMode: 1 }).promise;
  return c;
}

/** Rota un canvas `deg` grados (múltiplos de 90 exactos; otros con remuestreo) con fondo blanco. */
export function rotateCanvas(src: CanvasLike, deg: number, env: Env): CanvasLike {
  const rad = (deg * Math.PI) / 180;
  const quarter = Math.abs(((deg % 180) + 180) % 180) === 90;
  const w = quarter ? src.height : src.width;
  const h = quarter ? src.width : src.height;
  const out = env.createCanvas(w, h);
  const ctx = ctx2d(out);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate(rad);
  ctx.drawImage(src as unknown as CanvasImageSource, -src.width / 2, -src.height / 2);
  return out;
}

export function scaleCanvas(src: CanvasLike, w: number, h: number, env: Env): CanvasLike {
  const out = env.createCanvas(w, h);
  const ctx = ctx2d(out);
  ctx.imageSmoothingEnabled = true;
  (ctx as unknown as { imageSmoothingQuality: string }).imageSmoothingQuality = 'high';
  ctx.drawImage(src as unknown as CanvasImageSource, 0, 0, w, h);
  return out;
}

/** Nivel del papel (percentil alto) para umbralizar tinta de forma robusta en escaneos. */
export function paperLevel(img: GrayImage): number {
  const hist = new Uint32Array(256);
  const step = Math.max(1, Math.floor(img.data.length / 200000));
  let n = 0;
  for (let i = 0; i < img.data.length; i += step) {
    hist[img.data[i]!]!++;
    n++;
  }
  let acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v]!;
    if (acc > n * 0.3) return v;
  }
  return 255;
}

/**
 * Inclinación dominante (grados) por perfil de proyección de los píxeles oscuros, en ±maxDeg.
 * Devuelve el ángulo que hay que aplicar con rotateCanvas para enderezar.
 */
export function estimateSkew(img: GrayImage, maxDeg = 5, step = 0.25): number {
  const thr = paperLevel(img) - 80;
  const pts: [number, number][] = [];
  const stride = Math.max(1, Math.floor(Math.sqrt((img.width * img.height) / 250000)));
  // Se ignoran los márgenes: bordes oscuros del escáner alineados con la imagen falsean el ángulo.
  const mx = Math.round(img.width * 0.06),
    my = Math.round(img.height * 0.05);
  for (let y = my; y < img.height - my; y += stride) {
    for (let x = mx; x < img.width - mx; x += stride)
      if (img.data[y * img.width + x]! < thr) pts.push([x, y]);
  }
  if (pts.length < 200) return 0;
  const sample = pts.length > 60000 ? pts.filter((_, i) => i % Math.ceil(pts.length / 60000) === 0) : pts;
  let best = 0;
  let bestScore = -1;
  const bins = new Float64Array(Math.ceil((img.height * 1.2) / stride) + 8);
  for (let a = -maxDeg; a <= maxDeg + 1e-9; a += step) {
    const r = (a * Math.PI) / 180;
    const s = Math.sin(r),
      c = Math.cos(r);
    bins.fill(0);
    for (const [x, y] of sample) {
      const yy = Math.round((-x * s + y * c) / stride) + Math.floor(bins.length / 10);
      if (yy >= 0 && yy < bins.length) bins[yy]!++;
    }
    let score = 0;
    for (let i = 0; i < bins.length; i++) score += bins[i]! * bins[i]!;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return -best;
}

/**
 * Fracción de píxeles con tinta dentro de una caja de la plantilla, proyectada sobre la imagen
 * del documento con la transformación `t` (coordenadas relativas de plantilla → documento).
 * `margin` recorta los bordes de la caja para no contar el marco impreso.
 */
export function inkRatio(
  img: GrayImage,
  box: RelBox,
  t: Affine,
  margin = 0.18,
  paper = paperLevel(img),
  delta = 50,
): number {
  const thr = paper - delta;
  const mx = Math.min(box.w * margin, box.w * 0.05 + 4 / img.width);
  const my = box.h * margin;
  const x0 = box.x + mx,
    x1 = box.x + box.w - mx;
  const y0 = box.y + my,
    y1 = box.y + box.h - my * 1.2;
  if (x1 <= x0 || y1 <= y0) return 0;
  const nx = Math.max(4, Math.min(600, Math.round((x1 - x0) * img.width)));
  const ny = Math.max(3, Math.min(200, Math.round((y1 - y0) * img.height)));
  // Columnas con tinta; la medida es la máxima densidad en una ventana de ~3 alturas de ancho,
  // así un texto corto en una caja muy ancha cuenta igual que uno largo.
  const col = new Float32Array(nx);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = apply(t, { x: x0 + ((i + 0.5) / nx) * (x1 - x0), y: y0 + ((j + 0.5) / ny) * (y1 - y0) });
      const px = Math.round(p.x * img.width),
        py = Math.round(p.y * img.height);
      if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
      if (img.data[py * img.width + px]! < thr) col[i]!++;
    }
  }
  const ww = Math.max(1, Math.min(nx, Math.round(ny * 3)));
  let acc = 0;
  for (let i = 0; i < ww; i++) acc += col[i]!;
  let best = acc;
  for (let i = ww; i < nx; i++) {
    acc += col[i]! - col[i - ww]!;
    if (acc > best) best = acc;
  }
  return best / (ww * ny);
}

/** Recorta y reescala una región (con transformación) a w×h valores [0,255]. */
export function sampleRegion(img: GrayImage, box: RelBox, t: Affine, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const p = apply(t, { x: box.x + ((i + 0.5) / w) * box.w, y: box.y + ((j + 0.5) / h) * box.h });
      const px = Math.min(img.width - 1, Math.max(0, Math.round(p.x * img.width)));
      const py = Math.min(img.height - 1, Math.max(0, Math.round(p.y * img.height)));
      out[j * w + i] = img.data[py * img.width + px]!;
    }
  }
  return out;
}

/** Media de bloques (reducción por área) de una imagen en escala de grises. */
export function downsample(img: GrayImage, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const ya = Math.floor((j * img.height) / h),
      yb = Math.max(ya + 1, Math.floor(((j + 1) * img.height) / h));
    for (let i = 0; i < w; i++) {
      const xa = Math.floor((i * img.width) / w),
        xb = Math.max(xa + 1, Math.floor(((i + 1) * img.width) / w));
      let s = 0,
        n = 0;
      for (let y = ya; y < yb; y += 1)
        for (let x = xa; x < xb; x += 1) {
          s += img.data[y * img.width + x]!;
          n++;
        }
      out[j * w + i] = s / n;
    }
  }
  return out;
}

/** dHash de (w+1)×h → w·h bits, en hexadecimal. */
export function dhash(img: GrayImage, w = 16, h = 16): string {
  const d = downsample(img, w + 1, h);
  let bits = '';
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) bits += d[y * (w + 1) + x]! > d[y * (w + 1) + x + 1]! ? '1' : '0';
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export function hashSimilarity(a: string, b: string): number {
  if (a.length !== b.length) return 0;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) {
      diff += x & 1;
      x >>= 1;
    }
  }
  return 1 - diff / (a.length * 4);
}

/**
 * Binarización adaptativa (Bradley) con suavizado previo: elimina ruido de escáner, sombras y
 * fondos grises antes del OCR. Devuelve un canvas nuevo en blanco y negro.
 */
export function binarizeForOcr(src: CanvasLike, env: Env, k = 0.22, removeLines = true): CanvasLike {
  const g = toGray(src);
  const W = g.width,
    H = g.height;
  // Suavizado 3×3 (media) para el ruido de grano fino.
  const s = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let acc = 0,
        n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          acc += g.data[yy * W + xx]!;
          n++;
        }
      }
      s[y * W + x] = acc / n;
    }
  }
  // Imagen integral.
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 1; y <= H; y++) {
    let row = 0;
    for (let x = 1; x <= W; x++) {
      row += s[(y - 1) * W + x - 1]!;
      I[y * (W + 1) + x] = I[(y - 1) * (W + 1) + x]! + row;
    }
  }
  const r = Math.max(8, Math.round(W / 50));
  const bin = new Uint8Array(W * H); // 1 = tinta
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r),
      y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r),
        x1 = Math.min(W, x + r + 1);
      const sum =
        I[y1 * (W + 1) + x1]! - I[y0 * (W + 1) + x1]! - I[y1 * (W + 1) + x0]! + I[y0 * (W + 1) + x0]!;
      const mean = sum / ((x1 - x0) * (y1 - y0));
      bin[y * W + x] = s[y * W + x]! < mean * (1 - k) && s[y * W + x]! < 200 ? 1 : 0;
    }
  }
  if (removeLines) removeRuledLines(bin, W, H);
  const out = env.createCanvas(W, H);
  const ctx = ctx2d(out);
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let i = 0; i < bin.length; i++) {
    const v = bin[i] ? 0 : 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/**
 * Borra las líneas rectas largas (marcos de casillas, subrayados, filetes) de una imagen binaria:
 * tramos horizontales o verticales de tinta más largos que ~1/25 del ancho. Mejora mucho el OCR
 * en formularios, porque Tesseract confunde los marcos con letras o tablas.
 */
export function removeRuledLines(bin: Uint8Array, W: number, H: number): void {
  const minH = Math.round(W / 22);
  const minV = Math.round(W / 45);
  const T = Math.max(3, Math.round(W / 400)); // grosor máximo de una línea
  const mask = new Uint8Array(W * H);
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? bin[y * W + x]! : 0);
  // Un tramo es línea si, a T+1 píxeles por encima y por debajo, casi no hay tinta.
  const thinH = (x0: number, x1: number, y: number) => {
    let n = 0;
    for (let x = x0; x < x1; x++) n += at(x, y - T - 1) | at(x, y + T + 1);
    return n / (x1 - x0) < 0.25;
  };
  const thinV = (y0: number, y1: number, x: number) => {
    let n = 0;
    for (let y = y0; y < y1; y++) n += at(x - T - 1, y) | at(x + T + 1, y);
    return n / (y1 - y0) < 0.25;
  };
  // Tramos con huecos de hasta 2 px (líneas algo inclinadas o con ruido); se mira también ±1 fila.
  const G = 2;
  for (let y = 0; y < H; y++) {
    let start = -1,
      gap = 0;
    for (let x = 0; x <= W; x++) {
      const on = x < W && (bin[y * W + x] || (y > 0 && bin[(y - 1) * W + x] && bin[y * W + x - 1]));
      if (on) {
        if (start < 0) start = x;
        gap = 0;
      } else if (start >= 0 && ++gap > G) {
        const end = x - gap + 1;
        if (end - start >= minH && thinH(start, end, y))
          for (let k = start; k < end; k++) mask[y * W + k] = 1;
        start = -1;
        gap = 0;
      }
    }
  }
  for (let x = 0; x < W; x++) {
    let start = -1,
      gap = 0;
    for (let y = 0; y <= H; y++) {
      const on = y < H && bin[y * W + x];
      if (on) {
        if (start < 0) start = y;
        gap = 0;
      } else if (start >= 0 && ++gap > G) {
        const end = y - gap + 1;
        if (end - start >= minV && thinV(start, end, x))
          for (let k = start; k < end; k++) mask[k * W + x] = 1;
        start = -1;
        gap = 0;
      }
    }
  }
  // Dilatación vertical de 1 px de la máscara horizontal (bordes de la línea).
  for (let i = W; i < mask.length - W; i++) if (mask[i] === 1 && !mask[i - W]) mask[i - W] = 2;
  for (let i = 0; i < mask.length; i++) if (mask[i]) bin[i] = 0;
}
