# Teste de fumaca: o app abre, continua vivo por 8 s, mostra a janela principal com o titulo em ate 30 s e fecha com
# /exit em ate 15 s.
# Uso: .\tests\smoke\Test-StartStop.ps1 -AppDir out
param(
    [string]$AppDir = 'out'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot '..\..\build\BuildCommon.ps1')
trap {
    Write-CiError -Title 'Test-StartStop' -Lines @($_.Exception.Message)
    break
}

$copy = New-AppCopy -AppDir (Resolve-Path $AppDir).Path
$exe = Join-Path $copy 'StarsonicPhone.exe'
if (-not (Test-Path $exe)) {
    throw "StarsonicPhone.exe nao encontrado em $AppDir"
}

$process = Start-App -Exe $exe
Start-Sleep -Seconds 8
if ($process.HasExited) {
    throw "O app fechou sozinho (codigo $($process.ExitCode))."
}
Write-Host 'O app continua aberto depois de 8 s.'

# A janela principal existe antes de ter o titulo: o app cria a janela e so no fim da abertura da o titulo a ela.
# Numa maquina lenta, na primeira abertura, o titulo ainda esta vazio aos 8 s: foi assim nas maquinas novas do GitHub
# (a imagem windows-2022 20261116.370), em 19/11/2026. O teste espera o titulo chegar, em vez de le-lo uma vez so, e
# diz quanto esperou; se ele nao chega, a falha leva as janelas que o processo tinha.
$titleTimeout = 30
$holder = @{ Window = $null; Seen = '' }
$waitStart = Get-Date
$found = Wait-Until -TimeoutSeconds $titleTimeout -Condition {
    $all = @(Get-TopLevelWindows -ProcessId $process.Id)
    $holder.Seen = ($all | ForEach-Object { "[$($_.ClassName)] '$($_.Title)'" }) -join ', '
    $holder.Window = $all |
        Where-Object { $_.ClassName -eq 'Starsonic Phone' -and $_.Title.StartsWith('Starsonic Phone') } |
        Select-Object -First 1
    return ($null -ne $holder.Window)
}
if (-not $found) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "A janela da classe 'Starsonic Phone' com o titulo comecando por 'Starsonic Phone' nao apareceu em $titleTimeout s. Janelas do processo: $($holder.Seen)"
}
$window = $holder.Window
$waited = [math]::Round(((Get-Date) - $waitStart).TotalSeconds, 1)
Write-Host "Janela principal: [$($window.ClassName)] '$($window.Title)' (o titulo chegou $waited s depois dos 8 s)"

if (-not (Stop-App -Exe $exe -Process $process -TimeoutSeconds 15)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    Write-CiError -Title 'Test-StartStop: janelas abertas' -Lines @($script:StopAppDetails)
    throw 'O app nao fechou em 15 s depois de /exit.'
}
Write-Host 'OK: o app abriu e fechou com /exit.'
