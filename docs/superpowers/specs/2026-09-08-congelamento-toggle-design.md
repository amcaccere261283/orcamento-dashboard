# Congelamento da semana vira toggle on/off por semana

Data: 2026-09-08

## Contexto

O Consolidado (Planejamento Semanal) tem hoje um mecanismo de "congelamento"
(2026-09-01, ver `docs/superpowers/specs/2026-08-31-congelar-semana-botao-design.md`
e a seção "Congelamento da semana por botão" do `CLAUDE.md`): um botão
"Congelar semana de DD/MM" grava, uma única vez, um snapshot da Tendência de
cada registro naquela semana numa Google Sheet. A gravação é **write-once** —
reclique é recusado pelo Apps Script (`{erro:'ja-congelada'}`); desfazer exige
um botão separado que apaga as linhas com `confirm()`. Só a **próxima
segunda-feira** pode ser congelada por esse botão. Uma semana não congelada é
sempre recalculada ao vivo, em toda leitura — nada é persistido para ela.

O dono do projeto quer outro modelo: um **toggle on/off por semana**,
acionável por qualquer pessoa a qualquer momento, sem a trava de "só uma vez":

- **Congelada (ON):** clicar em "Atualizar dados" não altera nada daquela
  semana.
- **Aberta (OFF):** clicar em "Atualizar dados" recalcula e grava a "linha de
  base da semana" — um ponto persistido por semana, não um recálculo efêmero
  de tela.

Decisões já fechadas com o dono do projeto (perguntas feitas antes deste
documento):

1. O toggle vale para **qualquer semana visível no seletor do Consolidado**,
   não só a próxima segunda.
2. Quando OFF, a atualização da linha de base **é gravada na Sheet** a cada
   clique em "Atualizar dados" — não fica só na tela de quem clicou.
3. O toggle OFF **substitui** o botão "Desfazer congelamento" atual — não há
   mais uma ação separada e destrutiva de apagar linhas pela UI.

## Modelo de dados

A aba `Congelamento` (pontos por semana × registro: `Ano, SemanaInicio,
Chave, Volume, Financeiro, Equipe, ProdutividadeMedia, Autor, CongeladoEm`)
continua existindo sem mudança de esquema — ela guarda os *valores*.

Uma nova aba, `CongelamentoEstado`, guarda o *estado* de cada semana,
independente dos valores: uma linha por semana, chaveada pela **segunda-feira
real** (a mesma normalização que `segundaDaSemana`, em
`tools/semanal/congelar-tendencia-semanal.js`, já calcula — não pelos
fragmentos de mês que `fragmentosDaSemanaAlvo` produz, já que uma semana que
cruza virada de mês tem duas chaves de fragmento mas é uma trava só).
Colunas: `SemanaInicio | Travada | Autor | AtualizadoEm`. `Travada` é gravado
como texto `'TRUE'`/`'FALSE'` (mesmo cuidado de sempre com coerção do
Sheets — ver `normalizarDia`).

Separar as duas abas evita duplicar a flag de trava em até ~340 linhas por
semana (uma por registro) e mantém "apagar o snapshot" e "destravar" como
operações independentes — hoje misturadas na mesma recusa do `doPost`.

**Compatibilidade com semanas já congeladas pelo mecanismo antigo.** Antes
deste deploy, `CongelamentoEstado` não existe (aba nova, nasce vazia). Uma
semana que já tem linhas em `Congelamento` mas nenhuma linha correspondente em
`CongelamentoEstado` é tratada como **travada** por padrão — a leitura infere
`travada = true` quando há pontos gravados e nenhum registro de estado. Sem
essa regra, o primeiro "Atualizar dados" rodado depois do deploy sobrescreveria
em silêncio uma semana que alguém já tratava como definitiva sob a regra
antiga.

## Contrato do Apps Script (`apps-script-congelamento.gs`)

Ações de `doPost`, por `corpo.acao`:

- **`ler`** (existente, contrato estendido): além de `linhas` (como hoje),
  devolve `estado: { travada, autor, atualizadoEm }` — lido de
  `CongelamentoEstado`, com o fallback de compatibilidade do parágrafo acima
  quando a aba nova não tem linha para a semana.
- **`congelar`** (existente, semântica muda): deixa de recusar quando já
  existem linhas da semana. Passa a checar o **estado**: se `travada` para a
  chave-alvo, recusa com `{erro:'travada'}` (mesmo formato de erro que
  `ja-congelada` tinha — o cliente troca a mensagem exibida, não o
  tratamento). Se não está travada, faz upsert: apaga as linhas existentes
  daquela(s) chave(s) de fragmento e grava as novas no lugar — mesma trava de
  concorrência (`LockService`) e mesmo cuidado de uma leitura só da planilha
  para achar chaves a apagar (ver comentário existente sobre custo
  quadrático).
- **`travar`** (nova): recebe `chaveSegunda`, opcionalmente `linhas` (para
  capturar um snapshot no instante de travar, cobrindo a semana que nunca
  teve nenhum ponto gravado), `autor`, `travadoEm`. Grava/atualiza a linha de
  `CongelamentoEstado` com `Travada=TRUE`. Se `linhas` vier, grava os pontos
  pelo mesmo caminho de upsert de `congelar` (sem checar `travada`, porque é
  a própria ação que está travando).
