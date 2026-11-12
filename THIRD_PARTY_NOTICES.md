# Avisos de terceros / Third-party notices

DocMatch se distribuye bajo Apache-2.0. La carpeta `dist/assets/` del paquete `docmatch` y la app del
builder **redistribuyen** los siguientes componentes, cada uno bajo su propia licencia:

| Componente | Uso | Licencia | Origen |
|---|---|---|---|
| pdf.js (`pdfjs-dist`) | lectura y renderizado de PDF | Apache-2.0 | Mozilla — github.com/mozilla/pdf.js |
| tesseract.js / tesseract.js-core | OCR en el navegador (WASM) | Apache-2.0 | github.com/naptha/tesseract.js |
| `spa.traineddata` (tessdata_fast) | modelo de OCR en español | Apache-2.0 | github.com/tesseract-ocr/tessdata_fast |
| onnxruntime-web | inferencia del modelo visual | MIT | Microsoft — github.com/microsoft/onnxruntime |
| `docmatch-encoder` (`assets/model/`) | modelo visual propio | Apache-2.0 | este repositorio (`packages/model`), entrenado desde cero con datos sintéticos |

Dependencias usadas solo en el builder, los fixtures o el entrenamiento (no forman parte del runtime):

| Componente | Licencia |
|---|---|
| pdf-lib, @pdf-lib/fontkit | MIT |
| @napi-rs/canvas | MIT |
| Ajv | MIT |
| PyTorch, torchvision (arquitectura MobileNetV3; sin pesos preentrenados) | BSD-3-Clause |
| ONNX, onnxruntime (Python) | Apache-2.0 / MIT |
| Fuentes Indie Flower, Reenie Beanie, Shadows Into Light | SIL OFL 1.1 |
| Fuente Homemade Apple | Apache-2.0 |

Los textos de licencia de las fuentes están en `packages/fixtures/fonts/`. Las licencias de las
dependencias npm se incluyen en sus paquetes (`node_modules/<paquete>/LICENSE`).
