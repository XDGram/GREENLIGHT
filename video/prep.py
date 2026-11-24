#!/usr/bin/env python3
"""Prepare everything the Remotion composition reads.

- remotion/src/data/vo.json: each voiceover line's text, duration and sentence timings (sentence
  starts come from the pauses in the audio, so captions and on-screen actions land on the words).
- public/sfx/*.wav: a few quiet interface sounds, synthesised (no samples).
- public/music/full.wav and muffled.wav: "Inspired" (Kevin MacLeod, CC BY 4.0) from MUSIC_START,
  so the song's real ending lands on the last frame. The muffled copy is used while the claim fails.
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
VO = os.path.join(HERE, "public", "vo")
OUT_DATA = os.path.join(HERE, "remotion", "src", "data")
SFX = os.path.join(HERE, "public", "sfx")
MUSIC = os.path.join(HERE, "public", "music")
for d in (OUT_DATA, SFX, MUSIC):
    os.makedirs(d, exist_ok=True)

TOTAL = float(sys.argv[1]) if len(sys.argv) > 1 else 196.0
MUSIC_END = 282.0  # the song settles to silence here
MUSIC_START = round(MUSIC_END - TOTAL, 3) + 0.035  # keep the beat grid on whole half-seconds


def run(*a):
    return subprocess.run(a, check=True, capture_output=True, text=True)


def duration(f):
    return float(run("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f).stdout)


def pauses(f):
    err = subprocess.run(["ffmpeg", "-i", f, "-af", "silencedetect=noise=-38dB:d=0.16", "-f", "null", "-"], capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"silence_start: ([0-9.]+)", err)]
    ends = [float(x) for x in re.findall(r"silence_end: ([0-9.]+)", err)]
    return list(zip(starts, ends))


script = open(os.path.join(HERE, "SCRIPT.md")).read()
block = script.split("## Voiceover, line by line")[1].split("---")[0]
lines = [l.split(". ", 1)[1] for l in block.splitlines() if l[:1].isdigit()]

out = []
for i, text in enumerate(lines, 1):
    f = os.path.join(VO, f"{i:02d}.mp3")
    dur = duration(f)
    sents = [s.strip() for s in re.split(r"(?<=[.?!])\s+", text) if s.strip()]
    ps = [p for p in pauses(f) if 0.15 < p[0] < dur - 0.2]
    # Speech onset and the gaps between sentences.
    head = pauses(f)
    onset = head[0][1] if head and head[0][0] < 0.05 else 0.0
    # Match the longest pauses to sentence boundaries, in time order.
    need = len(sents) - 1
    best = sorted(sorted(ps, key=lambda p: p[1] - p[0], reverse=True)[:need])
    if len(best) == need:
        starts = [onset] + [round(p[1], 3) for p in best]
    else:  # fall back to character share
        total = sum(len(s) for s in sents)
        acc, starts = 0, []
        for s in sents:
            starts.append(round(onset + (dur - onset) * acc / total, 3))
            acc += len(s) + 1
    ends = starts[1:] + [dur]
    out.append({"text": text, "duration": round(dur, 3), "sentences": [{"text": s, "start": st, "end": round(en, 3)} for s, st, en in zip(sents, starts, ends)]})

json.dump({"musicStart": MUSIC_START, "lines": out}, open(os.path.join(OUT_DATA, "vo.json"), "w"), indent=1)
print("vo.json written,", len(out), "lines; music from", MUSIC_START)

# Interface sounds: soft, short, low in level.
SR = 48000
sfx = {
    "click": "0.5*sin(2*PI*2200*t)*exp(-t*90)+0.25*(random(0)-0.5)*exp(-t*160)",
    "type": "0.18*(random(0)-0.5)*exp(-t*220)",
    "tick": "0.35*sin(2*PI*1600*t)*exp(-t*60)",
    "fail": "0.55*(sin(2*PI*196*t)+0.5*sin(2*PI*233*t))*exp(-t*3.2)*(1-exp(-t*60))",
    "pass": "0.32*(sin(2*PI*1318.5*t)*exp(-t*5)+ gt(t,0.11)*sin(2*PI*1975.5*(t-0.11))*exp(-(t-0.11)*4.2))*(1-exp(-t*200))",
}
lens = {"click": 0.12, "type": 0.05, "tick": 0.2, "fail": 1.6, "pass": 1.4}
for name, expr in sfx.items():
    run("ffmpeg", "-y", "-f", "lavfi", "-i", f"aevalsrc='{expr}':s={SR}:d={lens[name]}", "-af", "afade=t=out:st=%.3f:d=0.03" % (lens[name] - 0.03), "-ac", "2", os.path.join(SFX, f"{name}.wav"))
print("sfx written")

src = os.path.join(HERE, "music", "Inspired.mp3")
L = TOTAL + 1
run("ffmpeg", "-y", "-ss", str(MUSIC_START), "-t", str(L), "-i", src, "-af", "afade=t=in:d=1.2", "-ar", str(SR), os.path.join(MUSIC, "full.wav"))
run("ffmpeg", "-y", "-ss", str(MUSIC_START), "-t", str(L), "-i", src, "-af", "afade=t=in:d=1.2,lowpass=f=420,lowpass=f=420,volume=1.8", "-ar", str(SR), os.path.join(MUSIC, "muffled.wav"))
print("music stems written")
