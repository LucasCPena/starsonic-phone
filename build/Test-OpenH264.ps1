#Requires -Version 7.3
# Confere o modulo H.264 da Cisco (OpenH264) fixado no build\deps.lock (e no starsonic\desktop\OpenH264Pin.h). Roda no
# PowerShell 7.3 ou mais novo (o passo do build.yml usa o shell: pwsh): o O do assinante e lido pela estrutura do nome do
# certificado (X500DistinguishedName.EnumerateRelativeDistinguishedNames, do .NET 7), que o Windows PowerShell 5.1 nao
# tem.
#   0. o auto-teste da leitura do assinante, antes de qualquer download: nomes falsos montados aqui (o O= certo dentro
#      das aspas de outro campo, dois O, um O parecido) sao recusados, e os nomes de verdade da Cisco passam. Um erro do
#      auto-teste derruba o passo;
#   1. baixa o openh264.url (HTTP: o servidor de binarios da Cisco nao tem HTTPS) e mostra o SHA-256 do .bz2;
#   2. descomprime com as regras do app (build\unpack_openh264.py: um fluxo bzip2 so, nada depois do fim dele, ate 4 MiB
#      comprimidos e 8 MiB descomprimidos; senao, o passo falha) e mostra o SHA-256 do .dll;
#   3. confere a assinatura Authenticode do .dll: Status Valid e o O do certificado do assinante (um unico RDN de O, o
#      OID 2.5.4.10, lido pela estrutura do nome e nunca pelo texto do Subject) IGUAL, por inteiro, a "Cisco Systems,
#      Inc." ou "Cisco WebEx LLC" (as DLLs do OpenH264 sao assinadas pela Cisco WebEx LLC e publicadas pela Cisco
#      Systems); depois confere o recurso de versao do .dll: FileVersion ou ProductVersion comecam com o openh264.version
#      (prefixo pontuado: 2.6.0.x vale, 2.6.01 nao), e sem recurso de versao o passo falha;
#   4. compara as duas impressoes com o deps.lock: vazias, so avisa (::warning:: com os valores); preenchidas, falha se
#      forem diferentes;
#   5. baixa https://www.openh264.org/BINARY_LICENSE.txt para <LicenseDir> (o artefato openh264-licenca); com bytes
#      diferentes (o SHA-256) do arquivo do repositorio, so avisa;
#   6. confere que nenhuma pasta do app (-AppDir: a que o instalador empacota) tem um openh264*.dll: o instalador nunca
#      leva o H.264. Uma pasta que nao existe ou que nao da para ler falha (nunca passa por vazia). A pasta instalada de
#      verdade e conferida pela fumaca (tests/smoke/Test-InstalledApp.ps1), logo depois de instalar.
# Uma falha do site da Cisco nos downloads (1 e 5) gera so um aviso: um site fora do ar nao derruba o build.
# Uso: pwsh .\build\Test-OpenH264.ps1 [-AppDir out-novo,out-novo-teste] [-LicenseDir openh264-licenca]
param(
    [string[]]$AppDir = @(),
    [string]$LicenseDir = 'openh264-licenca'
)
$ErrorActionPreference = 'Stop'
# O codigo de saida do Python e conferido aqui, com a mensagem dele (nunca uma excecao sem o motivo).
$PSNativeCommandUseErrorActionPreference = $false
Set-StrictMode -Version 2

$repo = Split-Path -Parent $PSScriptRoot
$lock = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'deps.lock') | ConvertFrom-Json
$pin = $lock.openh264
$failed = $false
# Quem assina o OpenH264: o O inteiro do certificado do assinante, com maiusculas e minusculas.
$CiscoOrganizations = @('Cisco Systems, Inc.', 'Cisco WebEx LLC')

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

