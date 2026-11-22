"""Genera las imágenes de la cabina de BROSS DJ desde cero (sin recortes ni fotos).

Uso:  python tools/generate-art.py      (necesita Pillow: pip install pillow)

Escribe en src/assets/img/:
  vinyl.jpg, vinyl-light-a.webp, vinyl-light-b.webp, knob.png,
  fader-rail.png, fader-thumb.png, xfader-thumb.png,
  pitch-rail-a.png, pitch-rail-b.png

Todo se dibuja con formas geométricas a 4x y se reduce, así los bordes quedan suaves.
"""
from __future__ import annotations

import math
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent.parent / "src" / "assets" / "img"
SS = 4  # supersampling


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    windir = os.environ.get("WINDIR", "C:/Windows")
    for name in ("segoeuisb.ttf", "segoeui.ttf", "arial.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans.ttf"):
        for base in (f"{windir}/Fonts", "/usr/share/fonts/truetype/dejavu"):
            try:
                return ImageFont.truetype(f"{base}/{name}", size)
            except OSError:
                pass
    return ImageFont.load_default(size)


def radial(size: int, fn) -> Image.Image:
    """Imagen RGBA donde cada píxel = fn(r, ángulo) en coordenadas del tamaño final."""
    n = size * SS
    img = Image.new("RGBA", (n, n))
    px = img.load()
    c = n / 2
    for y in range(n):
        for x in range(n):
            dx, dy = (x + 0.5 - c) / SS, (y + 0.5 - c) / SS
            px[x, y] = fn(math.hypot(dx, dy), math.atan2(dy, dx))
    return img


def clamp(v: float) -> int:
    return max(0, min(255, int(round(v))))


def grey(v: float, a: float = 255) -> tuple[int, int, int, int]:
    return (clamp(v), clamp(v), clamp(v + 2), clamp(a))


# ---------------------------------------------------------------- vinilo / plato
def vinyl() -> None:
    size = 342
    studs = 36

    def fn(r: float, ang: float):
        sheen = math.cos(2 * (ang + 0.6))  # dos reflejos opuestos, como metal cepillado
        if r < 54:  # etiqueta
            return grey(52 + 6 * sheen)
        if r < 86:  # anillo negro
            return grey(3 + 2 * sheen)
        if r < 138:  # plato
            ripple = 1.5 * math.sin(r * 1.7)
            return grey(52 + 9 * sheen + ripple)
        if r < 143:  # bisel cromado
            t = (r - 138) / 5
            return grey(70 + 110 * math.sin(math.pi * t) + 25 * sheen)
        if r < 162:  # aro con hoyuelos
            phase = (ang * studs / (2 * math.pi)) % 1
            mid = abs(r - 152.5) / 6
            dimple = max(0.0, 1 - math.hypot((phase - 0.5) * 2.2, mid))
            return grey(44 + 6 * sheen - 22 * dimple + 14 * max(0.0, dimple - 0.75) * 4)
        if r < 166:
            return grey(16)
        # fondo cepillado
        return grey(33 + 1.5 * math.sin(ang * 40 + r * 0.2))

    img = radial(size, fn)
    d = ImageDraw.Draw(img)
    f = font(29 * SS)
    d.text((size * SS / 2, size * SS / 2), "BROSSDJ", font=f, fill=(240, 240, 240, 255), anchor="mm")
    img = img.resize((size, size), Image.LANCZOS).convert("RGB")
    img.save(OUT / "vinyl.jpg", quality=92)


def vinyl_light(name: str, color: tuple[int, int, int]) -> None:
    size = 342
    a0, a1 = math.radians(25), math.radians(100)

    def fn(r: float, ang: float):
        if not (a0 <= ang <= a1):
            return (*color, 0)
        t = (ang - a0) / (a1 - a0)
        along = math.sin(math.pi * t) ** 1.5  # se apaga en las puntas
        across = math.exp(-(((r - 146) / 4.2) ** 2))
        return (*color, clamp(255 * along * across))

    img = radial(size, fn).resize((size, size), Image.LANCZOS)
    img.save(OUT / name, lossless=True)


# ---------------------------------------------------------------- perilla
def knob() -> None:
    size = 120

    def fn(r: float, ang: float):
        light = -math.sin(ang)  # luz desde arriba
        if r < 30:
            return grey(54 + 6 * light - 6 * (r / 30) ** 4)
        if r < 32:
            return grey(36)
        if r < 55:
            grip = 3 * math.cos(ang * 24)
            return grey(19 + 5 * light + grip)
        if r < 57:
            return grey(50 + 10 * light, 255 * (57 - r) / 2)
        return (0, 0, 0, 0)

    radial(size, fn).resize((size, size), Image.LANCZOS).save(OUT / "knob.png")


# ---------------------------------------------------------------- tapa del fader
def fader_thumb() -> Image.Image:
    w, h = 136, 60
    img = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    S = SS
    d.rounded_rectangle((2 * S, 3 * S, 134 * S, 57 * S), radius=6 * S, fill=(28, 28, 30, 255), outline=(120, 122, 128, 255), width=2 * S)
    for y0, y1, v in ((6, 13, 110), (13, 24, 52), (24, 26, 84), (33, 35, 70), (35, 46, 40), (46, 54, 12)):
        d.rectangle((5 * S, y0 * S, 131 * S, y1 * S), fill=(v, v, v + 2, 255))
    d.rectangle((5 * S, 26 * S, 131 * S, 32 * S), fill=(244, 246, 244, 255))
    img = img.resize((w, h), Image.LANCZOS)
    img.save(OUT / "fader-thumb.png")
    return img


# ---------------------------------------------------------------- rieles
TICK = (214, 219, 227)


def rail(name: str, ticks: list[tuple[int, int]], side: str) -> None:
    """ticks = [(y, largo)]; side = 'both' | 'left' | 'right'."""
    w, h = 136, 720
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()
    for y, length in ticks:
        for dy in (-1, 0, 1):
            yy = y + dy
            if not 0 <= yy < h:
                continue
            for k in range(length):
                a = clamp(49 + 91 * k / max(1, length - 1)) if dy == 0 else clamp((49 + 91 * k / max(1, length - 1)) * 0.45)
                if side in ("both", "left"):
                    px[56 - length + k, yy] = (*TICK, a)
                if side in ("both", "right"):
                    px[80 + length - 1 - k, yy] = (*TICK, a)
    d = ImageDraw.Draw(img)
    d.rectangle((56, 0, 80, h - 1), fill=(34, 36, 42, 255))
    d.rectangle((60, 0, 76, h - 1), fill=(7, 8, 11, 255))
    img.save(OUT / name)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    vinyl()
    vinyl_light("vinyl-light-a.webp", (35, 62, 149))
    vinyl_light("vinyl-light-b.webp", (255, 83, 248))
    knob()
    thumb = fader_thumb()
    thumb.rotate(90, expand=True).save(OUT / "xfader-thumb.png")
    rail("fader-rail.png", [(round(50 + i * 56.5), 56) for i in range(12)], "both")
    pitch = [(360 + i * 52, 54 if i % 2 == 0 else 26) for i in range(-6, 7)]
    rail("pitch-rail-a.png", pitch, "right")
    rail("pitch-rail-b.png", pitch, "left")
    print("listo:", OUT)


if __name__ == "__main__":
    main()
