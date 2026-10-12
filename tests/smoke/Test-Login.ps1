# Teste de fumaca da tela Entrar contra o registrador SIP falso (tests\smoke\fake_registrar.py).
# Usa o build de CI (perfil tests\fixtures\servidores-ci.ini: "Servidor local (CI)" em 127.0.0.1:5060
# e "Servidor TLS (CI)" em 127.0.0.1:5071, onde o registrador falso responde texto puro).
# Depois de entrar: falha de TLS pela tela Entrar e conta adulterada no INI ativada pelo menu (E14).
# Uso: .\tests\smoke\Test-Login.ps1 -AppDir out-ci
param(
    [string]$AppDir = 'out-ci',
    [string]$Python = 'python'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot '..\..\build\BuildCommon.ps1')

# Ids de starsonic\win\StarsonicIds.h
$IDC_SS_SERVER = 41012
$IDC_SS_RAMAL = 41013
$IDC_SS_SENHA = 41014
$IDC_SS_MESSAGE = 41015
$IDC_SS_ENTRAR = 41016
# Ids de microsip\resource.h
$ID_ACCOUNT_ADD = 32771
$ID_ACCOUNT_CHANGE_RANGE = 40000
$IDC_STARSONIC_BAND = 41200
$IDCANCEL = 2

$copy = New-AppCopy -AppDir (Resolve-Path $AppDir).Path
$exe = Join-Path $copy 'StarsonicPhone.exe'
# A copia comeca sem contas: o INI so tem a secao [Global] de New-AppCopy.
$ini = Join-Path $copy 'StarsonicPhone.ini'
$userAgentLog = Join-Path $copy 'user-agent.txt'

$registrarInfo = New-Object System.Diagnostics.ProcessStartInfo
$registrarInfo.FileName = $Python
$registrarInfo.Arguments = "`"$(Join-Path $PSScriptRoot 'fake_registrar.py')`" --user 2001,2002 --password senha-certa --log `"$userAgentLog`" --not-tls-port 5071"
$registrarInfo.UseShellExecute = $false
$registrar = [System.Diagnostics.Process]::Start($registrarInfo)
$process = $null

function Fail([string]$message) {
    $lines = @($message)
    if ($process -and -not $process.HasExited) {
        $lines += @(Get-HangReport -ProcessId $process.Id -Label 'app' -SymbolDir $copy)
    }
    Write-CiError -Title 'Test-Login' -Lines $lines
    throw $message
}

