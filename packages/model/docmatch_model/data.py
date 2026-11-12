"""Carga de datos y simulación de escaneo en GPU.

Las imágenes limpias (PNG gris renderizado por packages/fixtures) se cargan una vez en memoria de la
GPU como uint8. Cada lote se genera en la GPU: encaje (letterbox) igual que en el runtime, rotación
leve, perspectiva, escala, desplazamiento, desenfoque, ruido, brillo/contraste/gamma, sombras, bordes
oscuros, binarización tipo fotocopia y bloques de compresión. Así no hace falta CPU para aumentar
datos (Colab solo da 2 vCPU).
"""
from __future__ import annotations

import csv
import math
import os
import random
from dataclasses import dataclass

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

INPUT_H = 384
INPUT_W = 288


@dataclass
class Dataset:
    images: torch.Tensor  # N×1×H×W uint8 (en el dispositivo)
    labels: torch.Tensor  # N (int64)
    groups: list[str]
    kinds: list[str]
    class_names: list[str]
    sizes: torch.Tensor  # N×2 (alto, ancho) reales antes del relleno


def load_dataset(root: str, device: str = "cuda", max_side: int = 842) -> Dataset:
    rows = list(csv.DictReader(open(os.path.join(root, "labels.csv"), encoding="utf8")))
    class_names = sorted({r["class"] for r in rows})
    cidx = {c: i for i, c in enumerate(class_names)}
    # Todas las páginas se guardan en un lienzo común (relleno blanco) y se recuerda su tamaño real.
    H, W = max_side, max_side
    imgs = torch.full((len(rows), 1, H, W), 255, dtype=torch.uint8)
    sizes = torch.zeros((len(rows), 2), dtype=torch.int32)
    for i, r in enumerate(rows):
        im = Image.open(os.path.join(root, r["file"])).convert("L")
        if max(im.size) > max_side:
            s = max_side / max(im.size)
            im = im.resize((round(im.size[0] * s), round(im.size[1] * s)), Image.BILINEAR)
        a = torch.from_numpy(np.asarray(im, dtype=np.uint8).copy())
        imgs[i, 0, : a.shape[0], : a.shape[1]] = a
        sizes[i, 0], sizes[i, 1] = a.shape[0], a.shape[1]
    return Dataset(
        images=imgs.to(device),
        labels=torch.tensor([cidx[r["class"]] for r in rows], dtype=torch.long, device=device),
        groups=[r["group"] for r in rows],
        kinds=[r["kind"] for r in rows],
        class_names=class_names,
        sizes=sizes.to(device),
    )


def letterbox_grid(sizes: torch.Tensor, canvas: int, out_h: int = INPUT_H, out_w: int = INPUT_W) -> torch.Tensor:
    """Malla base de grid_sample que encaja cada página (tamaño real `sizes`) en out_h×out_w
    conservando la proporción y centrada, igual que pageTensor() del runtime."""
    B = sizes.shape[0]
    dev = sizes.device
    h = sizes[:, 0].float()
    w = sizes[:, 1].float()
    s = torch.minimum(out_w / w, out_h / h)
    rw, rh = w * s, h * s
    ox = torch.floor((out_w - rw) / 2)
    oy = torch.floor((out_h - rh) / 2)
    ys = torch.arange(out_h, device=dev).float() + 0.5
    xs = torch.arange(out_w, device=dev).float() + 0.5
    gy, gx = torch.meshgrid(ys, xs, indexing="ij")
    gx = gx.unsqueeze(0).expand(B, -1, -1)
    gy = gy.unsqueeze(0).expand(B, -1, -1)
    # píxel de salida → píxel de la página → coordenada normalizada del lienzo
    px = (gx - ox[:, None, None]) / s[:, None, None]
    py = (gy - oy[:, None, None]) / s[:, None, None]
    nx = px / canvas * 2 - 1
    ny = py / canvas * 2 - 1
    inside = (px >= 0) & (py >= 0) & (px < w[:, None, None]) & (py < h[:, None, None])
    return torch.stack([nx, ny], dim=-1), inside


def _gauss_kernel(sigma: float, dev) -> torch.Tensor:
    r = max(1, int(math.ceil(sigma * 2.5)))
    x = torch.arange(-r, r + 1, device=dev).float()
    k = torch.exp(-(x**2) / (2 * sigma**2))
    return k / k.sum()


def blur(x: torch.Tensor, sigma: float) -> torch.Tensor:
    if sigma < 0.2:
        return x
    k = _gauss_kernel(sigma, x.device)
    r = (k.numel() - 1) // 2
    x = F.conv2d(F.pad(x, (r, r, 0, 0), mode="replicate"), k.view(1, 1, 1, -1))
    return F.conv2d(F.pad(x, (0, 0, r, r), mode="replicate"), k.view(1, 1, -1, 1))


