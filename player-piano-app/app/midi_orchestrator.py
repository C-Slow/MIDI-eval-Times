import os
import json
import uuid
import time
import shutil
import threading
from pathlib import Path
import pretty_midi
import collections
from typing import Dict, List, Optional
from app import utils

# DKC-55 Continuous Pedal Presets
PEDAL_PRESETS = {
    "light": {
        "light": 28, "half": 50, "full": 82,
        "release_floor": 8,
        "bass_median_pitch": 52, "bass_cap": 38,
        "harmony_window": 0.15,
        "ramp_time": 0.07,
        "compat_velocity_floor": 8,
    },
    "medium": {
        "light": 28, "half": 50, "full": 82,
        "release_floor": 8,
        "bass_median_pitch": 52, "bass_cap": 38,
        "harmony_window": 0.15,
        "ramp_time": 0.07,
        "compat_velocity_floor": 8,
    },
    "full": {
        "light": 28, "half": 50, "full": 82,
        "release_floor": 8,
        "bass_median_pitch": 52, "bass_cap": 38,
        "harmony_window": 0.15,
        "ramp_time": 0.07,
        "compat_velocity_floor": 8,
    },
}

GM_INSTRUMENTS = [
    # 0-7: Piano
    "Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-tonk Piano",
    "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavi",
    # 8-15: Chromatic Percussion
    "Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
    # 16-23: Organ
    "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ", "Reed Organ", "Accordion", "Harmonica", "Tango Accordion",
    # 24-31: Guitar
    "Acoustic Guitar (nylon)", "Acoustic Guitar (steel)", "Electric Guitar (jazz)", "Electric Guitar (clean)",
    "Electric Guitar (muted)", "Overdriven Guitar", "Distortion Guitar", "Guitar harmonics",
    # 32-39: Bass
    "Acoustic Bass", "Electric Bass (finger)", "Electric Bass (pick)", "Fretless Bass",
    "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2",
    # 40-47: Strings
    "Violin", "Viola", "Cello", "Contrabass", "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani",
    # 48-55: Ensemble
    "String Ensemble 1", "String Ensemble 2", "SynthStrings 1", "SynthStrings 2",
    "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit",
    # 56-63: Brass
    "Trumpet", "Trombone", "Tuba", "Muted Trumpet", "French Horn", "Brass Section", "SynthBrass 1", "SynthBrass 2",
    # 64-71: Reed
    "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe", "English Horn", "Bassoon", "Clarinet",
    # 72-79: Pipe
    "Piccolo", "Flute", "Recorder", "Pan Flute", "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
    # 80-87: Synth Lead
    "Lead 1 (square)", "Lead 2 (sawtooth)", "Lead 3 (calliope)", "Lead 4 (chiff)",
    "Lead 5 (charang)", "Lead 6 (voice)", "Lead 7 (fifths)", "Lead 8 (bass+lead)",
    # 88-95: Synth Pad
    "Pad 1 (new age)", "Pad 2 (warm)", "Pad 3 (polysynth)", "Pad 4 (choir)",
    "Pad 5 (bowed)", "Pad 6 (metallic)", "Pad 7 (halo)", "Pad 8 (sweep)",
    # 96-103: Synth Effects
    "FX 1 (rain)", "FX 2 (soundtrack)", "FX 3 (crystal)", "FX 4 (atmosphere)",
    "FX 5 (brightness)", "FX 6 (goblins)", "FX 7 (echoes)", "FX 8 (sci-fi)",
    # 104-111: Ethnic
    "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bag pipe", "Fiddle", "Shanai",
    # 112-119: Percussive
    "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock", "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal",
    # 120-127: Sound Effects
    "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet", "Telephone Ring", "Helicopter", "Applause", "Gunshot"
]

def get_instrument_name(program: int) -> str:
    if 0 <= program < len(GM_INSTRUMENTS):
        return GM_INSTRUMENTS[program]
    return f"Unknown Instrument ({program})"

def identify_rhythm_notes(notes):
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
    if not notes: return []
    notes = sorted(notes, key=lambda n: (n.start, n.pitch))
    events = []
    
    floor = config.get("release_floor", 0)
    ramp = config["ramp_time"]
    window = config.get("harmony_window", 0.15)
    cur_v = 0
    
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

    for i, t_onset in enumerate(harmonic_groups):
        target_depth = _choose_pedal_depth(notes, t_onset, config)
        
        if i == 0:
            _ramp_cc64(events, t_onset + 0.01, cur_v, t_onset + 0.01 + ramp, target_depth)
        else:
            t_lift = t_onset + 0.02 
            _ramp_cc64(events, t_lift, cur_v, t_lift + ramp, floor)
            
            t_repress = t_lift + ramp + 0.01
            _ramp_cc64(events, t_repress, floor, t_repress + ramp, target_depth)
            
        cur_v = target_depth

    final_end = max(n.end for n in notes)
    _ramp_cc64(events, final_end + 0.05, cur_v, final_end + 0.25, 0, steps=10)
    
    return events


