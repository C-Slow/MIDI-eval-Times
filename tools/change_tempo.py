#!/usr/bin/env python3
"""
Simple MIDI tempo scaler.

Usage:
  python change_tempo.py -i input.mid -o output.mid -f 1.1

`-f` is the tempo multiplier (1.0 = original, <1 slower, >1 faster).
This script multiplies all `set_tempo` meta messages' microseconds-per-beat
by `1/factor` so BPM is scaled by `factor`. If no tempo messages exist,
an initial tempo meta message is inserted based on the MIDI default (500000).
"""
import os
import sys
from typing import List, Tuple

try:
    import mido
except Exception as e:
    print("mido is required. Install with: pip install mido")
    raise


def scale_tempo_messages(mid: mido.MidiFile, factor: float) -> Tuple[List[int], List[int]]:
    """Scale all set_tempo meta messages by factor.

    Returns two lists: original tempos and new tempos (in microseconds per beat).
    """
    original = []
    new = []

    # Walk every track and modify set_tempo messages in-place
    for track in mid.tracks:
        for msg in track:
            if msg.is_meta and msg.type == 'set_tempo':
                original.append(msg.tempo)
                # new microseconds-per-beat is original / factor (BPM * factor)
                msg.tempo = max(1, int(msg.tempo / factor))
                new.append(msg.tempo)

    # If no tempo messages found, insert one at start of track 0
    if not original:
        default_tempo = 500000
        # If mido exposes helper, prefer it
        if hasattr(mido, 'bpm2tempo'):
            default_tempo = mido.bpm2tempo(120)
        original = [default_tempo]
        new_t = max(1, int(default_tempo / factor))
        new = [new_t]
        meta = mido.MetaMessage('set_tempo', tempo=new_t, time=0)
        # insert at beginning of first track
        if mid.tracks:
            mid.tracks[0].insert(0, meta)
        else:
            mid.tracks.append(mido.MidiTrack([meta]))

    return original, new


# === User parameters (edit these) ===
# Path to input MIDI file. Set to an absolute path or relative to working dir.
# e.g. INPUT_PATH = r"storage/raw/my-song.mid"
INPUT_PATH = "" 
# Optional output path. If empty, an output filename will be created next to the input.
OUTPUT_PATH = ""  

# Tempo multiplier (1.0 = original, <1 slower, >1 faster)
FACTOR = 1.0 # examples: 0.8, 1.2


def main():
    input_path = INPUT_PATH
    if not input_path:
        print("Please set INPUT_PATH at the top of the script.")
        sys.exit(2)

    if not os.path.isfile(input_path):
        print(f"Input file not found: {input_path}")
        sys.exit(2)

    factor = FACTOR
    if factor <= 0:
        print("FACTOR must be > 0")
        sys.exit(2)

    out = OUTPUT_PATH
    if not out:
        base, ext = os.path.splitext(os.path.basename(input_path))
        out = os.path.join(os.path.dirname(input_path), f"{base}-tempo{factor}{ext}")

    # If the provided output path is a directory, create a filename inside it
    if os.path.isdir(out):
        base, ext = os.path.splitext(os.path.basename(input_path))
        out = os.path.join(out, f"{base}-tempo{factor}{ext}")

    # Ensure parent directory exists
    parent = os.path.dirname(out)
    if parent:
        os.makedirs(parent, exist_ok=True)

    mid = mido.MidiFile(input_path)

    orig, new = scale_tempo_messages(mid, factor)

    print("Tempo changes adjusted:")
    for o, n in zip(orig, new):
        # convert to approximate BPM for readability
        try:
            ob = mido.tempo2bpm(o)
            nb = mido.tempo2bpm(n)
            print(f"  {o} µs/beat ({ob:.2f} BPM) -> {n} µs/beat ({nb:.2f} BPM)")
        except Exception:
            print(f"  {o} -> {n}")

    print(f"Writing adjusted MIDI to: {out}")
    mid.save(out)
    print(f"Saved adjusted MIDI to: {out}")


if __name__ == '__main__':
    main()