- **`destravar`** (nova): recebe `chaveSegunda`, `autor`, `destravadoEm`.
  Grava/atualiza a linha de `CongelamentoEstado` com `Travada=FALSE`. Não
  apaga nenhuma linha de `Congelamento` — o último snapshot gravado
  permanece visível até o próximo "Atualizar dados" com a semana aberta.
- **`desfazer`** (existente): fica no `.gs` como mecanismo manual de
  recuperação (mesmo padrão já usado neste projeto para incidentes — apagar
  linha a mão na planilha), documentado, mas **sem botão na UI**.

## Cliente (`congelamento-sheet.js`)

`criarClienteCongelamento` ganha `travar(chaveSegunda, snapshotOpcional,
autor)` e `destravar(chaveSegunda, autor)`, espelhando `congelar`/`desfazer`
existentes: nunca lançam, degradam para `{ok:false, motivo:'rede'|'token'}`.
`carregar` passa a devolver também `estado` no objeto de sucesso (hoje
devolve `{porRegistro, autor, congeladoEm}`; ganha um quarto campo,
`estado: {travada, autor, atualizadoEm}`).

## UI (aba Consolidado, `render-semanal.js`)

Os dois controles atuais (`#btn-congelar-semana` +
`#btn-desfazer-congelamento`, com seus dois blocos de status) saem. Entra um
switch único, ao lado do seletor de semana do Consolidado, valendo para a
semana **em tela** (qualquer uma do seletor — antes só a próxima segunda
podia ser alvo do botão de congelar):

- Rótulo: "Linha de base: Congelada" / "Linha de base: Aberta".
- Texto de status abaixo, no mesmo padrão de hoje: autor e data/hora da
  última trava (quando congelada) ou da última atualização da linha de base
  (quando aberta e já há um ponto gravado).
- **Ligar (OFF→ON):** captura o snapshot atual (mesmo cálculo de
  `calcularSnapshotSemanaAlvo`, mas para a semana em tela, não
  necessariamente a próxima segunda) e chama `travar` com ele — garante que
  toda trava deixa pelo menos um ponto gravado, mesmo numa semana que nunca
  tinha sido tocada. Sem `confirm()`: deixou de ser uma ação destrutiva ou
  irreversível.
- **Desligar (ON→OFF):** chama `destravar`. Não recalcula nada nessa hora —
  o próximo "Atualizar dados" é quem atualiza o ponto.
- Mesma proteção de corrida que `carregarCongeladoDaSemana` já tem hoje
  (conferir se `ESTADO_CONGELAMENTO.chave` ainda é a semana que a chamada
  buscava antes de aplicar a resposta) — troca de semana no seletor enquanto
  um `travar`/`destravar` está no ar não pode aplicar o resultado à semana
  errada.

## "Atualizar dados" (live-refresh)

Depois de recarregar registros/demandas (mesmo ponto onde `atualizarDadosAoVivo`
hoje termina), se a semana em tela no Consolidado **não está travada**,
recalcula o snapshot dela e chama `congelar` (upsert) para persistir a nova
linha de base. Best-effort: falha de rede/token nessa chamada mostra um aviso
no status do toggle, mas não desfaz nem bloqueia o resto do refresh (mesma
filosofia de degradar sem quebrar a página que o resto do congelamento já
segue).

Como o botão "Atualizar dados" é compartilhado entre as duas páginas
(`tools/semanal/live-refresh.js`, `atualizarDadosAoVivo(config)`), este passo
entra como mais um callback opcional em `config` (mesmo padrão de
`config.aplicar`/`config.rosterAlocacao`) — só `render-semanal.js`
(Planejamento Semanal, que tem a aba Consolidado) fornece esse callback;
`render-alocacao-pagina.js` (Alocação Equipes) não é afetada.

## Fora de escopo

- Autenticação: continua o token derivado da senha do dashboard
  (`derivarTokenSheet`), sem controle de "qual usuário" além do que o
  dashboard já distingue hoje (`window.__DASHBOARD_AUTOR__`).
- Nenhuma mudança na fórmula da Tendência/snapshot em si — só em quando ela é
  persistida e quem pode sobrescrever.
- `desfazer` (apagar linhas de vez) não ganha UI; permanece só como
  mecanismo manual documentado.

## Testes

- `tools/semanal/congelar-tendencia-semanal.js`: nenhuma mudança de contrato
  esperada (continua calculando snapshot por chave de segunda-feira — só
  passa a ser chamado para qualquer semana em tela, não só a próxima
  segunda).
- `tools/semanal/congelamento-sheet.js`: testes novos para `travar`/
  `destravar` (sucesso, `rede`, `token`) e para o campo `estado` na resposta
  de `carregar`.
- `apps-script-congelamento.gs`: seguir o padrão já existente de
  `test/semanal-apps-script-congelamento.test.js` (porta em JS puro da lógica
  do `.gs` para testar fora do runtime do Apps Script) — cobrir: `congelar`
  recusa quando travada, aceita upsert quando aberta; `travar`/`destravar`
  gravam e leem `CongelamentoEstado`; fallback de compatibilidade (linhas
  sem estado ⇒ travada) permanece coberto.
- `test/semanal-alocacao-interacao.test.js`/wireup de `render-semanal.js`:
  atualizar para o novo switch em vez dos dois botões antigos.
