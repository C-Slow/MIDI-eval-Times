import os
import sys
import json
from pathlib import Path
from tqdm import tqdm

# Add project root to path so we can import from app
project_root = Path(__file__).resolve().parents[1]
sys.path.append(str(project_root / 'player-piano-app'))

from app import utils
from app.audio_processor import AudioProcessor

BASE_DIR = project_root
STORAGE_RAW = BASE_DIR / 'storage' / 'raw'
STORAGE_PROCESSED = BASE_DIR / 'storage' / 'processed'
STORAGE_SEPARATED = BASE_DIR / 'storage' / 'separated'

def reclean_main_library():
    print("\n>>> Re-cleaning Main Library (storage/processed)...")
    all_meta = utils.get_all_metadata()
    processed_files = [f.name for f in STORAGE_PROCESSED.iterdir() if f.suffix.lower() in ('.mid', '.midi')]
    
    success = 0
    for filename in tqdm(processed_files, desc="Main Library"):
        meta = all_meta.get(filename, {})
        original_name = meta.get('original_name')
        profile = meta.get('clean_profile', 'light')
        rhythm = meta.get('rhythm_factor', 1.0)
        melody = meta.get('melody_factor', 1.0)

        raw_path = None
        if original_name:
            path = STORAGE_RAW / original_name
            if path.exists(): raw_path = path
        
        if not raw_path:
            base = filename.replace('.mid', '').replace('.midi', '')
            for suffix in ['.mid', '.midi']:
                for pattern in [f"{base}_original{suffix}", f"{base}{suffix}"]:
                    path = STORAGE_RAW / pattern
                    if path.exists():
                        raw_path = path
                        break
                if raw_path: break
        
        if not raw_path: continue

        try:
            # This calls the updated clean_midi.py internally
            utils.run_clean(str(raw_path), str(STORAGE_PROCESSED), profile, rhythm, melody)
            success += 1
        except Exception as e:
            print(f"Error {filename}: {e}")
    print(f"--- Finished Main Library: {success} files updated.")

def reclean_orchestrator():
    print("\n>>> Re-cleaning MP3 Orchestrator Jobs (storage/separated)...")
    # Initialize processor pointing to the correct storage directory
    processor = AudioProcessor(storage_dir=(project_root / 'storage'))
    jobs = processor.list_jobs()
    
    success = 0
    for job in tqdm(jobs, desc="Orchestrator Jobs"):
        if job.get("status") == "completed":
            try:
                # _clean_job_midi internally uses the updated clean_midi.py logic
                processor._clean_job_midi(job["job_id"])
                success += 1
            except Exception as e:
                print(f"Error job {job['job_id']}: {e}")
    print(f"--- Finished Orchestrator: {success} jobs updated.")

def main():
    reclean_main_library()
    reclean_orchestrator()
    print("\n>>> All processed files have been updated with the new pedal presets.")

if __name__ == "__main__":
    main()
