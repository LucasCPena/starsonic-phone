# Gera o instalador (NSIS 3) do app novo a partir da saida do Build-Windows.ps1 (o StarsonicPhone.exe e a pasta ui\).
# Uso: .\build\Build-Installer.ps1 -Version 0.1.0-rc.1 -AppDir out-novo -OutDir dist [-WorkDir work]
# Saida: <OutDir>\StarsonicPhone-<versao>-setup.exe (o exe, a pasta ui\ e o bootstrapper do WebView2; o PDB fica de
# fora). O bootstrapper Evergreen do WebView2 (MicrosoftEdgeWebview2Setup.exe) vem do endereco do build\deps.lock
# (webview2Bootstrapper), com o SHA-256 e a assinatura da Microsoft conferidos, e fica guardado em
# <WorkDir>\webview2-bootstrapper.
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$AppDir,
    [Parameter(Mandatory = $true)][string]$OutDir,
    [string]$WorkDir = 'work'
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
$exe = Join-Path $AppDir 'StarsonicPhone.exe'
$ui = Join-Path $AppDir 'ui'
foreach ($required in $exe, (Join-Path $ui 'index.html'), (Join-Path $ui 'aviso.html')) {
    if (-not (Test-Path $required)) {
        throw "$required nao encontrado. Rode antes o Build-Windows.ps1 (o app novo, com a pasta ui)."
    }
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

# O icone do app novo e as imagens das paginas (branding\fontes\gerar_instalador.py).
$icon = Join-Path $repoRoot 'windows\app\res\app.ico'
$side = Join-Path $repoRoot 'branding\installer\lateral.bmp'
$header = Join-Path $repoRoot 'branding\installer\cabecalho.bmp'
foreach ($required in $icon, $side, $header) {
    if (-not (Test-Path $required)) {
        throw "$required nao encontrado."
    }
}

# O bootstrapper do WebView2, conferido pelo SHA-256 do deps.lock e pela assinatura da Microsoft.
$lock = (Get-Content -Raw -Path (Join-Path $PSScriptRoot 'deps.lock') | ConvertFrom-Json).webview2Bootstrapper
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$bootstrapperDir = Join-Path (Resolve-Path $WorkDir).Path 'webview2-bootstrapper'
New-Item -ItemType Directory -Force -Path $bootstrapperDir | Out-Null
$bootstrapper = Join-Path $bootstrapperDir 'MicrosoftEdgeWebview2Setup.exe'
$hash = if (Test-Path $bootstrapper) { (Get-FileHash -Algorithm SHA256 -Path $bootstrapper).Hash.ToLowerInvariant() } else { '' }
if ($hash -ne $lock.sha256) {
    Write-Host "== bootstrapper do WebView2 $($lock.version)"
    $previousProgress = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
        Invoke-WebRequest -Uri $lock.url -OutFile $bootstrapper -UseBasicParsing
    } finally {
        $ProgressPreference = $previousProgress
    }
    $hash = (Get-FileHash -Algorithm SHA256 -Path $bootstrapper).Hash.ToLowerInvariant()
    if ($hash -ne $lock.sha256) {
        Remove-Item -Path $bootstrapper -Force
        throw "Bootstrapper do WebView2: SHA-256 $hash, esperado $($lock.sha256) (o endereco do deps.lock mudou de arquivo?)"
    }
}
$signature = Get-AuthenticodeSignature -FilePath $bootstrapper
if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate -or
    $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
    throw "Bootstrapper do WebView2 sem a assinatura da Microsoft: $($signature.Status) $($signature.StatusMessage)"
}
Write-Host "bootstrapper do WebView2 $($lock.version) (sha256 $hash, $($signature.SignerCertificate.Subject))"

# Os arquivos instalados, listados aqui para o log; o desinstalador apaga o exe e a pasta ui\ inteira.
$uiFiles = @(Get-ChildItem -Path $ui -File -Recurse | Sort-Object FullName)
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ('starsonic-installer-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $temp | Out-Null
$filesNsh = Join-Path $temp 'arquivos.nsh'
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('!macro StarsonicInstallFiles')
$lines.Add('  SetOutPath "$INSTDIR"')
$lines.Add('  File "' + $exe.Replace('$', '$$') + '"')
$current = $null
foreach ($file in $uiFiles) {
    $relative = $file.DirectoryName.Substring($AppDir.Length).TrimStart('\')
    if ($relative -ne $current) {
        $lines.Add('  SetOutPath "$INSTDIR\' + $relative.Replace('$', '$$') + '"')
        $current = $relative
    }
    $lines.Add('  File "' + $file.FullName.Replace('$', '$$') + '"')
}
$lines.Add('!macroend')
$lines.Add('!macro StarsonicUninstallFiles')
$lines.Add('  Delete "$INSTDIR\StarsonicPhone.exe"')
$lines.Add('  RMDir /r "$INSTDIR\ui"')
$lines.Add('!macroend')
[System.IO.File]::WriteAllLines($filesNsh, $lines.ToArray(), (New-Object System.Text.UTF8Encoding($false)))

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$setup = Join-Path $OutDir "StarsonicPhone-$Version-setup.exe"
$arguments = @('/V2', '/INPUTCHARSET', 'UTF8',
    "/DVERSION=$Version", "/DVERSION_QUAD=$versionQuad", "/DAPP_ICON=$icon",
    "/DFILES_NSH=$filesNsh", "/DOUTFILE=$setup", "/DSIDE_BMP=$side", "/DHEADER_BMP=$header",
    "/DWEBVIEW2_SETUP=$bootstrapper",
    (Join-Path $repoRoot 'installer\StarsonicPhone.nsi'))
try {
    Invoke-Native $makensis $arguments
} finally {
    Remove-Item -Path $temp -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ("instalador: {0} ({1} bytes; o exe e {2} arquivos da ui)" -f $setup, (Get-Item $setup).Length, $uiFiles.Count)
