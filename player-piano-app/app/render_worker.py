import sys
import os
import argparse
import time
import traceback
from pathlib import Path

# Ensure app package is in python path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import utils, midi_orchestrator

class DualLogger:
    """Logs output simultaneously to stdout and a file."""
    def __init__(self, log_file_path: Path):
        self.terminal = sys.stdout
        self.log_file = open(log_file_path, "a", encoding="utf-8", buffering=1) # Line buffered

    def write(self, message):
        self.terminal.write(message)
        self.log_file.write(message)
        self.log_file.flush()

    def flush(self):
        self.terminal.flush()
        self.log_file.flush()

def run_worker(job_id: str, storage_dir: str):
    storage_path = Path(storage_dir)
    orchestrator = midi_orchestrator.MidiOrchestrator(storage_path)
    
    job_dir = orchestrator.jobs_dir / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    
    log_file_path = job_dir / "worker.log"
    # Redirect stdout and stderr to DualLogger
    dual_logger = DualLogger(log_file_path)
    sys.stdout = dual_logger
    sys.stderr = dual_logger

    t0 = time.time()
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] --- WORKER PROCESS STARTED FOR JOB {job_id} ---")
    print(f"Worker Process PID: {os.getpid()}")
    print(f"Storage Directory: {storage_dir}")
    print(f"Job Directory: {job_dir}")

    job_info = orchestrator.status.get(job_id)
    if not job_info:
        print(f"ERROR: Job {job_id} not found in orchestrator database!")
        sys.exit(1)

    try:
        orchestrator.status[job_id]["status"] = "processing"
        orchestrator.status[job_id]["progress"] = 10
        orchestrator.status[job_id]["pid"] = os.getpid()
        orchestrator._save_db()
        print(f"Job status updated to 'processing' (10%)")

        # Execute processing logic directly in this worker process
        print("Executing synthesis task in isolated subprocess...")
        piano_tracks = job_info.get("piano_tracks", [])
        speaker_tracks = job_info.get("speaker_tracks", [])
        pedal_preset = job_info.get("pedal_preset", "light")
        rhythm_factor = job_info.get("rhythm_factor", 0.85)
        melody_factor = job_info.get("melody_factor", 1.0)
        vocal_male_tracks = job_info.get("vocal_male_tracks", [])
        vocal_female_tracks = job_info.get("vocal_female_tracks", [])

        orchestrator._process_task(
            job_id,
            piano_tracks,
            speaker_tracks,
            pedal_preset,
            rhythm_factor,
            melody_factor,
            vocal_male_tracks,
            vocal_female_tracks
        )

        elapsed = time.time() - t0
        print(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] --- WORKER PROCESS COMPLETED SUCCESSFULLY IN {elapsed:.2f}s ---")
        sys.exit(0)

    except Exception as e:
        elapsed = time.time() - t0
        print(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] ERROR in worker process after {elapsed:.2f}s: {e}")
        traceback.print_exc(file=sys.stdout)
        if job_id in orchestrator.status:
            orchestrator.status[job_id].update({
                "status": "failed",
                "error": str(e),
                "progress": 100
            })
            orchestrator._save_db()
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Isolated Worker for MIDI Orchestrator Synthesis")
    parser.add_argument("--job-id", required=True, help="Job ID to process")
    parser.add_argument("--storage-dir", required=True, help="Path to storage directory")
    args = parser.parse_args()

    run_worker(args.job_id, args.storage_dir)