class MidiOrchestrator:
    def __init__(self, storage_dir: Path):
        self.storage_dir = storage_dir
        self.base_dir = storage_dir / "midi_orchestrator"
        self.uploads_dir = self.base_dir / "uploads"
        self.jobs_dir = self.base_dir / "jobs"
        self.db_path = self.base_dir / "midi_jobs.json"
        
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        
        self.soundfont_path = storage_dir / "SGM-V2.01.sf2"
        # Fallbacks
        if not self.soundfont_path.exists():
            self.soundfont_path = storage_dir / "ChoriumRevA.sf2"
        if not self.soundfont_path.exists():
            self.soundfont_path = storage_dir / "FluidR3_GM.sf2"
        if not self.soundfont_path.exists():
            self.soundfont_path = storage_dir / "GeneralUser_GS.sf2"

        self.status: Dict[str, Dict] = self._load_db()
        self.rvc = None
        self.rvc_models_dir = storage_dir / "rvc_models"

    def _load_db(self) -> Dict:
        if self.db_path.exists():
            try:
                return json.loads(self.db_path.read_text(encoding='utf-8'))
            except Exception:
                return {}
        return {}

    def _save_db(self):
        try:
            self.db_path.write_text(json.dumps(self.status, indent=2), encoding='utf-8')
        except Exception as e:
            print(f"Error saving midi jobs DB: {e}")

    def upload_midi(self, midi_bytes: bytes, filename: str) -> str:
        job_id = str(uuid.uuid4())
        dest = self.uploads_dir / f"{job_id}.mid"
        dest.write_bytes(midi_bytes)
        
        # Initialize job entry
        self.status[job_id] = {
            "job_id": job_id,
            "filename": filename,
            "status": "uploaded",
            "timestamp": time.time(),
            "tracks": self._extract_track_meta(dest),
            "comments": "",
            "artist": "",
            "genre": "",
            "mood": "",
            "source": "",
            "dnu": False,
            "rating": 0,
            "playlists": [],
            "rhythm_factor": 1.0,
            "melody_factor": 1.0,
            "pedal_preset": "light",
            "piano_tracks": [],
            "speaker_tracks": [],
            "vocals": None, # Will store the backing audio WAV path/url
            "midi": None, # Will store the piano MIDI path
            "progress": 0
        }
        self._save_db()
        return job_id

    def _extract_track_meta(self, midi_path: Path) -> List[Dict]:
        try:
            pm = pretty_midi.PrettyMIDI(str(midi_path))
            tracks = []
            for i, inst in enumerate(pm.instruments):
                tracks.append({
                    "index": int(i),
                    "name": inst.name.strip() or f"Track {i+1}",
                    "program": int(inst.program),
                    "instrument_name": get_instrument_name(int(inst.program)),
                    "is_drum": inst.is_drum,
                    "note_count": len(inst.notes),
                    "duration": float(inst.get_end_time()) if inst.notes else 0.0
                })
            return tracks
        except Exception as e:
            print(f"Error extracting track metadata: {e}")
            return []

    def get_track_notes(self, job_id: str) -> Dict[str, List]:
        """Returns lists of note events per track index for visualization on the phone client."""
        if job_id not in self.status:
            return {}
        
        midi_path = self.uploads_dir / f"{job_id}.mid"
        if not midi_path.exists():
            # Check job folder
            midi_path = self.jobs_dir / job_id / "original.mid"
            if not midi_path.exists():
                return {}

        try:
            pm = pretty_midi.PrettyMIDI(str(midi_path))
            track_notes = {}
            for i, inst in enumerate(pm.instruments):
                notes = []
                # Sort notes by start time
                sorted_notes = sorted(inst.notes, key=lambda n: n.start)
                for n in sorted_notes:
                    notes.append({
                        "pitch": int(n.pitch),
                        "start": float(n.start),
                        "end": float(n.end),
                        "velocity": int(n.velocity)
                    })
                track_notes[str(i)] = notes
            return track_notes
        except Exception as e:
            print(f"Error extracting track notes: {e}")
            return {}

    def start_processing(self, job_id: str, piano_tracks: List[int], speaker_tracks: List[int], pedal_preset: str = "light", rhythm_factor: float = 1.0, melody_factor: float = 1.0, vocal_male_tracks: List[int] = None, vocal_female_tracks: List[int] = None):
        if job_id not in self.status:
            raise ValueError("Job not found.")
            
        vocal_male_tracks = vocal_male_tracks or []
        vocal_female_tracks = vocal_female_tracks or []
            
        self.status[job_id].update({
            "status": "processing",
            "progress": 10,
            "piano_tracks": piano_tracks,
            "speaker_tracks": speaker_tracks,
            "vocal_male_tracks": vocal_male_tracks,
            "vocal_female_tracks": vocal_female_tracks,
            "pedal_preset": pedal_preset,
            "rhythm_factor": rhythm_factor,
            "melody_factor": melody_factor
        })
        self._save_db()
        
        thread = threading.Thread(target=self._process_task, args=(job_id, piano_tracks, speaker_tracks, pedal_preset, rhythm_factor, melody_factor, vocal_male_tracks, vocal_female_tracks))
        thread.daemon = True
        thread.start()

    def _process_rvc_vocals(self, job_dir: Path, pm: pretty_midi.PrettyMIDI, vocal_tracks: List[int], gender: str, time_shift: float) -> Optional[Path]:
        if not vocal_tracks:
            return None
            
        # 1. Create guide MIDI file
        vocal_pm = pretty_midi.PrettyMIDI()
        for idx in vocal_tracks:
            if idx < len(pm.instruments):
                orig_inst = pm.instruments[idx]
                # Use Program 52 (Choir Aahs) for a clean vocal guide hum
                new_inst = pretty_midi.Instrument(program=52, name=f"Vocal_{gender}_{idx}")
                for n in orig_inst.notes:
                    new_inst.notes.append(pretty_midi.Note(
                        velocity=n.velocity,
                        pitch=n.pitch,
                        start=max(0.0, n.start - time_shift),
                        end=max(0.0, n.end - time_shift)
                    ))
                vocal_pm.instruments.append(new_inst)
                
        if not vocal_pm.instruments:
            return None
            
        guide_mid_path = job_dir / f"guide_{gender}.mid"
        guide_wav_path = job_dir / f"guide_{gender}.wav"
        rvc_wav_path = job_dir / f"rvc_{gender}.wav"
        
        vocal_pm.write(str(guide_mid_path))
        
        # 2. Render guide MIDI to WAV using FluidSynth
        utils.render_midi_to_wav_with_soundfont(
            str(guide_mid_path),
            str(self.soundfont_path),
            str(guide_wav_path)
        )
        
        # Clean up guide MIDI
        if guide_mid_path.exists():
            guide_mid_path.unlink()
            
        if not guide_wav_path.exists():
            return None
            
        # 3. Perform RVC inference
        try:
            print(f"MIDI Orchestrator: Starting RVC {gender} voice conversion for {guide_wav_path}...")
            
            # Lazy import RVCInference
            from rvc_python.infer import RVCInference
            if self.rvc is None:
                self.rvc = RVCInference(device="cpu")
                
            model_name = "male_singing.pth" if gender == "male" else "female_singing.pth"
            model_path = self.rvc_models_dir / model_name
            
            if not model_path.exists():
                raise FileNotFoundError(f"RVC voice model {model_name} not found at {model_path}")
                
            self.rvc.load_model(str(model_path), version="v2")
            # Set RMVPE pitch extraction, no pitch shifting (f0up_key=0)
            self.rvc.set_params(f0up_key=0, f0method="rmvpe")
            self.rvc.infer_file(str(guide_wav_path), str(rvc_wav_path))
            
            print(f"MIDI Orchestrator: RVC {gender} voice conversion complete -> {rvc_wav_path}")
            
            # Clean up guide WAV
            if guide_wav_path.exists():
                guide_wav_path.unlink()
                
            return rvc_wav_path
        except Exception as e:
            print(f"Error performing RVC inference for {gender} vocals: {e}")
            # If RVC fails, return the guide WAV as fallback!
            return guide_wav_path

    def _mix_wav_files(self, input_paths: List[Path], output_path: Path):
        from scipy.io import wavfile
        import scipy.signal
        import numpy as np
        
        valid_paths = [p for p in input_paths if p and p.exists()]
        if not valid_paths:
            return
            
        if len(valid_paths) == 1:
            shutil.copy(str(valid_paths[0]), str(output_path))
            return
            
        tensors = []
        rate = None
        
        for p in valid_paths:
            try:
                r, d = wavfile.read(str(p))
                if rate is None:
                    rate = r
                
                d_float = d.astype(np.float32)
                if r != rate:
                    num_samples = int(len(d_float) * rate / r)
                    d_float = scipy.signal.resample(d_float, num_samples, axis=0)
                tensors.append(d_float)
            except Exception as e:
                print(f"Error reading {p} for mixing: {e}")
                
        if not tensors:
            return
            
        # Find max length and pad smaller arrays
        max_len = max(len(t) for t in tensors)
        mixed_data = np.zeros(max_len, dtype=np.float32)
        
        # Check if any input is stereo
        is_stereo = any(t.ndim == 2 for t in tensors)
        if is_stereo:
            mixed_data = np.zeros((max_len, 2), dtype=np.float32)
            
        for t in tensors:
            # Pad
            if t.ndim == 2:
                # Stereo
                padded = np.zeros((max_len, 2), dtype=np.float32)
                padded[:len(t)] = t
            else:
                # Mono
                padded = np.zeros(max_len, dtype=np.float32)
                padded[:len(t)] = t
                if is_stereo:
                    # Duplicate to stereo
                    padded = np.stack([padded, padded], axis=1)
            mixed_data += padded
            
        # Prevent clipping by normalizing
        max_val = np.max(np.abs(mixed_data))
        if max_val > 32767.0:
            mixed_data = (mixed_data / max_val) * 32767.0
            
        mixed_int = mixed_data.astype(np.int16)
        wavfile.write(str(output_path), rate, mixed_int)

    def _process_task(self, job_id: str, piano_tracks: List[int], speaker_tracks: List[int], pedal_preset: str, rhythm_factor: float, melody_factor: float, vocal_male_tracks: List[int] = None, vocal_female_tracks: List[int] = None):
        try:
            vocal_male_tracks = vocal_male_tracks or []
            vocal_female_tracks = vocal_female_tracks or []
            
            job_dir = self.jobs_dir / job_id
            job_dir.mkdir(parents=True, exist_ok=True)
            
            original_midi = job_dir / "original.mid"
            src_midi = self.uploads_dir / f"{job_id}.mid"
            
            if src_midi.exists():
                # First run: copy uploaded file to original.mid
                shutil.copy(src_midi, original_midi)
            elif not original_midi.exists():
                raise FileNotFoundError("Original MIDI file not found.")
                
            pm = pretty_midi.PrettyMIDI(str(original_midi))
            
            # Find global min_start time across all chosen tracks (to shift silence together)
            all_selected_tracks = list(set(piano_tracks + speaker_tracks + vocal_male_tracks + vocal_female_tracks))
            all_selected_insts = [pm.instruments[i] for i in all_selected_tracks if i < len(pm.instruments)]
            min_start = None
            for inst in all_selected_insts:
                for note in inst.notes:
                    if min_start is None or note.start < min_start:
                        min_start = note.start
            
            time_shift = min_start if (min_start is not None and min_start > 0.0) else 0.0
            
            self.status[job_id]["progress"] = 30
            self._save_db()
            
            # --- 1. Process Piano Track ---
            piano_out_path = job_dir / "piano.mid"
            piano_notes = []
            for idx in piano_tracks:
                if idx < len(pm.instruments):
                    for n in pm.instruments[idx].notes:
                        # Shift time
                        n.start = max(0.0, n.start - time_shift)
                        n.end = max(0.0, n.end - time_shift)
                        piano_notes.append(n)
            
            if piano_notes:
                piano_master = pretty_midi.Instrument(program=0, name="Piano", is_drum=False)
                piano_master.notes = piano_notes
                
                # Apply Ostinato scaling
                rhythm_ids = identify_rhythm_notes(piano_master.notes)
                for note in piano_master.notes:
                    if id(note) in rhythm_ids:
                        note.velocity = int(note.velocity * rhythm_factor)
                    else:
                        note.velocity = int(note.velocity * melody_factor)
                    # Safe Disklavier range
                    note.velocity = max(18, min(90, note.velocity))
                
                # Generate Syncopated Pedal CC64
                config = PEDAL_PRESETS.get(pedal_preset, PEDAL_PRESETS["light"])
                cc64 = generate_cc64_dkc55(piano_master.notes, config)
                piano_master.control_changes = cc64
                
                # Write piano MIDI
                piano_pm = pretty_midi.PrettyMIDI()
                piano_pm.instruments.append(piano_master)
                piano_pm.write(str(piano_out_path))
            
            self.status[job_id]["progress"] = 50
            self._save_db()
            
            # --- 2. Process Backing Instruments Track (exclude vocal tracks to avoid doubling) ---
            backing_out_path = job_dir / "backing_insts.mid"
            backing_pm = pretty_midi.PrettyMIDI()
            
            non_vocal_speakers = [idx for idx in speaker_tracks if idx not in vocal_male_tracks and idx not in vocal_female_tracks]
            
            for idx in non_vocal_speakers:
                if idx < len(pm.instruments):
                    orig_inst = pm.instruments[idx]
                    new_inst = pretty_midi.Instrument(program=orig_inst.program, name=orig_inst.name, is_drum=orig_inst.is_drum)
                    for n in orig_inst.notes:
                        # Shift time
                        n.start = max(0.0, n.start - time_shift)
                        n.end = max(0.0, n.end - time_shift)
                        new_inst.notes.append(n)
                    for cc in orig_inst.control_changes:
                        # Shift CC events
                        cc.time = max(0.0, cc.time - time_shift)
                        new_inst.control_changes.append(cc)
                    backing_pm.instruments.append(new_inst)
            
            backing_insts_wav_path = job_dir / "backing_insts.wav"
            
            if backing_pm.instruments:
                backing_pm.write(str(backing_out_path))
                
                # Render instruments using SoundFont
                utils.render_midi_to_wav_with_soundfont(
                    str(backing_out_path), 
                    str(self.soundfont_path), 
                    str(backing_insts_wav_path)
                )
                
                # Clean up intermediate midi
                if backing_out_path.exists():
                    backing_out_path.unlink()
            
            self.status[job_id]["progress"] = 70
            self.status[job_id]["status"] = "synthesizing"
            self._save_db()
            
            # --- 3. Render Vocal Tracks via RVC ---
            male_wav_path = self._process_rvc_vocals(job_dir, pm, vocal_male_tracks, "male", time_shift)
            female_wav_path = self._process_rvc_vocals(job_dir, pm, vocal_female_tracks, "female", time_shift)
            
            # --- 4. Mix backing tracks together ---
            self.status[job_id]["progress"] = 90
            self._save_db()
            
            final_backing_wav_path = job_dir / "backing.wav"
            mix_list = []
            if backing_insts_wav_path.exists():
                mix_list.append(backing_insts_wav_path)
            if male_wav_path and male_wav_path.exists():
                mix_list.append(male_wav_path)
            if female_wav_path and female_wav_path.exists():
                mix_list.append(female_wav_path)
                
            if mix_list:
                self._mix_wav_files(mix_list, final_backing_wav_path)
                # Clean up intermediate wav files
                for wav_p in mix_list:
                    # Do not delete the final target path if it's the only one
                    if wav_p != final_backing_wav_path and wav_p.exists():
                        wav_p.unlink()
            
            # Complete Job status
            self.status[job_id].update({
                "status": "completed",
                "progress": 100,
                "vocals": str(final_backing_wav_path) if final_backing_wav_path.exists() else None,
                "midi": str(piano_out_path) if piano_out_path.exists() else None
            })
            self._save_db()
            print(f"MIDI Orchestrator: Completed processing with vocals for job {job_id}")
            
            # Clean up the original upload file in upload folder to save space
            if src_midi.exists():
                src_midi.unlink()
                
        except Exception as e:
            print(f"Error in MIDI processing task: {e}")
            self.status[job_id].update({
                "status": "failed",
                "error": str(e),
                "progress": 100
            })
            self._save_db()

    def list_jobs(self) -> List[Dict]:
        return sorted(list(self.status.values()), key=lambda x: x.get("timestamp", 0), reverse=True)

    def delete_job(self, job_id: str) -> bool:
        if job_id not in self.status:
            return False
            
        del self.status[job_id]
        self._save_db()
        
        job_dir = self.jobs_dir / job_id
        if job_dir.exists():
            shutil.rmtree(job_dir)
            
        # Also check uploads folder just in case
        stale_upload = self.uploads_dir / f"{job_id}.mid"
        if stale_upload.exists():
            stale_upload.unlink()
            
        print(f"Deleted MIDI Orchestrate Job {job_id} and its files.")
        return True

    def cleanup_stale_data_and_jobs(self):
        """Clean up stale files and reset hung jobs on startup."""
        # Clean uploads dir
        if self.uploads_dir.exists():
            for f in self.uploads_dir.iterdir():
                try: f.unlink()
                except: pass
                
        # Reset hung jobs
        updated = False
        for job_id, job in list(self.status.items()):
            if job.get("status") in ["processing", "synthesizing"]:
                job["status"] = "failed"
                job["error"] = "Process interrupted by server restart."
                updated = True
                
        # Clean orphaned job dirs
        if self.jobs_dir.exists():
            for d in self.jobs_dir.iterdir():
                if d.is_dir() and d.name not in self.status:
                    try: shutil.rmtree(d)
                    except: pass
                    
        if updated:
            self._save_db()
