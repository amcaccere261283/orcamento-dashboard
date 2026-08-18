# Atualização diária escalonada entre 3 máquinas (Patrick → Kairo → Américo) — design

Data: 2026-08-18. Página: Planejamento Semanal (`docs/planejamento-semanal.html`).
Escopo: só o mecanismo de disparo/coordenação da atualização diária e o aviso na tela
— nenhuma regra de negócio das abas muda.

## O problema

Hoje até 3 máquinas (`supor`/Patrick, Kairo, `amcac`/Américo — ver "Terceira máquina" e
"Automação diária... nesta máquina" no `CLAUDE.md`) rodam `atualizar-diario.ps1` →
`atualizar-arquivos.js` **no mesmo horário (8h)**, cada uma buscando as 5 fontes de
novo e tentando publicar. Isso já causou pelo menos um conflito de rebase real (o
heartbeat de hoje, resolvido no início desta sessão) e é trabalho triplicado contra o
sond.com.br sem necessidade — só a PRIMEIRA publicação do dia importa.

## Decisão 1 — escalonamento por horário, sem lógica de identidade

Três disparos por dia, mesmo script nas 3 máquinas, só o horário do Task Scheduler
muda:

| Ordem | Máquina | Horário |
|---|---|---|
| 1ª | Patrick (`supor`) | 08:00 |
| 2ª | Kairo | 08:15 |
| 3ª | Américo (`amcac`) | 08:30 |

**2ª rodada de segurança, 1h depois, mesma ordem** (Patrick 09:00 → Kairo 09:15 →
Américo 09:30) — cobre o cenário "as 3 máquinas falharam às 8h" (ninguém logado no
Chrome em lugar nenhum, por exemplo). Não é código novo: é a MESMA checagem "já teve
sucesso hoje?" da Decisão 3, então se a 1ª rodada já publicou, os 3 disparos das 9h
saem cedo sem fazer nada — só mais 6 entradas no Task Scheduler (3 máquinas × 2
rodadas), nenhuma lógica nova no script.

O script não precisa saber "quem é" nem "que rodada é esta": ele sempre pergunta
primeiro "já teve sucesso hoje?" — às 8h a resposta é sempre não (é o primeiro
disparo do dia em qualquer máquina), então o 1º a disparar sempre roda; às 9h a
resposta só é não se a rodada das 8h inteira falhou. Isso também significa que se a
ordem precisar mudar um dia (reagendar o Task Scheduler de uma máquina), nada no código
muda.

## Decisão 2 — arquivo de coordenação novo, separado do heartbeat existente

Novo arquivo, versionado: `dist/heartbeat-atualizacao-volume.csv` (copiado para
`docs/` como os outros arquivos publicados). Colunas:

```
data_hora,maquina,resultado,detalhe
2026-08-18T08:03:12-03:00,COMP-074,ok,
2026-08-18T08:16:40-03:00,KAIRO-PC,falhou,Avanços (furos); Lab Realizado (ensaios)
```

- `data_hora`: ISO 8601 completo, fuso America/Sao_Paulo (mesmo padrão de
  `tools/comum/datas.js`) — precisa da HORA, não só da data, porque o aviso na tela
  mostra "às HH:mm".
- `maquina`: `$env:COMPUTERNAME`, igual ao heartbeat diário existente — sem
  tradução pra "Patrick/Kairo/Américo" no arquivo (evita hardcode de hostname no
  script); a tradução pra nome amigável acontece só na hora de montar o texto do
  aviso (mapa pequeno em `render-semanal.js`, com o hostname cru como
  fallback caso apareça uma 4ª máquina não mapeada).

  Hostnames confirmados nesta sessão (via `$env:COMPUTERNAME` local e autoria dos
  commits de heartbeat, `git log --grep`): `COMPUTADOR053` = Patrick (esta máquina),
  `COMP-074` = Américo. **O hostname do Kairo ainda não apareceu em nenhum commit
  de heartbeat** — precisa ser confirmado com ele antes do mapa ir pro código (senão
  o aviso na tela mostra o hostname cru pra ele, que já é um fallback aceitável, só
  não é o nome bonito).
- `resultado`: `ok` se **pelo menos 1 das 5 buscas** (`BUSCAS` em
  `atualizar-arquivos.js`) teve sucesso; `falhou` se as 5 falharam (inclusive o caso
  de Chrome nem responder). Uma linha `falhou` NÃO conta como "já atualizado hoje" —
  a próxima máquina da fila tenta mesmo assim.
