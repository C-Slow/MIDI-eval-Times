@echo off
set PROJECT_ROOT=%~dp0
set PYTHONPATH=%PROJECT_ROOT%player-piano-app
set FLUIDSYNTH_BIN=%PROJECT_ROOT%fluidsynth\bin\fluidsynth.exe

if "%1"=="backend" goto backend
if "%1"=="frontend" goto frontend
if "%1"=="mcp" goto mcp
if "%1"=="shell" goto shell

:menu
echo ==========================================
echo  MIDI-eval Times - Environment Launcher
echo ==========================================
echo  1) Start Backend Server
echo  2) Start Mobile App (Expo)
echo  3) Start MCP Watcher
echo  4) Open Terminal with Activated Virtualenv
echo  5) Exit
echo ==========================================
set /p choice="Enter option (1-5): "

if "%choice%"=="1" goto backend
if "%choice%"=="2" goto frontend
if "%choice%"=="3" goto mcp
if "%choice%"=="4" goto shell
if "%choice%"=="5" exit /b
goto menu

:backend
echo Starting Backend Server...
cd /d "%PROJECT_ROOT%player-piano-app"
"%PROJECT_ROOT%player-piano-app\.venv\Scripts\python.exe" -m app.main
pause
exit /b

:frontend
echo Starting Mobile App...
cd /d "%PROJECT_ROOT%player-piano-native"
npm run start
pause
exit /b

:mcp
echo Starting MCP Watcher...
"%PROJECT_ROOT%player-piano-app\.venv\Scripts\jcodemunch-mcp.exe" watch "%PROJECT_ROOT%."
pause
exit /b

:shell
echo Activating Virtualenv...
cd /d "%PROJECT_ROOT%player-piano-app"
cmd /k "%PROJECT_ROOT%player-piano-app\.venv\Scripts\activate.bat"
exit /b
