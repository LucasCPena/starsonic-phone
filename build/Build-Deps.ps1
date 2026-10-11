# Monta as dependencias nativas do Starsonic Phone em <WorkDir>:
#   <WorkDir>\pjproject  pjproject no commit fixo, com config_site.h e libpjproject compilada
#   <WorkDir>\vcpkg      vcpkg no commit fixo, com openssl, opus, bcg729, sqlite3 e sqlitecpp
# Versoes em build\deps.lock. Uso: .\build\Build-Deps.ps1 -WorkDir work
param(
    [Parameter(Mandatory = $true)][string]$WorkDir
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
. (Join-Path $PSScriptRoot 'BuildCommon.ps1')

$lock = Get-Content -Raw -Path (Join-Path $PSScriptRoot 'deps.lock') | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$WorkDir = (Resolve-Path $WorkDir).Path
$pj = Join-Path $WorkDir 'pjproject'
$vcpkg = Join-Path $WorkDir 'vcpkg'
$triplet = $lock.vcpkg.triplet

# 1. pjproject no commit fixo
Write-Host "== pjproject $($lock.pjproject.tag) ($($lock.pjproject.commit))"
Get-PinnedRepo -Url $lock.pjproject.repo -Commit $lock.pjproject.commit -Dir $pj

# 2. config_site.h
Copy-Item -Path (Join-Path $PSScriptRoot 'config_site.h') -Destination (Join-Path $pj 'pjlib\include\pj\config_site.h') -Force

# 3. vcpkg no commit fixo e portas
Write-Host "== vcpkg $($lock.vcpkg.commit) ($triplet)"
Get-PinnedRepo -Url $lock.vcpkg.repo -Commit $lock.vcpkg.commit -Dir $vcpkg
$vcpkgExe = Join-Path $vcpkg 'vcpkg.exe'
if (-not (Test-Path $vcpkgExe)) {
    Invoke-Native (Join-Path $vcpkg 'bootstrap-vcpkg.bat') @('-disableMetrics')
}
$ports = @($lock.vcpkg.ports)
Invoke-Native $vcpkgExe (@('install') + $ports + @('--triplet', $triplet, '--clean-after-build'))

# Confere as versoes instaladas contra o deps.lock.
$listed = Get-NativeOutput $vcpkgExe @('list')
foreach ($port in $ports) {
    $expected = $lock.vcpkg.versions.$port
    $pattern = '(?m)^' + [regex]::Escape("${port}:$triplet") + '\s+(\S+)'
    $match = [regex]::Match($listed.Output, $pattern)
    if (-not $match.Success) {
        throw "vcpkg: porta $port nao instalada"
    }
    if ($match.Groups[1].Value -ne $expected) {
        throw "vcpkg: $port $($match.Groups[1].Value), esperado $expected"
    }
    Write-Host "vcpkg: $port $expected"
}

# 4. libpjproject (Release-Static, Win32), com os cabecalhos do vcpkg
. (Join-Path $PSScriptRoot 'VsEnv.ps1')
$vcpkgInclude = Join-Path $vcpkg "installed\$triplet\include"
$env:CL = "/I`"$vcpkgInclude`""
Push-Location $pj
try {
    Invoke-Native msbuild @(
        'pjproject-vs14.sln', '/t:libpjproject',
        "/p:Configuration=$($lock.pjproject.configuration)", "/p:Platform=$($lock.pjproject.platform)",
        '/p:PlatformToolset=v143', '/m', '/nologo', '/v:minimal')
} finally {
    Pop-Location
    Remove-Item Env:CL -ErrorAction SilentlyContinue
}

# 5. Nome da biblioteca que o #pragma de mainDlg.h pede
$libDir = Join-Path $pj 'lib'
$expectedLib = Join-Path $libDir 'libpjproject-i386-Win32-vc14-Release-Static.lib'
if (-not (Test-Path $expectedLib)) {
    $other = Get-ChildItem -Path $libDir -Filter 'libpjproject-i386-Win32-vc*-Release-Static.lib' | Select-Object -First 1
    if (-not $other) {
        throw "libpjproject nao foi gerada em $libDir"
    }
    Copy-Item -Path $other.FullName -Destination $expectedLib -Force
    Write-Warning "libpjproject saiu como $($other.Name); copiada para o nome esperado (registre em docs/build-notes.md)."
}

# 6. chkstk_ms.lib vazio (biblioteca do MinGW listada no projeto do MicroSIP; sem uso com dependencias MSVC)
$thirdLib = Join-Path $pj 'third_party\lib'
$scratch = Join-Path $WorkDir 'chkstk'
New-Item -ItemType Directory -Force -Path $thirdLib, $scratch | Out-Null
$source = Join-Path $scratch 'empty.c'
$object = Join-Path $scratch 'empty.obj'
Set-Content -Path $source -Value 'int starsonic_chkstk_ms_placeholder = 0;' -Encoding Ascii
Invoke-Native cl @('/nologo', '/c', "/Fo$object", $source)
Invoke-Native lib @('/nologo', "/OUT:$(Join-Path $thirdLib 'chkstk_ms.lib')", $object)

# Limpeza para o cache ficar pequeno: objetos intermediarios e downloads.
Get-ChildItem -Path $pj -Directory -Recurse -Filter 'output' | Remove-Item -Recurse -Force
foreach ($dir in 'buildtrees', 'downloads', 'packages') {
    $path = Join-Path $vcpkg $dir
    if (Test-Path $path) {
        Remove-Item -Path $path -Recurse -Force
    }
}
Remove-Item -Path $scratch -Recurse -Force
Write-Host "OK: dependencias em $WorkDir"
