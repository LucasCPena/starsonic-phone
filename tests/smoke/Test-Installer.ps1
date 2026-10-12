# Teste do instalador: instala em silencio (/S) e confere arquivos, atalho e registro; roda o mesmo
# instalador com o app aberto (como na atualizacao: o app fecha e reabre com outro PID); desinstala
# em silencio e confere o que sai e o que fica.
# Instala no perfil do usuario atual (feito para o CI). Uso:
#   .\tests\smoke\Test-Installer.ps1 -Setup dist\StarsonicPhone-0.0.0-setup.exe -AppDir out -Version 0.0.0
param(
    [Parameter(Mandatory = $true)][string]$Setup,
    [Parameter(Mandatory = $true)][string]$AppDir,
    [Parameter(Mandatory = $true)][string]$Version,
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot '..\..\build\BuildCommon.ps1')
trap {
    Write-CiError -Title 'Test-Installer' -Lines @($_.Exception.Message)
    break
}

$installDir = Join-Path $env:LOCALAPPDATA 'Starsonic Phone'
$exe = Join-Path $installDir 'StarsonicPhone.exe'
$uninstaller = Join-Path $installDir 'Uninstall.exe'
$dataDir = Join-Path $env:APPDATA 'Starsonic Phone'
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Starsonic Phone.lnk'
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Starsonic Phone.lnk'
$appKey = 'HKCU:\Software\Starsonic Phone'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\StarsonicPhone'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

if ((Test-Path $appKey) -and -not $Force) {
    throw 'Ja existe uma instalacao do Starsonic Phone neste usuario; use -Force para testar mesmo assim.'
}
$Setup = (Resolve-Path $Setup).Path
$AppDir = (Resolve-Path $AppDir).Path

# Processos do app instalado (outras copias, como as dos testes portateis, ficam de fora).
function Get-InstalledApp {
    return @(Get-Process -Name 'StarsonicPhone' -ErrorAction SilentlyContinue | Where-Object {
            $path = $null
            try { $path = $_.Path } catch { }
            $path -eq $exe
        })
}

function Fail([string]$message) {
    $lines = @($message)
    foreach ($process in Get-InstalledApp) {
        $lines += @(Get-HangReport -ProcessId $process.Id -Label "app $($process.Id)" -SymbolDir $AppDir)
    }
    Write-CiError -Title 'Test-Installer' -Lines $lines
    throw $message
}

# Roda o instalador (ou o desinstalador) e espera terminar com codigo 0.
function Invoke-Setup([string]$File, [string]$Arguments) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $File
    $info.Arguments = $Arguments
    $info.UseShellExecute = $false
    $process = [System.Diagnostics.Process]::Start($info)
    $name = Split-Path -Leaf $File
    if (-not $process.WaitForExit(120000)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        Fail "$name $Arguments nao terminou em 120 s."
    }
    if ($process.ExitCode -ne 0) {
        Fail "$name $Arguments terminou com codigo $($process.ExitCode)."
    }
}

# Espera o app instalado com a janela principal aberta (diferente de $ExceptId).
function Wait-InstalledApp([int]$ExceptId = 0, [int]$TimeoutSeconds = 30) {
    $holder = @{ Process = $null }
    Wait-Until -TimeoutSeconds $TimeoutSeconds -Condition {
        foreach ($candidate in Get-InstalledApp) {
            if ($candidate.Id -ne $ExceptId -and
                (Find-WindowByClass -ProcessId $candidate.Id -ClassName 'Starsonic Phone' -TimeoutSeconds 0)) {
                $holder.Process = $candidate
                return $true
            }
        }
        return $false
    } | Out-Null
    return $holder.Process
}

function Get-RegistryValue([string]$Key, [string]$Name) {
    $item = Get-ItemProperty -Path $Key -Name $Name -ErrorAction SilentlyContinue
    if ($null -eq $item) {
        return $null
    }
    return $item.$Name
}

