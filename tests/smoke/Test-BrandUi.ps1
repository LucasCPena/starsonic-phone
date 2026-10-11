# Teste de fumaca da marca na interface: faixa superior com status e tela Sobre pelo menu principal.
# Uso: .\tests\smoke\Test-BrandUi.ps1 -AppDir out
param(
    [string]$AppDir = 'out'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot '..\..\build\BuildCommon.ps1')

# Ids de starsonic\win\StarsonicIds.h e de microsip\resource.h
$IDC_STARSONIC_BAND = 41200
$IDC_SS_ABOUT_VERSION = 41022
$IDC_SS_ABOUT_LICENSE = 41024
$IDC_MAIN_MENU = 1001
$IDOK = 1

$copy = New-AppCopy -AppDir (Resolve-Path $AppDir).Path
$exe = Join-Path $copy 'StarsonicPhone.exe'
$process = $null

function Fail([string]$message) {
    $lines = @($message)
    if ($process -and -not $process.HasExited) {
        $lines += @(Get-HangReport -ProcessId $process.Id -Label 'app' -SymbolDir $copy)
    }
    Write-CiError -Title 'Test-BrandUi' -Lines $lines
    throw $message
}

try {
    $process = Start-App -Exe $exe
    $main = Find-WindowByClass -ProcessId $process.Id -ClassName 'Starsonic Phone' -TimeoutSeconds 20
    if (-not $main) {
        Fail 'Janela principal nao encontrada.'
    }
    $band = [StarsonicWin32]::GetDlgItem($main.Handle, $IDC_STARSONIC_BAND)
    if ($band -eq [IntPtr]::Zero) {
        Fail 'A faixa da marca (IDC_STARSONIC_BAND) nao existe.'
    }
    if (-not (Wait-Until -TimeoutSeconds 10 -Condition { ([StarsonicWin32]::ControlText($band)).Length -gt 0 })) {
        Fail 'A faixa da marca esta sem texto de status.'
    }

    # Menu principal -> "Sobre o Starsonic Phone" (UI Automation no menu suspenso).
    Invoke-DialogButton -Dialog $main.Handle -Id $IDC_MAIN_MENU
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $menuCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ClassNameProperty, '#32768')
    $itemCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty, 'Sobre o Starsonic Phone')
    $holder = @{ Item = $null }
    $found = Wait-Until -TimeoutSeconds 10 -Condition {
        foreach ($menu in $root.FindAll([System.Windows.Automation.TreeScope]::Children, $menuCondition)) {
            $holder.Item = $menu.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $itemCondition)
            if ($holder.Item) {
                return $true
            }
        }
        return $false
    }
    if (-not $found) {
        Fail 'Item "Sobre o Starsonic Phone" nao apareceu no menu principal.'
    }
    $holder.Item.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()

    $about = Find-WindowByTitle -ProcessId $process.Id -Title 'Sobre o Starsonic Phone' -TimeoutSeconds 10
    if (-not $about) {
        Fail 'A tela Sobre nao abriu.'
    }
    $version = Get-ControlText -Dialog $about.Handle -Id $IDC_SS_ABOUT_VERSION
    if ($version -ne 'Starsonic Phone 0.0.0 (baseado no MicroSIP 3.22.16)') {
        Fail "Versao na tela Sobre: '$version'."
    }
    $license = Get-ControlText -Dialog $about.Handle -Id $IDC_SS_ABOUT_LICENSE
    if (-not $license.Contains('GNU GPL v3')) {
        Fail "Licenca na tela Sobre: '$license'."
    }
    Invoke-DialogButton -Dialog $about.Handle -Id $IDOK
    if (-not (Wait-Until -TimeoutSeconds 5 -Condition { -not [StarsonicWin32]::IsWindowVisible($about.Handle) })) {
        Fail 'A tela Sobre nao fechou com Fechar.'
    }

    if (-not (Stop-App -Exe $exe -Process $process -TimeoutSeconds 15)) {
        Fail ("O app nao fechou com /exit. " + ($script:StopAppDetails -join ' | '))
    }
    Write-Host 'OK: faixa da marca com status e tela Sobre com versao e licenca.'
} finally {
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
}
