# Teste de fumaca: o app abre, continua vivo por 8 s e fecha com /exit em ate 15 s.
# Uso: .\tests\smoke\Test-StartStop.ps1 -AppDir out
param(
    [string]$AppDir = 'out'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
. (Join-Path $PSScriptRoot 'Common.ps1')

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

if (-not (Stop-App -Exe $exe -Process $process -TimeoutSeconds 15)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw 'O app nao fechou em 15 s depois de /exit.'
}
Write-Host 'OK: o app abriu e fechou com /exit.'
