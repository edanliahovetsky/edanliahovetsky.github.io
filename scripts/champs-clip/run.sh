#!/usr/bin/env bash
# Builds assets/media/bline-champs.mp4: our robot (2638) in the autonomous period of FIRST Championship, Johnson
# Division, Qualification 58 (youtube.com/watch?v=bl2MbNdTr4Q, red alliance 334 / 9484 / 2638), colour graded,
# with a floating "2638" label over our robot (label.py; positions from the hand-placed corners in corners.json).
# render.py (a 3D bumper box) is kept for reference but not used.
#
#   homog.py   field-plane homography from the staged fuel block (7.35–9.18 m × 1.73–6.35 m on field26.png)
#   bump.py    per frame: red bumper pixels minus static red field parts, near the last position, fit as a
#              rectangle in top-down field metres (centre + heading)
#   corners.json  the four bottom bumper corners of 2638 in every 3rd frame, placed by hand (by subagents reading
#              gridded zooms); render.py draws the box from these and only falls back to the fitted pose without them
#   render.py  where the bumpers are hidden (start, behind the bump) uses hand-placed keyframes (KEYS), smooths
#              the pose, grades each frame (grade.py) and draws the bumper band (0.9 m square, 0.15 m tall)
#              projected through the homography, with a screen-blended blue glow
# Needs: ffmpeg, a Python venv with opencv-contrib-python-headless + numpy.
# Usage: bash scripts/champs-clip/run.sh /path/to/venv/bin/python
set -euo pipefail
cd "$(dirname "$0")/../.."
PY=${1:-python3}
W=$(mktemp -d); mkdir -p "$W/cm"; trap 'rm -rf "$W"' EXIT
cp scripts/champs-clip/grade.py "$W/"
ffmpeg -v error -y -ss 4.5 -t 23 -i assets/source/broll/bl2MbNdTr4Q.mp4 -vf fps=30 -c:v libx264 -crf 12 -preset fast -an "$W/cm/auto30.mp4"
"$PY" scripts/champs-clip/homog.py "$W"
"$PY" scripts/champs-clip/bump.py "$W"
"$PY" scripts/champs-clip/label.py "$W" assets/media/bline-champs.mp4   # needs pillow
ffmpeg -v error -y -ss 3 -i assets/media/bline-champs.mp4 -frames:v 1 -vf scale=1280:-2 -q:v 4 assets/media/bline-champs.jpg