- `detalhe`: nomes das buscas que falharam, `; `-separado, vazio quando `resultado=ok`
  (mesmo texto que já vai no corpo do commit hoje).

**Por que um arquivo novo, e não estender `docs/heartbeat-atualizacao-diaria.csv`**:
aquele arquivo tem consumidor externo (`alertas-email.yml`, que decide se avisa por
e-mail com base em `chrome_ok`) e um formato mais simples (só data, não data+hora).
Mudar sua forma arrisca quebrar esse workflow sem necessidade — os dois arquivos
respondem perguntas diferentes ("o Chrome respondeu hoje" vs. "os dados foram
publicados hoje, por quem, às que horas") e continuam existindo em paralelo, cada um
escrito no seu próprio ponto do pipeline.

## Decisão 3 — checagem lê direto do git, nunca abre o Chrome pra isso

Antes de decidir se roda, o script escalonado faz só:

```
git fetch origin master
git show origin/master:dist/heartbeat-atualizacao-volume.csv
```

(sem merge/rebase local ainda — só leitura do conteúdo publicado). Se existir alguma
linha com `data_hora` de **hoje** (data em America/Sao_Paulo) e `resultado=ok`, loga
`"Já atualizado hoje às HH:mm por <máquina> -- nada a fazer."` e sai com código 0,
**sem abrir o Chrome**. Isso responde à pergunta que motivou a rodada de perguntas
desta sessão: não precisa renderizar o dashboard publicado pra saber se já foi
atualizado — o dado de coordenação e o aviso na tela vêm da MESMA fonte
(`heartbeat-atualizacao-volume.csv`), só que o aviso na tela é decorativo (lido depois,
embutido no build) e a checagem é funcional (lida antes, direto do git).

Se o arquivo ainda não existe no `origin/master` (primeira execução depois de
publicar este mecanismo), trata como "nunca atualizado hoje" — roda normalmente.

## Decisão 4 — ordem de operações dentro de uma execução que decide rodar

Diferente de `atualizar-arquivos.js` hoje (busca → build → publica), a versão
escalonada precisa gravar o heartbeat **entre** a busca e o build, pra o aviso na tela
sair certo no HTML deste mesmo build:

```
1. git fetch + checagem (Decisão 3) -- sai cedo se já feito
2. Garantir Chrome acessível (mesma lógica de atualizar-diario.ps1),
   abrindo com --start-minimized se precisar abrir do zero
3. rodarBuscas() -- as mesmas 5 buscas de sempre, reaproveitadas de
   atualizar-arquivos.js (exportar a função, hoje é só interna)
4. Decidir resultado (ok/falhou) e escrever a linha nova em
   dist/heartbeat-atualizacao-volume.csv
5. build-dashboard.js -- lê a última linha 'ok' desse CSV (que já inclui
   a linha do passo 4, se for o caso) e embute o aviso no HTML
6. Copiar dist/* -> docs/* (arquivos de sempre + o heartbeat novo)
7. git add / commit / push (reaproveita publicar(), com o mesmo
   retry+rebase que atualizar-arquivos.js já tem)
```

`atualizar-arquivos.js` continua existindo como está, pra rodar manualmente quando
alguém quiser forçar as 5 buscas na hora (ex.: retomando uma sessão e querendo dado
fresco imediatamente) — só sai do Task Scheduler das 3 máquinas, substituído por este
script novo. `rodarBuscas` precisa virar exportada (`module.exports`) pra o script
novo reaproveitar sem duplicar a lista de 5 buscas.

## Decisão 5 — aviso na tela

Reaproveita o slot que já existe (`markupCabecalho({ subtitulo, ... })`,
`tools/comum/render-shell.js:317`), hoje só com `formatarMesAno(geradoEm)` ("Ago/2026").
Passa a ser:

```
Ago/2026 · Atualizado às 08:15 por Kairo
```

Sem elemento novo de HTML/CSS — só concatena no `subtitulo` que
`render-semanal.js:3052` já monta e escapa. Se o heartbeat não tiver nenhuma linha
`ok` ainda (dashboard nunca passou por este mecanismo), a segunda parte simplesmente
não aparece — `formatarMesAno(geradoEm)` sozinho, como é hoje.

## Decisão 6 — se as 3 falharem na rodada das 8h

A rodada das 9h (Decisão 1) cobre esse caso automaticamente. Só se as 6 tentativas
do dia (3 máquinas × 2 rodadas) falharem é que o dia fica mesmo sem atualização — o
alerta por e-mail existente (`alertas-email.yml`, baseado no heartbeat diário de
`chrome_ok`) já cobre esse cenário residual; nada novo precisa ser criado pra isso
agora.

## O que NÃO muda

- As 5 buscas em si (`atualizar-avancos-online.js` etc.) — só quem as chama.
- `docs/heartbeat-atualizacao-diaria.csv` e o workflow de alerta por e-mail que lê ele.
- `atualizar-arquivos.js` como comando manual.
- Qualquer regra de negócio das abas do dashboard.
- O dashboard de orçamento (`tools/orcamento/`).

## Arquivos afetados (visão geral, sem pseudocódigo linha a linha — fica pro plano)

- **Novo**: `tools/semanal/atualizar-diario-escalonado.js` (o fluxo da Decisão 4).
- **Novo**: `tools/semanal/atualizar-diario-escalonado.ps1` (wrapper Task Scheduler —
  cópia de `atualizar-diario.ps1` com `--start-minimized` na abertura do Chrome e
  chamando o script novo em vez de `atualizar-arquivos.js` direto).
- **Novo**: `docs/setup-atualizacao-escalonada.md` (passo a passo pra configurar as
  DUAS tarefas por máquina no Task Scheduler -- rodada das 8h e rodada de segurança
  das 9h, mesmo script, só o horário muda -- 6 entradas no total entre as 3 máquinas.
  A sessão atual só consegue configurar e testar de verdade as desta máquina,
  Patrick/`supor`; Kairo e Américo precisam rodar isso localmente ou pedir pra Claude
  Code fazer na hora certa
  em cada máquina).
- **Alterado**: `tools/semanal/atualizar-arquivos.js` — exporta `rodarBuscas` e
  `publicar` (hoje internas) pra reaproveitar sem duplicar.
- **Alterado**: `tools/semanal/build-dashboard.js` — lê
  `dist/heartbeat-atualizacao-volume.csv` (opcional: se não existir, comporta-se como
  hoje) e passa o texto do aviso pra `renderSemanal`.
- **Alterado**: `tools/semanal/render-semanal.js` — concatena o aviso no `subtitulo`
  (Decisão 5).
- **Descontinuado do Task Scheduler** (arquivo em si não é apagado): a tarefa
  `OrcamentoDashboard-AtualizacaoDiaria` (`atualizar-diario.ps1`) sai do agendamento
  das 3 máquinas, substituída pela nova. O heartbeat diário de `chrome_ok` continua
  existindo — precisa de um lugar novo pra ser escrito, já que não é mais
  `atualizar-diario.ps1` quem dispara toda hora; o mais simples é o `.ps1` novo
  registrar esse heartbeat também (mesma função `RegistrarHeartbeat`, chamada 1x por
  execução, nas 3 máquinas — igual a hoje).

## Testes

- `rodarBuscas`/`publicar` exportados de `atualizar-arquivos.js`: teste que confirma
  que `main()` continua se comportando igual (nenhuma regressão no comando manual).
- Parsing/decisão do heartbeat de coordenação: linha de hoje com `ok` → pula; linha de
  hoje com `falhou` → roda; linha de ontem → roda; arquivo ausente → roda.
- `resultado` calculado certo a partir de uma lista de resultados de busca (todas ok →
  ok; uma ok → ok; todas falha → falhou).
- Texto do subtítulo: com heartbeat vazio (sem linha `ok`) mostra só o mês/ano; com
  linha `ok` mostra "Ago/2026 · Atualizado às HH:mm por <nome amigável>".
- Mapa de hostname → nome amigável: hostname desconhecido cai no próprio hostname cru
  (não quebra, não esconde a informação).

Suíte inteira (`node --test test/*.js`) precisa fechar verde antes de qualquer
publish, como sempre.

## Fora de escopo

- Ciclo de hora em hora (descartado durante o brainstorm em favor de 1x/dia).
- Cobrir só Sondagens/Lab separadamente das outras 3 buscas (descartado — a versão
  final cobre as 5 juntas).
- Mudar a lógica de negócio de qualquer aba.
- Configurar de fato o Task Scheduler nas máquinas do Kairo e do Américo (só o guia
  em `docs/setup-atualizacao-escalonada.md` fica pronto; a aplicação nas outras 2
  máquinas depende de acesso a elas).
