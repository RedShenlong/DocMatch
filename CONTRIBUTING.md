# Contribuir a DocMatch

¡Gracias por tu interés! Algunas pautas:

## Entorno

- Node 20+ y pnpm 9 (`corepack enable` o `npm i -g pnpm@9`).
- Python 3.10+ solo si vas a tocar el modelo (`packages/model`).

```bash
pnpm install
pnpm --filter @docmatch/fixtures generate   # PDF sintéticos de prueba
pnpm test                                   # unitarios + integración
pnpm lint && pnpm typecheck
```

## Reglas del proyecto

1. **Nada sale del dispositivo.** No se aceptan cambios que envíen datos del documento, telemetría o llamadas a APIs externas. Toda petición de red debe ir a `assetsPath` o al perfil. El test de privacidad (`tests/e2e`) debe seguir pasando.
2. **Tamaño del núcleo < 50 KB gzip** (sin pdf.js, OCR ni modelo). `pnpm size` lo comprueba en CI.
3. **Avisar, no bloquear**: el modo por defecto nunca impide enviar el formulario.
4. **Sin documentos reales** en el repositorio: ni formularios oficiales, ni logotipos, ni datos personales. Usa `packages/fixtures` para generar formularios ficticios.
5. **Datos de entrenamiento**: cualquier dataset nuevo debe documentarse en `packages/model/DATA.md` con su licencia. Si la licencia no es claramente compatible con Apache-2.0, no se usa.
6. Los mensajes al usuario deben ser claros y amables, en español e inglés (`packages/core/src/i18n.ts`), y accesibles.

## Añadir una señal de reconocimiento

Implementa la interfaz `Matcher` (`packages/core/src/matchers/types.ts`): devuelve `{ id, score, confidence }`. Añade su característica a `FUSION_FEATURES` y a la calibración del builder (`packages/builder/src/lib/visual.ts`). La API pública no cambia.

## Pull requests

- Incluye tests (unitarios y, si aplica, un fixture nuevo en `generate.ts` con su estado esperado).
- Ejecuta `pnpm --filter @docmatch/builder accuracy` si tocas el reconocimiento o los campos y adjunta el resumen.
- Actualiza `CHANGELOG.md`.
