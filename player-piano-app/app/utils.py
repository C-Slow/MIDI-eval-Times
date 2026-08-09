import runpy
import os
import json
import threading
import shutil
import re
import tempfile
import soundfile as sf
from typing import List, Optional, Dict, Any
import mido
import pretty_midi
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
import threading
vst_lock = threading.Lock()
fs_lock = threading.Lock()

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
    """Get path to the active soundfont from settings or priority fallback list, defaulting to Spitfire BBC SO VST3."""
    settings = load_settings()
    configured_sf = settings.get("active_soundfont")
    
    bbc_vst = get_bbc_so_vst_path()
    if configured_sf == "Spitfire BBC Symphony Orchestra (VST3)" or (not configured_sf and bbc_vst):
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
    if bbc_vst:
        return bbc_vst

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
    """Normalize a WAV file so peaks top out cleanly below 0 dBFS without clipping, supporting 16-bit, 24-bit, and float formats."""
    import numpy as np
    try:
        if not os.path.exists(wav_path):
            return
        if target_peak_db is None:
            settings = load_settings()
            target_peak_db = float(settings.get("peak_ceiling_db", -6.0))

        data, sr = sf.read(wav_path)
        max_val = np.max(np.abs(data))
        if max_val <= 0:
            return

        target_max = 10.0 ** (target_peak_db / 20.0)
        scale = target_max / float(max_val)
        norm_data = data * scale
        
        info = sf.info(wav_path)
        sf.write(wav_path, norm_data, sr, subtype=info.subtype)
        _log(f"Normalized {os.path.basename(wav_path)} to {target_peak_db:.1f} dBFS (scale: {scale:.2f}, format: {info.subtype})")
    except Exception as e:
        _log(f"Peak normalization skipped: {e}")



SPITFIRE_KEYSWITCHES = {
    # STRINGS
    "legato": pretty_midi.note_name_to_number("C-1"),       # Pitch 0
    "long": pretty_midi.note_name_to_number("C#-1"),       # Pitch 1
    "con_sordino": pretty_midi.note_name_to_number("D-1"), # Pitch 2
    "flautando": pretty_midi.note_name_to_number("D#-1"),  # Pitch 3
    "spiccato": pretty_midi.note_name_to_number("E-1"),    # Pitch 4
    "staccato": pretty_midi.note_name_to_number("F-1"),    # Pitch 5
    "pizzicato": pretty_midi.note_name_to_number("F#-1"),  # Pitch 6 (PIZZICATO)
    "col_legno": pretty_midi.note_name_to_number("G-1"),   # Pitch 7

    # BRASS
    "legato_extended": pretty_midi.note_name_to_number("C-1"), # Pitch 0
    "staccatissimo": pretty_midi.note_name_to_number("D-1"),   # Pitch 2
    "marcato": pretty_midi.note_name_to_number("D#-1"),         # Pitch 3
    "long_cuivre": pretty_midi.note_name_to_number("E-1"),     # Pitch 4
    "long_sfz": pretty_midi.note_name_to_number("F-1"),        # Pitch 5
    "long_flutter": pretty_midi.note_name_to_number("F#-1"),    # Pitch 6
    "multi_tongue": pretty_midi.note_name_to_number("G-1"),    # Pitch 7

    # WOODWINDS
    "trill_maj2": pretty_midi.note_name_to_number("D-1"),      # Pitch 2
    "trill_min2": pretty_midi.note_name_to_number("D#-1"),     # Pitch 3
    "tenuto": pretty_midi.note_name_to_number("F-1"),          # Pitch 5

    # UNTUNED PERCUSSION
    "anvil": pretty_midi.note_name_to_number("C-1"),           # Pitch 0
    "bass_drum_1": pretty_midi.note_name_to_number("C#-1"),     # Pitch 1
    "bass_drum_2": pretty_midi.note_name_to_number("D-1"),     # Pitch 2
    "cymbal": pretty_midi.note_name_to_number("D#-1"),          # Pitch 3
    "military_drum": pretty_midi.note_name_to_number("E-1"),   # Pitch 4
    "piatti": pretty_midi.note_name_to_number("F-1"),          # Pitch 5
    "snare_1": pretty_midi.note_name_to_number("F#-1"),         # Pitch 6
    "snare_2": pretty_midi.note_name_to_number("G-1"),         # Pitch 7
    "tam_tam": pretty_midi.note_name_to_number("G#-1"),        # Pitch 8
    "tambourine": pretty_midi.note_name_to_number("A-1"),      # Pitch 9
    "tenor_drum": pretty_midi.note_name_to_number("A#-1"),     # Pitch 10
    "toys": pretty_midi.note_name_to_number("B-1"),            # Pitch 11
    "triangle": pretty_midi.note_name_to_number("C0")          # Pitch 12
}

SPITFIRE_UACC = {
    "long": 1,          # Long (Arco)
    "con_sordino": 7,   # Con Sordino
    "flautando": 8,     # Flautando
    "sul_tasto": 9,     # Sul Tasto
    "tremolo": 11,      # Tremolo
    "spiccato": 42,     # Spiccato
    "staccato": 42,     # Staccato
    "pizzicato": 56,    # Pizzicato
    "col_legno": 9,     # Col Legno
    "marcato": 16,      # Marcato
    "harmonics": 15,    # Harmonics

    "anvil": 12,
    "bass_drum_1": 13,
    "bass_drum_2": 14,
    "cymbal": 15,
    "military_drum": 16,
    "piatti": 17,
    "snare_1": 18,
    "snare_2": 19,
    "tam_tam": 20,
    "tambourine": 21,
    "tenor_drum": 22,
    "toys": 23,
    "triangle": 24
}

PERCUSSION_TECHNIQUE_KEYS = [
    "anvil", "bass_drum_1", "bass_drum_2", "cymbal", "military_drum",
    "piatti", "snare_1", "snare_2", "tam_tam", "tambourine",
    "tenor_drum", "toys", "triangle"
]

