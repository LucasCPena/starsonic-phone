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
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeoutW(IntPtr hWnd, uint msg, IntPtr wParam, StringBuilder lParam, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr dialog, int id);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr menu);
    [DllImport("user32.dll")] public static extern uint GetMenuItemID(IntPtr menu, int position);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetMenuStringW(IntPtr menu, uint item, StringBuilder text, int max, uint flags);
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW")] public static extern IntPtr SendMessageTimeoutPtr(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
    // Menu aberto numa janela #32768 (MN_GETHMENU).
    public static IntPtr MenuOf(IntPtr menuWindow) {
        IntPtr menu;
        SendMessageTimeoutPtr(menuWindow, 0x01E1, IntPtr.Zero, IntPtr.Zero, 0x0002, 2000, out menu);
        return menu;
    }
    public static string MenuText(IntPtr menu, int position) {
        StringBuilder text = new StringBuilder(512);
        GetMenuStringW(menu, (uint)position, text, text.Capacity, 0x0400);
        return text.ToString();
    }
    public static void PostCommand(IntPtr window, uint id) {
        PostMessageW(window, 0x0111, new IntPtr(id & 0xFFFF), IntPtr.Zero);
    }
    public static void CancelMode(IntPtr window) {
        PostMessageW(window, 0x001F, IntPtr.Zero, IntPtr.Zero);
    }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessageTimeoutW(IntPtr hWnd, uint msg, IntPtr wParam, string lParam, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    // Troca o texto de um controle de outro processo (WM_SETTEXT).
    public static void SetControlText(IntPtr hWnd, string text) {
        IntPtr ignored;
        SendMessageTimeoutW(hWnd, 0x000C, IntPtr.Zero, text, 0x0002, 5000, out ignored);
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool WritePrivateProfileStringW(string section, string key, string value, string file);
    // Escolhe o item de uma lista suspensa de outro processo (CB_SETCURSEL).
    public static void SelectComboItem(IntPtr combo, int index) {
        IntPtr ignored;
        SendMessageTimeoutPtr(combo, 0x014E, new IntPtr(index), IntPtr.Zero, 0x0002, 5000, out ignored);
    }
    // Clique num botao do dialogo: WM_COMMAND/BN_CLICKED postado (nao bloqueia o teste).
    public static void ClickButton(IntPtr dialog, int id) {
        PostMessageW(dialog, 0x0111, new IntPtr(id & 0xFFFF), GetDlgItem(dialog, id));
    }
    // Texto de um controle de outro processo (GetWindowText so devolve legendas).
    public static string ControlText(IntPtr hWnd) {
        StringBuilder text = new StringBuilder(4096);
        IntPtr ignored;
        SendMessageTimeoutW(hWnd, 0x000D, new IntPtr(text.Capacity), text, 0x0002, 1000, out ignored);
        return text.ToString();
    }
}
'@
}

