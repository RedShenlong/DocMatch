import { Rng } from './rng';

/**
 * Simulación de escaneo/fotocopia sobre canvas genérico (navegador u @napi-rs/canvas).
 * Solo usa la API 2D estándar + ImageData, así el builder puede reutilizarla en el navegador.
 */

export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): unknown;
}
export type CanvasFactory = (w: number, h: number) => CanvasLike;
type Ctx2D = CanvasRenderingContext2D;

export interface ScanParams {
  rotation: number; // grados, leve
  shear: number;
  keystone: number; // perspectiva aproximada (diferencia de escala horizontal arriba/abajo)
  scale: number;
  dx: number;
  dy: number;
  blur: number; // radio en px
  noise: number; // desviación típica (0–255)
  brightness: number;
  contrast: number;
  gamma: number;
  paper: number; // tono del fondo (0–255)
  shadow: number; // intensidad de sombra lateral 0–1
  cropTop: number;
  cropLeft: number;
  bgBorder: number; // grosor del borde gris (tapa del escáner)
  jpegQuality: number;
  quarterTurns: 0 | 1 | 2 | 3;
  binarize: boolean; // fotocopia de alto contraste
}

export function randomScanParams(r: Rng, strength = 1): ScanParams {
  const s = strength;
  return {
    rotation: r.gauss() * 0.9 * s,
    shear: r.gauss() * 0.006 * s,
    keystone: r.range(-0.02, 0.02) * s,
    scale: 1 + r.range(-0.05, 0.03) * s,
    dx: r.range(-0.025, 0.025) * s,
    dy: r.range(-0.025, 0.025) * s,
    blur: r.bool(0.6) ? r.range(0.3, 1.4) * s : 0,
    noise: r.range(2, 14) * s,
    brightness: r.range(-25, 15) * s,
    contrast: 1 + r.range(-0.25, 0.25) * s,
    gamma: 1 + r.range(-0.25, 0.3) * s,
    paper: 255 - r.range(0, 35) * s,
    shadow: r.bool(0.35) ? r.range(0.1, 0.45) * s : 0,
    cropTop: r.bool(0.3) ? r.range(0, 0.02) * s : 0,
    cropLeft: r.bool(0.3) ? r.range(0, 0.02) * s : 0,
    bgBorder: r.bool(0.3) ? r.range(0.005, 0.03) * s : 0,
    jpegQuality: r.range(0.45, 0.9),
    quarterTurns: 0,
    binarize: r.bool(0.12 * s),
  };
}

function boxBlurGray(g: Float32Array, w: number, h: number, radius: number) {
  const rr = Math.max(1, Math.round(radius));
  const tmp = new Float32Array(g.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      const row = y * w;
      for (let x = -rr; x <= rr; x++) acc += g[row + Math.min(w - 1, Math.max(0, x))] as number;
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / (2 * rr + 1);
        acc += (g[row + Math.min(w - 1, x + rr + 1)] as number) - (g[row + Math.max(0, x - rr)] as number);
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -rr; y <= rr; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x] as number;
      for (let y = 0; y < h; y++) {
        g[y * w + x] = acc / (2 * rr + 1);
        acc +=
          (tmp[Math.min(h - 1, y + rr + 1) * w + x] as number) - (tmp[Math.max(0, y - rr) * w + x] as number);
      }
    }
    if (radius < 1) break;
  }
}

