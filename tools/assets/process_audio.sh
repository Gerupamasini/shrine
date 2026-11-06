#!/usr/bin/env bash
# Prepare the CC BY 4.0 higurashi recording (Wikimedia Commons, author Σ64) for the web.
# High-pass removes traffic rumble below ~280 Hz; loudness-normalised; mono copy for 3D sources.
set -euo pipefail
cd "$(dirname "$0")/../.."
SRC=.cache/commons/Tanna_japonensis_v01.ogg
OUT=public/assets/audio
F="highpass=f=280:poles=2,highpass=f=200,afftdn=nf=-50,loudnorm=I=-20:TP=-2:LRA=11"
ffmpeg -hide_banner -loglevel error -y -i "$SRC" -af "$F" -c:a libvorbis -q:a 5 "$OUT/higurashi-tanna-stereo.ogg"
ffmpeg -hide_banner -loglevel error -y -i "$SRC" -af "$F" -c:a libmp3lame -q:a 3 "$OUT/higurashi-tanna-stereo.mp3"
ffmpeg -hide_banner -loglevel error -y -i "$SRC" -af "pan=mono|c0=0.5*c0+0.5*c1,$F" -c:a libvorbis -q:a 5 "$OUT/higurashi-tanna-mono.ogg"
ffmpeg -hide_banner -loglevel error -y -i "$SRC" -af "pan=mono|c0=0.5*c0+0.5*c1,$F" -c:a libmp3lame -q:a 3 "$OUT/higurashi-tanna-mono.mp3"
ls -la "$OUT"
