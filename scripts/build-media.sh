#!/usr/bin/env bash
# Re-encodes every clip and photo the site uses from its original sources.
# Sources live outside the repo (or in gitignored assets/source/); outputs go to assets/media/.
# Usage: bash scripts/build-media.sh
# Telemetry data for the Agents chapter is built separately: python3 scripts/extract-telemetry.py
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=assets/media
SRC=assets/source
LAUNCH=~/FRC/BLine-Web/.claude/worktrees/bline-2027-launch-video-3b60b0/launch-video
mkdir -p "$OUT"

# Muted H.264 loop for autoplay.
loop() { # loop <in> <out> <filter> <crf> [input args...]
  local in=$1 out=$2 vf=$3 crf=$4; shift 4
  ffmpeg -v error -y "$@" -i "$in" -vf "$vf" -c:v libx264 -pix_fmt yuv420p -preset slow -crf "$crf" \
    -movflags +faststart -an "$out"
}
poster() { ffmpeg -v error -y -ss "${3:-0.5}" -i "$1" -frames:v 1 -q:v 4 "$2"; }

# BLine scroll-scene frames are built by scripts/build-sequences.sh.

# --- Agents: field image for the telemetry replay (PathPlanner's field26.png, as used by BLine-Web).
cp ~/FRC/BLine-Web/public/assets/fields/field26.png "$OUT/field26.png"

# --- Teaching: "Shooter Hardware Overview" YouTube Short.
loop "$SRC/youtube/jnmPlokwq6E-Shooter Hardware Overview.mp4" "$OUT/teach-shooter.mp4" "scale=540:-2,fps=30" 31
poster "$OUT/teach-shooter.mp4" "$OUT/teach-shooter.jpg" 2

# --- Flat 7: Battle of the Bands, Feb 27, 2025 (YouTube hqi3oAcBevQ).
F7="$SRC/flat7/hqi3oAcBevQ-February 27, 2025.mp4"
loop "$F7" "$OUT/flat7-piano.mp4" "scale=1280:-2,fps=30" 28 -ss 262 -t 19   # piano close-up
poster "$OUT/flat7-piano.mp4" "$OUT/flat7-piano.jpg" 3
loop "$F7" "$OUT/flat7-intro.mp4" "scale=960:-2,fps=30" 29 -ss 8 -t 12      # introducing the band at the mic
poster "$OUT/flat7-intro.mp4" "$OUT/flat7-intro.jpg" 4
loop "$F7" "$OUT/flat7-band.mp4" "scale=960:-2,fps=30" 29 -ss 150 -t 10     # full quartet under the stage lights
poster "$OUT/flat7-band.mp4" "$OUT/flat7-band.jpg" 2

# --- Photos: long edge 1600 px.
photo() { sips -s format jpeg -s formatOptions 68 -Z "${3:-1600}" "$1" --out "$2" >/dev/null; }
photo ~/Documents/Resume/Edan_Profile_Handoff/photo/headshot_1600.png "assets/img/edan-square.jpg" 1200
photo "$SRC/nasa/nasa-grc-2025-c-05566.jpg"   "$OUT/nasa-rover-test.jpg"
# Closing ceremony (Oct 12 2026, Edan: in place of the photo at the Glenn sign): a 3:4 crop (x 420, y 70, 765x1020) of
# a video still Edan sent (award-handshake-frame.webp).
sips -s format jpeg -s formatOptions 86 "$SRC/nasa/award-handshake.jpg" --out "$OUT/nasa-handshake.jpg" >/dev/null
photo "$SRC/nasa/anechoic-dome.jpg"           "$OUT/nasa-anechoic-dome.jpg"
photo "$SRC/nasa/acoustic-liner-engineer.jpg" "$OUT/nasa-acoustic-liner.jpg"
photo "$SRC/nasa/benefit-of-all-night.jpg"    "$OUT/nasa-benefit-of-all.jpg"
photo "$SRC/team/pit-match.png"               "$OUT/team-pit.jpg"
photo "$SRC/team/first-sign-group.png"        "$OUT/team-first-sign.jpg"
# The three Team Voyager photos are toned so the neon shirts match: the award photo was blown out, the
# "with their robot" one dark and warm.
photo "$SRC/fll/fll-a.jpg"                    "$OUT/fll-coaching.jpg"
python3 scripts/tone.py "$OUT/fll-coaching.jpg" 0.92 1 1
photo "$SRC/fll/fll-b.jpg"                    "$OUT/fll-team-voyager.jpg"
python3 scripts/tone.py "$OUT/fll-team-voyager.jpg" 0.78 1 1 0.95 1 1.05
# Instagram posts (Edan picked these, Oct 10 2026): @greatneckpublicschools DUmIvWfl-6a (FLL regionals, Feb 2026)
# and DePt5eRjLM3 (Optimum Technology Innovation Summit, Oct 2026); @rebelrobotics2638 DXIVtSxERki (Rocket City trip).
photo "$SRC/fll/voyager-award.jpg"            "$OUT/fll-voyager-award.jpg"
python3 scripts/tone.py "$OUT/fll-voyager-award.jpg" 1.15 0.92 1.08
photo "$SRC/team/optimum-summit.jpg"          "$OUT/team-optimum-summit.jpg"
photo "$SRC/team/optimum-demo.jpg"            "$OUT/team-optimum-demo.jpg"
photo "$SRC/team/rocket-city-trip.jpg"        "$OUT/team-rocket-city-trip.jpg"
# The Rocket City dinner is a little dark: lift its midtones slightly (gamma 0.85), nothing else.
python3 -c 'import sys; from PIL import Image; im = Image.open(sys.argv[1]).convert("RGB"); im.point([round(255 * (i / 255) ** 0.85) for i in range(256)] * 3).save(sys.argv[1], quality=86)' "$OUT/team-rocket-city-trip.jpg"

ls -la "$OUT"

# Phone-size video versions and the WebP photos/posters the page actually loads.
bash scripts/build-variants.sh
python3 scripts/build-images.py
