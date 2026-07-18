# MIDI-eval Times - Status Summary

This project is a native mobile ecosystem designed to manage and play MIDI files on a Yamaha Disklavier piano. It consists of a FastAPI backend and a high-performance Expo (React Native) mobile application.

## 🚀 Current Architecture
- **Backend:** FastAPI (Python 3.11)
  - **Transcription:** Dual-engine support (Bytedance Piano-Focused + Spotify Basic Pitch Polyphonic).
  - **Separation:** High-precision Demucs 6-Stem Pro model (isolated Piano, Guitar, Strings).
  - **AI Audio Engine:** Demucs + Piano Transcription Inference + Audio-Anchored DTW.
- **Frontend:** Native Expo App (`player-piano-native/`)
  - **Workstation:** 4-Stage Tabbed Orchestrator (Create, Perform, Master, Library).
  - **Engine:** React Native + Zustand + Expo AV + Expo Keep Awake.

## ✨ Key Features
- **Workstation UI**: Professional stage-based workflow for MP3 separation, transcription, and sync.
- **Hybrid Alignment**: Warp high-quality library MIDIs to match MP3 vocals with sub-millisecond precision.
- **Dual-Engine Transcription**: Adjustable sensitivity and volume gain for specialized vs general instrument capture.
- **Acoustic Auto-Sync**: Automated loopback calibration via phone microphone.
- **Background Protection**: Prevent audio suspension during screen sleep using CPU wake-locks.

## ✅ Recent Accomplishments
- **Dynamic Playlist Builder AND Filter queries**: Upgraded the dynamic/smart playlist system to support multiple filter conditions combined with AND logic (inner join), featuring a scrollable modal builder UI with unique field value suggestions.
- **Dynamic Playlist Ratings**: Expanded rating filters to support comma-separated values (e.g. `4,5` for exactly 4 or 5 stars) and unrated songs (`0`), preserving `>=` logic for single ratings.
- **Compact Playlist Actions Layout**: Restructured the Playlists tab to place compact, circular inline Play (Piano), Shuffle, and Delete buttons directly in each playlist's header row, removing the redundant controls block.
- **Global Repeat Button**: Moved the repeat playback toggle out of individual playlists to a single global header button (sharing the row dynamically with "Refresh Smart").
- **Standalone Mobile Deployment**: Established and verified standard production release APK build pipelines (`npx expo run:android --variant release`) deploying directly to physical connected devices over USB.
- **Search Normalization**: Updated the library and Orchestrator search to treat dashes and underscores as spaces, fixing matches for titles like 'back to black' vs 'back-to-black'.
- **Pedal Clank Mitigation (Temporary)**: Temporarily mapped 'Medium' and 'Full' pedal presets to 'Light' intensity to address physical hardware noise. Re-cleaned 570+ MIDI files across the main library and Orchestrator to apply these safe settings while preserving original metadata for future restoration.
- **6-Stem Isolation**: Upgraded to `htdemucs_6s` for surgical separation of piano from strings/guitars.
- **Workstation UX**: Implemented top-tab navigation and "Files-style" library with search and bulk delete.
- **Transcription Tuning**: Added volume gain for Bytedance and threshold sensitivity for Spotify engines.
- **Hybrid Merge**: Ability to combine the perfect MIDI pass with the perfect audio pass into a master track.
- **Filename Retention**: Fixed bug to preserve original filenames instead of UUIDs.

## 🏃 Next Steps
1. **Hybrid Metadata & Tags**: Update the Perform tab to display separate tags for Vocal and MIDI source configurations in Hybrid jobs.
2. **Library Action Bar**: Move 'Delete' and 'Cancel' buttons to the left of the selection count in the Orchestrator library to avoid Voice Control overlap.
3. **Hybrid "Freezing"**: Implement the permanent merge/export to main library (fixing the Android modal workflow). Figure out how we can integrate these hybrid files types with normal midi files in playlists. What kind of behavior do we expect? If we auto play a hybrid file the sync will likely be off, so just playing them casually with normal midi files will not work as is.
4. **Library Search/Sort**: Refine the Orchestrator library sorting (Date, Name, Engine).
5. **AI-Powered Organization**: Integrate Gemini on the backend to auto-assign metadata.


## 🛠 Development Workflow

### 🛡️ Branch Protection
- **Never Work in Main:** NEVER make direct changes or commits to the `main` branch.
- **Always Branch:** Always create a new branch for every task, bug fix, or feature (e.g., `feature/...` or `bugfix/...`).
- **Atomic Commits:** Commit after each functional change on the feature branch.
- **User Validation:** Before merging to `main`, notify the user and wait for them to explicitly test and confirm that the changes work as expected.
- **Main Merge:** Only merge into `main` after explicit user confirmation.

### ⚙️ Standards
- **AI-Optimized Indexing:** ALWAYS ensure the `jcodemunch-mcp` watcher is running while performing development tasks to maintain a high-efficiency symbol index. 
  - Command: `.\player-piano-app\.venv\Scripts\jcodemunch-mcp watch .`
- **No Large Binaries:** Don't commit large binary files (audio, .cpr projects, virtualenvs). Use `.gitignore`.
- **Utility Scripts:** Keep small utility scripts under `tools/` or top-level `scripts/` so they can be tracked without large assets.
- **Dependencies:** Run linters/tests in a virtual environment; if you add new dependencies, update `player-piano-app/requirements.txt`.
- **UI Changes:** For UI changes, prefer lightweight vanilla JS and keep static assets inside `player-piano-app/app/static/`.
- **Cross-Platform Compatibility:** When making modifications to the React Native Expo project (`player-piano-native`), always ensure changes are fully compatible with both the native mobile app and the compiled web application. Native-only modules (e.g., `expo-file-system`, `expo-notifications`) must be guarded with platform checks (e.g., `Platform.OS === 'web'`) and provided with standard web API fallbacks when running in a browser.
- **Stop and Ask:** Always stop and ask questions to clarify ambiguities or ask for examples instead of guessing.
- **Planning First:** Before implementing *any* changes, you MUST talk to the user, explain what you plan to do and why first, and wait for explicit confirmation of the plan. Do not edit/write codebase files or run command-line actions that alter repository state before aligning on the plan.
- **One Task at a Time:** Focus on a single item from the implementation plan.


## ⚙️ How to Run
1. **Backend:** `python -m app.main` from the project root.
2. **Mobile (Dev):** `npx expo run:android` (local build) or `npx expo start`.
3. **Mobile (Prod):** Install the standalone APK generated via EAS Local Build.