def detect_articulation(track_name: str = "", program: int = 0, notes: Optional[List] = None) -> Optional[str]:
    text = (track_name or "").lower()

    # Untuned Percussion Specific Techniques
    if "anvil" in text:
        return "anvil"
    if any(k in text for k in ["bass drum 2", "bd 2", "kick 2"]):
        return "bass_drum_2"
    if any(k in text for k in ["bass drum", "bd", "kick", "grancassa"]):
        return "bass_drum_1"
    if any(k in text for k in ["piatti", "crash cymbal", "piatti cymbals", "cinelli"]):
        return "piatti"
    if any(k in text for k in ["cymbal", "ride", "crash", "hi-hat", "hihat"]):
        return "cymbal"
    if any(k in text for k in ["military drum", "march drum"]):
        return "military_drum"
    if any(k in text for k in ["snare 2", "sd 2"]):
        return "snare_2"
    if any(k in text for k in ["snare 1", "snare", "sd", "tamburo", "rullante"]):
        return "snare_1"
    if any(k in text for k in ["tam tam", "tamtam", "gong"]):
        return "tam_tam"
    if "tambourine" in text:
        return "tambourine"
    if any(k in text for k in ["tenor drum", "tom", "toms", "tom-tom", "floor tom", "mid tom", "low tom", "high tom"]):
        return "tenor_drum"
    if any(k in text for k in ["toys", "shaker", "cabasa", "woodblock", "cowbell", "castanets"]):
        return "toys"
    if "triangle" in text:
        return "triangle"

    # General Drumset / Percussion Smart Keyswitch Resolver (Pitch-aware)
    if any(k in text for k in ["drum", "drums", "drumset", "drum kit", "percussion"]) or program in (114, 115, 116, 117, 118, 119, 127):
        if notes and len(notes) > 0:
            avg_pitch = sum(n.pitch for n in notes) / len(notes)
            if avg_pitch < 45:
                return "bass_drum_1"
            elif avg_pitch < 59:
                return "tenor_drum"
            else:
                return "snare_1"
        return "tenor_drum"

    # String Articulations
    if program == 45 or any(k in text for k in ["pizz", "plucked", "pizzicato"]):
        return "pizzicato"
    if any(k in text for k in ["spicc", "spiccato"]):
        return "spiccato"
    if any(k in text for k in ["stacc", "staccato", "short"]):
        return "staccato"
    if (program in [48, 49] and "trem" in text) or any(k in text for k in ["trem", "tremolo"]):
        return "tremolo"
    if any(k in text for k in ["col legno", "legno"]):
        return "col_legno"
    if any(k in text for k in ["sord", "sordino", "muted"]):
        return "con_sordino"
    if "marcato" in text:
        return "marcato"
    if "flautando" in text or ("flaut" in text and not any(f in text for f in ["flauto", "flauti", "flute"])):
        return "flautando"
    if "harmonic" in text:
        return "harmonics"
    return None

