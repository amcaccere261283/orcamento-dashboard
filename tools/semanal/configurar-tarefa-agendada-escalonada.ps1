# Registra a tarefa da atualizacao ESCALONADA nesta maquina -- 2 disparos por
# dia (rodada normal + rodada de seguranca 1h depois), no minuto que a
# ordem desta maquina exige (ver docs/setup-atualizacao-escalonada.md):
#   Patrick (1a da fila)  -> -MinutoOffset 0   (dispara as 8:00 e 9:00)
#   Kairo   (2a da fila)  -> -MinutoOffset 15  (dispara as 8:15 e 9:15)
#   Americo (3a da fila)  -> -MinutoOffset 30  (dispara as 8:30 e 9:30)
#
# Desativa a tarefa antiga (OrcamentoDashboard-AtualizacaoDiaria), que este
# mecanismo substitui -- ver a secao "Descontinuado do Task Scheduler" do
# spec (docs/superpowers/specs/2026-08-18-atualizacao-diaria-escalonada-design.md).
#
# Sem acento de proposito (mesmo motivo dos outros .ps1 deste projeto).
#
# Uso: powershell -ExecutionPolicy Bypass -File configurar-tarefa-agendada-escalonada.ps1 -MinutoOffset 0

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(0, 15, 30)]
    [int]$MinutoOffset
)

$ErrorActionPreference = 'Stop'

$WrapperPath = Join-Path $PSScriptRoot 'atualizar-diario-escalonado.ps1'
if (-not (Test-Path $WrapperPath)) {
    throw "Nao achei atualizar-diario-escalonado.ps1 ao lado deste script ($WrapperPath) -- rode a partir do clone do repositorio."
}

if (-not $env:ORCAMENTO_SENHA) {
    Write-Warning "ORCAMENTO_SENHA nao esta definida nesta sessao. A tarefa vai FALHAR ate voce definir a variavel de ambiente PERSISTENTE do usuario -- ver SETUP-ATUALIZACAO-DIARIA.md."
}

$TarefaAntiga = 'OrcamentoDashboard-AtualizacaoDiaria'
if (Get-ScheduledTask -TaskName $TarefaAntiga -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TarefaAntiga -Confirm:$false
    Write-Host "Tarefa antiga '$TarefaAntiga' removida (substituida pelo mecanismo escalonado)."
}

$Trigger1 = New-ScheduledTaskTrigger -Daily -At (Get-Date -Hour 8 -Minute $MinutoOffset -Second 0)
$Trigger2 = New-ScheduledTaskTrigger -Daily -At (Get-Date -Hour 9 -Minute $MinutoOffset -Second 0)
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$WrapperPath`""
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'OrcamentoDashboard-AtualizacaoEscalonada' -Action $Action -Trigger @($Trigger1, $Trigger2) -Settings $Settings -Principal $Principal -Description "Atualizacao escalonada do Planejamento Semanal (Patrick/Kairo/Americo) -- 2 disparos diarios, minuto $MinutoOffset." -Force | Out-Null

Write-Host "Tarefa 'OrcamentoDashboard-AtualizacaoEscalonada' registrada -- dispara as 8:$('{0:D2}' -f $MinutoOffset) e 9:$('{0:D2}' -f $MinutoOffset), todo dia."
Write-Host "Para testar agora: Start-ScheduledTask -TaskName 'OrcamentoDashboard-AtualizacaoEscalonada'"
Write-Host "Log de cada execucao fica em $env:USERPROFILE\orcamento-dashboard-logs\"
