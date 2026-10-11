#!/usr/bin/env python3
"""Encodes the recorded Agents session (scripts/capture/scope.mjs) for the page (assets/js/scope.js).

From assets/source/scope/<layout>/frames + events.json, for layout in desktop, phone:
  assets/media/scope/<layout>.mp4         the views at full capture resolution (desktop also gets a -sd.mp4)
  assets/media/scope/<layout>-poster.webp a frame from the Localize scene (trail, AprilTag rays and callout up)
  assets/media/scope/scope.json           window title, and per layout: size, fps and the agent-log timeline

Usage: python3 scripts/build-scope.py   (needs ffmpeg and cwebp)
"""
import json
import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / "assets/source/scope", ROOT / "assets/media/scope"


def encode(frames, fps, out, vf, crf):
    with tempfile.TemporaryDirectory() as tmp:
        for i, f in enumerate(frames):
            os.symlink(f, Path(tmp) / f"{i:05d}.png")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(fps), "-i", f"{tmp}/%05d.png", "-vf", vf,
                        "-c:v", "libx264", "-preset", "slow", "-tune", "animation", "-crf", str(crf), "-pix_fmt", "yuv420p",
                        "-g", str(fps * 2), "-movflags", "+faststart", "-an", str(out)], check=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    data = {}
    for layout in ("desktop", "phone"):
        meta = json.loads((SRC / layout / "events.json").read_text())
        frames = sorted((SRC / layout / "frames").glob("*.png"))
        fps = meta["fps"]
        # Desktop at its 2x capture; the phone capture (3x) at 2x, plenty for a 370-px-wide view.
        size = "scale=trunc(iw/2)*2:trunc(ih/2)*2" if layout == "desktop" else "scale=trunc(iw/3)*2:-2:flags=lanczos"
        encode(frames, fps, OUT / f"{layout}.mp4", size, 27)
        if layout == "desktop":
            encode(frames, fps, OUT / f"{layout}-sd.mp4", "scale=trunc(iw/4)*2:-2:flags=lanczos", 25)
        # Poster: a moment in the Localize scene, after its callout appears.
        found = next((e["t"] for e in meta["events"] if e["k"] == "finding"), 4000)
        still = frames[min(len(frames) - 1, int((found + 600) / 1000 * fps))]
        subprocess.run(["cwebp", "-quiet", "-q", "78", str(still), "-o", str(OUT / f"{layout}-poster.webp")], check=True)
        data[layout] = {"size": meta["size"], "fps": fps, "dur": round(len(frames) / fps, 3), "events": meta["events"]}
        data["title"] = meta["title"]
        sizes = {f.name: f"{f.stat().st_size / 1e6:.2f} MB" for f in OUT.glob(f"{layout}*")}
        print(layout, f"{len(frames) / fps:.1f} s", sizes)
    (OUT / "scope.json").write_text(json.dumps(data, separators=(",", ":")))


if __name__ == "__main__":
    main()
