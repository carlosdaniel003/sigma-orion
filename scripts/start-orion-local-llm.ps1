param(
    [string]$NodeHome = "C:\nodejs\node-v20.19.6-win-x64",
    [string]$LlamaHome = "$env:USERPROFILE\orion-llm\llama.cpp",
    [string]$ModelPath = "$env:USERPROFILE\orion-llm\models\Qwen3-4B-Q4_K_M.gguf",
    [int]$Port = 8080,
    [int]$Context = 8192,
    [int]$GpuLayers = 0,
    [string]$Alias = "orion-qwen"
)

$ErrorActionPreference = "Stop"
$ServerExe = Join-Path $LlamaHome "llama-server.exe"
$StartDev = Join-Path $PSScriptRoot "start-dev.ps1"
$HealthUrl = "http://127.0.0.1:$Port/health"
$BaseUrl = "http://127.0.0.1:$Port/v1"
$OwnedLlmProcess = $null

function Test-OrionLlmHealth {
    try {
        $null = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 1
        return $true
    }
    catch {
        return $false
    }
}

if (-not (Test-Path $StartDev)) {
    throw "Launcher do ORION nao encontrado em: $StartDev"
}

if (-not (Test-OrionLlmHealth)) {
    if (-not (Test-Path $ServerExe)) {
        throw @"
llama-server.exe nao encontrado em:
$ServerExe

Baixe o llama.cpp Windows x64 e extraia nessa pasta.
"@
    }

    if (-not (Test-Path $ModelPath)) {
        throw @"
Modelo Qwen GGUF nao encontrado em:
$ModelPath

Coloque Qwen3-4B-Q4_K_M.gguf nessa pasta ou informe -ModelPath.
"@
    }

    Write-Host "Iniciando Qwen local via llama.cpp..."
    $Arguments = @(
        "-m", "`"$ModelPath`"",
        "--host", "127.0.0.1",
        "--port", "$Port",
        "-c", "$Context",
        "-ngl", "$GpuLayers",
        "--alias", "$Alias"
    )
    $OwnedLlmProcess = Start-Process -FilePath $ServerExe -ArgumentList $Arguments -PassThru

    $Ready = $false
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        if ($OwnedLlmProcess.HasExited) {
            throw "llama-server encerrou antes de ficar pronto. Codigo: $($OwnedLlmProcess.ExitCode)"
        }
        if (Test-OrionLlmHealth) {
            $Ready = $true
            break
        }
        Start-Sleep -Seconds 1
    }
    if (-not $Ready) {
        throw "llama-server nao respondeu em $HealthUrl."
    }
}
else {
    Write-Host "LLM local ja esta ativa."
}

# Variaveis herdadas pelo backend iniciado nesta mesma sessao/processo.
$env:LLM_PROVIDER = "llama-cpp"
$env:LOCAL_LLM_BASE_URL = $BaseUrl
$env:LOCAL_LLM_HEALTH_URL = $HealthUrl
$env:LOCAL_LLM_MODEL = $Alias
$env:LOCAL_LLM_MAX_TOKENS = "800"
$env:LOCAL_LLM_TEMPERATURE = "0.1"
$env:LLM_TIMEOUT_SECONDS = "180"

Write-Host ("=" * 68)
Write-Host "ORION - AMBIENTE LOCAL COM LLM"
Write-Host ("=" * 68)
Write-Host "LLM     : llama.cpp / $Alias (interna)"
Write-Host "RAG     : SQLite FTS5 + BM25"
Write-Host "Backend : interno; acessado pelo frontend"
Write-Host "Acesso  : o link unico da rede sera exibido abaixo"
Write-Host ("=" * 68)

try {
    & $StartDev -NodeHome $NodeHome
}
finally {
    if ($OwnedLlmProcess -and -not $OwnedLlmProcess.HasExited) {
        Write-Host "Encerrando LLM local iniciada por este launcher..."
        Stop-Process -Id $OwnedLlmProcess.Id -Force -ErrorAction SilentlyContinue
    }
}
