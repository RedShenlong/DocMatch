/**
 * Interfaz común para todas las señales (anclas de texto, layout, hash perceptual, modelo visual).
 * Añadir o sustituir un matcher no cambia la API pública: la fusión solo ve { id, score, confidence }.
 */
export interface MatchSignal {
  /** Identificador estable, p. ej. "anchors", "layout", "phash", "vision". */
  id: string;
  /** 0–1: cuánto se parece el documento a la plantilla según esta señal. */
  score: number;
  /** 0–1: cuánto fiarse de esta señal (p. ej. baja si el OCR leyó poco texto). */
  confidence: number;
  /** Datos auxiliares (p. ej. "parece una factura"). */
  details?: Record<string, unknown>;
}

export interface Matcher<Ctx, Profile> {
  readonly id: string;
  /** Si devuelve false, la señal se omite (p. ej. el modelo visual en un PDF digital). */
  applies(ctx: Ctx, profile: Profile): boolean;
  match(ctx: Ctx, profile: Profile): Promise<MatchSignal[]>;
}
