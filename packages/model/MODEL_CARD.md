# Ficha del modelo — `docmatch-encoder`

## Descripción

Encoder visual genérico de DocMatch: convierte una página de documento (escala de grises, 384×288,
encajada sobre blanco) en un embedding L2 de 128 dimensiones. Es compartido por todos los perfiles; la
especialización en cada plantilla (prototipos, cabeza lineal 128→32, clasificador de firma y calibración)
la hace el builder sin reentrenar el encoder.

- **Arquitectura**: MobileNetV3-Small (torchvision) con primera convolución de 1 canal, *pooling* medio +
  máximo y cabeza 1152→256→128.
- **Entrenamiento**: SupCon (temperatura 0,1), lotes P×K = 48×4 con primas como negativos difíciles,
  AdamW (lr 2e-3, wd 0,05), coseno con calentamiento, 40 épocas × 60 pasos, precisión mixta, semilla 1234.
  GPU NVIDIA T4 (Google Colab), ~15 min.
- **Pesos iniciales**: aleatorios (sin ImageNet).
- **Archivos**: `model.fp32.onnx` (~4,8 MiB) y `model.onnx` INT8 QDQ por canal (~1,5 MiB). `model.json`
  indica cuál carga el runtime (`file`).
- **Licencia**: Apache-2.0.

## Datos

Solo datos sintéticos propios (ver [DATA.md](DATA.md)): 300 familias de formularios administrativos
ficticios × 2 variantes (plantilla y prima) × 5 versiones (vacía, a máquina, a mano) + documentos ajenos
→ 4600 páginas y 1160 clases. Las degradaciones de escaneo se aplican al vuelo en la GPU.

## Evaluación

Conjunto *hold-out*: 40 familias de plantillas que el encoder **nunca vio** (semillas 900001–900040),
153 clases, 605 páginas. Protocolo de `evaluate.py`: prototipo = plantilla vacía limpia + 8 variantes;
consultas = páginas rellenas (a máquina y a mano) con simulación de escaneo; se compite contra **todas**
las clases, incluidas las primas.

Versión publicada 1.0.0 (mejor época: 31 de 40). Evaluación final con 4 aumentos por consulta
(`eval.json`):

| Métrica (hold-out, 153 clases) | PyTorch / ONNX FP32 | ONNX INT8 |
|---|---:|---:|
| Top-1 (clase correcta la más cercana, incl. primas) | **0,951** | 0,951 |
| AUC verificación (correcta vs. resto) | **0,999** | 0,996 |
| TPR con FPR = 1 % | **0,996** | 0,991 |
| Prima más cercana que la correcta | 4,4 % | 4,7 % |
| Similitud positivos, percentil 5 | **0,93** | 0,83 |
| Similitud negativos, percentil 99 | 0,60 | 0,60 |
| Documentos ajenos, percentil 95 | 0,52 | 0,54 |
| Coseno INT8 vs FP32 (medio / mínimo) | — | 0,973 / 0,852 |
| Tamaño | 4,8 MiB | 1,5 MiB |
| Inferencia por página (onnxruntime-web WASM, 1 hilo, CPU de 2 núcleos) | 51 ms | 65 ms |

Por la pérdida de separación de la versión INT8 (percentil 5 de positivos 0,93 → 0,83), **el runtime usa
FP32 por defecto** (4,8 MiB, dentro del objetivo de 5 MB). La INT8 se incluye como alternativa
(`"file": "model.int8.onnx"` en `model.json`). Curva de entrenamiento: `log.json`.

## Usos previstos y limitaciones

- Previsto: señal visual complementaria para reconocer **una plantilla concreta** en el navegador, sobre todo
  en escaneos, junto a las anclas de texto. No se usa solo: la decisión final es una fusión calibrada.
- No distingue por sí solo plantillas casi idénticas (primas): para eso son decisivas las anclas de texto
  distintivas (título, código del modelo).
- Entrenado con formularios sintéticos en español; documentos con diseños muy distintos (tablas densas,
  fotografías, varias columnas) pueden dar similitudes menos fiables. La cabeza por plantilla y la
  calibración del builder compensan parte de esa diferencia.
- No es un detector de falsificaciones.
- La cuantización INT8 reduce algo la precisión (ver métricas); por eso se publica también la versión FP32.