if (-not ('StarsonicPixels' -as [type])) {
    Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class StarsonicPixels {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
    static bool Near(Color c, int r, int g, int b, int tolerance) {
        int dr = c.R - r, dg = c.G - g, db = c.B - b;
        return dr * dr + dg * dg + db * db <= tolerance * tolerance;
    }
    // Captura a janela de primeiro nivel 'top' como o DWM a mostra (PrintWindow) e conta, na area
    // do controle 'child' entre as fracoes horizontais [fromX, toX), os pixels a ate 'tolerance' da
    // cor (r, g, b). Devolve { iguais, total, nao_pretos } (nao_pretos = 0: captura vazia).
    public static int[] Count(IntPtr top, IntPtr child, int r, int g, int b, int tolerance, double fromX, double toX) {
        RECT wr, cr;
        GetWindowRect(top, out wr);
        GetWindowRect(child, out cr);
        int w = wr.Right - wr.Left, h = wr.Bottom - wr.Top;
        if (w <= 0 || h <= 0) return new int[] { 0, 0, 0 };
        using (Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
            using (Graphics gr = Graphics.FromImage(bmp)) {
                IntPtr hdc = gr.GetHdc();
                PrintWindow(top, hdc, 2);   // PW_RENDERFULLCONTENT
                gr.ReleaseHdc(hdc);
            }
            int x0 = cr.Left - wr.Left, y0 = cr.Top - wr.Top, cw = cr.Right - cr.Left, ch = cr.Bottom - cr.Top;
            int from = Math.Max(0, x0 + (int)(cw * fromX)), to = Math.Min(w, x0 + (int)(cw * toX));
            int same = 0, total = 0, lit = 0;
            for (int y = Math.Max(0, y0); y < Math.Min(h, y0 + ch); y++) {
                for (int x = from; x < to; x++) {
                    Color c = bmp.GetPixel(x, y);
                    total++;
                    if (c.R + c.G + c.B > 30) lit++;
                    if (Near(c, r, g, b, tolerance)) same++;
                }
            }
            return new int[] { same, total, lit };
        }
    }
    // Pixels do icone do executavel (o que o Explorer mostra, 32x32) a ate 'tolerance' da cor.
    public static int IconCount(string exe, int r, int g, int b, int tolerance) {
        using (Icon icon = Icon.ExtractAssociatedIcon(exe))
        using (Bitmap bmp = icon.ToBitmap()) {
            int same = 0;
            for (int y = 0; y < bmp.Height; y++) {
                for (int x = 0; x < bmp.Width; x++) {
                    Color c = bmp.GetPixel(x, y);
                    if (c.A > 128 && Near(c, r, g, b, tolerance)) same++;
                }
            }
            return same;
        }
    }
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
# O INI da copia ja vem com Get-NoUpdateCheckIni.
function New-AppCopy {
    param([Parameter(Mandatory = $true)][string]$AppDir)
    $target = Join-Path ([System.IO.Path]::GetTempPath()) ('starsonic-smoke-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Copy-Item -Path (Join-Path $AppDir '*') -Destination $target -Recurse -Force
    Write-IniFile -Path (Join-Path $target 'StarsonicPhone.ini') -Lines @(Get-NoUpdateCheckIni)
    return $target
}

# Linhas de INI com a ultima verificacao de atualizacao feita agora. O MicroSIP so verifica na
# abertura quando a ultima tem mais de 24 h; sem isso, o app consultaria o GitHub e, com uma versao
# publicada maior que a do build de CI (0.0.0), abriria o aviso de atualizacao no meio do teste.
function Get-NoUpdateCheckIni {
    return @('[Global]', "checkUpdatesTime=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())")
}

# Inicia o exe com a linha de comando exata (sem shell): o MicroSIP compara "/exit" ao pe da letra,
# e o Start-Process deixava um espaco a mais no fim dos argumentos.
function Start-App {
    param(
        [Parameter(Mandatory = $true)][string]$Exe,
        [string]$Arguments = ''
    )
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $Exe
    $info.Arguments = $Arguments
    $info.WorkingDirectory = Split-Path -Parent $Exe
    $info.UseShellExecute = $false
    return [System.Diagnostics.Process]::Start($info)
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
    $helper = Start-App -Exe $Exe -Arguments '/exit'
    $helperExited = $helper.WaitForExit($TimeoutSeconds * 1000)
    $helperSeconds = [int]((Get-Date) - $started).TotalSeconds
    $closed = Wait-Until -TimeoutSeconds $TimeoutSeconds -Condition { $Process.HasExited }
    $helperCode = if ($helperExited) { $helper.ExitCode } else { 'ainda rodando' }
    $script:StopAppDetails = @("processo /exit: terminou=$helperExited em ${helperSeconds}s, codigo=$helperCode")
    if (-not $closed) {
        $script:StopAppDetails += @(Get-HangReport -ProcessId $Process.Id -Label 'app' -SymbolDir (Split-Path -Parent $Exe))
    }
    if (-not $helperExited) {
        $script:StopAppDetails += @(Get-HangReport -ProcessId $helper.Id -Label '/exit' -SymbolDir (Split-Path -Parent $Exe))
        Stop-Process -Id $helper.Id -Force -ErrorAction SilentlyContinue
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

# Grava um valor num INI existente (WritePrivateProfileString, como o MicroSIP).
function Write-IniValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Section,
        [Parameter(Mandatory = $true)][string]$Key,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value
    )
    if (-not [StarsonicWin32]::WritePrivateProfileStringW($Section, $Key, $Value, $Path)) {
        throw "Nao foi possivel gravar [$Section] $Key em $Path"
    }
}

# Grava um INI em UTF-16LE com BOM (o formato que o MicroSIP usa).
function Write-IniFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string[]]$Lines
    )
    [System.IO.File]::WriteAllText($Path, (($Lines -join "`r`n") + "`r`n"), [System.Text.Encoding]::Unicode)
}