def resolve_vst_preset(track_patch: str = "auto", program: int = 0, track_name: str = "", articulation: Optional[str] = None, notes: Optional[List] = None) -> Optional[str]:
    """
    5-Step / 2-Pass VST Preset Resolution Engine:
    - Pass 0: Manual user selection / override (track_patch != 'auto')
    - Pass 1: Search matching BBC SO presets & Untuned Percussion keyswitches (ignoring Non-BBC presets)
    - Pass 2: Search matching Non-BBC SO presets (Epic Choir, Cinematic Percussion, British BTK)
    - Fallback: Returns None if no preset matches (triggering explicit fallback logging).
    """
    preset_dir = os.path.join(PROJECT_ROOT, 'storage', 'vst_presets')
    if not os.path.exists(preset_dir):
        return None

    files = [f for f in os.listdir(preset_dir) if f.lower().endswith('.vstpreset') and not any(k in f.lower() for k in ["reverb", "air studios"])]
    if not files:
        return None

    articulation = articulation or detect_articulation(track_name, program)
    combined_text = f"{track_patch or ''} {track_name or ''} {articulation or ''}".lower()

    # Pass 0: Direct exact filename or patch ID match (Manual User Selection)
    if track_patch and track_patch != "auto":
        clean_req = track_patch.lower().strip()
        for f in files:
            f_clean = f.lower()
            if f_clean == clean_req or f_clean == f"{clean_req}.vstpreset" or f_clean.replace(".vstpreset", "") == clean_req:
                return os.path.join(preset_dir, f)
            stem = f_clean.replace(".vstpreset", "")
            parts = stem.split(" ", 1)
            inst_name = parts[1] if len(parts) == 2 else stem
            patch_id = inst_name.replace(" ", "_")
            if patch_id == clean_req or stem.replace(" ", "_") == clean_req:
                return os.path.join(preset_dir, f)
        # Check if manual patch is an untuned percussion technique
        if clean_req in PERCUSSION_TECHNIQUE_KEYS or any(k in clean_req for k in ["snare", "drum", "piatti", "cymbal", "anvil", "tam_tam", "tambourine"]):
            for f in files:
                if "untuned percussion" in f.lower():
                    return os.path.join(preset_dir, f)

    # Preset categorization helper: returns True if preset is Non-BBC SO
    def _is_non_bbc(filename: str) -> bool:
        f_lower = filename.lower()
        return any(f_lower.endswith(s.lower()) for s in [
            " - epic choir.vstpreset",
            " - cinematic percussion.vstpreset",
            " - british tool kit.vstpreset",
            " - aperture the stack.vstpreset",
            " - kontakt.vstpreset"
        ]) or any(k in f_lower for k in ["epic choir", "cinematic percussion", "british tool kit", "aperture", "kontakt"])

    # Core instrument matching logic for a given preset file subset
    def _match_in_files(file_subset: List[str]) -> Optional[str]:
        # Category map for stripped filenames (e.g. "Strings celli.vstpreset" -> "celli.vstpreset")
        preset_map = {}
        for f in file_subset:
            clean_f = f.lower()
            for prefix in ["strings ", "woodwind ", "woodwinds ", "brass ", "percussion ", "saxophones ", "recorders "]:
                if clean_f.startswith(prefix):
                    clean_f = clean_f[len(prefix):]
            preset_map[f] = clean_f

        # 1. Non-BBC Collections (Epic Choir, Cinematic Percussion, British BTK)
        if any(k in combined_text for k in ["choir", "vocal", "vocals", "voice", "voices", "epic choir"]) or program in (52, 53, 54):
            is_staccato = (articulation == "staccato") or any(k in combined_text for k in ["staccato", "short", "syllable", "syllables"])
            if any(k in combined_text for k in ["tenor", "tenore", "bass", "basso", "baritone", "baritono", "men", "male"]) or "tenor and bass" in combined_text:
                if is_staccato:
                    for f in file_subset:
                        if "choir tenor and bass short staccato syllables" in f.lower():
                            return os.path.join(preset_dir, f)
                for f in file_subset:
                    if "choir tenor and bass long ahh" in f.lower():
                        return os.path.join(preset_dir, f)
            else:
                if is_staccato:
                    for f in file_subset:
                        if "choir soprano and alto short staccato syllables" in f.lower():
                            return os.path.join(preset_dir, f)
                for f in file_subset:
                    if "choir soprano and alto long ahh" in f.lower():
                        return os.path.join(preset_dir, f)

        if any(k in combined_text for k in ["earthquake", "sub hit", "impact", "cinematic bass"]):
            for f in file_subset:
                if "earthquake hits" in f.lower(): return os.path.join(preset_dir, f)
        if any(k in combined_text for k in ["metal hit", "metallic hit"]):
            for f in file_subset:
                if "metal hits" in f.lower(): return os.path.join(preset_dir, f)
        if any(k in combined_text for k in ["percussion high", "hi hit"]):
            for f in file_subset:
                if "percussions hits - high" in f.lower(): return os.path.join(preset_dir, f)
        if any(k in combined_text for k in ["percussion low", "low hit"]):
            for f in file_subset:
                if "percussions hits - low" in f.lower(): return os.path.join(preset_dir, f)
        if any(k in combined_text for k in ["swell", "crescendo", "roll"]):
            for f in file_subset:
                if "swells" in f.lower(): return os.path.join(preset_dir, f)
        if any(k in combined_text for k in ["tams", "gong"]):
            for f in file_subset:
                if "tams and gongs" in f.lower(): return os.path.join(preset_dir, f)

        # Aperture & Kontakt Guitar/Synth Presets
        if any(k in combined_text for k in ["electric guitar", "eguitar", "distorted guitar", "overdriven guitar"]):
            for f in file_subset:
                if "electric guitar - aperture the stack" in f.lower(): return os.path.join(preset_dir, f)

        if any(k in combined_text for k in ["synth", "synthesizer", "lead synth", "synth pad", "pad"]) and not any(k in combined_text for k in ["choir", "voice", "string", "strings", "brass"]):
            for f in file_subset:
                if "synth - aperture the stack" in f.lower(): return os.path.join(preset_dir, f)

        if "banjo" in combined_text:
            for f in file_subset:
                if "guitar solo banjo - kontakt" in f.lower(): return os.path.join(preset_dir, f)

        if any(k in combined_text for k in ["mandolin", "mandolino"]):
            for f in file_subset:
                if "guitar solo mandolin - kontakt" in f.lower(): return os.path.join(preset_dir, f)

        if any(k in combined_text for k in ["folk ensemble", "plucked folk", "folk guitar"]):
            for f in file_subset:
                if "guitar plucked folk ensemble - kontakt" in f.lower(): return os.path.join(preset_dir, f)

        if any(k in combined_text for k in ["acoustic guitar", "nylon guitar", "steel guitar", "chitarra"]):
            for f in file_subset:
                if "guitar solo guitar - kontakt" in f.lower(): return os.path.join(preset_dir, f)

        if any(k in combined_text for k in ["alto sax", "bass sax", "saxophone", "sax"]) or program in (64, 65, 66, 67):
            if "bass sax" in combined_text or program == 67:
                for f in file_subset:
                    if "bass sax" in f.lower(): return os.path.join(preset_dir, f)
            elif "alto sax" in combined_text or program == 65:
                for f in file_subset:
                    if "alto sax" in f.lower(): return os.path.join(preset_dir, f)
            for f in file_subset:
                if "saxophone ensemble" in f.lower() or "sax" in f.lower(): return os.path.join(preset_dir, f)

        if "flugelhorn" in combined_text:
            for f in file_subset:
                if "flugelhorn" in f.lower(): return os.path.join(preset_dir, f)
        if "recorder" in combined_text or program == 74:
            for f in file_subset:
                if "recorder" in f.lower(): return os.path.join(preset_dir, f)
        if any(k in combined_text for k in ["cor anglais", "english horn"]) or program == 69:
            for f in file_subset:
                if "cor anglais" in f.lower() or "english horn" in f.lower(): return os.path.join(preset_dir, f)
        if any(k in combined_text for k in ["brass combi", "brass ensemble", "brass section"]) or program == 61:
            for f in file_subset:
                if "brass combis" in f.lower(): return os.path.join(preset_dir, f)

        # 2. Specific Tuned Percussion & Untuned Percussion
        if any(k in combined_text for k in ["timpani", "timpano"]) or program == 47:
            for f, clean in preset_map.items():
                if "timpani" in clean: return os.path.join(preset_dir, f)
        if any(k in combined_text for k in ["harp", "arpa"]) or program == 46:
            for f, clean in preset_map.items():
                if "harp" in clean: return os.path.join(preset_dir, f)
        if "celeste" in combined_text or "celesta" in combined_text or program == 8:
            for f, clean in preset_map.items():
                if "celeste" in clean: return os.path.join(preset_dir, f)
        if "marimba" in combined_text or program == 12:
            for f, clean in preset_map.items():
                if "marimba" in clean: return os.path.join(preset_dir, f)
        if "xylophone" in combined_text or program == 13:
            for f, clean in preset_map.items():
                if "xylophone" in clean: return os.path.join(preset_dir, f)
        if "vibraphone" in combined_text or program == 11:
            for f, clean in preset_map.items():
                if "vibraphone" in clean: return os.path.join(preset_dir, f)
        if "glockenspiel" in combined_text or program == 9:
            for f, clean in preset_map.items():
                if "glockenspiel" in clean: return os.path.join(preset_dir, f)
        if "tubular" in combined_text or "bells" in combined_text or program == 14:
            for f, clean in preset_map.items():
                if "tubular" in clean or "bells" in clean: return os.path.join(preset_dir, f)
        if "crotales" in combined_text:
            for f, clean in preset_map.items():
                if "crotales" in clean: return os.path.join(preset_dir, f)

        # Untuned Percussion (Evaluated before string/woodwind/brass program numbers if percussion text or program 114-127 is present)
        is_untuned_perc = articulation in PERCUSSION_TECHNIQUE_KEYS or any(k in combined_text for k in ["untuned", "anvil", "piatti", "cinelli", "snare", "rullante", "tamburo", "grancassa", "military drum", "tam tam", "tamtam", "tambourine", "tenor drum", "toys", "drum", "drums", "percussion", "tom", "toms", "floor tom", "mid tom", "low tom", "high tom"]) or program in (114, 115, 116, 117, 118, 119, 127)
        if is_untuned_perc:
            for f in file_subset:
                if "untuned percussion" in f.lower():
                    return os.path.join(preset_dir, f)

        # 3. Strings
        if (any(k in combined_text for k in ["contrabass", "contrabbassi", "contrabassi", "contrabasso", "double bass", "doublebass", "upright bass", "basses"]) or program in (43, 110)) and "contrabassoon" not in combined_text and "controfagotto" not in combined_text:
            for f, clean in preset_map.items():
                if "basses" in clean or "double bass" in clean or "contrabass" in clean: return os.path.join(preset_dir, f)
            for f, clean in preset_map.items():
                if "bass" in clean and "trombone" not in clean and "sax" not in clean and "bassoon" not in clean: return os.path.join(preset_dir, f)
        if any(k in combined_text for k in ["violoncello", "violoncelli", "cello", "celli"]) or program == 42:
            for f, clean in preset_map.items():
                if "celli" in clean or "cello" in clean: return os.path.join(preset_dir, f)
        if any(k in combined_text for k in ["viola", "viole"]) or program == 41:
            for f, clean in preset_map.items():
                if "viola" in clean: return os.path.join(preset_dir, f)
        if any(k in combined_text for k in ["violin 2", "violin2", "2nd violin", "violin ii", "violins 2", "violini 2", "violini ii"]):
            for f, clean in preset_map.items():
                if "violin 2" in clean or "violins 2" in clean or "violin2" in clean: return os.path.join(preset_dir, f)
        if (any(k in combined_text for k in ["violin", "violins", "violini", "violino", "string", "strings"]) or program in (40, 48, 49, 50, 51)) and not is_untuned_perc:
            # Pitch-aware resolution for generic String Ensemble tracks
            has_specific_section = any(k in combined_text for k in ["violin 2", "violin2", "2nd violin", "violin ii", "violins 2", "violini 2", "violini ii", "violin 1", "violin1", "1st violin", "violin i", "violini 1", "violini i"])
            if not has_specific_section and notes and len(notes) > 0:
                avg_pitch = sum(n.pitch for n in notes) / len(notes)
                if avg_pitch < 48:
                    for f, clean in preset_map.items():
                        if "basses" in clean or "double bass" in clean: return os.path.join(preset_dir, f)
                elif avg_pitch < 58:
                    for f, clean in preset_map.items():
                        if "celli" in clean or "cello" in clean: return os.path.join(preset_dir, f)
                elif avg_pitch < 67:
                    for f, clean in preset_map.items():
                        if "viola" in clean: return os.path.join(preset_dir, f)
                elif avg_pitch < 74:
                    for f, clean in preset_map.items():
                        if "violin 2" in clean or "violins 2" in clean: return os.path.join(preset_dir, f)
                else:
                    for f, clean in preset_map.items():
                        if "violin 1" in clean or "violin1" in clean: return os.path.join(preset_dir, f)
            for f, clean in preset_map.items():
                if "violin 1" in clean or "violin1" in clean: return os.path.join(preset_dir, f)

        # 4. Woodwinds
        if any(k in combined_text for k in ["piccolo", "ottavino"]):
            for f, clean in preset_map.items():
                if "piccolo" in clean: return os.path.join(preset_dir, f)
        if any(k in combined_text for k in ["flute", "flauto", "flauti"]) or program == 73:
            for f, clean in preset_map.items():
                if "flute" in clean: return os.path.join(preset_dir, f)
        if any(k in combined_text for k in ["cor anglais", "english horn"]) or program == 69:
            for f in file_subset:
                if "cor anglais" in f.lower() or "english horn" in f.lower():
                    return os.path.join(preset_dir, f)
        if "oboe" in combined_text or program == 68:
            for f, clean in preset_map.items():
                if "oboe" in clean: return os.path.join(preset_dir, f)
        if any(k in combined_text for k in ["clarinet", "clarinetto", "clarinetti"]) or program == 71:
            for f, clean in preset_map.items():
                if "clarinet" in clean: return os.path.join(preset_dir, f)
        if any(k in combined_text for k in ["contrabassoon", "controfagotto"]):
            for f in files:
                if "contrabassoon" in f.lower() or "controfagotto" in f.lower(): return os.path.join(preset_dir, f)
        if any(k in combined_text for k in ["bassoon", "fagotto", "fagotti"]) or program == 70:
            for f, clean in preset_map.items():
                if "bassoon" in clean: return os.path.join(preset_dir, f)

        is_choir_track = any(k in combined_text for k in ["choir", "vocal", "sing", "chorus"]) or (52 <= program <= 54)

        # 5. Brass
        if (any(k in combined_text for k in ["french horn", "horn", "corno", "corni"]) or program == 60) and "english horn" not in combined_text and "cor anglais" not in combined_text and not is_choir_track:
            for f, clean in preset_map.items():
                if "horn" in clean and "flugelhorn" not in clean: return os.path.join(preset_dir, f)
        if (any(k in combined_text for k in ["trumpet", "tromba", "trombe"]) or program == 56) and not is_choir_track:
            for f, clean in preset_map.items():
                if "trumpet" in clean: return os.path.join(preset_dir, f)
        if (any(k in combined_text for k in ["trombone", "tromboni"]) or program in (57, 109)) and not is_choir_track:
            if "bass" in combined_text or "basso" in combined_text:
                for f, clean in preset_map.items():
                    if "bass trombone" in clean or "bass trombones" in clean: return os.path.join(preset_dir, f)
            if "tenor" in combined_text or program == 57:
                for f, clean in preset_map.items():
                    if "tenor trombone" in clean: return os.path.join(preset_dir, f)
            for f, clean in preset_map.items():
                if "trombone" in clean: return os.path.join(preset_dir, f)
        if "tuba" in combined_text or program == 58:
            for f, clean in preset_map.items():
                if "tuba" in clean: return os.path.join(preset_dir, f)

        # 6. Choir (Voice Range / Gender Aware)
        is_choir_track = any(k in combined_text for k in ["choir", "voice", "vocal", "sing", "chorus"]) or (52 <= program <= 54)
        if is_choir_track:
            if any(k in combined_text for k in ["tenor", "tenore", "bass", "basso", "baritone", "baritono"]):
                for f in file_subset:
                    if "tenor and bass" in f.lower(): return os.path.join(preset_dir, f)
            for f in file_subset:
                if "soprano and alto" in f.lower(): return os.path.join(preset_dir, f)

        return None

    # PASS 1: Search Non-BBC presets FIRST if track name explicitly specifies a Non-BBC instrument
    non_bbc_files = [f for f in files if _is_non_bbc(f)]
    bbc_files = [f for f in files if not _is_non_bbc(f)]

    has_non_bbc_keyword = any(k in (track_name or "").lower() for k in ["controfagotto", "contrabassoon", "choir", "vocal", "sing", "chorus", "epic choir", "cinematic percussion", "british tool kit", "british drama"]) or (52 <= program <= 54)

    if has_non_bbc_keyword:
        res = _match_in_files(non_bbc_files)
        if res:
            return res

    # PASS 2: Search BBC SO Presets
    pass1_res = _match_in_files(bbc_files)
    if pass1_res:
        return pass1_res

    # PASS 3: Search Non-BBC SO Presets (Epic Choir, Cinematic Percussion, British BTK)
    pass2_res = _match_in_files(non_bbc_files)
    if pass2_res:
        return pass2_res

    # PASS 3: Category-Aware Smart Fallback System
    # If no specific preset matched, infer instrument category from text and GM program
    if any(k in combined_text for k in ["percussion", "perc", "drum", "drums", "tom", "toms", "strike", "hit", "beat", "cymbal"]) or program in (114, 115, 116, 117, 118, 119, 127):
        for f in files:
            if "untuned percussion" in f.lower():
                return os.path.join(preset_dir, f)

    if any(k in combined_text for k in ["brass", "horn", "trumpet", "trombone", "tuba", "cornet"]) or (56 <= program <= 63):
        for f in files:
            if "brass horn" in f.lower() or "horn" in f.lower():
                return os.path.join(preset_dir, f)

    if any(k in combined_text for k in ["woodwind", "flute", "wind", "pipe", "reed"]) or (68 <= program <= 79):
        for f in files:
            if "woodwind flute" in f.lower() or "flute" in f.lower():
                return os.path.join(preset_dir, f)

    if any(k in combined_text for k in ["string", "strings", "violin", "viola", "cello", "bass", "bowed", "fiddle"]) or (40 <= program <= 45 or 48 <= program <= 51):
        for f in files:
            if "strings violin 1" in f.lower() or "violin 1" in f.lower():
                return os.path.join(preset_dir, f)

    if any(k in combined_text for k in ["choir", "voice", "vocal", "sing"]) or (52 <= program <= 54):
        for f in files:
            if "choir soprano and alto long ahh" in f.lower():
                return os.path.join(preset_dir, f)

    # Ultimate fallback: Default to Violin 1 if zero category keywords matched
    for f in files:
        if "strings violin 1" in f.lower() or "violin 1" in f.lower():
            return os.path.join(preset_dir, f)


