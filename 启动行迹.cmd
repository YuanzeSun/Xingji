@echo off
cd /d "%~dp0"
node scripts/build.mjs
if errorlevel 1 (
  echo Build failed. See README.md for setup instructions.
  pause
  exit /b 1
)
echo Open http://localhost:4173/ in your browser.
node scripts/serve.mjs --dist
pause
