import sys
import os
import json
import uuid
import time
import shutil
import threading
import subprocess
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

def is_garbled_or_generic_name(name: str) -> bool:
    if not name or not name.strip():
        return True
    s = name.strip()
    s_lower = s.lower()
    if s_lower.startswith("track") or s_lower.startswith("channel") or s_lower in ["untitled", "midi", "no name", "unknown", "track"]:
        return True
    if "\ufffd" in s or "\\x" in s or "\\u" in s:
        return True
    ascii_count = sum(1 for c in s if 32 <= ord(c) <= 126)
    if len(s) > 0 and (ascii_count / len(s)) < 0.6:
        return True
    return False

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
        
        self.status: Dict[str, Dict] = self._load_db()
        self.rvc = None
        self.rvc_models_dir = storage_dir / "rvc_models"

    @property
    def soundfont_path(self) -> Path:
        return Path(utils.get_active_soundfont_path())

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
        
        # Immediately preserve original master MIDI in job directory
        job_dir = self.jobs_dir / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy(dest, job_dir / "original.mid")
        
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
                raw_name = inst.name.strip()
                inst_name = get_instrument_name(int(inst.program))
                if inst.is_drum:
                    inst_name = "Drums / Percussion"
                    
                if is_garbled_or_generic_name(raw_name):
                    display_name = f"{inst_name} (Track {i+1})"
                else:
                    display_name = f"{raw_name} [{inst_name}]" if inst_name.lower() not in raw_name.lower() else raw_name
                    
                tracks.append({
                    "index": int(i),
                    "name": raw_name or f"Track {i+1}",
                    "display_name": display_name,
                    "program": int(inst.program),
                    "instrument_name": inst_name,
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
                midi_path = self.jobs_dir / job_id / "piano.mid"
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

    def start_processing(
        self, 
        job_id: str, 
        piano_tracks: List[int], 
        speaker_tracks: List[int], 
        pedal_preset: str = "light", 
        rhythm_factor: float = 1.0, 
        melody_factor: float = 1.0, 
        vocal_male_tracks: List[int] = None, 
        vocal_female_tracks: List[int] = None, 
        imported_vocals: Dict = None,
        soundfont: str = None,
        reverb_enabled: bool = None,
        reverb_room_size: float = None,
        peak_ceiling_db: float = None,
        tracks_config: Dict = None
    ):
        if job_id not in self.status:
            raise ValueError("Job not found.")
            
        vocal_male_tracks = vocal_male_tracks or []
        vocal_female_tracks = vocal_female_tracks or []

        # Resolve defaults if not provided
        settings = utils.load_settings()
        if not soundfont:
            active_sf_path = utils.get_active_soundfont_path()
            soundfont = os.path.basename(active_sf_path)
        if reverb_enabled is None:
            reverb_enabled = bool(settings.get("reverb_enabled", True))
        if reverb_room_size is None:
            reverb_room_size = float(settings.get("reverb_room_size", 0.55))
        if peak_ceiling_db is None:
            peak_ceiling_db = float(settings.get("peak_ceiling_db", -6.0))
            
        existing_tracks_config = self.status[job_id].get("tracks_config", {})
        merged_tracks_config = {**existing_tracks_config, **(tracks_config or {})}
            
        self.status[job_id].update({
            "status": "processing",
            "progress": 10,
            "piano_tracks": piano_tracks,
            "speaker_tracks": speaker_tracks,
            "vocal_male_tracks": vocal_male_tracks,
            "vocal_female_tracks": vocal_female_tracks,
            "pedal_preset": pedal_preset,
            "rhythm_factor": rhythm_factor,
            "melody_factor": melody_factor,
            "imported_vocals": imported_vocals,
            "soundfont": soundfont,
            "reverb_enabled": reverb_enabled,
            "reverb_room_size": reverb_room_size,
            "peak_ceiling_db": peak_ceiling_db,
            "tracks_config": merged_tracks_config
        })
        self._save_db()
        
        # Launch worker in a separate OS subprocess for 100% memory isolation
        cmd = [
            sys.executable,
            "-m", "app.render_worker",
            "--job-id", job_id,
            "--storage-dir", str(self.base_dir.parent)
        ]
        print(f"Spawning isolated render_worker subprocess for job {job_id}: {' '.join(cmd)}")
        proc = subprocess.Popen(cmd, cwd=str(Path(__file__).resolve().parent.parent))
        if not hasattr(self, "active_processes"):
            self.active_processes = {}
        self.active_processes[job_id] = proc

    def cancel_job(self, job_id: str) -> bool:
        """Cancel an active synthesis job by killing its worker process."""
        if hasattr(self, "active_processes") and job_id in self.active_processes:
            proc = self.active_processes.get(job_id)
            if proc:
                try:
                    proc.kill()
                    print(f"Terminated active worker process PID {proc.pid} for job {job_id}")
                except Exception as e:
                    print(f"Error terminating worker process for job {job_id}: {e}")
                del self.active_processes[job_id]
            
        if job_id in self.status:
            self.status[job_id].update({
                "status": "cancelled",
                "error": "Synthesis job cancelled by user.",
                "progress": 100
            })
            self._save_db()
            return True
        return False

    def _apply_vocal_expression(self, inst: pretty_midi.Instrument):
        import math
        notes = sorted(inst.notes, key=lambda n: n.start)
        if not notes:
            return
            
        pitch_bends = []
        
        # 1. Apply Portamento (glides) between consecutive notes
        for i in range(1, len(notes)):
            prev_n = notes[i-1]
            curr_n = notes[i]
            
            # If notes are close in time (less than 150ms gap) and close in pitch (<= 6 semitones)
            if 0 < (curr_n.start - prev_n.end) < 0.15 and abs(curr_n.pitch - prev_n.pitch) <= 6:
                diff = curr_n.pitch - prev_n.pitch
                if diff != 0:
                    glide_dur = 0.12 # 120ms slide
                    steps = 6
                    # Slide starts at curr_n.start and goes to curr_n.start + glide_dur
                    for s in range(steps + 1):
                        t = curr_n.start + (s / steps) * glide_dur
                        # Ramping from -diff * 4096 to 0
                        frac = s / steps
                        bend_val = int((-diff * 4096) * (1.0 - frac))
                        bend_val = max(-8192, min(8191, bend_val))
                        pitch_bends.append(pretty_midi.PitchBend(pitch=bend_val, time=t))
                        
        # 2. Apply Sinusoidal Vibrato for long held notes
        for n in notes:
            dur = n.end - n.start
            if dur > 0.4:
                vib_start = n.start + 0.25 # starts 250ms into the note
                vib_end = n.end - 0.05
                freq = 5.5 # 5.5 Hz vibrato
                depth_cents = 35 # +/- 35 cents depth
                
                t = vib_start
                while t < vib_end:
                    phase = 2.0 * math.pi * freq * (t - vib_start)
                    # 1 cent is 40.96 units
                    bend_val = int(depth_cents * 40.96 * math.sin(phase))
                    bend_val = max(-8192, min(8191, bend_val))
                    pitch_bends.append(pretty_midi.PitchBend(pitch=bend_val, time=t))
                    t += 0.02 # 20ms steps
                    
                # Reset pitch bend at end of note
                pitch_bends.append(pretty_midi.PitchBend(pitch=0, time=vib_end))
                
        # Sort pitch bends by time and assign
        inst.pitch_bends = sorted(pitch_bends, key=lambda pb: pb.time)

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
                self._apply_vocal_expression(new_inst)
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
                
            # Perform safety validation scan before loading the pickle weights
            if not utils.scan_model_file(str(model_path)):
                raise ValueError(f"Unsafe model weights detected for RVC model {model_name}! Load aborted.")
                
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
            
        # Prevent clipping and apply peak ceiling headroom
        settings = utils.load_settings()
        peak_ceiling_db = float(settings.get("peak_ceiling_db", -6.0))
        target_max = 32767.0 * (10.0 ** (peak_ceiling_db / 20.0))

        max_val = np.max(np.abs(mixed_data))
        if max_val > 0:
            mixed_data = (mixed_data / max_val) * target_max

        mixed_int = np.clip(mixed_data, -32768.0, 32767.0).astype(np.int16)
        wavfile.write(str(output_path), rate, mixed_int)

    def _process_task(self, job_id: str, piano_tracks: List[int], speaker_tracks: List[int], pedal_preset: str, rhythm_factor: float, melody_factor: float, vocal_male_tracks: List[int] = None, vocal_female_tracks: List[int] = None):
        try:
            vocal_male_tracks = vocal_male_tracks or []
            vocal_female_tracks = vocal_female_tracks or []
            
            job_dir = self.jobs_dir / job_id
            job_dir.mkdir(parents=True, exist_ok=True)
            
            original_midi = job_dir / "original.mid"
            src_midi = self.uploads_dir / f"{job_id}.mid"
            
            if original_midi.exists():
                # Re-synthesis run: original.mid is safely preserved in job folder
                pass
            elif src_midi.exists():
                # First run: copy uploaded file to original.mid
                shutil.copy(src_midi, original_midi)
            else:
                raise FileNotFoundError(f"Original MIDI file not found for job {job_id}.")
                
            pm = pretty_midi.PrettyMIDI(str(original_midi))
            
            # Find global min_start time across all chosen tracks (to shift silence together)
            all_selected_tracks = list(set(piano_tracks + speaker_tracks + vocal_male_tracks + vocal_female_tracks))
            all_selected_insts = [pm.instruments[i] for i in all_selected_tracks if i < len(pm.instruments)]
            min_start = None
            for inst in all_selected_insts:
                for note in inst.notes:
                    if min_start is None or note.start < min_start:
                        min_start = note.start
            
            time_shift = 0.0
            
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
            
            if non_vocal_speakers:
                self.status[job_id]["progress"] = 30
                self.status[job_id]["status"] = "synthesizing backing tracks"
                self._save_db()
                
                job_sf_name = job_info.get("soundfont")
                if job_sf_name and (job_sf_name.lower().endswith(".sf2") or "sf2" in job_sf_name.lower()):
                    job_sf_name = None
                job_tracks_cfg = job_info.get("tracks_config", {})
                job_reverb_enabled = job_info.get("reverb_enabled")
                job_reverb_room_size = job_info.get("reverb_room_size")
                job_peak_ceiling_db = job_info.get("peak_ceiling_db")
                
                def _update_progress(pct):
                    if job_id in self.status:
                        self.status[job_id]["progress"] = pct
                        self.status[job_id]["status"] = "synthesizing backing tracks"
                        self._save_db()

                _, actual_sf = utils.render_orchestrator_tracks(
                    pm,
                    non_vocal_speakers,
                    job_sf_name,
                    job_tracks_cfg,
                    str(backing_insts_wav_path),
                    reverb_enabled=job_reverb_enabled,
                    reverb_room_size=job_reverb_room_size,
                    peak_ceiling_db=job_peak_ceiling_db,
                    time_shift=time_shift,
                    progress_callback=_update_progress
                )
                if actual_sf:
                    self.status[job_id]["last_built_soundfont"] = actual_sf
            
            self.status[job_id]["progress"] = 70
            self.status[job_id]["status"] = "mixing audio"
            self._save_db()
            
            # --- 3. Render Vocal Tracks via RVC ---
            male_wav_path = self._process_rvc_vocals(job_dir, pm, vocal_male_tracks, "male", time_shift)
            female_wav_path = self._process_rvc_vocals(job_dir, pm, vocal_female_tracks, "female", time_shift)
            
            # --- 3.5 Process Imported MP3 Vocals if Configured ---
            imported_wav_path = None
            job_status = self.status.get(job_id, {})
            imported_vocals = job_status.get("imported_vocals")
            if imported_vocals and imported_vocals.get("enabled"):
                mp3_job_id = imported_vocals.get("mp3_job_id")
                delay_ms = imported_vocals.get("delay_ms", 0)
                volume_factor = imported_vocals.get("volume_factor", 1.0)
                
                src_vocals_wav = self.storage_dir / "separated" / mp3_job_id / "vocals.wav"
                if src_vocals_wav.exists():
                    imported_wav_path = job_dir / "imported_vocals_aligned.wav"
                    try:
                        import scipy.io.wavfile as wavfile
                        import numpy as np
                        import scipy.signal
                        
                        rate, data = wavfile.read(str(src_vocals_wav))
                        data_float = data.astype(np.float32)
                        
                        # Trim the 4-second beep preamble
                        skip_samples = int(4.0 * rate)
                        if len(data_float) > skip_samples:
                            data_no_beeps = data_float[skip_samples:]
                        else:
                            data_no_beeps = np.zeros((0, data_float.shape[1]) if data_float.ndim == 2 else (0,), dtype=np.float32)
                            
                        # Resample to 44.1k Hz
                        if rate != 44100:
                            num_samples = int(len(data_no_beeps) * 44100 / rate)
                            data_no_beeps = scipy.signal.resample(data_no_beeps, num_samples, axis=0)
                            rate = 44100
                            
                        # Get breaklines
                        breaklines = imported_vocals.get("breaklines", [])
                        sorted_breaks = sorted(breaklines, key=lambda b: b.get("time_ms", 0))
                        
                        N = len(data_no_beeps)
                        
                        # Construct timeline boundaries (T) and segment offsets (S)
                        T = [delay_ms]
                        S = [delay_ms]
                        for b in sorted_breaks:
                            T.append(b.get("time_ms", 0))
                            S.append(b.get("offset_ms", 0))
                        
                        # Add final end time to T
                        T.append(int(N * 1000.0 / rate) + S[-1])
                        
                        # Calculate total output length
                        max_out_idx = max(0, int((T[-1] / 1000.0) * rate))
                        
                        # Initialize aligned_data buffer
                        is_stereo = (data_no_beeps.ndim == 2)
                        if is_stereo:
                            aligned_data = np.zeros((max_out_idx, data_no_beeps.shape[1]), dtype=np.float32)
                        else:
                            aligned_data = np.zeros(max_out_idx, dtype=np.float32)
                            
                        # Mix each segment piecewise
                        for i in range(len(S)):
                            t_start = T[i]
                            t_end = T[i+1]
                            offset = S[i]
                            
                            # Audio boundaries
                            audio_start = max(0, int(((t_start - offset) / 1000.0) * rate))
                            audio_end = max(0, int(((t_end - offset) / 1000.0) * rate))
                            
                            # Target mix indices in output buffer
                            raw_target_start = int((t_start / 1000.0) * rate)
                            
                            # Handle negative starting timeline positions by cropping audio start
                            if raw_target_start < 0:
                                crop_samples = abs(raw_target_start)
                                audio_start += crop_samples
                                target_start = 0
                            else:
                                target_start = raw_target_start
                            
                            # Ensure within bounds of the data array
                            audio_start = min(N, audio_start)
                            audio_end = min(N, audio_end)
                            
                            seg_data = data_no_beeps[audio_start:audio_end]
                            if len(seg_data) > 0 and target_start < max_out_idx:
                                # Ensure we don't write past output buffer
                                write_len = min(len(seg_data), max_out_idx - target_start)
                                if write_len > 0:
                                    if is_stereo:
                                        aligned_data[target_start:target_start + write_len, :] += seg_data[:write_len, :]
                                    else:
                                        aligned_data[target_start:target_start + write_len] += seg_data[:write_len]
                            
                        # Normalize, apply volume factor, clip and convert back to int16
                        max_amp = np.max(np.abs(aligned_data))
                        if max_amp > 0:
                            aligned_data = (aligned_data / max_amp) * 32767.0
                        
                        aligned_data = np.clip(aligned_data * volume_factor, -32768.0, 32767.0)
                        aligned_int16 = aligned_data.astype(np.int16)
                        
                        wavfile.write(str(imported_wav_path), rate, aligned_int16)
                    except Exception as ve:
                        print(f"Error processing imported vocals: {ve}")
                        imported_wav_path = None
            
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
            if imported_wav_path and imported_wav_path.exists():
                mix_list.append(imported_wav_path)
                
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
        self.status = self._load_db()
        jobs = list(self.status.values())
        updated = False
        for job in jobs:
            job_id = job.get("job_id")
            if job_id:
                job_dir = self.jobs_dir / job_id
                job_dir.mkdir(parents=True, exist_ok=True)
                orig = job_dir / "original.mid"
                up = self.uploads_dir / f"{job_id}.mid"
                if not orig.exists() and up.exists():
                    try:
                        shutil.copy(up, orig)
                    except Exception:
                        pass
            if "tracks" in job and isinstance(job["tracks"], list):
                for t in job["tracks"]:
                    if "display_name" not in t or is_garbled_or_generic_name(t.get("name", "")):
                        inst_name = t.get("instrument_name") or get_instrument_name(t.get("program", 0))
                        idx = t.get("index", 0)
                        raw_name = (t.get("name") or "").strip()
                        if is_garbled_or_generic_name(raw_name):
                            t["display_name"] = f"{inst_name} (Track {idx+1})"
                        else:
                            t["display_name"] = f"{raw_name} [{inst_name}]" if inst_name.lower() not in raw_name.lower() else raw_name
                        updated = True
        if updated:
            try:
                self._save_db()
            except Exception:
                pass
        return sorted(jobs, key=lambda x: x.get("timestamp", 0), reverse=True)

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
