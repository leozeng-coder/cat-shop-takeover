param([switch]$SkipDependencies)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    $vcpkgRoot = Join-Path $projectRoot 'tools\vcpkg'
    if (-not (Test-Path -LiteralPath (Join-Path $vcpkgRoot 'vcpkg.exe'))) {
        throw 'C++ dependencies are missing. Run tools\vcpkg\bootstrap-vcpkg.bat first.'
    }
    if (-not $SkipDependencies) {
        & (Join-Path $vcpkgRoot 'vcpkg.exe') install --triplet x64-windows-static "--x-install-root=$projectRoot\vcpkg_installed"
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    Push-Location -LiteralPath (Join-Path $projectRoot 'client')
    try {
        npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Client dependency installation failed.' }
        npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Client build failed.' }
    } finally { Pop-Location }
    Push-Location -LiteralPath (Join-Path $projectRoot 'client-admin')
    try {
        npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Admin dependencies failed.' }
        npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Admin client build failed.' }
    } finally { Pop-Location }
    cmake -S . -B build/server -G 'Visual Studio 18 2026' -A x64 "-DCMAKE_TOOLCHAIN_FILE=$vcpkgRoot/scripts/buildsystems/vcpkg.cmake" -DVCPKG_TARGET_TRIPLET=x64-windows-static "-DVCPKG_INSTALLED_DIR=$projectRoot/vcpkg_installed"
    if ($LASTEXITCODE -ne 0) { throw 'CMake configure failed.' }
    cmake --build build/server --config Release --parallel
    if ($LASTEXITCODE -ne 0) { throw 'C++ build failed.' }
    ctest --test-dir build/server -C Release --output-on-failure
    if ($LASTEXITCODE -ne 0) { throw 'Game tests failed.' }
} finally { Pop-Location }
