# Wrapper para a atualizacao ESCALONADA (Task Scheduler, 2 horarios por dia --
# ver docs/setup-atualizacao-escalonada.md). Diferenca para atualizar-diario.ps1
# (que este arquivo substitui no agendamento das 3 maquinas):
#   1. Abre o Chrome MINIMIZADO quando precisa abrir do zero (--start-minimized)
#      -- nao deve aparecer na tela de quem estiver usando a maquina.
#   2. Chama atualizar-diario-escalonado.js, que decide via git se ja rodou
#      hoje ANTES de fazer qualquer coisa (nao abre Chrome se ja foi feito).
#
# Sem acento de proposito neste arquivo inteiro (mesmo motivo de
# atualizar-diario.ps1): PowerShell 5.1 le .ps1 sem BOM assumindo a codepage
# do sistema, nao UTF-8, e qualquer acento sai como mojibake no log.
#
# ORCAMENTO_SENHA precisa ja estar definida como variavel de ambiente
# PERSISTENTE do usuario nesta maquina -- ver SETUP-ATUALIZACAO-DIARIA.md.

$Raiz = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$PerfilDebug = Join-Path $env:USERPROFILE 'chrome-debug-profile'
$PastaLogs = Join-Path $env:USERPROFILE 'orcamento-dashboard-logs'
$PortaDebug = 9222

if (-not (Test-Path $PastaLogs)) { New-Item -ItemType Directory -Path $PastaLogs -Force -ErrorAction Stop | Out-Null }
$Carimbo = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$LogPath = Join-Path $PastaLogs "escalonado-$Carimbo.log"

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

Escrever "=== Atualizacao escalonada -- $Carimbo ==="

if (-not $env:ORCAMENTO_SENHA) {
    Escrever "ERRO: ORCAMENTO_SENHA nao esta definida nesta sessao. Configure a variavel de ambiente persistente uma vez -- ver SETUP-ATUALIZACAO-DIARIA.md."
    exit 1
}

# Heartbeat diario de "Chrome alcancavel" (chrome_ok) -- mesmo mecanismo que
# atualizar-diario.ps1 ja tinha, preservado aqui porque este script assume o
# lugar dele no agendamento das 3 maquinas. So registra depois de confirmar
# que a porta responde (ou que acabamos de abrir com sucesso), mais abaixo.
function RegistrarHeartbeatChrome {
    $CaminhoCsv = Join-Path $Raiz 'docs\heartbeat-atualizacao-diaria.csv'
    $DataHoje = Get-Date -Format 'yyyy-MM-dd'
    $Linha = "$DataHoje,$env:COMPUTERNAME,true"
    try {
        Push-Location $Raiz
        if (-not (Test-Path $CaminhoCsv)) {
            Set-Content -Path $CaminhoCsv -Value 'data,maquina,chrome_ok' -ErrorAction Stop
        }
        Add-Content -Path $CaminhoCsv -Value $Linha -ErrorAction Stop
        & git add docs/heartbeat-atualizacao-diaria.csv 2>&1 | Out-Null
        $temMudanca = (& git status --porcelain -- docs/heartbeat-atualizacao-diaria.csv 2>&1)
        if (-not $temMudanca) {
            Escrever "Heartbeat de Chrome: linha de hoje ja estava registrada, nada a commitar."
            return
        }
        & git commit -m "Heartbeat: Chrome alcancavel em $env:COMPUTERNAME ($DataHoje)" 2>&1 | Out-Null
        & git fetch origin master 2>&1 | Out-Null
        & git rebase origin/master 2>&1 | Out-Null
        $pushOk = $false
        for ($t = 1; $t -le 3; $t++) {
            & git push origin HEAD:master 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) { $pushOk = $true; break }
            & git fetch origin master 2>&1 | Out-Null
            & git rebase origin/master 2>&1 | Out-Null
        }
        if ($pushOk) {
            Escrever "Heartbeat de Chrome registrado e publicado."
        } else {
            Escrever "AVISO: heartbeat de Chrome nao conseguiu publicar depois de 3 tentativas -- seguindo mesmo assim."
            & git rebase --abort 2>&1 | Out-Null
        }
    } catch {
        Escrever "AVISO: heartbeat de Chrome falhou ($($_.Exception.Message)) -- seguindo mesmo assim."
    } finally {
        Pop-Location
    }
}

if (-not (PortaResponde)) {
    Escrever "Chrome de depuracao nao esta respondendo na porta $PortaDebug -- tentando abrir MINIMIZADO com o perfil dedicado ($PerfilDebug)..."
    $ChromeExe = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1

    if (-not $ChromeExe) {
        Escrever "ERRO: nao achei chrome.exe em nenhum caminho padrao. Instale o Google Chrome ou ajuste este script."
        exit 1
    }

    Start-Process $ChromeExe -ArgumentList "--remote-debugging-port=$PortaDebug", "--user-data-dir=`"$PerfilDebug`"", '--start-minimized'

    $tentativas = 0
    while (-not (PortaResponde) -and $tentativas -lt 10) {
        Start-Sleep -Seconds 2
        $tentativas++
    }

    if (-not (PortaResponde)) {
        Escrever "ERRO: Chrome nao respondeu na porta $PortaDebug depois de abrir. Abortando sem rodar a busca."
        exit 1
    }
    Escrever "Chrome de depuracao no ar (minimizado)."
} else {
    Escrever "Chrome de depuracao ja estava no ar."
}

RegistrarHeartbeatChrome

Escrever "Rodando atualizar-diario-escalonado.js (saida completa vai so para o log, nao para o console)..."

$TranscriptPath = Join-Path $PastaLogs "escalonado-$Carimbo.transcript.log"
Push-Location $Raiz
try {
    Start-Transcript -Path $TranscriptPath -ErrorAction Stop | Out-Null
    & node "tools\semanal\atualizar-diario-escalonado.js"
    $codigoSaida = $LASTEXITCODE
} finally {
    Stop-Transcript | Out-Null
    Pop-Location
}

Get-Content $TranscriptPath | Add-Content -Path $LogPath
Remove-Item $TranscriptPath -ErrorAction SilentlyContinue

if ($codigoSaida -eq 0) {
    Escrever "=== Concluido com sucesso (ou pulado por ja ter sido feito hoje) ==="
} else {
    Escrever "=== FALHOU (codigo $codigoSaida) -- ver log completo acima ==="
}
exit $codigoSaida
