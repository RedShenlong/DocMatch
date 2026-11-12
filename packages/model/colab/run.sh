#!/usr/bin/env bash
# Entrenamiento completo en Google Colab (GPU). Se ejecuta desde la raíz del repositorio descomprimido.
#   bash packages/model/colab/run.sh [familias=300] [épocas=40]
set -euo pipefail
FAM=${1:-300}
EPOCHS=${2:-40}
ROOT=$(pwd)
NODE_V=v22.11.0
if ! command -v node >/dev/null || [[ $(node -v) != v22* ]]; then
  curl -fsSL https://nodejs.org/dist/$NODE_V/node-$NODE_V-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1
fi
npm i -g pnpm@9 >/dev/null
pnpm install --filter @docmatch/fixtures... --frozen-lockfile >/dev/null
pip -q install onnx onnxruntime
cd packages/fixtures
D=$ROOT/packages/model/data
[[ -f $D/train/labels.csv ]] || npx tsx src/node/training.ts $D/train "$FAM" 72 1
[[ -f $D/holdout/labels.csv ]] || npx tsx src/node/training.ts $D/holdout 40 72 900001
cd $ROOT/packages/model
python train.py --data data/train --holdout data/holdout --out runs/v1 --epochs "$EPOCHS"
python export.py --ckpt runs/v1/best.pt --calib data/train --out export
python evaluate.py --ckpt runs/v1/best.pt --holdout data/holdout --onnx export/model.onnx --out export/eval.json
cp runs/v1/log.json runs/v1/config.json export/
tar -czf $ROOT/docmatch-model-export.tgz -C export .
ls -la export
