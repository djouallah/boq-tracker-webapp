@echo off
echo Installing BOQ Tracker dependencies...

:: Python virtual environment
echo.
echo [1/3] Creating Python virtual environment...
python -m venv "%~dp0.venv"
if errorlevel 1 ( echo ERROR: failed to create venv. Is Python installed? & pause & exit /b 1 )

:: Python packages
echo.
echo [2/3] Installing Python packages...
"%~dp0.venv\Scripts\pip.exe" install -r "%~dp0requirements.txt"
if errorlevel 1 ( echo ERROR: pip install failed. & pause & exit /b 1 )

:: Node packages
echo.
echo [3/3] Installing Node packages...
cd /d "%~dp0frontend"
npm install
if errorlevel 1 ( echo ERROR: npm install failed. Is Node.js installed? & pause & exit /b 1 )

echo.
echo All done! Run start.cmd to launch the app.
pause
