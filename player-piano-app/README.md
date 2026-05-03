# Yamahalalala - Backend Server

FastAPI-based server for MIDI processing, AI transcription, and Disklavier communication.

## 🚀 Setup

1. **Python 3.11 (Required)**: Ensure you have Python 3.11 installed. Newer versions (e.g. 3.14) are not compatible with dependencies like Torch < 2.1.
2. **Create Environment**:
   ```bash
   py -3.11 -m venv .venv
   .\.venv\Scripts\activate
   ```
3. **Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```
4. **FluidSynth**: Install FluidSynth and note the executable path.

## 🛠 Running

```bash
# From this directory (player-piano-app)
$env:PYTHONPATH="."
python -m app.main
```

## 📂 Data Storage

The server uses the `storage/` directory in the project root for:
- Uploaded and processed MIDI files.
- Separated audio stems from the MP3 Orchestrator.
- Metadata and playlist databases.
- Automated daily backups.
