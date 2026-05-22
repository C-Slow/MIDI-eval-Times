# Contributing

Thanks for helping! A few guidelines:

## 🛡️ Branch Protection & Workflow
- **Never Work in Main:** NEVER make direct changes or commits to the `main` branch.
- **Always Branch:** Always create a new branch for every task, bug fix, or feature (e.g., `feature/...` or `bugfix/...`).
- **Atomic Commits:** Commit after each functional change on the feature branch.
- **User Validation:** Before merging to `main`, notify the user and wait for them to explicitly test and confirm that the changes work as expected.
- **Main Merge:** Only merge into `main` after explicit user confirmation.

## 🛠️ General Rules
- **AI-Optimized Indexing:** This project uses `jcodemunch-mcp` for high-efficiency code exploration. Contributors should ensure the local index is up to date or the watcher is running.
  - Install: `.\player-piano-app\.venv\Scripts\pip install jcodemunch-mcp` (or from GitHub if PyPI is quarantined)
  - Watch: `.\player-piano-app\.venv\Scripts\jcodemunch-mcp watch .`
- **No Large Binaries:** Don't commit large binary files (audio, .cpr Cubase projects, virtualenvs). Use `.gitignore` to manage local large data.
- **Utility Scripts:** Keep small utility scripts under `tools/` or top-level `scripts/` so they can be tracked without large assets.
- **Dependencies:** Run linters/tests in a virtual environment; if you add new dependencies, update `player-piano-app/requirements.txt`.
- **UI Changes:** For UI changes, prefer lightweight vanilla JS and keep static assets inside `player-piano-app/app/static/`.

If unsure, open an issue describing the change first.