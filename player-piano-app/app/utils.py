import runpy
import os
import json
import threading
import shutil
import re
import tempfile
from typing import List
import mido
import time
from threading import Event
from app.ble_midi import BleMidiOutput

ROOT = os.path.dirname(os.path.dirname(__file__))
PROJECT_ROOT = os.path.dirname(ROOT)
PEDAL_JSON = os.path.join(PROJECT_ROOT, 'pedal_profiles.json')
METADATA_JSON = os.path.join(PROJECT_ROOT, 'storage', 'metadata.json')
PLAYBACK_LOG = os.path.join(PROJECT_ROOT, 'storage', 'playback_debug.log')
SOUNDFONT = os.path.join(PROJECT_ROOT, 'storage', 'Salamander.sf2')
# Prefer environment variable for portability
FLUIDSYNTH_BIN = os.environ.get('FLUIDSYNTH_BIN', r'C:\fluidsynth\bin\fluidsynth.exe')
RENDER_CACHE = os.path.join(PROJECT_ROOT, 'storage', 'render_cache')

def render_midi_to_wav(midi_path: str) -> str:
    """Render MIDI to WAV using FluidSynth and the Salamander SoundFont."""
    import subprocess
    
    os.makedirs(RENDER_CACHE, exist_ok=True)
    filename = os.path.basename(midi_path)
    wav_path = os.path.join(RENDER_CACHE, filename + '.wav')
    
    # Check if we already have a fresh render
    if os.path.exists(wav_path):
        if os.path.getmtime(wav_path) > os.path.getmtime(midi_path):
            return wav_path
            
    _log(f"Rendering {filename} to WAV...")
    
    if not os.path.exists(FLUIDSYNTH_BIN):
        _log(f"FluidSynth not found at {FLUIDSYNTH_BIN}")
        raise FileNotFoundError(f"FluidSynth not found at {FLUIDSYNTH_BIN}")
    if not os.path.exists(SOUNDFONT):
        _log(f"SoundFont not found at {SOUNDFONT}")
        raise FileNotFoundError(f"SoundFont not found at {SOUNDFONT}")

    # Use direct subprocess with correct argument order for newer FluidSynth versions
    # Added -g 5.0 for maximum volume boost
    cmd = [
        FLUIDSYNTH_BIN,
        '-ni',
        '-g', '5.0',
        '-F', wav_path,
        '-r', '44100',
        SOUNDFONT,
        midi_path
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            _log(f"FluidSynth error: {result.stderr}")
            raise RuntimeError(f"FluidSynth failed: {result.stderr}")
            
        _log(f"Render complete: {wav_path}")
        return wav_path
    except Exception as e:
        _log(f"Rendering failed for {filename}: {str(e)}")
        raise e


def _log(msg):
    print(f"LOG: {msg}")
    try:
        with open(PLAYBACK_LOG, 'a', encoding='utf-8') as f:
            f.write(f"{time.ctime()} - {msg}\n")
    except Exception:
        pass


def get_all_metadata() -> dict:
    if os.path.exists(METADATA_JSON):
        try:
            with open(METADATA_JSON, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_all_metadata(data: dict):
    os.makedirs(os.path.dirname(METADATA_JSON), exist_ok=True)
    with open(METADATA_JSON, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)


def get_file_metadata(filename: str) -> dict:
    all_meta = get_all_metadata()
    return all_meta.get(filename, {
        'original_name': filename,
        'clean_profile': None,
        'tempo_factor': 1.0,
        'dnu': False,
        'comments': ""
    })


def update_file_metadata(filename: str, updates: dict):
    all_meta = get_all_metadata()
    meta = all_meta.get(filename, {
        'original_name': filename,
        'clean_profile': None,
        'tempo_factor': 1.0,
        'dnu': False,
        'comments': ""
    })
    meta.update(updates)
    all_meta[filename] = meta
    save_all_metadata(all_meta)


def delete_file_metadata(filename: str):
    all_meta = get_all_metadata()
    if filename in all_meta:
        del all_meta[filename]
        save_all_metadata(all_meta)


def _find_script(names):
    """Search tools directory then PROJECT_ROOT for any of the filenames in names."""
    tools_dir = os.path.join(ROOT, 'tools')
    for f in names:
        p = os.path.join(tools_dir, f)
        if os.path.exists(p):
            return p
            
    for root, dirs, files in os.walk(PROJECT_ROOT):
        for f in files:
            if f in names:
                return os.path.join(root, f)
    return None


def run_clean(input_path: str, output_folder: str, profile: str = 'light', rhythm_factor: float = 1.0, melody_factor: float = 1.0) -> str:
    """Run the cleaning script with velocity factors."""
    script = _find_script(['clean_midi.py'])
    if not script:
        raise FileNotFoundError('clean_midi script not found in project')

    # Use sys.executable to ensure we use the same python environment
    import subprocess, sys
    cmd = [
        sys.executable,
        script,
        input_path,
        output_folder,
        str(rhythm_factor),
        str(melody_factor),
        profile
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            _log(f"Cleaning script error: {result.stderr}")
            raise RuntimeError(f"Cleaning script failed: {result.stderr}")
    except Exception as e:
        _log(f"Subprocess exception: {str(e)}")
        raise e

    # Find the produced file
    orig_name = os.path.basename(input_path)
    processed_name = orig_name.replace('_original', '')
    final_path = os.path.join(output_folder, processed_name)
    
    if not os.path.exists(final_path):
        # Fallback: check if the script produced a different filename
        files = [f for f in os.listdir(output_folder) if f.lower().endswith('.mid')]
        if files:
            files.sort(key=lambda f: os.path.getmtime(os.path.join(output_folder, f)), reverse=True)
            shutil.move(os.path.join(output_folder, files[0]), final_path)
        else:
            raise RuntimeError("Cleaning script did not produce a MIDI file")
    
    # Update metadata
    update_file_metadata(processed_name, {
        'clean_profile': profile,
        'rhythm_factor': rhythm_factor,
        'melody_factor': melody_factor,
        'tempo_factor': 1.0
    })
    
    return final_path


def run_tempo(input_path: str, output_path: str, factor: float = 1.0) -> str:
    # Implement tempo scaling directly.
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input file not found: {input_path}")

    try:
        mid = mido.MidiFile(input_path)
    except Exception as e:
        raise RuntimeError(f"Failed to open MIDI: {e}")

    found = False
    for track in mid.tracks:
        for msg in track:
            if getattr(msg, 'is_meta', False) and getattr(msg, 'type', None) == 'set_tempo':
                try:
                    msg.tempo = max(1, int(msg.tempo / factor))
                    found = True
                except Exception:
                    continue

    if not found:
        default_tempo = 500000
        try:
            if hasattr(mido, 'bpm2tempo'):
                default_tempo = mido.bpm2tempo(120)
        except Exception:
            pass
        new_t = max(1, int(default_tempo / factor))
        meta = mido.MetaMessage('set_tempo', tempo=new_t, time=0)
        if mid.tracks:
            mid.tracks[0].insert(0, meta)
        else:
            mt = mido.MidiTrack()
            mt.append(meta)
            mid.tracks.append(mt)

    parent = os.path.dirname(output_path)
    if parent:
        os.makedirs(parent, exist_ok=True)

    try:
        mid.save(output_path)
    except Exception as e:
        raise RuntimeError(f"Failed to save output MIDI: {e}")

    # Update metadata based on the filename (assumed to be the same if we are removing suffixing)
    filename = os.path.basename(output_path)
    # Note: if output_path is different from input_path, we might need to decide which metadata to update.
    # In the new flow, we want them to be the same.
    update_file_metadata(filename, {'tempo_factor': factor})

    return output_path


def list_midi_outputs() -> List[str]:
    try:
        names = mido.get_output_names()
        if _ble_handle and _ble_handle.connected:
            names.append(_ble_handle.name)
        return names
    except Exception:
        return []


MIDI_INFO_CACHE_JSON = os.path.join(PROJECT_ROOT, 'storage', 'midi_info_cache.json')
_midi_info_cache = {}

def _load_info_cache():
    global _midi_info_cache
    if os.path.exists(MIDI_INFO_CACHE_JSON):
        try:
            with open(MIDI_INFO_CACHE_JSON, 'r', encoding='utf-8') as f:
                _midi_info_cache = json.load(f)
        except Exception:
            _midi_info_cache = {}

def _save_info_cache():
    os.makedirs(os.path.dirname(MIDI_INFO_CACHE_JSON), exist_ok=True)
    with open(MIDI_INFO_CACHE_JSON, 'w', encoding='utf-8') as f:
        json.dump(_midi_info_cache, f, indent=2)

_load_info_cache()

def get_midi_info(path: str):
    """Return dict with basic MIDI info: length (seconds), size bytes, and created timestamp. Uses cache."""
    global _midi_info_cache
    
    file_size = os.path.getsize(path)
    file_mtime = os.path.getmtime(path)
    cache_key = f"{path}_{file_size}_{file_mtime}"
    
    if cache_key in _midi_info_cache:
        return _midi_info_cache[cache_key]

    info = {'length': None, 'size': file_size, 'created': file_mtime}
    try:
        mid = mido.MidiFile(path)
        length = getattr(mid, 'length', None)
        if not length:
            length = 0
            for t in mid.tracks:
                ttime = 0
                for msg in t:
                    ttime += getattr(msg, 'time', 0)
                if ttime > length:
                    length = ttime
        info['length'] = float(length)
    except Exception:
        info['length'] = None
    
    _midi_info_cache[cache_key] = info
    if len(_midi_info_cache) % 10 == 0:
        _save_info_cache()
    return info


# Global MIDI output state to avoid opening/closing the port constantly on Windows
_midi_out_handle = None
_midi_out_lock = threading.Lock()
_auto_connect_target = "Yamaha" # Default target for BLE
_ble_handle = None

def set_auto_connect_target(name: str):
    global _auto_connect_target
    _auto_connect_target = name
    if _ble_handle:
        _ble_handle.target_name = name

def _get_out(port_name=None):
    global _midi_out_handle, _ble_handle
    with _midi_out_lock:
        # Priority 1: Requested BLE port or current active BLE
        if _ble_handle and _ble_handle.connected:
            # Match if no name requested, or if name matches exactly, or with 'BLE:' prefix
            if not port_name or port_name == _ble_handle.name or port_name == f"BLE:{_ble_handle.name}":
                return _ble_handle

        # Priority 2: Standard MIDI port
        if _midi_out_handle is not None:
            if port_name and _midi_out_handle.name != port_name:
                try: _midi_out_handle.close()
                except: pass
                _midi_out_handle = None
        
        if _midi_out_handle is None:
            try:
                if port_name and not str(port_name).startswith("BLE:"):
                    _midi_out_handle = mido.open_output(port_name)
                elif not port_name:
                    # Default fallback if no BLE
                    outs = mido.get_output_names()
                    if outs:
                        _midi_out_handle = mido.open_output(outs[0])
            except Exception as e:
                _log(f"Failed to open MIDI out: {e}")
                _midi_out_handle = None
        return _midi_out_handle

def start_auto_connect_monitor():
    global _ble_handle
    if _ble_handle: return
    _ble_handle = BleMidiOutput(target_name=_auto_connect_target)
    _ble_handle.open() # Starts its own thread
    _log("BLE direct monitor started")


def _play_internal(path: str, port_name: str = None, stop_event=None, start_offset: float = 0):
    _log(f"Playback started for {path} at offset {start_offset}")
    
    out = None
    try:
        mid = mido.MidiFile(path)
        out = _get_out(port_name)
        if not out:
            _log("No MIDI output available")
            return

        accumulated_seconds = 0.0
        current_tempo = 500000
        start_anchor = None
        
        for msg in mido.merge_tracks(mid.tracks):
            if stop_event is not None and stop_event.is_set():
                print("DEBUG: Playback loop stop event set.")
                break
            
            delta_seconds = mido.tick2second(msg.time, mid.ticks_per_beat, current_tempo)
            accumulated_seconds += delta_seconds

            if msg.type == 'set_tempo':
                current_tempo = msg.tempo

            if accumulated_seconds < start_offset:
                continue
            
            if start_anchor is None:
                start_anchor = time.time()

            target_time = start_anchor + (accumulated_seconds - start_offset)
            
            while True:
                if stop_event is not None and stop_event.is_set():
                    return
                now = time.time()
                remaining = target_time - now
                if remaining <= 0.002:
                    break
                time.sleep(min(remaining, 0.01))
            
            if not msg.is_meta:
                try:
                    out.send(msg)
                    # Only log every 50 messages to avoid flooding
                    if accumulated_seconds % 5 == 0: # crude but works
                         pass 
                except Exception as e:
                    print(f"DEBUG: out.send error: {e}")
                    _log(f"Send error: {e}")
        
        print("DEBUG: _play_internal loop finished.")
                    
    except Exception as e:
        _log(f"Playback error: {e}")
    finally:
        _log("Playback internal finished")


def _play_blocking(path: str, port_name: str = None, stop_event=None, start_offset: float = 0):
    _play_internal(path, port_name, stop_event, start_offset)


def play_midi_async(path: str, port_name: str = None, stop_event=None, start_offset: float = 0):
    t = threading.Thread(target=_play_internal, args=(path, port_name, stop_event, start_offset), daemon=True)
    t.start()
    return t


def play_midi_blocking(path: str, port_name: str = None, stop_event=None, start_offset: float = 0):
    """Play MIDI file synchronously. Accepts optional threading.Event to allow interruption."""
    _play_internal(path, port_name, stop_event, start_offset)


# Simple global playback controller for ad-hoc playback (not playlist manager)
_current_play = {'thread': None, 'event': None, 'path': None, 'file': None, 'start': None, 'port': None, 'length': None, 'seek_offset': 0}

def start_play_async(path: str, port_name: str = None, seek_offset: float = 0):
    # stop any existing playback
    stop_current_play()
    
    # IMPORT HERE to avoid circular import if main.py is importing utils
    from app.main import manager
    if manager:
        manager.stop()

    ev = Event()
    info = get_midi_info(path)
    _current_play['path'] = path
    _current_play['file'] = os.path.basename(path)
    _current_play['port'] = port_name
    _current_play['length'] = info.get('length')
    _current_play['start'] = time.time()
    # If we seeked, the virtual start time is in the past
    if seek_offset > 0:
        _current_play['start'] -= seek_offset
    _current_play['seek_offset'] = seek_offset
    _current_play['event'] = ev
    
    t = threading.Thread(target=_play_internal, args=(path, port_name, ev, seek_offset), daemon=True)
    _current_play['thread'] = t
    t.start()
    return True


def stop_current_play():
    ev = _current_play.get('event')
    t = _current_play.get('thread')
    port = _current_play.get('port')
    
    if ev is not None:
        try:
            ev.set()
        except Exception:
            pass

    # Panic stop fallback - use shared handle
    out = _get_out(port)
    if out:
        try:
            for ch in range(16):
                out.send(mido.Message('control_change', channel=ch, control=123, value=0))
                out.send(mido.Message('control_change', channel=ch, control=121, value=0))
                out.send(mido.Message('control_change', channel=ch, control=64, value=0))
        except Exception:
            pass
    
    # clear metadata
    _current_play['thread'] = None
    _current_play['event'] = None
    _current_play['path'] = None
    _current_play['file'] = None
    _current_play['start'] = None
    _current_play['port'] = None
    _current_play['length'] = None
    _current_play['seek_offset'] = 0


def playback_status():
    if _current_play.get('thread') is None or not _current_play['thread'].is_alive():
        return {'playing': False}
    
    start = _current_play.get('start')
    filename = _current_play.get('file')
    length = _current_play.get('length')
    
    if start is None:
        return {'playing': False}
        
    elapsed = (time.time() - start)
    return {'playing': True, 'file': filename, 'elapsed': elapsed, 'length': length}


def load_profiles():
    if os.path.exists(PEDAL_JSON):
        with open(PEDAL_JSON, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def save_profiles(profiles: dict):
    with open(PEDAL_JSON, 'w', encoding='utf-8') as f:
        json.dump(profiles, f, indent=2)
