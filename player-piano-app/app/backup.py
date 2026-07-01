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

def rotate_backups(backup_dir: Path, max_backups: int = 30):
    """
    Deletes oldest backups if more than max_backups exist.
    """
    if not backup_dir.exists():
        return

    # Get all backups and sort by filename (which contains timestamp: backup_YYYY-MM-DD_HH-MM-SS.zip)
    backups = sorted(list(backup_dir.glob("backup_*.zip")))
    
    deleted_count = 0
    if len(backups) > max_backups:
        # The oldest files will be at the start of the sorted list
        num_to_delete = len(backups) - max_backups
        to_delete = backups[:num_to_delete]
        
        for file in to_delete:
            try:
                file.unlink()
                print(f"Deleted old backup (count limit): {file.name}")
                deleted_count += 1
            except Exception as e:
                print(f"Error deleting old backup {file.name}: {e}")
    
    return deleted_count

def run_backup_cycle(storage_dir: str, max_backups: int = 30):
    s_path = Path(storage_dir)
    b_path = s_path / 'backups'
    
    create_backup(s_path, b_path)
    rotate_backups(b_path, max_backups)
