@echo off
setlocal
cd /d "%~dp0"
set "PYTHONPATH=%~dp0src;%PYTHONPATH%"
if exist "%~dp0educationhelper.env" (
  set "EH_CONFIG_FILE=%~dp0educationhelper.env"
) else (
  set "SOLAIRE_PROJECT_ROOT=%~dp0"
  set "SOLAIRE_BIND_PROJECT_FROM_ENV=1"
)

echo [OriginReach] Checking backend http://127.0.0.1:8000 ...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest 'http://127.0.0.1:8000/api/health' -TimeoutSec 2 -UseBasicParsing; if ($r.StatusCode -ne 200) { exit 1 } } catch { exit 1 }"
if %ERRORLEVEL%==0 (
  echo [EducationHelper] Backend already running.
  goto :frontend
)

powershell -NoProfile -Command "$l = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($l) { exit 2 } else { exit 0 }"
if %ERRORLEVEL%==2 (
  echo [EducationHelper] ERROR: Port 8000 is occupied by another program.
  pause
  exit /b 1
)

echo [EducationHelper] Starting backend http://127.0.0.1:8000 ...
if exist "%~dp0.venv\Scripts\python.exe" (
  start "EducationHelper - Backend" cmd /k ""%~dp0.venv\Scripts\python.exe" -m uvicorn solaire.web.app:app --app-dir "%~dp0src" --host 0.0.0.0 --port 8000"
  goto :backend_started
)
if exist "%~dp0.pixi\envs\default\python.exe" (
  start "EducationHelper - Backend" cmd /k ""%~dp0.pixi\envs\default\python.exe" -m uvicorn solaire.web.app:app --host 0.0.0.0 --port 8000"
  goto :backend_started
)
where py >nul 2>&1
if %ERRORLEVEL%==0 (
  start "EducationHelper - Backend" cmd /k "py -3.12 -m uvicorn solaire.web.app:app --host 0.0.0.0 --port 8000"
) else (
  start "EducationHelper - Backend" cmd /k "python -m uvicorn solaire.web.app:app --host 0.0.0.0 --port 8000"
)
:backend_started
timeout /t 2 /nobreak >nul

:frontend
echo [EducationHelper] Checking frontend http://127.0.0.1:5173 ...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest 'http://127.0.0.1:5173' -TimeoutSec 2 -UseBasicParsing; if ($r.StatusCode -ne 200) { exit 1 } } catch { exit 1 }"
if %ERRORLEVEL%==0 (
  start "" "http://127.0.0.1:5173"
  exit /b 0
)
powershell -NoProfile -Command "$l = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($l) { exit 2 } else { exit 0 }"
if %ERRORLEVEL%==2 (
  echo [EducationHelper] ERROR: Port 5173 is occupied by another program.
  pause
  exit /b 1
)
echo [EducationHelper] Starting frontend http://127.0.0.1:5173 ...
start "EducationHelper - Frontend" cmd /k "cd /d %~dp0web && npm run dev -- --host 0.0.0.0 --port 5173 --strictPort"
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:5173"
exit /b 0
