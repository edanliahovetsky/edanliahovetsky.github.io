#!/usr/bin/env python3
"""Makes the WebP versions of the page's photos and video posters that the page actually loads.

Each photo in assets/media (and the portrait in assets/img) gets WebP copies at up to three widths in
assets/media/w/<name>-<width>.webp, so a phone downloads a phone-sized file and a desktop a desktop-sized one
(index.html lists them in srcset). Video posters get one 960-wide WebP. The JPEGs stay as the sources.

Usage: python3 scripts/build-images.py   (needs cwebp)
"""
import subprocess
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets/media/w"
WIDTHS = (640, 1200, 1800)
POSTERS = {"bline-open", "bline-teams", "bline-champs", "teach-shooter", "flat7-piano", "flat7-intro", "flat7-band"}


def webp(src, dst, width, q):
    subprocess.run(["cwebp", "-quiet", "-mt", "-q", str(q), "-resize", str(width), "0", str(src), "-o", str(dst)], check=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    srcs = sorted((ROOT / "assets/media").glob("*.jpg")) + [ROOT / "assets/img/edan-square.jpg"]
    total = 0
    for src in srcs:
        w = Image.open(src).width
        widths = [960] if src.stem in POSTERS else [x for x in WIDTHS if x < w] + [min(w, WIDTHS[-1])]
        for x in sorted(set(widths)):
            dst = OUT / f"{src.stem}-{x}.webp"
            webp(src, dst, x, 72 if x <= 640 else 74)
            total += dst.stat().st_size
    print(f"{len(srcs)} images, {total / 1e6:.1f} MB of WebP")


if __name__ == "__main__":
    main()
