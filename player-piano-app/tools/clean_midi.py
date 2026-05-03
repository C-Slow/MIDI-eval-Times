import pretty_midi
import os
import json
import shutil
from datetime import datetime
import numpy as np
import collections

# ==========================================================
#                     BASE CONSTANTS
# ==========================================================
VELOCITY_MIN = 18
VELOCITY_MAX = 60
FORCE_PIANO_PROGRAM = True
FORCE_NOT_DRUM = True
MERGE_TO_SINGLE_PIANO_TRACK = True
COMPAT_VELOCITY_CEIL = 90
SHIFT_START_TO_ZERO = True

# ==========================================================
#          DKC-55 Continuous Pedal Presets
# ==========================================================
PEDAL_PRESETS = {
    "light": {
        "light": 28, "half": 50, "full": 82,
        "release_floor": 8, # Conservative increase to cushion physical release
        "bass_median_pitch": 52, "bass_cap": 38,
        "harmony_window": 0.15, # Seconds to group notes into a "chord"
        "ramp_time": 0.07,
        "compat_velocity_floor": 8,
    },
    "medium": {
        # TEMPORARILY MATCHING LIGHT TO MITIGATE CLANKING
        "light": 28, "half": 50, "full": 82,
        "release_floor": 8,
        "bass_median_pitch": 52, "bass_cap": 38,
        "harmony_window": 0.15,
        "ramp_time": 0.07,
        "compat_velocity_floor": 8,
    },
    "full": {
        # TEMPORARILY MATCHING LIGHT TO MITIGATE CLANKING
        "light": 28, "half": 50, "full": 82,
        "release_floor": 8,
        "bass_median_pitch": 52, "bass_cap": 38,
        "harmony_window": 0.15,
        "ramp_time": 0.07,
        "compat_velocity_floor": 8,
    },
}

def log(msg: str):
    print(msg)

def identify_rhythm_notes(notes):
    """Identify repetitive rhythmic notes (Ostinato)."""
    if not notes: return set()
    notes_by_pitch = collections.defaultdict(list)
    for n in notes:
        notes_by_pitch[n.pitch].append(n)
    rhythm_note_ids = set()
    total_notes = len(notes)
    for pitch, p_notes in notes_by_pitch.items():
        if len(p_notes) < 6: continue
        p_notes.sort(key=lambda n: n.start)
        intervals = [round(p_notes[i+1].start - p_notes[i].start, 2) for i in range(len(p_notes)-1)]
        if not intervals: continue
        counts = collections.Counter(intervals)
        most_common_int, count = counts.most_common(1)[0]
        repetition_rate = count / len(intervals)
        if repetition_rate > 0.4 and len(p_notes) > 8:
            for n in p_notes: rhythm_note_ids.add(id(n))
        elif len(p_notes) / total_notes > 0.15:
            for n in p_notes: rhythm_note_ids.add(id(n))
    return rhythm_note_ids

