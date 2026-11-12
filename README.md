# DocMatch

**[Español](#español) · [English](#english)**

---

## Español

DocMatch es una librería JavaScript (Apache-2.0) que comprueba, **en el navegador del usuario y sin enviar nada a ningún servidor**, que el PDF que va a subir a un formulario web es **la plantilla oficial concreta que se le pide** y que **tiene rellenos los datos obligatorios**. Si no lo es, se lo dice *antes* de enviarlo.

```
✕ No parece el documento solicitado (Solicitud de licencia de armas). Revisa que has adjuntado el archivo correcto.
! Al documento le faltan datos: DNI/NIE, Firma.
✓ Documento correcto: Solicitud de licencia de armas.
```

- **100 % local**: el archivo nunca sale del dispositivo. Sin telemetría ni APIs externas. Solo se descargan el perfil y los recursos de la librería, y todo se puede alojar en tu servidor.
- **Integración trivial**: un `<script>` y un atributo HTML.
- **Avisa, no bloquea** (el bloqueo es opcional). Mensaje discreto y accesible (WCAG 2.1 AA), sin modales.
- **PDF digitales y escaneados**, también **rellenados a mano**: OCR (Tesseract) y un **modelo de visión pequeño** (MobileNetV3-Small, 4,8 MiB en FP32 o 1,5 MiB en INT8) que se ejecuta en el navegador.
- **Ligero**: núcleo de ~20 KB gzip. pdf.js, el OCR y el modelo se cargan solo cuando hacen falta.

> ⚠️ **DocMatch no es un sistema antifraude.** Sirve para evitar errores honestos (adjuntar otro archivo, olvidar un campo), no para detectar falsificaciones. Un documento manipulado puede pasar la comprobación. La validación real debe hacerse **en el servidor**: firma electrónica, CSV (Código Seguro de Verificación) y revisión de la Administración.

### Estado

MVP 0.1.0, **aún no publicado en npm**. Mientras tanto, desde este repositorio: `pnpm install && pnpm build`,
usa `packages/core/dist/` como carpeta `docmatch` y genera perfiles con
`pnpm --filter @docmatch/builder cli plantilla.pdf -o perfil.json` (equivale a `npx docmatch-build`).
Resultados medidos: [`docs/RESULTS.md`](docs/RESULTS.md).

### Inicio rápido (3 pasos)

**1. Genera el perfil de tu plantilla** (una vez, con la plantilla vacía):

```bash
npx docmatch-build plantilla.pdf -o perfiles/licencia.json
#   --example relleno-ficticio.pdf   (opcional, hasta 3)
#   --expect-csv --expect-signature  (si el documento debe traer CSV / firma electrónica)
```

O abre la app web del builder (`pnpm --filter @docmatch/builder web:dev`), que funciona sin conexión: sube la plantilla, revisa los campos que propone (puedes renombrarlos, marcarlos como obligatorios o dibujar otros) y pulsa **Generar perfil**. El builder entrena automáticamente el reconocimiento visual de *esa* plantilla con cientos de variantes sintéticas (escaneos, fotocopias, relleno a mano) y te muestra la precisión estimada.

**2. Publica** el perfil y la carpeta `dist/` de `docmatch` en tu web (por ejemplo en `/docmatch/`).

**3. Añade el atributo**:

```html
<script src="/docmatch/docmatch.min.js" defer></script>
<input type="file" accept="application/pdf" data-docmatch="/perfiles/licencia.json">
<!-- varias plantillas válidas: data-docmatch="/perfiles/a.json,/perfiles/b.json" -->
```

### API programática

```js
import { DocMatch } from 'docmatch';

const dm = await DocMatch.load(['/perfiles/licencia.json'], { assetsPath: '/docmatch/assets/' });
const result = await dm.check(file);   // no toca el DOM
// { status: 'match'|'incomplete'|'mismatch'|'unreadable'|'error', profileId, score,
//   missingFields: [{key,label}], invalidFields: [{key,label,reason}], warnings, messages, timings }

DocMatch.attach('#input', { profiles: ['/perfiles/licencia.json'], mode: 'warn', lang: 'es' });
```

### Opciones

| Opción | Atributo HTML | Valores | Por defecto |
|---|---|---|---|
| `mode` | `data-docmatch-mode` | `'warn'` (nunca impide enviar) · `'block'` (marca el input con `setCustomValidity`) | `'warn'` |
| `lang` | `data-docmatch-lang` | `'es'`, `'en'` | `lang` del documento o `'es'` |
| `ui` | `data-docmatch-ui` | `true` / `false` (sin mensaje, solo eventos) | `true` |
| `messages` | — | textos personalizados por clave (`match`, `mismatch`, `incomplete_missing`…, ver `src/i18n.ts`) | — |
| `assetsPath` | `data-docmatch-assets` | carpeta con `pdfjs/`, `tesseract/`, `tessdata/`, `ort/`, `model/` | `assets/` junto al script |
| `ocr` | `data-docmatch-ocr` | `'auto'` · `'off'` | `'auto'` |
| `visualOnDigital` | — | usar también el modelo visual en PDF digitales | `false` |

### Eventos

Se emiten en el `<input>` (con `bubbles: true`):

- `docmatch:start` — `detail = { files }`
- `docmatch:result` — `detail = result`
- `docmatch:error` — `detail = result` (estado `error`; nunca se bloquea el envío por un error interno)

### Personalizar el aspecto

El mensaje es un `<div class="docmatch-msg" role="status" aria-live="polite" data-state="…">` justo después del input. Se ajusta con variables CSS: `--docmatch-ok`, `--docmatch-ok-bg`, `--docmatch-warn`, `--docmatch-warn-bg`, `--docmatch-error`, `--docmatch-error-bg`, `--docmatch-info`, `--docmatch-font-size`, `--docmatch-radius`, `--docmatch-padding`, `--docmatch-margin`, `--docmatch-max-width`.

### Cómo funciona

1. **Comprobaciones básicas**: cabecera `%PDF`, tamaño, cifrado, corrupción.
2. **Texto con posiciones** (pdf.js). Si hay poco texto se trata como escaneo: se renderiza la página, se corrige la orientación (0/90/180/270°) y la inclinación, se binariza de forma adaptativa, se borran los marcos de las casillas y se pasa OCR (Tesseract, español) en un Worker.
3. **Reconocimiento de la plantilla** combinando señales (todas implementan la misma interfaz `Matcher`):
   - **anclas de texto**: líneas fijas de la plantilla, con coincidencia difusa (Levenshtein y trigramas). Las *distintivas* (título, código del modelo, finalidad) pesan más y además son obligatorias, así un formulario *primo* (mismo diseño, distinto título) no pasa;
   - **coherencia de posiciones**: transformación afín por RANSAC;
   - **número de páginas**, **hash perceptual** y **modelo visual** (embedding + cabeza ligera entrenada para esa plantilla + banco de negativos);
   - **fusión calibrada** (regresión logística) con pesos distintos para PDF digitales y escaneos.
4. **Campos**: con la transformación (afín global y ajuste local por campo) se localiza cada región. AcroForm tiene prioridad. En PDF digitales se lee el texto y se valida el formato (DNI/NIE con letra de control, NIF/CIF, IBAN módulo 97, fechas, email, teléfono, código postal, patrón propio). En escaneos y formularios a mano se mide la **tinta** frente a la plantilla vacía (y, con el modelo, distancia de embeddings y un clasificador de firma). El formato solo se valida si el OCR tiene confianza alta.
5. **Firma electrónica y CSV**: solo para avisar si faltan (sin validación criptográfica).

### Formato del perfil

El perfil (`profile.json`) es lo único que publica el dueño de la web. Tiene un esquema versionado (`schemaVersion: 1`) definido con JSON Schema en [`packages/builder/src/lib/profile.schema.json`](packages/builder/src/lib/profile.schema.json). Hay un ejemplo comentado en [`docs/profile-example.jsonc`](docs/profile-example.jsonc). Contiene: identificación, páginas, anclas (texto normalizado y caja relativa), campos (clave, etiqueta, tipo, obligatoriedad, región, ancla, patrón, estadísticas de la región vacía), campos AcroForm, huella visual (dHash, prototipos y cabeza ligera), calibración (umbrales y métricas), `modelId`/`modelVersion`, `expect` y `thresholds`. **No contiene datos personales**: el builder avisa si detecta DNI, IBAN, correos o teléfonos reales en la plantilla (`--strict` hace que falle).

### Privacidad

- El PDF se lee con `FileReader`/`Blob.arrayBuffer()` y se procesa en memoria; no se envía ni se guarda.
- Peticiones de red: solo el perfil y los recursos de `assetsPath` (pdf.js, OCR, modelo). Un test e2e intercepta todas las peticiones durante `check()` y falla si hay alguna a otro origen, un método distinto de `GET` o un cuerpo de petición.
- pdf.js se usa con `isEvalSupported: false`, sin descargas iniciadas por el PDF.
- El modelo y los datos de OCR se guardan en la caché del navegador (Cache API / IndexedDB) del propio sitio.

### Limitaciones

- No es antifraude (ver arriba).
- Entrada: PDF (digitales y escaneados). No admite JPG/PNG sueltos ni Word.
- El OCR de escaneos muy degradados (≤150 ppp con mucho ruido) puede fallar: se informa «No hemos podido leer bien el documento» o se avisa de campos que en realidad están rellenos. El modo por defecto (`warn`) nunca impide enviar.
- La letra manuscrita no se «lee»: solo se detecta si el campo tiene tinta. Los formatos solo se validan cuando el OCR es fiable.
- Los tiempos en móvil no se han medido en dispositivos reales (ver [`docs/RESULTS.md`](docs/RESULTS.md)).

### Monorepo

```
packages/core       librería de navegador "docmatch" (ESM + IIFE) y entorno Node
packages/builder    generador de perfiles: app web + CLI docmatch-build
packages/fixtures   generador de PDF sintéticos de prueba (formularios ficticios)
packages/model      entrenamiento, exportación ONNX e INT8 del encoder visual (Python)
examples/demo       demo con varios inputs
```

```bash
pnpm install
pnpm build                                   # núcleo (dist/ + assets) y builder web
pnpm --filter @docmatch/fixtures generate    # fixtures de prueba
pnpm --filter @docmatch/builder profiles     # perfiles de las plantillas de prueba
pnpm test                                    # unitarios + integración (digitales)
pnpm --filter @docmatch/builder accuracy     # informe de precisión (incluye OCR; varios minutos)
pnpm exec playwright test                    # e2e (Chromium, Firefox, WebKit, móvil)
pnpm --filter @docmatch/demo dev             # demo en http://localhost:5173
```

Reentrenar el modelo: ver [`packages/model/README.md`](packages/model/README.md).

---

## English

DocMatch is an open-source JavaScript library (Apache-2.0) that checks, **in the user's browser and without sending anything to any server**, that the PDF about to be uploaded to a web form is **the specific official template requested** and that **its mandatory fields are filled in**. If not, it tells the user *before* submitting.

- **100 % local**: the file never leaves the device. No telemetry, no external APIs. Only the profile and the library's own assets are fetched, and all of them can be self-hosted.
- **Trivial integration**: one `<script>` and one HTML attribute.
- **Warns, doesn't block** (blocking is optional). Discreet, accessible message (WCAG 2.1 AA), no modals.
- **Digital and scanned PDFs**, including **hand-filled** forms: OCR (Tesseract) and a **small vision model** (MobileNetV3-Small, 4.8 MiB FP32 or 1.5 MiB INT8) running in the browser.
- **Lightweight**: ~20 KB gzip core. pdf.js, OCR and the model are lazy-loaded.

> ⚠️ **DocMatch is not an anti-fraud system.** It prevents honest mistakes, not forgeries. Real validation must happen **server-side** (electronic signature, CSV secure verification code, human review).

### Status

MVP 0.1.0, **not yet published to npm**. From this repository: `pnpm install && pnpm build`, serve
`packages/core/dist/` as the `docmatch` folder and build profiles with
`pnpm --filter @docmatch/builder cli template.pdf -o profile.json` (same as `npx docmatch-build`).

### Quick start

1. Build the profile from the blank template: `npx docmatch-build template.pdf -o profiles/form.json` (or use the offline builder web app).
2. Publish the profile and the `dist/` folder of `docmatch` on your site.
3. Add the attribute:

```html
<script src="/docmatch/docmatch.min.js" defer></script>
<input type="file" accept="application/pdf" data-docmatch="/profiles/form.json">
```

Programmatic API: `DocMatch.load(profiles, options)`, `dm.check(file)` (no DOM), `DocMatch.attach(input, options)`. Options: `mode` (`warn`|`block`), `lang` (`es`|`en`), `ui`, `messages`, `assetsPath`, `ocr` (`auto`|`off`). Events on the input: `docmatch:start`, `docmatch:result`, `docmatch:error` (`detail = result`). Result: `{ status, profileId, score, missingFields, invalidFields, warnings, messages, timings }`.

The profile format is a versioned JSON Schema (`packages/builder/src/lib/profile.schema.json`, commented example in `docs/profile-example.jsonc`). Profiles never contain personal data; the builder warns (or fails with `--strict`) if it finds real IDs, IBANs, emails or phone numbers in the template.

Limitations: not anti-fraud; PDF only (no loose images or Word); heavily degraded scans may be unreadable; handwriting is detected (ink present) but not read; mobile timings were not measured on real devices. See [`docs/RESULTS.md`](docs/RESULTS.md) for measured accuracy and performance.

## Licencia / License

Apache-2.0 ([LICENSE](LICENSE)). Código, modelo y datos sintéticos. Componentes de terceros: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Las fuentes manuscritas de `packages/fixtures/fonts` tienen su propia licencia (SIL OFL 1.1 / Apache-2.0) y solo se usan para generar datos de prueba.