def get_vst3_plugin_path(preset_path: Optional[str] = None, default_vst3_path: Optional[str] = None) -> str:
    """Resolve the appropriate VST3 plugin DLL path based on preset name (Splice INSTRUMENT, British Drama Toolkit, Aperture the Stack, Kontakt 8, or BBC SO)."""
    bbc_dll = r"C:\Program Files\Common Files\VST3\BBC Symphony Orchestra (64 Bit).vst3\Contents\x86_64-win\BBC Symphony Orchestra (64 Bit).vst3"
    splice_dll = r"C:\Program Files\Common Files\VST3\Splice\Splice INSTRUMENT.vst3\Contents\x86_64-win\Splice INSTRUMENT.vst3"
    bdt_dll = r"C:\Program Files\Common Files\VST3\British Drama Toolkit.vst3"
    aperture_dll = r"C:\Program Files\Common Files\VST3\Aperture - The Stack.vst3"
    kontakt_dll = r"C:\Program Files\Common Files\VST3\Kontakt 8.vst3"
    air_reverb_dll = r"C:\Program Files\Common Files\VST3\AIR Studios Reverb Essentials.vst3"

    def _resolve_binary_file(path_str: Optional[str]) -> Optional[str]:
        if not path_str or not os.path.exists(path_str):
            return None
        if os.path.isfile(path_str):
            if path_str.lower().endswith(".vst3") or "vst" in path_str.lower():
                return path_str
            return None
        base = os.path.basename(path_str)
        inner = os.path.join(path_str, "Contents", "x86_64-win", base)
        if os.path.isfile(inner):
            return inner
        win_dir = os.path.join(path_str, "Contents", "x86_64-win")
        if os.path.exists(win_dir):
            for f in os.listdir(win_dir):
                if f.lower().endswith(".vst3"):
                    return os.path.join(win_dir, f)
        return None

    if preset_path:
        p_lower = preset_path.lower()
        if any(k in p_lower for k in ["air studios", "air reverb", "reverb essentials"]):
            res = _resolve_binary_file(air_reverb_dll)
            if res: return res
        if any(k in p_lower for k in ["epic choir", "cinematic percussion", "splice"]):
            if os.path.exists(splice_dll):
                return splice_dll
        if any(k in p_lower for k in ["british tool kit", "british drama"]):
            if os.path.exists(bdt_dll):
                return bdt_dll
        if any(k in p_lower for k in ["aperture", "the stack"]):
            res = _resolve_binary_file(aperture_dll)
            if res: return res
        if any(k in p_lower for k in ["kontakt"]):
            res = _resolve_binary_file(kontakt_dll)
            if res: return res

    resolved_default = _resolve_binary_file(default_vst3_path)
    if resolved_default:
        return resolved_default

    resolved_bbc = _resolve_binary_file(bbc_dll)
    if resolved_bbc:
        return resolved_bbc

    return default_vst3_path or bbc_dll