try {
    Start-Sleep -Seconds 1
    if ($registrar.HasExited) {
        Fail "O registrador falso nao subiu (codigo $($registrar.ExitCode))."
    }
    $process = Start-App -Exe $exe
    $title = Get-Text @('Starsonic Phone ', 0x2014, ' Entrar')
    $login = Find-WindowByTitle -ProcessId $process.Id -Title $title -TimeoutSeconds 20
    if (-not $login) {
        Fail "A tela Entrar nao abriu."
    }
    $dialog = $login.Handle

    $server = Get-ControlText -Dialog $dialog -Id $IDC_SS_SERVER
    if ($server -ne 'Servidor local (CI)') {
        Fail "Servidor selecionado: '$server' (esperado 'Servidor local (CI)')."
    }

    # Ramal com dominio e recusado na hora.
    Set-ControlText -Dialog $dialog -Id $IDC_SS_RAMAL -Text '2001@x'
    Set-ControlText -Dialog $dialog -Id $IDC_SS_SENHA -Text 'qualquer'
    Invoke-DialogButton -Dialog $dialog -Id $IDC_SS_ENTRAR
    $expected = Get-Text @('Digite s', 0x00F3, ' o n', 0x00FA, 'mero do ramal.')
    if (-not (Wait-Until -TimeoutSeconds 5 -Condition { (Get-ControlText -Dialog $dialog -Id $IDC_SS_MESSAGE) -eq $expected })) {
        Fail "Mensagem para ramal invalido: '$(Get-ControlText -Dialog $dialog -Id $IDC_SS_MESSAGE)'."
    }

    # Senha errada: o servidor responde 403.
    Set-ControlText -Dialog $dialog -Id $IDC_SS_RAMAL -Text '2001'
    Set-ControlText -Dialog $dialog -Id $IDC_SS_SENHA -Text 'errada'
    Invoke-DialogButton -Dialog $dialog -Id $IDC_SS_ENTRAR
    if (-not (Wait-Until -TimeoutSeconds 20 -Condition { (Get-ControlText -Dialog $dialog -Id $IDC_SS_MESSAGE) -eq 'Ramal ou senha incorretos.' })) {
        Fail "Mensagem para senha errada: '$(Get-ControlText -Dialog $dialog -Id $IDC_SS_MESSAGE)'."
    }

    # Senha certa: registra e a tela fecha.
    Set-ControlText -Dialog $dialog -Id $IDC_SS_SENHA -Text 'senha-certa'
    Invoke-DialogButton -Dialog $dialog -Id $IDC_SS_ENTRAR
    if (-not (Wait-Until -TimeoutSeconds 20 -Condition { -not [StarsonicWin32]::IsWindowVisible($dialog) })) {
        Fail "A tela Entrar nao fechou depois da senha certa: '$(Get-ControlText -Dialog $dialog -Id $IDC_SS_MESSAGE)'."
    }

    $checks = @(
        @('Account1', 'username', '2001'),
        @('Account1', 'starsonicServer', 'local'),
        @('Account1', 'server', '127.0.0.1:5060')
    )
    foreach ($item in $checks) {
        $actual = Read-IniValue -Path $ini -Section $item[0] -Key $item[1]
        if ($actual -cne $item[2]) {
            Fail "[$($item[0])] $($item[1]) = '$actual' (esperado '$($item[2])')."
        }
    }
    $main = Find-WindowByClass -ProcessId $process.Id -ClassName 'Starsonic Phone' -TimeoutSeconds 5
    $band = [StarsonicWin32]::GetDlgItem($main.Handle, $IDC_STARSONIC_BAND)
    $bandOk = Wait-Until -TimeoutSeconds 10 -Condition {
        $text = [StarsonicWin32]::ControlText($band)
        return ($text.Contains('2001') -and $text.Contains('Servidor local (CI)'))
    }
    if (-not $bandOk) {
        Fail "Faixa da marca depois de entrar: '$([StarsonicWin32]::ControlText($band))'."
    }
    $userAgent = if (Test-Path $userAgentLog) { (Get-Content -Raw $userAgentLog).Trim() } else { '' }
    if ($userAgent -ne 'Starsonic Phone/0.0.0') {
        Fail "User-Agent recebido pelo servidor: '$userAgent' (esperado 'Starsonic Phone/0.0.0')."
    }

    # As duas partes seguintes sempre rodam; as falhas sao somadas no fim.
    $problems = @()

    # Servidor TLS que nao fala TLS: a tela Entrar mostra a falha de conexao segura (spec 11.1).
    if (-not (Invoke-MainMenuItem -MainWindow $main.Handle -Match { param($text, $id) $id -eq $ID_ACCOUNT_ADD })) {
        Fail ('Item "Adicionar Conta" nao apareceu no menu principal. Itens: ' + ($script:MenuItemsSeen -join ', '))
    }
    $login = Find-WindowByTitle -ProcessId $process.Id -Title $title -TimeoutSeconds 10
    if (-not $login) {
        Fail 'A tela Entrar nao abriu pelo menu Adicionar Conta.'
    }
    $dialog = $login.Handle
    [StarsonicWin32]::SelectComboItem([StarsonicWin32]::GetDlgItem($dialog, $IDC_SS_SERVER), 1)
    $server = Get-ControlText -Dialog $dialog -Id $IDC_SS_SERVER
    if ($server -ne 'Servidor TLS (CI)') {
        Fail "Servidor selecionado: '$server' (esperado 'Servidor TLS (CI)')."
    }
    Set-ControlText -Dialog $dialog -Id $IDC_SS_RAMAL -Text '2001'
    Set-ControlText -Dialog $dialog -Id $IDC_SS_SENHA -Text 'senha-certa'
    Invoke-DialogButton -Dialog $dialog -Id $IDC_SS_ENTRAR
    $tlsMessage = Get-Text @('N', 0x00E3, 'o foi poss', 0x00ED, 'vel estabelecer uma conex', 0x00E3, 'o segura com o servidor.')
    if (-not (Wait-Until -TimeoutSeconds 25 -Condition { (Get-ControlText -Dialog $dialog -Id $IDC_SS_MESSAGE) -eq $tlsMessage })) {
        $problems += "Mensagem para falha de TLS: '$(Get-ControlText -Dialog $dialog -Id $IDC_SS_MESSAGE)'."
    }
    Invoke-DialogButton -Dialog $dialog -Id $IDCANCEL
    if (-not (Wait-Until -TimeoutSeconds 5 -Condition { -not [StarsonicWin32]::IsWindowVisible($dialog) })) {
        Fail 'A tela Entrar nao fechou depois da falha de TLS.'
    }

    # Conta adulterada no INI com o app aberto, ativada pelo menu: o perfil vale antes de registrar (E14).
    # Ramal 2002 (o registrador aceita 2001 e 2002 com a mesma senha): a faixa so mostra "2002" e
    # "Conectado" depois que a conta 2 registrar no servidor do perfil.
    $password = Read-IniValue -Path $ini -Section 'Account1' -Key 'password'
    Write-IniValue -Path $ini -Section 'Settings' -Key 'accountId' -Value '1'
    $tampered = @(
        @('label', 'adulterada'),
        @('server', 'evil.example:5060'),
        @('domain', 'evil.example'),
        @('username', '2002'),
        @('password', $password),
        @('rememberPassword', '1'),
        @('transport', 'tcp'),
        @('starsonicServer', 'local')
    )
    foreach ($pair in $tampered) {
        Write-IniValue -Path $ini -Section 'Account2' -Key $pair[0] -Value $pair[1]
    }
    $isAccount2 = { param($text, $id) $id -eq ($ID_ACCOUNT_CHANGE_RANGE + 1) }
    if (-not (Invoke-MainMenuItem -MainWindow $main.Handle -Match $isAccount2)) {
        Fail ('A conta 2 nao apareceu no menu principal. Itens: ' + ($script:MenuItemsSeen -join ', '))
    }
    if (-not (Wait-Until -TimeoutSeconds 10 -Condition { (Read-IniValue -Path $ini -Section 'Settings' -Key 'accountId') -eq '2' })) {
        Fail 'A troca para a conta 2 pelo menu nao aconteceu.'
    }
    $enforced = Wait-Until -TimeoutSeconds 25 -Condition {
        $text = [StarsonicWin32]::ControlText($band)
        return ($text.Contains('Conectado') -and $text.Contains('2002') -and $text.Contains('Servidor local (CI)'))
    }
    if (-not $enforced) {
        $problems += "Faixa depois de ativar a conta adulterada: '$([StarsonicWin32]::ControlText($band))' (esperado conectado ao servidor do perfil)."
    }
    if ($problems.Count -gt 0) {
        Fail ($problems -join ' | ')
    }

    if (-not (Stop-App -Exe $exe -Process $process -TimeoutSeconds 15)) {
        Fail ("O app nao fechou com /exit. " + ($script:StopAppDetails -join ' | '))
    }
    Write-Host 'OK: tela Entrar validou o ramal, mostrou os erros de senha e de TLS e registrou com a senha certa; conta adulterada ativada pelo menu registrou pelo perfil.'
} finally {
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    if (-not $registrar.HasExited) {
        Stop-Process -Id $registrar.Id -Force -ErrorAction SilentlyContinue
    }
}
