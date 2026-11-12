/**
 * Dependencias del entorno. El runtime de navegador las crea a partir de `assetsPath`
 * (import() dinámico de pdf.js, tesseract y onnxruntime). En Node (tests, CLI del builder)
 * se inyectan directamente.
 */

export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d', opts?: unknown): unknown;
}

// Tipos mínimos de pdf.js que usa DocMatch (evita acoplar el núcleo a sus tipos).
export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}
export interface PdfViewport {
  width: number;
  height: number;
  convertToViewportPoint(x: number, y: number): [number, number];
}
export interface PdfPage {
  getViewport(o: { scale: number; rotation?: number }): PdfViewport;
  getTextContent(): Promise<{ items: (PdfTextItem | { type: string })[] }>;
  render(o: { canvasContext: unknown; viewport: PdfViewport; annotationMode?: number }): {
    promise: Promise<void>;
  };
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  getAnnotations(): Promise<Record<string, unknown>[]>;
  cleanup(): void;
}
export interface PdfDocument {
  numPages: number;
  getPage(i: number): Promise<PdfPage>;
  getFieldObjects(): Promise<Record<string, Record<string, unknown>[]> | null>;
  destroy(): Promise<void>;
}
export interface PdfJsLike {
  getDocument(src: Record<string, unknown>): { promise: Promise<PdfDocument>; destroy?(): Promise<void> };
  OPS: Record<string, number>;
}

export interface OcrWord {
  text: string;
  conf: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}
export interface OcrEngine {
  recognize(canvas: CanvasLike): Promise<{ words: OcrWord[]; confidence: number }>;
  terminate?(): Promise<void>;
}

export interface VisionEngine {
  modelId: string;
  modelVersion: string;
  input: { width: number; height: number };
  /** Entrada: escala de grises normalizada [-1, 1], forma 1×1×H×W. Salida: embedding L2-normalizado. */
  embed(pixels: Float32Array): Promise<Float32Array>;
  /** Banco de negativos (embeddings de documentos genéricos con su categoría), si está disponible. */
  negatives?(): Promise<{ labels: string[]; vectors: Float32Array[] } | null>;
}

export interface Env {
  pdfjs(): Promise<PdfJsLike>;
  /** Opciones extra para getDocument (standardFontDataUrl, CanvasFactory…). */
  pdfOptions?: Record<string, unknown>;
  createCanvas(w: number, h: number): CanvasLike;
  ocr?(): Promise<OcrEngine>;
  vision?(): Promise<VisionEngine | null>;
  fetchJson(url: string): Promise<unknown>;
}

export function ctx2d(c: CanvasLike): CanvasRenderingContext2D {
  return c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
}
