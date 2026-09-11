# Registra a tarefa diaria que reconstroi e publica o dashboard de orcamento
# (tools/orcamento/atualizar-orcamento-diario.js). So faz sentido na maquina
# que enxerga a MATRIZ (G:\Meu Drive\PMO\... ou ORCAMENTO_CAMINHO_MATRIZ) --
# hoje a do Americo (COMP-074). Nao depende de Chrome nem do sond.com.br.
#
# Sem acento de proposito (PowerShell 5.1 le .ps1 sem BOM na codepage do
# sistema -- ver atualizar-diario.ps1).
#
# Uso (uma vez, no clone do repositorio):
#   powershell -ExecutionPolicy Bypass -File tools\orcamento\configurar-tarefa-orcamento-diario.ps1

$ErrorActionPreference = 'Stop'
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PastaLogs = Join-Path $env:USERPROFILE 'orcamento-dashboard-logs'
if (-not (Test-Path $PastaLogs)) { New-Item -ItemType Directory -Path $PastaLogs -Force | Out-Null }
$Log = Join-Path $PastaLogs 'orcamento-diario.log'

if (-not [Environment]::GetEnvironmentVariable('ORCAMENTO_SENHA', 'User')) {
    Write-Warning "ORCAMENTO_SENHA nao esta definida como variavel PERSISTENTE do usuario -- a tarefa vai falhar ate definir (ver SETUP-ATUALIZACAO-DIARIA.md)."
}

$Nome = 'OrcamentoDashboard-BuildDiario'
$Trigger = New-ScheduledTaskTrigger -Daily -At (Get-Date -Hour 7 -Minute 0 -Second 0)
$Action = New-ScheduledTaskAction -Execute 'cmd.exe' -WorkingDirectory $Raiz -Argument "/c node tools\orcamento\atualizar-orcamento-diario.js >> `"$Log`" 2>&1"
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $Nome -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description 'Build diario do dashboard de orcamento (alimenta o Backlog das medicoes com realizado + tendencia 2026).' -Force | Out-Null

Write-Host "Tarefa '$Nome' registrada -- dispara as 7:00, todo dia (ou assim que a maquina ligar, se estava desligada)."
Write-Host "Testar agora: Start-ScheduledTask -TaskName '$Nome'"
Write-Host "Log: $Log"
