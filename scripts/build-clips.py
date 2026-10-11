#!/usr/bin/env python3
"""Turns the captured editor takes (scripts/capture/takes.mjs) into the videos the BLine scene plays.

Each step of the scene (Simulate, Generate, Organize, Learn) plays one clip at 30 fps, held when it reaches its rest
point. For each step this writes, from assets/source/takes/<take>/frames/*.png (3840x2160, 30 fps):
  assets/clips/<step>/main-hd.mp4   2560x1440   (desktop)
  assets/clips/<step>/main-sd.mp4   1280x720    (phones)
  assets/clips/<step>/<panel>.mp4   a region of the UI the page lifts out as its own tilted pane, cropped at the
                                    capture's full resolution so it stays sharp when enlarged
Every clip of a step has the same length and frame timing as its main clip, so the page plays them in lockstep from
one clock. A panel may show different capture frames than the main view at the same moment (Learn's lesson list
plays its part of the take slower); that mapping is baked in here.
Also writes assets/clips/clips.json (per step: first capture frame, frame count, the part of the step's 0..1 timeline
the clip spans, panel regions) and assets/clips/takes.json (cursor paths, markers and robot positions per take, at
30 fps in 1920x1080 page pixels), and a poster of the first frame.

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


def lerp(a, b, x):
    return a + (b - a) * x


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def markers(take):
    return json.loads((SRC / take / "take.json").read_text()).get("markers", {})


def count(take):
    return len(list((SRC / take / "frames").glob("*.png")))


# Per step: the take, the capture frames the main view plays [first, last], the part of the step's 0..1 timeline that
# span covers (bline.js maps it the same way), and panels as {name: ([x, y, w, h] in page px, frame_for(i, n))}.
def steps():
    pm, lm = markers("play"), markers("learn")
    same = lambda first: (lambda i, n: first + i)
    learn_first = lm["lesson"] + 14

    def lesson_list(i, n):  # the lesson list plays from just before it opens to just before Path Tuning starts
        p = lerp(0.02, 0.97, i / (n - 1))
        return round(lerp(lm["list"] - 4, lm["lesson"] - 2, clamp((p - 0.02) / 0.3)))

    return {
        "play": {"take": "play", "range": [pm["play"] - 14, count("play") - 1], "span": [0, 1], "panels": {}},
        "generate": {"take": "generate", "range": [0, count("generate") - 1], "span": [0.04, 0.96],
                     "panels": {"constraints": ([1586, 104, 330, 400], same(0))}},
        "organize": {"take": "organize", "range": [0, count("organize") - 1], "span": [0.03, 0.97],
                     "panels": {"navigator": ([0, 48, 560, 680], same(0))}},
        "learn": {"take": "learn", "range": [learn_first, count("learn") - 1], "span": [0.02, 0.97],
                  "panels": {"lessons": ([748, 18, 424, 1044], lesson_list), "coach": ([58, 60, 316, 232], same(learn_first))}},
    }


def encode(frames, out, vf, crf):
    with tempfile.TemporaryDirectory() as tmp:
        for i, f in enumerate(frames):
            os.symlink(f, Path(tmp) / f"{i:05d}.png")
        subprocess.run([
            "ffmpeg", "-v", "error", "-y", "-framerate", "30", "-i", f"{tmp}/%05d.png", "-vf", vf,
            "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-pix_fmt", "yuv420p", "-g", "15",
            "-movflags", "+faststart", "-an", str(out)], check=True)


def main(names):
    cfg = steps()
    OUT.mkdir(parents=True, exist_ok=True)
    clips_path, takes_path = OUT / "clips.json", OUT / "takes.json"
    clips = json.loads(clips_path.read_text()) if clips_path.exists() else {}
    meta = json.loads(takes_path.read_text()) if takes_path.exists() else {}
    for name in names:
        c = cfg[name]
        src = sorted((SRC / c["take"] / "frames").glob("*.png"))
        a, b = c["range"]
        n = b - a + 1
        d = OUT / name
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
        main_frames = src[a:b + 1]
        encode(main_frames, d / "main-hd.mp4", "scale=2560:1440:flags=lanczos", 20)
        encode(main_frames, d / "main-sd.mp4", "scale=1280:720:flags=lanczos", 22)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(main_frames[0]), "-vf", "scale=1280:-2", "-q:v", "4", str(d / "poster.jpg")], check=True)
        for p, ((x, y, w, h), frame_for) in c["panels"].items():
            frames = [src[min(len(src) - 1, frame_for(i, n))] for i in range(n)]
            encode(frames, d / f"{p}.mp4", f"crop={w * SCALE}:{h * SCALE}:{x * SCALE}:{y * SCALE}", 18)
        clips[name] = {"take": c["take"], "first": a, "frames": n, "span": c["span"],
                       "panels": {p: r for p, (r, _) in c["panels"].items()}}
        t = json.loads((SRC / c["take"] / "take.json").read_text())
        meta[c["take"]] = {"frames": len(src), "markers": t.get("markers", {}), "cursor": t["cursor"], "probe": t.get("probe") or None}
        size = sum(f.stat().st_size for f in d.glob("*.mp4") if f.name != "main-sd.mp4")
        print(f"{name}: {n} frames ({n / 30:.1f} s), hd + panels {size / 1e6:.1f} MB")
    clips_path.write_text(json.dumps(clips, indent=1))
    takes_path.write_text(json.dumps(meta, separators=(",", ":")))


if __name__ == "__main__":
    main(sys.argv[1:] or ["play", "generate", "organize", "learn"])
