# SolEdu Windows 桌面打包：可选 Rust 扩展 → 前端 → 嵌入式 Python 运行时 → Tauri 安装包
# 推荐入口：pixi run build-desktop（在仓库根目录）
# 需：Rust、Node 20+、MSVC、（可选）maturin

param(
  [switch]$SkipRust,
  [switch]$SkipPythonRuntime,
  [switch]$SkipNuitka,
  [switch]$SkipTauri
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

if (-not $PSBoundParameters.ContainsKey("SkipRust") -and $env:SOLAIRE_SKIP_RUST -eq "1") {
  $SkipRust = $true
}
if (-not $PSBoundParameters.ContainsKey("SkipPythonRuntime") -and $env:SOLAIRE_SKIP_PY_RUNTIME -eq "1") {
  $SkipPythonRuntime = $true
}
if (-not $PSBoundParameters.ContainsKey("SkipNuitka") -and $env:SOLAIRE_SKIP_NUITKA -eq "1") {
  $SkipNuitka = $true
}
if (-not $PSBoundParameters.ContainsKey("SkipTauri") -and $env:SOLAIRE_SKIP_TAURI -eq "1") {
  $SkipTauri = $true
}

Write-Host "仓库: $repoRoot" -ForegroundColor Cyan

$skipPy = $SkipPythonRuntime -or $SkipNuitka
if ($SkipNuitka -and -not $SkipPythonRuntime) {
  Write-Host "提示: -SkipNuitka 已弃用，请改用 -SkipPythonRuntime（含义相同）" -ForegroundColor Yellow
}

if (-not $SkipRust) {
  if (Get-Command maturin -ErrorAction SilentlyContinue) {
    Write-Host "==> maturin build (primebrush-pyo3)" -ForegroundColor Cyan
    Push-Location (Join-Path $repoRoot "primebrush-rs")
    try {
      maturin build -m crates/primebrush-pyo3/Cargo.toml --release
    } catch {
      Write-Host "maturin 跳过或失败（将使用纯 Python PrimeBrush）: $_" -ForegroundColor Yellow
    }
    Pop-Location
  } else {
    Write-Host "未安装 maturin，跳过 PyO3 编译" -ForegroundColor Yellow
  }

  $mmdrDir = Join-Path $repoRoot "src-tauri\runtime\tools"
  $mmdrExe = Join-Path $mmdrDir "mmdr.exe"
  if (Test-Path $mmdrExe) {
    Write-Host "==> mmdr 已存在: $mmdrExe" -ForegroundColor Cyan
  } else {
    Write-Host "==> Building mmdr (mermaid-rs-renderer)" -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $mmdrDir | Out-Null
    $mmdrTmp = Join-Path $repoRoot ".cache\mmdr-build"
    if (Test-Path $mmdrTmp) { Remove-Item -Recurse -Force $mmdrTmp }
    try {
      cargo install --git https://github.com/1jehuang/mermaid-rs-renderer --root $mmdrTmp
      $built = Join-Path $mmdrTmp "bin\mmdr.exe"
      if (Test-Path $built) {
        Copy-Item -Force $built $mmdrExe
        Write-Host "==> mmdr installed: $mmdrExe" -ForegroundColor Green
      } else {
        Write-Host "mmdr 构建成功但未找到二进制: $built" -ForegroundColor Yellow
      }
    } catch {
      Write-Host "mmdr 构建失败（图表渲染将不可用）: $_" -ForegroundColor Yellow
    }
    if (Test-Path $mmdrTmp) { Remove-Item -Recurse -Force $mmdrTmp }
  }
}

Write-Host "==> 前端 npm ci + build" -ForegroundColor Cyan
Push-Location (Join-Path $repoRoot "web")
try {
  npm ci
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    Write-Host "npm ci 失败，退出码: $code" -ForegroundColor Red
    exit $code
  }
  npm run build
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    Write-Host "npm run build 失败，退出码: $code" -ForegroundColor Red
    exit $code
  }
} finally {
  Pop-Location
}

# 验证前端构建来源一致性
$distStamp = Join-Path $repoRoot "web\dist\build-stamp.json"
if (-not (Test-Path $distStamp)) {
  Write-Host "前端构建产物缺少 build-stamp.json: $distStamp" -ForegroundColor Red
  exit 1
}

