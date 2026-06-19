@echo off

setlocal

cd /d "%~dp0"

echo Checking for an existing LocateIt server...
call "%~dp0stop.bat"
echo.

set "VENV=%~dp0.venv-lite"
set "PY=%VENV%\Scripts\python.exe"

if not exist "%PY%" (
  echo Creating Lite virtual environment...
  where py >nul 2>&1 && (py -3 -m venv "%VENV%") || (python -m venv "%VENV%")
  if not exist "%PY%" (
    echo ERROR: Could not create .venv-lite — install Python 3.10+.
    pause
    exit /b 1
  )
)

echo Updating Lite dependencies...
"%PY%" -m pip install -q -r requirements-lite.txt
if errorlevel 1 (
  echo ERROR: pip install failed.
  pause
  exit /b 1
)

echo.
echo Starting LocateIt Lite...
echo Drop a geotagged photo on the map to see where it was taken.
echo.

"%PY%" lite.py %*

set "EXIT_CODE=%ERRORLEVEL%"
if %EXIT_CODE% neq 0 pause
exit /b %EXIT_CODE%
