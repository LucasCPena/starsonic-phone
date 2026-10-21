# Teste de fumaca do app novo (windows/app, Tasks 11 e 12): o "StarsonicPhone.exe --dados <pasta nova>" abre a janela
# de classe "Starsonic Phone" com o WebView2; em ate 30 s a interface carrega e manda o ready (o diagnostico.log tem a
# linha "interface pronta"); uma segunda abertura com um link ("StarsonicPhone.exe tel:2003") entrega o link ao app
# aberto (instancia unica: o diagnostico.log tem "link recebido") e sai com o codigo 0; o "StarsonicPhone.exe
# --sair" manda o Sair para o app aberto (pela mesma instancia unica), que fecha em ate 15 s; e, aberto de novo, o
# logoff do Windows (WM_QUERYENDSESSION e WM_ENDSESSION) faz o mesmo Sair e o app fecha.
# O diagnostico.log vai inteiro para o log do CI (com os nomes do som do motor e os rotulos do WebView2).
# Uso: .\tests\smoke\Test-WindowsApp.ps1 -AppDir out-novo
param(
    [string]$AppDir = 'out-novo'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot '..\..\build\BuildCommon.ps1')
trap {
    Write-CiError -Title 'Test-WindowsApp' -Lines @($_.Exception.Message)
    break
}

$AppDir = (Resolve-Path $AppDir).Path
$exe = Join-Path $AppDir 'StarsonicPhone.exe'
foreach ($file in $exe, (Join-Path $AppDir 'ui\index.html')) {
    if (-not (Test-Path $file)) {
        throw "Arquivo do app ausente: $file"
    }
}

# O diagnostico.log com o app aberto (ele grava com o compartilhamento de leitura).
function Read-Log {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path $Path)) {
        return ''
    }
    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
    try {
        $reader = New-Object System.IO.StreamReader($stream, (New-Object System.Text.UTF8Encoding($false)))
        return $reader.ReadToEnd()
    } finally {
        $stream.Dispose()
    }
}

function Show-Log {
    param([Parameter(Mandatory = $true)][string]$Path)
    Write-Host '--- diagnostico.log ---'
    Write-Host (Read-Log -Path $Path)
    Write-Host '--- fim do diagnostico.log ---'
}

# A pasta do WebView2 do app (%LOCALAPPDATA%\Starsonic Phone\WebView2) e a mesma da instalacao do app antigo: a que
# este teste cria sai no fim (o Test-Installer.ps1, depois, confere que a desinstalacao nao deixa nada nela).
$appLocal = Join-Path $env:LOCALAPPDATA 'Starsonic Phone'
$webviewData = Join-Path $appLocal 'WebView2'
$hadAppLocal = Test-Path $appLocal
$hadWebviewData = Test-Path $webviewData

function Remove-WebViewData {
    if ($hadWebviewData) {
        return
    }
    # Os processos do WebView2 saem logo depois do app; ate la, os arquivos ficam presos.
    $removed = Wait-Until -TimeoutSeconds 20 -IntervalMilliseconds 500 -Condition {
        if (Test-Path $webviewData) {
            Remove-Item -Path $webviewData -Recurse -Force -ErrorAction SilentlyContinue
        }
        return -not (Test-Path $webviewData)
    }
    if (-not $removed) {
        Write-Warning "A pasta $webviewData nao saiu."
    } elseif (-not $hadAppLocal -and (Test-Path $appLocal) -and -not (Get-ChildItem -Path $appLocal -Force)) {
        Remove-Item -Path $appLocal -Force -ErrorAction SilentlyContinue
    }
}

