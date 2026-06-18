@echo off

setlocal

cd /d "%~dp0"

echo Checking for an existing LocateIt server...
call "%~dp0stop.bat"
echo.

set "PY=%~dp0.venv\Scripts\python.exe"



if not exist "%PY%" (

  echo Creating virtual environment...

  where py >nul 2>&1 && (py -3 -m venv .venv) || (python -m venv .venv)

  if not exist "%PY%" (

    echo ERROR: Could not create .venv — install Python 3.10+.

    pause

    exit /b 1

  )

)



echo Updating dependencies...

"%PY%" -m pip install -q -r requirements.txt

if errorlevel 1 (

  echo ERROR: pip install failed.

  pause

  exit /b 1

)



echo.

echo Starting LocateIt (desktop mode)...

echo Native Open File dialog — pick any photo to load its folder.

echo.



"%PY%" desktop.py %*

set "EXIT_CODE=%ERRORLEVEL%"

if %EXIT_CODE% neq 0 pause

exit /b %EXIT_CODE%

