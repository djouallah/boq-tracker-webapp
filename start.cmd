@echo off
echo Starting BOQ Tracker...

:: Kill any process already on ports 8000 / 5173
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5173 ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>&1

:: Check Node / npm is installed
where npm >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Download it from https://nodejs.org
  pause
  exit /b 1
)

:: Check venv exists
if not exist "%~dp0.venv\Scripts\pythonw.exe" (
  echo Run install.cmd first to set up dependencies.
  pause
  exit /b 1
)

:: Launch both services hidden — venv pythonw has no console window at all
"%~dp0.venv\Scripts\pythonw.exe" "%~dp0launcher.pyw"

:: Wait for backend to be ready
echo Waiting for backend...
:wait_backend
timeout /t 1 /nobreak >nul
curl -s http://localhost:8000/api/db-status >nul 2>&1
if errorlevel 1 goto wait_backend

:: Wait for frontend to be ready
echo Waiting for frontend...
:wait_frontend
timeout /t 1 /nobreak >nul
curl -s http://localhost:5173 >nul 2>&1
if errorlevel 1 goto wait_frontend

:: Both ready — open browser
echo Ready! Opening browser...
start http://localhost:5173
