# Teste de fumaca do app novo (windows/app, Task 11): o "StarsonicPhone.exe --dados <pasta nova>" abre a janela de
# classe "Starsonic Phone" com o WebView2; em ate 15 s a interface carrega e manda o ready (o diagnostico.log tem a
# linha "interface pronta"); e o "StarsonicPhone.exe --sair" manda o Sair para o app aberto, que fecha em ate 15 s.
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
    $ready = Wait-Until -TimeoutSeconds 15 -Condition {
        $process.HasExited -or ((Read-Log -Path $log).Contains('interface pronta'))
    }
    if ($process.HasExited) {
        $failures.Add("O app fechou sozinho (codigo $($process.ExitCode)).")
    } elseif (-not $ready -or -not (Read-Log -Path $log).Contains('interface pronta')) {
        $failures.Add("O diagnostico.log nao tem 'interface pronta' depois de 15 s.")
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
Write-Host 'OK: o app novo abriu a interface e fechou com o --sair.'
