param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$pythonPath = Join-Path $projectRoot '.pixi\envs\default\python.exe'
$dataPath = Join-Path $projectRoot '.planning\acceptance-1.5.5'
$webPath = Join-Path $projectRoot 'web\dist'
$url = 'http://127.0.0.1:5155'
function Test-Ready([string]$Address) {
    try { return (Invoke-WebRequest -Uri $Address -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 }
    catch { return $false }
}
function Start-ServiceProcess([int]$Port, [string]$Module, [string]$Name, [string]$Probe) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if ($listener) {
        $existing = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener[0].OwningProcess)"
        if (-not $existing.CommandLine.Contains($Module) -or -not $existing.CommandLine.Contains($pythonPath)) {
            throw "Port $Port is used by another application. No process was stopped."
        }
    } else {
        Start-Process -FilePath $pythonPath -ArgumentList @('-m','uvicorn',$Module,'--host','127.0.0.1','--port',"$Port") -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataPath "$Name.log") -RedirectStandardError (Join-Path $dataPath "$Name-error.log") | Out-Null
    }
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if (Test-Ready $Probe) { return }
        Start-Sleep -Milliseconds 500
    }
    throw "Startup failed: $Name. Check logs in $dataPath"
}
try {
    if (-not (Test-Path $pythonPath)) { throw "Missing Python environment: $pythonPath" }
    if (-not (Test-Path (Join-Path $webPath 'index.html'))) { throw 'Missing frontend build. Run npm run build in web first.' }
    if (-not (Test-Path (Join-Path $dataPath '.eh-acceptance-155'))) { throw 'Missing isolated acceptance data. Run scripts/seed_acceptance_155.py first.' }
    $env:EH_DATA_ROOT = $dataPath
    $env:SOLAIRE_USER_CONFIG_DIR = Join-Path $dataPath 'config'
    $env:SOLAIRE_PUBLIC_MODE = '1'
    $env:EH_WEB_ROOT = $webPath
    $env:EH_RELEASE_ID = '1.5.5-local'
    $env:EH_BACKEND_URL = 'http://127.0.0.1:8155'
    Start-ServiceProcess 8155 'solaire.web.app:app' 'desktop-backend' 'http://127.0.0.1:8155/openapi.json'
    Start-ServiceProcess 5155 'solaire.web.offline_frontend:app' 'desktop-frontend' "$url/_eh_release"
    Write-Host "EducationHelper 1.5.5 ready: $url"
    Write-Host 'Test password: EHtest155!'
    if (-not $NoBrowser) { Start-Process $url }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
