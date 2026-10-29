param(
    [string]$NodeHome = "C:\nodejs\node-v20.19.6-win-x64"
)

$NodeExe = Join-Path $NodeHome "node.exe"
$NpmCli = Join-Path $NodeHome "node_modules\npm\bin\npm-cli.js"
$NpxCli = Join-Path $NodeHome "node_modules\npm\bin\npx-cli.js"

if (-not (Test-Path $NodeExe)) {
    throw "Node.js portatil nao encontrado em: $NodeExe"
}

if (-not (Test-Path $NpmCli)) {
    throw "npm-cli.js nao encontrado em: $NpmCli"
}

$env:PATH = "$NodeHome;$env:PATH"

function global:npm {
    & $NodeExe $NpmCli @args
}

function global:npx {
    & $NodeExe $NpxCli @args
}

Write-Host "Ambiente Node portatil carregado para esta sessao do PowerShell."
Write-Host "Node: $(& $NodeExe -v)"
Write-Host "Use 'npm' normalmente nesta sessao."
