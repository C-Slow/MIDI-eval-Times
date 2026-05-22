# MIDI-eval Times - Home Assistant Integration

This component allows you to control your MIDI-eval Times piano system directly from **Home Assistant**. It surfaces the piano as a standard `media_player` entity, enabling play/pause, track skipping, and playlist selection from your unified home dashboard.

## ✨ Features
- **Media Controls:** Standard Play, Stop, and Next Track support.
- **Playlist Integration:** Your MIDI playlists appear as "Sources" in Home Assistant.
- **Real-time Status:** View the current playing filename and progress bar.
- **Automations:** Trigger piano flourishes or background music based on home events (e.g., "Welcome Home" scene).

## 🚀 Installation
1. Locate your Home Assistant `config` directory.
2. If it doesn't exist, create a folder named `custom_components`.
3. Copy the `midieval_times` folder from this directory into `custom_components/`.
4. **Restart Home Assistant.**

## ⚙️ Configuration
1. In Home Assistant, go to **Settings > Devices & Services**.
2. Click **Add Integration** and search for **"MIDI-eval Times Piano"**.
3. Enter the URL of your FastAPI backend (e.g., `http://192.168.1.50:8000`).
4. Your piano will now appear as a new Media Player entity!

## 🛠 Technical Notes
This integration communicates with the FastAPI backend using local polling. It requires the `requests` library (handled automatically by Home Assistant).
