@echo off

setlocal

cd /d "%~dp0"

echo Checking for an existing LocateIt server...
call "%~dp0stop.bat"
echo.

set "PY=%~dp0.venv\Scripts\python.exe"



if not exist "%PY%" (

  echo Creating virtual environment...

  where py >nul 2>&1 && (

    py -3 -m venv .venv

  ) || (

    python -m venv .venv

  )

  if not exist "%PY%" (

    echo.

    echo ERROR: Could not create .venv — install Python 3.10+ and ensure "py" or "python" is on PATH.

    pause

    exit /b 1

  )

)



echo Updating dependencies...

"%PY%" -m pip install -q -r requirements.txt

if errorlevel 1 (

  echo.

  echo ERROR: pip install failed. Check your network connection and try again.

  pause

  exit /b 1

)



echo.

echo Starting LocateIt...
echo Keep this window open while geotagging. Do not close until Save finishes.
echo.

"%PY%" run.py %*

set "EXIT_CODE=%ERRORLEVEL%"



if %EXIT_CODE% neq 0 (

  echo.

  echo Server stopped with error code %EXIT_CODE%.

  echo If port 8765 is in use, close the other instance or run: python run.py --port 8766

  pause

)



exit /b %EXIT_CODE%

