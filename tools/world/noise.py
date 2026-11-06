"""Vectorised, deterministic 2D gradient noise helpers (numpy only)."""
from __future__ import annotations
import numpy as np


class Perlin:
    def __init__(self, seed: int):
        rng = np.random.default_rng(seed)
        p = rng.permutation(256)
        self.p = np.concatenate([p, p]).astype(np.int64)
        ang = rng.random(256) * np.pi * 2
        self.g = np.stack([np.cos(ang), np.sin(ang)], -1)

    def __call__(self, x, y):
        x = np.asarray(x, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)
        xi = np.floor(x).astype(np.int64)
        yi = np.floor(y).astype(np.int64)
        xf = x - xi
        yf = y - yi
        xi &= 255
        yi &= 255
        u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
        v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
        p, g = self.p, self.g

        def grad(ix, iy, dx, dy):
            h = p[p[ix] + iy] & 255
            return g[h, 0] * dx + g[h, 1] * dy

        n00 = grad(xi, yi, xf, yf)
        n10 = grad(xi + 1, yi, xf - 1, yf)
        n01 = grad(xi, yi + 1, xf, yf - 1)
        n11 = grad(xi + 1, yi + 1, xf - 1, yf - 1)
        a = n00 + u * (n10 - n00)
        b = n01 + u * (n11 - n01)
        return (a + v * (b - a)) * 1.41  # ~[-1, 1]


def fbm(noise: Perlin, x, z, scale, octaves=5, lacunarity=2.03, gain=0.5):
    total = 0.0
    amp = 1.0
    norm = 0.0
    f = 1.0 / scale
    for i in range(octaves):
        total = total + noise(x * f + i * 17.3, z * f - i * 9.1) * amp
        norm += amp
        amp *= gain
        f *= lacunarity
    return total / norm


def ridged(noise: Perlin, x, z, scale, octaves=5, lacunarity=2.0, gain=0.5):
    total = 0.0
    amp = 1.0
    norm = 0.0
    f = 1.0 / scale
    prev = 1.0
    for i in range(octaves):
        n = 1.0 - np.abs(noise(x * f + i * 31.7, z * f + i * 5.3))
        n = n * n
        total = total + n * amp * prev
        prev = np.clip(n * 1.6, 0, 1)
        norm += amp
        amp *= gain
        f *= lacunarity
    return total / norm


def smoothstep(a, b, x):
    t = np.clip((np.asarray(x) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)
