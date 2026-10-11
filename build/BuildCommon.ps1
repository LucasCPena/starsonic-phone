# Funcoes comuns dos scripts de build (Windows PowerShell 5.1).
# Uso: . (Join-Path $PSScriptRoot 'BuildCommon.ps1')

# No GitHub Actions, mostra linhas como anotacoes de erro (visiveis pela API, mesmo sem acesso ao log).
# O Actions aceita ate 10 anotacoes de erro por passo; as linhas sao agrupadas.
function Write-CiError {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [string[]]$Lines = @()
    )
    if ($env:GITHUB_ACTIONS -ne 'true') {
        return
    }
    $escape = { param([string]$text) $text.Replace('%', '%25').Replace("`r", '%0D').Replace("`n", '%0A') }
    $titleText = (& $escape $Title).Replace(':', '%3A').Replace(',', '%2C')
    $prefix = $env:GITHUB_WORKSPACE
    $clean = @($Lines | ForEach-Object {
            $line = "$_"
            if ($prefix) { $line = $line.Replace($prefix + '\', '') }
            if ($line.Length -gt 400) { $line = $line.Substring(0, 400) + '...' }
            $line
        })
    if ($clean.Count -eq 0) {
        $clean = @($Title)
    }
    $chunk = 6
    for ($start = 0; $start -lt $clean.Count -and $start -lt 9 * $chunk; $start += $chunk) {
        $end = [Math]::Min($start + $chunk, $clean.Count) - 1
        $message = & $escape (($clean[$start..$end]) -join "`n")
        Write-Host "::error title=${titleText}::${message}"
    }
}

# Roda um programa externo, mostra a saida (stdout e stderr) e falha se o codigo de saida nao for 0.
# No PowerShell 5.1, stderr de programa externo com $ErrorActionPreference = 'Stop' vira erro fatal;
# por isso a preferencia e trocada so durante a chamada.
function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$File,
        [string[]]$Arguments = @()
    )
    $lines = New-Object System.Collections.Generic.List[string]
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $File @Arguments 2>&1 | ForEach-Object {
            $line = "$_"
            $lines.Add($line)
            $line
        }
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    if ($code -ne 0) {
        $errors = @($lines | Where-Object { $_ -match '(?i)(\berror\b|\bfatal\b)\s*[A-Z]*\d*\s*:' } | Select-Object -Unique)
        if ($errors.Count -eq 0) {
            $errors = @($lines | Select-Object -Last 30)
        }
        Write-CiError -Title "Falhou: $(Split-Path -Leaf $File) (codigo $code)" -Lines $errors
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

# Grava as linhas (CRLF; ASCII ou UTF-8 sem BOM) so se o arquivo nao existir ou tiver outro conteudo.
function Set-ContentIfChanged {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Lines,
        [ValidateSet('ASCII', 'UTF8')][string]$Encoding = 'ASCII'
    )
    $text = ($Lines -join "`r`n") + "`r`n"
    $writer = if ($Encoding -eq 'UTF8') { New-Object System.Text.UTF8Encoding($false) } else { [System.Text.Encoding]::ASCII }
    if ((Test-Path $Path) -and ([System.IO.File]::ReadAllText($Path, $writer) -ceq $text)) {
        return
    }
    [System.IO.File]::WriteAllText($Path, $text, $writer)
}

# Copia so se o destino nao existir ou tiver outro conteudo.
function Copy-IfChanged {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )
    if (Test-Path $Destination) {
        $same = (Get-FileHash -Algorithm SHA256 $Source).Hash -eq (Get-FileHash -Algorithm SHA256 $Destination).Hash
        if ($same) {
            return
        }
    }
    Copy-Item -Path $Source -Destination $Destination -Force
}
