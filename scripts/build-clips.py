#!/usr/bin/env python3
"""Turns the captured editor takes (scripts/capture/takes.mjs) into the videos the BLine scene plays.

Each step of the scene (Simulate, Generate, Organize, Learn) plays one clip once, at the capture's frame rate (50 fps),
and holds its last frame. For each step this writes, from assets/source/takes/<take>/frames/*.png (3840x2160):
  assets/clips/<step>/main-xl.mp4   2560x1440   (large high-resolution screens)
  assets/clips/<step>/main-hd.mp4   1920x1080   (desktop)
  assets/clips/<step>/main-sd.mp4   1280x720    (phones)
  assets/clips/<step>/<name>-first.webp, <name>-last.webp   stills of the first and last frame
  assets/clips/<step>/<panel>.mp4   a region of the UI the page lifts out as its own tilted pane, cropped at the
                                    capture's full resolution so it stays sharp when enlarged (and <panel>-sd.mp4, half size)
Every clip of a step is the whole take, so the page plays them in lockstep from the main clip's clock.
Also writes assets/clips/clips.json (per step: take, fps, frame count, panel regions), assets/clips/takes.json
(cursor paths, markers, robot positions and Generate's before/after run times per take, in 1920x1080 page pixels),
and a poster of each step's first frame.

Usage: python3 scripts/build-clips.py [step ...]   (needs ffmpeg)
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets/source/takes"
OUT = ROOT / "assets/clips"
SCALE = 2  # capture deviceScaleFactor: frames are 2x the 1920x1080 page


# Per step: the take and the panels the page lifts out of it, as {name: [x, y, w, h] in 1920x1080 page px}. Each
# clip is the whole take; the page reads the take's markers to time its camera, panels and captions.
STEPS = {
    "simulate": {"take": "simulate", "panels": {}},
    "generate": {"take": "generate", "panels": {"constraints": [1586, 104, 330, 400]}},
    "organize": {"take": "organize", "panels": {"navigator": [0, 48, 560, 680]}},
    "learn": {"take": "learn", "panels": {"coach": [57, 59, 318, 252]}},
}


def encode(frames, out, vf, crf, fps):
    with tempfile.TemporaryDirectory() as tmp:
        for i, f in enumerate(frames):
            os.symlink(f, Path(tmp) / f"{i:05d}.png")
        subprocess.run([
            "ffmpeg", "-v", "error", "-y", "-framerate", str(fps), "-i", f"{tmp}/%05d.png", "-vf", vf,
            "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-pix_fmt", "yuv420p", "-g", str(fps // 2),
            "-movflags", "+faststart", "-an", str(out)], check=True)


def still(frame, out, vf):
    tmp = out.with_suffix(".png")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(frame), "-vf", vf, str(tmp)], check=True)
    subprocess.run(["cwebp", "-quiet", "-q", "78", str(tmp), "-o", str(out)], check=True)
    tmp.unlink()


def main(names):
    OUT.mkdir(parents=True, exist_ok=True)
    clips_path, takes_path = OUT / "clips.json", OUT / "takes.json"
    clips = json.loads(clips_path.read_text()) if clips_path.exists() else {}
    meta = json.loads(takes_path.read_text()) if takes_path.exists() else {}
    for name in names:
        c = STEPS[name]
        t = json.loads((SRC / c["take"] / "take.json").read_text())
        fps = t.get("fps", 30)
        frames = sorted((SRC / c["take"] / "frames").glob("*.png"))
        d = OUT / name
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
        # Three sizes of the main view: xl for large high-resolution screens, hd for most desktops (old laptops
        # decode it easily), sd for phones. Panels: full-resolution crops, and half-size ones for phones.
        encode(frames, d / "main-xl.mp4", "scale=2560:1440:flags=lanczos", 22, fps)
        encode(frames, d / "main-hd.mp4", "scale=1920:1080:flags=lanczos", 22, fps)
        encode(frames, d / "main-sd.mp4", "scale=1280:720:flags=lanczos", 23, fps)
        # Stills of the first and last frame: shown while a clip loads, and instead of it where video can't play.
        for tag, f in (("first", frames[0]), ("last", frames[-1])):
            still(f, d / f"main-{tag}.webp", "scale=1280:-2")
        for p, (x, y, w, h) in c["panels"].items():
            crop = f"crop={w * SCALE}:{h * SCALE}:{x * SCALE}:{y * SCALE}"
            encode(frames, d / f"{p}.mp4", crop, 20, fps)
            encode(frames, d / f"{p}-sd.mp4", crop + ":exact=1,scale=trunc(iw/4)*2:-2:flags=lanczos", 22, fps)
            for tag, f in (("first", frames[0]), ("last", frames[-1])):
                still(f, d / f"{p}-{tag}.webp", crop)
        clips[name] = {"take": c["take"], "fps": fps, "frames": len(frames), "panels": c["panels"]}
        meta[c["take"]] = {"frames": len(frames), "markers": t.get("markers", {}), "cursor": t["cursor"],
                           "probe": t.get("probe") or None, **({"times": t["times"]} if "times" in t else {})}
        size = sum(f.stat().st_size for f in d.glob("*.mp4") if f.name in ("main-hd.mp4",) or "-" not in f.name)
        print(f"{name}: {len(frames)} frames ({len(frames) / fps:.1f} s), hd + panels {size / 1e6:.1f} MB")
    clips = {k: v for k, v in clips.items() if k in STEPS}
    meta = {k: v for k, v in meta.items() if k in {c["take"] for c in STEPS.values()}}
    clips_path.write_text(json.dumps(clips, indent=1))
    takes_path.write_text(json.dumps(meta, separators=(",", ":")))


if __name__ == "__main__":
    main(sys.argv[1:] or list(STEPS))
