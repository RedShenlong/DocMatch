# @docmatch/model — encoder visual

Encoder **genérico y pequeño** que convierte una página de documento en un embedding de 128 dimensiones.
Es el mismo para todos los perfiles: la especialización en cada plantilla (prototipos + cabeza lineal
de 128→32, clasificador de firma y calibración) la hace el builder, así que **nunca hace falta
reentrenar el encoder para un documento nuevo**.

| | |
|---|---|
| Arquitectura | MobileNetV3-Small (torchvision), primera capa adaptada a 1 canal, *pooling* medio + máximo, cabeza 1152→256→128, L2 |
| Entrada | escala de grises 1×384×288 en [-1, 1], página encajada (*letterbox*) sobre blanco — idéntico a `pageTensor()` del runtime |
| Entrenamiento | SupCon (contrastivo supervisado), lotes P×K con «primas» (mismo diseño, distinto título) como negativos difíciles, aumentos de escaneo en GPU |
| Pesos iniciales | aleatorios (sin ImageNet; ver DATA.md) |
| Exportación | ONNX opset 17 → INT8 estático QDQ por canal (onnxruntime) |
| Tamaño | ver `export/model.json` (`sizeBytes`) |

## Reentrenar desde cero

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt
make all EPOCHS=40 FAM=300 PY=.venv/bin/python   # datos → train → export → evaluate → install
```

`make data` genera los datos sintéticos con `packages/fixtures/src/node/training.ts` (semilla fija):
familias de plantillas de entrenamiento (semillas 1…300) y de evaluación *hold-out* (900001…900040, que
nunca se usan para entrenar). `train.py`, `export.py` y `evaluate.py` usan semilla fija (`--seed`).

En Google Colab (GPU T4): sube el repositorio y ejecuta `bash packages/model/colab/run.sh 300 40`; al
terminar descarga `docmatch-model-export.tgz` y descomprímelo en `packages/core/assets/model/`. Después
`pnpm --filter @docmatch/builder negatives` genera el banco de negativos con el preprocesado exacto del navegador.

Métricas y limitaciones: [MODEL_CARD.md](MODEL_CARD.md). Datos y licencias: [DATA.md](DATA.md).
