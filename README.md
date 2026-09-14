# MIDI-eval Times — AI Player Piano Ecosystem

A professional, high-performance ecosystem for managing, cleaning, editing, orchestrating, and performing MIDI files on a Yamaha Disklavier player piano. It features a studio-grade VST3 multi-track synthesis workstation, multi-stem MP3 backing track integration, direct PC audio server capabilities with sub-millisecond BLE synchronization, and dynamic metadata-driven playlists.

---

## Critical Hardware Safety & Cleaning Engine

> [!WARNING]
> **UNPROTECTED RAW MIDIs CAN DAMAGE PLAYER PIANO HARDWARE!**
> Overly dense files or maximum velocity note spikes can overload physical solenoid driver boards, causing driver board components (like solenoids or fuses) to burn out.

To protect your Disklavier, this ecosystem always processes raw files through a multi-stage **Cleaning & Normalization Engine** ([clean_midi.py](file:///C:/app/player-piano-app/tools/clean_midi.py)):

1. **Velocity Normalization:** Scales note velocities to safe, pre-calibrated physical ranges (default ceiling of 60/90) to protect solenoids and hammers.
2. **Density Reduction:** Automatically strips out less active tracks if note density exceeds physical safety limits.
3. **Pedal Clank Mitigation:** Applies continuous pedal curves and soft-release envelopes to prevent noisy down/up mechanical thunks.
4. **Playback Restraints:** The backend is locked to **never play RAW files directly**—raw files are stored strictly as reference templates.

---

## Key Features & Workflows

> [!NOTE]
> **The Core Experience:** While this project includes an advanced multi-track orchestrator and audio editor, the **standard MIDI files and playlists are the most stable, dependable, and frequently used features**. Downloading any clean MIDI, uploading it, and playing it within seconds is the rock-solid core of this system.

```
[ Uploaded / Clean MIDI ]
           │
           ▼
┌────────────────────────────────────────────────────────┐
│  Track Splitting & Dynamic Analysis                    │
│  • Routes piano parts to Disklavier (BLE)              │
│  • Multi-lingual articulation analysis (IT/FR/DE/EN)   │
│  • Pitch register & drum pitch analysis                │
└──────────────────────────────────┬─────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────┐
│  2-Pass / 5-Stage VST3 Preset Resolution Engine        │
│  • Pass 0: Manual User Override (Track Settings Modal) │
│  • Pass 1: Spitfire BBC Symphony Orchestra Presets     │
│  • Pass 2: Extended Libraries (BDT, Aperture, Kontakt, │
│            Splice Epic Choir, Cinematic Percussion)    │
│  • Fallback: FluidR3_GM / SGM-V2 SoundFonts (Safety)   │
└──────────────────────────────────┬─────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────┐
│  Keyswitch & UACC Injection Engine                     │
│  • Injects Spitfire Keyswitches (C-1=0 pitch mapping)  │
│  • Injects UACC CC32 controllers at t=0s               │
│  • Injects 50ms musical lead offset for sample attack  │
└──────────────────────────────────┬─────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────┐
│  Parallel Stem Rendering & Spatial Mixer               │
│  • Multi-threaded rendering across CPU cores           │
│  • Symphonic seating stereo pan (Violins L, Celli R)  │
│  • Multi-stem headroom scaling: 0.85 / sqrt(N)         │
│  • 24-bit / 48kHz PCM WAV resolution throughout        │
└──────────────────────────────────┬─────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────┐
│  Master VST3 Reverb Bus & Fast-Render Cache            │
│  • AIR Studios Reverb Essentials acoustic convolution  │
│  • Dual-cache: saves backing_dry.wav & backing_insts   │
│  • 2-second instant reverb re-rendering on preset swap │
└──────────────────────────────────┬─────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────┐
│  Playback & Sync Engine                                │
│  • Physical Disklavier (BLE) + PC Room Speakers (A2DP) │
│  • Dynamic RAM precaching & pre-roll audio warmup      │
│  • Real-time Speaker Sync Offset (ms)                  │
└────────────────────────────────────────────────────────┘
```

### 1. Studio-Grade MIDI Orchestrator (VST3 Virtual Instruments)
The MIDI Orchestrator transforms multi-track MIDI arrangements into full symphonic productions. The physical piano part is routed to the Disklavier, while backing instruments are synthesized via dedicated VST3 virtual instrument libraries and routed to your room speaker system.

* **No More SoundFonts:** Legacy SoundFonts (`.sf2` via FluidSynth) have been replaced with dedicated 64-bit VST3 virtual instrument plugins hosted directly via Spotify's `pedalboard` engine. SoundFonts now serve solely as a zero-failure emergency fallback.
* **24-bit / 48kHz PCM Master Pipeline:** All internal stem synthesis, MP3 vocal alignment, and audio mixing run natively in 48kHz 24-bit float resolution (`PCM_24` WAV).
* **Curated Sound Libraries & VST Presets (`storage/vst_presets/`):**
  * **Spitfire Audio — BBC Symphony Orchestra (VST3):**
    * *Strings:* First Violins, Second Violins, Violas, Celli, Double Basses.
    * *Woodwinds:* Piccolo, Flutes (solo & a3), Oboes (solo & a3), Clarinets (solo & a3), Bassoons (solo & a3).
    * *Brass:* French Horns (solo & a4), Trumpets (solo & a3), Tenor Trombones (solo & a3), Bass Trombones a2, Tuba.
    * *Percussion (Tuned & Untuned):* Timpani, Harp, Celeste, Glockenspiel, Marimba, Xylophone, Vibraphone, Tubular Bells, Crotales, and Untuned Percussion Kits (Bass Drum, Snare, Piatti, Cymbals, Tam-tam, Anvil, Tambourine, Tenor Drum, Toys, Triangle).
  * **Spitfire Audio — British Drama Toolkit (BDT):**
    * Saxophones (Alto, Bass, Ensemble), Recorder Ensemble, Cor Anglais, Flugelhorn, and expressive Brass Combis.
  * **Spitfire Audio — Aperture The Stack:**
    * Cinematic overdriven electric guitars and heavy analog synth pads/leads.
  * **Native Instruments — Kontakt 8:**
    * Acoustic solo guitars, banjo, mandolin, plucky folk guitars, plucked folk ensembles, and solo cello.
  * **Splice INSTRUMENT:**
    * *Epic Choir:* Soprano/Alto and Tenor/Bass sections in long ahhs, episodic combos, and short staccato syllables.
    * *Cinematic Percussion:* Earthquake hits, sub hits, metal hits, swells, tams, and gongs.
  * **AIR Studios Reverb Essentials (Master VST3 Bus):**
    * High-end studio impulse response & acoustic convolution: *Intimate Close, Lush Hall, Solo Violin, Solo Viola, Solo Cello, Solo Bass, and Dry (No Reverb)*.
* **Intelligent 2-Pass / 5-Stage Preset Resolver:**
  * **Pass 0:** Exact manual user override selected via the Track Settings modal.
  * **Pass 1:** BBC SO orchestral mapping, tuned percussion, and untuned percussion techniques.
  * **Pass 2:** Extended sound libraries (Choir, BDT, Aperture, Kontakt).
  * Automatically analyzes GM program numbers, track names, international instrument terms across English, Italian (*grancassa, tamburo, rullante, piatti, violoncelli, corno*), German (*grosse trommel, becken, amboss*), and French (*caisse claire, enclume*), and pitch registers.
* **Automated Keyswitch & UACC (CC32) Injection:** Dynamically detects playing techniques (*staccato, pizzicato, col legno, tremolo, marcato, con sordino, flautando, rips, falls*) and automatically injects exact Spitfire keyswitches (calibrated to the C-1=0 pitch standard) and UACC CC32 controller events at `t=0s`, paired with an automatic **50ms lead offset** to allow sample engines to switch articulations before musical notes sound.
* **Pitch-Aware Strings & Smart Drum Keyswitch Resolvers:** Automatically analyzes the note pitch distribution of generic string tracks to distribute them across Violins, Violas, Celli, or Basses, and maps General MIDI drum notes to the untuned percussion keyswitch matrix.
* **Symphonic Seating & Multi-Stem Headroom Scaling:** Instruments are spatialized across the stereo field according to realistic orchestral seating laws (Violins Left, Celli/Basses Right, Woodwinds Center, Brass/Percussion Rear). Headroom is scaled mathematically (`0.85 / sqrt(N)`) to prevent digital clipping when mixing dense orchestral arrangements.
* **Master AIR Studios Reverb & Fast 2-Second Re-Rendering:** Backing mixes are treated with AIR Studios Reverb Essentials convolution acoustics. The dry mix is saved as `backing_dry.wav` alongside `backing_insts.wav`, enabling instant (~2-second) reverb preset adjustments without re-rendering individual instrument stems.
* **Isolated Multi-Process Worker & Live Progress:** Synthesis tasks run in an isolated worker process (`multiprocessing`), protecting FastAPI from native VST crashes. Real-time progress (0% to 100%) and live logging are streamed to the UI with a permanent **"Log"** button on every file card and an interactive worker log viewer.

---

### 2. Library & Workspace Overview
A clean, "Files-style" workspace designed for easy navigation and comprehensive library management:
* **Bulk Actions:** Supports bulk file uploads, bulk deletions, and bulk additions to playlists directly from the file list screen.
* **Instant Playback Control:** Click a file once to play it locally through device speakers, or long-press to play it directly on the physical Disklavier.
* **Normalized Search:** Find files instantly with multi-token, punctuation-agnostic search logic.
* **Track Information & Editing:** Access detailed track information views to inspect note counts, GM programs, and edit metadata.

<p align="center">
  <img src="./screenshots/file_list_screen.png" width="45%" />
  <img src="./screenshots/file_details.png" width="45%" />
</p>

---

### 3. Hybrid MIDI Editor & MP3 Backing Track Alignment
For complex MIDI arrangements or pop/vocal backing tracks, take full manual control:
* **Custom Track Routing:** Route individual MIDI tracks selectively. Send the piano parts to the physical Disklavier, and route backing instruments or vocals to the speaker system.
  
  <p align="center">
    <img src="./screenshots/midi_editor_file_list.png" width="45%" />
    <img src="./screenshots/midi_editor_file_settings.png" width="45%" />
  </p>
  
  <p align="center">
    <img src="./screenshots/midi_editor_workspace_track_routing.png" width="90%" />
  </p>
  
* **Waveform-Level Breaklines:** Perfect the synchronization between backing audio and the piano. Add **Breaklines** anywhere on the audio waveform to stretch/shift the track (adding/removing milliseconds) to align vocals or instrument beats to the millisecond.
  
  <p align="center">
    <img src="./screenshots/midi_editor_workspace_mp3_backing.png" width="90%" />
  </p>

* **Smart Vocal Track Swapping:** Align your MIDI using a clean vocal-only stem, then swap the audio track for a full instrument/drum/bass mix while preserving all breakline alignments.
* **Instant Mobile Speaker Preview:** Toggle the phone speaker preview in the control bar to audition synthesized backing tracks locally before or during physical Disklavier playback.
* **Break Glass Panic Stop:** Dedicated emergency button permanently accessible on the piano interface header to immediately send all-notes-off commands to the physical Disklavier.

---

### 4. Smart & Dynamic Playlists
Organize your collection with a metadata-driven playlist builder featuring AND-logic filtering and a suggestive query builder:
* **Manual & Dynamic Building:** Playlists can be manually curated or generated dynamically using metadata conditions (genres, tags, ratings, mood, tempo). Standard clean MIDIs matching dynamic rules populate automatically upon pull-to-refresh.
* **Visual Metadata Tags:** Playlists automatically add tag labels to files on the main Files Screen, helping identify associated collections at a glance.
* **Hybrid Track Validation ("V" Tag):** Once an orchestrated song or hybrid (MIDI + MP3) track is verified, toggle the **Validated** boolean. Validated songs display a green **V** badge and automatically populate into dynamic playlists matching their metadata.
* **Direct Add from Orchestrator:** Add orchestrated songs directly to existing playlists via the "List" button on the MIDI Orchestrator long-press action bar without returning to the library.
* **Sub-Millisecond Speaker Sync:** Configure global or per-track speaker sync offsets (in milliseconds). The backend employs dynamic audio pre-roll warmup buffers and RAM audio precaching to eliminate Bluetooth speaker standby lag and keep audio in sync with piano solenoids.

<p align="center">
  <img src="./screenshots/smart_playlists.png" width="45%" />
  <img src="./screenshots/smart_playlist_builder_scrolling.png" width="45%" />
</p>

---

### 5. Direct Server-PC Audio System
Playing backing tracks through a mobile phone connected to Bluetooth speakers is prone to packet loss, latency drift, and battery drain.
* **Zero-Drift Local Output:** Route backing audio directly through the server PC's hardware outputs to a static room speaker system to keep audio in perfect sync with the BLE-connected piano.
* **Win32 A2DP Power Management:** The backend auto-connects to the room speaker system when playback starts and auto-disconnects after 5 minutes of idle time to conserve power.
* **Dynamic Header Volume Slider:** Real-time master volume control embedded directly in the mobile and web navigation headers.

---

### 6. App Settings & Configuration
Manage system preferences, connections, security, and recovery actions:
* **Visual Theme:** Toggle dark mode for comfortable navigation in low-light environments.
* **Connections:** Configure communication parameters and low-latency Bluetooth MIDI settings.
* **Security & Keys:** Set your master server password (default is `piano`) and your Gemini API key.
* **Backups:** Perform manual database and configuration backups (in addition to the system's **daily automatic backups**).
* **Bluetooth Target Hard Reset:** Safety reset switch designed for rare situations where a crash or disconnect leaves the piano's Bluetooth connection locked.

<p align="center">
  <img src="./screenshots/settings_top.png" width="45%" />
  <img src="./screenshots/settings_bottom.png" width="45%" />
</p>

---

### 7. Legacies & Work-in-Progress (Disclaimer)
* **MP3 Orchestrator (Automatic Transcription/Sync):** Originally designed to automatically transcribe MP3 audio into piano MIDIs and perform wave-anchored Dynamic Time Warping (DTW). Due to transcription limitations, this automated process can introduce timing artifacts. **This feature is semi-legacy;** the MP3 Orchestrator is now primarily recommended as a utility for stripping vocal stems to load into the manual MIDI Editor.
* **Breakline Audio Distortion & Gaps:** Extreme breakline stretching values can introduce audio artifacts; closer length alignment between original MP3 and MIDI produces the cleanest results.
* **Mobile Screen Space:** Due to dense waveform displays and multi-lane visualizers, the web app version (`player-piano-native` compiled for web) is recommended when performing detailed editing.
* **Gestures:** The app makes extensive use of **long-press gestures** to delete items, trigger settings, and access contextual menus.
* **AI Vocal Synthesis (Male/Female Tracks):** Experimental RVC-based vocal synthesis options remain in the workspace for testing, though they are not considered production-grade.

---

## Best Practices & Sourcing

* **High-Quality MIDIs:** Source multi-track MIDI arrangements from reputable community sites (such as MuseScore) with cleanly separated instrument tracks.
* **Gemini AI Integration:** Configure your Gemini API key in Settings. Gemini automatically parses newly uploaded titles, assigns genres/mood tags, and calculates optimal velocity/pedal cleanup parameters to drive your smart playlists.
* **Hardware Calibration:** Every Disklavier has a slightly different solenoid and pedal response. If default presets in [clean_midi.py](file:///C:/app/player-piano-app/tools/clean_midi.py) are too loud or soft, adjust `PEDAL_PRESETS` and velocity ceilings directly.

---

## Project Structure

* `player-piano-app/` — FastAPI backend, VST3 Pedalboard synthesis engine, AI processing, and REST APIs.
* `player-piano-native/` — Cross-platform client (Expo/React Native) for mobile devices and web browsers.
* `storage/` — Persistent storage for raw MIDIs, processed outputs, separated audio stems, job databases, and VST preset files (`storage/vst_presets/`).
* `tools/` — Utility scripts for MIDI inspection, re-cleaning, and model downloading.

---

## Setup & Installation

### 1. Backend Setup
1. **Python 3.11 (Required):** Ensure Python 3.11 is installed (newer versions like 3.12+ break select PyTorch and Pedalboard dependencies).
2. **Create Environment:**
   ```powershell
   cd player-piano-app
   py -3.11 -m venv .venv
   .\.venv\Scripts\activate
   ```
3. **Install Dependencies:**
   ```powershell
   pip install -r requirements.txt
   ```
4. **Download Transcription Checkpoint (Required for MP3 stem separation):**
   ```powershell
   python -c "import urllib.request, pathlib; url='https://zenodo.org/record/4034264/files/CRNN_note_F1%3D0.9677_pedal_F1%3D0.9186.pth?download=1'; p = pathlib.Path.home() / 'piano_transcription_inference_data'; p.mkdir(exist_ok=True); print('Downloading checkpoint...'); urllib.request.urlretrieve(url, p / 'note_F1=0.9677_pedal_F1=0.9186.pth'); print('Done!')"
   ```
5. **Install FFmpeg (Required for audio separation & voice conversion):**
   * Install via winget: `winget install Gnu.FFmpeg` (or download from [Gyan.dev](https://www.gyan.dev/ffmpeg/builds/)).
   * Ensure `ffmpeg.exe` is added to your system's `PATH`.
6. **Virtual Instruments & VST Presets (Required for Orchestrator):**
   * Install 64-bit VST3 plugins (e.g. Spitfire Audio BBC Symphony Orchestra, British Drama Toolkit, Aperture The Stack, Kontakt 8, Splice INSTRUMENT, AIR Studios Reverb Essentials) to your system VST3 directory (typically `C:\Program Files\Common Files\VST3`).
   * Ensure calibrated `.vstpreset` files reside in `C:\app\storage\vst_presets\`.
7. **Install FluidSynth (Emergency Safety Fallback):**
   * Download the Windows release from [FluidSynth Releases](https://github.com/FluidSynth/fluidsynth/releases) to `C:\app\fluidsynth`.
   * Set `FLUIDSYNTH_BIN` to `C:\app\fluidsynth\bin\fluidsynth.exe`.
8. **Start the Server:**
   ```powershell
   $env:PYTHONPATH="."
   $env:FLUIDSYNTH_BIN="C:\app\fluidsynth\bin\fluidsynth.exe"
   python -m app.main
   ```

### 2. Web App Access (Easiest Method)
Before configuring the mobile app, you can access the web-compiled workstation served directly by FastAPI. It provides the most spacious environment for editing:

1. **Default Password:** `piano`.
2. **Access URL:** Open your web browser on any device connected to the same local network:
   ```
   http://<your-server-ip>:8000/
   ```
   *(Find `<your-server-ip>` by running `ipconfig` on your server PC. Setting a static DHCP reservation on your home router is recommended).*
3. **Media Server Integration:** Embed this web client directly into other network dashboards, such as adding a custom sidebar item inside Jellyfin (refer to the [Jellyfin Integration Guide](file:///C:/app/JELLYFIN.md)).

### 3. Mobile Setup (Local Dev & Production Builds)
If you wish to run the app on an Android device:

1. **Install Node.js & Dependencies:**
   ```bash
   cd player-piano-native
   npm install
   ```
2. **Start the Expo Development Server:**
   ```bash
   npx expo start
   ```
3. **Production Standalone Android Release (APK over USB):**
   To compile a native standalone release APK and deploy directly to a connected Android phone:
   * Prerequisites: Android Studio, Android SDK (Platform & Build tools), Java JDK 17 (`JAVA_HOME` configured), phone with USB Debugging enabled.
   * Run from `player-piano-native`:
     ```bash
     npx expo run:android --variant release
     ```

### 4. Windows Automatic Startup (Optional)
To automatically launch the backend server on Windows login:
1. Press `Win + R`, type `shell:startup`, and press **Enter**.
2. Create a batch file named `start_midi_backend.bat` in that folder:
   ```cmd
   @echo off
   title MIDI-eval Times Backend
   cd /d "C:\app\player-piano-app"
   set PYTHONPATH=.
   set FLUIDSYNTH_BIN=C:\app\fluidsynth\bin\fluidsynth.exe
   "C:\app\player-piano-app\.venv\Scripts\python.exe" -u -m app.main
   pause
   ```

---

## Development Guidelines

* **Never Work in Main:** Do not make direct commits to `main`. Always create a descriptive feature or bugfix branch (`feature/...` or `bugfix/...`) for any tasks.
* **Sync MCP Indexing:** Ensure the `jcodemunch-mcp` watcher is running in the background during development to keep the symbol index up-to-date:
  ```powershell
  .\player-piano-app\.venv\Scripts\jcodemunch-mcp watch .
  ```
* **Offline Release Builds:** Always build mobile releases using offline release configurations (`--variant release`).
* **Sync Static Web Builds:** When making changes to the mobile/web frontend in `player-piano-native`, export the web build (`npx expo export --platform web`) and synchronize outputs to `player-piano-app/app/static/`.
