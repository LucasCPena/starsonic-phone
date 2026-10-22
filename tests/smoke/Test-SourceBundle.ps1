# Confere o pacote "codigo-fonte completo" (build\Make-SourceBundle.ps1, GPL v3, spec 10): lista o zip e exige o
# LEIA-ME-FONTES.txt, este repositorio, o pjproject, o codigo-fonte do vcpkg e os pacotes do npm que vao dentro do
# ui\app.js (npm-packages\<nome>-<versao>.tgz, cada um com o SHA-512 do integrity de windows\ui\package-lock.json).
# Uso: .\tests\smoke\Test-SourceBundle.ps1 -Zip dist\StarsonicPhone-0.1.0-rc.1-codigo-fonte-completo.zip
param(
    [Parameter(Mandatory = $true)][string]$Zip
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
. (Join-Path $PSScriptRoot '..\..\build\BuildCommon.ps1')
trap {
    Write-CiError -Title 'Test-SourceBundle' -Lines @($_.Exception.Message)
    break
}
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$Zip = (Resolve-Path $Zip).Path
$prefix = [System.IO.Path]::GetFileNameWithoutExtension($Zip) + '/'
$archive = [System.IO.Compression.ZipFile]::OpenRead($Zip)
try {
    $entries = @{}
    foreach ($entry in $archive.Entries) {
        $entries[$entry.FullName] = $entry
    }
    Write-Host "$(Split-Path -Leaf $Zip): $($entries.Count) arquivos"
    $npmEntries = @($entries.Keys | Where-Object { $_.StartsWith($prefix + 'npm-packages/') } | Sort-Object)
    Write-Host "npm-packages/: $(if ($npmEntries.Count) { ($npmEntries | ForEach-Object { $_.Substring($prefix.Length) }) -join ', ' } else { '(nenhum)' })"

    $problems = New-Object System.Collections.Generic.List[string]
    foreach ($required in 'LEIA-ME-FONTES.txt', 'starsonic-phone/windows/ui/package-lock.json', 'starsonic-phone/build/deps.lock') {
        if (-not $entries.ContainsKey($prefix + $required)) {
            $problems.Add("falta $required") | Out-Null
        }
    }
    if (-not @($entries.Keys | Where-Object { $_.StartsWith($prefix + 'vcpkg-downloads/') }).Count) {
        $problems.Add('falta o codigo-fonte do vcpkg (vcpkg-downloads/)') | Out-Null
    }
    if (-not @($entries.Keys | Where-Object { $_ -like ($prefix + 'pjproject-*/pjsip/*') }).Count) {
        $problems.Add('falta o pjproject') | Out-Null
    }

    # Os pacotes do lock que vao no app (fora do "dev"), cada um com o SHA-512 do integrity.
    # O ConvertFrom-Json do PowerShell 5.1 nao aceita a chave vazia do package-lock.json (o proprio pacote).
    $lock = (Get-Content -Raw -Path (Join-Path $repoRoot 'windows\ui\package-lock.json')) -replace '"packages"\s*:\s*\{\s*""\s*:', '"packages": { "(raiz)":' | ConvertFrom-Json
    $wanted = 0
    foreach ($property in $lock.packages.PSObject.Properties) {
        $at = $property.Name.LastIndexOf('node_modules/')
        if ($at -lt 0) {
            continue
        }
        $package = $property.Value
        if ($package.PSObject.Properties['dev'] -and $package.dev) {
            continue
        }
        $wanted++
        $name = $property.Name.Substring($at + 'node_modules/'.Length)
        $file = 'npm-packages/{0}-{1}.tgz' -f $name.TrimStart('@').Replace('/', '-'), $package.version
        if (-not $entries.ContainsKey($prefix + $file)) {
            $problems.Add("falta $file ($name $($package.version) vai no ui\app.js)") | Out-Null
            continue
        }
        $sha = [System.Security.Cryptography.SHA512]::Create()
        $stream = $entries[$prefix + $file].Open()
        try {
            $digest = [Convert]::ToBase64String($sha.ComputeHash($stream))
        } finally {
            $stream.Dispose()
            $sha.Dispose()
        }
        if ('sha512-' + $digest -ne $package.integrity) {
            $problems.Add("$file nao bate com o integrity do package-lock.json") | Out-Null
        }
    }
    if ($wanted -eq 0) {
        $problems.Add('o package-lock.json da interface nao tem nenhum pacote que vai no app') | Out-Null
    }
    if (-not @($npmEntries | Where-Object { $_ -like ($prefix + 'npm-packages/preact-*.tgz') }).Count) {
        $problems.Add('falta npm-packages/preact-*.tgz') | Out-Null
    }
    if ($entries.ContainsKey($prefix + 'LEIA-ME-FONTES.txt')) {
        $reader = New-Object System.IO.StreamReader($entries[$prefix + 'LEIA-ME-FONTES.txt'].Open())
        try {
            $readme = $reader.ReadToEnd()
        } finally {
            $reader.Dispose()
        }
        if (-not $readme.Contains('npm-packages/')) {
            $problems.Add('o LEIA-ME-FONTES.txt nao fala do npm-packages/') | Out-Null
        }
    }
} finally {
    $archive.Dispose()
}
if ($problems.Count -gt 0) {
    throw ("Pacote de fontes incompleto: " + ($problems -join '; '))
}
Write-Host 'OK: o pacote de fontes tem o repositorio, o pjproject, o vcpkg e os pacotes do npm do app.'
