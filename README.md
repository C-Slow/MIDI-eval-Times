# MIDI-eval Times - AI Player Piano Ecosystem

A high-performance ecosystem for managing and performing MIDI files on a Yamaha Disklavier piano, featuring AI-powered vocal separation, piano transcription, and synchronized hybrid playback.

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
4. **Start the server:**
   ```bash
   # From the player-piano-app directory
   $env:PYTHONPATH="."
   python -m app.main
   ```

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
