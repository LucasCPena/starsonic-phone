# Ensaio da atualizacao da rc.7 para o app novo (Task 13, spec da W1 7.1): instala a v0.0.1-rc.7 do release do
# GitHub (o SHA-256 conferido pelo versao.json dela), entra na tela Entrar dela contra o registrador falso (o proprio
# codigo da rc.7 grava a conta e cifra a senha no StarsonicPhone.ini, pela rotina original), deixa um contato no
# Contacts.xml dela e o "Iniciar com o Windows" que ela grava (/minimized); com a rc.7 aberta, roda o instalador novo
# em silencio (/S, como o atualizador da rc.7 faz), e confere que o app novo abre "Conectado" no registrador falso
# com o contato (tests\smoke\windows_smoke.py --ensaio, pelo CDP), que os arquivos da rc.7 viraram .migrado, que os
# sons da rc.7 sairam da pasta e que o Run passou a --bandeja. No fim, desinstala.
# Instala no perfil do usuario atual (feito para o CI). Uso:
#   .\tests\smoke\Test-UpdateFromRc7.ps1 -Setup dist\StarsonicPhone-0.0.0-setup.exe -Capturas capturas-windows
param(
    [Parameter(Mandatory = $true)][string]$Setup,
    [string]$Capturas = 'capturas-windows',
    [string]$Python = 'python',
    [string]$Repository = $env:GITHUB_REPOSITORY,
    [string]$Rc7Tag = 'v0.0.1-rc.7'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot '..\..\build\BuildCommon.ps1')
trap {
    Write-CiError -Title 'Test-UpdateFromRc7' -Lines @($_.Exception.Message)
    break
}

# Ids de starsonic\win\StarsonicIds.h na v0.0.1-rc.7 (a tela Entrar e a faixa).
$IDC_SS_SERVER = 41012
$IDC_SS_RAMAL = 41013
$IDC_SS_SENHA = 41014
$IDC_SS_MESSAGE = 41015
$IDC_SS_ENTRAR = 41016
$IDC_STARSONIC_BAND = 41200
$ControlPort = 5070
$Contact = 'Ana Ensaio'

$Setup = (Resolve-Path $Setup).Path
$installDir = Join-Path $env:LOCALAPPDATA 'Starsonic Phone'
$exe = Join-Path $installDir 'StarsonicPhone.exe'
$dataDir = Join-Path $env:APPDATA 'Starsonic Phone'
$ini = Join-Path $dataDir 'StarsonicPhone.ini'
$appKey = 'HKCU:\Software\Starsonic Phone'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\StarsonicPhone'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$work = Join-Path ([System.IO.Path]::GetTempPath()) ('starsonic-ensaio-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work | Out-Null
if (-not $Repository) {
    throw 'Sem o repositorio do release (GITHUB_REPOSITORY ou -Repository).'
}
if (Test-Path $appKey) {
    throw 'Ja existe uma instalacao do Starsonic Phone neste usuario.'
}

function Get-InstalledApp {
    return @(Get-Process -Name 'StarsonicPhone' -ErrorAction SilentlyContinue | Where-Object {
            $path = $null
            try { $path = $_.Path } catch { }
            $path -eq $exe
        })
}

function Get-RegistryValue([string]$Key, [string]$Name) {
    $item = Get-ItemProperty -Path $Key -Name $Name -ErrorAction SilentlyContinue
    if ($null -eq $item) {
        return $null
    }
    return $item.$Name
}

# Roda o instalador e espera so ele (o Start-Process -Wait esperaria tambem o app que o /S reabre).
function Invoke-Setup([string]$File, [string]$Arguments) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $File
    $info.Arguments = $Arguments
    $info.UseShellExecute = $false
    $process = [System.Diagnostics.Process]::Start($info)
    if (-not $process.WaitForExit(180000)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw "$(Split-Path -Leaf $File) $Arguments nao terminou em 180 s."
    }
    if ($process.ExitCode -ne 0) {
        throw "$(Split-Path -Leaf $File) $Arguments terminou com o codigo $($process.ExitCode)."
    }
}

# Um comando na porta de controle do registrador falso (a primeira linha da resposta).
function Invoke-RegistrarCommand([int]$Port, [string]$Line) {
    $client = New-Object System.Net.Sockets.TcpClient('127.0.0.1', $Port)
    try {
        $stream = $client.GetStream()
        $writer = New-Object System.IO.StreamWriter($stream)
        $writer.NewLine = "`n"
        $writer.WriteLine($Line)
        $writer.Flush()
        $reader = New-Object System.IO.StreamReader($stream)
        return $reader.ReadLine()
    } finally {
        $client.Close()
    }
}

