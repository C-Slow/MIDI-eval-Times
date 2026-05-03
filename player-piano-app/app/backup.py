import os
import shutil
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

def create_backup(storage_dir: Path, backup_dir: Path):
    """
    Creates a zip backup of the storage directory.
    Includes raw, processed, metadata.json, playlists.json, settings.json.
    """
    if not backup_dir.exists():
        backup_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    zip_name = f"backup_{timestamp}.zip"
    zip_path = backup_dir / zip_name

    # Directories/files to include
    targets = ['raw', 'processed', 'metadata.json', 'playlists.json', 'settings.json']

    try:
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for target in targets:
                target_path = storage_dir / target
                if not target_path.exists():
                    continue
                
                if target_path.is_dir():
                    for root, _, files in os.walk(target_path):
                        for file in files:
                            file_full_path = Path(root) / file
                            # Store relative to storage_dir
                            arcname = file_full_path.relative_to(storage_dir)
                            zipf.write(file_full_path, arcname)
                else:
                    zipf.write(target_path, target)
        
        print(f"Backup created: {zip_name}")
        return zip_name
    except Exception as e:
        print(f"Backup failed: {e}")
        return None

def rotate_backups(backup_dir: Path, keep_days: int = 7):
    """
    Deletes backups older than keep_days.
    """
    if not backup_dir.exists():
        return

    now = datetime.now()
    cutoff = now - timedelta(days=keep_days)

    deleted_count = 0
    for file in backup_dir.glob("backup_*.zip"):
        try:
            # Filename format: backup_YYYY-MM-DD_HH-MM-SS.zip
            file_time_str = file.name.replace("backup_", "").replace(".zip", "")
            # We only need the date part for comparison
            file_date = datetime.strptime(file_time_str, "%Y-%m-%d_%H-%M-%S")
            
            if file_date < cutoff:
                file.unlink()
                print(f"Deleted old backup: {file.name}")
                deleted_count += 1
        except Exception as e:
            print(f"Error checking backup rotation for {file.name}: {e}")
    
    return deleted_count

def run_backup_cycle(storage_dir: str, keep_days: int = 7):
    s_path = Path(storage_dir)
    b_path = s_path / 'backups'
    
    create_backup(s_path, b_path)
    rotate_backups(b_path, keep_days)
