# MIDI-eval Times - Native Mobile App

This is the Expo-based native mobile application for managing and playing MIDI files on your Yamaha Disklavier. It provides high-performance local audio previews and over-the-air updates.

## 🚀 Getting Started

### 1. Start the Backend (On your PC)
The mobile app requires the Python backend to be running on your local network.
```bash
# From the project root
python -m app.main
```
*Note: Make sure your PC and phone are on the same Wi-Fi network.*

### 3. Direct USB Deployment (Physical Device)

1. **Connect your phone** via USB and ensure **USB Debugging** is enabled.
2. **Verify connection:**
   ```powershell
   # Ensure adb sees your device
   adb devices
   ```

#### A. Development Build (Fastest for coding)
Installs a version that stays connected to your computer for instant code updates.
```powershell
npx expo run:android --device
```

#### B. Full Standalone Build (Install and walk away)
Builds the "Release" version and installs it. This version is self-contained and does not require your computer to stay connected.
```powershell
npx expo run:android --variant release --device
```

*Note: If you have multiple devices or emulators, you will be prompted to select your phone.*

#### Troubleshooting Environment Variables
If the build fails because it can't find Java or the Android SDK, run these lines first:
```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:Path += ";$env:JAVA_HOME\bin"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path += ";$env:ANDROID_HOME\platform-tools"
```

## 🛠 Management & Version Control

### Push an Update (OTA)
If you've made changes to the UI or app logic and want to push them to your installed app without re-building:
```bash
cd player-piano-native
eas update --branch production --message "Describe your changes here"
```
The app on your phone will automatically download the update the next time it's opened.

### Create a New Build (APK/IPA)
If you need to generate a new installable file (e.g., after changing the app icon or name):

#### Option 1: Cloud Build (Easier, but has queues)
```bash
cd player-piano-native
npx eas build -p android --profile preview
```

#### Option 2: Local Windows Build (Fastest, no queues)
Since you have Android Studio installed, you can build the APK directly:

1. **Set Environment (PowerShell):**
   ```powershell
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   $env:Path += ";$env:JAVA_HOME\bin"
   $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
   ```

2. **Run Gradle Build:**
   ```powershell
   cd android
   ./gradlew assembleRelease
   ```

3. **Find your APK:**
   `android\app\build\outputs\apk\release\app-release.apk`

## 📱 App Features
- **Files:** Multi-select MIDI management, bulk cleaning, and renaming.
- **Playlists:** Comprehensive playlist control with repeat and shuffle.
- **Native Audio:** High-quality grand piano previews powered by FluidSynth on the backend.
- **Piano Connection:** Real-time status monitoring and Bluetooth device selection.
- **Dark Mode:** Sleek, theme-aware interface.

## ⚙️ Configuration
- **Server URL:** Enter your PC's IP address (e.g., `http://192.168.1.14:8000`).
- **Master Password:** Default is `piano`.

-- Note from me, how to srtart up:
PS C:\Users\coren\projects> cd .\player-piano-app\
PS C:\Users\coren\projects\player-piano-app> .\.venv\Scripts\activate
(.venv) PS C:\Users\coren\projects\player-piano-app> python -m app.main