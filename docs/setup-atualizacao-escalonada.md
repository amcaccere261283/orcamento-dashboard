# Setup da atualização escalonada (Patrick → Kairo → Américo)

Substitui a tarefa `OrcamentoDashboard-AtualizacaoDiaria` (as 3 máquinas rodando
tudo às 8h ao mesmo tempo) por um mecanismo escalonado — cada máquina num horário
diferente, checando antes se alguém já publicou hoje. Ver o design completo em
`docs/superpowers/specs/2026-08-18-atualizacao-diaria-escalonada-design.md`.

## Pré-requisito (as 3 máquinas)

Mesmo de sempre — `ORCAMENTO_SENHA` definida como variável de ambiente
**persistente** do usuário (não só da sessão atual): ver
`SETUP-ATUALIZACAO-DIARIA.md`. Sem isso a tarefa falha todo dia.

## Configurar cada máquina

Rodar **uma vez** em cada máquina, com o offset que corresponde à posição dela na
fila:

| Máquina | Posição | Comando |
|---|---|---|
| Patrick (`COMPUTADOR053`) | 1ª (8:00 / 9:00) | `powershell -ExecutionPolicy Bypass -File tools\semanal\configurar-tarefa-agendada-escalonada.ps1 -MinutoOffset 0` |
| Kairo | 2ª (8:15 / 9:15) | `powershell -ExecutionPolicy Bypass -File tools\semanal\configurar-tarefa-agendada-escalonada.ps1 -MinutoOffset 15` |
| Américo (`COMP-074`) | 3ª (8:30 / 9:30) | `powershell -ExecutionPolicy Bypass -File tools\semanal\configurar-tarefa-agendada-escalonada.ps1 -MinutoOffset 30` |

O script remove a tarefa antiga (`OrcamentoDashboard-AtualizacaoDiaria`) sozinho,
se ela existir naquela máquina.

## Pendência: hostname do Kairo

`tools/semanal/coordenacao-volume.js` tem um mapa (`NOMES_AMIGAVEIS`) que traduz o
hostname de cada máquina pro nome que aparece no aviso da tela ("Atualizado às
08:15 por Kairo"). Hoje só `COMPUTADOR053` (Patrick) e `COMP-074` (Américo) estão
mapeados — **o hostname da máquina do Kairo ainda não foi confirmado**. Sem o mapa,
o aviso mostra o hostname cru dele (funciona, só não fica com o nome bonito). Pra
completar: rodar `echo %COMPUTERNAME%` na máquina dele, acrescentar a linha no mapa
e publicar.

## Testar sem esperar o horário

Em qualquer uma das 3 máquinas, depois de configurada:

```
Start-ScheduledTask -TaskName 'OrcamentoDashboard-AtualizacaoEscalonada'
```

Acompanhar o log mais recente em `%USERPROFILE%\orcamento-dashboard-logs\`. Se
outra máquina já publicou hoje, o log mostra "Já atualizado hoje por outra máquina
-- nada a fazer." e o Chrome nem chega a abrir.
