@echo off
cd /d "%~dp0"
echo ZZZ-HP full pack (export + build + zip). Use pack-update-quick.bat for quick pack.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack-update.ps1" %*
if errorlevel 1 (
  echo.
  echo Pack failed.
  pause
  exit /b 1
)
pause
