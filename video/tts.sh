#!/usr/bin/env bash
# Text to speech with ai33pro (v3). Usage: bash tts.sh "Your text" out.mp3
# The key is never stored here: the session's network proxy adds it to requests to api.ai33.pro.
# Elsewhere, set AI33_KEY in the environment.
set -e
KEY="${AI33_KEY:-injected-by-proxy}"
VOICE="${VOICE:-elevenlabs_hpp4J3VqNfWAUOO0d1Us}"   # Bella
TEXT="$1"; OUT="${2:-out.mp3}"
[ -n "$TEXT" ] || { echo "usage: bash tts.sh \"text\" out.mp3" >&2; exit 2; }
json() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null || true; }
for try in 1 2 3; do
  TID=$(curl -s -X POST https://api.ai33.pro/v3/text-to-speech -H "xi-api-key: $KEY" \
    --form-string "text=$TEXT" --form-string "voice_id=$VOICE" --form-string "speed=${SPEED:-1}" \
    | json "d.get('task_id','')")
  [ -z "$TID" ] && { sleep 3; continue; }
  R=""
  for i in $(seq 90); do
    sleep 2
    R=$(curl -s "https://api.ai33.pro/v1/task/$TID" -H "xi-api-key: $KEY")
    ST=$(echo "$R" | json "d.get('status')")
    { [ "$ST" = done ] || [ "$ST" = failed ]; } && break
  done
  URL=$(echo "$R" | json "(d.get('metadata') or {}).get('audio_url','')")
  [ -n "$URL" ] && curl -s -o "$OUT" "$URL" && echo "saved $OUT" && exit 0
done
echo "failed" >&2; exit 1
