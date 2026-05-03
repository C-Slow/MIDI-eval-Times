# Contributing

Thanks for helping! A few guidelines:

- Don't commit large binary files (audio, .cpr Cubase projects, virtualenvs). Use `.gitignore` to manage local large data.
- Keep small utility scripts under `tools/` or top-level `scripts/` so they can be tracked without large assets.
- Run linters/tests in a virtual environment; if you add new dependencies, update `player-piano-app/requirements.txt`.
- For UI changes, prefer lightweight vanilla JS and keep static assets inside `player-piano-app/app/static/`.

If unsure, open an issue describing the change first.