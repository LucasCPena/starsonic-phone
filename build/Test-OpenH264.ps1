# Confere o modulo H.264 da Cisco (OpenH264) fixado no build\deps.lock (e no starsonic\desktop\OpenH264Pin.h):
#   1. baixa o openh264.url (HTTP: o servidor de binarios da Cisco nao tem HTTPS) e mostra o SHA-256 do .bz2;
#   2. descomprime e mostra o SHA-256 do .dll;
#   3. confere a assinatura Authenticode do .dll: Status Valid e o O= do Subject IGUAL (o valor inteiro) a "Cisco Systems,
#      Inc." ou "Cisco WebEx LLC" (as DLLs do OpenH264 sao assinadas pela Cisco WebEx LLC e publicadas pela Cisco
#      Systems); depois confere o recurso de versao do .dll: FileVersion ou ProductVersion comecam com o openh264.version
#      (prefixo pontuado: 2.6.0.x vale, 2.6.01 nao), e sem recurso de versao o passo falha;
#   4. compara as duas impressoes com o deps.lock: vazias, so avisa (::warning:: com os valores); preenchidas, falha se
#      forem diferentes;
#   5. baixa https://www.openh264.org/BINARY_LICENSE.txt para <LicenseDir> (o artefato openh264-licenca); diferente do
#      arquivo do repositorio, so avisa;
#   6. confere que nenhuma pasta do app (-AppDir: a que o instalador empacota) tem um openh264*.dll: o instalador nunca
#      leva o H.264. Uma pasta que nao existe falha (nunca passa por vazio). A pasta instalada de verdade e conferida
#      pela fumaca (tests/smoke/Test-InstalledApp.ps1), logo depois de instalar.
# Uma falha do site da Cisco nos downloads (1 e 5) gera so um aviso: um site fora do ar nao derruba o build.
# Uso: .\build\Test-OpenH264.ps1 [-AppDir out-novo,out-novo-teste] [-LicenseDir openh264-licenca]
param(
    [string[]]$AppDir = @(),
    [string]$LicenseDir = 'openh264-licenca'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = Split-Path -Parent $PSScriptRoot
$lock = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'deps.lock') | ConvertFrom-Json
$pin = $lock.openh264
$failed = $false