# Resumo das janelas do processo (classe, titulo, thread, visibilidade e textos dos controles),
# para diagnosticar falhas no CI (ex.: caixa de mensagem inesperada). So as visiveis, a menos que
# -All seja passado.
function Get-WindowReport {
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [switch]$All
    )
    $report = New-Object System.Collections.ArrayList
    foreach ($window in @(Get-TopLevelWindows -ProcessId $ProcessId -IncludeOwned)) {
        $visible = [StarsonicWin32]::IsWindowVisible($window.Handle)
        if (-not $visible -and -not $All) {
            continue
        }
        $texts = New-Object System.Collections.ArrayList
        $callback = [StarsonicWin32+EnumWindowsProc]{
            param([IntPtr]$hWnd, [IntPtr]$lParam)
            $class = New-Object System.Text.StringBuilder 256
            [StarsonicWin32]::GetClassNameW($hWnd, $class, 256) | Out-Null
            $text = [StarsonicWin32]::ControlText($hWnd)
            if ($text.Length -gt 0) {
                [void]$texts.Add("$($class.ToString()): $($text -replace '\s+', ' ')")
            }
            return $true
        }
        [StarsonicWin32]::EnumChildWindows($window.Handle, $callback, [IntPtr]::Zero) | Out-Null
        [uint32]$ignored = 0
        $thread = [StarsonicWin32]::GetWindowThreadProcessId($window.Handle, [ref]$ignored)
        $state = if ($visible) { 'visivel' } else { 'oculta' }
        if ([StarsonicWin32]::IsHungAppWindow($window.Handle)) {
            $state += ', TRAVADA'
        }
        [void]$report.Add([pscustomobject]@{
                ThreadId = $thread
                ClassName = $window.ClassName
                Line = "[$($window.ClassName)] '$($window.Title)' (thread $thread, $state) { $($texts -join ' | ') }"
            })
    }
    return $report
}

# Pilhas (cdb nao invasivo) da thread principal e das threads pedidas, para travamentos no CI.
function Get-StackReport {
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [uint32[]]$ThreadIds = @(),
        [string]$SymbolDir = '',
        [int]$Frames = 18
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
    $commands = @(".echo == thread principal", "~0 kc $Frames")
    foreach ($id in ($ThreadIds | Select-Object -Unique)) {
        $commands += ".echo == thread $id"
        $commands += ("~~[0x{0:x}] kc $Frames" -f $id)
    }
    $commands += 'q'
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $cdb -pv -p $ProcessId -y $symbols -c ($commands -join '; ') 2>&1 | ForEach-Object { "$_" }
    } finally {
        $ErrorActionPreference = $previous
    }
    return @($output | Where-Object {
            ($_ -like '== thread*') -or ($_ -match '!' -and $_ -notmatch 'NatVis|\*\*\*|^quit')
        })
}

# Diagnostico completo de um processo que deveria ter fechado.
function Get-HangReport {
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [string]$Label = 'app',
        [string]$SymbolDir = ''
    )
    $windows = @(Get-WindowReport -ProcessId $ProcessId)
    $threads = @($windows | Where-Object { $_.ClassName -eq '#32770' } | ForEach-Object { $_.ThreadId })
    $lines = @($windows | ForEach-Object { "${Label}: $($_.Line)" })
    $lines += @(Get-StackReport -ProcessId $ProcessId -ThreadIds $threads -SymbolDir $SymbolDir | ForEach-Object { "${Label} pilha: $_" })
    return $lines
}

# Janela de primeiro nivel (com dono ou nao) do processo cujo titulo e $Title.
function Find-WindowByTitle {
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [Parameter(Mandatory = $true)][string]$Title,
        [int]$TimeoutSeconds = 15
    )
    $holder = @{ Window = $null }
    Wait-Until -TimeoutSeconds $TimeoutSeconds -Condition {
        $holder.Window = Get-TopLevelWindows -ProcessId $ProcessId -IncludeOwned |
            Where-Object { $_.Title -eq $Title -and [StarsonicWin32]::IsWindowVisible($_.Handle) } |
            Select-Object -First 1
        return ($null -ne $holder.Window)
    } | Out-Null
    return $holder.Window
}

