@echo off
setlocal
cd /d "%~dp0"

set "PORT=8765"
if not "%~1"=="" set "PORT=%~1"

echo Stopping LocateIt on port %PORT%...

set "FOUND=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "127.0.0.1:%PORT%" ^| findstr LISTENING') do (
  set "FOUND=1"
  echo   Killing PID %%a
  taskkill /PID %%a /F >nul 2>&1
)

if "%FOUND%"=="0" (
  echo No server listening on 127.0.0.1:%PORT%
) else (
  echo Done.
)

endlocal
