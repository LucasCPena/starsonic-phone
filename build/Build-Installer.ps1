# Gera o instalador (NSIS 3) a partir da saida do Build-App.ps1.
# Uso: .\build\Build-Installer.ps1 -Version 1.0.0 -AppDir out -OutDir dist
# Saida: <OutDir>\StarsonicPhone-<versao>-setup.exe (exe, sons .wav e traducao; o PDB fica de fora).
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$AppDir,
    [Parameter(Mandatory = $true)][string]$OutDir
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
. (Join-Path $PSScriptRoot 'BuildCommon.ps1')
trap {
    Write-CiError -Title 'Build-Installer' -Lines @($_.Exception.Message)
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
$versionQuad = $parts -join '.'

$AppDir = (Resolve-Path $AppDir).Path
if (-not (Test-Path (Join-Path $AppDir 'StarsonicPhone.exe'))) {
    throw "StarsonicPhone.exe nao encontrado em $AppDir. Rode antes o Build-App.ps1."
}

# makensis: no PATH ou na pasta padrao do NSIS.
$makensis = $null
$command = Get-Command 'makensis.exe' -ErrorAction SilentlyContinue
if ($command) {
    $makensis = $command.Source
} else {
    foreach ($base in @(${env:ProgramFiles(x86)}, $env:ProgramFiles)) {
        if ($base -and (Test-Path (Join-Path $base 'NSIS\makensis.exe'))) {
            $makensis = Join-Path $base 'NSIS\makensis.exe'
            break
        }
    }
}
if (-not $makensis) {
    throw 'NSIS (makensis.exe) nao encontrado. Instale o NSIS 3.x.'
}

# Icone da Starsonic (overlay) ou, enquanto nao houver, o do upstream; imagem de boas-vindas opcional.
$icon = Join-Path $repoRoot 'branding\overlay\microsip\res\microsip.ico'
if (-not (Test-Path $icon)) {
    $icon = Join-Path $repoRoot 'microsip\res\microsip.ico'
}
$welcome = Join-Path $repoRoot 'branding\installer\boas-vindas.bmp'

# Lista dos arquivos instalados, gerada aqui para o desinstalador apagar exatamente os mesmos.
$files = @(Get-ChildItem -Path $AppDir -File | Where-Object {
        $_.Name -eq 'StarsonicPhone.exe' -or $_.Extension -eq '.wav' -or $_.Name -like 'langpack_*.txt'
    } | Sort-Object Name)
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ('starsonic-installer-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $temp | Out-Null
$filesNsh = Join-Path $temp 'arquivos.nsh'
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('!macro StarsonicInstallFiles')
foreach ($file in $files) {
    $lines.Add('  File "' + $file.FullName.Replace('$', '$$') + '"')
}
$lines.Add('!macroend')
$lines.Add('!macro StarsonicUninstallFiles')
foreach ($file in $files) {
    $lines.Add('  Delete "$INSTDIR\' + $file.Name.Replace('$', '$$') + '"')
}
$lines.Add('!macroend')
[System.IO.File]::WriteAllLines($filesNsh, $lines.ToArray(), (New-Object System.Text.UTF8Encoding($false)))

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$setup = Join-Path $OutDir "StarsonicPhone-$Version-setup.exe"
$arguments = @('/V2', '/INPUTCHARSET', 'UTF8',
    "/DVERSION=$Version", "/DVERSION_QUAD=$versionQuad", "/DAPP_ICON=$icon",
    "/DFILES_NSH=$filesNsh", "/DOUTFILE=$setup")
if (Test-Path $welcome) {
    $arguments += "/DWELCOME_BMP=$welcome"
}
$arguments += (Join-Path $repoRoot 'installer\StarsonicPhone.nsi')
try {
    Invoke-Native $makensis $arguments
} finally {
    Remove-Item -Path $temp -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ("instalador: {0} ({1} bytes; {2} arquivos)" -f $setup, (Get-Item $setup).Length, $files.Count)