$registrar = $null
$failed = $null
try {
    # 1. A rc.7 do release, conferida pelo versao.json dela (a mesma conferencia do atualizador).
    $base = "https://github.com/$Repository/releases/download/$Rc7Tag"
    $version = $Rc7Tag.TrimStart('v')
    $rc7Setup = Join-Path $work "StarsonicPhone-$version-setup.exe"
    $previousProgress = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
        Invoke-WebRequest -Uri "$base/StarsonicPhone-$version-setup.exe" -OutFile $rc7Setup -UseBasicParsing
        $manifest = Invoke-RestMethod -Uri "$base/versao.json" -UseBasicParsing
    } finally {
        $ProgressPreference = $previousProgress
    }
    $hash = (Get-FileHash -Algorithm SHA256 -Path $rc7Setup).Hash.ToLowerInvariant()
    if ($manifest.versao -ne $version -or $hash -ne ([string]$manifest.sha256).ToLowerInvariant()) {
        throw "A rc.7 baixada nao confere com o versao.json dela (versao '$($manifest.versao)', sha256 $hash, esperado $($manifest.sha256))."
    }
    Write-Host "rc.7: $rc7Setup (sha256 $hash, conferido pelo versao.json)"

    # 2. A pasta de dados da rc.7 comeca so com a ultima verificacao de atualizacao agora (sem o aviso no meio) e um
    # contato no Contacts.xml, no formato do MicroSIP 3.22 (a rc.7 le e grava este arquivo).
    if (Test-Path $dataDir) {
        Remove-Item -Path $dataDir -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
    Write-IniFile -Path $ini -Lines @(Get-NoUpdateCheckIni)
    $contacts = @(
        '<?xml version="1.0"?>',
        '<contacts>',
        "<contact name=`"$Contact`" number=`"2005`" firstname=`"`" lastname=`"`" phone=`"`" mobile=`"`" email=`"`" address=`"`" city=`"`" state=`"`" zip=`"`" comment=`"ensaio`" id=`"`" info=`"`" presence=`"0`" starred=`"0`" directory=`"0`"/>",
        '</contacts>'
    )
    [System.IO.File]::WriteAllText((Join-Path $dataDir 'Contacts.xml'), (($contacts -join "`r`n") + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))

    $registrarInfo = New-Object System.Diagnostics.ProcessStartInfo
    $registrarInfo.FileName = $Python
    $registrarInfo.Arguments = "`"$(Join-Path $PSScriptRoot 'fake_registrar.py')`" --user 2001,2002 --password senha-certa --control-port $ControlPort"
    $registrarInfo.UseShellExecute = $false
    $registrar = [System.Diagnostics.Process]::Start($registrarInfo)
    Start-Sleep -Seconds 1
    if ($registrar.HasExited) {
        throw "O registrador falso nao subiu (codigo $($registrar.ExitCode))."
    }

    # 3. A rc.7 instalada em silencio abre sozinha, na tela Entrar (sem conta). A conta entra pela tela dela.
    Invoke-Setup -File $rc7Setup -Arguments '/S'
    $holder = @{ Process = $null }
    Wait-Until -TimeoutSeconds 30 -Condition {
        $holder.Process = Get-InstalledApp | Select-Object -First 1
        return ($null -ne $holder.Process)
    } | Out-Null
    $rc7 = $holder.Process
    if (-not $rc7) {
        throw 'A rc.7 nao abriu depois da instalacao.'
    }
    $title = Get-Text @('Starsonic Phone ', 0x2014, ' Entrar')
    $login = Find-WindowByTitle -ProcessId $rc7.Id -Title $title -TimeoutSeconds 30
    if (-not $login) {
        throw 'A tela Entrar da rc.7 nao abriu.'
    }
    Set-ControlText -Dialog $login.Handle -Id $IDC_SS_SERVER -Text '127.0.0.1'
    Set-ControlText -Dialog $login.Handle -Id $IDC_SS_RAMAL -Text '2001'
    Set-ControlText -Dialog $login.Handle -Id $IDC_SS_SENHA -Text 'senha-certa'
    Invoke-DialogButton -Dialog $login.Handle -Id $IDC_SS_ENTRAR
    if (-not (Wait-Until -TimeoutSeconds 30 -Condition { -not [StarsonicWin32]::IsWindowVisible($login.Handle) })) {
        throw "A tela Entrar da rc.7 nao fechou: '$(Get-ControlText -Dialog $login.Handle -Id $IDC_SS_MESSAGE)'."
    }
    $main = Find-WindowByClass -ProcessId $rc7.Id -ClassName 'Starsonic Phone' -TimeoutSeconds 10
    $band = [StarsonicWin32]::GetDlgItem($main.Handle, $IDC_STARSONIC_BAND)
    if (-not (Wait-Until -TimeoutSeconds 20 -Condition { ([StarsonicWin32]::ControlText($band)).Contains('Conectado') })) {
        throw "A rc.7 nao conectou: '$([StarsonicWin32]::ControlText($band))'."
    }
    $password = Read-IniValue -Path $ini -Section 'Account1' -Key 'password'
    $username = Read-IniValue -Path $ini -Section 'Account1' -Key 'username'
    if ($username -ne '2001' -or -not $password -or $password -eq 'senha-certa') {
        throw "A rc.7 nao gravou a conta com a senha cifrada (ramal '$username', senha com $($password.Length) caracteres)."
    }
    Write-Host "rc.7 conectada: [Account1] 2001 @ $(Read-IniValue -Path $ini -Section 'Account1' -Key 'server'), senha cifrada pela rc.7 ($($password.Length) caracteres)."
    Save-WindowCapture -Window $main.Handle -Path (Join-Path $Capturas 'ensaio-rc7.png')
    # Os REGISTER da rc.7 no registrador falso: o app novo tem de mandar outro.
    $registersBefore = [int](Invoke-RegistrarCommand -Port $ControlPort -Line 'REGISTERS 2001')
    # O "Iniciar com o Windows" que a rc.7 grava (o app novo o refaz com --bandeja na abertura).
    Set-ItemProperty -Path $runKey -Name 'Starsonic Phone' -Value "`"$exe`" /minimized"
    $sounds = @(Get-ChildItem -Path $installDir -Filter '*.wav' | ForEach-Object { $_.Name })
    Write-Host "rc.7 instalada com $($sounds.Count) sons: $($sounds -join ', ')"

    # 4. O instalador novo por cima, em silencio, com a rc.7 aberta (como o atualizador da rc.7 faz). O app que ele
    # reabre herda a variavel do CDP do WebView2.
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9333 --autoplay-policy=no-user-gesture-required'
    try {
        Invoke-Setup -File $Setup -Arguments '/S'
    } finally {
        Remove-Item Env:\WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
    }
    if (-not (Wait-Until -TimeoutSeconds 10 -Condition { $rc7.HasExited })) {
        throw 'A rc.7 continua aberta depois do instalador novo.'
    }
    if (-not (Test-Path (Join-Path $installDir 'ui\index.html'))) {
        throw 'O instalador novo nao pos a pasta ui.'
    }
    $left = @(Get-ChildItem -Path $installDir -File | Where-Object { $_.Extension -eq '.wav' -or $_.Name -like 'langpack_*' })
    if ($left.Count -gt 0) {
        throw "Sobrou da rc.7: $(($left | ForEach-Object { $_.Name }) -join ', ')"
    }

    & $Python (Join-Path $PSScriptRoot 'windows_smoke.py') --ensaio --exe $exe --controle $ControlPort --contato $Contact --registros-antes $registersBefore --capturas $Capturas
    if ($LASTEXITCODE -ne 0) {
        throw "O app novo nao abriu conectado com o contato da rc.7 (codigo $LASTEXITCODE)."
    }
    foreach ($name in 'StarsonicPhone.ini.migrado', 'Contacts.xml.migrado', 'contas.json', 'contatos.json') {
        if (-not (Test-Path (Join-Path $dataDir $name))) {
            throw "Depois da migracao, falta $name em $dataDir (tem: $((Get-ChildItem -Path $dataDir | ForEach-Object { $_.Name }) -join ', '))."
        }
    }
    $run = Get-RegistryValue -Key $runKey -Name 'Starsonic Phone'
    if ($run -ne "`"$exe`" --bandeja") {
        throw "O Run depois da atualizacao: '$run' (esperado '`"$exe`" --bandeja')."
    }
    Write-Host 'OK: a rc.7 com conta e contato atualizou para o app novo, que abriu Conectado com o contato.'
} catch {
    $failed = $_.Exception.Message
} finally {
    foreach ($process in Get-InstalledApp) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    if ($registrar -and -not $registrar.HasExited) {
        Stop-Process -Id $registrar.Id -Force -ErrorAction SilentlyContinue
    }
    $log = Join-Path $installDir 'instalador.log'
    if (Test-Path $log) {
        Write-Host '--- instalador.log ---'
        Get-Content -Path $log | ForEach-Object { Write-Host $_ }
    }
    $uninstaller = Join-Path $installDir 'Uninstall.exe'
    if (Test-Path $uninstaller) {
        try {
            Invoke-Setup -File $uninstaller -Arguments '/S'
        } catch {
            Write-Warning $_.Exception.Message
        }
        Wait-Until -TimeoutSeconds 60 -Condition { -not (Test-Path $uninstallKey) } | Out-Null
    }
    Remove-Item -Path $work -Recurse -Force -ErrorAction SilentlyContinue
}
if ($failed) {
    Write-CiError -Title 'Test-UpdateFromRc7' -Lines @($failed)
    throw $failed
}
