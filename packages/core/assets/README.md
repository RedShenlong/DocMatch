# Recursos del runtime

Se copian a `dist/assets/` al compilar (`scripts/copy-assets.mjs`) y se cargan bajo demanda desde `assetsPath`.

- `tessdata/spa.traineddata` — modelo de OCR en español de tessdata_fast (Apache-2.0).
- `model/` — encoder visual `docmatch-encoder` 1.0.0 (Apache-2.0): `model.fp32.onnx` (por defecto),
  `model.int8.onnx` (alternativa), `model.json` (metadatos), `negatives.json` (banco de negativos),
  `eval.json` / `log.json` / `config.json` (evaluación y entrenamiento). Ver `packages/model/MODEL_CARD.md`.