def render_midi_to_wav_with_vst3(
    midi_path: str,
    vst3_path: str,
    out_wav_path: str,
    gain: float = None,
    preset_path: str = None
) -> str:
    """Render MIDI to WAV using Pedalboard VST3 host with Spitfire .vstpreset support."""
    import numpy as np
    from scipy.io import wavfile
    import pretty_midi
    import mido
    from pedalboard import load_plugin

    _log(f"Rendering MIDI via Spitfire VST3 engine ({vst3_path}) -> {out_wav_path}")
    
    dll_path = get_vst3_plugin_path(preset_path, vst3_path)
    plugin = load_plugin(dll_path)

    # Load preset if provided
    if preset_path and os.path.exists(preset_path):
        try:
            plugin.load_preset(preset_path)
            _log(f"Loaded VST3 preset: {preset_path}")
        except Exception as p_err:
            _log(f"Notice: Failed to load VST3 preset {preset_path}: {p_err}")

    pm = pretty_midi.PrettyMIDI(midi_path)
    duration_sec = max(3.0, pm.get_end_time() + 2.0)
    
    messages = []
    for inst in pm.instruments:
        for n in inst.notes:
            messages.append(mido.Message('note_on', note=n.pitch, velocity=n.velocity, time=max(0.0, n.start)))
            messages.append(mido.Message('note_off', note=n.pitch, velocity=0, time=n.end))
            
    if not messages:
        messages.append(mido.Message('note_on', note=60, velocity=100, time=0.0))
        messages.append(mido.Message('note_off', note=60, velocity=0, time=2.0))
        
    messages.sort(key=lambda m: m.time)
    
    sample_rate = 48000.0
    audio = plugin(messages, duration=duration_sec, sample_rate=sample_rate, reset=False)
    if audio.ndim == 2:
        audio = audio.T
        
    if gain is not None:
        audio = audio * gain
        
    max_val = np.max(np.abs(audio))
    if max_val <= 0:
        raise ValueError("VST3 engine returned silent audio")
        
    audio = (audio / max_val) * 0.9
    sf.write(out_wav_path, audio, int(sample_rate), subtype='PCM_24')
    _log(f"Spitfire VST3 Render Complete: {out_wav_path} (48kHz/24-bit, Peak: {max_val:.4f})")
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
    interpolation: int = None,
    peak_ceiling_db: float = None
) -> str:
    """Render MIDI to WAV using FluidSynth with optimized audio parameters."""
    resolved_sf = resolve_soundfont_path(soundfont_path)
    if not os.path.exists(resolved_sf) or resolved_sf.lower().endswith('.vst3'):
        # Fall back to high-definition active SoundFont
        storage_dir = os.path.join(PROJECT_ROOT, 'storage')
        resolved_sf = None
        for candidate in ["SGM-V2.01.sf2", "FluidR3_GM.sf2", "ChoriumRevA.sf2", "Salamander.sf2", "GeneralUser_GS.sf2"]:
            c_path = os.path.join(storage_dir, candidate)
            if os.path.exists(c_path):
                resolved_sf = c_path
                break
        if not resolved_sf:
            resolved_sf = SOUNDFONT
            
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
        polyphony = int(settings.get("polyphony", 1024))
    if interpolation is None:
        interpolation = int(settings.get("interpolation", 7))
    if peak_ceiling_db is None:
        peak_ceiling_db = float(settings.get("peak_ceiling_db", -6.0))

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
        '-o', f'synth.polyphony={max(1024, polyphony)}',
        '-o', 'synth.cpu-cores=4',
        '-o', 'synth.overflow.sustained=0',
        '-o', 'synth.overflow.released=0',
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
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            _log(f"FluidSynth error: {result.stderr}")
            raise RuntimeError(f"FluidSynth failed: {result.stderr}")
            
        normalize_wav_file(out_wav_path, target_peak_db=peak_ceiling_db)
        _log(f"Render complete: {out_wav_path} (peak_ceiling_db={peak_ceiling_db})")
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


