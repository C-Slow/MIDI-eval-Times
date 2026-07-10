# 📋 Plan: Hybrid & Orchestrated Songs Integration in Playlists

This plan outlines the architecture and implementation steps to integrate AI-orchestrated/hybrid songs (MIDI + synced vocal/instrumental audio) with static and dynamic (smart) playlists, playing them seamlessly alongside normal MIDI files.

---

## 🏗️ Architecture Overview

The system currently handles two types of media files:
1. **Normal MIDI files:** Raw piano key events stored in `storage/processed/` that play exclusively on the piano (or synthesize to WAV for mobile preview).
2. **Orchestrated/Hybrid songs:** Jobs stored in `storage/midi_orchestrator/jobs/` that pair a MIDI track with parsed vocals (`vocals.wav`) and backing instruments, synchronized via Dynamic Time Warping (DTW) alignments.

To unify them, we will introduce a new **Validation Stage** in the MIDI Editor. Once validated, hybrid songs are exposed to the playlist engine via a virtual URI scheme (`hybrid:{job_id}`).

```mermaid
graph TD
    subgraph MIDI Editor (Perform Tab)
        A[Orchestrated Job] -->|User Reviews & Tags| B(Validated Status)
    end

    subgraph Database
        B -->|Saves state| C[(midi_jobs.json)]
    end

    subgraph Playlist Engine
        C -->|Exposes validated jobs| D[Smart Playlist Rules]
        C -->|Exposes validated jobs| E[Manual Playlist Builder]
        D -->|Resolves tracks| F[Playlist Queue Manager]
        E -->|Resolves tracks| F
    end

    subgraph Playback Queue
        F -->|Normal MIDI| G[Play MIDI on Piano]
        F -->|hybrid:job_id| H[Sync MIDI + Vocals Audio]
        H -->|Backend Audio Enabled| I[Audio on Backend Speakers + MIDI on Piano]
        H -->|Backend Audio Disabled| J[Audio on Phone Speakers + MIDI on Piano]
    end
```

---

## 🛠️ Step-by-Step Implementation Plan

### Phase 1: Database & Validation API

We need to add a `"validated"` boolean flag to the jobs schema and provide a toggle endpoint.

