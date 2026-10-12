# Teste de fumaca: na inicializacao o app reaplica os perfis embutidos nas contas e trava as globais.
# Usa o build de CI (perfil tests\fixtures\servidores-ci.ini, servidor "local" em 127.0.0.1:5060).
# Uso: .\tests\smoke\Test-Policy.ps1 -AppDir out-ci
param(
    [string]$AppDir = 'out-ci'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot '..\..\build\BuildCommon.ps1')
trap {
    Write-CiError -Title 'Test-Policy' -Lines @($_.Exception.Message)
    break
}

$copy = New-AppCopy -AppDir (Resolve-Path $AppDir).Path
$exe = Join-Path $copy 'StarsonicPhone.exe'
$ini = Join-Path $copy 'StarsonicPhone.ini'
Write-IniFile -Path $ini -Lines (@(Get-NoUpdateCheckIni) + @(
    '[Settings]',
    'accountId=1',
    'audioCodecs=G729/8000/1',
    'STUN=evil.example',
    'enableSTUN=1',
    '[Account1]',
    'label=adulterada',
    'server=evil.example:5060',
    'domain=evil.example',
    'username=2001',
    'transport=tcp',
    'starsonicServer=local',
    '[Account2]',
    'server=x:5060',
    'domain=x',
    'username=2002'
))

$process = Start-App -Exe $exe
Start-Sleep -Seconds 5
if ($process.HasExited) {
    throw "O app fechou sozinho (codigo $($process.ExitCode))."
}
if (-not (Stop-App -Exe $exe -Process $process -TimeoutSeconds 15)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    Write-CiError -Title 'Test-Policy: janelas abertas' -Lines @($script:StopAppDetails)
    throw 'O app nao fechou em 15 s depois de /exit.'
}

$expected = @(
    @('Account1', 'server', '127.0.0.1:5060'),
    @('Account1', 'transport', 'udp'),
    @('Account1', 'username', '2001'),
    @('Account2', 'username', ''),
    @('Settings', 'audioCodecs', 'PCMA/8000/1 PCMU/8000/1'),
    @('Settings', 'enableSTUN', '0'),
    @('Settings', 'updatesInterval', 'daily')
)
$failures = @()
foreach ($item in $expected) {
    $actual = Read-IniValue -Path $ini -Section $item[0] -Key $item[1]
    if ($actual -cne $item[2]) {
        $failures += "[$($item[0])] $($item[1]) = '$actual' (esperado '$($item[2])')"
    }
}
if ($failures.Count -gt 0) {
    throw ("Politica nao aplicada: " + ($failures -join '; '))
}
Write-Host 'OK: perfis e travas aplicados na inicializacao.'
