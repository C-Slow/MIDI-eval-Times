# Player Piano Jellyfin Integration Guide

This guide explains how to expose the web-compiled Expo control panel (`player-piano-native`) inside Jellyfin once you set up a Jellyfin media server on your local network.

---

## 🛠️ Step-by-Step Jellyfin Configuration

### Step 1: Locate your Jellyfin Web Configuration
Jellyfin allows adding custom links to the sidebar via its web client configuration. Locate the `config.json` file inside your Jellyfin installation's web directory:

- **Windows:** `C:\Program Files\Jellyfin\Server\jellyfin-web\config.json` (or similar custom installation path)
- **Linux / Docker:** The configuration is typically found in the assets or config volume mapped to the web client.

### Step 2: Add Custom Menu Link
Open `config.json` in a text editor and look for the `"menuLinks"` array (or add it if it does not exist). Insert the custom link targeting the FastAPI server:

```json
{
  "menuLinks": [
    {
      "name": "Player Piano",
      "url": "http://<your-server-ip>:8000/",
      "icon": "music_note"
    }
  ]
}
```

> [!NOTE]
> Replace `<your-server-ip>` with the local IP address of your machine running the FastAPI backend (e.g., `192.168.1.15`).

### Step 3: Restart Jellyfin & Verify
1. Restart your Jellyfin server.
2. Open the Jellyfin web app or native application on any client (PC, mobile device, or Smart TV).
3. Look for the **Player Piano** icon (represented by a music note) in the left sidebar menu.
4. Click/tap it to load the compiled Expo workstation directly inside the Jellyfin UI, giving you full control over the piano playback.

---

## 📺 LG TV (webOS) Integration & Alternatives

For LG Smart TV (webOS) users, exposing the workstation inside the native LG Jellyfin app may not always render correctly due to webOS webview/sandbox constraints. You have two main options:

1. **Standalone TV Browser Bookmark (Simpler & Recommended):**
   * Open the built-in web browser on your LG TV.
   * Navigate directly to your local server URL (e.g., `http://192.168.1.15:8000/`).
   * Add the page as a TV browser bookmark for instant, full-screen remote control.

2. **Custom LG Jellyfin App Embed (Advanced):**
   * If you prefer to launch the control panel directly within the native LG TV Jellyfin client, you can modify, compile, and sideload a custom webOS client.
   * Follow the guidelines and patch steps in the fork repository at [jellyfin-webos](https://github.com/C-Slow/jellyfin-webos) to embed your local workstation directly inside your custom LG TV build.

