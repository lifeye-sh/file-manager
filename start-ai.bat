@echo off
setlocal
chcp 65001 >nul
title File Manager + Infinite-Canvas

set "REPO=%~dp0"
set "COMFYUI_URL=http://192.168.3.34:8870"
set "STACK_SCRIPT=%REPO%integrations\infinite-canvas\start-debug-stack.ps1"

echo Starting File Manager + Infinite-Canvas...
echo Project: %REPO%
echo ComfyUI: %COMFYUI_URL%
echo.

if not exist "%STACK_SCRIPT%" (
  echo [ERROR] Missing startup script: %STACK_SCRIPT%
  pause
  exit /b 1
)

rem The PowerShell launcher creates a cryptographically random gateway token,
rem keeps it process-local, supplies all runtime directories, and performs the
rem authenticated health checks before returning.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%STACK_SCRIPT%" -ComfyUiUrl "%COMFYUI_URL%"
if errorlevel 1 (
  echo.
  echo [ERROR] The debug stack did not become healthy. Check:
  echo   %LOCALAPPDATA%\FileManager\Infinite-Canvas\*.log
  pause
  exit /b 1
)

echo.
echo Stack is healthy: http://127.0.0.1:3000
echo Stop it with integrations\infinite-canvas\stop-debug-stack.ps1
start "" "http://127.0.0.1:3000"
pause
endlocal