function Write-CiWarning([string]$Title, [string]$Message) {
    if ($env:GITHUB_ACTIONS -eq 'true') {
        Write-Host "::warning title=${Title}::${Message}"
    } else {
        Write-Host "AVISO ${Title}: ${Message}"
    }
}
function Write-CiFailure([string]$Title, [string]$Message) {
    $script:failed = $true
    if ($env:GITHUB_ACTIONS -eq 'true') {
        Write-Host "::error title=${Title}::${Message}"
    } else {
        Write-Host "ERRO ${Title}: ${Message}"
    }
}
function Get-Sha256([string]$Path) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('openh264-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    # 1 a 4: o binario.
    $bz2 = Join-Path $work ([IO.Path]::GetFileName($pin.url))
    $downloaded = $false
    try {
        Invoke-WebRequest -Uri $pin.url -OutFile $bz2 -UseBasicParsing -TimeoutSec 120 -MaximumRedirection 0
        $downloaded = $true
    } catch {
        Write-CiWarning 'OpenH264' "download do binario da Cisco falhou ($($_.Exception.Message)); as impressoes nao foram conferidas"
    }
    if ($downloaded) {
        $bz2Sha = Get-Sha256 $bz2
        Write-Host "openh264: bz2 sha256 $bz2Sha"
        $dll = Join-Path $work $pin.file
        # O Python (do job) descomprime: o PowerShell 5.1 nao tem bzip2.
        $unpack = "import bz2,sys; open(sys.argv[2],'wb').write(bz2.BZ2Decompressor().decompress(open(sys.argv[1],'rb').read()))"
        & python -c $unpack $bz2 $dll
        if ($LASTEXITCODE -ne 0) { throw 'openh264: nao descomprimiu o .bz2' }
        $dllSha = Get-Sha256 $dll
        Write-Host "openh264: dll sha256 $dllSha"

        $signature = Get-AuthenticodeSignature -FilePath $dll
        $subject = ''
        $issuer = ''
        if ($signature.SignerCertificate) {
            $subject = $signature.SignerCertificate.Subject
            $issuer = $signature.SignerCertificate.Issuer
        }
        Write-Host "openh264: Authenticode Status=$($signature.Status)"
        Write-Host "openh264: Authenticode Subject=$subject"
        Write-Host "openh264: Authenticode Issuer=$issuer"
        # O valor inteiro do O= (entre aspas quando tem virgula), nunca um trecho: "Cisco Systems" dentro de outro nome nao vale.
        $org = ''
        if ($subject -match '(?:^|,\s*)O=(?:"([^"]*)"|([^,]*))') {
            if ($Matches[1]) { $org = $Matches[1] } else { $org = $Matches[2].Trim() }
        }
        $allowed = @('Cisco Systems, Inc.', 'Cisco WebEx LLC')
        if ($signature.Status -ne 'Valid' -or $allowed -cnotcontains $org) {
            Write-CiFailure 'OpenH264' "assinatura da Cisco invalida (Status=$($signature.Status), O=$org, Subject=$subject)"
        }

        $info = (Get-Item -LiteralPath $dll).VersionInfo
        Write-Host "openh264: FileVersion=$($info.FileVersion)"
        Write-Host "openh264: ProductVersion=$($info.ProductVersion)"
        Write-Host "openh264: ProductName=$($info.ProductName)"
        Write-Host "openh264: OriginalFilename=$($info.OriginalFilename)"
        $versionOk = $false
        foreach ($value in @($info.FileVersion, $info.ProductVersion)) {
            if ($value) {
                $text = ([string]$value).Trim()
                if ($text -eq $pin.version -or $text.StartsWith($pin.version + '.')) { $versionOk = $true }
            }
        }
        if (-not $versionOk) {
            Write-CiFailure 'OpenH264' "o recurso de versao do .dll nao e da $($pin.version) (FileVersion=$($info.FileVersion), ProductVersion=$($info.ProductVersion))"
        }

        if (-not $pin.bz2Sha256 -and -not $pin.dllSha256) {
            Write-CiWarning 'OpenH264' "impressoes ainda nao fixadas: bz2Sha256=$bz2Sha dllSha256=$dllSha"
        } else {
            if ($bz2Sha -ne $pin.bz2Sha256) { Write-CiFailure 'OpenH264' "bz2Sha256 do deps.lock $($pin.bz2Sha256), o binario $bz2Sha" }
            if ($dllSha -ne $pin.dllSha256) { Write-CiFailure 'OpenH264' "dllSha256 do deps.lock $($pin.dllSha256), o binario $dllSha" }
            if (-not $failed) { Write-Host 'openh264: as duas impressoes conferem com o deps.lock' }
        }
    }

    # 5: o texto da licenca do binario.
    $licenseUrl = 'https://www.openh264.org/BINARY_LICENSE.txt'
    New-Item -ItemType Directory -Force -Path $LicenseDir | Out-Null
    $licenseFile = Join-Path $LicenseDir 'BINARY_LICENSE.txt'
    try {
        Invoke-WebRequest -Uri $licenseUrl -OutFile $licenseFile -UseBasicParsing -TimeoutSec 120
        $mine = Join-Path $repo 'starsonic\third_party\openh264\BINARY_LICENSE.txt'
        $norm = { param($p) ((Get-Content -Raw -Encoding UTF8 $p) -replace "`r`n", "`n").Trim() }
        if (-not (Test-Path $mine)) {
            Write-CiWarning 'OpenH264' 'starsonic/third_party/openh264/BINARY_LICENSE.txt nao existe no repositorio (o texto esta no artefato openh264-licenca)'
        } elseif ((& $norm $mine) -ne (& $norm $licenseFile)) {
            Write-CiWarning 'OpenH264' 'o BINARY_LICENSE.txt do repositorio difere do de www.openh264.org (veja o artefato openh264-licenca)'
        } else {
            Write-Host 'openh264: a licenca do binario confere com a do repositorio'
        }
    } catch {
        Write-CiWarning 'OpenH264' "download da licenca falhou ($($_.Exception.Message))"
    }
} finally {
    Remove-Item -Recurse -Force -LiteralPath $work -ErrorAction SilentlyContinue
}

# 6: o instalador e o app nunca levam o H.264.
foreach ($dir in $AppDir) {
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
        Write-CiFailure 'OpenH264' "a pasta do app $dir nao existe: nao da para conferir que ela esta sem o H.264"
        continue
    }
    $found = @(Get-ChildItem -LiteralPath $dir -Recurse -Force -Filter 'openh264*.dll' -ErrorAction SilentlyContinue)
    if ($found.Count -gt 0) {
        Write-CiFailure 'OpenH264' "o app em $dir leva o H.264: $(($found | ForEach-Object { $_.FullName }) -join ', ')"
    } else {
        Write-Host "openh264: $dir sem openh264*.dll"
    }
}

if ($failed) { exit 1 }
