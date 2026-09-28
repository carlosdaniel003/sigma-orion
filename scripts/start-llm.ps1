param(
    [string]$LlamaHome = "$env:USERPROFILE\orion-llm\llama.cpp",
    [string]$ModelPath = "$env:USERPROFILE\orion-llm\models\Qwen3-4B-Q4_K_M.gguf",
    [int]$Port = 8080,
    [int]$Context = 8192,
    [int]$GpuLayers = 0,
    [string]$Alias = "orion-qwen"
)

$ErrorActionPreference = "Stop"
$ServerExe = Join-Path $LlamaHome "llama-server.exe"

if (-not (Test-Path $ServerExe)) {
    throw @"
llama-server.exe nao encontrado em:
$ServerExe

Baixe o pacote Windows x64 do llama.cpp e extraia para:
$LlamaHome
"@
}

if (-not (Test-Path $ModelPath)) {
    throw @"
Modelo GGUF nao encontrado em:
$ModelPath

Coloque o arquivo Qwen3-4B-Q4_K_M.gguf nessa pasta ou informe -ModelPath.
"@
}

Write-Host ("=" * 68)
Write-Host "ORION - LLM LOCAL"
Write-Host ("=" * 68)
Write-Host "Runtime : llama.cpp"
Write-Host "Servidor: $ServerExe"
Write-Host "Modelo  : $ModelPath"
Write-Host "API     : http://127.0.0.1:$Port/v1"
Write-Host "Health  : http://127.0.0.1:$Port/health"
Write-Host "Contexto: $Context"
Write-Host "GPU     : $GpuLayers camada(s)"
Write-Host "Ctrl+C encerra somente a LLM."
Write-Host ("=" * 68)

& $ServerExe `
    -m $ModelPath `
    --host 127.0.0.1 `
    --port $Port `
    -c $Context `
    -ngl $GpuLayers `
    --alias $Alias
