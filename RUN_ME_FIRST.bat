@echo off
setlocal
cd /d "%~dp0"
if not exist package.json (
  echo ERROR: package.json was not found. Open the BULLS_ECOOPS_MAPLIBRE project folder.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing project dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
call npm run dev
pause