function Get-ControlText {
    param(
        [Parameter(Mandatory = $true)][IntPtr]$Dialog,
        [Parameter(Mandatory = $true)][int]$Id
    )
    return [StarsonicWin32]::ControlText([StarsonicWin32]::GetDlgItem($Dialog, $Id))
}

function Set-ControlText {
    param(
        [Parameter(Mandatory = $true)][IntPtr]$Dialog,
        [Parameter(Mandatory = $true)][int]$Id,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text
    )
    [StarsonicWin32]::SetControlText([StarsonicWin32]::GetDlgItem($Dialog, $Id), $Text)
}

function Invoke-DialogButton {
    param(
        [Parameter(Mandatory = $true)][IntPtr]$Dialog,
        [Parameter(Mandatory = $true)][int]$Id
    )
    [StarsonicWin32]::ClickButton($Dialog, $Id)
}

# Texto com caracteres fora do ASCII a partir de codigos (os .ps1 sao so ASCII).
function Get-Text {
    param([Parameter(Mandatory = $true)][object[]]$Parts)
    $builder = New-Object System.Text.StringBuilder
    foreach ($part in $Parts) {
        if ($part -is [int]) {
            [void]$builder.Append([char]$part)
        } else {
            [void]$builder.Append([string]$part)
        }
    }
    return $builder.ToString()
}

# Abre o menu principal (botao IDC_MAIN_MENU), procura o item cujo texto (sem o atalho) satisfaz
# $Match e o aciona: fecha o menu e manda o WM_COMMAND do item para a janela principal, como o
# TrackPopupMenu faria. Devolve $true se achou; em falha, $script:MenuItemsSeen lista os itens.
# Ate 3 cliques, enquanto o menu nem aparecer: logo depois de abrir, a tela Entrar pode roubar o
# foco e fechar o menu antes de ele ser lido (run do commit a700391).
function Invoke-MainMenuItem {
    param(
        [Parameter(Mandatory = $true)][IntPtr]$MainWindow,
        [Parameter(Mandatory = $true)][scriptblock]$Match,
        [int]$TimeoutSeconds = 10
    )
    [uint32]$processId = 0
    [StarsonicWin32]::GetWindowThreadProcessId($MainWindow, [ref]$processId) | Out-Null
    $attemptSeconds = [int][Math]::Ceiling($TimeoutSeconds / 3)
    $holder = @{ Id = $null; Seen = @() }
    $found = $false
    for ($attempt = 1; $attempt -le 3 -and -not $found -and $holder.Seen.Count -eq 0; $attempt++) {
        [StarsonicWin32]::ClickButton($MainWindow, 1001)
        $found = Wait-Until -TimeoutSeconds $attemptSeconds -Condition {
            foreach ($window in @(Get-TopLevelWindows -ProcessId $processId -IncludeOwned | Where-Object { $_.ClassName -eq '#32768' })) {
                $menu = [StarsonicWin32]::MenuOf($window.Handle)
                if ($menu -eq [IntPtr]::Zero) {
                    continue
                }
                $holder.Seen = @()
                for ($i = 0; $i -lt [StarsonicWin32]::GetMenuItemCount($menu); $i++) {
                    $text = ([StarsonicWin32]::MenuText($menu, $i) -split "`t")[0]
                    $id = [StarsonicWin32]::GetMenuItemID($menu, $i)
                    $holder.Seen += "'$text' [$id]"
                    if ($text -and (& $Match $text $id)) {
                        $holder.Id = $id
                        return $true
                    }
                }
            }
            return $false
        }
        [StarsonicWin32]::CancelMode($MainWindow)
        Wait-Until -TimeoutSeconds 5 -Condition {
            @(Get-TopLevelWindows -ProcessId $processId -IncludeOwned | Where-Object { $_.ClassName -eq '#32768' -and [StarsonicWin32]::IsWindowVisible($_.Handle) }).Count -eq 0
        } | Out-Null
    }
    $script:MenuItemsSeen = @($holder.Seen)
    if (-not $found) {
        return $false
    }
    [StarsonicWin32]::PostCommand($MainWindow, [uint32]$holder.Id)
    return $true
}
