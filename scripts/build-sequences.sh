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
SRC_CHAMPS=assets/source/champs
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

# Team montage: one 1.6 s cut per team from 2026 World Championship footage, as one looping clip (order must match CUTS
# in bline.js; the page labels each cut from the clip's currentTime). Most cuts come from the launch film's verified
# match masters; 3476 and 971 are from their Archimedes playoff streams on FIRST's YouTube channel (Edan, Oct 13 2026):
# semifinal 4 (6lZ6OQrp_2o) and semifinal 2 (otc-A0hEwQ8), first 40 s saved in assets/source/champs/, cut mid-auto.
args=(); filt=""; i=0
for c in "$MASTERS/4522-johnson-q49@13.mp4@0" "$SRC_CHAMPS/3476-arc-sf4m1.mp4@9" "$MASTERS/1987-curie-q118@69.5.mp4@0" \
         "$SRC_CHAMPS/971-arc-sf2m1.mp4@11" "$MASTERS/1710-hopper-q36@69.5.mp4@0" "$MASTERS/4089-milstein-m10@165.mp4@0" \
         "$MASTERS/4915-einstein-3@6.mp4@0"; do
  args+=(-ss "${c##*@}" -t 1.7 -i "${c%@*}"); filt+="[$i:v]fps=30,trim=end_frame=48,setpts=PTS-STARTPTS,scale=1920:1080,setsar=1[v$i];"; i=$((i+1))  # exactly 1.6 s each, so the labels stay on the cuts
done
for j in $(seq 0 $((i-1))); do filt+="[v$j]"; done
ffmpeg -v error -y "${args[@]}" -filter_complex "${filt}concat=n=$i:v=1:a=0[out]" -map "[out]" -crf 28 "${ENC[@]}" assets/media/bline-teams.mp4
ffmpeg -v error -y -ss 5 -i assets/media/bline-teams.mp4 -frames:v 1 -vf scale=1280:-2 -q:v 4 assets/media/bline-teams.jpg
du -sh assets/media/bline-open.mp4  assets/media/bline-teams.mp4
