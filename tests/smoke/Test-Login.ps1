# Teste de fumaca da tela Entrar contra o registrador SIP falso (tests\smoke\fake_registrar.py), no
# build normal: o endereco do servidor (127.0.0.1) e digitado, e a porta (5060) e o transporte (UDP)
# vem do perfil embutido (branding\perfil.ini). Depois de entrar: Editar mostra o endereco da conta,
# e uma conta adulterada no INI, ativada pelo menu, registra pelo perfil (E14).
# Se o perfil mudar de porta ou de transporte, ajuste as fases 6 e 8; o registrador falso so fala UDP.
# Uso: .\tests\smoke\Test-Login.ps1 -AppDir out [-Version 0.0.0]   (versao com que o app foi compilado)
param(
    [string]$AppDir = 'out',
    [string]$Version = '0.0.0',
    [string]$Python = 'python'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot '..\..\build\BuildCommon.ps1')
trap {
    Write-CiError -Title 'Test-Login' -Lines @($_.Exception.Message, $_.InvocationInfo.PositionMessage)
    break
}

# Ids de starsonic\win\StarsonicIds.h
$IDC_SS_SERVER = 41012
$IDC_SS_RAMAL = 41013
$IDC_SS_SENHA = 41014
$IDC_SS_MESSAGE = 41015
$IDC_SS_ENTRAR = 41016
$IDC_SS_SERVER_LABEL = 41019
$IDC_STARSONIC_BAND = 41200
# Ids de microsip\resource.h
$ID_ACCOUNT_CHANGE_RANGE = 40000
$ID_ACCOUNT_EDIT_RANGE = 40100
$IDCANCEL = 2

$copy = New-AppCopy -AppDir (Resolve-Path $AppDir).Path
$exe = Join-Path $copy 'StarsonicPhone.exe'
# A copia comeca sem contas: o INI so tem a secao [Global] de New-AppCopy.
$ini = Join-Path $copy 'StarsonicPhone.ini'
$userAgentLog = Join-Path $copy 'user-agent.txt'

$registrarInfo = New-Object System.Diagnostics.ProcessStartInfo
$registrarInfo.FileName = $Python
$registrarInfo.Arguments = "`"$(Join-Path $PSScriptRoot 'fake_registrar.py')`" --user 2001,2002 --password senha-certa --log `"$userAgentLog`""
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

