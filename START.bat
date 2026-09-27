@echo off
setlocal
title Royal Loyalty - Server
cd /d "%~dp0"

echo.
echo   ROYAL LOYALTY  -  Welcome Friends ^& Al Madina Hypermarkets
echo   ---------------------------------------------------------
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [!] Node.js is not installed on this computer.
  echo       Install Node.js 22 LTS or newer from https://nodejs.org
  echo       and then double-click START.bat again.
  echo.
  pause
  exit /b 1
)

node -e "require('node:sqlite')" >nul 2>nul
if errorlevel 1 (
  echo   [!] This Node.js version is too old.
  echo       Install Node.js 22.13 LTS or newer from https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\express" (
  echo   Installing required packages - first run only, needs internet...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo   [!] Package installation failed. Check the internet connection and try again.
    pause
    exit /b 1
  )
)

rem The server opens the browser itself as soon as it is ready.
set RL_OPEN_BROWSER=1
node server\server.js

echo.
echo   The Royal Loyalty server has stopped.
pause
