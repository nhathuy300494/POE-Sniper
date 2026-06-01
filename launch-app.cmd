@echo off
setlocal
cd /d "%~dp0"
title POE2 Sniper Launcher
npm run launch
if errorlevel 1 (
  echo.
  echo Launcher failed. Press any key to close.
  pause >nul
)
