#!/usr/bin/env bash
# Phone-size versions of the page's big videos (<name>-sd.mp4), picked per device by assets/js/reel.js
# (window.Media). Match footage is grainy, so a light denoise plus a bitrate cap keeps them small at phone size
# without visible loss. (AV1 was tried: on this footage it came out larger than H.264, and old Intel Macs would
# have to decode it in software, so the site uses H.264 only.)
# The desktop files (<name>.mp4) are built by build-media.sh, build-sequences.sh and champs-clip/run.sh.
# Usage: bash scripts/build-variants.sh   (needs ffmpeg)
set -euo pipefail
cd "$(dirname "$0")/.."
M=assets/media
sd() { # sd <name> <scale filter> <max bitrate>
  ffmpeg -nostdin -v error -y -i "$M/$1.mp4" -vf "$2,hqdn3d=1.5:1.5:4:4" -c:v libx264 -preset slow -crf 26 \
    -maxrate "$3" -bufsize "$3" -pix_fmt yuv420p -g 60 -movflags +faststart -an "$M/$1-sd.mp4"
}
sd bline-open    scale=1280:-2 1400k
sd bline-teams   scale=1280:-2 1500k
sd bline-champs  scale=1100:-2 1500k
sd teach-shooter scale=540:-2  400k
sd flat7-piano   scale=960:-2  500k
ls -la $M/*-sd.mp4 | awk '{printf "%6.2f MB %s\n", $5/1e6, $9}'
