# Funcoes comuns dos scripts de build (Windows PowerShell 5.1).
# Uso: . (Join-Path $PSScriptRoot 'BuildCommon.ps1')

# Roda um programa externo, mostra a saida (stdout e stderr) e falha se o codigo de saida nao for 0.
# No PowerShell 5.1, stderr de programa externo com $ErrorActionPreference = 'Stop' vira erro fatal;
# por isso a preferencia e trocada so durante a chamada.
function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$File,
        [string[]]$Arguments = @()
    )
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $File @Arguments 2>&1 | ForEach-Object { "$_" }
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    if ($code -ne 0) {
        throw "Falhou (codigo $code): $File $($Arguments -join ' ')"
    }
}

# Igual a Invoke-Native, mas devolve a saida e o codigo sem falhar.
function Get-NativeOutput {
    param(
        [Parameter(Mandatory = $true)][string]$File,
        [string[]]$Arguments = @()
    )
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $File @Arguments 2>$null
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    $text = (@($output) | ForEach-Object { "$_" }) -join "`n"
    return [pscustomobject]@{ Code = $code; Output = $text.Trim() }
}

# Espelha uma pasta (robocopy /MIR). Pastas em $ExcludeDirs nao sao copiadas nem apagadas no destino.
function Sync-Directory {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination,
        [string[]]$ExcludeDirs = @()
    )
    $robocopyArgs = @($Source, $Destination, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:2', '/W:1')
    if ($ExcludeDirs.Count -gt 0) {
        $robocopyArgs += '/XD'
        $robocopyArgs += $ExcludeDirs
    }
    & robocopy @robocopyArgs | Out-Null
    $code = $LASTEXITCODE
    if ($code -ge 8) {
        throw "robocopy falhou (codigo $code): $Source -> $Destination"
    }
    $global:LASTEXITCODE = 0
}

# Clona (raso) um repositorio git num commit fixo e confere o commit.
function Get-PinnedRepo {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Commit,
        [Parameter(Mandatory = $true)][string]$Dir
    )
    if (-not (Test-Path (Join-Path $Dir '.git'))) {
        New-Item -ItemType Directory -Force -Path $Dir | Out-Null
        Invoke-Native git @('-C', $Dir, 'init', '-q')
        Invoke-Native git @('-C', $Dir, 'remote', 'add', 'origin', $Url)
    }
    $head = Get-NativeOutput git @('-C', $Dir, 'rev-parse', '--verify', '-q', 'HEAD')
    if ($head.Output -ne $Commit) {
        Invoke-Native git @('-C', $Dir, 'fetch', '-q', '--depth', '1', 'origin', $Commit)
        Invoke-Native git @('-C', $Dir, 'checkout', '-q', '--force', 'FETCH_HEAD')
    }
    $head = Get-NativeOutput git @('-C', $Dir, 'rev-parse', 'HEAD')
    if ($head.Output -ne $Commit) {
        throw "$Dir esta em '$($head.Output)', esperado $Commit"
    }
}

# Momento do commit atual (segundos Unix); sem git, o momento atual.
function Get-CommitTimestamp {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)
    $result = Get-NativeOutput git @('-C', $RepoRoot, 'log', '-1', '--format=%ct')
    if ($result.Code -eq 0 -and $result.Output -match '^\d+$') {
        return [long]$result.Output
    }
    return [long]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
}
