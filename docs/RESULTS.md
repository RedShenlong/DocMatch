# Resultados del MVP (medidos)

Entorno de medida: portátil Linux con **2 núcleos y 5 GB de RAM**, sin GPU; Node 22 + onnxruntime-web
(WASM, 1 hilo) para el informe; Chromium/Firefox de Playwright para los e2e. Modelo `docmatch-encoder`
1.0.0 (FP32). El informe completo se regenera con `pnpm --filter @docmatch/builder accuracy` y queda en
`packages/fixtures/out/accuracy-report.md` (+ `.json` con cada caso).

## Precisión sobre los fixtures (116 casos)

| Conjunto | Casos | Estado correcto | Estado + campos correctos | Tiempo medio por documento |
|---|---:|---:|---:|---:|
| Digitales (incl. cifrado, corrupto, no PDF) | 29 | **100 %** | **100 %** | 0,13 s |
| Escaneados (mecanografiados) | 14 | **100 %** | **100 %** | 7,6 s |
| Rellenados a mano y escaneados | 19 | **100 %** | **100 %** | 8,6 s |
| Hold-out digitales | 18 | **100 %** | **100 %** | 0,08 s |
| Hold-out escaneados (a máquina y a mano) | 36 | 94,4 % | 94,4 % | 5,7 s |

«Estado correcto» = `match` / `incomplete` / `mismatch` / `unreadable` y plantilla correcta.
«+ campos» exige además exactamente los campos que faltan (y en digitales, los inválidos).

**Reconocimiento de la plantilla** (aceptar la correcta y rechazar primos, otros formularios y documentos
ajenos): **100 % en todos los conjuntos**, también en escaneos de plantillas que el modelo nunca vio y en
los formularios «primos» (mismo diseño, distinto título), digitales y escaneados. Todos los fallos
restantes son de campos (un aviso de «falta firma» o «falta un campo» de más o de menos).

### Formularios rellenados a mano (campos)

- Campos obligatorios evaluados: 372 (19 formularios de la plantilla principal + 12 del hold-out)
- Acierto relleno / vacío: **99,7 %**
- Falsos avisos de «falta»: **0,0 %**
- Detección de la firma (presente / ausente): **96,7 %** (30 firmas)

Fallos restantes en el hold-out escaneado: un número de un dígito («miembros») no detectado en un escaneo
con mucho ruido (falso «falta») y una región de firma vacía con ruido de escaneo tomada por firma.

## Criterios de aceptación

| Criterio | Objetivo | Resultado |
|---|---|---|
| Fixtures digitales | 100 % | **100 %** (47/47, incl. hold-out) |
| Escaneados simulados, también hold-out | ≥ 95 % | 100 % (plantillas principales); 94,4 % en hold-out (34/36); **97,1 %** sobre todos los escaneados (67/69) |
| Distingue el «primo», también escaneado | sí | **sí** (16/16 primos rechazados: 2 digitales + 2 escaneados de la plantilla principal, 12 del hold-out) |
| Campos vacíos y falta de firma a mano | ≥ 95 %, falsos avisos ≤ 3 % | **99,7 %** de acierto, **0 %** de falsos avisos; firma 96,7 % |
| Tamaño del modelo | ≤ 10 MB (objetivo 5 MB) | **4,8 MiB** FP32 (1,5 MiB INT8 opcional) |
| Inferencia por página | ≤ 300 ms portátil, ≤ 1,5 s móvil | **51 ms** (WASM, 1 hilo, 2 núcleos); móvil no medido en dispositivo real |
| PDF digital de 2 páginas | < 1 s | **0,13 s** de media (máx. < 1 s en los tests) |
| Escaneo de 2 páginas en móvil | < 8 s | 7,6–8,6 s en este portátil (Node); ~8 s en Chromium. En un móvil medio será más lento: **no se cumple con seguridad** |
| Núcleo | < 50 KB gzip | **20,2 KB** gzip (ESM), 18,2 KB (IIFE) |
| Navegadores | Chrome, Firefox, Safari, Edge (escritorio y móvil) | Chromium, Firefox y Chrome móvil (emulado): **todos los e2e pasan**. WebKit/Safari no se pudo ejecutar aquí (faltan librerías del sistema: `libicu66`, `libwebp6`, `libffi7`; en CI se instalan con `--with-deps`) |
| Integración | 2 líneas de HTML | **sí** (`<script>` + `data-docmatch`) |
| Accesibilidad | WCAG 2.1 AA | `role=status`, `aria-live=polite`, `aria-describedby`, contraste ≥ 6,4:1 en todos los estados, sin depender del color (icono + texto), respeta `prefers-reduced-motion` |
| Privacidad | nada sale del dispositivo | test e2e: durante `check()` solo hay `GET` al mismo origen, a `assets/` y al perfil |

## Modelo visual (hold-out de 153 clases)

Ver [`packages/model/MODEL_CARD.md`](../packages/model/MODEL_CARD.md): top-1 0,951 (compitiendo con las primas),
AUC 0,999, TPR 99,6 % con FPR 1 %.

## Limitaciones conocidas

- Los escaneos de los fixtures se generan a 150 ppp con ruido, desenfoque, sombras, perspectiva y JPEG
  agresivos; el OCR (Tesseract, `tessdata_fast`) es el cuello de botella de tiempo y de lectura de
  formatos. Con escaneos reales a 200–300 ppp la lectura mejora.
- La firma manuscrita se detecta por tinta + un clasificador sobre el encoder; el caso límite es una firma
  muy fina en un escaneo con mucho ruido.
- Los tiempos en móvil y Safari no se han medido en dispositivos reales.
