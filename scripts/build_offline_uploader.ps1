$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $projectRoot "tools\offline_answer_uploader.py"
$output = Join-Path $projectRoot "src\solaire\web\assets\tools"
$work = Join-Path $projectRoot ".build\offline-uploader"
New-Item -ItemType Directory -Force -Path $output | Out-Null
New-Item -ItemType Directory -Force -Path $work | Out-Null
& pixi run python -m PyInstaller --noconfirm --clean --onefile --windowed --name "EducationHelper-Offline-Answer-Uploader" --distpath $output --workpath $work --specpath $work $source
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller build failed with exit code $LASTEXITCODE"
}
Write-Host "Built: $output\EducationHelper-Offline-Answer-Uploader.exe"