def inject_auto_expression_controllers(inst: pretty_midi.Instrument, enable: bool = True):
    """Inject ultra-smooth 50ms interpolated CC #11 Expression curves for sustained orchestral notes."""
    if not enable:
        return

    sustain_programs = {40, 41, 42, 43, 44, 45, 46, 48, 49, 50, 51, 56, 57, 58, 60, 68, 70, 71, 73}
    if inst.program not in sustain_programs:
        return

    # Sort notes by start time
    notes = sorted(inst.notes, key=lambda n: n.start)
    if not notes:
        return

    # Find long notes (> 1.2 seconds) that benefit from gentle swell
    long_notes = [n for n in notes if (n.end - n.start) >= 1.2]
    if not long_notes:
        return

    import numpy as np

    # Clear existing CC1/CC11 to prevent conflicting step jumps
    inst.control_changes = [cc for cc in inst.control_changes if cc.number not in (1, 11)]

    # High-density 50ms step interpolation (20 updates/sec) for silky smooth glides
    step_sec = 0.05
    for note in long_notes:
        start_t = note.start
        end_t = note.end
        duration = end_t - start_t
        base_val = max(50, min(115, note.velocity))

        t = start_t
        while t <= end_t:
            rel_t = (t - start_t) / duration # 0.0 to 1.0
            
            # Smooth sine arch (gentle +/- 12% swell without abrupt volume jumps)
            swell_factor = 0.88 + (0.22 * np.sin(rel_t * np.pi))
            cc11_val = int(np.clip(base_val * swell_factor, 40, 125))

            inst.control_changes.append(pretty_midi.ControlChange(number=11, value=cc11_val, time=t))
            t += step_sec


def get_orchestral_seating_pan(program: int, track_patch: str) -> float:
    """Return stereo pan position (-1.0 Hard Left to +1.0 Hard Right) based on authentic symphonic seating."""
    patch_pans = {
        "violins_1": -0.65,
        "violins_2": -0.35,
        "violas": 0.20,
        "celli": 0.65,
        "double_basses": 0.80,
        "flutes": -0.10,
        "oboes": -0.05,
        "clarinets": 0.05,
        "bassoons": 0.10,
        "horns": -0.30,
        "trumpets": 0.25,
        "trombones": 0.35,
        "tuba": 0.45,
        "timpani": 0.35,
        "harp": -0.45,
        "grand_piano": 0.0,
        "tutti": 0.0
    }
    if track_patch in patch_pans:
        return patch_pans[track_patch]

    # Default GM program seating map
    if program in [40, 48]: # Violin 1 / Strings 1
        return -0.65
    elif program in [41, 49]: # Viola / Strings 2
        return 0.20
    elif program == 42: # Cello
        return 0.65
    elif program == 43: # Contrabass
        return 0.80
    elif program in [73, 68]: # Flute / Oboe
        return -0.10
    elif program in [71, 70]: # Clarinet / Bassoon
        return 0.10
    elif program == 60: # French Horn
        return -0.30
    elif program in [56, 57, 58]: # Trumpet / Trombone / Tuba
        return 0.30
    elif program == 46: # Harp
        return -0.45
    elif program == 47: # Timpani
        return 0.35
    return 0.0


_VST_PLUGIN_CACHE = {}