$data = Join-Path ([System.IO.Path]::GetTempPath()) ('starsonic-novo-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $data | Out-Null
$log = Join-Path $data 'diagnostico.log'

$process = Start-App -Exe $exe -Arguments "--dados `"$data`""
$failures = New-Object System.Collections.Generic.List[string]
try {
    # 30 s: a primeira abertura do WebView2 no runner (o perfil frio) ja levou ~14 s.
    $ready = Wait-Until -TimeoutSeconds 30 -Condition {
        $process.HasExited -or ((Read-Log -Path $log).Contains('interface pronta'))
    }
    if ($process.HasExited) {
        $failures.Add("O app fechou sozinho (codigo $($process.ExitCode)).")
    } elseif (-not $ready -or -not (Read-Log -Path $log).Contains('interface pronta')) {
        $failures.Add("O diagnostico.log nao tem 'interface pronta' depois de 30 s.")
    } else {
        Write-Host 'A interface carregou (interface pronta).'
    }

    if (-not $process.HasExited) {
        $window = Get-TopLevelWindows -ProcessId $process.Id | Where-Object { $_.ClassName -eq 'Starsonic Phone' } |
            Select-Object -First 1
        if (-not $window) {
            $seen = (Get-TopLevelWindows -ProcessId $process.Id | ForEach-Object { "[$($_.ClassName)] '$($_.Title)'" }) -join ', '
            $failures.Add("Janela com a classe 'Starsonic Phone' nao encontrada. Janelas do processo: $seen")
        } else {
            $rect = New-Object 'StarsonicWin32+RECT'
            [StarsonicWin32]::GetWindowRect($window.Handle, [ref]$rect) | Out-Null
            $visible = [StarsonicWin32]::IsWindowVisible($window.Handle)
            Write-Host ("Janela: [{0}] '{1}', visivel={2}, {3}x{4} em ({5},{6})" -f $window.ClassName, $window.Title, $visible,
                ($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top), $rect.Left, $rect.Top)
            if (-not $visible) {
                $failures.Add('A janela principal nao esta visivel.')
            }
        }
        # Os rotulos das saidas de som do WebView2 chegam logo depois do ready (so para o relatorio).
        Wait-Until -TimeoutSeconds 5 -Condition { (Read-Log -Path $log).Contains('webview saidas de som') } | Out-Null
    }

    # Um link tel: com o app aberto: a segunda abertura entrega o numero ao app aberto e sai com o codigo 0.
    if (-not $process.HasExited) {
        $second = Start-App -Exe $exe -Arguments 'tel:2003'
        $secondExited = $second.WaitForExit(15000)
        $secondCode = if ($secondExited) { $second.ExitCode } else { 'ainda rodando' }
        if (-not $secondExited) {
            Stop-Process -Id $second.Id -Force -ErrorAction SilentlyContinue
        }
        if ($secondCode -ne 0) {
            $failures.Add("A segunda abertura (tel:2003) terminou com o codigo $secondCode.")
        }
        $linked = Wait-Until -TimeoutSeconds 10 -Condition { (Read-Log -Path $log).Contains('link recebido') }
        if (-not $linked) {
            $failures.Add("O diagnostico.log nao tem 'link recebido' depois do tel:2003.")
        } else {
            Write-Host "A segunda abertura entregou o tel:2003 ao app aberto (codigo $secondCode)."
        }
        if ($process.HasExited) {
            $failures.Add("O app fechou depois do tel:2003 (codigo $($process.ExitCode)).")
        }
    }

    # O Sair pela linha de comando.
    if (-not $process.HasExited) {
        $helper = Start-App -Exe $exe -Arguments '--sair'
        $helperExited = $helper.WaitForExit(15000)
        $helperCode = if ($helperExited) { $helper.ExitCode } else { 'ainda rodando' }
        if (-not $helperExited) {
            Stop-Process -Id $helper.Id -Force -ErrorAction SilentlyContinue
        }
        if ($helperCode -ne 0) {
            $failures.Add("O --sair terminou com o codigo $helperCode.")
        }
        $closed = Wait-Until -TimeoutSeconds 15 -Condition { $process.HasExited }
        if (-not $closed) {
            $failures.Add('O app nao fechou em 15 s depois do --sair.')
        } else {
            Write-Host "O app fechou com o --sair (codigo $($process.ExitCode))."
            if ($process.ExitCode -ne 0) {
                $failures.Add("O app fechou com o codigo $($process.ExitCode).")
            }
            if (-not (Read-Log -Path $log).Contains('fechado')) {
                $failures.Add("O diagnostico.log nao tem 'fechado' (o app nao terminou o fechamento).")
            }
        }
    }

    # O logoff do Windows (WM_QUERYENDSESSION e WM_ENDSESSION, como o Windows manda): o mesmo Sair, com uma espera
    # curta, e o app fecha sozinho depois.
    if ($failures.Count -eq 0) {
        $process = Start-App -Exe $exe -Arguments "--dados `"$data`""
        # A interface desta abertura: o log ja tem as linhas da anterior, entao so o que vem depois do segundo
        # "abrindo" conta (antes de a abertura nova escrever o dela, o ultimo "abrindo" ainda e o da anterior).
        $ready = Wait-Until -TimeoutSeconds 15 -Condition {
            $text = Read-Log -Path $log
            $first = $text.IndexOf(' abrindo')
            $second = if ($first -ge 0) { $text.IndexOf(' abrindo', $first + 1) } else { -1 }
            $process.HasExited -or ($second -ge 0 -and $text.Substring($second).Contains('interface pronta'))
        }
        $window = $null
        if (-not $process.HasExited) {
            $window = Get-TopLevelWindows -ProcessId $process.Id | Where-Object { $_.ClassName -eq 'Starsonic Phone' } |
                Select-Object -First 1
        }
        if (-not $window) {
            $failures.Add('A segunda abertura do app (para o logoff) nao mostrou a janela.')
        } else {
            $logoff = [IntPtr]([int64]2147483648)   # ENDSESSION_LOGOFF (0x80000000)
            $answer = [IntPtr]::Zero
            [StarsonicWin32]::SendMessageTimeoutPtr($window.Handle, 0x0011, [IntPtr]::Zero, $logoff, 0x0002, 5000, [ref]$answer) | Out-Null
            if ($answer.ToInt64() -ne 1) {
                $failures.Add("O WM_QUERYENDSESSION devolveu $($answer.ToInt64()) (o app precisa deixar o Windows encerrar).")
            }
            $sent = [StarsonicWin32]::SendMessageTimeoutPtr($window.Handle, 0x0016, [IntPtr]1, $logoff, 0x0002, 15000, [ref]$answer)
            if ($sent -eq [IntPtr]::Zero) {
                $failures.Add('O WM_ENDSESSION nao voltou em 15 s.')
            }
            if (-not (Read-Log -Path $log).Contains('sessao do Windows encerrando: o Sair terminou')) {
                $failures.Add("O diagnostico.log nao tem 'sessao do Windows encerrando: o Sair terminou' depois do WM_ENDSESSION.")
            }
            $closed = Wait-Until -TimeoutSeconds 15 -Condition { $process.HasExited }
            if (-not $closed) {
                $failures.Add('O app nao fechou em 15 s depois do WM_ENDSESSION.')
            } else {
                Write-Host "O app fechou depois do logoff (codigo $($process.ExitCode))."
            }
        }
    }
} finally {
    if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    Show-Log -Path $log
    Remove-WebViewData
}

if ($failures.Count -gt 0) {
    Write-CiError -Title 'Test-WindowsApp' -Lines @($failures)
    throw ($failures -join ' ')
}
Remove-Item -Path $data -Recurse -Force -ErrorAction SilentlyContinue
Write-Host 'OK: o app novo abriu a interface, recebeu o tel:, fechou com o --sair e com o logoff.'
