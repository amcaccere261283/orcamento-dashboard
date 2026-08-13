# Registra a tarefa agendada da atualizacao diaria (Task Scheduler, 8h,
# todo dia) nesta maquina, apontando pro atualizar-diario.ps1 que fica ao
# lado deste script -- roda de qualquer clone do repositorio, em qualquer
# pasta, sem editar caminho nenhum a mao.
#
# Sem acento de proposito (mesmo motivo do atualizar-diario.ps1: PowerShell
# 5.1 sem BOM le UTF-8 como codepage do sistema e vira mojibake).
#
# Uso: abra o PowerShell nesta maquina e rode
#   powershell -ExecutionPolicy Bypass -File configurar-tarefa-agendada.ps1
# Pode rodar de novo a qualquer momento -- Register-ScheduledTask com
# -Force substitui a tarefa anterior em vez de duplicar.

$ErrorActionPreference = 'Stop'

$WrapperPath = Join-Path $PSScriptRoot 'atualizar-diario.ps1'
if (-not (Test-Path $WrapperPath)) {
    throw "Nao achei atualizar-diario.ps1 ao lado deste script ($WrapperPath) -- rode a partir do clone do repositorio."
}

if (-not $env:ORCAMENTO_SENHA) {
    Write-Warning "ORCAMENTO_SENHA nao esta definida nesta sessao. A tarefa vai FALHAR todo dia ate voce definir a variavel de ambiente PERSISTENTE do usuario (nao so desta sessao) -- ver SETUP-ATUALIZACAO-DIARIA.md antes de continuar."
}

$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$WrapperPath`""
$Trigger = New-ScheduledTaskTrigger -Daily -At 8:00AM
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'OrcamentoDashboard-AtualizacaoDiaria' -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description 'Busca dados novos do sond.com.br, reconstroi e publica a pagina semanal do orcamento-dashboard. Todo dia as 8h.' -Force | Out-Null

Write-Host "Tarefa 'OrcamentoDashboard-AtualizacaoDiaria' registrada -- roda todo dia as 8h, exige sessao do Windows logada (Chrome precisa de interface grafica)."
Write-Host "Para testar agora: Start-ScheduledTask -TaskName 'OrcamentoDashboard-AtualizacaoDiaria'"
Write-Host "Log de cada execucao fica em $env:USERPROFILE\orcamento-dashboard-logs\"
