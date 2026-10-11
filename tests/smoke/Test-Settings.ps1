# Teste de fumaca: os campos travados pelo perfil somem da tela de Configuracoes, sem buracos.
# Uso: .\tests\smoke\Test-Settings.ps1 -AppDir out
param(
    [string]$AppDir = 'out'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot '..\..\build\BuildCommon.ps1')

# Ids de microsip\resource.h
$locked = [ordered]@{
    IDC_SETTINGS_AUDIO_CODECS_ALL = 1011; IDC_SETTINGS_AUDIO_CODECS = 1012; IDC_SETTINGS_SPIN_MODIFY = 1013
    IDC_SETTINGS_SPIN_ORDER = 1014; IDC_SETTINGS_HELP_AUDIO_CODECS = 2003; IDC_SETTINGS_SOURCE_PORT = 1044
    IDC_SETTINGS_RPORT = 1043; IDC_SETTINGS_RTP_PORT_MIN = 1045; IDC_SETTINGS_RTP_PORT_MAX = 1046
    IDC_SETTINGS_HELP_PORTS = 2009; IDC_SETTINGS_STUN_CHECKBOX = 1031; IDC_SETTINGS_STUN = 1032
    IDC_SETTINGS_HELP_STUN_SERVER = 2014; IDC_SETTINGS_DTMF_METHOD = 1027; IDC_SETTINGS_HELP_DTMF_METHOD = 2010
    IDC_SETTINGS_UPDATES_INTERVAL = 1040
}
$IDC_SETTINGS_RINGTONE = 1003
$visible = [ordered]@{ IDC_SETTINGS_STARTUP = 1041; IDC_SETTINGS_DNS_SRV_CHECKBOX = 1050 }
$ID_SETTINGS = 32789
$IDOK = 1
$IDCANCEL = 2

$copy = New-AppCopy -AppDir (Resolve-Path $AppDir).Path
$exe = Join-Path $copy 'StarsonicPhone.exe'
$process = $null

function Fail([string]$message) {
    $lines = @($message)
    if ($process -and -not $process.HasExited) {
        $lines += @(Get-HangReport -ProcessId $process.Id -Label 'app' -SymbolDir $copy)
    }
    Write-CiError -Title 'Test-Settings' -Lines $lines
    throw $message
}

try {
    $process = Start-App -Exe $exe
    $main = Find-WindowByClass -ProcessId $process.Id -ClassName 'Starsonic Phone' -TimeoutSeconds 20
    if (-not $main) {
        Fail 'Janela principal nao encontrada.'
    }
    $isSettings = { param($text, $id) $id -eq $ID_SETTINGS }
    if (-not (Invoke-MainMenuItem -MainWindow $main.Handle -Match $isSettings)) {
        Fail ('Item de Configuracoes nao encontrado no menu principal. Itens: ' + ($script:MenuItemsSeen -join ', '))
    }

    $holder = @{ Dialog = [IntPtr]::Zero }
    $found = Wait-Until -TimeoutSeconds 10 -Condition {
        foreach ($window in @(Get-TopLevelWindows -ProcessId $process.Id -IncludeOwned)) {
            if ([StarsonicWin32]::IsWindowVisible($window.Handle) -and
                [StarsonicWin32]::GetDlgItem($window.Handle, $IDC_SETTINGS_RINGTONE) -ne [IntPtr]::Zero) {
                $holder.Dialog = $window.Handle
                return $true
            }
        }
        return $false
    }
    if (-not $found) {
        Fail 'A tela de Configuracoes nao abriu.'
    }
    $dialog = $holder.Dialog

    $problems = @()
    foreach ($name in $locked.Keys) {
        $control = [StarsonicWin32]::GetDlgItem($dialog, $locked[$name])
        if ($control -ne [IntPtr]::Zero -and [StarsonicWin32]::IsWindowVisible($control)) {
            $problems += "$name ainda visivel"
        }
    }
    foreach ($name in $visible.Keys) {
        $control = [StarsonicWin32]::GetDlgItem($dialog, $visible[$name])
        if ($control -eq [IntPtr]::Zero -or -not [StarsonicWin32]::IsWindowVisible($control)) {
            $problems += "$name deveria estar visivel"
        }
    }
    $window = New-Object StarsonicWin32+RECT
    $button = New-Object StarsonicWin32+RECT
    [StarsonicWin32]::GetWindowRect($dialog, [ref]$window) | Out-Null
    [StarsonicWin32]::GetWindowRect([StarsonicWin32]::GetDlgItem($dialog, $IDOK), [ref]$button) | Out-Null
    if ($button.Top -lt $window.Top -or $button.Bottom -gt $window.Bottom -or
        $button.Left -lt $window.Left -or $button.Right -gt $window.Right) {
        $problems += "botao Salvar fora da janela (janela $($window.Top)-$($window.Bottom), botao $($button.Top)-$($button.Bottom))"
    }
    if ($problems.Count -gt 0) {
        Fail ('Configuracoes: ' + ($problems -join '; '))
    }

    Invoke-DialogButton -Dialog $dialog -Id $IDCANCEL
    if (-not (Wait-Until -TimeoutSeconds 5 -Condition { -not [StarsonicWin32]::IsWindowVisible($dialog) })) {
        Fail 'A tela de Configuracoes nao fechou com Cancelar.'
    }
    if (-not (Stop-App -Exe $exe -Process $process -TimeoutSeconds 15)) {
        Fail ("O app nao fechou com /exit. " + ($script:StopAppDetails -join ' | '))
    }
    Write-Host 'OK: campos travados escondidos e tela de Configuracoes sem buracos.'
} finally {
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
}