# O O do nome do certificado, lido pela estrutura do nome (os RDNs do X500DistinguishedName), nunca por um regex no
# texto do Subject: em CN="Evil, O=Cisco WebEx LLC, X", O=Evil Corp, o O= da Cisco fica dentro das aspas do CN. Devolve
# o valor do unico RDN de O (OID 2.5.4.10), ou $null: nenhum O, mais de um, um RDN com mais de um elemento (A=x+B=y) ou
# um valor que nao e texto.
function Get-SignerOrganization([System.Security.Cryptography.X509Certificates.X500DistinguishedName]$Name) {
    $organizations = @()
    foreach ($rdn in $Name.EnumerateRelativeDistinguishedNames($true)) {
        if ($rdn.HasMultipleElements) { return $null }
        if ($rdn.GetSingleElementType().Value -eq '2.5.4.10') { $organizations += , $rdn.GetSingleElementValue() }
    }
    if ($organizations.Count -ne 1 -or $null -eq $organizations[0]) { return $null }
    return [string]$organizations[0]
}

# O assinante e da Cisco: o unico O do nome igual, por inteiro, a um dos nomes da lista.
function Test-CiscoSigner([System.Security.Cryptography.X509Certificates.X500DistinguishedName]$Name) {
    $organization = Get-SignerOrganization $Name
    return ($null -ne $organization) -and ($CiscoOrganizations -ccontains $organization)
}

# 0. O auto-teste da leitura do assinante, com nomes montados aqui (o X500DistinguishedName le as aspas e o + como o
# Windows). Um erro derruba o passo antes de qualquer download.
function Invoke-SignerSelfTest {
    $cases = @(
        @{ Subject = 'CN="Evil, O=Cisco WebEx LLC, X", O=Evil Corp, C=US'; Cisco = $false },
        @{ Subject = 'OU="dept, O=Cisco WebEx LLC, x", O=Evil Corp'; Cisco = $false },
        @{ Subject = 'O="Cisco WebEx LLC, Evil"'; Cisco = $false },
        @{ Subject = 'CN=Cisco WebEx LLC, O=Evil Corp, O=Cisco WebEx LLC, C=US'; Cisco = $false },
        @{ Subject = 'CN=Cisco WebEx LLC, O=Cisco WebEx LLC, O="Cisco Systems, Inc.", C=US'; Cisco = $false },
        @{ Subject = 'CN=Cisco WebEx LLC+O=Cisco WebEx LLC, C=US'; Cisco = $false },
        @{ Subject = 'CN=Cisco WebEx LLC, O=cisco webex llc, C=US'; Cisco = $false },
        @{ Subject = 'CN=Cisco WebEx LLC, OU=Cisco WebEx LLC, C=US'; Cisco = $false },
        @{ Subject = 'CN=Cisco WebEx LLC, OU=Cisco WebEx LLC, O=Cisco WebEx LLC, L=San Jose, S=California, C=US'; Cisco = $true },
        @{ Subject = 'CN="Cisco Systems, Inc.", O="Cisco Systems, Inc.", L=San Jose, S=California, C=US'; Cisco = $true }
    )
    $wrong = 0
    foreach ($case in $cases) {
        $verdict = ''
        $ok = $false
        try {
            $name = [System.Security.Cryptography.X509Certificates.X500DistinguishedName]::new($case.Subject)
            $accepted = [bool](Test-CiscoSigner $name)
            $verdict = if ($accepted) { 'aceito' } else { 'recusado' }
            $ok = $accepted -eq $case.Cisco
        } catch {
            $verdict = "erro ($($_.Exception.Message))"
        }
        $expected = if ($case.Cisco) { 'aceito' } else { 'recusado' }
        if ($ok) {
            Write-Host "openh264: auto-teste do assinante: $verdict, como esperado: $($case.Subject)"
        } else {
            $wrong++
            Write-Host "openh264: auto-teste do assinante: $verdict, o esperado era $($expected): $($case.Subject)"
        }
    }
    if ($wrong -gt 0) {
        Write-CiFailure 'OpenH264' "o auto-teste da leitura do assinante errou $wrong de $($cases.Count) nomes"
        exit 1
    }
    Write-Host "openh264: auto-teste do assinante passou ($($cases.Count) nomes)"
}

