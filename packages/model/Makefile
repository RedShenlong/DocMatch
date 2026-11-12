# Reentrenar el encoder desde cero (necesita Node 20+, pnpm, Python 3.10+ y, recomendado, GPU).
FAM ?= 300
EPOCHS ?= 40
PY ?= python3

data/train/labels.csv:
	cd ../fixtures && npx tsx src/node/training.ts ../model/data/train $(FAM) 72 1
data/holdout/labels.csv:
	cd ../fixtures && npx tsx src/node/training.ts ../model/data/holdout 40 72 900001

data: data/train/labels.csv data/holdout/labels.csv

train: data
	$(PY) train.py --data data/train --holdout data/holdout --out runs/v1 --epochs $(EPOCHS)

export: runs/v1/best.pt
	$(PY) export.py --ckpt runs/v1/best.pt --calib data/train --out export

evaluate: export
	$(PY) evaluate.py --ckpt runs/v1/best.pt --holdout data/holdout --onnx export/model.onnx --out export/eval.json

# Copia el modelo al runtime y genera el banco de negativos con el mismo preprocesado que el navegador.
install: export
	mkdir -p ../core/assets/model && cp export/model.onnx export/model.json ../core/assets/model/
	cd ../builder && npx tsx src/node/negatives.ts

all: train export evaluate install
.PHONY: data train export evaluate install all
