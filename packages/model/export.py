"""Exporta el encoder a ONNX y lo cuantiza a INT8 (estático, QDQ, por canal).

    python export.py --ckpt runs/v1/best.pt --calib data/train --out export/

Produce export/model.onnx (INT8), export/model.fp32.onnx y export/model.json (metadatos que lee el
runtime). Comprueba que la versión INT8 da embeddings casi idénticos a la FP32 (coseno medio).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random

import numpy as np
import torch

from docmatch_model import MODEL_ID
from docmatch_model.data import INPUT_H, INPUT_W, load_dataset, render_batch
from docmatch_model.model import EMB_DIM, Encoder


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--calib", required=True, help="datos para calibrar la cuantización")
    ap.add_argument("--out", default="export")
    ap.add_argument("--version", default="1.0.0")
    ap.add_argument("--n-calib", type=int, default=256)
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    ck = torch.load(args.ckpt, map_location="cpu")
    model = Encoder()
    model.load_state_dict(ck["model"])
    model.eval()
    fp32 = os.path.join(args.out, "model.fp32.onnx")
    dummy = torch.zeros(1, 1, INPUT_H, INPUT_W)
    torch.onnx.export(
        model, dummy, fp32, input_names=["pixels"], output_names=["embedding"], opset_version=17,
        do_constant_folding=True, dynamo=False,
    )

    from onnxruntime.quantization import CalibrationDataReader, QuantFormat, QuantType, quantize_static
    from onnxruntime.quantization.shape_inference import quant_pre_process

    ds = load_dataset(args.calib, args.device)
    idx = torch.tensor(random.Random(0).sample(range(len(ds.labels)), args.n_calib), device=args.device)
    calib = [render_batch(ds, idx[i : i + 1], augment=bool(i % 2)).cpu().numpy() for i in range(len(idx))]

    class Reader(CalibrationDataReader):
        def __init__(self):
            self.it = iter(calib)

        def get_next(self):
            x = next(self.it, None)
            return None if x is None else {"pixels": x}

    pre = os.path.join(args.out, "model.pre.onnx")
    quant_pre_process(fp32, pre, skip_symbolic_shape=True)
    int8 = os.path.join(args.out, "model.onnx")
    quantize_static(
        pre, int8, Reader(), quant_format=QuantFormat.QDQ, per_channel=True,
        activation_type=QuantType.QUInt8, weight_type=QuantType.QInt8,
    )
    os.remove(pre)

    import onnxruntime as ort

    s32 = ort.InferenceSession(fp32, providers=["CPUExecutionProvider"])
    s8 = ort.InferenceSession(int8, providers=["CPUExecutionProvider"])
    cos = []
    for x in calib[:64]:
        a = s32.run(None, {"pixels": x})[0][0]
        b = s8.run(None, {"pixels": x})[0][0]
        b = b / np.linalg.norm(b)
        cos.append(float((a * b).sum()))
    sha = hashlib.sha256(open(int8, "rb").read()).hexdigest()
    meta = {
        "modelId": MODEL_ID,
        "modelVersion": args.version,
        "input": {"width": INPUT_W, "height": INPUT_H, "name": "pixels", "range": [-1, 1], "channels": 1},
        "output": {"name": "embedding", "dim": EMB_DIM},
        "quantization": "int8-qdq-per-channel",
        "int8_vs_fp32_cosine": round(float(np.mean(cos)), 5),
        "int8_vs_fp32_cosine_min": round(float(np.min(cos)), 5),
        "sizeBytes": os.path.getsize(int8),
        "fp32SizeBytes": os.path.getsize(fp32),
        "sha256": sha,
        "trainedEpoch": ck.get("epoch"),
        "holdoutMetrics": ck.get("metrics"),
        "license": "Apache-2.0",
    }
    json.dump(meta, open(os.path.join(args.out, "model.json"), "w"), indent=1)
    print(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()
