param(
    [string]$NodeHome = "C:\nodejs\node-v20.19.6-win-x64"
)

$NodeExe = Join-Path $NodeHome "node.exe"
$NpmCli = Join-Path $NodeHome "node_modules\npm\bin\npm-cli.js"
$NpxCli = Join-Path $NodeHome "node_modules\npm\bin\npx-cli.js"

if (-not (Test-Path $NodeExe)) {
    throw "Node.js portátil não encontrado em: $NodeExe"
}

if (-not (Test-Path $NpmCli)) {
    throw "npm-cli.js não encontrado em: $NpmCli"
}

$env:PATH = "$NodeHome;$env:PATH"

function global:npm {
    & $NodeExe $NpmCli @args
}

function global:npx {
    & $NodeExe $NpxCli @args
}

Write-Host "Ambiente Node portátil carregado para esta sessão do PowerShell."
Write-Host "Node: $(& $NodeExe -v)"
Write-Host "Use 'npm' normalmente nesta sessão."