def render_batch(ds: Dataset, idx: torch.Tensor, augment: bool = True, strength: float = 1.0) -> torch.Tensor:
    """Devuelve un lote B×1×H×W en [-1, 1] (mismo rango que el runtime)."""
    dev = ds.images.device
    B = idx.numel()
    canvas = ds.images.shape[-1]
    src = ds.images[idx].float() / 255.0
    sizes = ds.sizes[idx]
    # Antialias aproximado: el runtime reduce por media de área; aquí, desenfoque previo proporcional.
    scale = torch.minimum(INPUT_W / sizes[:, 1].float(), INPUT_H / sizes[:, 0].float()).mean().item()
    src = blur(src, 0.45 / max(scale, 1e-3) * 0.5)
    grid, _ = letterbox_grid(sizes, canvas)
    if augment:
        s = strength
        # Transformación afín + perspectiva aplicada en coordenadas normalizadas del lienzo.
        ang = torch.randn(B, device=dev) * 0.9 * s * math.pi / 180
        ang = ang + (torch.rand(B, device=dev) < 0.08).float() * torch.randn(B, device=dev) * 2.5 * math.pi / 180
        sc = 1 + (torch.rand(B, device=dev) - 0.6) * 0.08 * s
        tx = (torch.rand(B, device=dev) - 0.5) * 0.05 * s
        ty = (torch.rand(B, device=dev) - 0.5) * 0.05 * s
        shear = torch.randn(B, device=dev) * 0.006 * s
        key = (torch.rand(B, device=dev) - 0.5) * 0.04 * s
        g = grid
        cx = g[..., 0]
        cy = g[..., 1]
        ca, sa = torch.cos(ang)[:, None, None], torch.sin(ang)[:, None, None]
        x2 = (ca * cx - sa * cy) / sc[:, None, None] + shear[:, None, None] * cy + tx[:, None, None]
        y2 = (sa * cx + ca * cy) / sc[:, None, None] + ty[:, None, None]
        x2 = x2 * (1 + key[:, None, None] * y2)  # perspectiva aproximada (trapecio)
        grid = torch.stack([x2, y2], dim=-1)
    out = F.grid_sample(src, grid, mode="bilinear", padding_mode="border", align_corners=False)
    # Fuera de la página el lienzo ya es blanco (relleno al cargar), así que no hace falta máscara.
    if augment:
        s = strength
        paper = 1 - torch.rand(B, 1, 1, 1, device=dev) * 0.14 * s
        out = out * paper
        # Sombra lateral / superior
        shade = (torch.rand(B, 1, 1, 1, device=dev) < 0.3).float() * torch.rand(B, 1, 1, 1, device=dev) * 0.35 * s
        xs = torch.linspace(0, 1, INPUT_W, device=dev).view(1, 1, 1, -1)
        out = out * (1 - shade * torch.clamp(1 - xs / 0.15, 0, 1))
        # Desenfoque variable
        sig = random.choice([0, 0, 0.4, 0.7, 1.0]) * s
        out = blur(out, sig)
        # Brillo, contraste, gamma
        c = 1 + (torch.rand(B, 1, 1, 1, device=dev) - 0.5) * 0.5 * s
        b = (torch.rand(B, 1, 1, 1, device=dev) - 0.6) * 0.15 * s
        out = (out - 0.5) * c + 0.5 + b
        gam = 1 + (torch.rand(B, 1, 1, 1, device=dev) - 0.45) * 0.55 * s
        out = out.clamp(0, 1) ** gam
        # Ruido
        out = out + torch.randn_like(out) * (torch.rand(B, 1, 1, 1, device=dev) * 0.06 * s)
        # Fotocopia (binarización) ocasional
        binz = (torch.rand(B, 1, 1, 1, device=dev) < 0.1 * s).float()
        out = binz * (out > 0.78).float() + (1 - binz) * out
        # Bordes oscuros del escáner (tapa) ocasionales
        brd = (torch.rand(B, device=dev) < 0.25 * s)
        if brd.any():
            m = torch.zeros_like(out)
            w = int(INPUT_W * 0.03)
            m[..., :, :w] = 1
            m[..., :w, :] = 1
            out = torch.where((m > 0) & brd.view(B, 1, 1, 1), out * 0.35, out)
        # Bloques de compresión: cuantización por bloques 4×4 ocasional
        q = (torch.rand(B, 1, 1, 1, device=dev) < 0.3).float()
        pooled = F.interpolate(F.avg_pool2d(out, 4), scale_factor=4, mode="nearest")
        out = q * (0.6 * out + 0.4 * pooled) + (1 - q) * out
    return out.clamp(0, 1) * 2 - 1


def pk_sampler(labels: torch.Tensor, P: int, K: int, rng: random.Random):
    """Lotes P clases × K muestras (con reposición si una clase tiene menos de K)."""
    by = {}
    for i, l in enumerate(labels.tolist()):
        by.setdefault(l, []).append(i)
    classes = list(by)
    while True:
        cs = rng.sample(classes, P)
        idx = []
        for c in cs:
            items = by[c]
            idx += rng.sample(items, K) if len(items) >= K else [rng.choice(items) for _ in range(K)]
        yield torch.tensor(idx, dtype=torch.long)
