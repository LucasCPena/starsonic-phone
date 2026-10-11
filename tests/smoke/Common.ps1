# Funcoes dos testes de fumaca no Windows (PowerShell 5.1 e UI Automation).
# Uso: . (Join-Path $PSScriptRoot 'Common.ps1')
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
if (-not ('StarsonicWin32' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class StarsonicWin32 {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hWnd, StringBuilder name, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int max);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint command);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern uint GetPrivateProfileStringW(string section, string key, string fallback, StringBuilder value, int size, string file);
}
'@
}

# Janelas de primeiro nivel (visiveis ou nao) do processo, com classe e titulo.
function Get-TopLevelWindows {
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [switch]$IncludeOwned
    )
    $found = New-Object System.Collections.ArrayList
    $callback = [StarsonicWin32+EnumWindowsProc]{
        param([IntPtr]$hWnd, [IntPtr]$lParam)
        [uint32]$owner = 0
        [StarsonicWin32]::GetWindowThreadProcessId($hWnd, [ref]$owner) | Out-Null
        if ($owner -eq $ProcessId -and ($IncludeOwned -or [StarsonicWin32]::GetWindow($hWnd, 4) -eq [IntPtr]::Zero)) {
            $class = New-Object System.Text.StringBuilder 256
            $title = New-Object System.Text.StringBuilder 512
            [StarsonicWin32]::GetClassNameW($hWnd, $class, 256) | Out-Null
            [StarsonicWin32]::GetWindowTextW($hWnd, $title, 512) | Out-Null
            [void]$found.Add([pscustomobject]@{ Handle = $hWnd; ClassName = $class.ToString(); Title = $title.ToString() })
        }
        return $true
    }
    [StarsonicWin32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
    return $found
}

# Primeira janela de primeiro nivel do processo com a classe pedida, esperando ate $TimeoutSeconds.
function Find-WindowByClass {
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [Parameter(Mandatory = $true)][string]$ClassName,
        [int]$TimeoutSeconds = 15
    )
    $holder = @{ Window = $null }
    Wait-Until -TimeoutSeconds $TimeoutSeconds -Condition {
        $holder.Window = Get-TopLevelWindows -ProcessId $ProcessId | Where-Object { $_.ClassName -eq $ClassName } | Select-Object -First 1
        return ($null -ne $holder.Window)
    } | Out-Null
    return $holder.Window
}

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
    $started = Get-Date
    $helper = Start-Process -FilePath $Exe -ArgumentList '/exit' -WorkingDirectory (Split-Path -Parent $Exe) -PassThru
    $helperExited = $helper.WaitForExit($TimeoutSeconds * 1000)
    $helperSeconds = [int]((Get-Date) - $started).TotalSeconds
    $closed = Wait-Until -TimeoutSeconds $TimeoutSeconds -Condition { $Process.HasExited }
    $helperCode = if ($helperExited) { $helper.ExitCode } else { 'ainda rodando' }
    $script:StopAppDetails = @("processo /exit: terminou=$helperExited em ${helperSeconds}s, codigo=$helperCode")
    if (-not $helperExited) {
        $script:StopAppDetails += @(Get-WindowReport -ProcessId $helper.Id | ForEach-Object { "/exit: $_" })
        $script:StopAppDetails += @(Get-MainThreadStack -ProcessId $helper.Id -SymbolDir (Split-Path -Parent $Exe) | ForEach-Object { "/exit pilha: $_" })
        Stop-Process -Id $helper.Id -Force -ErrorAction SilentlyContinue
    }
    if (-not $closed) {
        $script:StopAppDetails += @(Get-MainThreadStack -ProcessId $Process.Id -SymbolDir (Split-Path -Parent $Exe) | ForEach-Object { "app pilha: $_" })
    }
    return $closed
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

# Le um valor de um INI (ANSI ou UTF-16, como o MicroSIP grava).
function Read-IniValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Section,
        [Parameter(Mandatory = $true)][string]$Key
    )
    $buffer = New-Object System.Text.StringBuilder 4096
    [StarsonicWin32]::GetPrivateProfileStringW($Section, $Key, '', $buffer, 4096, $Path) | Out-Null
    return $buffer.ToString()
}

# Grava um INI em UTF-16LE com BOM (o formato que o MicroSIP usa).
function Write-IniFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string[]]$Lines
    )
    [System.IO.File]::WriteAllText($Path, (($Lines -join "`r`n") + "`r`n"), [System.Text.Encoding]::Unicode)
}

# Resumo das janelas do processo (classe, titulo, visibilidade e textos dos controles),
# para diagnosticar falhas no CI (ex.: caixa de mensagem inesperada).
function Get-WindowReport {
    param([Parameter(Mandatory = $true)][int]$ProcessId)
    $report = New-Object System.Collections.ArrayList
    foreach ($window in @(Get-TopLevelWindows -ProcessId $ProcessId -IncludeOwned)) {
        $texts = New-Object System.Collections.ArrayList
        $callback = [StarsonicWin32+EnumWindowsProc]{
            param([IntPtr]$hWnd, [IntPtr]$lParam)
            $class = New-Object System.Text.StringBuilder 256
            $title = New-Object System.Text.StringBuilder 1024
            [StarsonicWin32]::GetClassNameW($hWnd, $class, 256) | Out-Null
            [StarsonicWin32]::GetWindowTextW($hWnd, $title, 1024) | Out-Null
            if ($title.Length -gt 0) {
                [void]$texts.Add("$($class.ToString()): $($title.ToString())")
            }
            return $true
        }
        [StarsonicWin32]::EnumChildWindows($window.Handle, $callback, [IntPtr]::Zero) | Out-Null
        $visible = if ([StarsonicWin32]::IsWindowVisible($window.Handle)) { 'visivel' } else { 'oculta' }
        $hung = if ([StarsonicWin32]::IsHungAppWindow($window.Handle)) { ', TRAVADA' } else { '' }
        [void]$report.Add("[$($window.ClassName)] '$($window.Title)' ($visible$hung) { $($texts -join ' | ') }")
    }
    return $report
}

# Pilha da thread principal (cdb nao invasivo), para diagnosticar travamentos no CI.
function Get-MainThreadStack {
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [string]$SymbolDir = '',
        [int]$Frames = 30
    )
    $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\Debuggers'
    $cdb = @((Join-Path $kits 'x86\cdb.exe'), (Join-Path $kits 'x64\cdb.exe')) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $cdb) {
        return @('cdb nao encontrado')
    }
    $symbols = "srv*$(Join-Path $env:TEMP 'symbols')*https://msdl.microsoft.com/download/symbols"
    if ($SymbolDir) {
        $symbols = "$symbols;$SymbolDir"
    }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $cdb -pv -p $ProcessId -y $symbols -c "~0 kc $Frames; q" 2>&1 | ForEach-Object { "$_" }
    } finally {
        $ErrorActionPreference = $previous
    }
    $stack = @($output | Where-Object { $_ -match '^[0-9a-f]{2} ' })
    if ($stack.Count -eq 0) {
        return @($output | Select-Object -Last 15)
    }
    return $stack
}
