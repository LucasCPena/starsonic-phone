# Pacote "codigo-fonte completo" de uma versao (GPL v3, spec 10): este repositorio no commit da
# versao, o pjproject no commit fixo, o codigo-fonte das bibliotecas como o vcpkg baixa (so o
# download, sem compilar), as receitas do vcpkg dessas bibliotecas e um LEIA-ME-FONTES.txt.
# Precisa de <WorkDir> montado pelo Build-Deps.ps1 (ou restaurado do cache).
# Uso: .\build\Make-SourceBundle.ps1 -Version 1.0.0 -WorkDir work -OutDir dist
# Saida: <OutDir>\StarsonicPhone-<versao>-codigo-fonte-completo.zip
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$WorkDir,
    [Parameter(Mandatory = $true)][string]$OutDir
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
. (Join-Path $PSScriptRoot 'BuildCommon.ps1')
trap {
    Write-CiError -Title 'Make-SourceBundle' -Lines @($_.Exception.Message)
    break
}
$repoRoot = Split-Path -Parent $PSScriptRoot

if ($Version -notmatch '^\d+\.\d+\.\d+(-rc\.[1-9]\d*)?$') {
    throw "Versao invalida: '$Version' (use X.Y.Z ou X.Y.Z-rc.N)"
}
$lock = Get-Content -Raw -Path (Join-Path $PSScriptRoot 'deps.lock') | ConvertFrom-Json
$WorkDir = (Resolve-Path $WorkDir).Path
$pj = Join-Path $WorkDir 'pjproject'
$vcpkg = Join-Path $WorkDir 'vcpkg'
$vcpkgExe = Join-Path $vcpkg 'vcpkg.exe'
foreach ($path in @((Join-Path $pj '.git'), $vcpkgExe)) {
    if (-not (Test-Path $path)) {
        throw "Falta $path. Rode antes o Build-Deps.ps1 -WorkDir $WorkDir"
    }
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$level = [System.IO.Compression.CompressionLevel]::Optimal

# Copia as entradas de um zip para o pacote, sem extrair em disco (caminhos longos do pjproject).
function Add-ZipEntries([System.IO.Compression.ZipArchive]$Target, [string]$SourceZip) {
    $source = [System.IO.Compression.ZipFile]::OpenRead($SourceZip)
    try {
        foreach ($entry in $source.Entries) {
            if ($entry.FullName.EndsWith('/')) {
                continue
            }
            $copy = $Target.CreateEntry($entry.FullName, $level)
            $copy.LastWriteTime = $entry.LastWriteTime
            $from = $entry.Open()
            $to = $copy.Open()
            try {
                $from.CopyTo($to)
            } finally {
                $to.Dispose()
                $from.Dispose()
            }
        }
    } finally {
        $source.Dispose()
    }
}

function Add-DirectoryFiles([System.IO.Compression.ZipArchive]$Target, [string]$Directory, [string]$Prefix) {
    $base = (Resolve-Path $Directory).Path.TrimEnd('\') + '\'
    foreach ($file in Get-ChildItem -Path $Directory -File -Recurse) {
        $relative = $file.FullName.Substring($base.Length).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($Target, $file.FullName, $Prefix + $relative, $level) | Out-Null
    }
}

$name = "StarsonicPhone-$Version-codigo-fonte-completo"
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ('starsonic-fontes-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$zipPath = Join-Path (Resolve-Path $OutDir).Path "$name.zip"
if (Test-Path $zipPath) {
    Remove-Item -Path $zipPath -Force
}
try {
    # 1. Este repositorio e o pjproject (git archive: so o que esta versionado).
    $commit = (Get-NativeOutput git @('-C', $repoRoot, 'rev-parse', 'HEAD')).Output
    $repoZip = Join-Path $stage 'repo.zip'
    Invoke-Native git @('-C', $repoRoot, 'archive', '--format=zip', "--prefix=$name/starsonic-phone/", '-o', $repoZip, 'HEAD')
    $pjDir = "pjproject-$($lock.pjproject.tag)"
    $pjZip = Join-Path $stage 'pjproject.zip'
    Invoke-Native git @('-C', $pj, 'archive', '--format=zip', "--prefix=$name/$pjDir/", '-o', $pjZip, $lock.pjproject.commit)

    # 2. Codigo-fonte das bibliotecas, baixado de novo pelo vcpkg (o cache do build nao guarda os
    # downloads), sem cache de binarios e numa pasta de instalacao vazia, para baixar todas.
    $downloads = Join-Path $stage 'downloads'
    $ports = @($lock.vcpkg.ports)
    Invoke-Native $vcpkgExe (@('install') + $ports + @(
            '--triplet', $lock.vcpkg.triplet, '--only-downloads', '--binarysource=clear',
            "--x-install-root=$(Join-Path $stage 'installed')", "--downloads-root=$downloads"))
    foreach ($dir in 'tools', 'temp') {
        $path = Join-Path $downloads $dir
        if (Test-Path $path) {
            Remove-Item -Path $path -Recurse -Force
        }
    }
    Get-ChildItem -Path $downloads -File -Recurse | Where-Object { $_.Extension -eq '.part' } | Remove-Item -Force
    # Ferramentas que o vcpkg baixa para rodar as receitas (binarios, nao codigo das bibliotecas).
    $toolPatterns = @('cmake-*', 'ninja-*', 'PowerShell-*', '7z*', 'nuget*', 'python-*', 'strawberry-perl-*',
        'nasm-*', 'msys2-*', 'meson-*', 'pkgconf-*', 'gperf-*', 'jom*')
    foreach ($pattern in $toolPatterns) {
        Get-ChildItem -Path $downloads -File -Filter $pattern | Remove-Item -Force
    }
    $archives = @(Get-ChildItem -Path $downloads -File -Recurse)
    if ($archives.Count -eq 0) {
        throw 'O vcpkg nao baixou nenhum pacote de codigo-fonte.'
    }

    # 3. Receitas do vcpkg (ports\) de tudo o que esta instalado, inclusive dependencias.
    $listed = Get-NativeOutput $vcpkgExe @('list')
    $installedPorts = @([regex]::Matches($listed.Output, '(?m)^([a-z0-9-]+)(\[[^\]]*\])?:') |
            ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)

    # 4. LEIA-ME e o pacote.
    $versions = @($ports | ForEach-Object { "$_ $($lock.vcpkg.versions.$_)" }) -join ', '
    $readme = @(
        "Starsonic Phone $Version - codigo-fonte completo (GNU GPL v3)",
        '',
        "starsonic-phone/   este repositorio no commit $commit (MicroSIP com as edicoes da",
        '                   Starsonic, codigo novo em starsonic/, scripts de build e testes).',
        "$pjDir/   PJSIP $($lock.pjproject.tag), commit $($lock.pjproject.commit)",
        "                   ($($lock.pjproject.repo)), configuracao $($lock.pjproject.configuration) $($lock.pjproject.platform).",
        'vcpkg-downloads/   codigo-fonte das bibliotecas como o vcpkg baixa:',
        "                   $versions",
        "                   ($(($archives | ForEach-Object { $_.Name } | Sort-Object) -join ', ')).",
        "vcpkg-ports/       receitas do vcpkg (commit $($lock.vcpkg.commit), triplet $($lock.vcpkg.triplet)):",
        "                   $($installedPorts -join ', ').",
        '',
        'Como compilar: starsonic-phone\README.md e starsonic-phone\docs\build-notes.md.'
    )
    $readmePath = Join-Path $stage 'LEIA-ME-FONTES.txt'
    [System.IO.File]::WriteAllLines($readmePath, $readme, (New-Object System.Text.ASCIIEncoding))

    $zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $readmePath, "$name/LEIA-ME-FONTES.txt", $level) | Out-Null
        Add-ZipEntries -Target $zip -SourceZip $repoZip
        Add-ZipEntries -Target $zip -SourceZip $pjZip
        Add-DirectoryFiles -Target $zip -Directory $downloads -Prefix "$name/vcpkg-downloads/"
        foreach ($port in $installedPorts) {
            $portDir = Join-Path $vcpkg "ports\$port"
            if (Test-Path $portDir) {
                Add-DirectoryFiles -Target $zip -Directory $portDir -Prefix "$name/vcpkg-ports/$port/"
            }
        }
    } finally {
        $zip.Dispose()
    }
} finally {
    Remove-Item -Path $stage -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ("fontes: {0} ({1} bytes; {2} pacotes do vcpkg)" -f $zipPath, (Get-Item $zipPath).Length, $archives.Count)
