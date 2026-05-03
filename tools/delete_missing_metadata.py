import os
import json
import shutil
from pathlib import Path

# Setup paths
PROJECT_ROOT = Path(__file__).resolve().parents[1]
STORAGE_DIR = PROJECT_ROOT / 'storage'
PROCESSED_DIR = STORAGE_DIR / 'processed'
RAW_DIR = STORAGE_DIR / 'raw'
METADATA_FILE = STORAGE_DIR / 'metadata.json'
PLAYLISTS_FILE = STORAGE_DIR / 'playlists.json'

def load_json(filepath):
    if filepath.exists():
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading {filepath}: {e}")
    return {}

def save_json(filepath, data):
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

def main(dry_run=True):
    metadata = load_json(METADATA_FILE)
    playlists = load_json(PLAYLISTS_FILE)

    # Determine files without metadata
    # We define "without metadata" as missing 'gemini_analysis' or missing from metadata.json
    files_to_delete = []
    
    processed_files = list(PROCESSED_DIR.glob('*.mid')) + list(PROCESSED_DIR.glob('*.midi'))
    
    for file_path in processed_files:
        filename = file_path.name
        meta = metadata.get(filename, {})
        
        # Check if the file is missing AI metadata
        if not meta.get('gemini_analysis') and not meta.get('artist'):
            files_to_delete.append(filename)

    print(f"Found {len(files_to_delete)} files missing metadata.")

    if dry_run:
        print("\n--- DRY RUN: The following files would be deleted ---")
        for f in files_to_delete:
            print(f" - {f}")
        print("\nRun with dry_run=False in the script to actually delete them.")
        return

    print("\n--- DELETING FILES ---")
    deleted_count = 0
    for filename in files_to_delete:
        meta = metadata.get(filename, {})
        original_name = meta.get('original_name', filename)

        # 1. Delete processed file
        processed_path = PROCESSED_DIR / filename
        if processed_path.exists():
            processed_path.unlink()
            print(f"Deleted processed: {filename}")

        # 2. Delete raw file
        raw_path = RAW_DIR / original_name
        if raw_path.exists():
            raw_path.unlink()
            print(f"Deleted raw: {original_name}")
        else:
            # Fallback raw name check
            base = filename.replace('.mid', '').replace('.midi', '')
            for suffix in ['.mid', '.midi']:
                fallback_path = RAW_DIR / f"{base}_original{suffix}"
                if fallback_path.exists():
                    fallback_path.unlink()
                    print(f"Deleted raw (fallback): {fallback_path.name}")
                    break

        # 3. Remove from metadata.json
        if filename in metadata:
            del metadata[filename]

        # 4. Remove from playlists
        for pl_name, tracks in playlists.items():
            if isinstance(tracks, list) and filename in tracks:
                playlists[pl_name] = [t for t in tracks if t != filename]
                
        deleted_count += 1

    # Save updated json files
    save_json(METADATA_FILE, metadata)
    save_json(PLAYLISTS_FILE, playlists)
    
    print(f"\nSuccessfully deleted {deleted_count} files and cleaned up references.")

if __name__ == '__main__':
    # Set to False to perform actual deletion
    main(dry_run=False)
