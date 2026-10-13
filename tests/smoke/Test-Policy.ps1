# Teste de fumaca: na inicializacao o app reaplica o perfil embutido (branding\perfil.ini: porta 5060,
# UDP) em todas as contas, mesmo com buraco na numeracao, mantendo o endereco de cada uma; esvazia a
# conta com endereco invalido e trava as globais. /reset respondido com "Nao" nao muda nada.
# Uso: .\tests\smoke\Test-Policy.ps1 -AppDir out
param(
    [string]$AppDir = 'out'
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
    'server=EVIL.example:5999',
    'domain=other.example',
    'username=2001',
    'transport=tcp',
    '[Account2]',
    'server=bad host:5060',
    'domain=x',
    'username=2002',
    # Sem [Account3]. A conta 4 e como a rc.1 gravava: com o id do servidor (starsonicServer).
    '[Account4]',
    'server=sip1.exemplo.invalid:5060',
    'domain=sip1.exemplo.invalid',
    'username=2004',
    'transport=tcp',
    'starsonicServer=sp1'
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

# Codecs do branding\perfil.ini.
$profileCodecs = 'G722/16000/1 PCMA/8000/1 PCMU/8000/1'
$expected = @(
    # O endereco fica (normalizado); porta, dominio, transporte e rotulo voltam ao perfil.
    @('Account1', 'server', 'evil.example:5060'),
    @('Account1', 'domain', 'evil.example'),
    @('Account1', 'transport', 'udp'),
    @('Account1', 'username', '2001'),
    @('Account1', 'label', (Get-Text @('2001 ', 0x00B7, ' evil.example'))),
    # Endereco invalido: conta esvaziada.
    @('Account2', 'username', ''),
    @('Account2', 'server', ''),
    # Sem [Account3]: a conta 4 tambem passa pelo perfil (o MicroSIP carrega qualquer numero), e a
    # chave antiga starsonicServer nao atrapalha.
    @('Account4', 'server', 'sip1.exemplo.invalid:5060'),
    @('Account4', 'transport', 'udp'),
    @('Account4', 'username', '2004'),
    @('Settings', 'audioCodecs', $profileCodecs),
    @('Settings', 'enableSTUN', '0'),
    @('Settings', 'updatesInterval', 'daily')
)
# As duas partes do teste sempre rodam; as falhas sao somadas no fim.
$problems = @()
$failures = @()
foreach ($item in $expected) {
    $actual = Read-IniValue -Path $ini -Section $item[0] -Key $item[1]
    if ($actual -cne $item[2]) {
        $failures += "[$($item[0])] $($item[1]) = '$actual' (esperado '$($item[2])')"
    }
}
if ($failures.Count -gt 0) {
    $problems += ("Politica nao aplicada: " + ($failures -join '; '))
} else {
    Write-Host 'OK: perfis e travas aplicados na inicializacao.'
}

# /reset respondido com "Nao": nada muda (o MicroSIP nem carrega as configuracoes nesse caso).
$IDNO = 7
Write-IniValue -Path $ini -Section 'Settings' -Key 'volumeRing' -Value '37'
$reset = Start-App -Exe $exe -Arguments '/reset'
try {
    $box = Find-WindowByClass -ProcessId $reset.Id -ClassName '#32770' -TimeoutSeconds 15
    if (-not $box) {
        throw 'A pergunta do /reset nao apareceu.'
    }
    Invoke-DialogButton -Dialog $box.Handle -Id $IDNO
    if (-not $reset.WaitForExit(15000)) {
        throw 'O app nao fechou depois de responder Nao ao /reset.'
    }
} finally {
    if (-not $reset.HasExited) {
        Stop-Process -Id $reset.Id -Force -ErrorAction SilentlyContinue
    }
}
$kept = @(
    @('Settings', 'volumeRing', '37'),
    @('Settings', 'audioCodecs', $profileCodecs),
    @('Settings', 'accountId', '1'),
    @('Account1', 'username', '2001')
)
$failures = @()
foreach ($item in $kept) {
    $actual = Read-IniValue -Path $ini -Section $item[0] -Key $item[1]
    if ($actual -cne $item[2]) {
        $failures += "[$($item[0])] $($item[1]) = '$actual' (esperado '$($item[2])')"
    }
}
if ($failures.Count -gt 0) {
    $problems += ("O /reset com Nao mudou as configuracoes: " + ($failures -join '; '))
} else {
    Write-Host 'OK: /reset respondido com Nao manteve as configuracoes.'
}
if ($problems.Count -gt 0) {
    Write-CiError -Title 'Test-Policy' -Lines $problems
    throw ($problems -join ' | ')
}