def render_orchestrator_tracks(
    pm: pretty_midi.PrettyMIDI,
    speaker_track_indices: List[int],
    job_sf_name: str,
    tracks_config: Dict[str, Any],
    out_wav_path: str,
    reverb_enabled: bool = True,
    reverb_room_size: float = 0.55,
    reverb_preset: Optional[str] = None,
    peak_ceiling_db: float = -6.0,
    time_shift: float = 0.0,
    is_preview: bool = False,
    progress_callback: Optional[Any] = None
) -> str:
    """Render backing speaker tracks in parallel concurrently using per-track tracks_config settings and symphonic seating."""
    import numpy as np
    from scipy.io import wavfile
    import copy
    from concurrent.futures import ThreadPoolExecutor
    
    if not speaker_track_indices:
        return None

    tracks_config = tracks_config or {}
    temp_dir = tempfile.mkdtemp()
    
    try:
        sample_rate = 48000
        
        patch_map = {
            "violins_1": 40,
            "violins_2": 40,
            "violas": 41,
            "celli": 42,
            "double_basses": 43,
            "flutes": 73,
            "oboes": 68,
            "clarinets": 71,
            "bassoons": 70,
            "horns": 60,
            "trumpets": 56,
            "trombones": 57,
            "tuba": 58,
            "timpani": 47,
            "harp": 46,
            "grand_piano": 0,
            "tutti": 48
        }

        # Stage 1: Pre-initialize plugin instances & presets on main thread
        render_tasks = []
        for idx in speaker_track_indices:
            if idx >= len(pm.instruments):
                continue
                
            orig_inst = pm.instruments[idx]
            track_cfg = tracks_config.get(str(idx), {}) or tracks_config.get(idx, {})
            
            track_sf = track_cfg.get("soundfont") or job_sf_name
            if track_sf and (track_sf.lower().endswith(".sf2") or "sf2" in track_sf.lower()):
                track_sf = None
            sf_path = resolve_soundfont_path(track_sf) if track_sf else None
            
            track_gain = float(track_cfg.get("gain", 1.0))
            track_transpose = int(track_cfg.get("transpose", 0))
            track_patch = track_cfg.get("instrument_patch", "auto")
            
            single_pm = pretty_midi.PrettyMIDI()
            new_inst = copy.deepcopy(orig_inst)
            
            if track_patch in patch_map:
                new_inst.program = patch_map[track_patch]
                _log(f"Track {idx} mapped to instrument patch '{track_patch}' (GM Program {new_inst.program})")
            
            if time_shift > 0 or track_transpose != 0:
                for n in new_inst.notes:
                    if time_shift > 0:
                        n.start = max(0.0, n.start - time_shift)
                        n.end = max(0.0, n.end - time_shift)
                    if track_transpose != 0:
                        n.pitch = max(0, min(127, n.pitch + track_transpose))
                for cc in new_inst.control_changes:
                    if time_shift > 0:
                        cc.time = max(0.0, cc.time - time_shift)
                    
            single_pm.instruments.append(new_inst)
            
            stem_midi = os.path.join(temp_dir, f"track_{idx}.mid")
            stem_wav = os.path.join(temp_dir, f"track_{idx}.wav")
            single_pm.write(stem_midi)
            
            user_art = track_cfg.get("articulation", "auto")
            articulation = user_art if user_art != "auto" else detect_articulation(orig_inst.name, new_inst.program, notes=new_inst.notes)

            task = {
                "idx": idx,
                "program": new_inst.program,
                "track_patch": track_patch,
                "articulation": articulation,
                "sf_path": sf_path,
                "stem_midi": stem_midi,
                "stem_wav": stem_wav,
                "track_gain": track_gain,
                "vst_preset": None,
                "plugin_obj": None
            }
            
            # Resolve VST preset for track (always attempted for all jobs)
            vst_preset = resolve_vst_preset(track_patch, new_inst.program, track_name=orig_inst.name, articulation=articulation, notes=new_inst.notes)
            task["vst_preset"] = vst_preset
            
            # Pre-instantiate VST3 plugin if VST preset matched OR user explicitly selected a VST3 soundfont
            use_vst = (vst_preset is not None) or (sf_path and ('vst' in sf_path.lower() or sf_path.lower().endswith('.vst3')))
            if use_vst:
                from pedalboard import load_plugin
                dll_path = get_vst3_plugin_path(vst_preset, sf_path)
                try:
                    # Create a fresh, dedicated plugin instance for this specific track
                    plugin_obj = load_plugin(dll_path)
                    if vst_preset and os.path.exists(vst_preset):
                        try:
                            plugin_obj.load_preset(vst_preset)
                            _log(f"Track {idx}: Dedicated VST3 instance ({os.path.basename(dll_path)}) loaded preset {os.path.basename(vst_preset)}")
                        except Exception as p_err:
                            plugin_obj.raw_state = open(vst_preset, 'rb').read()
                            _log(f"Track {idx}: Dedicated VST3 instance ({os.path.basename(dll_path)}) raw-state preset {os.path.basename(vst_preset)}")
                    else:
                        _log(f"Track {idx} ('{orig_inst.name}'): No matching VST preset found. Defaulting to BBC SO plugin default (Violin 1).")
                    task["plugin_obj"] = plugin_obj
                except Exception as init_err:
                    _log(f"Track {idx}: VST3 pre-init notice ({dll_path}): {init_err}")
                    
            render_tasks.append(task)

        used_fallbacks = []

        # Stage 2: Render audio buffers in parallel concurrently across worker threads
        def _execute_render_task(task):
            idx = task["idx"]
            stem_midi = task["stem_midi"]
            stem_wav = task["stem_wav"]
            sf_path = task["sf_path"]
            track_gain = task["track_gain"]
            plugin_obj = task["plugin_obj"]
            articulation = task.get("articulation")
            vst_preset = task.get("vst_preset")
            
            if plugin_obj is not None:
                try:
                    import mido
                    pm_task = pretty_midi.PrettyMIDI(stem_midi)
                    full_duration = max(3.0, pm_task.get_end_time() + 2.0)
                    duration_sec = min(60.0, full_duration) if (is_preview and full_duration > 60.0) else full_duration
                    
                    messages = []
                    # Inject Spitfire Keyswitch & UACC (CC32) at t=0s if an articulation is active (BBC SO only)
                    is_non_bbc_inst = vst_preset and any(k in vst_preset.lower() for k in ["epic choir", "cinematic percussion", "splice", "british tool kit", "british drama", "aperture", "kontakt"])
                    if not is_non_bbc_inst and articulation and articulation in SPITFIRE_KEYSWITCHES:
                        ks_pitch = SPITFIRE_KEYSWITCHES[articulation]
                        messages.append(mido.Message('note_on', note=ks_pitch, velocity=127, time=0.0, channel=0))
                        messages.append(mido.Message('note_off', note=ks_pitch, velocity=0, time=0.04, channel=0))
                        
                        if articulation in SPITFIRE_UACC:
                            uacc_val = SPITFIRE_UACC[articulation]
                            messages.append(mido.Message('control_change', control=32, value=uacc_val, time=0.0, channel=0))
                            
                        _log(f"Track {idx}: Injected Spitfire Keyswitch (Pitch {ks_pitch}) + UACC CC32 ({SPITFIRE_UACC.get(articulation, 'N/A')}) for {articulation.upper()} at t=0s")

                    # Apply 50ms lead offset so keyswitch takes effect before musical notes sound
                    lead_offset = 0.05 if (not is_non_bbc_inst and articulation and articulation in SPITFIRE_KEYSWITCHES) else 0.0
                    for inst in pm_task.instruments:
                        for n in inst.notes:
                            start_t = n.start + lead_offset
                            if is_preview and start_t >= duration_sec:
                                continue
                            n_end = min(n.end + lead_offset, duration_sec) if is_preview else (n.end + lead_offset)
                            if n_end > start_t:
                                messages.append(mido.Message('note_on', note=n.pitch, velocity=n.velocity, time=start_t, channel=0))
                                messages.append(mido.Message('note_off', note=n.pitch, velocity=0, time=n_end, channel=0))
                    if not messages:
                        messages.append(mido.Message('note_on', note=60, velocity=100, time=0.0))
                        messages.append(mido.Message('note_off', note=60, velocity=0, time=2.0))
                    messages.sort(key=lambda m: m.time)
                    
                    time.sleep(idx * 0.4)
                    audio = plugin_obj(messages, duration=duration_sec, sample_rate=48000.0, reset=False)
                    if audio.ndim == 2:
                        audio = audio.T
                    if track_gain is not None:
                        audio = audio * track_gain
                    max_val = np.max(np.abs(audio))
                    if max_val > 0:
                        headroom_limit = min(0.85, 0.85 / np.sqrt(max(1.0, float(len(speaker_track_indices)))))
                        audio = (audio / max_val) * headroom_limit
                        sf.write(stem_wav, audio, 48000, subtype='PCM_24')
                except Exception as vst_exec_err:
                    _log(f"Track {idx}: Parallel VST3 audio processing notice ({vst_exec_err}), falling back to SoundFont...")
                    used_fallbacks.append(True)
                    fb_sf = os.path.join(PROJECT_ROOT, 'storage', 'FluidR3_GM.sf2')
                    if not os.path.exists(fb_sf):
                        fb_sf = os.path.join(PROJECT_ROOT, 'storage', 'SGM-V2.01.sf2')
                    render_midi_to_wav_with_soundfont(
                        stem_midi, fb_sf, stem_wav, gain=track_gain,
                        reverb_enabled=reverb_enabled, reverb_room_size=reverb_room_size,
                        peak_ceiling_db=peak_ceiling_db
                    )
            else:
                render_midi_to_wav_with_soundfont(
                    stem_midi, sf_path, stem_wav, gain=track_gain,
                    reverb_enabled=reverb_enabled, reverb_room_size=reverb_room_size,
                    peak_ceiling_db=peak_ceiling_db
                )
                
            if os.path.exists(stem_wav):
                data, sr = sf.read(stem_wav)
                if data.ndim == 1:
                    data = np.column_stack((data, data))
                elif data.ndim > 2:
                    data = data[:, :2]
                data = data.astype(np.float32) * track_gain
                
                pan = get_orchestral_seating_pan(task["program"], task["track_patch"])
                left_gain = np.cos((pan + 1.0) * np.pi / 4.0)
                right_gain = np.sin((pan + 1.0) * np.pi / 4.0)
                data[:, 0] *= left_gain
                data[:, 1] *= right_gain
                return sr, data
            return None

        # Execute Stage 2 parallel worker rendering across all CPU cores
        max_workers = min(os.cpu_count() or 8, len(render_tasks))
        stem_results = []
        completed_count = 0
        total_tasks = len(render_tasks)
        
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            from concurrent.futures import as_completed
            futures = [executor.submit(_execute_render_task, task) for task in render_tasks]
            for f in as_completed(futures):
                completed_count += 1
                if progress_callback and total_tasks > 0:
                    pct = 30 + int(40 * (completed_count / total_tasks))
                    try:
                        progress_callback(pct)
                    except Exception:
                        pass
                try:
                    res = f.result()
                    if res is not None:
                        stem_results.append(res)
                except Exception as e:
                    _log(f"Stem worker execution error: {e}")

        combined_audio = None
        for res in stem_results:
            if res is None:
                continue
            sr, data = res
            sample_rate = sr
            if combined_audio is None:
                combined_audio = data
            else:
                if len(data) > len(combined_audio):
                    pad = np.zeros((len(data) - len(combined_audio), 2), dtype=np.float32)
                    combined_audio = np.vstack((combined_audio, pad)) + data
                else:
                    pad = np.zeros((len(combined_audio) - len(data), 2), dtype=np.float32)
                    data_padded = np.vstack((data, pad))
                    combined_audio = combined_audio + data_padded

        if combined_audio is not None:
            # Apply Master VST3 Reverb (AIR Studios Reverb Essentials) if enabled
            if (reverb_enabled is None or reverb_enabled) and reverb_preset:
                try:
                    rev_plugin_path = get_vst3_plugin_path(reverb_preset)
                    rev_preset_file = os.path.join(PROJECT_ROOT, "storage", "vst_presets", reverb_preset)
                    if os.path.exists(rev_plugin_path) and os.path.exists(rev_preset_file):
                        from pedalboard import Pedalboard, load_plugin
                        rev_plug = load_plugin(rev_plugin_path)
                        rev_plug.raw_state = open(rev_preset_file, "rb").read()
                        board = Pedalboard([rev_plug])
                        rev_in = combined_audio.T.astype(np.float32)
                        rev_out = board(rev_in, sample_rate=float(sample_rate))
                        combined_audio = rev_out.T
                        _log(f"Applied Master VST3 Reverb preset '{reverb_preset}' via {os.path.basename(rev_plugin_path)}")
                except Exception as rev_err:
                    _log(f"Warning: Failed to apply master VST3 reverb ({rev_err})")

            max_val = np.max(np.abs(combined_audio))
            if max_val > 0:
                combined_audio = (combined_audio / max_val) * 0.9
            sf.write(out_wav_path, combined_audio, int(sample_rate), subtype='PCM_24')
            
            # Normalize peak ceiling dB
            normalize_wav_file(out_wav_path, target_peak_db=peak_ceiling_db)
            
            actual_sf = "FluidR3_GM.sf2 (Fallback)" if used_fallbacks else (job_sf_name or "SGM-V2.01.sf2")
            return out_wav_path, actual_sf
            
        return None, job_sf_name
    finally:
        try:
            shutil.rmtree(temp_dir)
        except Exception:
            pass
            
    return None


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

