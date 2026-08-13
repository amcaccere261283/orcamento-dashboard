# Atualização diária automática — setup por máquina

A página semanal (`docs/planejamento-semanal.html`) busca dados do sond.com.br
todo dia às 8h, sozinha, em até 3 máquinas (Americo, Kairo, Patrick) — qualquer
uma que esteja ligada, logada e com a sessão do sond.com.br válida naquele
momento publica os dados do dia. Não precisa das três ao mesmo tempo; é
redundância, não trabalho triplicado.

Este guia é o passo a passo pra configurar UMA máquina. Repita em cada uma.

## Antes de começar

- **Acesso de escrita ao repositório `orcamento-dashboard` no GitHub**
  (conta `amcaccere261283`). Sem isso a tarefa roda, busca os dados, mas
  falha no último passo (`git push`) todo dia. Peça pro Americo te
  adicionar como colaborador antes de seguir.
- **Google Chrome instalado** (não precisa ser a build padrão da empresa,
  qualquer instalação normal serve).
- **A senha do dashboard (`ORCAMENTO_SENHA`)** — peça ao Americo por um canal
  que não seja e-mail/chat gravado em texto puro (ex.: por telefone, ou um
  gerenciador de senhas compartilhado). **Nunca** cole a senha em nenhum
  arquivo deste repositório, nem em commit, nem em anotação — o repositório
  publica em site público, e esse é exatamente o tipo de vazamento que já
  aconteceu aqui antes.

## Passo 1 — Clonar o repositório

```
git clone https://github.com/amcaccere261283/orcamento-dashboard.git
```

Se for a primeira vez usando git nesta máquina, configure sua identidade
antes do primeiro commit (o primeiro `git commit` falha sem isso):

```
git config --global user.name "Seu Nome"
git config --global user.email "seu.email@suportesolos.com.br"
```

## Passo 2 — Definir a senha como variável de ambiente permanente

Abra o PowerShell e rode (troque `SENHA_AQUI` pelo valor real — **só nesta
janela do terminal, nunca salve em arquivo**):

```powershell
[Environment]::SetEnvironmentVariable('ORCAMENTO_SENHA', 'SENHA_AQUI', 'User')
```

Isso grava a variável no seu perfil do Windows (não no repositório, não em
texto plano visível em lugar nenhum além do registro local desta máquina).
Feche e reabra o PowerShell depois — só processos abertos DEPOIS deste
comando enxergam o valor novo.

## Passo 3 — Chrome com porta de depuração dedicada

Versões recentes do Chrome bloqueiam a porta de depuração remota no perfil
padrão por segurança — precisa de um perfil separado, só pra isso:

```powershell
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList "--remote-debugging-port=9222", "--user-data-dir=`"$env:USERPROFILE\chrome-debug-profile`""
```

Uma janela nova do Chrome abre, com um perfil zerado (sem seus favoritos,
sem suas outras sessões — é só pra isso). **Faça login em sond.com.br
manualmente nessa janela.** O cookie de sessão fica salvo nesse perfil e é
reaproveitado todo dia — não precisa logar de novo toda vez, só quando a
sessão expirar (a automação avisa por e-mail quando isso acontecer, ver
"O que fazer quando falhar" abaixo).

Pode fechar essa janela do Chrome depois de logar — o script de amanhã abre
de novo sozinho, reaproveitando o mesmo perfil e a mesma sessão salva.

## Passo 4 — Registrar a tarefa agendada

No PowerShell, dentro da pasta do repositório que você clonou:

```powershell
cd orcamento-dashboard
powershell -ExecutionPolicy Bypass -File tools\semanal\configurar-tarefa-agendada.ps1
```

Isso registra `OrcamentoDashboard-AtualizacaoDiaria` no Agendador de Tarefas
do Windows, rodando todo dia às 8h. Precisa da sua sessão do Windows logada
nesse horário (não precisa estar desbloqueada, só logada) — o Chrome precisa
de tela pra abrir.

## Passo 5 — Testar agora

```powershell
Start-ScheduledTask -TaskName 'OrcamentoDashboard-AtualizacaoDiaria'
```

Acompanhe o log gerado em `%USERPROFILE%\orcamento-dashboard-logs\` (um
arquivo novo por execução, com data e hora no nome). Se terminar com
`=== Concluido com sucesso ===`, está funcionando. Se falhar, o motivo fica
escrito no próprio log.

## O que fazer quando falhar

A causa mais comum é a sessão do sond.com.br ter expirado. Repita só o
**Passo 3** (abrir o Chrome com o perfil dedicado e logar de novo) — não
precisa refazer o resto. Você só fica sabendo que isso aconteceu se **as
três máquinas** falharem no mesmo dia: aí um e-mail de alerta chega pra
Americo, Kairo e Patrick avisando que ninguém conseguiu atualizar hoje.
Se só a sua máquina falhar mas outra tiver conseguido, não há alerta —
os dados do dia já foram publicados por quem conseguiu.
