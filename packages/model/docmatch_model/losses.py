import torch
import torch.nn.functional as F


def supcon_loss(z: torch.Tensor, labels: torch.Tensor, temperature: float = 0.1) -> torch.Tensor:
    """Supervised Contrastive Loss (Khosla et al., 2020) con una vista por muestra (lotes P×K)."""
    z = F.normalize(z, dim=1)
    sim = z @ z.t() / temperature
    n = z.shape[0]
    eye = torch.eye(n, device=z.device, dtype=torch.bool)
    sim = sim.masked_fill(eye, -1e9)
    pos = (labels[:, None] == labels[None, :]) & ~eye
    log_prob = sim - torch.logsumexp(sim, dim=1, keepdim=True)
    npos = pos.sum(1).clamp(min=1)
    return -(log_prob * pos).sum(1).div(npos).mean()
