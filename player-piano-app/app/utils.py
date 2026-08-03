import runpy
import os
import json
import threading
import shutil
import re
import tempfile
from typing import List, Optional, Dict, Any
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
# Prefer environment variable, then system PATH, then default fallback path
import shutil
FLUIDSYNTH_BIN = os.environ.get(
    'FLUIDSYNTH_BIN',
    shutil.which('fluidsynth') or os.path.join(PROJECT_ROOT, 'fluidsynth', 'bin', 'fluidsynth.exe')
)
RENDER_CACHE = os.path.join(PROJECT_ROOT, 'storage', 'render_cache')
STORAGE_RAW = os.path.join(PROJECT_ROOT, 'storage', 'raw')
STORAGE_PROCESSED = os.path.join(PROJECT_ROOT, 'storage', 'processed')

def get_bbc_so_vst_path() -> Optional[str]:
    """Return path to Spitfire BBC SO VST3 if installed on system."""
    candidates = [
        r"C:\Program Files\Common Files\VST3\BBC Symphony Orchestra (64 Bit).vst3",
        r"C:\Program Files\Common Files\VST3\Spitfire Audio.vst3",
        r"C:\Program Files\VSTPlugins\BBC Symphony Orchestra (64 Bit).vst3",
        r"C:\Program Files\Steinberg\VSTPlugins\BBC Symphony Orchestra (64 Bit).vst3"
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return None


def get_available_soundfonts() -> List[str]:
    """Scan storage directory for valid .sf2 / .sf3 soundfonts, plus installed VST3 engines."""
    storage_dir = os.path.join(PROJECT_ROOT, 'storage')
    valid = []
    if os.path.exists(storage_dir):
        try:
            soundfont_candidates = [f for f in os.listdir(storage_dir) if f.lower().endswith(('.sf2', '.sf3'))]
            for sf in soundfont_candidates:
                sf_path = os.path.join(storage_dir, sf)
                try:
                    with open(sf_path, 'rb') as f:
                        header = f.read(100)
                    if b'<!DOCTYPE html>' in header or b'<html' in header:
                        continue
                    if sf_path and os.path.getsize(sf_path) > 1000:
                        valid.append(sf)
                except Exception:
                    pass
        except Exception as e:
            _log(f"Error scanning soundfonts: {e}")
            
    if get_bbc_so_vst_path():
        valid.append("Spitfire BBC Symphony Orchestra (VST3)")
        
    return sorted(valid)


def get_active_soundfont_path() -> str:
    """Get path to the active soundfont from settings or priority fallback list."""
    settings = load_settings()
    configured_sf = settings.get("active_soundfont")
    if configured_sf == "Spitfire BBC Symphony Orchestra (VST3)":
        bbc_vst = get_bbc_so_vst_path()
        if bbc_vst:
            return bbc_vst
            
    storage_dir = os.path.join(PROJECT_ROOT, 'storage')
    if configured_sf:
        sf_path = os.path.join(storage_dir, configured_sf)
        if os.path.exists(sf_path):
            try:
                with open(sf_path, 'rb') as f:
                    header = f.read(100)
                if not (b'<!DOCTYPE html>' in header or b'<html' in header):
                    return sf_path
            except Exception:
                pass
            
    # Priority fallback list
    priority_list = [
        "SGM-V2.01.sf2",
        "FluidR3_GM.sf2",
        "ChoriumRevA.sf2",
        "Arachno.sf2",
        "Salamander.sf2",
        "GeneralUser_GS.sf2"
    ]
    for sf_name in priority_list:
        sf_path = os.path.join(storage_dir, sf_name)
        if os.path.exists(sf_path):
            try:
                with open(sf_path, 'rb') as f:
                    header = f.read(100)
                if not (b'<!DOCTYPE html>' in header or b'<html' in header):
                    return sf_path
            except Exception:
                pass
    return SOUNDFONT


def resolve_soundfont_path(sf_filename: str = None) -> str:
    """Resolve absolute path for a given SoundFont filename or VST3, falling back to active soundfont."""
    if not sf_filename:
        return get_active_soundfont_path()
    if sf_filename == "Spitfire BBC Symphony Orchestra (VST3)":
        bbc_vst = get_bbc_so_vst_path()
        if bbc_vst:
            return bbc_vst
    if os.path.isabs(sf_filename) and os.path.exists(sf_filename):
        return sf_filename
    storage_dir = os.path.join(PROJECT_ROOT, 'storage')
    candidate = os.path.join(storage_dir, sf_filename)
    if os.path.exists(candidate):
        try:
            with open(candidate, 'rb') as f:
                header = f.read(100)
            if not (b'<!DOCTYPE html>' in header or b'<html' in header):
                return candidate
        except Exception:
            pass
    return get_active_soundfont_path()


def normalize_wav_file(wav_path: str, target_peak_db: float = None):
    """Normalize a 16-bit WAV file so peaks top out cleanly below 0 dBFS without clipping."""
    import wave
    import struct
    try:
        if not os.path.exists(wav_path):
            return
        if target_peak_db is None:
            settings = load_settings()
            target_peak_db = float(settings.get("peak_ceiling_db", -6.0))

        with wave.open(wav_path, 'rb') as wf:
            params = wf.getparams()
            if params.sampwidth != 2:
                return
            frames = wf.readframes(params.nframes)

        samples = list(struct.unpack(f"<{len(frames)//2}h", frames))
        max_val = max(abs(s) for s in samples) if samples else 0
        if max_val <= 0:
            return

        target_max = int(32767.0 * (10.0 ** (target_peak_db / 20.0)))
        scale = target_max / float(max_val)

        norm_samples = [max(-32768, min(32767, int(s * scale))) for s in samples]
        norm_frames = struct.pack(f"<{len(norm_samples)}h", *norm_samples)

        with wave.open(wav_path, 'wb') as wf:
            wf.setparams(params)
            wf.writeframes(norm_frames)
        _log(f"Normalized {os.path.basename(wav_path)} to {target_peak_db:.1f} dBFS (scale: {scale:.2f})")
    except Exception as e:
        _log(f"Peak normalization skipped: {e}")


def render_midi_to_wav_with_vst3(
    midi_path: str,
    vst3_path: str,
    out_wav_path: str,
    gain: float = None
) -> str:
    """Render MIDI to WAV using DawDreamer VST3 engine (e.g. Spitfire BBC SO)."""
    import numpy as np
    from scipy.io import wavfile
    import dawdreamer as daw
    import mido
    
    _log(f"Rendering MIDI via VST3 engine ({vst3_path}) -> {out_wav_path}")
    sample_rate = 44100
    block_size = 512
    engine = daw.RenderEngine(sample_rate, block_size)
    
    synth = engine.make_plugin_processor("vst3_synth", vst3_path)
    synth.load_midi(midi_path)
    
    mid = mido.MidiFile(midi_path)
    duration_sec = getattr(mid, 'length', 180.0) + 2.5
    
    engine.load_graph([(synth, [])])
    engine.render(duration_sec)
    
    audio = engine.get_audio().T
    if gain is not None:
        audio = audio * gain
    max_val = np.max(np.abs(audio))
    if max_val > 0:
        audio = (audio / max_val) * 0.9 * 32767.0
    audio_int16 = np.clip(audio, -32768, 32767).astype(np.int16)
    wavfile.write(out_wav_path, sample_rate, audio_int16)
    return out_wav_path


def render_midi_to_wav_with_soundfont(
    midi_path: str, 
    soundfont_path: str, 
    out_wav_path: str,
    gain: float = None,
    reverb_enabled: bool = None,
    reverb_room_size: float = None,
    reverb_level: float = None,
    polyphony: int = None,
    interpolation: int = None
) -> str:
    """Render MIDI to WAV using FluidSynth or VST3 engine with optimized audio parameters."""
    if soundfont_path and ("Spitfire BBC" in soundfont_path or soundfont_path.lower().endswith('.vst3')):
        resolved_vst = resolve_soundfont_path(soundfont_path)
        if os.path.exists(resolved_vst) and resolved_vst.lower().endswith('.vst3'):
            try:
                return render_midi_to_wav_with_vst3(midi_path, resolved_vst, out_wav_path, gain=gain)
            except Exception as e:
                _log(f"VST3 render notice ({e}), falling back to FluidSynth SoundFont...")
                soundfont_path = get_active_soundfont_path()

    resolved_sf = resolve_soundfont_path(soundfont_path)
    if not os.path.exists(resolved_sf) or resolved_sf.lower().endswith('.vst3'):
        resolved_sf = get_active_soundfont_path()
        
    soundfont_path = resolved_sf
    import subprocess
    
    if not os.path.exists(FLUIDSYNTH_BIN):
        raise FileNotFoundError(f"FluidSynth not found at {FLUIDSYNTH_BIN}")
    if not os.path.exists(soundfont_path):
        raise FileNotFoundError(f"SoundFont not found at {soundfont_path}")

    settings = load_settings()
    if gain is None:
        gain = float(settings.get("synth_gain", 0.7))
    if reverb_enabled is None:
        reverb_enabled = bool(settings.get("reverb_enabled", True))
    if reverb_room_size is None:
        reverb_room_size = float(settings.get("reverb_room_size", 0.55))
    if reverb_level is None:
        reverb_level = float(settings.get("reverb_level", 0.25))
    if polyphony is None:
        polyphony = int(settings.get("polyphony", 512))
    if interpolation is None:
        interpolation = int(settings.get("interpolation", 7))

    temp_cfg_path = None
    if interpolation is not None:
        try:
            with tempfile.NamedTemporaryFile(mode='w', suffix='.cfg', delete=False) as cfg_file:
                cfg_file.write(f"interp {interpolation}\n")
                temp_cfg_path = cfg_file.name
        except Exception as e:
            _log(f"Warning: Could not create temp interpolation config: {e}")

    cmd = [
        FLUIDSYNTH_BIN,
        '-ni',
    ]

    if temp_cfg_path and os.path.exists(temp_cfg_path):
        cmd.extend(['-f', temp_cfg_path])

    cmd.extend([
        '-g', str(gain),
        '-r', '48000',
        '-o', f'synth.polyphony={polyphony}',
        '-o', 'synth.cpu-cores=4',
    ])

    if reverb_enabled:
        cmd.extend([
            '-R', '1',
            '-o', f'synth.reverb.room-size={reverb_room_size}',
            '-o', 'synth.reverb.damp=0.65',
            '-o', f'synth.reverb.level={reverb_level}',
            '-o', 'synth.reverb.width=0.85'
        ])
    else:
        cmd.extend(['-R', '0'])

    cmd.extend([
        '-C', '1',
        '-o', 'synth.chorus.depth=3.0',
        '-o', 'synth.chorus.level=0.30',
        '-F', out_wav_path,
        soundfont_path,
        midi_path
    ])
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            _log(f"FluidSynth error: {result.stderr}")
            raise RuntimeError(f"FluidSynth failed: {result.stderr}")
            
        normalize_wav_file(out_wav_path, target_peak_db=-0.5)
        _log(f"Render complete: {out_wav_path}")
        return out_wav_path
    except Exception as e:
        _log(f"Rendering failed: {str(e)}")
        raise e
    finally:
        if temp_cfg_path and os.path.exists(temp_cfg_path):
            try:
                os.remove(temp_cfg_path)
            except Exception:
                pass


def render_midi_to_wav(midi_path: str) -> str:
    """Render MIDI to WAV using FluidSynth and the active GM/Orchestral SoundFont."""
    os.makedirs(RENDER_CACHE, exist_ok=True)
    filename = os.path.basename(midi_path)
    wav_path = os.path.join(RENDER_CACHE, filename + '.wav')
    
    if os.path.exists(wav_path):
        if os.path.getmtime(wav_path) > os.path.getmtime(midi_path):
            return wav_path
            
    _log(f"Rendering {filename} to WAV...")
    active_sf = get_active_soundfont_path()
    return render_midi_to_wav_with_soundfont(midi_path, active_sf, wav_path)


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
    
_midi_parsed_cache = {}
_midi_cache_max_entries = 50

def get_parsed_midi(path: str) -> mido.MidiFile:
    """Returns a cached parsed mido.MidiFile object to prevent parsing lag during playback."""
    if not os.path.exists(path):
        raise FileNotFoundError(f"MIDI file not found: {path}")
    
    file_size = os.path.getsize(path)
    file_mtime = os.path.getmtime(path)
    cache_key = f"{os.path.abspath(path)}_{file_size}_{file_mtime}"
    
    if cache_key in _midi_parsed_cache:
        return _midi_parsed_cache[cache_key]
    
    mid = mido.MidiFile(path)
    if len(_midi_parsed_cache) >= _midi_cache_max_entries:
        _midi_parsed_cache.pop(next(iter(_midi_parsed_cache)))
    _midi_parsed_cache[cache_key] = mid
    return mid


def get_midi_info(path: str):
    if not os.path.exists(path):
        return {'length': None, 'size': 0, 'created': 0}

    file_size = os.path.getsize(path)
    file_mtime = os.path.getmtime(path)
    cache_key = f"{path}_{file_size}_{file_mtime}"
    
    if cache_key in _midi_info_cache:
        return _midi_info_cache[cache_key]

    info = {'length': None, 'size': file_size, 'created': file_mtime}
    try:
        mid = get_parsed_midi(path)
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


# --- Stationary Backend Audio & Bluetooth Support ---

SETTINGS_JSON = os.path.join(PROJECT_ROOT, 'storage', 'settings.json')

def load_settings() -> dict:
    try:
        if os.path.exists(SETTINGS_JSON):
            with open(SETTINGS_JSON, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception:
        pass
    return {}

def save_settings(settings: dict):
    try:
        os.makedirs(os.path.dirname(SETTINGS_JSON), exist_ok=True)
        existing = load_settings()
        existing.update(settings)
        with open(SETTINGS_JSON, 'w', encoding='utf-8') as f:
            json.dump(existing, f, indent=2)
    except Exception as e:
        print(f"Error saving settings: {e}")

# Win32 Bluetooth ctypes structures (Windows only)
import platform
IS_WINDOWS = platform.system() == "Windows"

_active_bt_device_name = None
_last_activity_timestamp = time.time()
_backend_audio_volume = 1.0

try:
    _backend_audio_volume = load_settings().get("backend_audio_volume", 1.0)
except Exception:
    pass

if IS_WINDOWS:
    import ctypes
    from ctypes import wintypes

    class SYSTEMTIME(ctypes.Structure):
        _fields_ = [
            ("wYear", wintypes.WORD),
            ("wMonth", wintypes.WORD),
            ("wDayOfWeek", wintypes.WORD),
            ("wDay", wintypes.WORD),
            ("wHour", wintypes.WORD),
            ("wMinute", wintypes.WORD),
            ("wSecond", wintypes.WORD),
            ("wMilliseconds", wintypes.WORD),
        ]

    class BLUETOOTH_DEVICE_INFO(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("Address", ctypes.c_uint64),
            ("ulClassofDevice", ctypes.c_ulong),
            ("fConnected", wintypes.BOOL),
            ("fRemembered", wintypes.BOOL),
            ("fAuthenticated", wintypes.BOOL),
            ("stLastSeen", SYSTEMTIME),
            ("stLastUsed", SYSTEMTIME),
            ("szName", wintypes.WCHAR * 248),
        ]

    class BLUETOOTH_DEVICE_SEARCH_PARAMS(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("fReturnAuthenticated", wintypes.BOOL),
            ("fReturnRemembered", wintypes.BOOL),
            ("fReturnUnknown", wintypes.BOOL),
            ("fReturnConnected", wintypes.BOOL),
            ("fIssueInquiry", wintypes.BOOL),
            ("cTimeoutMultiplier", ctypes.c_ubyte),
            ("hRadio", wintypes.HANDLE),
        ]

    class GUID(ctypes.Structure):
        _fields_ = [
            ("Data1", ctypes.c_ulong),
            ("Data2", ctypes.c_ushort),
            ("Data3", ctypes.c_ushort),
            ("Data4", ctypes.c_ubyte * 8),
        ]

    GUID_AUDIO_SINK = GUID(
        0x0000110b, 
        0x0000, 
        0x1000, 
        (ctypes.c_ubyte * 8)(0x80, 0x00, 0x00, 0x80, 0x5f, 0x9b, 0x34, 0xfb)
    )

def list_paired_bluetooth_devices() -> list:
    if not IS_WINDOWS:
        return []
    try:
        bth = ctypes.windll.bluetoothapis
        bth.BluetoothFindFirstDevice.argtypes = [
            ctypes.POINTER(BLUETOOTH_DEVICE_SEARCH_PARAMS),
            ctypes.POINTER(BLUETOOTH_DEVICE_INFO)
        ]
        bth.BluetoothFindFirstDevice.restype = wintypes.HANDLE
        bth.BluetoothFindNextDevice.argtypes = [
            wintypes.HANDLE,
            ctypes.POINTER(BLUETOOTH_DEVICE_INFO)
        ]
        bth.BluetoothFindNextDevice.restype = wintypes.BOOL
        bth.BluetoothFindDeviceClose.argtypes = [wintypes.HANDLE]
        bth.BluetoothFindDeviceClose.restype = wintypes.BOOL

        search_params = BLUETOOTH_DEVICE_SEARCH_PARAMS()
        search_params.dwSize = ctypes.sizeof(BLUETOOTH_DEVICE_SEARCH_PARAMS)
        search_params.fReturnAuthenticated = True
        search_params.fReturnRemembered = True
        search_params.fReturnUnknown = False
        search_params.fReturnConnected = True
        search_params.fIssueInquiry = False
        search_params.hRadio = None
        
        device_info = BLUETOOTH_DEVICE_INFO()
        device_info.dwSize = ctypes.sizeof(BLUETOOTH_DEVICE_INFO)
        
        h_find = bth.BluetoothFindFirstDevice(ctypes.byref(search_params), ctypes.byref(device_info))
        if not h_find:
            return []
            
        names = []
        try:
            has_next = True
            while has_next:
                names.append(device_info.szName.strip())
                has_next = bth.BluetoothFindNextDevice(h_find, ctypes.byref(device_info))
        finally:
            bth.BluetoothFindDeviceClose(h_find)
            
        return names
    except Exception as e:
        print(f"Error in list_paired_bluetooth_devices: {e}")
        return []

def list_audio_devices() -> list:
    try:
        import sounddevice as sd
        try:
            device_list = sd.query_devices()
            default_out = sd.default.device[1]
        except Exception:
            device_list = []
            default_out = -1

        seen_names = set()
        devices = []
        
        skip_patterns = [
            r"primary sound driver",
            r"microsoft sound mapper",
            r"audio capture filter",
            r"sound mapper"
        ]

        # 1. Add active/connected output devices
        for idx, dev in enumerate(device_list):
            if dev['max_output_channels'] > 0:
                name = dev['name'].strip()
                if any(re.search(pat, name.lower()) for pat in skip_patterns):
                    continue
                if name in seen_names:
                    continue
                seen_names.add(name)
                devices.append({
                    "index": idx,
                    "name": name,
                    "is_default": idx == default_out
                })

        # 2. Add paired Bluetooth devices that aren't currently active
        paired_bt_names = list_paired_bluetooth_devices()
        for name in paired_bt_names:
            is_active = False
            for active_name in seen_names:
                if name.lower() in active_name.lower() or active_name.lower() in name.lower():
                    is_active = True
                    break
            if not is_active:
                devices.append({
                    "index": -1, # Flag as disconnected candidate
                    "name": name,
                    "is_default": False
                })
                seen_names.add(name)
                
        return devices
    except Exception as e:
        print(f"Error listing audio devices: {e}")
        return []

def connect_paired_device(device_name_substring: str) -> bool:
    global _active_bt_device_name, _last_activity_timestamp
    if not device_name_substring:
        return False

    # 1. If it's already an active/connected output device, bypass Win32 Bluetooth APIs
    try:
        import sounddevice as sd
        try:
            device_list = sd.query_devices()
        except Exception:
            device_list = []
        for dev in device_list:
            if dev['max_output_channels'] > 0:
                name = dev['name'].strip()
                # Check both directions for matching
                if (device_name_substring.lower() in name.lower() or 
                        name.lower() in device_name_substring.lower()):
                    _last_activity_timestamp = time.time()
                    _active_bt_device_name = name
                    print(f"Device '{device_name_substring}' matches active output device '{name}'. Bypassing Bluetooth connection handshake.")
                    return True
    except Exception as e:
        print(f"Error checking active output devices in connect_paired_device: {e}")

    if not IS_WINDOWS:
        return False
    try:
        bth = ctypes.windll.bluetoothapis
        
        bth.BluetoothFindFirstDevice.argtypes = [
            ctypes.POINTER(BLUETOOTH_DEVICE_SEARCH_PARAMS),
            ctypes.POINTER(BLUETOOTH_DEVICE_INFO)
        ]
        bth.BluetoothFindFirstDevice.restype = wintypes.HANDLE
        
        bth.BluetoothFindNextDevice.argtypes = [
            wintypes.HANDLE,
            ctypes.POINTER(BLUETOOTH_DEVICE_INFO)
        ]
        bth.BluetoothFindNextDevice.restype = wintypes.BOOL
        
        bth.BluetoothFindDeviceClose.argtypes = [wintypes.HANDLE]
        bth.BluetoothFindDeviceClose.restype = wintypes.BOOL
        
        bth.BluetoothSetServiceState.argtypes = [
            wintypes.HANDLE,
            ctypes.POINTER(BLUETOOTH_DEVICE_INFO),
            ctypes.POINTER(GUID),
            wintypes.DWORD
        ]
        bth.BluetoothSetServiceState.restype = wintypes.DWORD

        search_params = BLUETOOTH_DEVICE_SEARCH_PARAMS()
        search_params.dwSize = ctypes.sizeof(BLUETOOTH_DEVICE_SEARCH_PARAMS)
        search_params.fReturnAuthenticated = True
        search_params.fReturnRemembered = True
        search_params.fReturnUnknown = False
        search_params.fReturnConnected = True
        search_params.fIssueInquiry = False
        search_params.hRadio = None
        
        device_info = BLUETOOTH_DEVICE_INFO()
        device_info.dwSize = ctypes.sizeof(BLUETOOTH_DEVICE_INFO)
        
        h_find = bth.BluetoothFindFirstDevice(ctypes.byref(search_params), ctypes.byref(device_info))
        if not h_find:
            return False
            
        found_target = False
        try:
            has_next = True
            while has_next:
                name = device_info.szName
                clean_name = re.sub(r'\s*\([^)]*\)', '', name).strip()
                if (device_name_substring.lower() in name.lower() or 
                    name.lower() in device_name_substring.lower() or
                    device_name_substring.lower() in clean_name.lower() or 
                    clean_name.lower() in device_name_substring.lower()):
                    found_target = True
                    _last_activity_timestamp = time.time()
                    _active_bt_device_name = name
                    
                    if not device_info.fConnected:
                        print(f"Triggering Bluetooth connection to paired device '{name}'...")
                        bth.BluetoothSetServiceState(None, ctypes.byref(device_info), ctypes.byref(GUID_AUDIO_SINK), 0)
                        time.sleep(0.5)
                        res = bth.BluetoothSetServiceState(None, ctypes.byref(device_info), ctypes.byref(GUID_AUDIO_SINK), 1)
                        if res == 0:
                            print(f"Connection signal sent successfully. Waiting for A2DP channel...")
                            time.sleep(2.5) # Give Windows time to complete pairing handshake and load audio device
                        else:
                            print(f"BluetoothSetServiceState failed with code: {res}")
                    break
                has_next = bth.BluetoothFindNextDevice(h_find, ctypes.byref(device_info))
        finally:
            bth.BluetoothFindDeviceClose(h_find)
            
        return found_target
    except Exception as e:
        print(f"Error in connect_paired_device: {e}")
        return False

def disconnect_paired_device(device_name_substring: str) -> bool:
    if not IS_WINDOWS:
        return False
    try:
        bth = ctypes.windll.bluetoothapis
        
        bth.BluetoothFindFirstDevice.argtypes = [
            ctypes.POINTER(BLUETOOTH_DEVICE_SEARCH_PARAMS),
            ctypes.POINTER(BLUETOOTH_DEVICE_INFO)
        ]
        bth.BluetoothFindFirstDevice.restype = wintypes.HANDLE
        
        bth.BluetoothFindNextDevice.argtypes = [
            wintypes.HANDLE,
            ctypes.POINTER(BLUETOOTH_DEVICE_INFO)
        ]
        bth.BluetoothFindNextDevice.restype = wintypes.BOOL
        
        bth.BluetoothFindDeviceClose.argtypes = [wintypes.HANDLE]
        bth.BluetoothFindDeviceClose.restype = wintypes.BOOL
        
        bth.BluetoothSetServiceState.argtypes = [
            wintypes.HANDLE,
            ctypes.POINTER(BLUETOOTH_DEVICE_INFO),
            ctypes.POINTER(GUID),
            wintypes.DWORD
        ]
        bth.BluetoothSetServiceState.restype = wintypes.DWORD

        search_params = BLUETOOTH_DEVICE_SEARCH_PARAMS()
        search_params.dwSize = ctypes.sizeof(BLUETOOTH_DEVICE_SEARCH_PARAMS)
        search_params.fReturnAuthenticated = True
        search_params.fReturnRemembered = True
        search_params.fReturnUnknown = False
        search_params.fReturnConnected = True
        search_params.fIssueInquiry = False
        search_params.hRadio = None
        
        device_info = BLUETOOTH_DEVICE_INFO()
        device_info.dwSize = ctypes.sizeof(BLUETOOTH_DEVICE_INFO)
        
        h_find = bth.BluetoothFindFirstDevice(ctypes.byref(search_params), ctypes.byref(device_info))
        if not h_find:
            return False
            
        found_target = False
        try:
            has_next = True
            while has_next:
                name = device_info.szName
                clean_name = re.sub(r'\s*\([^)]*\)', '', name).strip()
                if device_name_substring.lower() in name.lower() or device_name_substring.lower() in clean_name.lower():
                    found_target = True
                    bth.BluetoothSetServiceState(None, ctypes.byref(device_info), ctypes.byref(GUID_AUDIO_SINK), 0)
                    print(f"Triggered Bluetooth disconnect for device '{name}' successfully.")
                    break
                has_next = bth.BluetoothFindNextDevice(h_find, ctypes.byref(device_info))
        finally:
            bth.BluetoothFindDeviceClose(h_find)
            
        return found_target
    except Exception as e:
        print(f"Error in disconnect_paired_device: {e}")
        return False

# --- Background Idle Disconnect Monitor (5 Minutes) ---
_idle_timer_thread = None

def _run_idle_monitor():
    global _active_bt_device_name, _last_activity_timestamp
    while True:
        try:
            time.sleep(10)
            if _active_bt_device_name:
                is_playing = False
                t = _current_play.get('thread')
                if t and t.is_alive():
                    is_playing = True
                    _last_activity_timestamp = time.time()
                
                if not is_playing and (time.time() - _last_activity_timestamp > 300):
                    print(f"Idle timeout reached. Disconnecting Bluetooth speaker '{_active_bt_device_name}'...")
                    disconnect_paired_device(_active_bt_device_name)
                    _active_bt_device_name = None
        except Exception as e:
            print(f"Error in idle monitor: {e}")

def start_idle_monitor():
    global _idle_timer_thread
    if _idle_timer_thread is None:
        _idle_timer_thread = threading.Thread(target=_run_idle_monitor, daemon=True)
        _idle_timer_thread.start()

start_idle_monitor()


def _play_audio_thread(audio_path: str, seek_offset: float, delay_seconds: float, stop_event: Event, device_name: str):
    try:
        import sounddevice as sd
        import soundfile as sf
    except ImportError:
        print("ERROR: sounddevice or soundfile is not installed. Backend audio playback failed.")
        return

    # Trigger connection to selected Bluetooth device if paired
    if device_name:
        connect_paired_device(device_name)

    try:
        if delay_seconds > 0:
            slept = 0.0
            while slept < delay_seconds:
                if stop_event.is_set():
                    return
                time.sleep(0.02)
                slept += 0.02

        if stop_event.is_set():
            return

        data, fs = sf.read(audio_path)
        
        if seek_offset > 0:
            start_frame = int(seek_offset * fs)
            if start_frame < len(data):
                data = data[start_frame:]
            else:
                return

        # Ensure 2D array shape for compatibility
        if len(data.shape) == 1:
            data = data.reshape(-1, 1)

        device_indices = []
        if device_name:
            try:
                device_list = sd.query_devices()
                matches = []
                for idx, dev in enumerate(device_list):
                    if device_name.lower() in dev['name'].lower() and dev['max_output_channels'] > 0:
                        api_name = sd.query_hostapis(dev['hostapi'])['name'].lower()
                        prio = -1
                        if 'wasapi' in api_name: prio = 2
                        elif 'directsound' in api_name: prio = 1
                        elif 'mme' in api_name: prio = 0
                        matches.append((prio, idx))
                matches.sort(key=lambda x: x[0], reverse=True)
                device_indices = [idx for prio, idx in matches]
            except Exception as e:
                print(f"Error resolving audio output device {device_name}: {e}")

        if stop_event.is_set():
            return

        current_frame = 0
        channels = data.shape[1]

        def callback(outdata, frames, time_info, status):
            nonlocal current_frame
            chunksize = min(len(data) - current_frame, frames)
            if chunksize > 0:
                vol = globals().get('_backend_audio_volume', 1.0)
                outdata[:chunksize] = data[current_frame:current_frame + chunksize] * vol
                if chunksize < frames:
                    outdata[chunksize:] = 0
                current_frame += chunksize
            else:
                outdata.fill(0)
                raise sd.CallbackStop

        stream = None
        # Try prioritized matching devices (WASAPI -> DirectSound -> MME)
        for dev_idx in device_indices:
            try:
                stream = sd.OutputStream(
                    samplerate=fs, 
                    device=dev_idx, 
                    channels=channels, 
                    callback=callback
                )
                print(f"Successfully opened audio output stream on matching device index {dev_idx}")
                break
            except Exception as e:
                print(f"Failed to open audio stream on device index {dev_idx} with sample rate {fs}Hz: {e}")

        # Fallback to default device
        if stream is None:
            try:
                stream = sd.OutputStream(
                    samplerate=fs, 
                    device=None, 
                    channels=channels, 
                    callback=callback
                )
                print("Successfully opened audio output stream on default device")
            except Exception as e:
                print(f"Failed to open default audio output stream: {e}")

        # Last resort fallback: Resample and try best matching device
        if stream is None and len(device_indices) > 0:
            print("Attempting sample rate recovery/resampling fallback...")
            try:
                dev_idx = device_indices[0]
                device_info = sd.query_devices(dev_idx)
                default_fs = int(device_info['default_samplerate'])
                
                if fs != default_fs:
                    print(f"Resampling audio from {fs}Hz to {default_fs}Hz...")
                    duration = len(data) / fs
                    num_samples = int(duration * default_fs)
                    
                    import numpy as np
                    x_original = np.linspace(0, duration, len(data))
                    x_new = np.linspace(0, duration, num_samples)
                    
                    resampled_channels = []
                    for ch in range(channels):
                        resampled_ch = np.interp(x_new, x_original, data[:, ch])
                        resampled_channels.append(resampled_ch)
                    data = np.column_stack(resampled_channels)
                    fs = default_fs
                    current_frame = 0
                    
                stream = sd.OutputStream(
                    samplerate=fs, 
                    device=dev_idx, 
                    channels=channels, 
                    callback=callback
                )
                print(f"Successfully opened resampled audio output stream on device index {dev_idx}")
            except Exception as e2:
                print(f"Failed to recover/resample audio output stream: {e2}")
                return

        if stream is None:
            print("Failed to open any audio output stream.")
            return
        
        with stream:
            while stream.active:
                if stop_event.is_set():
                    break
                time.sleep(0.05)

    except Exception as e:
        print(f"Error in audio playback thread: {e}")


def _play_internal(path: str, port_name: str = None, stop_event=None, start_offset: float = 0, audio_path: str = None, global_offset_ms: float = 0, request_timestamp: float = None):
    _current_play['event'] = stop_event
    _log(f"Playback started for {path} at offset {start_offset} with audio_path={audio_path} and offset={global_offset_ms}ms")
    
    audio_stop_event = Event()
    
    try:
        mid = get_parsed_midi(path)
        settings = load_settings()
        
        # Start backing audio thread if enabled and audio file exists
        if settings.get("backend_audio_enabled") and audio_path and os.path.exists(audio_path):
            audio_delay = 0.0
            if global_offset_ms < 0:
                audio_delay = abs(global_offset_ms) / 1000.0
                
            device_name = settings.get("selected_device")
            t_audio = threading.Thread(
                target=_play_audio_thread, 
                args=(audio_path, start_offset, audio_delay, audio_stop_event, device_name),
                daemon=True
            )
            _current_play['audio_thread'] = t_audio
            t_audio.start()

        out = _get_out(port_name)
        if not out:
            _log("No MIDI output available. Running silent MIDI timeline (audio only).")
            while stop_event is not None and not stop_event.is_set():
                time.sleep(0.05)
            return

        # Handle MIDI Delay
        midi_delay = 0.0
        if settings.get("backend_audio_enabled") and audio_path and global_offset_ms > 0:
            midi_delay = global_offset_ms / 1000.0

        accumulated_seconds = 0.0
        current_tempo = 500000
        
        # Precisely anchor start time to when the play request was received
        base_time = request_timestamp if request_timestamp is not None else time.time()
        start_anchor = base_time + midi_delay

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
                except Exception as e:
                    print(f"DEBUG: out.send error: {e}")
                    _log(f"Send error: {e}")
        
        print("DEBUG: _play_internal loop finished.")
                    
    except Exception as e:
        _log(f"Playback error: {e}")
    finally:
        audio_stop_event.set()
        _log("Playback internal finished")


def _play_blocking(path: str, port_name: str = None, stop_event=None, start_offset: float = 0):
    _play_internal(path, port_name, stop_event, start_offset)


def play_midi_async(path: str, port_name: str = None, stop_event=None, start_offset: float = 0):
    t = threading.Thread(target=_play_internal, args=(path, port_name, stop_event, start_offset), daemon=True)
    t.start()
    return t


def play_midi_blocking(path: str, port_name: str = None, stop_event=None, start_offset: float = 0, audio_path: str = None, global_offset_ms: float = 0):
    """Play MIDI file synchronously. Accepts optional threading.Event to allow interruption."""
    _play_internal(path, port_name, stop_event, start_offset, audio_path, global_offset_ms)


# Simple global playback controller for ad-hoc playback (not playlist manager)
_current_play = {'thread': None, 'event': None, 'path': None, 'file': None, 'start': None, 'port': None, 'length': None, 'seek_offset': 0, 'audio_thread': None}

def start_play_async(path: str, port_name: str = None, seek_offset: float = 0, audio_path: str = None, global_offset_ms: float = 0):
    req_time = time.time()
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
    
    virtual_start = req_time
    if audio_path and os.path.exists(audio_path):
        settings = load_settings()
        if settings.get("backend_audio_enabled") and global_offset_ms < 0:
            virtual_start += abs(global_offset_ms) / 1000.0
            
    _current_play['start'] = virtual_start - seek_offset
    _current_play['seek_offset'] = seek_offset
    _current_play['event'] = ev
    
    t = threading.Thread(
        target=_play_internal, 
        args=(path, port_name, ev, seek_offset, audio_path, global_offset_ms, req_time), 
        daemon=True
    )
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
    _current_play['audio_thread'] = None
    _current_play['event'] = None
    _current_play['path'] = None
    _current_play['file'] = None
    _current_play['start'] = None
    _current_play['port'] = None
    _current_play['length'] = None
    _current_play['seek_offset'] = 0


def playback_status():
    midi_alive = _current_play.get('thread') is not None and _current_play['thread'].is_alive()
    audio_alive = _current_play.get('audio_thread') is not None and _current_play['audio_thread'].is_alive()
    
    if not midi_alive and not audio_alive:
        return {'playing': False}
    
    start = _current_play.get('start')
    filename = _current_play.get('file')
    length = _current_play.get('length')
    
    if start is None:
        return {'playing': False}
        
    elapsed = (time.time() - start)
    settings = load_settings()
    return {
        'playing': True, 
        'file': filename, 
        'elapsed': elapsed, 
        'length': length,
        'backend_audio_enabled': settings.get("backend_audio_enabled", False)
    }


def load_profiles():
    if os.path.exists(PEDAL_JSON):
        with open(PEDAL_JSON, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


def save_profiles(profiles: dict):
    with open(PEDAL_JSON, 'w', encoding='utf-8') as f:
        json.dump(profiles, f, indent=2)


def cleanup_render_cache():
    """Delete cached .wav files that no longer correspond to existing processed or raw MIDI files."""
    if not os.path.exists(RENDER_CACHE):
        return 0
        
    try:
        processed_dir = STORAGE_PROCESSED
        raw_dir = STORAGE_RAW
        
        # Gather set of existing midi filenames
        existing_midis = set()
        if os.path.exists(processed_dir):
            existing_midis.update(f for f in os.listdir(processed_dir) if f.lower().endswith(('.mid', '.midi')))
        if os.path.exists(raw_dir):
            existing_midis.update(f for f in os.listdir(raw_dir) if f.lower().endswith(('.mid', '.midi')))
            
        deleted_count = 0
        for f in os.listdir(RENDER_CACHE):
            if f.lower().endswith('.wav'):
                midi_name = f[:-4] # Remove '.wav'
                if midi_name not in existing_midis:
                    try:
                        os.remove(os.path.join(RENDER_CACHE, f))
                        deleted_count += 1
                    except Exception as e:
                        print(f"Failed to remove obsolete render cache file {f}: {e}")
                        
        if deleted_count > 0:
            print(f"RENDER_CACHE: Cleaned up {deleted_count} obsolete cache files.")
        return deleted_count
    except Exception as e:
        print(f"RENDER_CACHE: Cleanup failed: {e}")
        return 0


def scan_model_file(filepath: str) -> bool:
    """
    Scans a PyTorch (.pth or .pt) model file to verify it doesn't contain
    malicious pickle bytecode that could execute arbitrary commands.
    Returns True if the file is safe to load, or False if suspicious imports are found.
    """
    import zipfile
    import pickletools
    from pathlib import Path

    # Allowed modules/packages for standard PyTorch model weights
    SAFE_MODULES = {
        'torch',
        'torch._utils',
        'collections',
        'numpy',
        'numpy.core.multiarray',
        '_codecs',
    }
    
    # Allowed specific names from builtins
    SAFE_BUILTINS = {'dict', 'list', 'set', 'tuple', 'bool', 'int', 'float', 'str', 'bytes'}

    path = Path(filepath)
    if not path.exists():
        print(f"Model safety scan: File {filepath} does not exist.")
        return False

    def scan_pickle_data(data_bytes: bytes) -> bool:
        try:
            for opcode, args, pos in pickletools.genops(data_bytes):
                if opcode.name == 'GLOBAL':
                    module, name = args.split(' ')
                    # Verify if the module or builtin name is safe
                    if module == 'builtins' or module == '__builtin__':
                        if name not in SAFE_BUILTINS:
                            print(f"Model safety scan WARNING: Blocked loading file due to suspicious builtin '{module}.{name}'.")
                            return False
                    elif module not in SAFE_MODULES and not module.startswith('torch.') and not module.startswith('fairseq.') and module != 'fairseq':
                        print(f"Model safety scan WARNING: Blocked loading file due to suspicious pickle import '{module}.{name}' at position {pos}.")
                        return False
            return True
        except Exception as e:
            # If pickletools cannot parse it, treat it as unsafe/malformed
            print(f"Model safety scan: Error parsing pickle bytecode: {e}")
            return False

    # Standard PyTorch models can be raw pickles or Zip archives (saving format since PyTorch 1.6)
    if zipfile.is_zipfile(filepath):
        try:
            with zipfile.ZipFile(filepath, 'r') as zip_ref:
                # Scan any pickle files inside the archive (typically data.pkl)
                has_pickle = False
                for file_info in zip_ref.infolist():
                    if file_info.filename.endswith('.pkl') or 'data.pkl' in file_info.filename:
                        has_pickle = True
                        data = zip_ref.read(file_info.filename)
                        if not scan_pickle_data(data):
                            return False
                if not has_pickle:
                    print(f"Model safety scan: ZIP file {filepath} has no .pkl files, assuming safe (e.g. state dict or ONNX).")
                return True
        except Exception as e:
            print(f"Model safety scan: Failed to read ZIP archive: {e}")
            return False
    else:
        # Raw pickle file
        try:
            with open(filepath, 'rb') as f:
                data = f.read()
            return scan_pickle_data(data)
        except Exception as e:
            print(f"Model safety scan: Failed to read file: {e}")
            return False

