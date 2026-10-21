# Teste do instalador do app novo (Task 13): instala em silencio (/S) e confere os arquivos (o exe e a pasta ui\), o
# atalho, o registro e os links tel:/sip:/callto:; roda o mesmo instalador com o app aberto (como na atualizacao: o
# app fecha pelo --sair e reabre com outro PID); desinstala em silencio e confere o que sai (tambem a pasta do
# WebView2) e o que fica (os dados). Depois, a instalacao pela tela (a pagina do canvas, com as capturas
# instalador.png e instalador-fim.png): as duas opcoes marcadas gravam o atalho e o Run com --bandeja; por cima, as
# opcoes vem como estao, e desmarcar o "Iniciar com o Windows" tira o Run. Desinstala no fim.
# Instala no perfil do usuario atual (feito para o CI). Uso:
#   .\tests\smoke\Test-Installer.ps1 -Setup dist\StarsonicPhone-0.0.0-setup.exe -AppDir out-novo -Version 0.0.0
#                                    [-Capturas capturas-windows]
param(
    [Parameter(Mandatory = $true)][string]$Setup,
    [Parameter(Mandatory = $true)][string]$AppDir,
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$Capturas = 'capturas-windows',
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
$webviewData = Join-Path $installDir 'WebView2'
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Starsonic Phone.lnk'
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Starsonic Phone.lnk'
$appKey = 'HKCU:\Software\Starsonic Phone'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\StarsonicPhone'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$approvedKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
$classes = 'HKCU:\Software\Classes'
$runValue = "`"$exe`" --bandeja"
$linkCommand = "`"$exe`" `"%1`""

if ((Test-Path $appKey) -and -not $Force) {
    throw 'Ja existe uma instalacao do Starsonic Phone neste usuario; use -Force para testar mesmo assim.'
}
$Setup = (Resolve-Path $Setup).Path
$AppDir = (Resolve-Path $AppDir).Path
New-Item -ItemType Directory -Force -Path $Capturas | Out-Null
$Capturas = (Resolve-Path $Capturas).Path

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
        $lines += @(Get-WindowReport -ProcessId $process.Id | ForEach-Object { "app $($process.Id): $($_.Line)" })
    }
    $log = Join-Path $installDir 'instalador.log'
    if (Test-Path $log) {
        $lines += @(Get-Content -Path $log | ForEach-Object { "instalador.log: $_" })
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
    if (-not $process.WaitForExit(180000)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        Fail "$name $Arguments nao terminou em 180 s."
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

# Desinstala em silencio e confere o que sai e o que fica.
function Test-Uninstall([string]$Label) {
    Invoke-Setup -File $uninstaller -Arguments '/S'
    # O desinstalador do NSIS se copia para a pasta temporaria e continua de la: espera o fim.
    if (-not (Wait-Until -TimeoutSeconds 90 -Condition { -not (Test-Path $uninstallKey) })) {
        Fail "${Label}: a desinstalacao nao terminou em 90 s (a chave de desinstalacao continua no registro)."
    }
    if (Get-InstalledApp) {
        Fail "${Label}: a desinstalacao nao fechou o app."
    }
    if (Test-Path $installDir) {
        $left = (Get-ChildItem -Path $installDir -Force -Recurse | Select-Object -First 20 | ForEach-Object { $_.FullName.Substring($installDir.Length + 1) }) -join ', '
        Fail "${Label}: a pasta de instalacao continua la (sobrou: $left)."
    }
    foreach ($path in @($startMenu, $desktop)) {
        if (Test-Path $path) {
            Fail "${Label}: atalho nao removido: $path"
        }
    }
    if (Test-Path $appKey) {
        Fail "${Label}: HKCU\Software\Starsonic Phone nao foi removida."
    }
    foreach ($key in $runKey, $approvedKey) {
        if ($null -ne (Get-RegistryValue -Key $key -Name 'Starsonic Phone')) {
            Fail "${Label}: o valor Starsonic Phone de $key nao foi removido."
        }
    }
    foreach ($key in "$classes\StarsonicPhone.Link", "$classes\tel", "$classes\sip", "$classes\callto") {
        $command = Get-RegistryValue -Key "$key\shell\open\command" -Name '(default)'
        if ($command -eq $linkCommand) {
            Fail "${Label}: o link $key continua apontando para o app."
        }
    }
    if ($null -ne (Get-RegistryValue -Key 'HKCU:\Software\RegisteredApplications' -Name 'Starsonic Phone')) {
        Fail "${Label}: o Starsonic Phone continua em RegisteredApplications."
    }
    if (-not (Test-Path $marker)) {
        Fail "${Label}: os dados em %APPDATA%\Starsonic Phone deveriam ser mantidos."
    }
}

# A janela do instalador (NSIS) do processo, e o controle com a classe e o texto pedidos dentro dela.
function Wait-SetupControl([System.Diagnostics.Process]$Process, [string]$ClassName, [string]$Text, [int]$TimeoutSeconds = 60) {
    $holder = @{ Window = $null; Control = $null }
    Wait-Until -TimeoutSeconds $TimeoutSeconds -Condition {
        foreach ($window in @(Get-TopLevelWindows -ProcessId $Process.Id | Where-Object { [StarsonicWin32]::IsWindowVisible($_.Handle) })) {
            $control = Find-ChildWindow -Parent $window.Handle -ClassName $ClassName -Text $Text
            if ($control) {
                $holder.Window = $window.Handle
                $holder.Control = $control
                return $true
            }
        }
        return $false
    } | Out-Null
    return $holder
}

# A instalacao pela tela: confere as opcoes da primeira pagina, aplica $Desktop/$Startup, clica Instalar e, na pagina
# do fim, desmarca o "Abrir o Starsonic Phone" e clica Concluir. $Capture: o prefixo das capturas (vazio: nenhuma).
function Invoke-InteractiveSetup([int]$ExpectDesktop, [int]$ExpectStartup, [int]$Desktop, [int]$Startup, [string]$Capture) {
    $process = Start-Process -FilePath $Setup -PassThru
    try {
        $desktopText = Get-Text @('Atalho na ', 0x00E1, 'rea de trabalho')
        $page = Wait-SetupControl -Process $process -ClassName 'Button' -Text $desktopText
        if (-not $page.Control) {
            Fail 'A primeira pagina do instalador (com o Atalho na area de trabalho) nao apareceu.'
        }
        $startupBox = Find-ChildWindow -Parent $page.Window -ClassName 'Button' -Text 'Iniciar com o Windows'
        $title = Find-ChildWindow -Parent $page.Window -ClassName 'Static' -Text 'Instalar o Starsonic Phone'
        $installButton = [StarsonicWin32]::GetDlgItem($page.Window, 1)
        $buttonText = [StarsonicWin32]::ControlText($installButton) -replace '&', ''
        if (-not $startupBox -or -not $title -or $buttonText -ne 'Instalar') {
            Fail "A primeira pagina nao e a do canvas (Iniciar com o Windows: $([bool]$startupBox), titulo: $([bool]$title), botao: '$buttonText')."
        }
        Start-Sleep -Milliseconds 500
        if ($Capture) {
            Save-WindowCapture -Window $page.Window -Path (Join-Path $Capturas "$Capture.png")
        }
        $seen = @((Get-CheckState -Control $page.Control), (Get-CheckState -Control $startupBox))
        if ($seen[0] -ne $ExpectDesktop -or $seen[1] -ne $ExpectStartup) {
            Fail "As opcoes vieram como atalho=$($seen[0]) e iniciar=$($seen[1]) (esperado $ExpectDesktop e $ExpectStartup)."
        }
        Set-CheckState -Control $page.Control -State $Desktop
        Set-CheckState -Control $startupBox -State $Startup
        [StarsonicWin32]::ClickButton($page.Window, 1)

        $finish = Wait-SetupControl -Process $process -ClassName 'Button' -Text 'Abrir o Starsonic Phone' -TimeoutSeconds 120
        if (-not $finish.Control) {
            Fail 'A pagina do fim do instalador nao apareceu.'
        }
        Start-Sleep -Milliseconds 500
        if ($Capture) {
            Save-WindowCapture -Window $finish.Window -Path (Join-Path $Capturas "$Capture-fim.png")
        }
        Set-CheckState -Control $finish.Control -State 0
        [StarsonicWin32]::ClickButton($finish.Window, 1)
        if (-not $process.WaitForExit(30000)) {
            Fail 'O instalador nao fechou com o Concluir.'
        }
        if ($process.ExitCode -ne 0) {
            Fail "O instalador pela tela terminou com o codigo $($process.ExitCode)."
        }
    } finally {
        if (-not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

$marker = Join-Path $dataDir 'teste-instalador.txt'
try {
    # Os dados do usuario (as contas, os contatos...) ficam na desinstalacao: este arquivo tem de sobrar.
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
    Set-Content -Path $marker -Value 'fica' -Encoding Ascii
    $hadTel = Test-Path "$classes\tel"

    # 1. Primeira instalacao em silencio.
    Invoke-Setup -File $Setup -Arguments '/S'
    $expected = @('StarsonicPhone.exe', 'Uninstall.exe') + @(Get-ChildItem -Path (Join-Path $AppDir 'ui') -File -Recurse |
            ForEach-Object { 'ui\' + $_.FullName.Substring((Join-Path $AppDir 'ui').Length + 1) })
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
    if ($null -ne (Get-RegistryValue -Key $runKey -Name 'Starsonic Phone')) {
        Fail 'A instalacao silenciosa nao deveria gravar o Iniciar com o Windows.'
    }
    $registered = Get-RegistryValue -Key $appKey -Name '(default)'
    if ($registered -ne $installDir) {
        Fail "HKCU\Software\Starsonic Phone (Padrao) = '$registered'; esperado '$installDir'."
    }
    $displayVersion = Get-RegistryValue -Key $uninstallKey -Name 'DisplayVersion'
    if ($displayVersion -ne $Version) {
        Fail "DisplayVersion = '$displayVersion'; esperado '$Version'."
    }
    $quiet = Get-RegistryValue -Key $uninstallKey -Name 'QuietUninstallString'
    if ($quiet -ne "`"$uninstaller`" /S") {
        Fail "QuietUninstallString = '$quiet'."
    }
    # Os links: o ProgID e as Capabilities sempre; a chave do esquema quando nao havia outra.
    $progid = Get-RegistryValue -Key "$classes\StarsonicPhone.Link\shell\open\command" -Name '(default)'
    if ($progid -ne $linkCommand) {
        Fail "StarsonicPhone.Link abre '$progid' (esperado '$linkCommand')."
    }
    foreach ($scheme in 'tel', 'sip', 'callto') {
        $association = Get-RegistryValue -Key "$appKey\Capabilities\URLAssociations" -Name $scheme
        if ($association -ne 'StarsonicPhone.Link') {
            Fail "Capabilities\URLAssociations\$scheme = '$association'."
        }
    }
    if ((Get-RegistryValue -Key 'HKCU:\Software\RegisteredApplications' -Name 'Starsonic Phone') -ne 'Software\Starsonic Phone\Capabilities') {
        Fail 'O Starsonic Phone nao esta em RegisteredApplications.'
    }
    if (-not $hadTel) {
        $tel = Get-RegistryValue -Key "$classes\tel\shell\open\command" -Name '(default)'
        if ($tel -ne $linkCommand) {
            Fail "HKCU\Software\Classes\tel abre '$tel' (esperado '$linkCommand')."
        }
    }
    Write-Host "Instalado em $installDir ($($expected.Count) arquivos)."

    $first = Wait-InstalledApp
    if (-not $first) {
        Fail 'O instalador (/S) nao abriu o app ao terminar.'
    }
    Write-Host "App aberto pelo instalador: PID $($first.Id)."

    # 2. Atualizacao: o mesmo instalador com o app aberto fecha o app (--sair), troca os arquivos e o reabre.
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
    if (-not (Test-Path $webviewData)) {
        Fail "O app aberto nao criou a pasta do WebView2 ($webviewData): a desinstalacao nao seria testada."
    }
    Write-Host "App reaberto depois da atualizacao: PID $($second.Id)."

    # 3. Desinstalacao em silencio, com o app aberto, o Iniciar com o Windows ligado (como o app grava) e desligado
    # no Gerenciador de Tarefas: tudo sai, menos os dados.
    Set-ItemProperty -Path $runKey -Name 'Starsonic Phone' -Value $runValue
    New-Item -Path $approvedKey -Force | Out-Null
    New-ItemProperty -Path $approvedKey -Name 'Starsonic Phone' -PropertyType Binary -Value ([byte[]](3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)) -Force | Out-Null
    Test-Uninstall -Label 'desinstalacao silenciosa'
    Write-Host 'OK: instalacao, atualizacao e desinstalacao silenciosas.'

    # 4. Pela tela, numa instalacao nova: as duas opcoes vem marcadas e gravam o atalho e o Run.
    Invoke-InteractiveSetup -ExpectDesktop 1 -ExpectStartup 1 -Desktop 1 -Startup 1 -Capture 'instalador'
    if (-not (Test-Path $desktop)) {
        Fail 'O Atalho na area de trabalho marcado nao criou o atalho.'
    }
    $run = Get-RegistryValue -Key $runKey -Name 'Starsonic Phone'
    if ($run -ne $runValue) {
        Fail "O Iniciar com o Windows marcado gravou '$run' (esperado '$runValue')."
    }

    # 5. Pela tela, por cima: as opcoes vem como estao (as duas marcadas); desmarcar o Iniciar tira o Run.
    Invoke-InteractiveSetup -ExpectDesktop 1 -ExpectStartup 1 -Desktop 1 -Startup 0 -Capture ''
    if ($null -ne (Get-RegistryValue -Key $runKey -Name 'Starsonic Phone')) {
        Fail 'O Iniciar com o Windows desmarcado deixou o valor do Run.'
    }
    if (-not (Test-Path $desktop)) {
        Fail 'O atalho da area de trabalho saiu com a opcao marcada.'
    }
    foreach ($process in Get-InstalledApp) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    Test-Uninstall -Label 'desinstalacao depois da instalacao pela tela'
    Write-Host 'OK: a instalacao pela tela grava as opcoes, e por cima elas vem como estao.'
} finally {
    # Nunca deixa o app instalado aberto: os testes seguintes iniciam outras copias, e o app so aceita uma por
    # usuario.
    foreach ($process in Get-InstalledApp) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -Path $marker -Force -ErrorAction SilentlyContinue
}
