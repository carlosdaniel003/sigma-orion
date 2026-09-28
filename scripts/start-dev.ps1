param(
    [string]$NodeHome = "C:\nodejs\node-v20.19.6-win-x64"
)

$Root = Split-Path -Parent $PSScriptRoot
$PythonExe = Join-Path $Root ".venv\Scripts\python.exe"
$DevScript = Join-Path $PSScriptRoot "dev.py"

. "$PSScriptRoot\dev-env.ps1" -NodeHome $NodeHome

if (-not (Test-Path $PythonExe)) {
    throw "Ambiente virtual Python nao encontrado em: $PythonExe"
}

if (-not (Test-Path $DevScript)) {
    throw "Launcher Python nao encontrado em: $DevScript"
}

Set-Location $Root
& $PythonExe $DevScript
