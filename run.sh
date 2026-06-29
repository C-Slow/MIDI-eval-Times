#!/bin/bash
PROJECT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
export PYTHONPATH="$PROJECT_ROOT/player-piano-app"
export FLUIDSYNTH_BIN="$PROJECT_ROOT/fluidsynth/bin/fluidsynth.exe"

# If an argument is provided, map it to the corresponding action
ACTION=$1

start_backend() {
    echo "Starting Backend Server..."
    cd "$PROJECT_ROOT/player-piano-app"
    "$PROJECT_ROOT/player-piano-app/.venv/Scripts/python" -m app.main
}

start_frontend() {
    echo "Starting Mobile App..."
    cd "$PROJECT_ROOT/player-piano-native" && npm run start
}

start_mcp() {
    echo "Starting MCP Watcher..."
    "$PROJECT_ROOT/player-piano-app/.venv/Scripts/jcodemunch-mcp" watch "$PROJECT_ROOT"
}

open_shell() {
    echo "Activating virtualenv..."
    # Launch an interactive shell with the virtualenv activated
    bash --rcfile <(echo ". ~/.bashrc; . '$PROJECT_ROOT/player-piano-app/.venv/Scripts/activate'")
}

if [ "$ACTION" = "backend" ]; then
    start_backend
elif [ "$ACTION" = "frontend" ]; then
    start_frontend
elif [ "$ACTION" = "mcp" ]; then
    start_mcp
elif [ "$ACTION" = "shell" ]; then
    open_shell
else
    echo "=========================================="
    echo " MIDI-eval Times - Environment Launcher"
    echo "=========================================="
    echo " 1) Start Backend Server"
    echo " 2) Start Mobile App (Expo)"
    echo " 3) Start MCP Watcher"
    echo " 4) Open Terminal with Sourced Virtualenv"
    echo " 5) Exit"
    echo "=========================================="
    read -p "Enter option (1-5): " choice
    case $choice in
        1) start_backend ;;
        2) start_frontend ;;
        3) start_mcp ;;
        4) open_shell ;;
        *) exit 0 ;;
    esac
fi
