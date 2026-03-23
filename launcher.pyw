"""
Starts backend and frontend as hidden background processes.
Called by start.cmd via pythonw (no console window).
"""
import subprocess, os, sys

ROOT  = os.path.dirname(os.path.abspath(__file__))
LOGS  = os.path.join(ROOT, 'logs')
NO_WINDOW = 0x08000000          # CREATE_NO_WINDOW flag
os.makedirs(LOGS, exist_ok=True)

# Backend — python -m uvicorn (works with both python.exe and pythonw.exe)
with open(os.path.join(LOGS, 'backend.log'), 'w') as f:
    subprocess.Popen(
        [sys.executable, '-m', 'uvicorn', 'main:app', '--port', '8000'],
        cwd=ROOT,
        stdout=f, stderr=subprocess.STDOUT,
        creationflags=NO_WINDOW,
    )

# Frontend — npm run dev (shell=True handles npm.cmd on Windows)
with open(os.path.join(LOGS, 'frontend.log'), 'w') as f:
    subprocess.Popen(
        'npm run dev',
        cwd=os.path.join(ROOT, 'frontend'),
        stdout=f, stderr=subprocess.STDOUT,
        creationflags=NO_WINDOW,
        shell=True,
    )
