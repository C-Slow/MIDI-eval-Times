import os
import sys
import json
from pathlib import Path
from tqdm import tqdm

# Add project root to path so we can import from app
project_root = Path(__file__).resolve().parents[1]
sys.path.append(str(project_root / 'player-piano-app'))

from app import utils

BASE_DIR = project_root
STORAGE_RAW = BASE_DIR / 'storage' / 'raw'
STORAGE_PROCESSED = BASE_DIR / 'storage' / 'processed'
METADATA_FILE = BASE_DIR / 'storage' / 'metadata.json'

def main():
    print(">>> Starting Bulk Re-clean with updated Pedal Presets...")
    
    # 1. Get all metadata to know how each file was cleaned originally
    all_meta = utils.get_all_metadata()
    
    # 2. Get list of all currently processed files
    processed_files = [f.name for f in STORAGE_PROCESSED.iterdir() if f.suffix.lower() in ('.mid', '.midi')]
    print(f"--- Found {len(processed_files)} processed files to re-clean.")

    success_count = 0
    fail_count = 0
    missing_raw_count = 0

    for filename in tqdm(processed_files, desc="Re-cleaning"):
        meta = all_meta.get(filename, {})
        original_name = meta.get('original_name')
        profile = meta.get('clean_profile', 'light')
        rhythm = meta.get('rhythm_factor', 1.0)
        melody = meta.get('melody_factor', 1.0)

        # Skip files marked as "Do Not Use" if requested (optional, here we re-clean everything)
        # if meta.get('dnu'): continue

        # 3. Find the raw file
        raw_path = None
        if original_name:
            path = STORAGE_RAW / original_name
            if path.exists():
                raw_path = path
        
        # Fallback search if original_name is missing or moved
        if not raw_path:
            base = filename.replace('.mid', '').replace('.midi', '')
            for suffix in ['.mid', '.midi']:
                # Try common naming patterns
                for pattern in [f"{base}_original{suffix}", f"{base}{suffix}"]:
                    path = STORAGE_RAW / pattern
                    if path.exists():
                        raw_path = path
                        original_name = path.name
                        break
                if raw_path: break
        
        if not raw_path:
            # print(f"!!! Skipping {filename}: Could not find raw original.")
            missing_raw_count += 1
            continue

        # 4. Run the cleaning script
        try:
            # run_clean(input_path, output_folder, profile, rhythm, melody)
            # This uses the updated clean_midi.py internally
            utils.run_clean(str(raw_path), str(STORAGE_PROCESSED), profile, rhythm, melody)
            
            # Ensure the metadata reflects the original name we found
            if original_name and meta.get('original_name') != original_name:
                utils.update_file_metadata(filename, {"original_name": original_name})
                
            success_count += 1
        except Exception as e:
            print(f"!!! Error re-cleaning {filename}: {e}")
            fail_count += 1

    print("\n>>> Bulk Re-clean Finished!")
    print(f"--- Successfully re-cleaned: {success_count}")
    print(f"--- Failed to clean: {fail_count}")
    print(f"--- Missing raw original files: {missing_raw_count}")
    print("--- Note: All files in 'storage/processed' now use the updated pedal presets.")

if __name__ == "__main__":
    main()
