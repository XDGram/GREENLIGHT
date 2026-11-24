#!/usr/bin/env bash
# Download the four candidate tracks from incompetech (CC BY 4.0).
set -e
cd "$(dirname "$0")"
for t in "Getting it Done" "Inspired" "Beauty Flow" "Numinous Shine"; do
  curl -fsS -o "$t.mp3" "https://incompetech.com/music/royalty-free/mp3-royaltyfree/${t// /%20}.mp3" && echo "saved $t.mp3"
done
