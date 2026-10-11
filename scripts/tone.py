#!/usr/bin/env python3
"""Small per-photo tone fix used by scripts/build-media.sh.

Usage: python3 scripts/tone.py <jpg> <gamma> <gain> <saturation> [r g b]  (edits the file in place)
"""
import sys
from PIL import Image, ImageEnhance
f, g, k, sat = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
rgb = [float(v) for v in sys.argv[5:8]] or [1, 1, 1]
im = Image.open(f).convert("RGB")
im = im.point(sum(([round(min(255, 255 * k * c * (i / 255) ** g)) for i in range(256)] for c in rgb), []))
if sat != 1: im = ImageEnhance.Color(im).enhance(sat)
im.save(f, quality=86)
