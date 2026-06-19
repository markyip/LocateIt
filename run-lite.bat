@echo off

setlocal enabledelayedexpansion

cd /d "%~dp0"

set "LITE_PROFILE=stdlib-http-1"
set "VENV=%~dp0.venv-lite"
set "PY=%VENV%\Scripts\python.exe"
set "PROFILE_FILE=%VENV%\.lite-profile"

echo Checking for an existing LocateIt server...
call "%~dp0stop.bat"
echo.

if exist "%VENV%" (
  if not exist "%PROFILE_FILE%" goto recreate_venv
  set /p CURRENT_PROFILE=<"%PROFILE_FILE%"
  if not "!CURRENT_PROFILE!"=="%LITE_PROFILE%" goto recreate_venv
  goto venv_ok
)
goto create_venv

:recreate_venv
echo Lite dependency profile changed — recreating .venv-lite...
rmdir /s /q "%VENV%" 2>nul

:create_venv
if not exist "%PY%" (
  echo Creating Lite virtual environment...
  where py >nul 2>&1 && (py -3 -m venv "%VENV%") || (python -m venv "%VENV%")
  if not exist "%PY%" (
    echo ERROR: Could not create .venv-lite — install Python 3.10+.
    pause
    exit /b 1
  )
  echo %LITE_PROFILE%>"%PROFILE_FILE%"
)

:venv_ok
echo Updating Lite dependencies...
where py >nul 2>&1 && (py -3 -m pip --python "%PY%" install --no-cache-dir -q -r requirements-lite.txt) || (python -m pip --python "%PY%" install --no-cache-dir -q -r requirements-lite.txt)
if errorlevel 1 (
  echo ERROR: pip install failed.
  pause
  exit /b 1
)

"%PY%" -m pip uninstall -y fastapi uvicorn starlette pydantic pydantic_core python-multipart anyio annotated-doc annotated-types click h11 httptools idna python-dotenv PyYAML typing_extensions typing-inspection uvloop watchfiles websockets >nul 2>&1
for /d %%D in ("%VENV%\Lib\site-packages\pip" "%VENV%\Lib\site-packages\pip-*") do rmdir /s /q "%%D" 2>nul

echo.
echo Starting LocateIt Lite...
echo Drop a geotagged photo on the map to see where it was taken.
echo.

"%PY%" lite.py %*

set "EXIT_CODE=%ERRORLEVEL%"
if %EXIT_CODE% neq 0 pause
exit /b %EXIT_CODE%
