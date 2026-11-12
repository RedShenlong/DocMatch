"""Evaluación del encoder sobre plantillas que no ha visto nunca (hold-out).

Protocolo (el mismo que usa el builder en producción):
  * prototipo de cada clase = embedding de la plantilla vacía limpia + 8 variantes aumentadas;
  * consultas = páginas rellenas (a máquina y a mano) con simulación de escaneo;
  * top-1: la clase más cercana es la correcta (compitiendo con TODAS las clases, incluidas las primas);
  * AUC / TPR@FPR1%: similitud con el prototipo correcto frente a los demás (verificación);
  * cousin_win: porcentaje de consultas en las que la prima queda más cerca que la correcta.

    python evaluate.py --ckpt runs/v1/best.pt --holdout data/holdout [--onnx export/model.onnx]
"""
from __future__ import annotations

import argparse
import json
import random

import numpy as np
import torch

from docmatch_model.data import load_dataset, render_batch


@torch.no_grad()
def embed(model, ds, idx, augment, strength=1.0, bs=16 if not torch.cuda.is_available() else 64):
    out = []
    for i in range(0, len(idx), bs):
        x = render_batch(ds, idx[i : i + bs], augment=augment, strength=strength)
        out.append(model(x).float())
    return torch.cat(out)


def auc_score(pos: np.ndarray, neg: np.ndarray) -> float:
    allv = np.concatenate([pos, neg])
    ranks = allv.argsort().argsort() + 1
    rp = ranks[: len(pos)].sum()
    return float((rp - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


@torch.no_grad()
def evaluate_retrieval(model, ds, n_query_aug: int = 3, seed: int = 0) -> dict:
    model.eval()
    torch.manual_seed(seed)
    dev = ds.images.device
    kinds = np.array(ds.kinds)
    labels = ds.labels.cpu().numpy()
    blanks = np.where(kinds == "blank")[0]
    classes = sorted(set(labels[blanks].tolist()))
    protos = []
    for c in classes:
        bi = torch.tensor(blanks[labels[blanks] == c], device=dev)
        rep = bi.repeat(8)
        e = torch.cat([embed(model, ds, bi, False), embed(model, ds, rep, True, 0.6)])
        protos.append(torch.nn.functional.normalize(e.mean(0), dim=0))
    P = torch.stack(protos)
    cls_pos = {c: i for i, c in enumerate(classes)}
    q = np.where(np.isin(kinds, ["typed", "hand"]))[0]
    q = q[np.isin(labels[q], classes)]
    qi = torch.tensor(np.repeat(q, n_query_aug), device=dev)
    Z = embed(model, ds, qi, True, 1.0)
    S = (Z @ P.t()).cpu().numpy()
    true = np.array([cls_pos[labels[i]] for i in qi.cpu().numpy()])
    top1 = float((S.argmax(1) == true).mean())
    pos = S[np.arange(len(true)), true]
    mask = np.ones_like(S, dtype=bool)
    mask[np.arange(len(true)), true] = False
    neg = S[mask]
    auc = auc_score(pos, neg)
    thr = np.quantile(neg, 0.99)
    tpr1 = float((pos > thr).mean())
    # Primas: misma familia (grupo) y misma página, otra variante.
    names = ds.class_names
    sib = {}
    for c in classes:
        n = names[c]
        if n.startswith("t"):
            fam, rest = n[1:].split("v", 1)
            v, p = rest.split("p", 1)
            o = f"t{fam}v{1 - int(v)}p{p}"
            if o in names and names.index(o) in cls_pos:
                sib[cls_pos[c]] = cls_pos[names.index(o)]
    cw = [S[k, sib[t]] >= S[k, t] for k, t in enumerate(true) if t in sib]
    # Documentos ajenos frente a plantillas: similitud máxima con cualquier prototipo.
    fo = np.where(kinds == "foreign")[0]
    foreign_max = float("nan")
    if len(fo):
        Zf = embed(model, ds, torch.tensor(fo, device=dev), True, 1.0)
        fs = (Zf @ P.t()).cpu().numpy().max(1)
        foreign_max = float(np.quantile(fs, 0.95))
    return {
        "top1": round(top1, 4),
        "auc": round(auc, 4),
        "tpr_at_fpr1": round(tpr1, 4),
        "cousin_win": round(float(np.mean(cw)) if cw else float("nan"), 4),
        "pos_p05": round(float(np.quantile(pos, 0.05)), 4),
        "neg_p99": round(float(thr), 4),
        "foreign_p95": round(foreign_max, 4),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--holdout", required=True)
    ap.add_argument("--onnx", help="evalúa también el modelo exportado (comparación de embeddings)")
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    ap.add_argument("--out")
    args = ap.parse_args()
    from docmatch_model.model import Encoder

    ck = torch.load(args.ckpt, map_location=args.device)
    model = Encoder().to(args.device)
    model.load_state_dict(ck["model"])
    ds = load_dataset(args.holdout, args.device)
    res = {"pytorch": evaluate_retrieval(model, ds, n_query_aug=4, seed=7)}
    if args.onnx:
        import onnxruntime as ort

        sess = ort.InferenceSession(args.onnx, providers=["CPUExecutionProvider"])
        name = sess.get_inputs()[0].name

        class OnnxModel(torch.nn.Module):
            def forward(self, x):
                outs = [sess.run(None, {name: x[i : i + 1].float().cpu().numpy()})[0] for i in range(x.shape[0])]
                return torch.from_numpy(np.concatenate(outs)).to(x.device)

            def eval(self):
                return self

        res["onnx"] = evaluate_retrieval(OnnxModel(), ds, n_query_aug=1, seed=7)
        idx = torch.tensor(random.Random(0).sample(range(len(ds.labels)), 64), device=args.device)
        x = render_batch(ds, idx, augment=True)
        with torch.no_grad():
            a = model(x).float().cpu().numpy()
        b = OnnxModel()(x).cpu().numpy()
        res["onnx_vs_torch_cos"] = round(float((a * b).sum(1).mean()), 5)
    print(json.dumps(res, indent=1))
    if args.out:
        json.dump(res, open(args.out, "w"), indent=1)


if __name__ == "__main__":
    main()
