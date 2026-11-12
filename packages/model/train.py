"""Entrena el encoder visual de DocMatch por aprendizaje contrastivo supervisado (SupCon).

    python train.py --data data/train --holdout data/holdout --out runs/v1

Reproducible: semilla fija (--seed), mismas versiones de datos (generados con semilla por
packages/fixtures/src/node/training.ts) y registro de todos los hiperparámetros en runs/<x>/config.json.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import time

import numpy as np
import torch

from docmatch_model.data import load_dataset, pk_sampler, render_batch
from docmatch_model.losses import supcon_loss
from docmatch_model.model import Encoder
from evaluate import evaluate_retrieval


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def sibling_sampler(ds, P: int, K: int, rng: random.Random):
    """Lotes P×K donde la mitad de las clases traen a su "prima" (misma familia, otra variante y
    misma página): negativos difíciles en cada lote."""
    names = ds.class_names
    by: dict[int, list[int]] = {}
    for i, l in enumerate(ds.labels.tolist()):
        by.setdefault(l, []).append(i)
    index = {n: i for i, n in enumerate(names)}
    classes = list(by)

    def sib(c: int):
        n = names[c]
        if not n.startswith("t") or "v" not in n:
            return None
        fam, rest = n[1:].split("v", 1)
        v, p = rest.split("p", 1)
        return index.get(f"t{fam}v{1 - int(v)}p{p}")

    while True:
        chosen: list[int] = []
        while len(chosen) < P:
            c = rng.choice(classes)
            if c in chosen:
                continue
            chosen.append(c)
            s = sib(c)
            if s is not None and s not in chosen and len(chosen) < P and rng.random() < 0.7:
                chosen.append(s)
        idx = []
        for c in chosen:
            items = by[c]
            idx += rng.sample(items, K) if len(items) >= K else [rng.choice(items) for _ in range(K)]
        yield torch.tensor(idx, dtype=torch.long)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--holdout", required=True)
    ap.add_argument("--out", default="runs/v1")
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--steps", type=int, default=60, help="pasos por época")
    ap.add_argument("--P", type=int, default=48)
    ap.add_argument("--K", type=int, default=4)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--wd", type=float, default=0.05)
    ap.add_argument("--temperature", type=float, default=0.1)
    ap.add_argument("--pretrained", action="store_true")
    ap.add_argument("--seed", type=int, default=1234)
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    json.dump(vars(args), open(os.path.join(args.out, "config.json"), "w"), indent=2)
    set_seed(args.seed)
    dev = args.device

    t0 = time.time()
    train = load_dataset(args.data, dev)
    hold = load_dataset(args.holdout, dev)
    print(f"datos: {len(train.labels)} imágenes / {len(train.class_names)} clases (train); "
          f"{len(hold.labels)} / {len(hold.class_names)} (hold-out) en {time.time() - t0:.0f}s", flush=True)

    model = Encoder(pretrained=args.pretrained).to(dev)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.wd)
    total = args.epochs * args.steps
    warm = max(1, total // 20)
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: min(1.0, (s + 1) / warm) * 0.5 * (1 + math.cos(math.pi * min(1.0, s / total)))
    )
    scaler = torch.amp.GradScaler("cuda", enabled=dev == "cuda")
    sampler = sibling_sampler(train, args.P, args.K, random.Random(args.seed))
    best = -1.0
    log = []
    for ep in range(args.epochs):
        model.train()
        tl = 0.0
        te = time.time()
        for _ in range(args.steps):
            idx = next(sampler).to(dev)
            with torch.no_grad():
                strength = min(1.0, 0.4 + ep / max(1, args.epochs * 0.3))  # aumento progresivo
                x = render_batch(train, idx, augment=True, strength=strength)
            with torch.autocast(device_type="cuda", dtype=torch.float16, enabled=dev == "cuda"):
                z = model(x)
            loss = supcon_loss(z.float(), train.labels[idx], args.temperature)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
            sched.step()
            tl += loss.item()
        m = evaluate_retrieval(model, hold, n_query_aug=2, seed=ep)
        rec = {"epoch": ep + 1, "loss": tl / args.steps, **m, "sec": round(time.time() - te, 1)}
        log.append(rec)
        print(json.dumps(rec), flush=True)
        score = m["top1"] + m["auc"]
        if score > best:
            best = score
            torch.save({"model": model.state_dict(), "args": vars(args), "metrics": m, "epoch": ep + 1},
                       os.path.join(args.out, "best.pt"))
    json.dump(log, open(os.path.join(args.out, "log.json"), "w"), indent=1)
    print(f"mejor: {best:.4f}; total {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