Write-Host "openh264: PowerShell $($PSVersionTable.PSVersion), .NET $([Environment]::Version)"
Invoke-SignerSelfTest

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
        # As regras do app: o CI nunca aceita um arquivo que o app recusaria em todo computador.
        $unpackMessage = & python (Join-Path $PSScriptRoot 'unpack_openh264.py') $bz2 $dll
        if ($LASTEXITCODE -ne 0) {
            Write-CiFailure 'OpenH264' "o .bz2 nao passa nas regras do app ($unpackMessage)"
        } else {
            Write-Host 'openh264: o .bz2 descomprime com as regras do app (um fluxo so, nada depois do fim, os tetos de 4 e 8 MiB)'
            $dllSha = Get-Sha256 $dll
            Write-Host "openh264: dll sha256 $dllSha"

            $signature = Get-AuthenticodeSignature -FilePath $dll
            $subject = ''
            $issuer = ''
            $organization = $null
            $cisco = $false
            if ($signature.SignerCertificate) {
                $subject = $signature.SignerCertificate.Subject
                $issuer = $signature.SignerCertificate.Issuer
                $organization = Get-SignerOrganization $signature.SignerCertificate.SubjectName
                $cisco = Test-CiscoSigner $signature.SignerCertificate.SubjectName
            }
            Write-Host "openh264: Authenticode Status=$($signature.Status)"
            Write-Host "openh264: Authenticode Subject=$subject"
            Write-Host "openh264: Authenticode Issuer=$issuer"
            Write-Host "openh264: Authenticode O=$organization (o unico O do nome do certificado, lido pela estrutura)"
            if ($signature.Status -ne 'Valid' -or -not $cisco) {
                Write-CiFailure 'OpenH264' "assinatura da Cisco invalida (Status=$($signature.Status), O=$organization, Subject=$subject)"
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
    }

    # 5: o texto da licenca do binario.
    $licenseUrl = 'https://www.openh264.org/BINARY_LICENSE.txt'
    New-Item -ItemType Directory -Force -Path $LicenseDir | Out-Null
    $licenseFile = Join-Path $LicenseDir 'BINARY_LICENSE.txt'
    try {
        Invoke-WebRequest -Uri $licenseUrl -OutFile $licenseFile -UseBasicParsing -TimeoutSec 120
        $mine = Join-Path $repo 'starsonic\third_party\openh264\BINARY_LICENSE.txt'
        if (-not (Test-Path -LiteralPath $mine)) {
            Write-CiWarning 'OpenH264' 'starsonic/third_party/openh264/BINARY_LICENSE.txt nao existe no repositorio (o texto esta no artefato openh264-licenca)'
        } else {
            # Os bytes, pelo SHA-256 dos dois (o .gitattributes tira o arquivo do repositorio da troca de fim de linha).
            $mineSha = Get-Sha256 $mine
            $siteSha = Get-Sha256 $licenseFile
            if ($mineSha -cne $siteSha) {
                Write-CiWarning 'OpenH264' "o BINARY_LICENSE.txt do repositorio (sha256 $mineSha) difere do de www.openh264.org (sha256 $siteSha; veja o artefato openh264-licenca)"
            } else {
                Write-Host "openh264: a licenca do binario confere byte a byte com a do repositorio (sha256 $mineSha)"
            }
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
    try {
        $found = @(Get-ChildItem -LiteralPath $dir -Recurse -Force -Filter 'openh264*.dll' -ErrorAction Stop)
    } catch {
        Write-CiFailure 'OpenH264' "nao deu para ler a pasta do app ${dir}: $($_.Exception.Message)"
        continue
    }
    if ($found.Count -gt 0) {
        Write-CiFailure 'OpenH264' "o app em $dir leva o H.264: $(($found | ForEach-Object { $_.FullName }) -join ', ')"
    } else {
        Write-Host "openh264: $dir sem openh264*.dll"
    }
}

if ($failed) { exit 1 }
