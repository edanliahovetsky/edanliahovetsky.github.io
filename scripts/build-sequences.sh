#!/usr/bin/env bash
# Builds the live-action footage for the BLine chapter. These clips autoplay (muted, looping) in normal page flow;
# the editor sequence plays per-step clips built by scripts/build-clips.py.
#
#  assets/media/bline-open.mp4   Our robot (2638) shooting on the move in the shop, testing a BLine auto.
#                                Source: ~/Downloads/2638_auto_shop_bline.mov (Edan, Oct 10 2026).
#  assets/media/bline-champs.mp4 is built separately: scripts/champs-clip/run.sh (Championship auto, graded,
#                                with a 3D bumper glow on 2638).
#  assets/media/team-worlds-screen.jpg  Teammates watching the arena screen at the 2026 World Championship.
#                                Source: rebelroboticsbooster.org (Rebel Robotics Booster Club homepage hero).
#  assets/media/bline-teams.mp4  Team montage, one 1.6 s cut per team (order must match CUTS in bline.js).
# Usage: bash scripts/build-sequences.sh   (needs ffmpeg)
set -euo pipefail
cd "$(dirname "$0")/.."

LAUNCH=~/FRC/BLine-Web/.claude/worktrees/bline-2027-launch-video-3b60b0/launch-video
MASTERS="$LAUNCH/public/hype/master"
SHOP=~/Downloads/2638_auto_shop_bline.mov
ENC=(-an -c:v libx264 -preset slow -pix_fmt yuv420p -movflags +faststart)

# Opener: robot drives in shooting (3–10 s), then the close handheld shot (15.5–19.5 s).
# The iPhone shot it in HDR (HLG / Dolby Vision). Passing that through tagged as HDR makes browsers pump the
# brightness up and down, so it is tone-mapped to SDR first with macOS's own exporter (this ffmpeg has no zscale).
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
avconvert --source "$SHOP" --preset Preset1920x1080 --output "$tmp/shop.mov" --replace >/dev/null
ffmpeg -v error -y -ss 3 -t 7 -i "$tmp/shop.mov" -ss 15.5 -t 4 -i "$tmp/shop.mov" -filter_complex \
  "[0:v]fps=30,scale=1920:-2,setsar=1[a];[1:v]fps=30,scale=1920:-2,setsar=1[b];[a][b]concat=n=2:v=1[v]" \
  -map "[v]" -crf 26 -colorspace bt709 -color_primaries bt709 -color_trc bt709 "${ENC[@]}" assets/media/bline-open.mp4
ffmpeg -v error -y -ss 1 -i assets/media/bline-open.mp4 -frames:v 1 -vf scale=1280:-2 -q:v 4 assets/media/bline-open.jpg

# Team montage: one 1.6 s cut per team from the launch film's verified match masters, as one looping clip
# (order must match CUTS in bline.js; the page labels each cut from the clip's currentTime).
args=(); filt=""; i=0
for c in "2638-rocket-m8@172.9" "6989-ankara-f3@69" "4522-johnson-q49@13" "1792-johnson-m10@169.6" \
         "3476-socal-m1@68" "4655-northstar-f2@135" "4915-milstein-f2@171.8" "4915-einstein-3@6"; do
  args+=(-t 1.6 -i "$MASTERS/$c.mp4"); filt+="[$i:v]fps=30,scale=1920:1080,setsar=1[v$i];"; i=$((i+1))
done
for j in $(seq 0 $((i-1))); do filt+="[v$j]"; done
ffmpeg -v error -y "${args[@]}" -filter_complex "${filt}concat=n=$i:v=1:a=0[out]" -map "[out]" -crf 28 "${ENC[@]}" assets/media/bline-teams.mp4
ffmpeg -v error -y -ss 12 -i assets/media/bline-teams.mp4 -frames:v 1 -vf scale=1280:-2 -q:v 4 assets/media/bline-teams.jpg
du -sh assets/media/bline-open.mp4  assets/media/bline-teams.mp4
