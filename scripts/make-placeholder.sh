#!/usr/bin/env bash
# Regenerates public/stream/placeholder.mp4 — the standby loop the player shows
# whenever the broadcaster's HLS playlist is missing (M0, and the client-side
# half of the §7 "no dead air" rule).
#
# Same shape as a real clip: 16:9, 768p, 24fps, with an audio track.
set -euo pipefail

out="${1:-public/stream/placeholder.mp4}"
font="/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
[ -f "$font" ] || font="/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"

mkdir -p "$(dirname "$out")"

ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "gradients=s=1366x768:c0=0x050505:c1=0x1b1b1b:c2=0x0d0d12:n=3:speed=0.012:rate=24:d=12" \
  -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=48000" \
  -filter_complex "\
[0:v]noise=alls=6:allf=t+u,\
drawtext=fontfile=${font}:text='BIDSTREAM':fontcolor=0xf5f5f5:fontsize=76:x=(w-tw)/2:y=(h/2)-70:alpha='0.85+0.15*sin(2*PI*t/6)',\
drawtext=fontfile=${font}:text='STANDBY \\: NOTHING PAID IS AIRING':fontcolor=0x8a8a8a:fontsize=22:x=(w-tw)/2:y=(h/2)+30,\
drawtext=fontfile=${font}:text='BID TO TAKE THE CHANNEL':fontcolor=0xd7ff2e:fontsize=22:x=(w-tw)/2:y=(h/2)+70[v]" \
  -map "[v]" -map 1:a -t 12 \
  -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -r 24 \
  -c:a aac -b:a 64k -shortest -movflags +faststart \
  "$out"

echo "wrote $out ($(du -h "$out" | cut -f1))"
