# Capturas das telas do Starsonic Phone para apresentacoes e manuais (nao e teste). Instala o setup
# pela interface (capturando as telas do instalador), aponta starcloud1-starsonic.com.br para o
# registrador SIP falso local (arquivo hosts) e salva PNGs das janelas do app, no modo claro e no
# escuro. Feito para o runner do GitHub (precisa ser administrador para editar o hosts).
# Uso: .\tests\smoke\Capture-Screens.ps1 -Setup dist\StarsonicPhone-<versao>-setup.exe -OutDir capturas
param(
    [Parameter(Mandatory = $true)][string]$Setup,
    [string]$OutDir = 'capturas',
    [string]$Python = 'python'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot '..\..\build\BuildCommon.ps1')
trap {
    Write-CiError -Title 'Capture-Screens' -Lines @($_.Exception.Message, $_.InvocationInfo.PositionMessage)
    break
}

if (-not ('StarsonicShots' -as [type])) {
    Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
public static class StarsonicShots {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr lParam);
    [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int max);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out RECT rect, int size);

    // Salva a janela como o DWM a mostra (PrintWindow), cortada na moldura visivel. Devolve o
    // tamanho salvo ("LxA") ou o motivo da falha.
    public static string Save(IntPtr hWnd, string path) {
        RECT r;
        GetWindowRect(hWnd, out r);
        int w = r.Right - r.Left, h = r.Bottom - r.Top;
        if (w <= 0 || h <= 0) return "janela sem tamanho";
        using (Bitmap bmp = new Bitmap(w, h, PixelFormat.Format24bppRgb)) {
            using (Graphics g = Graphics.FromImage(bmp)) {
                IntPtr hdc = g.GetHdc();
                bool ok = PrintWindow(hWnd, hdc, 2);   // PW_RENDERFULLCONTENT
                g.ReleaseHdc(hdc);
                if (!ok) return "PrintWindow falhou";
            }
            Rectangle crop = new Rectangle(0, 0, w, h);
            RECT f;
            if (DwmGetWindowAttribute(hWnd, 9, out f, Marshal.SizeOf(typeof(RECT))) == 0) {   // DWMWA_EXTENDED_FRAME_BOUNDS
                Rectangle frame = new Rectangle(f.Left - r.Left, f.Top - r.Top, f.Right - f.Left, f.Bottom - f.Top);
                if (frame.Width > 0 && frame.Height > 0 && new Rectangle(0, 0, w, h).Contains(frame)) crop = frame;
            }
            using (Bitmap part = bmp.Clone(crop, PixelFormat.Format24bppRgb)) {
                part.Save(path, ImageFormat.Png);
            }
            return crop.Width + "x" + crop.Height;
        }
    }
    public static IntPtr ChildById(IntPtr parent, int id) {
        IntPtr found = IntPtr.Zero;
        EnumChildWindows(parent, (h, l) => { if (GetDlgCtrlID(h) == id) { found = h; return false; } return true; }, IntPtr.Zero);
        return found;
    }
    public static IntPtr ChildByText(IntPtr parent, string text) {
        IntPtr found = IntPtr.Zero;
        EnumChildWindows(parent, (h, l) => {
            StringBuilder sb = new StringBuilder(512);
            GetWindowTextW(h, sb, sb.Capacity);
            if (sb.ToString() == text) { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }
    public static void Front(IntPtr hWnd) { SetForegroundWindow(hWnd); }
}
'@
}

# Ids de starsonic\win\StarsonicIds.h e de microsip\resource.h
$IDC_SS_SERVER = 41012
$IDC_SS_RAMAL = 41013
$IDC_SS_SENHA = 41014
$IDC_SS_MESSAGE = 41015
$IDC_SS_ENTRAR = 41016
$IDC_STARSONIC_BAND = 41200
$IDC_NUMBER = 1078
$ID_ACCOUNT_EDIT_RANGE = 40100
$IDOK = 1
$IDCANCEL = 2
$SERVER = 'starcloud1-starsonic.com.br'

$installDir = Join-Path $env:LOCALAPPDATA 'Starsonic Phone'
$exe = Join-Path $installDir 'StarsonicPhone.exe'
$Setup = (Resolve-Path $Setup).Path
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$saved = New-Object System.Collections.Generic.List[string]

function Save-Window([IntPtr]$Handle, [string]$Name) {
    Start-Sleep -Milliseconds 800
    $path = Join-Path $OutDir ($Name + '.png')
    $result = [StarsonicShots]::Save($Handle, $path)
    Write-Host "captura ${Name}: $result"
    $saved.Add("${Name}.png $result")
}

function Get-InstalledApp {
    return @(Get-Process -Name 'StarsonicPhone' -ErrorAction SilentlyContinue | Where-Object {
            $path = $null
            try { $path = $_.Path } catch { }
            $path -eq $exe
        }) | Select-Object -First 1
}

# Texto do botao $Id da janela (para saber em que pagina o instalador esta).
function Get-ButtonText([IntPtr]$Window, [int]$Id) {
    return [StarsonicWin32]::ControlText([StarsonicWin32]::GetDlgItem($Window, $Id))
}

# 1. Servidor da Starsonic apontado para o registrador falso local.
$hosts = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
Add-Content -Path $hosts -Value "`r`n127.0.0.1 $SERVER" -Encoding ASCII
ipconfig /flushdns | Out-Null
$registrarInfo = New-Object System.Diagnostics.ProcessStartInfo
$registrarInfo.FileName = $Python
$registrarInfo.Arguments = "`"$(Join-Path $PSScriptRoot 'fake_registrar.py')`" --user 2001,2002 --password senha-certa"
$registrarInfo.UseShellExecute = $false
$registrar = [System.Diagnostics.Process]::Start($registrarInfo)
$app = $null
try {
    Start-Sleep -Seconds 1

    # 2. Instalador pela interface: boas-vindas, componentes e tela final.
    $setupProcess = Start-App -Exe $Setup
    $holder = @{ Window = $null }
    if (-not (Wait-Until -TimeoutSeconds 30 -Condition {
                $holder.Window = Get-TopLevelWindows -ProcessId $setupProcess.Id |
                    Where-Object { $_.ClassName -eq '#32770' -and [StarsonicWin32]::IsWindowVisible($_.Handle) } |
                    Select-Object -First 1
                return ($null -ne $holder.Window)
            })) {
        throw 'O instalador nao abriu.'
    }
    $setupWindow = $holder.Window.Handle
    Save-Window $setupWindow '01-instalador-boas-vindas'
    $first = Get-ButtonText $setupWindow $IDOK
    Invoke-DialogButton -Dialog $setupWindow -Id $IDOK
    Wait-Until -TimeoutSeconds 10 -Condition { (Get-ButtonText $setupWindow $IDOK) -ne $first } | Out-Null
    Save-Window $setupWindow '02-instalador-componentes'
    Invoke-DialogButton -Dialog $setupWindow -Id $IDOK
    $runText = 'Abrir o Starsonic Phone'
    if (-not (Wait-Until -TimeoutSeconds 90 -Condition { [StarsonicShots]::ChildByText($setupWindow, $runText) -ne [IntPtr]::Zero })) {
        throw "O instalador nao chegou na tela final (botao: '$(Get-ButtonText $setupWindow $IDOK)')."
    }
    Save-Window $setupWindow '03-instalador-fim'
    Invoke-DialogButton -Dialog $setupWindow -Id $IDOK
    $setupProcess.WaitForExit(30000) | Out-Null

    # 3. Primeiro acesso: tela Entrar vazia, com erro e preenchida.
    if (-not (Wait-Until -TimeoutSeconds 30 -Condition { $null -ne (Get-InstalledApp) })) {
        throw 'O app nao abriu depois do instalador.'
    }
    $app = Get-InstalledApp
    $title = Get-Text @('Starsonic Phone ', 0x2014, ' Entrar')
    $login = Find-WindowByTitle -ProcessId $app.Id -Title $title -TimeoutSeconds 30
    if (-not $login) {
        throw 'A tela Entrar nao abriu.'
    }
    $dialog = $login.Handle
    Save-Window $dialog '04-entrar'
    Set-ControlText -Dialog $dialog -Id $IDC_SS_SERVER -Text $SERVER
    Set-ControlText -Dialog $dialog -Id $IDC_SS_RAMAL -Text '2001'
    Set-ControlText -Dialog $dialog -Id $IDC_SS_SENHA -Text 'senha-errada'
    Invoke-DialogButton -Dialog $dialog -Id $IDC_SS_ENTRAR
    Wait-Until -TimeoutSeconds 20 -Condition { (Get-ControlText -Dialog $dialog -Id $IDC_SS_MESSAGE) -ne '' } | Out-Null
    Save-Window $dialog '05-entrar-senha-errada'
    Set-ControlText -Dialog $dialog -Id $IDC_SS_SENHA -Text 'senha-certa'
    Set-ControlText -Dialog $dialog -Id $IDC_SS_MESSAGE -Text ''
    Save-Window $dialog '06-entrar-preenchida'
    Invoke-DialogButton -Dialog $dialog -Id $IDC_SS_ENTRAR
    if (-not (Wait-Until -TimeoutSeconds 20 -Condition { -not [StarsonicWin32]::IsWindowVisible($dialog) })) {
        throw "A tela Entrar nao fechou: '$(Get-ControlText -Dialog $dialog -Id $IDC_SS_MESSAGE)'."
    }

    # 4. Janela principal conectada, com um numero no discador, e tela Sobre.
    $main = Find-WindowByClass -ProcessId $app.Id -ClassName 'Starsonic Phone' -TimeoutSeconds 10
    $band = [StarsonicWin32]::GetDlgItem($main.Handle, $IDC_STARSONIC_BAND)
    Wait-Until -TimeoutSeconds 20 -Condition { ([StarsonicWin32]::ControlText($band)).StartsWith('Conectado') } | Out-Null
    $number = [StarsonicShots]::ChildById($main.Handle, $IDC_NUMBER)
    if ($number -ne [IntPtr]::Zero) {
        [StarsonicWin32]::SetControlText($number, '2002')
    }
    [StarsonicShots]::Front($main.Handle)
    Save-Window $main.Handle '07-principal'
    if (Invoke-MainMenuItem -MainWindow $main.Handle -Match { param($text, $id) $text -eq 'Sobre o Starsonic Phone' }) {
        $about = Find-WindowByTitle -ProcessId $app.Id -Title 'Sobre o Starsonic Phone' -TimeoutSeconds 10
        if ($about) {
            Save-Window $about.Handle '08-sobre'
            Invoke-DialogButton -Dialog $about.Handle -Id $IDOK
        }
    }

    # 5. Modo escuro do Windows: janela principal e tela Entrar (Editar Conta).
    Stop-App -Exe $exe -Process $app -TimeoutSeconds 20 | Out-Null
    $personalize = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
    if (-not (Test-Path $personalize)) {
        New-Item -Path $personalize -Force | Out-Null
    }
    Set-ItemProperty -Path $personalize -Name 'AppsUseLightTheme' -Value 0 -Type DWord
    $app = Start-App -Exe $exe
    $main = Find-WindowByClass -ProcessId $app.Id -ClassName 'Starsonic Phone' -TimeoutSeconds 20
    $band = [StarsonicWin32]::GetDlgItem($main.Handle, $IDC_STARSONIC_BAND)
    Wait-Until -TimeoutSeconds 20 -Condition { ([StarsonicWin32]::ControlText($band)).StartsWith('Conectado') } | Out-Null
    $number = [StarsonicShots]::ChildById($main.Handle, $IDC_NUMBER)
    if ($number -ne [IntPtr]::Zero) {
        [StarsonicWin32]::SetControlText($number, '2002')
    }
    [StarsonicShots]::Front($main.Handle)
    Save-Window $main.Handle '09-principal-escuro'
    if (Invoke-MainMenuItem -MainWindow $main.Handle -Match { param($text, $id) $id -eq $ID_ACCOUNT_EDIT_RANGE }) {
        $edit = Find-WindowByTitle -ProcessId $app.Id -Title $title -TimeoutSeconds 10
        if ($edit) {
            Save-Window $edit.Handle '10-entrar-escuro'
            Invoke-DialogButton -Dialog $edit.Handle -Id $IDCANCEL
        }
    }
    Set-ItemProperty -Path $personalize -Name 'AppsUseLightTheme' -Value 1 -Type DWord
    Stop-App -Exe $exe -Process $app -TimeoutSeconds 20 | Out-Null
} finally {
    $saved | Set-Content -Path (Join-Path $OutDir 'lista.txt') -Encoding ASCII
    if ($app -and -not $app.HasExited) {
        Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
    }
    if (-not $registrar.HasExited) {
        Stop-Process -Id $registrar.Id -Force -ErrorAction SilentlyContinue
    }
}
Write-Host "capturas: $($saved.Count) em $OutDir"
