# Fumaca do app novo instalado (Task 13): instala o instalador em silencio (/S) numa pasta temporaria (/D=), roda o
# tests\smoke\windows_smoke.py no StarsonicPhone.exe instalado (CDP do WebView2, registrador falso, ligacoes, aviso
# e a escala de 150%) e desinstala em silencio. As capturas ficam em -Capturas.
# Usa as chaves de registro do usuario atual (feito para o CI): o Test-Installer.ps1 roda depois, com tudo desfeito.
# Uso: .\tests\smoke\Test-InstalledApp.ps1 -Setup dist\StarsonicPhone-0.0.0-setup.exe -Capturas capturas-windows
param(
    [Parameter(Mandatory = $true)][string]$Setup,
    [string]$Capturas = 'capturas-windows',
    [string]$Python = 'python'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot '..\..\build\BuildCommon.ps1')
trap {
    Write-CiError -Title 'Test-InstalledApp' -Lines @($_.Exception.Message)
    break
}

$Setup = (Resolve-Path $Setup).Path
# No CI, o RUNNER_TEMP (o %TEMP% do runner tem um nome curto, RUNNER~1, que o caminho dos processos nao usa).
$tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$installDir = Join-Path $tempRoot ('starsonic-instalado-' + [guid]::NewGuid().ToString('N'))
$exe = Join-Path $installDir 'StarsonicPhone.exe'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\StarsonicPhone'

function Stop-InstalledApp {
    foreach ($process in @(Get-Process -Name 'StarsonicPhone' -ErrorAction SilentlyContinue)) {
        $path = $null
        try { $path = $process.Path } catch { }
        if ($path -and $path.StartsWith($installDir, [System.StringComparison]::OrdinalIgnoreCase)) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

$failed = $null
try {
    # /D= vem por ultimo e sem aspas (regra do NSIS).
    $process = Start-Process -FilePath $Setup -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "O instalador terminou com o codigo $($process.ExitCode)."
    }
    if (-not (Test-Path $exe)) {
        throw "O instalador nao pos o StarsonicPhone.exe em $installDir."
    }
    Write-Host "Instalado em $installDir"
    Get-ChildItem -Path $installDir -Recurse -File | ForEach-Object { Write-Host ("  " + $_.FullName.Substring($installDir.Length + 1)) }

    # O windows_smoke.py fecha o app que o instalador abriu (--sair) e abre o dele, com o CDP.
    & $Python (Join-Path $PSScriptRoot 'windows_smoke.py') --exe $exe --capturas $Capturas --python $Python
    if ($LASTEXITCODE -ne 0) {
        $failed = "A fumaca do app instalado falhou (codigo $LASTEXITCODE)."
    }
} finally {
    Stop-InstalledApp
    $uninstaller = Join-Path $installDir 'Uninstall.exe'
    if (Test-Path $uninstaller) {
        Start-Process -FilePath $uninstaller -ArgumentList @('/S') -Wait | Out-Null
        # O desinstalador do NSIS se copia para a pasta temporaria e continua de la: espera o fim.
        if (-not (Wait-Until -TimeoutSeconds 60 -Condition { -not (Test-Path $uninstallKey) })) {
            Write-Warning 'A desinstalacao da fumaca nao terminou em 60 s.'
        }
    }
    Remove-Item -Path $installDir -Recurse -Force -ErrorAction SilentlyContinue
}
if ($failed) {
    throw $failed
}
Write-Host 'OK: o app novo instalado passou na fumaca pelo CDP.'
