# Compila o app novo do Windows (windows/app: o StarsonicPhone.exe com o WebView2 e o motor) com o CMake e o MSBuild,
# sobre as dependencias do Build-Deps.ps1 (<WorkDir>\pjproject, <WorkDir>\vcpkg e <WorkDir>\webview2), e copia a
# interface empacotada (windows\ui\dist, do npm run build ou do artefato ui-dist do CI) para a pasta ui\ da saida.
# Uso: .\build\Build-Windows.ps1 -WorkDir work -Version 0.1.0-rc.1 -Channel teste -OutDir out-novo [-UiDir windows\ui\dist] [-TestHooks]
# -TestHooks: o build de teste (o STARSONIC_PERFIL troca o perfil embutido; as ferramentas do desenvolvedor do WebView2).
# Saida em <OutDir>: StarsonicPhone.exe, StarsonicPhone.pdb e ui\.
param(
    [Parameter(Mandatory = $true)][string]$WorkDir,
    [Parameter(Mandatory = $true)][string]$Version,
    [ValidateSet('estavel', 'teste')][string]$Channel = 'estavel',
    [Parameter(Mandatory = $true)][string]$OutDir,
    [string]$UiDir = '',
    [switch]$TestHooks
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
. (Join-Path $PSScriptRoot 'BuildCommon.ps1')
trap {
    Write-CiError -Title 'Build-Windows' -Lines @($_.Exception.Message)
    break
}
$repoRoot = Split-Path -Parent $PSScriptRoot

if ($Version -notmatch '^(\d+)\.(\d+)\.(\d+)(-rc\.([1-9]\d*))?$') {
    throw "Versao invalida: '$Version' (use X.Y.Z ou X.Y.Z-rc.N)"
}
foreach ($part in @($Matches[1], $Matches[2], $Matches[3])) {
    if ([long]$part -gt 65535) {
        throw "Versao invalida: '$Version' (cada numero vai ate 65535)"
    }
}

$WorkDir = (Resolve-Path $WorkDir).Path
$lock = Get-Content -Raw -Path (Join-Path $PSScriptRoot 'deps.lock') | ConvertFrom-Json
$pj = Join-Path $WorkDir 'pjproject'
$vcpkgRoot = Join-Path $WorkDir "vcpkg\installed\$($lock.vcpkg.triplet)"
$webview2 = Join-Path $WorkDir 'webview2'
$required = @(
    (Join-Path $pj 'lib\libpjproject-i386-Win32-vc14-Release-Static.lib'),
    (Join-Path $pj 'pjsip\lib\pjsua2-lib-i386-Win32-vc14-Release-Static.lib'),
    (Join-Path $vcpkgRoot 'lib\sqlite3.lib'),
    (Join-Path $webview2 'x86\WebView2LoaderStatic.lib')
)
foreach ($file in $required) {
    if (-not (Test-Path $file)) {
        throw "Dependencia ausente: $file. Rode antes: .\build\Build-Deps.ps1 -WorkDir $WorkDir"
    }
}
$sdkVersion = (Get-Content -Raw -Path (Join-Path $webview2 'VERSION')).Trim()
if ($sdkVersion -ne $lock.webview2.version) {
    throw "WebView2 SDK $sdkVersion em $webview2, esperado $($lock.webview2.version). Rode o Build-Deps.ps1 de novo."
}

if (-not $UiDir) {
    $UiDir = Join-Path $repoRoot 'windows\ui\dist'
}
if (-not (Test-Path (Join-Path $UiDir 'index.html'))) {
    throw "Interface ausente em $UiDir (rode 'npm run build' em windows\ui, ou baixe o artefato ui-dist)."
}
$UiDir = (Resolve-Path $UiDir).Path

# 1. CMake (o gerador do Visual Studio 2022, Win32) e MSBuild
. (Join-Path $PSScriptRoot 'VsEnv.ps1')
$flavor = if ($TestHooks) { 'teste' } else { 'release' }
$buildDir = Join-Path $WorkDir "build-windows-app-$flavor"
$hooks = if ($TestHooks) { 'ON' } else { 'OFF' }
Invoke-Native cmake @(
    '-S', (Join-Path $repoRoot 'windows\app'), '-B', $buildDir, '-G', 'Visual Studio 17 2022', '-A', 'Win32',
    "-DPJPROJECT_DIR=$pj", "-DVCPKG_INSTALLED_DIR=$vcpkgRoot", "-DWEBVIEW2_DIR=$webview2",
    "-DSTARSONIC_VERSION=$Version", "-DSTARSONIC_CHANNEL=$Channel", "-DSTARSONIC_TEST_HOOKS=$hooks")
Invoke-Native cmake @('--build', $buildDir, '--config', 'Release', '--', '/m', '/nologo', '/v:minimal')

$exe = Join-Path $buildDir 'Release\StarsonicPhone.exe'
if (-not (Test-Path $exe)) {
    throw 'StarsonicPhone.exe nao foi gerado.'
}

# 2. Saida: o executavel e a interface em ui\
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Copy-Item -Path $exe -Destination (Join-Path $OutDir 'StarsonicPhone.exe') -Force
$pdb = [System.IO.Path]::ChangeExtension($exe, '.pdb')
if (Test-Path $pdb) {
    Copy-Item -Path $pdb -Destination (Join-Path $OutDir 'StarsonicPhone.pdb') -Force
}
Sync-Directory -Source $UiDir -Destination (Join-Path $OutDir 'ui')
Write-Host "versao $Version, canal $Channel, build $flavor"
Get-ChildItem -Path $OutDir -Recurse -File | ForEach-Object {
    Write-Host ("saida: {0} ({1} bytes)" -f $_.FullName.Substring((Resolve-Path $OutDir).Path.Length + 1), $_.Length)
}
