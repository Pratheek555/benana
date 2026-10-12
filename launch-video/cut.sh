#!/usr/bin/env bash
# Cuts the OBS recordings in footage/ into the clips the video uses (public/footage/*.mp4).
# Each segment is "file start end speed"; app captures lose the 24px Electron menu bar.
set -euo pipefail
cd "$(dirname "$0")"

clip() { # clip <out> <crop:0|1> <segment>...
  local out=$1 crop=$2; shift 2
  local inputs=() filters="" labels="" i=0
  for seg in "$@"; do
    read -r file start end speed <<<"$seg"
    inputs+=(-ss "$start" -to "$end" -i "footage/$file")
    local c=""; [ "$crop" = 1 ] && c="crop=1920:1056:0:24,scale=1920:1080,"
    filters+="[$i:v]${c}setpts=(PTS-STARTPTS)/$speed,fps=30,format=yuv420p[v$i];"
    labels+="[v$i]"; i=$((i+1))
  done
  ffmpeg -v error -y "${inputs[@]}" -filter_complex "${filters}${labels}concat=n=$i:v=1:a=0[out]" -map "[out]" \
    -c:v h264_nvenc -preset p5 -cq 19 -g 15 "public/footage/$out.mp4"
  echo "$out $(ffprobe -v error -show_entries format=duration -of csv=p=0 public/footage/$out.mp4)s"
}

clip build-app 1 \
  "02-build-thunder-hammer.mkv 1 14.5 9" \
  "02-build-thunder-hammer.mkv 60 300 160" \
  "02-build-thunder-hammer.mkv 340 352 8" \
  "02-build-thunder-hammer.mkv 420 540 80" \
  "02-build-thunder-hammer.mkv 540 542 2"
clip game 0 "03-blackhole-game.mkv 8 45 1"
clip stuck-fail 1 "04-arrowtracer-attempts.mkv 0.3 2.6 1"
clip stuck-pass 1 "04-arrowtracer-attempts.mkv 6.6 11 1"
clip market 1 \
  "05b-market-listing.mkv 0.4 1.6 1" \
  "05b-market-listing.mkv 3.4 5.8 1" \
  "05-marketplace.mkv 6 7.6 1"
clip cfo-final 1 \
  "06-cfo.mkv 2.5 4.5 1" \
  "06-cfo.mkv 4.5 34.5 15" \
  "06-cfo.mkv 35 37 1" \
  "06-cfo.mkv 54 57 1"