# Preenche servidor, ramal e senha, clica Entrar e espera a mensagem pedida na tela.
function Test-LoginMessage {
    param(
        [IntPtr]$Dialog,
        [AllowEmptyString()][string]$Server,
        [string]$Ramal,
        [string]$Senha,
        [string]$Expected,
        [int]$TimeoutSeconds = 5
    )
    Set-ControlText -Dialog $Dialog -Id $IDC_SS_SERVER -Text $Server
    Set-ControlText -Dialog $Dialog -Id $IDC_SS_RAMAL -Text $Ramal
    Set-ControlText -Dialog $Dialog -Id $IDC_SS_SENHA -Text $Senha
    Invoke-DialogButton -Dialog $Dialog -Id $IDC_SS_ENTRAR
    return (Wait-Until -TimeoutSeconds $TimeoutSeconds -Condition { (Get-ControlText -Dialog $Dialog -Id $IDC_SS_MESSAGE) -eq $Expected })
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

    # 1. Primeiro acesso: campo Servidor vazio, com o rotulo do endereco.
    $server = Get-ControlText -Dialog $dialog -Id $IDC_SS_SERVER
    if ($server -ne '') {
        Fail "Campo Servidor no primeiro acesso: '$server' (esperado vazio)."
    }
    $label = Get-ControlText -Dialog $dialog -Id $IDC_SS_SERVER_LABEL
    $expectedLabel = Get-Text @('Servidor (endere', 0x00E7, 'o ou IP)')
    if ($label -ne $expectedLabel) {
        Fail "Rotulo do campo Servidor: '$label' (esperado '$expectedLabel')."
    }

    # 2. Servidor vazio.
    $emptyServer = Get-Text @('Digite o endere', 0x00E7, 'o do servidor.')
    if (-not (Test-LoginMessage -Dialog $dialog -Server '' -Ramal '2001' -Senha 'qualquer' -Expected $emptyServer)) {
        Fail "Mensagem para servidor vazio: '$(Get-ControlText -Dialog $dialog -Id $IDC_SS_MESSAGE)'."
    }

    # 3. Servidor com porta.
    $badServer = Get-Text @('Digite s', 0x00F3, ' o endere', 0x00E7, 'o do servidor, como starcloud1-starsonic.com.br.')
    if (-not (Test-LoginMessage -Dialog $dialog -Server '127.0.0.1:5060' -Ramal '2001' -Senha 'qualquer' -Expected $badServer)) {
        Fail "Mensagem para servidor com porta: '$(Get-ControlText -Dialog $dialog -Id $IDC_SS_MESSAGE)'."
    }

    # 4. Ramal com dominio (o servidor, com espacos nas pontas, ja passa).
    $badRamal = Get-Text @('Digite s', 0x00F3, ' o n', 0x00FA, 'mero do ramal.')
    if (-not (Test-LoginMessage -Dialog $dialog -Server ' 127.0.0.1 ' -Ramal '2001@x' -Senha 'qualquer' -Expected $badRamal)) {
        Fail "Mensagem para ramal invalido: '$(Get-ControlText -Dialog $dialog -Id $IDC_SS_MESSAGE)'."
    }

    # 5. Senha errada: o servidor responde 403.
    if (-not (Test-LoginMessage -Dialog $dialog -Server ' 127.0.0.1 ' -Ramal '2001' -Senha 'errada' -Expected 'Ramal ou senha incorretos.' -TimeoutSeconds 20)) {
        Fail "Mensagem para senha errada: '$(Get-ControlText -Dialog $dialog -Id $IDC_SS_MESSAGE)'."
    }

    # 6. Senha certa: registra e a tela fecha.
    Set-ControlText -Dialog $dialog -Id $IDC_SS_SENHA -Text 'senha-certa'
    Invoke-DialogButton -Dialog $dialog -Id $IDC_SS_ENTRAR
    if (-not (Wait-Until -TimeoutSeconds 20 -Condition { -not [StarsonicWin32]::IsWindowVisible($dialog) })) {
        Fail "A tela Entrar nao fechou depois da senha certa: '$(Get-ControlText -Dialog $dialog -Id $IDC_SS_MESSAGE)'."
    }
    $checks = @(
        @('Account1', 'username', '2001'),
        @('Account1', 'server', '127.0.0.1:5060'),
        @('Account1', 'domain', '127.0.0.1'),
        @('Account1', 'transport', 'udp'),
        @('Account1', 'starsonicServer', '')
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
        return ($text.Contains('2001') -and $text.Contains('127.0.0.1'))
    }
    if (-not $bandOk) {
        Fail "Faixa da marca depois de entrar: '$([StarsonicWin32]::ControlText($band))'."
    }
    $userAgent = if (Test-Path $userAgentLog) { (Get-Content -Raw $userAgentLog).Trim() } else { '' }
    if ($userAgent -ne "Starsonic Phone/$Version") {
        Fail "User-Agent recebido pelo servidor: '$userAgent' (esperado 'Starsonic Phone/$Version')."
    }

    # As duas partes seguintes sempre rodam; as falhas sao somadas no fim.
    $problems = @()

    # 7. Editar: a tela Entrar abre com o endereco da conta (sem a porta) e o ramal.
    $isEdit = { param($text, $id) $id -eq $ID_ACCOUNT_EDIT_RANGE }
    if (-not (Invoke-MainMenuItem -MainWindow $main.Handle -Match $isEdit)) {
        $problems += ('Item "Editar Conta" nao apareceu no menu principal. Itens: ' + ($script:MenuItemsSeen -join ', '))
    } else {
        $edit = Find-WindowByTitle -ProcessId $process.Id -Title $title -TimeoutSeconds 10
        if (-not $edit) {
            $problems += 'A tela Entrar nao abriu pelo menu Editar Conta.'
        } else {
            $editServer = Get-ControlText -Dialog $edit.Handle -Id $IDC_SS_SERVER
            $editRamal = Get-ControlText -Dialog $edit.Handle -Id $IDC_SS_RAMAL
            if ($editServer -cne '127.0.0.1' -or $editRamal -cne '2001') {
                $problems += "Editar Conta mostrou servidor '$editServer' e ramal '$editRamal' (esperado '127.0.0.1' e '2001')."
            }
            Invoke-DialogButton -Dialog $edit.Handle -Id $IDCANCEL
            if (-not (Wait-Until -TimeoutSeconds 5 -Condition { -not [StarsonicWin32]::IsWindowVisible($edit.Handle) })) {
                Fail 'A tela Entrar aberta por Editar Conta nao fechou com Cancelar.'
            }
        }
    }

    # 8. Conta adulterada no INI com o app aberto, ativada pelo menu: o perfil vale antes de
    # registrar (E14). Porta e transporte errados; o registrador aceita 2001 e 2002 com a mesma
    # senha. A faixa so mostra "2002" e "Conectado" depois que a conta 2 registrar por UDP na 5060.
    $password = Read-IniValue -Path $ini -Section 'Account1' -Key 'password'
    Write-IniValue -Path $ini -Section 'Settings' -Key 'accountId' -Value '1'
    $tampered = @(
        @('label', 'adulterada'),
        @('server', '127.0.0.1:5999'),
        @('domain', 'evil.example'),
        @('username', '2002'),
        @('password', $password),
        @('rememberPassword', '1'),
        @('transport', 'tcp')
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
        return ($text.Contains('Conectado') -and $text.Contains('2002') -and $text.Contains('127.0.0.1'))
    }
    if (-not $enforced) {
        $problems += "Faixa depois de ativar a conta adulterada: '$([StarsonicWin32]::ControlText($band))' (esperado conectado pelo perfil)."
    }
    if ($problems.Count -gt 0) {
        Fail ($problems -join ' | ')
    }

    if (-not (Stop-App -Exe $exe -Process $process -TimeoutSeconds 15)) {
        Fail ("O app nao fechou com /exit. " + ($script:StopAppDetails -join ' | '))
    }
    Write-Host 'OK: tela Entrar validou servidor e ramal, mostrou o erro de senha e registrou com a senha certa; Editar mostrou o endereco; conta adulterada ativada pelo menu registrou pelo perfil.'
} finally {
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    if (-not $registrar.HasExited) {
        Stop-Process -Id $registrar.Id -Force -ErrorAction SilentlyContinue
    }
}
