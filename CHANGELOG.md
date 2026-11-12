# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado: [SemVer](https://semver.org/lang/es/).

## [0.1.0] — 2026-11-12 (MVP, sin publicar)

### Añadido
- `docmatch` (núcleo): `DocMatch.load`, `check`, `attach`; integración declarativa `data-docmatch`; modos `warn`/`block`; mensajes es/en accesibles; eventos `docmatch:start|result|error`; carga diferida de pdf.js, Tesseract y onnxruntime-web desde `assetsPath`.
- Reconocimiento de plantillas: anclas de texto con coincidencia difusa y anclas distintivas obligatorias, coherencia de posiciones (afín + RANSAC), número de páginas, hash perceptual y modelo visual con cabeza por plantilla; fusión calibrada.
- Escaneos: orientación 0/90/180/270°, corrección de inclinación, binarización adaptativa, borrado de marcos, OCR en dos pasadas, alineación local por campo, detección de tinta y clasificador de firma.
- Validadores: DNI/NIE, NIF/CIF, IBAN, fechas españolas, email, teléfono, código postal, patrón propio. AcroForm con prioridad. Detección de firma electrónica y CSV.
- Builder: CLI `docmatch-build` y app web sin conexión; propuesta automática de campos (etiquetas, cajas, subrayados, casillas, firma, AcroForm, diferencias con ejemplos); detección de datos personales; entrenamiento visual y calibración automáticos; JSON Schema del perfil.
- Encoder visual MobileNetV3-Small (escala de grises, 384×288) entrenado con SupCon sobre formularios sintéticos; ONNX FP32 (4,8 MiB, por defecto) e INT8 (1,5 MiB); banco de negativos (88 KB).
- Fixtures sintéticos: plantillas, primos, ajenos, escaneos simulados, relleno a mano, hold-out, PDF cifrado/corrupto/no PDF.
- Tests unitarios, de integración, e2e (Chromium, Firefox, WebKit, móvil) y de privacidad; informe de precisión.
