import os
import torch
import librosa
import json
import soundfile as sf
import numpy as np
import pretty_midi
import scipy.signal as signal
from pathlib import Path
from demucs.api import Separator, save_audio
from piano_transcription_inference import PianoTranscription, sample_rate
import threading
import time
from typing import Dict, Optional, List

class AudioProcessor:
    def __init__(self, storage_dir: Path, device: str = "cuda" if torch.cuda.is_available() else "cpu"):
        self.storage_dir = storage_dir
        self.uploads_dir = storage_dir / "mp3_uploads"
        self.separated_dir = storage_dir / "separated"
        self.db_path = storage_dir / "mp3_jobs.json"
        
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.separated_dir.mkdir(parents=True, exist_ok=True)
        
        self.device = device
        self.status: Dict[str, Dict] = self._load_db()
        
        # Initialize ML models lazily to save memory on startup
        self._demucs_separator: Optional[Separator] = None
        self._piano_transcriptor: Optional[PianoTranscription] = None

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
            print(f"Error saving jobs DB: {e}")

    def _get_demucs(self) -> Separator:
        if self._demucs_separator is None:
            print(f"Loading Demucs 6-Stem Pro Model on {self.device}...")
            # Using htdemucs_6s to get isolated Piano and Guitar stems
            self._demucs_separator = Separator(model="htdemucs_6s", device=self.device)
        return self._demucs_separator

    def _get_transcriptor(self) -> PianoTranscription:
        if self._piano_transcriptor is None:
            print(f"Loading Piano Transcription on {self.device}...")
            self._piano_transcriptor = PianoTranscription(device=self.device, checkpoint_path=None)
        return self._piano_transcriptor

    def start_processing(self, job_id: str, mp3_path: Path, original_name: str, route_mode: str = "piano", engine: str = "bytedance", engine_sensitivity: float = 1.0, include_other: bool = False):
        self.status[job_id] = {
            "job_id": job_id,
            "status": "queued", 
            "progress": 0, 
            "original_name": original_name,
            "timestamp": os.path.getmtime(str(mp3_path)),
            "route_mode": route_mode,
            "engine": engine,
            "engine_sensitivity": engine_sensitivity,
            "include_other": include_other,
            "rhythm_factor": 1.0,
            "melody_factor": 1.0,
            "pedal_preset": "light",
            "comments": ""
        }
        self._save_db()
        thread = threading.Thread(target=self._process_task, args=(job_id, mp3_path, route_mode, engine, engine_sensitivity, include_other))
        thread.daemon = True
        thread.start()

    def _process_task(self, job_id: str, mp3_path: Path, route_mode: str, engine: str, engine_sensitivity: float, include_other: bool):
        try:
            job_dir = self.separated_dir / job_id
            job_dir.mkdir(parents=True, exist_ok=True)
            
            # Phase 1: Separation
            self.status[job_id]["status"] = "separating"
            self.status[job_id]["progress"] = 10
            self._save_db()
            
            separator = self._get_demucs()
            
            # Load with librosa to bypass the common ID3/AlbumArt bug
            wav, _ = librosa.load(str(mp3_path), sr=separator.samplerate, mono=False)
            
            # Robust Trimming
            try:
                wav_mono = librosa.to_mono(wav) if wav.ndim > 1 else wav
                _, index = librosa.effects.trim(wav_mono, top_db=60)
                start_sample, end_sample = index
                trimmed_seconds = start_sample / separator.samplerate
                if 0.1 < trimmed_seconds < (len(wav_mono) / separator.samplerate) - 1.0:
                    print(f"DEBUG: Detected {trimmed_seconds:.2f}s of leading silence. Trimming...")
                    wav = wav[:, start_sample:end_sample] if wav.ndim > 1 else wav[start_sample:end_sample]
            except Exception as trim_e:
                print(f"Warning: Silence trimming failed (skipping): {trim_e}")
            
            if wav.ndim == 1:
                wav = np.stack([wav, wav])
            
            mix_tensor = torch.from_numpy(wav).to(self.device)
            origin, separated = separator.separate_tensor(mix_tensor)
            
            vocals_path = job_dir / "vocals.wav"
            instrumental_path = job_dir / "instrumental.wav"
            
            # Routing Logic based on user selection (Updated for 6-Stem)
            # Stems: vocals, drums, bass, guitar, piano, other
            if route_mode == "full_band":
                if include_other:
                    # User wants 'Other' (Strings/Synths) on BOTH piano (MIDI) and speakers (WAV)
                    vocal_mix = separated["vocals"] + separated["drums"] + separated["bass"] + separated["guitar"] + separated["other"]
                    inst_mix = separated["piano"] + separated["other"]
                else:
                    # Strict isolation: Everything else to Speakers, Piano to MIDI
                    vocal_mix = separated["vocals"] + separated["drums"] + separated["bass"] + separated["guitar"] + separated["other"]
                    inst_mix = separated["piano"]
            elif route_mode == "speakers":
                # Virtual Band: Rhythm section to Speakers, Harmonic section (Piano/Strings/Guitar) to MIDI
                vocal_mix = separated["vocals"] + separated["drums"] + separated["bass"]
                inst_mix = separated["piano"] + separated["guitar"] + separated["other"]
            else:
                # Traditional: Only Vocals to Speakers, EVERYTHING else to MIDI
                vocal_mix = separated["vocals"]
                inst_mix = separated["drums"] + separated["bass"] + separated["guitar"] + separated["piano"] + separated["other"]

            # Create 4-second Sync Preamble
            preamble_seconds = 4.0
            preamble_samples = int(preamble_seconds * separator.samplerate)
            channels = vocal_mix.shape[0]
            
            vocal_preamble = torch.zeros((channels, preamble_samples)).to(self.device)
            beep_tensor = torch.from_numpy(0.5 * np.sin(2 * np.pi * 1000 * np.linspace(0, 0.1, int(0.1 * separator.samplerate), endpoint=False))).to(self.device)
            for i in range(4):
                start_idx = int(i * separator.samplerate)
                vocal_preamble[:, start_idx : start_idx + len(beep_tensor)] = beep_tensor
            
            inst_preamble = torch.zeros((channels, preamble_samples)).to(self.device)
            
            # Concat and move to CPU for saving
            vocal_tensor = torch.cat([vocal_preamble, vocal_mix], dim=1).cpu()
            instrumental_tensor = torch.cat([inst_preamble, inst_mix], dim=1).cpu()
            
            # Save files
            save_audio(vocal_tensor, vocals_path, samplerate=separator.samplerate)
            try:
                # Re-save with soundfile to ensure standard headers for phone playback
                v_data, v_sr = librosa.load(str(vocals_path), sr=None, mono=False)
                sf.write(str(vocals_path), v_data.T, v_sr, subtype='PCM_16')
            except Exception as e:
                print(f"Warning: Vocal re-save fix failed: {e}")

            save_audio(instrumental_tensor, instrumental_path, samplerate=separator.samplerate)
            try:
                # Also fix the header for the instrumental file
                i_data, i_sr = librosa.load(str(instrumental_path), sr=None, mono=False)
                sf.write(str(instrumental_path), i_data.T, i_sr, subtype='PCM_16')
            except Exception as e:
                print(f"Warning: Instrumental re-save fix failed: {e}")
            
            # Phase 2: Transcription
            self.status[job_id]["status"] = "transcribing"
            self.status[job_id]["progress"] = 50
            self._save_db()
            
            # CRITICAL FIX: Prepare the transcription input.
            # We now use the explicitly routed inst_mix (which may or may not include 'other').
            inst_np = inst_mix.cpu().numpy()
            if inst_np.ndim > 1:
                inst_np = np.mean(inst_np, axis=0) # Convert to mono for AI
            
            audio_16k = librosa.resample(inst_np, orig_sr=separator.samplerate, target_sr=sample_rate)
            
            midi_orig_path = job_dir / "piano_original.mid"
            
            if engine == "basic_pitch":
                print(f"Using Spotify Basic Pitch on {self.device} (Sensitivity: {engine_sensitivity})...")
                from basic_pitch.inference import predict
                
                # Map sensitivity (0.5 to 2.0) to thresholds
                # Higher sensitivity = Lower thresholds (easier to trigger notes)
                onset_thresh = max(0.1, min(0.9, 0.5 - (engine_sensitivity - 1.0) * 0.15))
                frame_thresh = max(0.1, min(0.9, 0.3 - (engine_sensitivity - 1.0) * 0.1))
                
                # Basic Pitch inference works best via a temporary file to avoid array-string conversion bugs
                temp_wav = job_dir / f"transcribe_16k_{job_id}.wav"
                try:
                    sf.write(str(temp_wav), audio_16k, sample_rate)
                    # Basic Pitch returns model_output, midi_data (PrettyMIDI), note_events
                    _, pm_bp, _ = predict(
                        str(temp_wav), 
                        onset_threshold=onset_thresh, 
                        frame_threshold=frame_thresh,
                        minimum_note_length=58
                    )
                    pm_bp.write(str(midi_orig_path))
                finally:
                    if temp_wav.exists():
                        temp_wav.unlink()
            else:
                # Default: Bytedance Piano Transcription
                print(f"Using Bytedance Piano-Focused engine on {self.device} (Gain: {engine_sensitivity}x)...")
                # Apply sensitivity as volume gain to help trigger internal thresholds
                audio_for_bytedance = np.clip(audio_16k * engine_sensitivity, -1.0, 1.0)
                transcriptor = self._get_transcriptor()
                transcriptor.transcribe(audio_for_bytedance, str(midi_orig_path))
            
            # MIDI Preamble injection & Time Shifting
            try:
                pm = pretty_midi.PrettyMIDI(str(midi_orig_path))
                
                # Shift all transcribed notes forward by 4.0s to match the audio preamble in vocals.wav
                # This compensates for the fact that we transcribed the 'clean' mix starting at 0s.
                for inst in pm.instruments:
                    for note in inst.notes:
                        note.start += 4.0
                        note.end += 4.0
                    for cc in inst.control_changes:
                        cc.time += 4.0
                
                inst = next((i for i in pm.instruments if not i.is_drum), None)
                if not inst:
                    inst = pretty_midi.Instrument(program=0)
                    pm.instruments.append(inst)
                
                # Insert the high-precision sync markers at exactly 0.0s, 1.0s, 2.0s, 3.0s
                for i in range(4):
                    inst.notes.insert(0, pretty_midi.Note(velocity=100, pitch=60, start=i*1.0, end=i*1.0 + 0.2))
                pm.write(str(midi_orig_path))
            except Exception as e:
                print(f"Warning: MIDI Preamble injection/shift failed: {e}")
            
            # Phase 3: Cleaning
            self.status[job_id]["status"] = "cleaning"
            self.status[job_id]["progress"] = 90
            self._save_db()
            self._clean_job_midi(job_id)
            
            self.status[job_id].update({"status": "completed", "progress": 100, "vocals": str(vocals_path), "midi": str(job_dir / "piano.mid")})
            self._save_db()
            print(f"Job {job_id} completed via {route_mode} mode.")
            
        except Exception as e:
            print(f"Error processing job {job_id}: {e}")
            self.status[job_id].update({"status": "failed", "error": str(e)})
            self._save_db()

    def _clean_job_midi(self, job_id: str):
        """Runs the clean_midi script and applies a debounce filter to prevent stuttering."""
        from app import utils
        info = self.status[job_id]
        job_dir = self.separated_dir / job_id
        input_midi = job_dir / "piano_original.mid"
        
        if not input_midi.exists():
            print(f"ERROR: Cannot clean MIDI for {job_id}, original not found at {input_midi}")
            return

        try:
            # Step 1: Debounce the raw MIDI to remove AI-generated 'chatter' or mechanical bounce
            # We apply a micro-debounce (30ms) to BOTH engines.
            # This is small enough to preserve fast trills but large enough to stop stuttering.
            print(f"Applying 30ms Micro-Debounce Filter...")
            pm = pretty_midi.PrettyMIDI(str(input_midi))
            for inst in pm.instruments:
                if inst.is_drum: continue
                inst.notes.sort(key=lambda n: (n.pitch, n.start))
                
                new_notes = []
                if inst.notes:
                    current_note = inst.notes[0]
                    for next_note in inst.notes[1:]:
                        # Check if it's the same pitch and starts within 30ms of the current note's start
                        # OR if it starts within 15ms of the current note's END (gap closure)
                        if next_note.pitch == current_note.pitch and (next_note.start - current_note.start < 0.030 or next_note.start - current_note.end < 0.015):
                            # Merge: keep original start, take furthest end
                            current_note.end = max(current_note.end, next_note.end)
                            current_note.velocity = max(current_note.velocity, next_note.velocity)
                        else:
                            new_notes.append(current_note)
                            current_note = next_note
                    new_notes.append(current_note)
                inst.notes = new_notes
            pm.write(str(input_midi))
            
            # Step 2: Run the standard cleaning script
            cleaned_path_from_script = utils.run_clean(
                str(input_midi), 
                str(job_dir), 
                profile=info.get("pedal_preset", "light"),
                rhythm_factor=info.get("rhythm_factor", 1.0),
                melody_factor=info.get("melody_factor", 1.0)
            )
            
            target_path = job_dir / "piano.mid"
            
            if os.path.exists(cleaned_path_from_script) and str(Path(cleaned_path_from_script).resolve()) != str(target_path.resolve()):
                if target_path.exists():
                    os.remove(target_path)
                os.rename(cleaned_path_from_script, target_path)
                
            print(f"Successfully debounced and re-cleaned MIDI for job {job_id}")
        except Exception as e:
            print(f"ERROR during MIDI re-cleaning for {job_id}: {e}")
            raise e

    def update_settings(self, job_id: str, updates: Dict):
        if job_id not in self.status:
            return False
        
        # Update metadata
        self.status[job_id].update(updates)
        self._save_db()
        
        # If it's completed, we must re-clean the MIDI
        if self.status[job_id]["status"] == "completed":
            self._clean_job_midi(job_id)
        
        return True

    def get_status(self, job_id: str) -> Dict:
        return self.status.get(job_id, {"status": "not_found"})

    def list_jobs(self) -> List[Dict]:
        jobs = []
        for job_id, info in self.status.items():
            jobs.append({
                "job_id": job_id,
                **info
            })
        # Sort by timestamp newest first
        return sorted(jobs, key=lambda x: x.get("timestamp", 0), reverse=True)

    def delete_job(self, job_id: str) -> bool:
        if job_id not in self.status:
            return False
        
        # 1. Remove from database
        del self.status[job_id]
        self._save_db()
        
        # 2. Delete files
        job_dir = self.separated_dir / job_id
        if job_dir.exists():
            import shutil
            shutil.rmtree(job_dir)
            
        print(f"Deleted job {job_id} and its files.")
        return True

    def merge_jobs(self, midi_job_id: str, audio_job_id: str) -> str:
        """
        Creates a new hybrid job by combining the MIDI from midi_job_id
        with the audio (vocals.wav) from audio_job_id.
        """
        import uuid
        import shutil
        
        if midi_job_id not in self.status or audio_job_id not in self.status:
            raise ValueError("One or both jobs not found in database.")
            
        midi_info = self.status[midi_job_id]
        audio_info = self.status[audio_job_id]
        
        new_job_id = f"hybrid-{str(uuid.uuid4())[:8]}"
        job_dir = self.separated_dir / new_job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        
        # 1. Copy MIDI from MIDI Job
        midi_src_dir = self.separated_dir / midi_job_id
        # Try original first, fallback to cleaned
        midi_files_to_try = ["piano_original.mid", "piano.mid"]
        midi_found = False
        for mf in midi_files_to_try:
            src_p = midi_src_dir / mf
            if src_p.exists():
                shutil.copy(src_p, job_dir / "piano_original.mid")
                shutil.copy(src_p, job_dir / "piano.mid") # Seed cleaned with original
                midi_found = True
                break
        
        if not midi_found:
            raise ValueError(f"No MIDI file found in source job {midi_job_id}")

        # 2. Copy Audio from Audio Job
        audio_src_dir = self.separated_dir / audio_job_id
        if not (audio_src_dir / "vocals.wav").exists():
            raise ValueError(f"No audio (vocals.wav) found in source job {audio_job_id}")
            
        shutil.copy(audio_src_dir / "vocals.wav", job_dir / "vocals.wav")
        
        # Copy instrumental if it exists
        if (audio_src_dir / "instrumental.wav").exists():
            shutil.copy(audio_src_dir / "instrumental.wav", job_dir / "instrumental.wav")
            
        # 3. Create Status Entry
        self.status[new_job_id] = {
            "job_id": new_job_id,
            "status": "completed",
            "progress": 100,
            "original_name": f"{midi_info['original_name']} (Hybrid)",
            "timestamp": time.time(),
            "route_mode": "hybrid",
            "engine": midi_info.get("engine", "bytedance"),
            "audio_source_job": audio_job_id,
            "midi_source_job": midi_job_id,
            "vocals": str(job_dir / "vocals.wav"),
            "midi": str(job_dir / "piano.mid"),
            "rhythm_factor": midi_info.get("rhythm_factor", 1.0),
            "melody_factor": midi_info.get("melody_factor", 1.0),
            "pedal_preset": midi_info.get("pedal_preset", "light"),
            "comments": f"MIDI from {midi_info['original_name']}, Audio from {audio_info['original_name']}"
        }
        self._save_db()
        print(f"Created Hybrid Job: {new_job_id}")
        return new_job_id

    def calculate_acoustic_offset(self, recording_path: Path) -> float:
        """
        Analyzes a recording of the 4-second preamble to find latency.
        Returns the offset in milliseconds (BeepTime - PianoTime).
        Positive = Speaker is slower than piano (standard for BT).
        """
        try:
            # Load recording
            y, sr = librosa.load(str(recording_path), sr=None)
            
            # 1. Detect 1000Hz Beeps (Bluetooth Speakers)
            nyq = 0.5 * sr
            low = 950 / nyq
            high = 1050 / nyq
            b, a = signal.butter(4, [low, high], btype='band')
            y_beeps = signal.filtfilt(b, a, y)
            
            # Use onset detection on the beep frequency
            beep_onsets = librosa.onset.onset_detect(y=y_beeps, sr=sr, units='time', backtrack=True, wait=int(sr*0.5))
            if len(beep_onsets) == 0:
                # Fallback to energy threshold
                beep_env = np.abs(y_beeps)
                beep_threshold = np.max(beep_env) * 0.3
                indices = np.where(beep_env > beep_threshold)[0]
                if len(indices) == 0:
                    raise ValueError("No beeps detected. Increase speaker volume.")
                t_beep = indices[0] / sr
            else:
                t_beep = beep_onsets[0]

            # 2. Detect Piano Strikes (C4 ~261.6Hz)
            low_piano = 150 / nyq
            high_piano = 400 / nyq
            b_p, a_p = signal.butter(4, [low_piano, high_piano], btype='band')
            y_piano = signal.filtfilt(b_p, a_p, y)
            
            piano_onsets = librosa.onset.onset_detect(y=y_piano, sr=sr, units='time', backtrack=True, wait=int(sr*0.5))
            if len(piano_onsets) == 0:
                piano_env = np.abs(y_piano)
                piano_threshold = np.max(piano_env) * 0.3
                indices = np.where(piano_env > piano_threshold)[0]
                if len(indices) == 0:
                    raise ValueError("No piano notes detected. Ensure Disklavier volume is high.")
                t_piano = indices[0] / sr
            else:
                t_piano = piano_onsets[0]

            # 3. Handle "Skipped Beat" Error
            # Bluetooth lag is usually 100-400ms. If we find 1000ms+, it means
            # we missed the first beat of one device but caught the first of the other.
            raw_delta = (t_beep - t_piano) * 1000.0
            
            # Normalize to [-500, 500] range using modulo math.
            # This finds the closest alignment within a 1-second window.
            normalized_delta = ((raw_delta + 500) % 1000) - 500
            
            print(f"Acoustic Sync Analysis:")
            print(f"  - Speaker pulse detected at: {t_beep:.3f}s")
            print(f"  - Piano pulse detected at:   {t_piano:.3f}s")
            print(f"  - Raw Delta:                {raw_delta:.1f}ms")
            print(f"  - Corrected BT Lag:         {normalized_delta:.1f}ms")
            
            return round(normalized_delta, 1)

        except Exception as e:
            print(f"Acoustic analysis failed: {e}")
            raise e

    def align_external_midi(self, job_id: str, external_midi_path: Path):
        """
        Uses Dynamic Time Warping (DTW) to align a high-quality MIDI file
        to the AUDIO spectral energy and vocal rhythm.
        """
        if job_id not in self.status:
            raise ValueError("Job not found")
            
        job_dir = self.separated_dir / job_id
        vocals_wav_path = job_dir / "vocals.wav"
        
        if not vocals_wav_path.exists():
            raise ValueError("Vocal anchor audio not found for this job")

        try:
            print(f"Starting High-Res Rhythmic Alignment for job {job_id}...")
            # 1. Load Reference Audio
            fs = 50 # 20ms resolution for snappy vocal sync
            y_voc, sr_voc = librosa.load(str(vocals_wav_path), sr=None)
            
            # Feature A: Harmonic (Chroma)
            hop = int(sr_voc / fs)
            chroma_ref = librosa.feature.chroma_cqt(y=y_voc, sr=sr_voc, hop_length=hop)
            
            # Feature B: Rhythmic (Onset Strength)
            # This captures the "hits" of the singer's voice
            onset_ref = librosa.onset.onset_strength(y=y_voc, sr=sr_voc, hop_length=hop)
            onset_ref = onset_ref.reshape(1, -1) # Make it (1, Frames)
            
            # Combine into a 13-dimensional feature set [Chroma(12), Onset(1)]
            feat_ref = np.vstack([chroma_ref, onset_ref])
            
            # 2. Load Target MIDI and Extract Corresponding Features
            pm_target = pretty_midi.PrettyMIDI(str(external_midi_path))
            
            chroma_target = pm_target.get_chroma(fs=fs)
            
            # Compute MIDI Onset Strength (Velocity changes over time)
            # We create a simple envelope from the piano roll energy
            pr = pm_target.get_piano_roll(fs=fs)
            onset_target = np.diff(np.sum(pr, axis=0), prepend=0)
            onset_target = np.maximum(0, onset_target).reshape(1, -1)
            
            feat_target = np.vstack([chroma_target, onset_target])
            
            # 3. Normalize features
            # Weights: give slightly more weight to onsets (rhythm) for snappiness
            feat_ref[:12, :] *= 0.8
            feat_ref[12, :] *= 1.2
            feat_target[:12, :] *= 0.8
            feat_target[12, :] *= 1.2
            
            feat_ref = (feat_ref + 1e-6) / (np.linalg.norm(feat_ref, axis=0) + 1e-6)
            feat_target = (feat_target + 1e-6) / (np.linalg.norm(feat_target, axis=0) + 1e-6)
            
            # 4. Compute DTW alignment path
            # Subsequence DTW with custom step sizes to allow for more flexibility in tempo
            D, wp = librosa.sequence.dtw(X=feat_target, Y=feat_ref, metric='cosine', 
                                         step_sizes_sigma=np.array([[1, 1], [1, 2], [2, 1]]))
            wp = wp[::-1]
            
            # 5. Map the times
            target_times = wp[:, 0] / float(fs)
            ref_times = wp[:, 1] / float(fs)
            
            # Strictly increasing mask
            keep = np.where(np.diff(target_times, prepend=-1) > 0)[0]
            target_times = target_times[keep]
            ref_times = ref_times[keep]

            print(f"Alignment: Warping human MIDI using {len(ref_times)} high-res rhythm anchors.")

            # 6. Create the Hybrid MIDI
            pm_hybrid = pretty_midi.PrettyMIDI(initial_tempo=120.0)
            
            for instrument in pm_target.instruments:
                if instrument.is_drum: continue
                new_inst = pretty_midi.Instrument(program=instrument.program, name=instrument.name)
                
                # Warp notes manually
                for note in instrument.notes:
                    new_start = np.interp(note.start, target_times, ref_times)
                    new_end = np.interp(note.end, target_times, ref_times)
                    if new_end > new_start:
                        new_inst.notes.append(pretty_midi.Note(
                            velocity=note.velocity, pitch=note.pitch,
                            start=new_start, end=new_end
                        ))
                
                # Warp control changes
                for cc in instrument.control_changes:
                    new_time = np.interp(cc.time, target_times, ref_times)
                    new_inst.control_changes.append(pretty_midi.ControlChange(
                        number=cc.number, value=cc.value, time=new_time
                    ))
                pm_hybrid.instruments.append(new_inst)

            # 7. Re-Inject Sync Preamble
            inst = next((i for i in pm_hybrid.instruments if not i.is_drum), None)
            if not inst:
                inst = pretty_midi.Instrument(program=0)
                pm_hybrid.instruments.append(inst)
            
            inst.notes = [n for n in inst.notes if n.start >= 4.0]
            for i in range(4):
                inst.notes.insert(0, pretty_midi.Note(velocity=100, pitch=60, start=i*1.0, end=i*1.0 + 0.2))
            
            # 8. Save and Re-Clean
            pm_hybrid.write(str(job_dir / "piano_original.mid"))
            self._clean_job_midi(job_id)
            
            print(f"High-Res Rhythmic Alignment complete for job {job_id}")
            
        except Exception as e:
            print(f"Rhythmic DTW failed for job {job_id}: {e}")
            import traceback; traceback.print_exc()
            raise e
