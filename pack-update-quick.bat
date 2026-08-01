@echo off
cd /d "%~dp0"
echo ZZZ-HP quick pack (no export/build, smaller zip)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack-update.ps1" -Quick %*
if errorlevel 1 (
  echo.
  echo Pack failed.
  pause
  exit /b 1
)
pause