try {
    # Ultima verificacao de atualizacao feita agora: sem o aviso no meio do teste (ver Common.ps1).
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
    $ini = Join-Path $dataDir 'StarsonicPhone.ini'
    Write-IniFile -Path $ini -Lines @(Get-NoUpdateCheckIni)

    # 1. Primeira instalacao em silencio.
    Invoke-Setup -File $Setup -Arguments '/S'
    $expected = @('StarsonicPhone.exe', 'Uninstall.exe') + @(Get-ChildItem -Path $AppDir -File |
            Where-Object { $_.Extension -eq '.wav' -or $_.Name -like 'langpack_*.txt' } |
            ForEach-Object { $_.Name })
    foreach ($name in $expected) {
        if (-not (Test-Path (Join-Path $installDir $name))) {
            Fail "Arquivo nao instalado: $name"
        }
    }
    if (Test-Path (Join-Path $installDir 'StarsonicPhone.pdb')) {
        Fail 'O PDB nao deveria ser instalado.'
    }
    if (-not (Test-Path $startMenu)) {
        Fail "Atalho do menu Iniciar ausente: $startMenu"
    }
    if (Test-Path $desktop) {
        Fail 'A instalacao silenciosa nao deveria criar o atalho da area de trabalho.'
    }
    $registered = Get-RegistryValue -Key $appKey -Name '(default)'
    if ($registered -ne $installDir) {
        Fail "HKCU\Software\Starsonic Phone (Padrao) = '$registered'; esperado '$installDir'."
    }
    if ($null -ne (Get-RegistryValue -Key $appKey -Name 'RunAtSystemStartup')) {
        Fail 'A instalacao silenciosa nao deveria gravar RunAtSystemStartup.'
    }
    $displayVersion = Get-RegistryValue -Key $uninstallKey -Name 'DisplayVersion'
    if ($displayVersion -ne $Version) {
        Fail "DisplayVersion = '$displayVersion'; esperado '$Version'."
    }
    $quiet = Get-RegistryValue -Key $uninstallKey -Name 'QuietUninstallString'
    if ($quiet -ne "`"$uninstaller`" /S") {
        Fail "QuietUninstallString = '$quiet'."
    }
    Write-Host "Instalado em $installDir ($($expected.Count) arquivos)."

    $first = Wait-InstalledApp
    if (-not $first) {
        Fail 'O instalador (/S) nao abriu o app ao terminar.'
    }
    Write-Host "App aberto pelo instalador: PID $($first.Id)."

    # 2. Atualizacao: o mesmo instalador com o app aberto fecha o app, troca os arquivos e o reabre.
    Invoke-Setup -File $Setup -Arguments '/S'
    if (-not (Wait-Until -TimeoutSeconds 5 -Condition { $first.HasExited })) {
        Fail "O app anterior (PID $($first.Id)) continua aberto depois da atualizacao."
    }
    $second = Wait-InstalledApp -ExceptId $first.Id
    if (-not $second) {
        Fail 'O app nao foi reaberto depois da atualizacao.'
    }
    Start-Sleep -Seconds 3
    if ($second.HasExited) {
        Fail "O app reaberto (PID $($second.Id)) fechou sozinho."
    }
    Write-Host "App reaberto depois da atualizacao: PID $($second.Id)."

    # 3. Desinstalacao em silencio. O valor de Run e gravado pelo proprio app quando "Iniciar com o
    # Windows" esta ligado; aqui ele e criado para conferir que a desinstalacao o remove.
    Set-ItemProperty -Path $runKey -Name 'Starsonic Phone' -Value "`"$exe`" /minimized"
    Invoke-Setup -File $uninstaller -Arguments '/S'
    # O desinstalador do NSIS se copia para a pasta temporaria e continua de la: espera o fim.
    $done = Wait-Until -TimeoutSeconds 60 -Condition { -not (Test-Path $uninstallKey) }
    if (-not $done) {
        Fail 'A desinstalacao nao terminou em 60 s (a chave de desinstalacao continua no registro).'
    }
    if (-not (Wait-Until -TimeoutSeconds 5 -Condition { $second.HasExited })) {
        Fail 'A desinstalacao nao fechou o app.'
    }
    if (Test-Path $installDir) {
        $left = (Get-ChildItem -Path $installDir -Force | ForEach-Object { $_.Name }) -join ', '
        Fail "A pasta de instalacao continua la (sobrou: $left)."
    }
    foreach ($path in @($startMenu, $desktop)) {
        if (Test-Path $path) {
            Fail "Atalho nao removido: $path"
        }
    }
    if (Test-Path $appKey) {
        Fail 'HKCU\Software\Starsonic Phone nao foi removida.'
    }
    if ($null -ne (Get-RegistryValue -Key $runKey -Name 'Starsonic Phone')) {
        Fail 'O valor Starsonic Phone de HKCU\...\Run nao foi removido.'
    }
    if (-not (Test-Path $ini)) {
        Fail 'As configuracoes em %APPDATA%\Starsonic Phone deveriam ser mantidas.'
    }
    Write-Host 'OK: instalacao, atualizacao e desinstalacao silenciosas.'
} finally {
    # Nunca deixa o app instalado aberto: os testes seguintes iniciam outras copias, e o app so
    # aceita uma por usuario.
    foreach ($process in Get-InstalledApp) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
}
