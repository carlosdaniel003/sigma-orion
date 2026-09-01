# LLM local do SIGMA-S ORION

O ORION pode usar uma LLM totalmente local sem Docker, Ollama, serviço do Windows ou instalação com privilégio administrativo.

## Arquitetura

```text
Pergunta
  -> contexto persistido no SQLite
  -> SQL / Python / FTS5 + BM25
  -> evidências fundamentadas
  -> Qwen local via llama.cpp
  -> síntese / explicação
  -> auditoria no SQLite
```

A LLM não substitui os cálculos determinísticos. Se o servidor local estiver desligado, o chat continua funcionando em modo SQL + RAG.

## Runtime recomendado

- llama.cpp Windows x64 portátil
- Qwen3-4B em GGUF
- quantização inicial: `Qwen3-4B-Q4_K_M.gguf`
- API local: `http://127.0.0.1:8080/v1`
- alias usado pelo ORION: `orion-qwen`
- contexto inicial: 8192 tokens
- GPU layers inicial: 0 (CPU)

## 1. Criar as pastas

No PowerShell:

```powershell
mkdir "$env:USERPROFILE\orion-llm"
mkdir "$env:USERPROFILE\orion-llm\llama.cpp"
mkdir "$env:USERPROFILE\orion-llm\models"
```

Estrutura esperada:

```text
%USERPROFILE%\orion-llm\
  llama.cpp\
    llama-server.exe
    demais DLLs do pacote
  models\
    Qwen3-4B-Q4_K_M.gguf
```

## 2. Baixar o llama.cpp

Use as releases oficiais:

`https://github.com/ggml-org/llama.cpp/releases`

Baixe o pacote Windows x64 CPU e extraia o ZIP inteiro em:

```text
%USERPROFILE%\orion-llm\llama.cpp
```

Não copie somente `llama-server.exe`; mantenha as DLLs do pacote junto dele.

## 3. Baixar o modelo

Modelo GGUF oficial:

`https://huggingface.co/Qwen/Qwen3-4B-GGUF`

Coloque:

```text
Qwen3-4B-Q4_K_M.gguf
```

em:

```text
%USERPROFILE%\orion-llm\models
```

## 4. Testar somente a LLM

Na raiz do ORION:

```powershell
.\scripts\start-llm.ps1
```

O servidor ficará disponível em:

```text
http://127.0.0.1:8080
http://127.0.0.1:8080/v1/chat/completions
http://127.0.0.1:8080/health
```

O host é propositalmente `127.0.0.1`; não use `0.0.0.0` no notebook corporativo sem necessidade e autorização.

## 5. Rodar ORION + LLM com um único comando

```powershell
.\scripts\start-orion-local-llm.ps1
```

O launcher:

1. verifica se o `llama-server` já está ativo;
2. inicia o Qwen local se necessário;
3. espera o endpoint `/health` responder;
4. injeta as variáveis de ambiente somente na sessão;
5. inicia backend e frontend com `start-dev.ps1`;
6. encerra a LLM iniciada pelo próprio launcher ao finalizar.

Não é necessário modificar variáveis globais do Windows.

## 6. Uso com caminhos diferentes

Exemplo:

```powershell
.\scripts\start-orion-local-llm.ps1 `
  -LlamaHome "C:\ferramentas\llama.cpp" `
  -ModelPath "D:\modelos\Qwen3-4B-Q4_K_M.gguf"
```

## 7. Configuração manual pelo `.env`

Se preferir iniciar a LLM separadamente, configure:

```env
LLM_PROVIDER=llama-cpp
LLM_TIMEOUT_SECONDS=120
LOCAL_LLM_BASE_URL=http://127.0.0.1:8080/v1
LOCAL_LLM_HEALTH_URL=http://127.0.0.1:8080/health
LOCAL_LLM_MODEL=orion-qwen
LOCAL_LLM_MAX_TOKENS=800
LOCAL_LLM_TEMPERATURE=0.1
LOCAL_LLM_HEALTH_TIMEOUT_SECONDS=1.0
```

Depois rode normalmente:

```powershell
.\scripts\start-dev.ps1
```

## Comportamento do chat

### Consulta factual simples

Exemplo:

```text
Qual o SALDO do material X?
```

Fluxo preferencial:

```text
SQL -> resposta determinística
```

A LLM pode ser ignorada para reduzir latência.

### Pergunta explicativa / contextual

Exemplo:

```text
Por que esse material não está crítico mesmo com SALDO negativo?
```

Fluxo:

```text
contexto da sessão
  -> resolução da pergunta
  -> SQL / Python
  -> RAG
  -> LLM local
  -> resposta fundamentada
```

### Falha ou LLM desligada

```text
llama.cpp indisponível
  -> fallback automático
  -> SQL + SQLite/FTS5/BM25
```

O chat não deve ficar indisponível por causa da LLM.

## Segurança lógica

A LLM recebe somente evidências selecionadas pelo backend. Ela recebe instruções para:

- não recalcular fatos determinísticos;
- não inventar números;
- não alterar resultados para coincidir com o DPP Final;
- não afirmar uma causa sem evidência;
- diferenciar Cenário ORION e DPP Final;
- declarar insuficiência quando não houver evidência.

O backend rejeita uma síntese que introduza números novos não encontrados no contexto enviado e usa a resposta determinística como fallback.

## GPU depois

Comece com:

```powershell
-GpuLayers 0
```

Depois de validar CPU, é possível testar outro build do llama.cpp (por exemplo Vulkan) e aumentar `-GpuLayers`, sem alterar a integração do ORION.
