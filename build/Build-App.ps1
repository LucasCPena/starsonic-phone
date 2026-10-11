# Compila o Starsonic Phone dentro de <WorkDir>\pjproject (preparado por Build-Deps.ps1).
# Uso: .\build\Build-App.ps1 -WorkDir work -Version 1.0.0 -Channel estavel -ProfilesFile branding\servidores.ini -OutDir out
# Saida em <OutDir>: StarsonicPhone.exe, sons .wav e a traducao pt-BR (quando existirem).
param(
    [Parameter(Mandatory = $true)][string]$WorkDir,
    [Parameter(Mandatory = $true)][string]$Version,
    [ValidateSet('estavel', 'teste')][string]$Channel = 'estavel',
    [Parameter(Mandatory = $true)][string]$ProfilesFile,
    [Parameter(Mandatory = $true)][string]$OutDir
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
. (Join-Path $PSScriptRoot 'BuildCommon.ps1')
trap {
    Write-CiError -Title 'Build-App' -Lines @($_.Exception.Message)
    break
}
$repoRoot = Split-Path -Parent $PSScriptRoot

if ($Version -notmatch '^(\d+)\.(\d+)\.(\d+)(-rc\.([1-9]\d*))?$') {
    throw "Versao invalida: '$Version' (use X.Y.Z ou X.Y.Z-rc.N)"
}
$rc = if ($Matches.ContainsKey(5)) { $Matches[5] } else { '0' }
$parts = @($Matches[1], $Matches[2], $Matches[3], $rc)
foreach ($part in $parts) {
    if ([long]$part -gt 65535) {
        throw "Versao invalida: '$Version' (cada numero vai ate 65535)"
    }
}
$versionComma = $parts -join ','

$WorkDir = (Resolve-Path $WorkDir).Path
$ProfilesFile = (Resolve-Path $ProfilesFile).Path
$pj = Join-Path $WorkDir 'pjproject'
if (-not (Test-Path (Join-Path $pj 'lib\libpjproject-i386-Win32-vc14-Release-Static.lib'))) {
    throw "Dependencias ausentes em $WorkDir. Rode antes: .\build\Build-Deps.ps1 -WorkDir $WorkDir"
}

# 1. Fontes do app dentro da arvore do pjproject (o projeto do MicroSIP usa ..\pjlib etc.)
foreach ($name in 'microsip', 'starsonic', 'branding') {
    $source = Join-Path $repoRoot $name
    if (Test-Path $source) {
        Sync-Directory -Source $source -Destination (Join-Path $pj $name) -ExcludeDirs @('Release', 'Debug')
    }
}

# 2. Sobreposicao da marca (ex.: overlay\microsip\res\microsip.ico -> pjproject\microsip\res\microsip.ico)
$overlay = Join-Path $repoRoot 'branding\overlay'
if (Test-Path $overlay) {
    $overlay = (Resolve-Path $overlay).Path
    Get-ChildItem -Path $overlay -Recurse -File | Where-Object { $_.Name -ne '.gitkeep' } | ForEach-Object {
        $relative = $_.FullName.Substring($overlay.Length).TrimStart('\')
        $target = Join-Path $pj $relative
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
        Copy-Item -Path $_.FullName -Destination $target -Force
        Write-Host "overlay: $relative"
    }
}

# 3. Arquivos gerados
$generated = Join-Path $pj 'starsonic\generated'
New-Item -ItemType Directory -Force -Path $generated | Out-Null
$logoBand = Join-Path $repoRoot 'branding\logo-faixa.png'
$logoLogin = Join-Path $repoRoot 'branding\logo-entrar.png'
$hasLogos = (Test-Path $logoBand) -and (Test-Path $logoLogin)
if ($hasLogos) {
    Copy-Item -Path $logoBand, $logoLogin -Destination $generated -Force
}
$timestamp = Get-CommitTimestamp -RepoRoot $repoRoot
$channelTest = if ($Channel -eq 'teste') { 1 } else { 0 }
$logos = if ($hasLogos) { 1 } else { 0 }
$buildInfo = @(
    '/* Gerado por build/Build-App.ps1. Nao edite. */',
    '#ifndef STARSONIC_BUILD_INFO_H',
    '#define STARSONIC_BUILD_INFO_H',
    "#define STARSONIC_VERSION `"$Version`"",
    "#define STARSONIC_VERSION_COMMA $versionComma",
    "#define STARSONIC_BUILD_TIMESTAMP $timestamp",
    "#define STARSONIC_UPDATE_CHANNEL_TEST $channelTest",
    "#define STARSONIC_HAS_LOGOS $logos",
    '#endif'
)
Set-Content -Path (Join-Path $generated 'build_info.h') -Value $buildInfo -Encoding Ascii
Copy-Item -Path $ProfilesFile -Destination (Join-Path $generated 'servidores.ini') -Force
Write-Host "versao $Version ($versionComma), canal $Channel, perfis $ProfilesFile"

# 4. Compilacao (TargetName vai na linha de comando para valer desde o inicio da avaliacao do projeto)
. (Join-Path $PSScriptRoot 'VsEnv.ps1')
$vcpkgRoot = Join-Path $WorkDir 'vcpkg\installed\x86-windows-static'
$project = Join-Path $pj 'microsip\microsip.vcxproj'
Invoke-Native msbuild @(
    $project, '/p:Configuration=Release', '/p:Platform=Win32',
    "/p:StarsonicVcpkgRoot=$vcpkgRoot", '/p:TargetName=StarsonicPhone',
    '/m', '/nologo', '/v:minimal')

$exe = Get-ChildItem -Path (Join-Path $pj 'microsip') -Recurse -Filter 'StarsonicPhone.exe' |
    Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $exe) {
    throw 'StarsonicPhone.exe nao foi gerado.'
}

# 5. Saida
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Copy-Item -Path $exe.FullName -Destination (Join-Path $OutDir 'StarsonicPhone.exe') -Force
$pdb = [System.IO.Path]::ChangeExtension($exe.FullName, '.pdb')
if (Test-Path $pdb) {
    Copy-Item -Path $pdb -Destination (Join-Path $OutDir 'StarsonicPhone.pdb') -Force
}
$dist = Join-Path $repoRoot 'microsip-dist'
if (Test-Path $dist) {
    Get-ChildItem -Path $dist -Filter '*.wav' | Copy-Item -Destination $OutDir -Force
}
$langpack = Join-Path $repoRoot 'branding\langpack_portuguesebr.txt'
if (Test-Path $langpack) {
    Copy-Item -Path $langpack -Destination $OutDir -Force
}
Get-ChildItem -Path $OutDir | ForEach-Object { Write-Host ("saida: {0} ({1} bytes)" -f $_.Name, $_.Length) }
