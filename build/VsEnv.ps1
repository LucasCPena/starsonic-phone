# Entra no ambiente de desenvolvedor do Visual Studio 2022 (alvo x86) nesta sessao do PowerShell.
# Uso: . (Join-Path $PSScriptRoot 'VsEnv.ps1')
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) {
    throw "vswhere nao encontrado em $vswhere"
}
$vsPath = & $vswhere -latest -products * -version '[17.0,18.0)' `
    -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 Microsoft.VisualStudio.Component.VC.ATLMFC `
    -property installationPath
if (-not $vsPath) {
    throw 'Visual Studio 2022 com C++ e MFC nao encontrado.'
}
Import-Module (Join-Path $vsPath 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll')
Enter-VsDevShell -VsInstallPath $vsPath -SkipAutomaticLocation -DevCmdArguments '-arch=x86 -host_arch=amd64' | Out-Null
