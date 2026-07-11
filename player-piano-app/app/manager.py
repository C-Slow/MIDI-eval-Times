import os
import json
import threading
import time
import random
from pathlib import Path
from typing import Dict, List
from app import utils


class PlaylistManager:
    def __init__(self, raw_dir: str, processed_dir: str, playlists_file: str):
        self.raw_dir = Path(raw_dir)
        self.processed_dir = Path(processed_dir)
        self.playlists_file = playlists_file
        self.playlists = {}
        self.smart_rules = {}
        self._load()

        self.lock = threading.Lock()
        self.play_thread = None
        self.stop_event = threading.Event()
        self._stop_requested = False
        
        # New state tracking
        self.current_playlist_name = None
        self.current_index = 0
        self.current_file = None
        self.start_time = None
        self.track_length = None
        self.seek_offset = 0
        self.active_tracks = []
        self.active_port = None
        self.repeat = False

    def _load(self):
        if os.path.exists(self.playlists_file):
            try:
                with open(self.playlists_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        # Support for smart rules storage
                        if '_smart_rules' in data:
                            self.smart_rules = data.pop('_smart_rules')
                        self.playlists = data
                    else:
                        self.playlists = data
            except Exception as e:
                print(f"Error loading playlists: {e}")
                self.playlists = {}
        else:
            self.playlists = {}

    def _save(self):
        try:
            data = dict(self.playlists)
            if self.smart_rules:
                data['_smart_rules'] = self.smart_rules
            with open(self.playlists_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            print(f"Error saving playlists: {e}")

    def list_playlists(self) -> Dict[str, List[str]]:
        return self.playlists

    def create_playlist(self, name: str):
        if name in self.playlists:
            raise ValueError('playlist exists')
        self.playlists[name] = []
        self._save()

    def add_to_playlist(self, name: str, filename: str):
        if name not in self.playlists:
            raise KeyError('no such playlist')
        
        is_valid_hybrid = False
        if filename.startswith("hybrid:"):
            job_id = filename.split(":", 1)[1]
            from app.main import midi_orchestrator
            is_valid_hybrid = job_id in midi_orchestrator.status and midi_orchestrator.status[job_id].get("validated", False)
        
        if not is_valid_hybrid and not (self.processed_dir / filename).exists():
            print(f"SECURITY: Blocked attempt to add raw file '{filename}' to playlist '{name}'")
            return

        if filename not in self.playlists[name]:
            self.playlists[name].append(filename)
            self._save()

    def remove_from_playlist(self, name: str, filename: str):
        if name not in self.playlists:
            raise KeyError('no such playlist')
        self.playlists[name] = [f for f in self.playlists[name] if f != filename]
        self._save()

    def get_playlist(self, name: str) -> List[str]:
        return self.playlists.get(name, [])

    def _resolve_path(self, filename: str):
        p = self.processed_dir / filename
        if p.exists():
            return str(p)
        p = self.raw_dir / filename
        if p.exists():
            return str(p)
        return None

    def play_playlist(self, name: str, shuffle: bool = False, port_name: str = None, start_index: int = 0, offset: float = 0, repeat: bool = False):
        print(f"DEBUG: Manager.play_playlist - Name: {name}, Port: {port_name}, Tracks: {len(self.playlists.get(name, []))}")
        if name not in self.playlists:
            raise KeyError('no such playlist')

        self.stop()
        utils.stop_current_play()

        self.current_playlist_name = name
        self.current_index = start_index
        self.active_port = port_name
        self.seek_offset = offset
        self.repeat = repeat
        
        tracks = list(self.playlists[name])
        if start_index == 0:
            if shuffle:
                random.shuffle(tracks)
            self.active_tracks = tracks
        
        print(f"DEBUG: Starting worker thread for {len(self.active_tracks)} tracks...")

        def worker():
            print("DEBUG: Worker thread started.")
            self.stop_event.clear()
            self._stop_requested = False
            
            try:
                while not self._stop_requested:
                    for i in range(self.current_index, len(self.active_tracks)):
                        if self._stop_requested:
                            break
                        
                        self.current_index = i
                        fn = self.active_tracks[i]
                        
                        audio_path = None
                        global_offset_ms = 0.0
                        
                        if fn.startswith("hybrid:"):
                            job_id = fn.split(":", 1)[1]
                            from app.main import midi_orchestrator
                            job = midi_orchestrator.status.get(job_id)
                            if not job:
                                continue
                            path = job.get("midi")
                            audio_path = job.get("vocals")
                            global_offset_ms = job.get("sync_offset", 0.0)
                        else:
                            path = self._resolve_path(fn)
                            
                        print(f"DEBUG: Worker processing track {i}: {fn} (Path: {path}, Audio: {audio_path}, Offset: {global_offset_ms}ms)")
                        if not path or not os.path.exists(path):
                            continue
                        
                        info = utils.get_midi_info(path)
                        self.current_file = fn
                        self.track_length = info.get('length')
                        self.start_time = time.time()
                        
                        current_offset = self.seek_offset if (i == self.current_index and self.seek_offset > 0) else 0
                        if current_offset > 0:
                            self.start_time -= current_offset

                        if not utils._get_out(port_name):
                            utils._log("Playlist stopped: MIDI output not available")
                            self._stop_requested = True
                            break

                        utils.play_midi_blocking(
                            path, 
                            port_name, 
                            stop_event=self.stop_event, 
                            start_offset=current_offset,
                            audio_path=audio_path,
                            global_offset_ms=global_offset_ms
                        )
                        self.seek_offset = 0
                        
                        if self.stop_event.is_set():
                            if self._stop_requested:
                                break
                            else:
                                self.stop_event.clear()
                        
                        if self.stop_event.wait(1.0):
                            if self._stop_requested:
                                break
                            self.stop_event.clear()
                    
                    if self._stop_requested or not self.repeat:
                        break
                    self.current_index = 0
            finally:
                self.current_playlist_name = None
                self.current_index = 0
                self.current_file = None
                self.start_time = None
                self.track_length = None
                self._stop_requested = False
                self.stop_event.clear()

        t = threading.Thread(target=worker, daemon=True)
        self.play_thread = t
        utils._current_play['thread'] = t 
        t.start()

    def seek(self, offset: float):
        if not self.play_thread or not self.play_thread.is_alive() or self.current_playlist_name is None:
            return
        self.play_playlist(self.current_playlist_name, shuffle=False, port_name=self.active_port, 
                           start_index=self.current_index, offset=offset, repeat=self.repeat)

    def stop(self):
        self._stop_requested = True
        self.stop_event.set()
        if self.play_thread and self.play_thread.is_alive():
            self.play_thread.join(timeout=1.5)
        self.play_thread = None
        self.repeat = False

    def skip(self):
        self.stop_event.set()

    def status(self):
        playing = self.play_thread is not None and self.play_thread.is_alive()
        elapsed = 0
        if playing and self.start_time:
            elapsed = time.time() - self.start_time
            
        from app.utils import load_settings
        settings = load_settings()
        return {
            'playing': playing,
            'current_playlist': self.current_playlist_name,
            'current_index': self.current_index,
            'file': self.current_file,
            'elapsed': elapsed,
            'length': self.track_length,
            'repeat': self.repeat,
            'backend_audio_enabled': settings.get("backend_audio_enabled", False)
        }
