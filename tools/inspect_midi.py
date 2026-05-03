from collections import Counter, defaultdict
import sys
import mido

def inspect(path: str):
    mid = mido.MidiFile(path)

    msg_counts = Counter()
    note_on = 0
    note_on_nonzero = 0
    note_off = 0
    program_changes = 0
    tempo_events = 0

    channels = Counter()
    programs_by_channel = defaultdict(set)
    vel_min = None
    vel_max = None

    for i, track in enumerate(mid.tracks):
        for msg in track:
            msg_counts[msg.type] += 1

            if hasattr(msg, "channel"):
                channels[msg.channel] += 1

            if msg.type == "note_on":
                note_on += 1
                if msg.velocity and msg.velocity > 0:
                    note_on_nonzero += 1
                    vel_min = msg.velocity if vel_min is None else min(vel_min, msg.velocity)
                    vel_max = msg.velocity if vel_max is None else max(vel_max, msg.velocity)
                else:
                    # note_on velocity 0 is effectively note_off
                    pass

            elif msg.type == "note_off":
                note_off += 1

            elif msg.type == "program_change":
                program_changes += 1
                programs_by_channel[msg.channel].add(msg.program)

            elif msg.type == "set_tempo":
                tempo_events += 1

    print(f"\nFILE: {path}")
    print(f"Tracks: {len(mid.tracks)}  |  PPQ(ticks_per_beat): {mid.ticks_per_beat}")
    print(f"note_on total: {note_on}  |  note_on velocity>0: {note_on_nonzero}  |  note_off: {note_off}")
    print(f"program_change: {program_changes}  |  set_tempo: {tempo_events}")
    print(f"Velocity range (nonzero note_on): {vel_min}..{vel_max}")
    print(f"Channel message counts: {dict(channels)}")
    print(f"Programs by channel: { {ch: sorted(list(progs)) for ch, progs in programs_by_channel.items()} }")

    # show top message types
    print("Top message types:", msg_counts.most_common(10))

if __name__ == "__main__":
    inspect(sys.argv[1])