def _choose_pedal_depth(notes, t, config):
    window = 0.5
    onsets = sum(1 for n in notes if (t - window) <= n.start <= (t + window))
    ps = sorted([n.pitch for n in notes if (t - window) <= n.start <= (t + window)])
    medp = ps[len(ps)//2] if ps else None

    if onsets <= 2: target = config["light"]
    elif onsets >= 6: target = config["full"]
    else: target = config["half"]

    if medp is not None and medp < config["bass_median_pitch"]:
        target = min(target, config["bass_cap"])
    return int(max(0, min(127, target)))

def _add_cc(events, time, value):
    time = max(0.0, float(time))
    value = int(max(0, min(127, value)))
    if events and events[-1].value == value and abs(events[-1].time - time) < 0.001: return
    events.append(pretty_midi.ControlChange(number=64, value=value, time=time))

def _ramp_cc64(events, t0, v0, t1, v1, steps=5):
    if t1 <= t0:
        _add_cc(events, t1, v1)
        return
    for i in range(1, steps + 1):
        a = i / steps
        t = t0 + (t1 - t0) * a
        v = int(round(v0 + (v1 - v0) * a))
        _add_cc(events, t, v)

def generate_cc64_dkc55(notes, config):
    """
    Implements 'Syncopated Pedaling' (After-Pedaling).
    The pedal refreshes (lifts and re-presses) immediately AFTER a new harmony begins.
    """
    if not notes: return []
    notes = sorted(notes, key=lambda n: (n.start, n.pitch))
    events = []
    
    floor = config.get("release_floor", 0)
    ramp = config["ramp_time"]
    window = config.get("harmony_window", 0.15)
    cur_v = 0
    
    # 1. Group notes into 'Harmonic Windows'
    onsets = sorted({n.start for n in notes})
    if not onsets: return []
    
    harmonic_groups = []
    if onsets:
        current_group_start = onsets[0]
        for t in onsets[1:]:
            if t - current_group_start > window:
                harmonic_groups.append(current_group_start)
                current_group_start = t
        harmonic_groups.append(current_group_start)

    # 2. Process each group with Syncopated timing
    for i, t_onset in enumerate(harmonic_groups):
        target_depth = _choose_pedal_depth(notes, t_onset, config)
        
        if i == 0:
            # First note: standard down-ramp
            _ramp_cc64(events, t_onset + 0.01, cur_v, t_onset + 0.01 + ramp, target_depth)
        else:
            # Syncopated Refresh: 
            # 1. Lift slightly AFTER the note starts (to clear previous harmony)
            t_lift = t_onset + 0.02 
            _ramp_cc64(events, t_lift, cur_v, t_lift + ramp, floor)
            
            # 2. Re-press immediately after the lift to catch the new harmony
            t_repress = t_lift + ramp + 0.01
            _ramp_cc64(events, t_repress, floor, t_repress + ramp, target_depth)
            
        cur_v = target_depth

    # Final release to TRUE ZERO at the very end
    final_end = max(n.end for n in notes)
    _ramp_cc64(events, final_end + 0.05, cur_v, final_end + 0.25, 0, steps=10)
    
    return events

def normalize_for_playback(instruments, program=0, vel_floor=10, vel_ceil=90, merge_to_single=True, force_not_drum=True, shift_start_to_zero=True):
    all_notes = []
    all_ccs = []
    min_start = None
    for inst in instruments:
        for n in inst.notes:
            all_notes.append(n)
            if min_start is None or n.start < min_start: min_start = n.start
        for cc in inst.control_changes:
            all_ccs.append(cc)
    if not all_notes: return instruments
    if shift_start_to_zero and min_start is not None and min_start > 0:
        shift = min_start
        for n in all_notes:
            n.start -= shift
            n.end -= shift
        for cc in all_ccs:
            cc.time -= shift
    for n in all_notes:
        n.velocity = int(min(max(n.velocity, vel_floor), vel_ceil))
    if not merge_to_single: return instruments
    merged = pretty_midi.Instrument(program=program, name="Piano", is_drum=False)
    merged.notes = sorted(all_notes, key=lambda x: (x.start, x.pitch))
    merged.control_changes = sorted(all_ccs, key=lambda x: x.time)
    return [merged]

def process_file(input_path, output_folder, rhythm_factor=1.0, melody_factor=1.0, pedal_preset='light'):
    try:
        pm = pretty_midi.PrettyMIDI(input_path)
        all_insts = [i for i in pm.instruments if not i.is_drum and len(i.notes) > 0]
        if not all_insts: return None
        full_notes = []
        for inst in all_insts: full_notes.extend(inst.notes)
        master = pretty_midi.Instrument(program=0)
        master.notes = full_notes
        rhythm_ids = identify_rhythm_notes(master.notes)
        for note in master.notes:
            if id(note) in rhythm_ids: note.velocity = int(note.velocity * rhythm_factor)
            else: note.velocity = int(note.velocity * melody_factor)
            note.velocity = max(1, min(127, note.velocity))
        config = PEDAL_PRESETS.get(pedal_preset, PEDAL_PRESETS["light"])
        cc64 = generate_cc64_dkc55(master.notes, config)
        master.control_changes = cc64
        final_tracks = normalize_for_playback([master], vel_floor=config["compat_velocity_floor"], vel_ceil=90)
        pm.instruments = final_tracks
        out_name = os.path.basename(input_path).replace('_original', '')
        output_path = os.path.join(output_folder, out_name)
        pm.write(output_path)
        return output_path
    except Exception as e:
        print(f"ERROR processing MIDI: {str(e)}")
        raise e

if __name__ == "__main__":
    import sys
    if len(sys.argv) >= 3:
        inp = sys.argv[1]; out_f = sys.argv[2]
        r_f = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
        m_f = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
        preset = sys.argv[5].lower() if len(sys.argv) > 5 else 'light'
        process_file(inp, out_f, r_f, m_f, preset)
