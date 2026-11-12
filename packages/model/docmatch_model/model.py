from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision.models import mobilenet_v3_small

EMB_DIM = 128


class Encoder(nn.Module):
    """MobileNetV3-Small (torchvision) adaptado a una entrada en escala de grises.

    Por defecto se entrena desde cero (weights=None): los pesos de ImageNet se entrenaron con un
    dataset cuyos términos de uso no son claramente compatibles con Apache-2.0 (ver DATA.md). Con
    --pretrained se pueden usar como punto de partida bajo responsabilidad de quien entrena.
    """

    def __init__(self, pretrained: bool = False, emb_dim: int = EMB_DIM, width_mult: float = 1.0):
        super().__init__()
        weights = None
        if pretrained:
            from torchvision.models import MobileNet_V3_Small_Weights

            weights = MobileNet_V3_Small_Weights.IMAGENET1K_V1
        net = mobilenet_v3_small(weights=weights, width_mult=width_mult)
        conv = net.features[0][0]
        gray = nn.Conv2d(1, conv.out_channels, conv.kernel_size, conv.stride, conv.padding, bias=False)
        with torch.no_grad():
            gray.weight.copy_(conv.weight.sum(dim=1, keepdim=True))
        net.features[0][0] = gray
        self.features = net.features
        c = net.features[-1].out_channels
        self.head = nn.Sequential(nn.Linear(c * 2, 256), nn.Hardswish(), nn.Linear(256, emb_dim))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        f = self.features(x)
        # Media + máximo global: el máximo conserva rasgos locales (título, logotipo).
        g = torch.cat([f.mean(dim=(2, 3)), f.amax(dim=(2, 3))], dim=1)
        return F.normalize(self.head(g), dim=1)
