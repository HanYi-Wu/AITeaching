param(
    [string]$FixtureRoot = (Join-Path $env:TEMP "originreach-perf-fixture"),
    [int]$Results = 50,
    [int]$Questions = 20,
    [int]$PendingPapers = 30,
    [int]$GraphNodes = 100
)

$ErrorActionPreference = "Stop"
$sourceRoot = Split-Path -Parent $PSScriptRoot
$projectParent = Split-Path -Parent $sourceRoot
$releaseRoot = (Get-ChildItem -LiteralPath $projectParent -Directory |
    Where-Object { $_.FullName -ne $sourceRoot -and $_.Name -like "1.7.2*" } |
    Select-Object -First 1).FullName
if (!$releaseRoot) { throw "1.7.2 release directory not found beside $sourceRoot" }
$python = Join-Path $releaseRoot ".venv\Scripts\python.exe"
$seed = Join-Path $releaseRoot "scripts\seed_demo_data.py"
$expand = Join-Path $sourceRoot "scripts\perf-fixture-expand.py"
$workspaceRoot = Join-Path $FixtureRoot "workspace"

if (!(Test-Path -LiteralPath $python)) { throw "Release Python not found: $python" }
if (!(Test-Path -LiteralPath $seed)) { throw "Release fixture seed script not found: $seed" }
if (!(Test-Path -LiteralPath $expand)) { throw "Fixture expansion script not found: $expand" }

$env:EH_DATA_ROOT = $FixtureRoot
$env:SOLAIRE_PROJECT_ROOT = $workspaceRoot
$env:SOLAIRE_BIND_PROJECT_FROM_ENV = "1"
$env:SOLAIRE_PUBLIC_MODE = "1"
$env:PYTHONDONTWRITEBYTECODE = "1"
$env:PYTHONPATH = Join-Path $releaseRoot "src"

& $python -B $seed
if ($LASTEXITCODE -ne 0) { throw "seed_demo_data.py failed with exit code $LASTEXITCODE" }

& $python -B $expand --results $Results --questions $Questions --pending-papers $PendingPapers --graph-nodes $GraphNodes
if ($LASTEXITCODE -ne 0) { throw "perf-fixture-expand.py failed with exit code $LASTEXITCODE" }