/** Aplica la degradación de escaneo a un canvas limpio y devuelve un canvas nuevo. */
export function degrade(src: CanvasLike, p: ScanParams, make: CanvasFactory, r: Rng): CanvasLike {
  const W = src.width;
  const H = src.height;
  const rotOut = p.quarterTurns % 2 === 1;
  const out = make(rotOut ? H : W, rotOut ? W : H);
  const ctx = out.getContext('2d') as Ctx2D;
  const OW = out.width;
  const OH = out.height;
  ctx.fillStyle = `rgb(${p.paper},${p.paper},${p.paper - 4})`;
  ctx.fillRect(0, 0, OW, OH);
  ctx.save();
  ctx.translate(OW / 2, OH / 2);
  ctx.rotate((p.quarterTurns * Math.PI) / 2 + (p.rotation * Math.PI) / 180);
  ctx.transform(1, 0, p.shear, 1, 0, 0);
  ctx.scale(p.scale, p.scale);
  ctx.translate(-W / 2 + p.dx * W, -H / 2 + p.dy * H);
  // Perspectiva aproximada: franjas horizontales con escala X variable.
  const strips = p.keystone ? 24 : 1;
  const sh = H / strips;
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < strips; i++) {
    const t = (i + 0.5) / strips - 0.5;
    const sx = 1 + p.keystone * t * 2;
    const dw = W * sx;
    ctx.drawImage(
      src as unknown as CanvasImageSource,
      0,
      i * sh,
      W,
      sh + 1,
      (W - dw) / 2,
      i * sh,
      dw,
      sh + 1,
    );
  }
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';

  const img = ctx.getImageData(0, 0, OW, OH);
  const d = img.data;
  const g = new Float32Array(OW * OH);
  for (let i = 0; i < g.length; i++)
    g[i] = 0.299 * (d[i * 4] as number) + 0.587 * (d[i * 4 + 1] as number) + 0.114 * (d[i * 4 + 2] as number);
  if (p.blur > 0.25) boxBlurGray(g, OW, OH, p.blur);
  const cropT = Math.round(p.cropTop * OH);
  const cropL = Math.round(p.cropLeft * OW);
  const border = Math.round(p.bgBorder * Math.min(OW, OH));
  // Umbral de "fotocopia" relativo al tono del papel tras brillo/contraste/gamma.
  const bg =
    255 *
    Math.pow(Math.min(1, Math.max(0, ((p.paper - 128) * p.contrast + 128 + p.brightness) / 255)), p.gamma);
  const binThr = bg * 0.72;
  for (let y = 0; y < OH; y++) {
    const shadowY = p.shadow ? 1 - p.shadow * Math.max(0, 1 - y / (OH * 0.25)) * 0.5 : 1;
    for (let x = 0; x < OW; x++) {
      const i = y * OW + x;
      let v = g[i] as number;
      if (p.shadow) v *= shadowY * (1 - p.shadow * Math.max(0, 1 - x / (OW * 0.12)));
      v = (v - 128) * p.contrast + 128 + p.brightness;
      v = 255 * Math.pow(Math.min(1, Math.max(0, v / 255)), p.gamma);
      v += r.gauss() * p.noise;
      if (p.binarize) v = v < binThr ? 15 : 245;
      if (y < cropT || x < cropL) v = 40 + r.gauss() * 6;
      if (border && (x < border || y < border || x >= OW - border || y >= OH - border))
        v = 90 + r.gauss() * 8;
      v = Math.max(0, Math.min(255, v));
      d[i * 4] = v;
      d[i * 4 + 1] = v;
      d[i * 4 + 2] = v;
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/**
 * Transformación afín (coordenadas relativas 0–1, de la página limpia a la escaneada) que aplica
 * degrade() sin contar la perspectiva aproximada. Sirve para calibrar con alineación conocida.
 */
export function scanAffine(
  p: ScanParams,
  W: number,
  H: number,
): [number, number, number, number, number, number] {
  const rad = (p.rotation * Math.PI) / 180;
  const c = Math.cos(rad),
    s = Math.sin(rad);
  // out = T(W/2,H/2) · R · Shear · S · T(-W/2+dx·W, -H/2+dy·H) · in   (en píxeles)
  const tx = -W / 2 + p.dx * W,
    ty = -H / 2 + p.dy * H;
  // Shear: [1 shear; 0 1]; S: escala k.
  const k = p.scale;
  const a = c * k,
    b = (c * p.shear - s) * k;
  const d = s * k,
    e = (s * p.shear + c) * k;
  const e0 = a * tx + b * ty + W / 2,
    f0 = d * tx + e * ty + H / 2;
  // a relativo: x' = (a·x·W + b·y·H + e0)/W
  return [a, (b * H) / W, e0 / W, (d * W) / H, e, f0 / H];
}
