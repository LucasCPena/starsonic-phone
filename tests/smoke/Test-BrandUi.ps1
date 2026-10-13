# Teste de fumaca da marca na interface: faixa superior com status e tela Sobre pelo menu principal;
# cores e logos da Starsonic conferidos nos pixels da tela (azul #383881 e ciano #3DB1CC) e no icone.
# Uso: .\tests\smoke\Test-BrandUi.ps1 -AppDir out [-Version 0.0.0]   (versao com que o app foi compilado)
param(
    [string]$AppDir = 'out',
    [string]$Version = '0.0.0'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
. (Join-Path $PSScriptRoot 'Common.ps1')
. (Join-Path $PSScriptRoot '..\..\build\BuildCommon.ps1')

# Ids de starsonic\win\StarsonicIds.h e de microsip\resource.h
$IDC_STARSONIC_BAND = 41200
$IDC_SS_ABOUT_VERSION = 41022
$IDC_SS_ABOUT_LICENSE = 41024
$IDC_SS_LOGO = 41011
$IDC_SS_ABOUT_LOGO = 41021
$NAVY = @(0x38, 0x38, 0x81)
$CYAN = @(0x3D, 0xB1, 0xCC)
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

# Captura a janela ate achar pelo menos $Minimum pixels da cor (o desenho pode chegar depois).
function Wait-Pixels {
    param([IntPtr]$Top, [IntPtr]$Child, [int[]]$Rgb, [int]$Tolerance, [double]$FromX, [double]$ToX, [int]$Minimum)
    $holder = @{ Last = @(0, 0, 0) }
    Wait-Until -TimeoutSeconds 5 -Condition {
        $holder.Last = [StarsonicPixels]::Count($Top, $Child, $Rgb[0], $Rgb[1], $Rgb[2], $Tolerance, $FromX, $ToX)
        return ($holder.Last[0] -ge $Minimum)
    } | Out-Null
    return $holder.Last
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

    # Cores e logos: as falhas sao somadas e informadas depois da tela Sobre.
    $visual = @()
    $bandNavy = [StarsonicPixels]::Count($main.Handle, $band, $NAVY[0], $NAVY[1], $NAVY[2], 20, 0.0, 1.0)
    if ($bandNavy[2] -eq 0) {
        $visual += 'Captura vazia da janela principal (PrintWindow).'
    } elseif ($bandNavy[0] * 100 -lt $bandNavy[1] * 40) {
        $visual += "Faixa sem o azul Starsonic: $($bandNavy[0]) de $($bandNavy[1]) pixels."
    }
    $bandCyan = Wait-Pixels -Top $main.Handle -Child $band -Rgb $CYAN -Tolerance 40 -FromX 0.0 -ToX 0.5 -Minimum 20
    if ($bandCyan[0] -lt 20) {
        $visual += "Logo da faixa sem o ciano Starsonic: $($bandCyan[0]) pixels."
    }
    $loginTitle = Get-Text @('Starsonic Phone ', 0x2014, ' Entrar')
    $login = Find-WindowByTitle -ProcessId $process.Id -Title $loginTitle -TimeoutSeconds 20
    if (-not $login) {
        $visual += 'A tela Entrar nao abriu na inicializacao.'
    } else {
        $loginLogo = [StarsonicWin32]::GetDlgItem($login.Handle, $IDC_SS_LOGO)
        $loginCyan = Wait-Pixels -Top $login.Handle -Child $loginLogo -Rgb $CYAN -Tolerance 40 -FromX 0.0 -ToX 1.0 -Minimum 20
        if ($loginCyan[0] -lt 20) {
            $visual += "Logo da tela Entrar sem o ciano Starsonic: $($loginCyan[0]) pixels."
        }
    }
    $iconNavy = [StarsonicPixels]::IconCount($exe, $NAVY[0], $NAVY[1], $NAVY[2], 24)
    if ($iconNavy -lt 30) {
        $visual += "Icone do app sem o azul Starsonic: $iconNavy pixels."
    }

    # Menu principal -> "Sobre o Starsonic Phone".
    if (-not (Invoke-MainMenuItem -MainWindow $main.Handle -Match { param($text, $id) $text -eq 'Sobre o Starsonic Phone' })) {
        Fail ('Item "Sobre o Starsonic Phone" nao apareceu no menu principal. Itens: ' + ($script:MenuItemsSeen -join ', '))
    }
    # Traducao lida como UTF-8: o item de Configuracoes aparece com os acentos certos.
    $settingsText = Get-Text @('Configura', 0x00E7, 0x00F5, 'es')
    if (-not @($script:MenuItemsSeen | Where-Object { $_.StartsWith("'" + $settingsText + "'") })) {
        Fail ('Item de Configuracoes com acentos nao apareceu no menu principal. Itens: ' + ($script:MenuItemsSeen -join ', '))
    }

    $about = Find-WindowByTitle -ProcessId $process.Id -Title 'Sobre o Starsonic Phone' -TimeoutSeconds 10
    if (-not $about) {
        Fail 'A tela Sobre nao abriu.'
    }
    # (Variaveis do PowerShell nao diferenciam maiusculas: $aboutText, para nao sobrescrever $Version.)
    $aboutText = Get-ControlText -Dialog $about.Handle -Id $IDC_SS_ABOUT_VERSION
    $expectedText = "Starsonic Phone $Version (baseado no MicroSIP 3.22.16)"
    if ($aboutText -ne $expectedText) {
        Fail "Versao na tela Sobre: '$aboutText' (esperado '$expectedText')."
    }
    $license = Get-ControlText -Dialog $about.Handle -Id $IDC_SS_ABOUT_LICENSE
    if (-not $license.Contains('GNU GPL v3')) {
        Fail "Licenca na tela Sobre: '$license'."
    }
    $aboutLogo = [StarsonicWin32]::GetDlgItem($about.Handle, $IDC_SS_ABOUT_LOGO)
    $aboutCyan = Wait-Pixels -Top $about.Handle -Child $aboutLogo -Rgb $CYAN -Tolerance 40 -FromX 0.0 -ToX 1.0 -Minimum 20
    if ($aboutCyan[0] -lt 20) {
        $visual += "Logo da tela Sobre sem o ciano Starsonic: $($aboutCyan[0]) pixels."
    }
    Invoke-DialogButton -Dialog $about.Handle -Id $IDOK
    if (-not (Wait-Until -TimeoutSeconds 5 -Condition { -not [StarsonicWin32]::IsWindowVisible($about.Handle) })) {
        Fail 'A tela Sobre nao fechou com Fechar.'
    }
    if ($visual.Count -gt 0) {
        Fail ('Identidade visual: ' + ($visual -join ' | '))
    }

    if (-not (Stop-App -Exe $exe -Process $process -TimeoutSeconds 15)) {
        Fail ("O app nao fechou com /exit. " + ($script:StopAppDetails -join ' | '))
    }
    Write-Host 'OK: faixa da marca com status, cores e logo; tela Entrar e Sobre com o logo; icone do app; Sobre com versao e licenca.'
} finally {
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
}
