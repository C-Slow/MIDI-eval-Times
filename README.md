# MIDI-eval Times - AI Player Piano Ecosystem

A high-performance ecosystem for managing and performing MIDI files on a Yamaha Disklavier piano, featuring AI-powered vocal separation, piano transcription, and synchronized hybrid playback.

## ⚡ Quick Start (Automatic Environment Setup)

We have provided wrapper scripts in the project root to automatically handle virtual environments and configurations without needing manual `source` activation:

* **On Command Prompt or PowerShell:**
  ```cmd
  .\run.bat
  ```
  *(Or bypass the menu and run directly: `.\run.bat backend`, `.\run.bat frontend`, `.\run.bat mcp`, or `.\run.bat shell`)*

* **On Git Bash / Bash:**
  ```bash
  ./run.sh
  ```
  *(Or bypass the menu and run directly: `./run.sh backend`, `./run.sh frontend`, `./run.sh mcp`, or `./run.sh shell`)*

---

## 🚀 Features

### 🎹 MP3 Orchestrator
- **AI Separation:** Isolate vocals and instrumental tracks from any MP3 using Meta's Demucs.
- **AI Transcription:** Convert piano audio into high-quality MIDI using ByteDance's CRNN inference.
- **Hybrid Alignment:** Align professional library MIDIs to match MP3 vocals using high-resolution (50Hz) Audio-Anchored Dynamic Time Warping (DTW).
- **Acoustic Auto-Sync:** Use your phone's microphone to automatically calibrate Bluetooth speaker latency by "listening" to the piano.

### 📱 Mobile App (Expo/React Native)
- **Persistent Library:** Manage processed orchestrations with custom velocity tuning, pedal profiles, and comments.
- **Local Preview:** Synthesize and listen to arrangements directly on phone speakers via FluidSynth.
- **Advanced Control:** Precise numeric tempo, seeking, and alphabetical sorting for 500+ files.
- **Stability:** 100% reliable uploads via Base64 strategy and persistent server credentials.

### ⚙️ Backend (FastAPI/Python)
- **GPU Accelerated:** ML models optimized for NVIDIA CUDA (RTX 4050+).
- **MIDI Cleaning:** Specialized Rhythm vs. Melody velocity scaling and quiet pedal profiles (DKC-55).
- **Communication:** Low-latency BLE MIDI streaming to MD-BT01.

## 🛠 Project Structure

- `player-piano-app/` - FastAPI backend, AI processing engine, and ML models.
- `player-piano-native/` - Native mobile application (Expo/React Native).
- `storage/` - Persistent storage for MIDIs, separated audio, and job databases.
- `tools/` - Utility scripts for MIDI inspection and cleaning.

## 🚀 Quick Start

### Backend Setup
1. **Python 3.11 (Required):** Ensure Python 3.11 is installed. (Note: Newer versions like 3.14 are currently incompatible with specific ML dependencies like Torch < 2.1).
2. **Create Environment:**
   ```bash
   cd player-piano-app
   py -3.11 -m venv .venv
   .\.venv\Scripts\activate
   ```
3. **Install Dependencies:**
   ```bash
   pip install -r requirements.txt
   ```
4. **Download Transcription Checkpoint (Required for Windows):**
   The transcription library attempts to download its model checkpoint via the `wget` system command, which is not available by default on Windows. Run this Python command to pre-download it:
   ```bash
   python -c "import urllib.request, pathlib; url='https://zenodo.org/record/4034264/files/CRNN_note_F1%3D0.9677_pedal_F1%3D0.9186.pth?download=1'; p = pathlib.Path.home() / 'piano_transcription_inference_data'; p.mkdir(exist_ok=True); print('Downloading checkpoint...'); urllib.request.urlretrieve(url, p / 'note_F1=0.9677_pedal_F1=0.9186.pth'); print('Done!')"
   ```
5. **Install FluidSynth (Required for local audio rendering):**
   FluidSynth is used on the backend to render MIDI files to WAV audio for local mobile previews. 
   - Download the latest Windows release (e.g., `win10-x64` zip) from [FluidSynth Releases](https://github.com/FluidSynth/fluidsynth/releases).
   - Extract it (e.g., to `C:\fluidsynth` or local folder `C:\app\fluidsynth`).
   - Define the environment variable `FLUIDSYNTH_BIN` pointing to `fluidsynth.exe` (defaults to `C:\fluidsynth\bin\fluidsynth.exe` if not provided).

6. **Start the server:**
   ```bash
   # From the player-piano-app directory
   $env:PYTHONPATH="."
   $env:FLUIDSYNTH_BIN="C:\app\fluidsynth\bin\fluidsynth.exe" # Set custom path to fluidsynth.exe
   python -m app.main
   ```

7. **Windows Automatic Startup (Optional):**
   To have the backend server start automatically when you log in to Windows:
   - Press `Win + R`, type `shell:startup`, and press **Enter** to open the Windows Startup folder.
   - Create a new batch file named `start_midi_backend.bat` in that folder with the following content:
     ```cmd
     @echo off
     title MIDI-eval Times Backend
     cd /d "C:\app\player-piano-app"
     set PYTHONPATH=.
     set FLUIDSYNTH_BIN=C:\app\fluidsynth\bin\fluidsynth.exe
     "C:\app\player-piano-app\.venv\Scripts\python.exe" -u -m app.main
     pause
     ```
   - *(Optional) Run Minimized:* To launch the command window minimized to the taskbar, right-click `start_midi_backend.bat` in the Startup folder, choose **Create shortcut**, right-click the shortcut, select **Properties**, and change **Run** from *Normal window* to **Minimized**.

### Mobile Setup
1. **Install Dependencies:**
   ```bash
   cd player-piano-native
   npm install
   ```
2. **Start the app:**
   ```bash
   npx expo start
   ```

## ⚖️ Development
- Implementation details and project status are tracked in [GEMINI.md](./GEMINI.md).
- Follow the workflow in `GEMINI.md` for branching and atomic commits.