#### 1. Update Database Schema
In [midi_jobs.json](file:///C:/Users/coren/Projects/MIDI-eval%20Times/storage/midi_orchestrator/midi_jobs.json), completed jobs will gain a new metadata property:
```json
"validated": true
```

#### 2. Implement Validation Endpoint
Add a new route in [main.py](file:///C:/Users/coren/Projects/MIDI-eval%20Times/player-piano-app/app/main.py) to toggle this flag:
```python
@app.post("/midi-orchestrator/jobs/{job_id}/validate", dependencies=[Depends(verify_auth)])
async def validate_midi_orchestrator_job(job_id: str, validated: bool = Query(...)):
    if job_id not in midi_orchestrator.status:
        raise HTTPException(status_code=404, detail="Job not found")
    
    midi_orchestrator.status[job_id]["validated"] = validated
    midi_orchestrator._save_db()
    return {"status": "success", "job_id": job_id, "validated": validated}
```

---

### Phase 2: Smart & Static Playlists Integration

Currently, [manager.py](file:///C:/Users/coren/Projects/MIDI-eval%20Times/player-piano-app/app/manager.py) and smart playlist generators only look at the physical MIDI files in `STORAGE_PROCESSED`. We will extend this to include virtual `hybrid:{job_id}` entries.

#### 1. Expose Validated Hybrid Songs to Smart Rule Generator
In [main.py](file:///C:/Users/coren/Projects/MIDI-eval%20Times/player-piano-app/app/main.py#L696-L766), modify `generate_smart_playlist_logic` to query both files and validated jobs:

```python
def generate_smart_playlist_logic(name: str, filters: List[Dict[str, str]], exclude_dnu: bool):
    all_meta = utils.get_all_metadata()
    processed_files = [p.name for p in STORAGE_PROCESSED.iterdir() if p.suffix.lower() in ('.mid', '.midi')]
    
    # 1. Gather all candidates (Normal MIDIs + Validated Hybrid Songs)
    candidates = []
    for fn in processed_files:
        candidates.append({
            'id': fn,
            'meta': all_meta.get(fn, {})
        })
        
    for job_id, job in midi_orchestrator.status.items():
        if job.get("status") == "completed" and job.get("validated"):
            candidates.append({
                'id': f"hybrid:{job_id}",
                'meta': {
                    'artist': job.get('artist', 'Unknown'),
                    'genre': job.get('genre', ''),
                    'mood': job.get('mood', ''),
                    'source': job.get('source', ''),
                    'rating': job.get('rating', 0),
                    'dnu': job.get('dnu', False)
                }
            })
            
    to_add = []
    for item in candidates:
        track_id = item['id']
        meta = item['meta']
        
        if exclude_dnu and meta.get('dnu'):
            continue
            
        all_filters_match = True
        for f in filters:
            f_type = f.get('filter_type')
            f_val = f.get('filter_value', '')
            
            # (Keep existing filter matching logic on meta)
            # ...
            
        if all_filters_match:
            to_add.append(track_id)
```

#### 2. Update Playlist manager Security Checks
In [manager.py](file:///C:/Users/coren/Projects/MIDI-eval%20Times/player-piano-app/app/manager.py#L73-L84), update `add_to_playlist` to recognize and allow `hybrid:` prefixes:
```python
    def add_to_playlist(self, name: str, filename: str):
        if name not in self.playlists:
            raise KeyError('no such playlist')
        
        # Allow if it's a valid hybrid URI or a processed MIDI file
        is_valid_hybrid = False
        if filename.startswith("hybrid:"):
            job_id = filename.split(":", 1)[1]
            from app.main import midi_orchestrator
            is_valid_hybrid = job_id in midi_orchestrator.status and midi_orchestrator.status[job_id].get("validated")
            
        if not is_valid_hybrid and not (self.processed_dir / filename).exists():
            print(f"SECURITY: Blocked attempt to add invalid file '{filename}' to playlist '{name}'")
            return

        if filename not in self.playlists[name]:
            self.playlists[name].append(filename)
            self._save()
```

---

### Phase 3: Playback Sync & Speaker Handling

We must modify the playback thread in `PlaylistManager` to parse and delegate the hybrid paths (MIDI path + Audio path + Timing offsets) to the core player.

#### 1. Extend `play_midi_blocking` helper
In [utils.py](file:///C:/Users/coren/Projects/MIDI-eval%20Times/player-piano-app/app/utils.py#L958-L961), add `audio_path` and `global_offset_ms` parameters:
```python
def play_midi_blocking(path: str, port_name: str = None, stop_event=None, start_offset: float = 0, audio_path: str = None, global_offset_ms: float = 0):
    """Play MIDI file synchronously. Accepts optional threading.Event to allow interruption."""
    _play_internal(path, port_name, stop_event, start_offset, audio_path, global_offset_ms)
```

#### 2. Resolve Track URIs in Playlist Manager Worker Loop
In [manager.py](file:///C:/Users/coren/Projects/MIDI-eval%20Times/player-piano-app/app/manager.py#L125-L168), update the thread `worker` to extract the paths and settings dynamically:
```python
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
                            path = job["midi"]
                            audio_path = job["vocals"]
                            # Default to the job's custom offset if set, or fall back to 0
                            global_offset_ms = job.get("sync_offset", 0.0)
                        else:
                            path = self._resolve_path(fn)
                            
                        if not path or not os.path.exists(path): 
                            continue
                            
                        info = utils.get_midi_info(path)
                        self.current_file = fn
                        self.track_length = info.get('length')
                        self.start_time = time.time()
                        
                        # (Keep index offset calculation)
                        # ...

                        # Play with backing track parameters
                        utils.play_midi_blocking(
                            path, 
                            port_name, 
                            stop_event=self.stop_event, 
                            start_offset=current_offset,
                            audio_path=audio_path,
                            global_offset_ms=global_offset_ms
                        )
```

---

### Phase 4: Handle Speaker Routing

Depending on the global speaker selection, we route audio appropriately:

| Routing Option | Backend Speaker Audio | Client Phone Audio | Sync Mechanism |
| :--- | :--- | :--- | :--- |
| **Backend Speakers** (`backend_audio_enabled = true`) | Played via `_play_audio_thread` on backend device. | Muted locally. | Backend calculates delay/advance offsets (`global_offset_ms`) and sleeps/delays start. |
| **Phone Speakers** (`backend_audio_enabled = false`) | Muted on backend. | Played via Expo AV `soundRef` stream from `/midi-orchestrator/backing-audio/{job_id}`. | Phone polls `/queue/status`. When a `hybrid:` track changes, it preloads the stream and triggers playback synced to the queue's `elapsed` status. |

---

### Phase 5: Client-Side UI Enhancements

1. **Add Validation Toggle in MIDI Editor:**
   Add a switch/checkbox next to the metadata inputs in `MidiEditorScreen` labeled "Validated for Playlists". When toggled, make an API request to:
   ```javascript
   await api.post(`/midi-orchestrator/jobs/${jobId}/validate?validated=${value}`);
   ```
2. **Display Smart List Suggestions:**
   Update the smart playlist UI so that when filtering, matching orchestrated song values are suggested.
3. **Show Custom Badges in Playlists View:**
   Use a distinct icon (e.g. a small cassette/wave badge) for tracks prefixed with `hybrid:` to make it clear they include vocals.
