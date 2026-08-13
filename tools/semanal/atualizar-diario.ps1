# Wrapper para a atualizacao diaria agendada (Task Scheduler, 8h, todo dia).
# Roda em ate 3 maquinas (ver docs/setup-atualizacao-diaria.md) -- cada uma
# tenta abrir o Chrome com um perfil de depuracao DEDICADO (nunca o perfil
# padrao: Chrome recente bloqueia --remote-debugging-port nele) e reaproveita
# a sessao/cookie ja salva nesse perfil de um login manual anterior. Se a
# sessao do sond.com.br tiver expirado, a busca vai falhar mais adiante e
# ninguem aqui tenta logar sozinho -- e exatamente o caso que o alerta por
# e-mail (workflow separado) cobre.
#
# Sem acento de proposito neste arquivo inteiro (inclusive comentarios):
# PowerShell 5.1 le .ps1 sem BOM assumindo a codepage do sistema, nao UTF-8,
# e qualquer acento sai como mojibake no log e no console -- medido direto
# (2026-08-13): "Atualizacao" virava "AtualizaÃ§Ã£o".
#
# Nao tem segredo nenhum neste arquivo: ORCAMENTO_SENHA precisa ja estar
# definida como variavel de ambiente PERSISTENTE do usuario nesta maquina
# ([Environment]::SetEnvironmentVariable('ORCAMENTO_SENHA', 'valor', 'User')
# ou 'setx ORCAMENTO_SENHA "valor"'), uma vez, fora deste repositorio -- ver
# o guia de setup. Task Scheduler le o ambiente do usuario do zero a cada
# disparo, entao pega o valor persistido mesmo que a sessao que gravou ja
# tenha fechado -- diferente de um terminal ja aberto, que so ve o valor
# antigo ate reabrir.

$Raiz = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$PerfilDebug = Join-Path $env:USERPROFILE 'chrome-debug-profile'
$PastaLogs = Join-Path $env:USERPROFILE 'orcamento-dashboard-logs'
$PortaDebug = 9222

if (-not (Test-Path $PastaLogs)) { New-Item -ItemType Directory -Path $PastaLogs -Force -ErrorAction Stop | Out-Null }
$Carimbo = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$LogPath = Join-Path $PastaLogs "atualizar-$Carimbo.log"

function Escrever($linha) {
    $linhaComHora = "[$(Get-Date -Format 'HH:mm:ss')] $linha"
    Write-Host $linhaComHora
    Add-Content -Path $LogPath -Value $linhaComHora -ErrorAction Stop
}

function PortaResponde {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$PortaDebug/json/version" -UseBasicParsing -TimeoutSec 3
        return $r.StatusCode -eq 200
    } catch {
        return $false
    }
}

Escrever "=== Atualizacao diaria -- $Carimbo ==="

if (-not $env:ORCAMENTO_SENHA) {
    Escrever "ERRO: ORCAMENTO_SENHA nao esta definida nesta sessao. Configure a variavel de ambiente persistente uma vez -- ver docs/setup-atualizacao-diaria.md."
    exit 1
}

if (-not (PortaResponde)) {
    Escrever "Chrome de depuracao nao esta respondendo na porta $PortaDebug -- tentando abrir com o perfil dedicado ($PerfilDebug)..."
    $ChromeExe = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1

    if (-not $ChromeExe) {
        Escrever "ERRO: nao achei chrome.exe em nenhum caminho padrao. Instale o Google Chrome ou ajuste este script."
        exit 1
    }

    Start-Process $ChromeExe -ArgumentList "--remote-debugging-port=$PortaDebug", "--user-data-dir=`"$PerfilDebug`""

    $tentativas = 0
    while (-not (PortaResponde) -and $tentativas -lt 10) {
        Start-Sleep -Seconds 2
        $tentativas++
    }

    if (-not (PortaResponde)) {
        Escrever "ERRO: Chrome nao respondeu na porta $PortaDebug depois de abrir. Abortando sem rodar a busca."
        exit 1
    }
    Escrever "Chrome de depuracao no ar."
} else {
    Escrever "Chrome de depuracao ja estava no ar."
}

Escrever "Rodando atualizar-arquivos.js (saida completa vai so para o log, nao para o console)..."

# Start-Transcript captura tudo que o processo nativo escreve (stdout E
# stderr) sem passar pelo pipeline do PowerShell -- evita de proposito o
# padrao "node ... 2>&1 | ForEach-Object", que sob $ErrorActionPreference
# = 'Stop' transforma QUALQUER linha de stderr do node (aviso normal,
# nao so erro fatal) num NativeCommandError que aborta o script inteiro.
# Medido (2026-08-13): uma unica busca reportando falha parcial (uma das
# cinco, tratada e contornada pelo proprio atualizar-arquivos.js) matou
# o wrapper inteiro antes do build/publish rodarem.
$TranscriptPath = Join-Path $PastaLogs "atualizar-$Carimbo.transcript.log"
Push-Location $Raiz
try {
    Start-Transcript -Path $TranscriptPath -ErrorAction Stop | Out-Null
    & node "tools\semanal\atualizar-arquivos.js"
    $codigoSaida = $LASTEXITCODE
} finally {
    Stop-Transcript | Out-Null
    Pop-Location
}

Get-Content $TranscriptPath | Add-Content -Path $LogPath
Remove-Item $TranscriptPath -ErrorAction SilentlyContinue

if ($codigoSaida -eq 0) {
    Escrever "=== Concluido com sucesso ==="
} else {
    Escrever "=== FALHOU (codigo $codigoSaida) -- ver log completo acima ==="
}
exit $codigoSaida