# 校验 build-stamp.json
$pyCmd = if (Get-Command py -ErrorAction SilentlyContinue) { "py" }
         elseif (Get-Command python -ErrorAction SilentlyContinue) { "python" }
         elseif (Get-Command uv -ErrorAction SilentlyContinue) { "uv" }
         else { $null }

if ($pyCmd) {
  $expectedCommit = & git -C $repoRoot rev-parse HEAD
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace([string]$expectedCommit)) {
    Write-Host "无法读取当前源码 revision，拒绝验证前端构建来源" -ForegroundColor Red
    exit 1
  }
  $expectedCommit = [string]$expectedCommit
  $stampScript = Join-Path $repoRoot "scripts\build_stamp.py"
  $webDir = Join-Path $repoRoot "web"
  $distDir = Join-Path $repoRoot "web\dist"
  if ($pyCmd -eq "uv") {
    & uv run --no-sync python $stampScript verify --dist-dir $distDir --web-dir $webDir --expected-commit $expectedCommit
  } elseif ($pyCmd -eq "py") {
    & py -3 $stampScript verify --dist-dir $distDir --web-dir $webDir --expected-commit $expectedCommit
  } else {
    & python $stampScript verify --dist-dir $distDir --web-dir $webDir --expected-commit $expectedCommit
  }
  if ($LASTEXITCODE -ne 0) {
    Write-Host "前端构建来源验证失败 (build_stamp.py)" -ForegroundColor Red
    exit $LASTEXITCODE
  }
} else {
  Write-Host "无法找到 Python 验证器，拒绝验证前端构建来源" -ForegroundColor Red
  exit 1
}

if (-not $skipPy) {
  Write-Host "==> Rebuild embedded Python runtime from clean state" -ForegroundColor Cyan
  & (Join-Path $repoRoot "scripts\stage-python-runtime.ps1") -Force
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $pyw = Join-Path $repoRoot "src-tauri\runtime\python\pythonw.exe"
  if (-not (Test-Path $pyw)) {
    Write-Error "嵌入式 Python 未就绪: $pyw"
  }
} else {
  Write-Host '跳过嵌入式 Python（SkipPythonRuntime / SkipNuitka）' -ForegroundColor Yellow
}

if (-not $SkipTauri) {
  $wixCandle = Join-Path $env:LOCALAPPDATA "cache\tauri\WixTools314\candle.exe"
  if (-not (Test-Path $wixCandle)) {
    Write-Host "==> 预下载 WiX（避免 Tauri 从 GitHub 拉取时超时）" -ForegroundColor Cyan
    & (Join-Path $repoRoot "scripts\prepare-wix-tools.ps1")
    if ($LASTEXITCODE -ne 0) {
      Write-Host "WiX 预下载失败。可手动执行 .\scripts\prepare-wix-tools.ps1，或设置镜像 TAURI_BUNDLER_TOOLS_GITHUB_MIRROR（见 docs/desktop-build.md）" -ForegroundColor Red
      exit $LASTEXITCODE
    }
  }
  Write-Host "==> Tauri 打包（npm run tauri:build 或已安装 cargo tauri-cli）" -ForegroundColor Cyan
  Set-Location $repoRoot
  if (Test-Path (Join-Path $repoRoot "node_modules\@tauri-apps\cli")) {
    npm run tauri:build
  } else {
    Write-Host "根目录未 npm install，尝试 cargo tauri build（需 cargo install tauri-cli；须在仓库根目录执行）" -ForegroundColor Yellow
    Set-Location $repoRoot
    cargo tauri build
    if ($LASTEXITCODE -ne 0) {
      Write-Host "cargo tauri build 失败，回退为仅编译 src-tauri release 二进制" -ForegroundColor Yellow
      Push-Location (Join-Path $repoRoot "src-tauri")
      cargo build --release
      Pop-Location
    }
  }
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Tauri 打包失败，退出码 $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
  }
  Write-Host "完成。安装包通常在 src-tauri/target/release/bundle/msi/" -ForegroundColor Green
} else {
  Write-Host '跳过 Tauri（SkipTauri）' -ForegroundColor Yellow
}
