@echo off
title The Last Meridian
cd /d "%~dp0"
set "PATH=%PATH%;C:\Program Files\nodejs"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js isn't installed. Get the LTS version from https://nodejs.org and try again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo First-time setup, this takes a few seconds...
  call npm install --omit=dev --no-fund --no-audit
)
rem Opens the browser after a short wait, so the server has time to start.
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3210"
node server.js
pause
