#!/usr/bin/env python3
"""Turns the captured editor takes (scripts/capture/takes.mjs) into the WebP sequences the BLine scene scrubs.

For each take in assets/source/takes/<name>/frames/*.png (3840x2160, 30 fps):
  assets/seq/<name>/hd/0001.webp   2048 wide   (desktop)
  assets/seq/<name>/sd/0001.webp   1280 wide   (phones)
and for each "panel" (a region of the UI the page lifts out as its own tilted pane), a crop at the capture's full
4K resolution so it stays sharp when enlarged:
  assets/seq/<name>-<panel>/hd/0001.webp
Only every `step`-th frame is kept (the page cross-fades neighbours, and draws the cursor itself at full rate).
Writes assets/seq/manifest.json (frame counts, sizes, panel regions) and assets/seq/takes.json (cursor paths and
markers at 30 fps, in 1920x1080 page pixels).

Usage: python3 scripts/build-takes.py [take ...]   (needs cwebp)
"""
import json
import os
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets/source/takes"
OUT = ROOT / "assets/seq"
SCALE = 2  # capture deviceScaleFactor: frames are 2x the 1920x1080 page

# Regions are in 1920x1080 page pixels. `range` trims a take to [first, last) frames (30 fps indices); a panel
# region may add its own [first, last) after [x, y, w, h].
TAKES = {
    "play": {"step": 3},
    "generate": {"step": 3, "panels": {"constraints": [1586, 104, 330, 400]}},
    "organize": {"step": 3, "panels": {"navigator": [0, 48, 560, 680]}},
    "learn": {"step": 3, "panels": {"lessons": [748, 18, 424, 1044, 0, 72], "coach": [58, 60, 316, 232, 54, 305]}},
}


def webp(args):
    src, dst, extra = args
    subprocess.run(["cwebp", "-quiet", "-mt", *extra, str(src), "-o", str(dst)], check=True)


def main(names):
    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path, takes_path = OUT / "manifest.json", OUT / "takes.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    meta_all = json.loads(takes_path.read_text()) if takes_path.exists() else {}
    jobs = []
    for name in names:
        cfg = TAKES[name]
        frames = sorted((SRC / name / "frames").glob("*.png"))
        meta = json.loads((SRC / name / "take.json").read_text())
        a, b = cfg.get("range", [0, len(frames)])
        b = min(b, len(frames))
        keep = list(range(a, b, cfg["step"]))
        for sub in [name] + [f"{name}-{p}" for p in cfg.get("panels", {})]:
            shutil.rmtree(OUT / sub, ignore_errors=True)
        (OUT / name / "hd").mkdir(parents=True)
        (OUT / name / "sd").mkdir(parents=True)
        for j, i in enumerate(keep):
            f = frames[i]
            out = f"{j + 1:04d}.webp"
            jobs.append((f, OUT / name / "hd" / out, ["-q", "78", "-resize", "2048", "0"]))
            jobs.append((f, OUT / name / "sd" / out, ["-q", "76", "-resize", "1280", "0"]))
        panels = {p: (r[:4], r[4:] or [a, b]) for p, r in cfg.get("panels", {}).items()}
        for p, ((x, y, w, h), (pa, pb)) in panels.items():
            d = OUT / f"{name}-{p}" / "hd"
            d.mkdir(parents=True, exist_ok=True)
            pkeep = list(range(max(a, pa), min(b, pb), cfg["step"]))
            for j, i in enumerate(pkeep):
                jobs.append((frames[i], d / f"{j + 1:04d}.webp", ["-q", "84", "-crop", str(x * SCALE), str(y * SCALE), str(w * SCALE), str(h * SCALE)]))
            manifest[f"{name}-{p}"] = {"count": len(pkeep), "step": cfg["step"], "first": pkeep[0] - a, "tiers": ["hd"]}
        manifest[name] = {"count": len(keep), "step": cfg["step"], "first": 0, "panels": {p: r for p, (r, _) in panels.items()}}
        meta_all[name] = {
            "frames": b - a,
            "markers": {k: v - a for k, v in meta.get("markers", {}).items()},
            "cursor": meta["cursor"][a:b],
            "probe": (meta.get("probe") or [])[a:b] or None,
        }
    with ThreadPoolExecutor(max_workers=os.cpu_count() or 8) as pool:
        list(pool.map(webp, jobs))
    manifest_path.write_text(json.dumps(manifest, indent=1))
    takes_path.write_text(json.dumps(meta_all, separators=(",", ":")))
    for name in names:
        size = sum(f.stat().st_size for f in (OUT / name / "hd").glob("*.webp"))
        print(f"{name}: {manifest[name]['count']} frames, hd {size / 1e6:.1f} MB")


if __name__ == "__main__":
    main(sys.argv[1:] or list(TAKES))
