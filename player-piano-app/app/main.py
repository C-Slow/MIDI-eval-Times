from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Header, Query, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional, List, Dict
import os
import shutil
import json
import time
import tempfile
from pathlib import Path
import uvicorn
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

from app import utils, gemini, backup, audio_processor
from app.manager import PlaylistManager

BASE_DIR = Path(__file__).resolve().parents[2]
STORAGE_RAW = BASE_DIR / 'storage' / 'raw'
STORAGE_PROCESSED = BASE_DIR / 'storage' / 'processed'
STORAGE_RAW.mkdir(parents=True, exist_ok=True)
STORAGE_PROCESSED.mkdir(parents=True, exist_ok=True)
SETTINGS_FILE = BASE_DIR / 'storage' / 'settings.json'
SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)

if not SETTINGS_FILE.exists():
    SETTINGS_FILE.write_text('{}', encoding='utf-8')

def get_settings_data():
    try:
        return json.loads(SETTINGS_FILE.read_text(encoding='utf-8') or '{}')
    except Exception:
        return {}

# Auth dependency
async def verify_auth(authorization: Optional[str] = Header(None), token: Optional[str] = None):
    settings = get_settings_data()
    master_password = settings.get('password', 'piano')
    
    actual_token = None
    if authorization and isinstance(authorization, str) and authorization.startswith("Bearer "):
        actual_token = authorization.split(" ")[1]
    elif token:
        actual_token = token

    if not actual_token or actual_token != master_password:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return True

app = FastAPI(title='MIDI-eval Times')

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Startup Tasks & Cleanup
@app.on_event("startup")
async def startup_event():
    # Clean up obsolete render cache files on startup
    try:
        utils.cleanup_render_cache()
    except Exception as e:
        print(f"Startup render cache cleanup failed: {e}")

    # Clean up stale upload/job data on startup
    try:
        processor.cleanup_stale_data_and_jobs()
    except Exception as e:
        print(f"Startup processor data cleanup failed: {e}")
        
    # Clean up stale midi orchestrator upload/job data on startup
    try:
        midi_orchestrator.cleanup_stale_data_and_jobs()
    except Exception as e:
        print(f"Startup midi orchestrator data cleanup failed: {e}")
    
    # Start background thread for daily backups
    import threading
    def daily_backup_worker():
        while True:
            # Wait 24 hours
            time.sleep(24 * 3600)
            try:
                print("Running scheduled daily backup...")
                backup.run_backup_cycle(str(BASE_DIR / 'storage'))
            except Exception as e:
                print(f"Scheduled backup failed: {e}")
    
    threading.Thread(target=daily_backup_worker, daemon=True).start()

@app.post("/system/backup", dependencies=[Depends(verify_auth)])
async def trigger_manual_backup(background_tasks: BackgroundTasks):
    """Manually trigger a backup cycle."""
    background_tasks.add_task(backup.run_backup_cycle, str(BASE_DIR / 'storage'))
    return {"status": "backup_started"}

# Ensure a sensible default theme and target device are present
try:
    data = get_settings_data()
    changed = False
    if 'theme' not in data:
        data.setdefault('theme', 'light')
        changed = True
    if 'target_device' not in data:
        data.setdefault('target_device', 'MD-BT01')
        changed = True
    if 'password' not in data:
        data.setdefault('password', 'piano')
        changed = True
    
    if changed:
        SETTINGS_FILE.write_text(json.dumps(data, indent=2), encoding='utf-8')
    
    utils.set_auto_connect_target(data.get('target_device', 'MD-BT01'))
    utils.start_auto_connect_monitor()
except Exception:
    pass

# Static files
STATIC_DIR = Path(__file__).resolve().parent / 'static'
if STATIC_DIR.exists():
    app.mount('/static', StaticFiles(directory=str(STATIC_DIR)), name='static')

# Initialize playlist manager
PLAYLISTS_FILE = str(Path(__file__).resolve().parents[2] / 'storage' / 'playlists.json')
manager = PlaylistManager(str(STORAGE_RAW), str(STORAGE_PROCESSED), PLAYLISTS_FILE)

# Initialize audio processor for MP3 orchestration
processor = audio_processor.AudioProcessor(BASE_DIR / 'storage')

# Initialize MIDI orchestrator
from app.midi_orchestrator import MidiOrchestrator
midi_orchestrator = MidiOrchestrator(BASE_DIR / 'storage')

class GeminiKeyRequest(BaseModel):
    key: str

@app.post("/settings/gemini_key", dependencies=[Depends(verify_auth)])
async def set_gemini_key(req: GeminiKeyRequest):
    settings = get_settings_data()
    settings['gemini_api_key'] = req.key
    SETTINGS_FILE.write_text(json.dumps(settings, indent=2), encoding='utf-8')
    return {"status": "saved"}

@app.get("/settings/gemini_key", dependencies=[Depends(verify_auth)])
async def get_gemini_key():
    settings = get_settings_data()
    return {"key": settings.get('gemini_api_key', '')}

async def process_uploaded_file(raw_path: Path, original_filename: str):
    """Analyze with Gemini and auto-clean if possible."""
    settings = get_settings_data()
    api_key = settings.get('gemini_api_key')
    
    gemini_data = {}
    if api_key:
        try:
            gs = gemini.GeminiService(api_key)
            midi_info = gemini.extract_midi_info(str(raw_path))
            gemini_data = await gs.analyze_midi(midi_info)
        except Exception as e:
            print(f"Gemini processing failed: {e}")

    clean_suggested = gemini_data.get('suggested_clean', {})
    profile = clean_suggested.get('profile', 'light')
    rhythm = clean_suggested.get('rhythm_factor', 1.0)
    melody = clean_suggested.get('melody_factor', 1.0)
    
    final_filename = original_filename
    try:
        processed_filename = utils.run_clean(str(raw_path), str(STORAGE_PROCESSED), profile, rhythm, melody)
        # Ensure we only use the filename part, not the full path
        final_filename = os.path.basename(processed_filename)
        
        print(f"DEBUG: Auto-clean produced: {final_filename}")
        
        clean_title = gemini_data.get('clean_title')
        if clean_title:
            import re
            slug = re.sub(r'[^a-z0-9]+', '-', clean_title.lower()).strip('-')
            if slug:
                new_base = slug
                new_name = f"{new_base}.mid"
                if not (STORAGE_PROCESSED / new_name).exists():
                    # Rename processed
                    os.rename(STORAGE_PROCESSED / final_filename, STORAGE_PROCESSED / new_name)
                    
                    # Rename original to match
                    old_raw_path = raw_path
                    new_raw_name = f"{new_base}_original.mid"
                    new_raw_path = STORAGE_RAW / new_raw_name
                    if not new_raw_path.exists():
                        os.rename(old_raw_path, new_raw_path)
                        print(f"DEBUG: Renamed raw to: {new_raw_name}")
                    
                    final_filename = new_name
                    print(f"DEBUG: Renamed to Gemini title: {final_filename}")
        
        metadata_updates = {
            "original_name": original_filename,
            "clean_profile": profile,
            "rhythm_factor": rhythm,
            "melody_factor": melody,
            "gemini_analysis": gemini_data,
            "artist": gemini_data.get('artist'),
            "genre": gemini_data.get('genre'),
            "mood": gemini_data.get('mood'),
            "source": gemini_data.get('source'),
            "is_game_or_movie": gemini_data.get('is_game_or_movie')
        }
        utils.update_file_metadata(final_filename, metadata_updates)
        print(f"DEBUG: Saved metadata for {final_filename}")
        
    except Exception as e:
        print(f"Auto-clean failed: {e}")
        utils.update_file_metadata(original_filename, {"original_name": original_filename})
    
    return final_filename, gemini_data

