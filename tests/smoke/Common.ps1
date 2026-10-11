# Funcoes dos testes de fumaca no Windows (PowerShell 5.1 e UI Automation).
# Uso: . (Join-Path $PSScriptRoot 'Common.ps1')
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

# Copia a pasta do app para uma pasta temporaria nova, para o INI e os logs do teste nao sujarem a saida.
function New-AppCopy {
    param([Parameter(Mandatory = $true)][string]$AppDir)
    $target = Join-Path ([System.IO.Path]::GetTempPath()) ('starsonic-smoke-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Copy-Item -Path (Join-Path $AppDir '*') -Destination $target -Recurse -Force
    return $target
}

function Start-App {
    param(
        [Parameter(Mandatory = $true)][string]$Exe,
        [string[]]$Arguments = @()
    )
    if ($Arguments.Count -gt 0) {
        return Start-Process -FilePath $Exe -ArgumentList $Arguments -WorkingDirectory (Split-Path -Parent $Exe) -PassThru
    }
    return Start-Process -FilePath $Exe -WorkingDirectory (Split-Path -Parent $Exe) -PassThru
}

# Repete $Condition ate ela devolver verdadeiro ou o tempo acabar.
function Wait-Until {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Condition,
        [int]$TimeoutSeconds = 15,
        [int]$IntervalMilliseconds = 250
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (& $Condition) {
            return $true
        }
        Start-Sleep -Milliseconds $IntervalMilliseconds
    }
    return [bool](& $Condition)
}

# Fecha o app como o usuario faria pela linha de comando (StarsonicPhone.exe /exit).
function Stop-App {
    param(
        [Parameter(Mandatory = $true)][string]$Exe,
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [int]$TimeoutSeconds = 15
    )
    $helper = Start-Process -FilePath $Exe -ArgumentList '/exit' -WorkingDirectory (Split-Path -Parent $Exe) -PassThru
    $helper.WaitForExit($TimeoutSeconds * 1000) | Out-Null
    return (Wait-Until -TimeoutSeconds $TimeoutSeconds -Condition { $Process.HasExited })
}

# Janela de primeiro nivel do processo (opcionalmente com o titulo $Name).
function Find-Window {
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [string]$Name = '',
        [int]$TimeoutSeconds = 15
    )
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)
    $holder = @{ Window = $null }
    Wait-Until -TimeoutSeconds $TimeoutSeconds -Condition {
        foreach ($window in $root.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)) {
            if (-not $Name -or $window.Current.Name -eq $Name) {
                $holder.Window = $window
                return $true
            }
        }
        return $false
    } | Out-Null
    return $holder.Window
}

# Controle dentro de $Element cujo AutomationId e o id do controle no recurso (ex.: '41011').
function Find-ById {
    param(
        [Parameter(Mandatory = $true)]$Element,
        [Parameter(Mandatory = $true)][string]$AutomationId,
        [int]$TimeoutSeconds = 5
    )
    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $AutomationId)
    $holder = @{ Control = $null }
    Wait-Until -TimeoutSeconds $TimeoutSeconds -Condition {
        $holder.Control = $Element.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
        return ($null -ne $holder.Control)
    } | Out-Null
    return $holder.Control
}
