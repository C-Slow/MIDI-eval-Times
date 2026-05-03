import os
import sys
import json
import re
import asyncio
import httpx
from pathlib import Path

# Add project root to path so we can import from app
project_root = Path(__file__).resolve().parents[1]
sys.path.append(str(project_root / 'player-piano-app'))

from app import utils, gemini
from app.manager import PlaylistManager

BASE_DIR = project_root
STORAGE_RAW = BASE_DIR / 'storage' / 'raw'
STORAGE_PROCESSED = BASE_DIR / 'storage' / 'processed'
SETTINGS_FILE = BASE_DIR / 'storage' / 'settings.json'
METADATA_FILE = BASE_DIR / 'storage' / 'metadata.json'
PLAYLISTS_FILE = BASE_DIR / 'storage' / 'playlists.json'

def get_api_key():
    try:
        data = json.loads(SETTINGS_FILE.read_text(encoding='utf-8'))
        return data.get('gemini_api_key')
    except:
        return None

async def reload_backend_playlists():
    """Notify the running backend to reload playlists from disk."""
    try:
        # Get server URL from settings
        data = json.loads(SETTINGS_FILE.read_text(encoding='utf-8'))
        # Try serverUrl from native app settings, otherwise use standard default
        url = data.get('serverUrl', 'http://127.0.0.1:8000') 
        url = url.rstrip('/')
        
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{url}/playlists/reload")
            if resp.status_code == 200:
                print("--- Backend playlists reloaded successfully.")
            else:
                print(f"--- Warning: Backend reload returned {resp.status_code}")
    except Exception as e:
        print(f"--- Warning: Could not notify backend to reload: {e}")

def rename_track_in_playlists(old_name, new_name):
    """Manually update playlists.json since manager doesn't have a bulk rename helper."""
    if not os.path.exists(PLAYLISTS_FILE):
        return
    try:
        with open(PLAYLISTS_FILE, 'r', encoding='utf-8') as f:
            playlists = json.load(f)
        
        changed = False
        for pl_name in playlists:
            tracks = playlists[pl_name]
            if old_name in tracks:
                playlists[pl_name] = [new_name if t == old_name else t for t in tracks]
                changed = True
        
        if changed:
            with open(PLAYLISTS_FILE, 'w', encoding='utf-8') as f:
                json.dump(playlists, f, indent=2)
            print(f"--- Updated playlists file for {new_name}")
    except Exception as e:
        print(f"!!! Error updating playlists: {e}")

async def reclean_file(filename: str, api_key: str):
    print(f"\n>>> Processing: {filename}")
    
    # 1. Find the original file
    all_meta = utils.get_all_metadata()
    meta = all_meta.get(filename, {})
    original_name = meta.get('original_name')
    
    raw_path = None
    if original_name:
        path = STORAGE_RAW / original_name
        if path.exists():
            raw_path = path
            
    if not raw_path:
        base = filename.replace('.mid', '').replace('.midi', '')
        for suffix in ['.mid', '.midi']:
            path = STORAGE_RAW / f"{base}_original{suffix}"
            if path.exists():
                raw_path = path
                original_name = path.name
                break
                
    if not raw_path:
        if (STORAGE_RAW / filename).exists():
            raw_path = STORAGE_RAW / filename
            original_name = filename

    if not raw_path:
        print(f"!!! Error: Could not find original raw file for {filename}")
        return False

    # 2. Gemini Analysis
    gs = gemini.GeminiService(api_key)
    midi_info = gemini.extract_midi_info(str(raw_path))
    print(f"--- Analyzing with Gemini...")
    gemini_data = await gs.analyze_midi(midi_info)
    
    if not gemini_data:
        print("!!! Error: Gemini analysis failed.")
        return False

    # 3. Determine new name and re-clean settings
    clean_suggested = gemini_data.get('suggested_clean', {})
    profile = clean_suggested.get('profile', 'light')
    rhythm = clean_suggested.get('rhythm_factor', 0.75)
    melody = clean_suggested.get('melody_factor', 0.75)
    
    clean_title = gemini_data.get('clean_title')
    final_filename = filename
    new_base = None
    
    if clean_title:
        slug = re.sub(r'[^a-z0-9]+', '-', clean_title.lower()).strip('-')
        if slug:
            new_base = slug
            new_name = f"{slug}.mid"
            if new_name != filename:
                print(f"--- Renaming suggested: {filename} -> {new_name}")
                final_filename = new_name

    # 4. Perform Renaming (if name changed)
    if final_filename != filename:
        if (STORAGE_PROCESSED / final_filename).exists():
            print(f"!!! Warning: Target filename {final_filename} already exists. Skipping rename.")
            final_filename = filename 
        else:
            new_raw_name = f"{final_filename.replace('.mid', '')}_original.mid"
            os.rename(raw_path, STORAGE_RAW / new_raw_name)
            raw_path = STORAGE_RAW / new_raw_name
            original_name = new_raw_name
            
            if (STORAGE_PROCESSED / filename).exists():
                os.remove(STORAGE_PROCESSED / filename)
                
            rename_track_in_playlists(filename, final_filename)
            
            if filename in all_meta:
                all_meta[final_filename] = all_meta.pop(filename)
                utils.save_all_metadata(all_meta)

    # 5. Run Re-clean
    print(f"--- Re-cleaning with Profile:{profile}, R:{rhythm}, M:{melody}")
    try:
        utils.run_clean(str(raw_path), str(STORAGE_PROCESSED), profile, rhythm, melody)
        
        # 6. Update Metadata
        metadata_updates = {
            "original_name": original_name,
            "clean_profile": profile,
            "rhythm_factor": rhythm,
            "melody_factor": melody,
            "artist": gemini_data.get('artist'),
            "genre": gemini_data.get('genre'),
            "mood": gemini_data.get('mood'),
            "source": gemini_data.get('source'),
            "is_game_or_movie": gemini_data.get('is_game_or_movie'),
            "gemini_analysis": gemini_data
        }
        utils.update_file_metadata(final_filename, metadata_updates)
        print(f"+++ Successfully processed: {final_filename}")
        
        if final_filename != filename:
            await reload_backend_playlists()
            
        return True
    except Exception as e:
        print(f"!!! Error during re-clean: {e}")
        return False

async def main():
    if len(sys.argv) < 2:
        print("Usage: python tools/reclean_with_ai.py <filename_or_all>")
        return

    api_key = get_api_key()
    if not api_key:
        print("Error: No Gemini API Key found in storage/settings.json")
        return

    target = sys.argv[1]
    
    if target.lower() == 'all':
        files = [f.name for f in STORAGE_PROCESSED.iterdir() if f.suffix.lower() in ('.mid', '.midi')]
        print(f"Total files to process: {len(files)}")
        
        for i, f in enumerate(files):
            print(f"\n[{i+1}/{len(files)}]")
            await reclean_file(f, api_key)
            await asyncio.sleep(1)
    else:
        await reclean_file(target, api_key)

if __name__ == "__main__":
    asyncio.run(main())