class LoginRequest(BaseModel):
    password: str

class Base64UploadRequest(BaseModel):
    filename: str
    data: str
    route_mode: Optional[str] = "piano"
    engine: Optional[str] = "bytedance"
    engine_sensitivity: Optional[float] = 1.0
    include_other: Optional[bool] = False
@app.post('/upload_base64', dependencies=[Depends(verify_auth)])
async def upload_base64(req: Base64UploadRequest):
    import base64
    print(f"DEBUG: Received Base64 upload for: {req.filename}")
    try:
        p = Path(req.filename)
        new_name = f"{p.stem}_original{p.suffix}"
        dest = STORAGE_RAW / new_name
        
        file_data = base64.b64decode(req.data)
        dest.write_bytes(file_data)
        
        print(f"DEBUG: Base64 upload successful: {new_name}")
        final_name, gemini_data = await process_uploaded_file(dest, new_name)
        return {'filename': final_name, 'gemini': gemini_data}
    except Exception as e:
        print(f"DEBUG: Base64 upload error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post('/login')
def login(req: LoginRequest):
    settings = get_settings_data()
    correct = settings.get('password', 'piano')
    if req.password == correct:
        return {'token': correct}
    raise HTTPException(status_code=401, detail='Invalid password')

@app.post('/upload', dependencies=[Depends(verify_auth)])
async def upload(file: UploadFile = File(...)):
    p = Path(file.filename)
    new_name = f"{p.stem}_original{p.suffix}"
    dest = STORAGE_RAW / new_name
    with open(dest, 'wb') as f:
        shutil.copyfileobj(file.file, f)
    
    final_name, gemini_data = await process_uploaded_file(dest, new_name)
    return {'filename': final_name, 'gemini': gemini_data}

@app.get('/files')
def list_files():
    from app import utils as _utils
    raw = []
    processed = []
    
    file_playlists = {}
    for pl_name, tracks in manager.playlists.items():
        for fn in tracks:
            if fn not in file_playlists:
                file_playlists[fn] = []
            file_playlists[fn].append(pl_name)
            
    # Load all metadata ONCE at the start of the request
    all_metadata = _utils.get_all_metadata()
    
    processed_filenames = {p.name for p in STORAGE_PROCESSED.iterdir() if p.suffix.lower() in ('.mid', '.midi')}

    for p in STORAGE_RAW.iterdir():
        if p.suffix.lower() in ('.mid', '.midi'):
            info = _utils.get_midi_info(str(p))
            # Pull from the local dictionary instead of hitting the disk again
            meta = all_metadata.get(p.name, {})
            clean_name = p.name.replace('_original', '')
            is_processed = clean_name in processed_filenames
            
            raw.append({
                'name': p.name, 
                'length': info.get('length'), 
                'size': info.get('size'),
                'created': info.get('created'),
                'metadata': meta,
                'processed': is_processed,
                'playlists': file_playlists.get(p.name, [])
            })
            
    for p in STORAGE_PROCESSED.iterdir():
        if p.suffix.lower() in ('.mid', '.midi'):
            info = _utils.get_midi_info(str(p))
            # Pull from the local dictionary instead of hitting the disk again
            meta = all_metadata.get(p.name, {})
            processed.append({
                'name': p.name, 
                'length': info.get('length'), 
                'size': info.get('size'),
                'created': info.get('created'),
                'metadata': meta,
                'playlists': file_playlists.get(p.name, [])
            })
    return {'raw': raw, 'processed': processed}

@app.get('/files/metadata/unique')
def get_unique_metadata():
    all_meta = utils.get_all_metadata()
    # Use Counter to track frequency
    from collections import Counter
    stats = {
        'artist': Counter(),
        'genre': Counter(),
        'mood': Counter(),
        'source': Counter()
    }
    
    import re
    
    for meta in all_meta.values():
        for field in stats.keys():
            raw_val = str(meta.get(field) or '').strip()
            if not raw_val:
                continue
            
            # Split by commas and slashes
            parts = re.split(r'[,/]', raw_val)
            for p in parts:
                p_clean = p.strip()
                if p_clean:
                    # Simple normalization: capitalize first letter of each word
                    p_norm = p_clean.title()
                    stats[field][p_norm] += 1
            
    # Return as list of unique strings, sorted by frequency (count)
    return {
        field: [item for item, count in stats[field].most_common(50)]
        for field in stats.keys()
    }

@app.get('/files/metadata/{filename}')
def get_file_metadata(filename: str):
    return utils.get_file_metadata(filename)

@app.post('/files/metadata/{filename}')
def update_file_metadata(filename: str, metadata: dict):
    utils.update_file_metadata(filename, metadata)
    return {'status': 'updated'}

class BulkMetadataRequest(BaseModel):
    filenames: List[str]
    metadata: dict

@app.post('/files/metadata_bulk')
def bulk_update_file_metadata(req: BulkMetadataRequest):
    for fn in req.filenames:
        utils.update_file_metadata(fn, req.metadata)
    return {'status': 'updated', 'count': len(req.filenames)}

@app.get('/files/download/{filename}', dependencies=[Depends(verify_auth)])
def download_file(filename: str):
    target = STORAGE_PROCESSED / filename
    if not target.exists():
        target = STORAGE_RAW / filename
    if not target.exists():
        raise HTTPException(status_code=404, detail='file not found')
    return FileResponse(str(target), filename=filename, media_type='audio/midi')

@app.get('/files/render/{filename}', dependencies=[Depends(verify_auth)])
def render_file(filename: str):
    target = STORAGE_PROCESSED / filename
    if not target.exists():
        target = STORAGE_RAW / filename
    if not target.exists():
        raise HTTPException(status_code=404, detail='file not found')
    
    try:
        wav_path = utils.render_midi_to_wav(str(target))
        return FileResponse(wav_path, media_type="audio/wav")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rendering failed: {str(e)}")

class CleanRequest(BaseModel):
    filename: str
    profile: Optional[str] = 'light'
    rhythm_factor: Optional[float] = 1.0
    melody_factor: Optional[float] = 1.0

@app.post('/process/clean')
def process_clean(req: CleanRequest):
    filename = req.filename
    profile = req.profile or 'light'
    r_factor = req.rhythm_factor if req.rhythm_factor is not None else 1.0
    m_factor = req.melody_factor if req.melody_factor is not None else 1.0
    
    src = STORAGE_RAW / filename
    if not src.exists():
        alt_name = filename.replace('.mid', '_original.mid').replace('.midi', '_original.midi')
        src = STORAGE_RAW / alt_name
        
    if not src.exists():
        raise HTTPException(status_code=404, detail='Original raw file not found for re-cleaning.')

    out_dir = str(STORAGE_PROCESSED)
    try:
        out = utils.run_clean(str(src), out_dir, profile, r_factor, m_factor)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {'output': os.path.basename(out)}

class TempoRequest(BaseModel):
    filename: str
    factor: float = 1.0

@app.post('/process/tempo')
def process_tempo(req: TempoRequest):
    filename = req.filename
    factor = req.factor
    src = STORAGE_PROCESSED / filename
    if not src.exists():
        src = STORAGE_RAW / filename
    if not src.exists():
        raise HTTPException(status_code=404, detail='file not found')
    
    outpath = STORAGE_PROCESSED / filename
    try:
        utils.run_tempo(str(src), str(outpath), factor)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {'output': str(outpath.name)}

class RenameRequest(BaseModel):
    old: str
    new: str

@app.post('/files/rename_json')
def rename_file_json(req: RenameRequest):
    return _do_rename(req.old, req.new)

def _do_rename(old: str, new: str):
    if not new.lower().endswith(('.mid', '.midi')):
        new += '.mid'
        
    old_path = STORAGE_PROCESSED / old
    folder = STORAGE_PROCESSED
    
    # Identify where the 'old' file currently lives
    if not old_path.exists():
        old_path = STORAGE_RAW / old
        folder = STORAGE_RAW
        
    new_path = folder / new
    
    # IDEMPOTENCY CHECK: If old is gone, check if it was already renamed in either folder
    if not old_path.exists():
        if (STORAGE_PROCESSED / new).exists():
            print(f"RENAME: {old} already renamed to {new} in PROCESSED (Idempotent Success)")
            folder = STORAGE_PROCESSED
            new_path = STORAGE_PROCESSED / new
        elif (STORAGE_RAW / new).exists():
            print(f"RENAME: {old} already renamed to {new} in RAW (Idempotent Success)")
            folder = STORAGE_RAW
            new_path = STORAGE_RAW / new
        else:
            print(f"RENAME ERROR: File not found - {old}")
            raise HTTPException(status_code=404, detail='file not found')
            
    print(f"RENAME: {old} -> {new} (in {folder.name})")
    
    try:
        # Determine paired file names
        paired_old = None
        paired_new = None
        paired_folder = None
        
        p_old = Path(old)
        p_new = Path(new)
        
        if folder == STORAGE_PROCESSED:
            paired_old = f"{p_old.stem}_original{p_old.suffix}"
            paired_new = f"{p_new.stem}_original{p_new.suffix}"
            paired_folder = STORAGE_RAW
        elif folder == STORAGE_RAW and "_original" in p_old.stem:
            paired_old = f"{p_old.stem.replace('_original', '')}{p_old.suffix}"
            paired_new = f"{p_new.stem.replace('_original', '')}{p_new.suffix}"
            paired_folder = STORAGE_PROCESSED
            
        # 1. Rename the target file
        if old_path.exists():
            print(f"RENAME: Moving {old_path} to {new_path}")
            old_path.replace(new_path)
        else:
            print(f"RENAME: Skipping main move, {old_path} already gone.")
        
        # 2. Rename paired file if it exists
        if paired_old and paired_folder:
            po_path = paired_folder / paired_old
            pn_path = paired_folder / paired_new
            if po_path.exists():
                print(f"RENAME: Moving paired {po_path} to {pn_path}")
                po_path.replace(pn_path)
            elif pn_path.exists():
                print(f"RENAME: Paired file {pn_path} already exists.")
        # 2b. Rename cached render files if they exist
        from app.utils import RENDER_CACHE
        old_cache = os.path.join(RENDER_CACHE, old + '.wav')
        new_cache = os.path.join(RENDER_CACHE, new + '.wav')
        if os.path.exists(old_cache):
            try:
                if os.path.exists(new_cache):
                    os.remove(new_cache)
                os.rename(old_cache, new_cache)
                print(f"RENAME: Renamed cached render file to {new_cache}")
            except Exception as e:
                print(f"RENAME: Failed to rename cached render file: {e}")

        if paired_old and paired_new:
            old_paired_cache = os.path.join(RENDER_CACHE, paired_old + '.wav')
            new_paired_cache = os.path.join(RENDER_CACHE, paired_new + '.wav')
            if os.path.exists(old_paired_cache):
                try:
                    if os.path.exists(new_paired_cache):
                        os.remove(new_paired_cache)
                    os.rename(old_paired_cache, new_paired_cache)
                    print(f"RENAME: Renamed cached paired render file to {new_paired_cache}")
                except Exception as e:
                    print(f"RENAME: Failed to rename cached paired render file: {e}")

        # 3. Update metadata (Batch update for efficiency)
        all_meta = utils.get_all_metadata()
        meta_changed = False
        
        if old in all_meta:
            all_meta[new] = all_meta.pop(old)
            meta_changed = True
            print(f"RENAME: Updated metadata for {new}")
        
        if paired_old and paired_old in all_meta:
            all_meta[paired_new] = all_meta.pop(paired_old)
            meta_changed = True
            print(f"RENAME: Updated metadata for paired {paired_new}")
            
        if meta_changed:
            utils.save_all_metadata(all_meta)
            
        # 4. Update playlists
        with manager.lock:
            pl_changed = False
            for pl_name in list(manager.playlists.keys()):
                current_tracks = manager.playlists[pl_name]
                updated = False
                new_tracks = []
                for t in current_tracks:
                    if t == old:
                        new_tracks.append(new)
                        updated = True
                    elif paired_old and t == paired_old:
                        new_tracks.append(paired_new)
                        updated = True
                    else:
                        new_tracks.append(t)
                if updated:
                    manager.playlists[pl_name] = new_tracks
                    pl_changed = True
                    print(f"RENAME: Updated playlist '{pl_name}'")
                    
            if pl_changed:
                manager._save()
                
    except Exception as e:
        print(f"RENAME FAILED: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
        
    return {'renamed': new}

class DeleteRequest(BaseModel):
    filename: str

@app.post('/files/delete')
def delete_file(req: DeleteRequest):
    fn = req.filename
    target = STORAGE_PROCESSED / fn
    if not target.exists():
        target = STORAGE_RAW / fn
    if not target.exists():
        raise HTTPException(status_code=404, detail='file not found')
    try:
        target.unlink()
        
        # Delete cached render file if it exists
        from app.utils import RENDER_CACHE
        cache_file = os.path.join(RENDER_CACHE, fn + '.wav')
        if os.path.exists(cache_file):
            try:
                os.remove(cache_file)
                print(f"DELETE: Deleted cached render file {cache_file}")
            except Exception as e:
                print(f"DELETE: Failed to delete cached render file: {e}")

        utils.delete_file_metadata(fn)
        for pl_name in list(manager.playlists.keys()):
            if fn in manager.playlists[pl_name]:
                manager.remove_from_playlist(pl_name, fn)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {'deleted': fn}

@app.post('/play/stop')
def stop_play():
    try:
        utils.stop_current_play()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {'status': 'stopped'}

@app.get('/playback/status')
def playback_status():
    try:
        return utils.playback_status()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get('/midi-outputs')
def midi_outputs():
    return {'outputs': utils.list_midi_outputs()}

@app.get('/')
def index():
    index_file = STATIC_DIR / 'index.html'
    if index_file.exists():
        return HTMLResponse(index_file.read_text(encoding='utf-8'))
    return {'status': 'no ui'}

@app.get('/playlists')
def list_playlists():
    return manager.list_playlists()

class CreatePlaylistRequest(BaseModel):
    name: str

@app.post('/playlists')
def create_playlist(req: CreatePlaylistRequest):
    name = req.name
    try:
        manager.create_playlist(name)
    except ValueError:
        raise HTTPException(status_code=400, detail='playlist exists')
    return {'created': name}

class PlaylistFilter(BaseModel):
    filter_type: str
    filter_value: str

class SmartPlaylistRequest(BaseModel):
    name: str
    filter_type: Optional[str] = None # 'artist', 'genre', 'mood', 'source', 'all'
    filter_value: Optional[str] = None
    filters: Optional[List[PlaylistFilter]] = None
    exclude_dnu: Optional[bool] = True

def generate_smart_playlist_logic(name: str, filters: List[Dict[str, str]], exclude_dnu: bool):
    """Core logic for smart playlist generation with support for multiple filters (ANDed)."""
    print(f"DEBUG: Smart Playlist Logic - Name: {name}, Filters: {filters}, ExcludeDNU: {exclude_dnu}")
    if not name:
        raise ValueError('name required')
    if not filters:
        raise ValueError('filters required')
        
    all_meta = utils.get_all_metadata()
    processed_files = [p.name for p in STORAGE_PROCESSED.iterdir() if p.suffix.lower() in ('.mid', '.midi')]
    print(f"DEBUG: Checking {len(processed_files)} processed files...")
    
    to_add = []
    for fn in processed_files:
        meta = all_meta.get(fn, {})
        
        # Exclude DNU if requested
        if exclude_dnu and meta.get('dnu'):
            continue

        # All filters must match (AND logic)
        all_filters_match = True
        for f in filters:
            f_type = f.get('filter_type')
            f_val = f.get('filter_value', '')
            
            filter_match = False
            if f_type == 'all':
                filter_match = True
            elif f_type == 'rating':
                parts = [p.strip() for p in str(f_val).split(',') if p.strip()]
                song_rating = int(meta.get('rating') or 0)
                for part in parts:
                    try:
                        val_int = int(part)
                        if val_int == 0:
                            if song_rating == 0:
                                filter_match = True
                                break
                        else:
                            if len(parts) == 1:
                                if song_rating >= val_int:
                                    filter_match = True
                                    break
                            else:
                                if song_rating == val_int:
                                    filter_match = True
                                    break
                    except ValueError:
                        pass
            else:
                val = str(meta.get(f_type) or '').lower().strip().replace('-', ' ').replace('_', ' ')
                f_val_lower = str(f_val).lower().strip().replace('-', ' ').replace('_', ' ')
                if f_val_lower == '*':
                    if val:
                        filter_match = True
                else:
                    target_values = [v.strip() for v in f_val_lower.split(',') if v.strip()]
                    for tv in target_values:
                        if tv in val:
                            filter_match = True
                            break
            
            if not filter_match:
                all_filters_match = False
                break
                
        if all_filters_match:
            to_add.append(fn)
            
    print(f"DEBUG: Found {len(to_add)} matches.")
    if not to_add:
        raise ValueError('no matching files found')
        
    try:
        manager.create_playlist(name)
    except ValueError:
        pass # Allow existing for smart refresh
        
    manager.playlists[name] = to_add
    manager.smart_rules[name] = {
        'filters': filters,
        'exclude_dnu': exclude_dnu
    }
    
    manager._save()
    return name, len(to_add)

@app.post('/playlists/smart')
def create_smart_playlist(req: SmartPlaylistRequest):
    try:
        filters_list = []
        if req.filters:
            filters_list = [f.model_dump() for f in req.filters]
        elif req.filter_type and req.filter_value is not None:
            filters_list = [{
                'filter_type': req.filter_type,
                'filter_value': req.filter_value
            }]
            
        name, count = generate_smart_playlist_logic(
            req.name.strip(), 
            filters_list, 
            req.exclude_dnu
        )
        return {'created': name, 'count': count}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post('/playlists/smart/refresh_all')
def refresh_all_smart_playlists():
    if not hasattr(manager, 'smart_rules') or not manager.smart_rules:
        return {'status': 'no_smart_playlists_found', 'refreshed': 0}
    
    refreshed_count = 0
    rule_names = list(manager.smart_rules.keys())
    
    for name in rule_names:
        rule = manager.smart_rules[name]
        try:
            filters = rule.get('filters')
            if not filters:
                filters = [{
                    'filter_type': rule['filter_type'],
                    'filter_value': rule['filter_value']
                }]
            generate_smart_playlist_logic(
                name,
                filters,
                rule.get('exclude_dnu', True)
            )
            refreshed_count += 1
        except Exception as e:
            print(f"Error refreshing smart playlist {name}: {e}")
            
    return {'status': 'success', 'refreshed': refreshed_count}

@app.get('/playlists/rules')
def get_playlist_rules():
    return manager.smart_rules

class BulkAddRequest(BaseModel):
    filenames: List[str]

@app.post('/playlists/add_bulk')
def bulk_add_to_playlist(req: BulkAddRequest, name: str = Query(...)):
    try:
        for fn in req.filenames:
            manager.add_to_playlist(name, fn)
    except KeyError:
        raise HTTPException(status_code=404, detail='playlist not found')
    return {'added': len(req.filenames)}

@app.post('/playlists/remove_bulk')
def bulk_remove_from_playlist(req: BulkAddRequest, name: str = Query(...)):
    try:
        for fn in req.filenames:
            manager.remove_from_playlist(name, fn)
    except KeyError:
        raise HTTPException(status_code=404, detail='playlist not found')
    return {'removed': len(req.filenames)}

@app.post('/playlists/delete')
def delete_playlist(name: str = Query(...)):
    print(f"DEBUG: Deleting playlist: {name}")
    if name in manager.playlists:
        del manager.playlists[name]
        # ALSO delete the rule if it exists to prevent resurrection
        if hasattr(manager, 'smart_rules') and name in manager.smart_rules:
            del manager.smart_rules[name]
            print(f"DEBUG: Deleted smart rule for: {name}")
            
        manager._save()
        return {'status': 'deleted'}
    raise HTTPException(status_code=404, detail='playlist not found')

@app.post('/playlists/reload')
def reload_playlists():
    manager._load()
    return {'status': 'reloaded'}

@app.post("/voice/audio", dependencies=[Depends(verify_auth)])
async def voice_command(audio: UploadFile = File(...)):
    # Save audio to temp file
    temp_audio = Path(tempfile.gettempdir()) / f"voice_{int(time.time())}.m4a"
    with temp_audio.open("wb") as buffer:
        shutil.copyfileobj(audio.file, buffer)
    
    try:
        # Get context for Gemini
        settings = get_settings_data()
        api_key = settings.get('gemini_api_key')
        if not api_key:
            return {"response_text": "Please set your Gemini API key in Settings first."}
            
        all_meta = utils.get_all_metadata()
        artists = sorted(list(set(m.get('artist') for m in all_meta.values() if m.get('artist'))))
        genres = sorted(list(set(m.get('genre') for m in all_meta.values() if m.get('genre'))))
        moods = sorted(list(set(m.get('mood') for m in all_meta.values() if m.get('mood'))))
        playlists = list(manager.playlists.keys())
        
        context = {
            "artists": artists,
            "genres": genres,
            "moods": moods,
            "playlists": playlists
        }
        
        gs = gemini.GeminiService(api_key)
        result = await gs.analyze_audio_command(str(temp_audio), context)
        
        action = result.get("action", "unknown")
        response_text = result.get("response_text", "Command not understood.")
        
        target_device = settings.get('target_device')
        is_connected = utils._ble_handle.connected if utils._ble_handle else False

        # Execute Action
        if action in ["play_playlist", "play_smart"]:
            if not is_connected:
                return {"action": "error", "response_text": "I'd love to play that, but the piano isn't connected right now."}

        import anyio

        if action == "play_playlist":
            pl_name = result.get("name")
            try:
                # Use port_name=None to default to active BLE connection
                req = PlayPlaylistRequest(port_name=None)
                await anyio.to_thread.run_sync(play_playlist, req, pl_name)
            except Exception as e:
                response_text = f"I couldn't start the {pl_name} playlist: {str(e)}"
                
        elif action == "play_smart":
            f_type = result.get("filter_type")
            f_val = result.get("filter_value")
            try:
                await anyio.to_thread.run_sync(generate_smart_playlist_logic, "Voice Request", f_type, f_val, True)
                # Use port_name=None to default to active BLE connection
                req = PlayPlaylistRequest(port_name=None)
                await anyio.to_thread.run_sync(play_playlist, req, "Voice Request")
            except Exception as e:
                response_text = f"I found matches but couldn't start the music: {str(e)}"
                
        elif action == "stop":
            await anyio.to_thread.run_sync(manager.stop)
            await anyio.to_thread.run_sync(utils.stop_current_play)
            
        elif action == "next":
            await anyio.to_thread.run_sync(manager.skip)
            
        return {"action": action, "response_text": response_text}
        
    except Exception as e:
        print(f"Voice Command Error: {e}")
        return {"action": "error", "response_text": "Something went wrong processing your voice."}
    finally:
        if temp_audio.exists():
            temp_audio.unlink()

@app.get('/midi/status')
def get_midi_status():
    connected = utils._ble_handle.connected if utils._ble_handle else False
    target = utils._auto_connect_target
    return {'connected': connected, 'target_device': target}

@app.get('/midi/scan')
async def scan_midi_devices():
    from bleak import BleakScanner
    devices = await BleakScanner.discover()
    return [{'name': d.name, 'address': d.address} for d in devices if d.name]

class ConnectRequest(BaseModel):
    target_device: str

@app.post('/midi/connect')
def connect_midi(req: ConnectRequest):
    utils.set_auto_connect_target(req.target_device)
    return {'status': 'target_updated', 'target': req.target_device}

class PlayPlaylistRequest(BaseModel):
    shuffle: Optional[bool] = False
    repeat: Optional[bool] = False
    port_name: Optional[str] = None

@app.post('/playlists/play')
def play_playlist(req: PlayPlaylistRequest, name: str = Query(...)):
    if not (utils._ble_handle and utils._ble_handle.connected):
        raise HTTPException(status_code=400, detail="Piano not connected")
    
    shuffle = bool(req.shuffle)
    repeat = bool(req.repeat)
    port_name = req.port_name
    try:
        manager.play_playlist(name, shuffle=shuffle, port_name=port_name, repeat=repeat)
    except KeyError:
        raise HTTPException(status_code=404, detail='playlist not found')
    return {'status': 'playing', 'playlist': name}

@app.post('/queue/stop')
def stop_queue():
    manager.stop()
    return {'status': 'stopped'}

@app.post('/queue/next')
def next_track():
    manager.skip()
    return {'status': 'skipped'}

@app.get('/queue/status')
def queue_status():
    return manager.status()

class QueueSeekRequest(BaseModel):
    offset: float

@app.post('/queue/seek')
def seek_queue(req: QueueSeekRequest):
    manager.seek(req.offset)
    return {'status': 'seeking', 'offset': req.offset}

class PlayRequest(BaseModel):
    filename: str
    port_name: Optional[str] = None

@app.post('/play')
def play(req: PlayRequest):
    if not (utils._ble_handle and utils._ble_handle.connected):
        raise HTTPException(status_code=400, detail="Piano not connected")
    
    filename = req.filename
    port_name = req.port_name
    candidate = STORAGE_PROCESSED / filename
    if not candidate.exists():
        if filename.endswith('_original.mid') or filename.endswith('_original.midi'):
             raise HTTPException(status_code=403, detail="Direct play of raw files is prohibited.")
        candidate = STORAGE_RAW / filename
    if not candidate.exists():
        raise HTTPException(status_code=404, detail='file not found')

    try:
        utils.start_play_async(str(candidate), port_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {'status': 'playing', 'file': candidate.name}

class SeekRequest(BaseModel):
    filename: str
    offset: float
    port_name: Optional[str] = None

@app.post('/play/seek')
def seek(req: SeekRequest):
    filename = req.filename
    offset = req.offset
    port_name = req.port_name
    candidate = STORAGE_PROCESSED / filename
    if not candidate.exists():
        candidate = STORAGE_RAW / filename
    if not candidate.exists():
        raise HTTPException(status_code=404, detail='file not found')
    try:
        utils.start_play_async(str(candidate), port_name, seek_offset=offset)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {'status': 'playing', 'file': candidate.name, 'offset': offset}

@app.get('/profiles')
def get_profiles():
    return utils.load_profiles()

@app.post('/profiles')
def save_profiles(profiles: dict):
    utils.save_profiles(profiles)
    return {'status': 'saved'}

@app.get('/settings')
def get_settings():
    try:
        return json.loads(SETTINGS_FILE.read_text(encoding='utf-8'))
    except Exception:
        return {}

@app.post('/settings')
def save_settings(settings: dict):
    try:
        SETTINGS_FILE.write_text(json.dumps(settings, indent=2), encoding='utf-8')
        if 'target_device' in settings:
            utils.set_auto_connect_target(settings['target_device'])
        return {'status': 'saved'}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/mp3/upload", dependencies=[Depends(verify_auth)])
async def upload_mp3(file: UploadFile = File(...), route_mode: str = "piano", engine: str = "bytedance", engine_sensitivity: float = 1.0, include_other: bool = False):
    import uuid
    job_id = str(uuid.uuid4())
    p = Path(file.filename)
    dest = processor.uploads_dir / f"{job_id}{p.suffix}"
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    processor.start_processing(job_id, dest, file.filename, route_mode=route_mode, engine=engine, engine_sensitivity=engine_sensitivity, include_other=include_other)
    return {"job_id": job_id}

@app.post("/mp3/upload_base64", dependencies=[Depends(verify_auth)])
async def upload_mp3_base64(req: Base64UploadRequest):
    import base64
    import uuid
    job_id = str(uuid.uuid4())
    p = Path(req.filename)
    dest = processor.uploads_dir / f"{job_id}{p.suffix}"

    try:
        file_data = base64.b64decode(req.data)
        dest.write_bytes(file_data)
        processor.start_processing(
            job_id, 
            dest, 
            req.filename,
            route_mode=req.route_mode or "piano", 
            engine=req.engine or "bytedance", 
            engine_sensitivity=req.engine_sensitivity or 1.0,
            include_other=req.include_other or False
        )
        return {"job_id": job_id}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/mp3/status/{job_id}", dependencies=[Depends(verify_auth)])
async def get_mp3_status(job_id: str):
    return processor.get_status(job_id)

@app.get("/mp3/jobs", dependencies=[Depends(verify_auth)])
async def list_mp3_jobs():
    return processor.list_jobs()

@app.get("/mp3/vocals/{job_id}", dependencies=[Depends(verify_auth)])
async def get_mp3_vocals(job_id: str):
    status = processor.get_status(job_id)
    if status["status"] != "completed":
        raise HTTPException(status_code=400, detail="Job not completed")
    return FileResponse(status["vocals"], media_type="audio/wav")

@app.get("/mp3/render/{job_id}", dependencies=[Depends(verify_auth)])
async def get_mp3_piano_render(job_id: str):
    status = processor.get_status(job_id)
    if status["status"] != "completed":
        raise HTTPException(status_code=400, detail="Job not completed")
    
    midi_path = status["midi"]
    if not os.path.exists(midi_path):
        raise HTTPException(status_code=404, detail="MIDI file not found")
        
    try:
        # Use existing utility to render MIDI to WAV via FluidSynth
        wav_path = utils.render_midi_to_wav(str(midi_path))
        return FileResponse(wav_path, media_type="audio/wav")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Rendering failed: {str(e)}")

@app.post("/mp3/play/{job_id}", dependencies=[Depends(verify_auth)])
async def play_mp3_midi(job_id: str):
    status = processor.get_status(job_id)
    if status["status"] != "completed":
        raise HTTPException(status_code=400, detail="Job not completed")
    
    midi_path = status["midi"]
    if not os.path.exists(midi_path):
        raise HTTPException(status_code=404, detail="MIDI file not found")
        
    if not (utils._ble_handle and utils._ble_handle.connected):
        raise HTTPException(status_code=400, detail="Piano not connected")

    try:
        utils.start_play_async(str(midi_path))
        return {"status": "playing"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/mp3/settings/{job_id}", dependencies=[Depends(verify_auth)])
async def update_mp3_settings(job_id: str, updates: dict):
    success = processor.update_settings(job_id, updates)
    if not success:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"status": "updated"}

class MergeJobsRequest(BaseModel):
    midi_job_id: str
    audio_job_id: str

@app.post("/mp3/merge_jobs", dependencies=[Depends(verify_auth)])
async def merge_mp3_jobs(req: MergeJobsRequest):
    try:
        new_id = processor.merge_jobs(req.midi_job_id, req.audio_job_id)
        return {"job_id": new_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/mp3/job/{job_id}", dependencies=[Depends(verify_auth)])
async def delete_mp3_job(job_id: str):
    success = processor.delete_job(job_id)
    if not success:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"status": "deleted"}

@app.post("/mp3/auto_sync", dependencies=[Depends(verify_auth)])
async def auto_sync_calculate(file: UploadFile = File(...)):
    # Save recording to temp file
    temp_rec = Path(tempfile.gettempdir()) / f"sync_rec_{int(time.time())}.wav"
    with temp_rec.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    try:
        offset_ms = processor.calculate_acoustic_offset(temp_rec)
        return {"offset_ms": offset_ms}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        if temp_rec.exists():
            temp_rec.unlink()

@app.post("/mp3/replace_midi/{job_id}", dependencies=[Depends(verify_auth)])
async def replace_mp3_midi(job_id: str, file: UploadFile = File(...)):
    # Save uploaded MIDI to temp file
    temp_midi = Path(tempfile.gettempdir()) / f"replace_{job_id}_{int(time.time())}.mid"
    with temp_midi.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    try:
        processor.align_external_midi(job_id, temp_midi)
        return {"status": "aligned"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        if temp_midi.exists():
            temp_midi.unlink()

@app.post("/mp3/replace_midi_existing/{job_id}", dependencies=[Depends(verify_auth)])
async def replace_mp3_midi_existing(job_id: str, filename: str = Query(...)):
    # Look for file in processed, then raw
    target = STORAGE_PROCESSED / filename
    if not target.exists():
        target = STORAGE_RAW / filename
    
    if not target.exists():
        raise HTTPException(status_code=404, detail="MIDI file not found in library")
    
    try:
        processor.align_external_midi(job_id, target)
        return {"status": "aligned"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ==========================================================
#                   MIDI ORCHESTRATOR ROUTES
# ==========================================================

class ProcessMidiRequest(BaseModel):
    piano_tracks: List[int]
    speaker_tracks: List[int]
    pedal_preset: Optional[str] = "light"
    rhythm_factor: Optional[float] = 1.0
    melody_factor: Optional[float] = 1.0

@app.post("/midi-orchestrator/upload", dependencies=[Depends(verify_auth)])
async def upload_midi_orchestrator(file: UploadFile = File(...)):
    if not file.filename.endswith(('.mid', '.midi')):
        raise HTTPException(status_code=400, detail="Only .mid or .midi files are accepted.")
    
    contents = await file.read()
    job_id = midi_orchestrator.upload_midi(contents, file.filename)
    
    # Run Gemini AI Analysis for auto-cleaning suggestion and metadata
    try:
        settings = get_settings_data()
        api_key = settings.get('gemini_api_key')
        if api_key:
            temp_midi_path = midi_orchestrator.uploads_dir / f"{job_id}.mid"
            midi_info = gemini.extract_midi_info(str(temp_midi_path))
            gemini_data = await gemini.GeminiService(api_key).analyze_midi(midi_info)
            clean_suggested = gemini_data.get('suggested_clean', {})
            profile = clean_suggested.get('profile', 'light')
            rhythm = clean_suggested.get('rhythm_factor', 1.0)
            melody = clean_suggested.get('melody_factor', 1.0)
            
            artist = gemini_data.get('artist', '')
            genre = gemini_data.get('genre', '')
            mood = gemini_data.get('mood', '')
            clean_title = gemini_data.get('clean_title', '')
            
            # If AI returned a clean title, use it to update the displayed filename
            updated_filename = file.filename
            if clean_title:
                _, ext = os.path.splitext(file.filename)
                updated_filename = f"{clean_title}{ext}"
            
            midi_orchestrator.status[job_id].update({
                "filename": updated_filename,
                "pedal_preset": profile,
                "rhythm_factor": rhythm,
                "melody_factor": melody,
                "artist": artist,
                "genre": genre,
                "mood": mood
            })
            midi_orchestrator._save_db()
            print(f"MIDI Orchestrator AI clean settings & metadata applied for {job_id}: Title={updated_filename}, Profile={profile}, Rhythm={rhythm}, Melody={melody}")
    except Exception as e:
        print(f"MIDI Orchestrator AI clean settings extraction failed: {e}")
        
    return {"job_id": job_id, "tracks": midi_orchestrator.status[job_id]["tracks"]}

@app.get("/midi-orchestrator/notes/{job_id}", dependencies=[Depends(verify_auth)])
async def get_midi_orchestrator_notes(job_id: str):
    notes = midi_orchestrator.get_track_notes(job_id)
    if not notes:
        raise HTTPException(status_code=404, detail="Job or MIDI file not found.")
    return notes

@app.post("/midi-orchestrator/process/{job_id}", dependencies=[Depends(verify_auth)])
async def process_midi_orchestrator(job_id: str, req: ProcessMidiRequest):
    try:
        midi_orchestrator.start_processing(
            job_id,
            req.piano_tracks,
            req.speaker_tracks,
            req.pedal_preset,
            req.rhythm_factor,
            req.melody_factor
        )
        return {"status": "started"}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class MidiOrchestratorMetadataUpdate(BaseModel):
    artist: Optional[str] = None
    comments: Optional[str] = None
    rating: Optional[int] = None
    genre: Optional[str] = None
    mood: Optional[str] = None
    playlists: Optional[List[str]] = None

@app.get("/midi-orchestrator/metadata/{job_id}", dependencies=[Depends(verify_auth)])
async def get_midi_orchestrator_metadata(job_id: str):
    if job_id not in midi_orchestrator.status:
        raise HTTPException(status_code=404, detail="Job not found")
    job = midi_orchestrator.status[job_id]
    return {
        "filename": job.get("filename", ""),
        "artist": job.get("artist", ""),
        "comments": job.get("comments", ""),
        "rating": job.get("rating", 0),
        "genre": job.get("genre", ""),
        "mood": job.get("mood", ""),
        "playlists": job.get("playlists", [])
    }

@app.post("/midi-orchestrator/metadata/{job_id}", dependencies=[Depends(verify_auth)])
async def update_midi_orchestrator_metadata(job_id: str, req: MidiOrchestratorMetadataUpdate):
    if job_id not in midi_orchestrator.status:
        raise HTTPException(status_code=404, detail="Job not found")
    
    updates = {}
    if req.artist is not None: updates["artist"] = req.artist
    if req.comments is not None: updates["comments"] = req.comments
    if req.rating is not None: updates["rating"] = req.rating
    if req.genre is not None: updates["genre"] = req.genre
    if req.mood is not None: updates["mood"] = req.mood
    if req.playlists is not None: updates["playlists"] = req.playlists
    
    midi_orchestrator.status[job_id].update(updates)
    midi_orchestrator._save_db()
    return {"status": "success", "metadata": midi_orchestrator.status[job_id]}

class MidiOrchestratorRenameRequest(BaseModel):
    new_filename: str

@app.post("/midi-orchestrator/rename/{job_id}", dependencies=[Depends(verify_auth)])
async def rename_midi_orchestrator(job_id: str, req: MidiOrchestratorRenameRequest):
    if job_id not in midi_orchestrator.status:
        raise HTTPException(status_code=404, detail="Job not found")
        
    new_name = req.new_filename.strip()
    if not new_name.lower().endswith(('.mid', '.midi')):
        new_name += ".mid"
        
    midi_orchestrator.status[job_id]["filename"] = new_name
    midi_orchestrator._save_db()
    return {"status": "success", "filename": new_name}

@app.get("/midi-orchestrator/jobs", dependencies=[Depends(verify_auth)])
async def list_midi_orchestrator_jobs():
    return midi_orchestrator.list_jobs()

@app.get("/midi-orchestrator/jobs/{job_id}", dependencies=[Depends(verify_auth)])
async def get_midi_orchestrator_job(job_id: str):
    if job_id not in midi_orchestrator.status:
        raise HTTPException(status_code=404, detail="Job not found")
    return midi_orchestrator.status[job_id]

@app.delete("/midi-orchestrator/jobs/{job_id}", dependencies=[Depends(verify_auth)])
async def delete_midi_orchestrator_job(job_id: str):
    success = midi_orchestrator.delete_job(job_id)
    if not success:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"status": "deleted"}

@app.get("/midi-orchestrator/backing-audio/{job_id}")
async def get_midi_orchestrator_backing_audio(job_id: str, token: Optional[str] = None, authorization: Optional[str] = Header(None)):
    await verify_auth(authorization=authorization, token=token)
    if job_id not in midi_orchestrator.status:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = midi_orchestrator.status[job_id]
    if job["status"] != "completed" or not job["vocals"]:
        raise HTTPException(status_code=400, detail="Backing audio not ready or does not exist")
        
    wav_path = Path(job["vocals"])
    if not wav_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found on disk")
        
    return FileResponse(str(wav_path), media_type="audio/wav")


@app.get("/midi-orchestrator/preview/{job_id}")
async def get_midi_orchestrator_preview(
    job_id: str, 
    piano_tracks: str = Query(""), 
    speaker_tracks: str = Query(""), 
    pedal_preset: str = "light",
    rhythm_factor: float = 1.0,
    melody_factor: float = 1.0,
    token: Optional[str] = None, 
    authorization: Optional[str] = Header(None),
    background_tasks: BackgroundTasks = None
):
    await verify_auth(authorization=authorization, token=token)
    
    if job_id not in midi_orchestrator.status:
        raise HTTPException(status_code=404, detail="Job not found")
        
    src_midi = midi_orchestrator.uploads_dir / f"{job_id}.mid"
    if not src_midi.exists():
        src_midi = midi_orchestrator.jobs_dir / job_id / "original.mid"
        if not src_midi.exists():
            raise HTTPException(status_code=404, detail="Original MIDI file not found")
            
    # Parse track lists
    p_tracks = [int(x) for x in piano_tracks.split(",") if x.strip()]
    s_tracks = [int(x) for x in speaker_tracks.split(",") if x.strip()]
    
    try:
        import pretty_midi
        temp_dir = Path(tempfile.mkdtemp())
        temp_midi = temp_dir / "preview.mid"
        temp_wav = temp_dir / "preview.wav"
        
        pm = pretty_midi.PrettyMIDI(str(src_midi))
        preview_pm = pretty_midi.PrettyMIDI()
        
        # Merge selected piano tracks
        piano_notes = []
        for idx in p_tracks:
            if idx < len(pm.instruments):
                piano_notes.extend(pm.instruments[idx].notes)
                
        if piano_notes:
            # Piano instrument program is 0
            piano_inst = pretty_midi.Instrument(program=0, name="Piano Preview")
            piano_inst.notes = piano_notes
            preview_pm.instruments.append(piano_inst)
            
        # Add selected speaker tracks
        for idx in s_tracks:
            if idx < len(pm.instruments):
                orig_inst = pm.instruments[idx]
                new_inst = pretty_midi.Instrument(program=orig_inst.program, name=orig_inst.name, is_drum=orig_inst.is_drum)
                new_inst.notes = orig_inst.notes
                new_inst.control_changes = orig_inst.control_changes
                preview_pm.instruments.append(new_inst)
                
        preview_pm.write(str(temp_midi))
        
        # Render to WAV using FluidSynth
        utils.render_midi_to_wav_with_soundfont(
            str(temp_midi),
            str(midi_orchestrator.soundfont_path),
            str(temp_wav)
        )
        
        def cleanup():
            try:
                shutil.rmtree(str(temp_dir))
            except Exception:
                pass
                
        if background_tasks:
            background_tasks.add_task(cleanup)
            
        return FileResponse(str(temp_wav), media_type="audio/wav")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/midi-orchestrator/play/{job_id}", dependencies=[Depends(verify_auth)])
async def play_midi_orchestrator(job_id: str):
    if job_id not in midi_orchestrator.status:
        raise HTTPException(status_code=404, detail="Job not found")
        
    job = midi_orchestrator.status[job_id]
    if job["status"] != "completed" or not job["midi"]:
        raise HTTPException(status_code=400, detail="Job not completed")
        
    midi_path = Path(job["midi"])
    if not midi_path.exists():
        raise HTTPException(status_code=404, detail="Midi file not found on disk")
        
    if not (utils._ble_handle and utils._ble_handle.connected):
        raise HTTPException(status_code=400, detail="Piano not connected")
        
    try:
        utils.start_play_async(str(midi_path))
        return {"status": "playing"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == '__main__':
    uvicorn.run('app.main:app', host='0.0.0.0', port=8000, reload=False)
