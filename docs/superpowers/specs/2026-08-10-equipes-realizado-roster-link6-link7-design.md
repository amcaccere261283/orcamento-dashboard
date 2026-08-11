# Equipes Realizado: roster (Link 6) + produção (Link 7), com carry-forward (2026-08-10)

Desenho de implementação para a pendência registrada em
`2026-08-10-tabela-semanal-regras-linha-a-linha.md` ("Equipes Realizado — o item
grande da spec"). As regras de negócio já foram fechadas com o dono do projeto
naquela spec; este documento cobre só o desenho técnico da implementação,
fechado com ele em sessão de brainstorming própria.

## Contexto / problema

`dist/equipes-online.csv` grava hoje `SUP,Tipo,DiaEpoch,Fracao` — já agregado
pelo fetcher, sem o ID da equipe. A regra pedida (Link 6 roster + Link 7
produção, com carry-forward para o último contrato de quem não produziu)
precisa da produção CRUA por equipe, então o agregado atual não serve de
entrada.

Investigando o roster (Link 6), achou-se um segundo bloqueio, não previsto na
spec de regras: o roster só está disponível hoje via um espelho Google Apps
Script (`apps-script-espelho-eq.gs`) que publica **sempre o mês corrente**,
sobrescrevendo a cada 30 min — não há histórico de meses passados acessível
por essa via. Sem resolver isso, o backfill anual (que o Link 7 já tem desde
2026-08-10) não se estende ao roster, e o Realizado novo funcionaria só no mês
vigente.

## Decisão: descoberta de gid, porta de `tools/matriz/discover-gids.js`

A planilha de origem do Link 6
(`https://docs.google.com/spreadsheets/d/1Mgj87eSKMO4Gh2aHQWChNl5YCH2vatMDC2fCNuxB8TU/`)
tem uma aba por mês, nomeada `"AAAA - MÊS (EQ)"` — o mesmo padrão que o
dashboard Matriz (`tools/matriz/`, outro projeto deste repositório-mãe) já
resolve em `discover-gids.js`: lista todas as abas via endpoint público
`.../htmlview` (sem credencial, sem CORS — só server-side) e casa pelo nome.

**Porta desse módulo para `orcamento-dashboard`** (arquivo novo, ex.
`tools/comum/descobrir-abas-planilha.js`): mesma técnica de
`buscarListaDeAbas`/`extrairAbasDoHtml`/`parseNomeAba`, generalizada para
aceitar qualquer padrão de categoria (aqui só `(EQ)` interessa, diferente do
Matriz que resolve 5 categorias). Com o gid de cada mês em mãos, o CSV sai de
`https://docs.google.com/spreadsheets/d/{fileId}/export?format=csv&gid={gid}`.

**Isso aposenta `apps-script-espelho-eq.gs`/`URL_ESPELHO_EQ` por completo** —
decisão do dono do projeto (2026-08-10): não só para o Realizado novo, mas
também para "Equipes Ativas" (fallback do Δ equipes no Balanço) e "Equipes
Não-produtivas", que hoje dependem do mesmo espelho. As duas continuam
funcionando exatamente como hoje (só o mês corrente), lendo o mesmo mecanismo
novo — só filtrado para um mês em vez de vários. Desligar o gatilho de 30 min
no Google é passo manual do dono do projeto, fora deste repositório (mesmo
padrão já usado para aposentar o espelho de Avanços em 2026-08-05).

## Fetcher: um só arquivo, dois CSVs publicados

`atualizar-equipes-online.js` (existente) passa a publicar dois arquivos:

1. **Produção crua do Link 7** — formato muda de `SUP,Tipo,DiaEpoch,Fracao`
   para `IdEquipe,SUP,Tipo,DiaEpoch`, uma linha por (equipe, dia, contrato).
   `parseLinhasLink7` já produz isso (`idEquipe`/`sup`/`tipo`/`diaEpoch`) —
   `agregarEquipesProdutivas` (que fraciona) deixa de ser chamada aqui; a
   fração passa a ser calculada no cruzamento (build/refresh), não mais no
   fetcher. Mesmo backfill incremental já implementado (mês corrente sempre,
   meses passados só se faltando, corte em d-1) — não muda.
2. **Roster do Link 6, multi-mês** — para cada aba `(EQ)` do ano descoberta,
   baixa o CSV e grava por (equipe, dia, estado classificado). Formato:
   `IdEquipe,Ano,Mes,Dia,Estado` — o `Estado` já é o resultado de
   `classificarDiaEquipe` (mobilizada/campoSemFuro/fora/naoEquipe) aplicado no
   fetcher, não a célula de texto crua: mantém a lógica de classificação num
   lugar só e reduz o payload. Mesmo backfill incremental (mês corrente
   sempre re-buscado — ainda sendo preenchido —, meses passados só se
   faltando).

`agregarEquipesProdutivas` (compute-equipes-produtivas-link7.js) fica no
repositório sem consumidor direto do fetcher — a lógica de fração por
(sup,tipo) do mesmo dia é reaproveitada dentro do módulo de cruzamento novo
(abaixo), não duplicada.

## Módulo de cruzamento (build + navegador)

Módulo novo, ex. `tools/semanal/compute-equipes-realizado-alocado.js`,
bundle-safe (`var`/`function`, sem arrow/const — mesmo padrão de
`compute-equipes-ativas.js`, porque roda tanto no build via Node quanto no
refresh via `browser-bundle.js`).

Entrada: roster parseado (lista de `{idEquipe, ano, mes, dia, estado}`) +
produção crua do Link 7 (lista de `{idEquipe, sup, tipo, diaEpoch}`).

Algoritmo, por (equipe, dia) do roster:

1. **Ativa** = `estado !== 'fora'` (inclui `naoEquipe`, diferente da definição
   usada por Equipes Ativas/Não-produtivas — funções distintas, não
   reaproveita `contaComoAtiva` de `classificar-dia-equipe.js`, que continua
   servindo as duas features antigas sem mudar).
2. Se não ativa: fora da conta desse dia.
3. Se ativa e produziu no dia (existe linha do Link 7 com o mesmo `idEquipe` e
   `diaEpoch`): fraciona 1/N entre as combinações (SUP,tipo) distintas
   produzidas naquele dia — mesma regra de `agregarEquipesProdutivas`.
4. Se ativa e não produziu no dia: procura a produção mais recente da mesma
   equipe com `diaEpoch < dia` e `dia - diaEpoch <= 45`; achando, aloca 1
   inteiro nesse (SUP,tipo). Não achando, fica fora da conta (equipe sem
   produção na janela).

Saída: `{ porDia }` no mesmo formato que `demandas.equipesPorDia` já usa hoje
(`'SUP||Tipo' -> {diaEpoch: fração}`) — `render-aba-semanal.js` não muda a
forma como lê esse mapa, só a fonte que o preenche.

## `build-dashboard.js`

**Unifica tudo num arquivo publicado só**, `dist/equipes-roster-online.csv`
(multi-mês) — abandona o padrão atual de `buscarEspelhoEq()` (busca ao vivo,
dentro do próprio `build()`, sem depender do fetcher ter rodado antes). Isso
é uma mudança de comportamento deliberada: alinha o roster com TODAS as outras
fontes online deste projeto (Avanços, Lab, Demandas, Produção) que já exigem
`atualizar-*.js` ter rodado antes, com mensagem de erro clara guiando pro
comando certo quando falta. Simplifica em vez de manter um caso especial
(era o único que buscava ao vivo dentro do build).

- Remove `buscarEspelhoEq()`/`URL_ESPELHO_EQ` e a chamada em
  `montarEquipesAtivas` por completo.
- Lê `dist/equipes-roster-online.csv` (multi-mês, opcional com fallback —
  mesmo padrão de `equipes-online.csv` hoje) e `dist/equipes-online.csv`
  (agora cru) e chama o módulo de cruzamento novo para produzir
  `demandas.equipesPorDia` que alimenta a Tabela Semanal — substitui a
  leitura de `parseEquipesFracaoCsv` no bloco "Δ equipes PRODUTIVAS
  (2026-08-09)".
- **Ativas/Não-produtivas** (`montarEquipesAtivas`/`agregarEquipesNaoProdutivas`)
  passam a ler o recorte do MÊS CORRENTE do mesmo
  `dist/equipes-roster-online.csv`, em vez de buscar `equipesAtivasCsv` ao
  vivo — mesmas funções (`parseAbaEq`-equivalente para o formato novo,
  `agregarEquipesAtivas`, `agregarEquipesNaoProdutivas`), só a origem do
  texto muda. Se o arquivo publicado faltar ou não cobrir o mês corrente,
  ficam sem dado com aviso — mesmo comportamento de fallback que já existe
  hoje para falha de rede.

## `render-semanal.js` (refresh no navegador)

Troca `URL_ESPELHO_EQ_SEMANAL` (hoje: URL do Google Sheets pub CSV, lida
direto do navegador) por `equipes-roster-online.csv`, arquivo relativo
publicado junto com a página — mesmo padrão de `avancos-online.csv`/
`equipes-online.csv`. Alimenta as TRÊS coisas no cliente: o cruzamento novo
(Realizado, todos os meses que o registro em `indices` cobrir) e
Ativas/Não-produtivas (recorte do mês corrente do mesmo payload, mesma lógica
client-side que já existe em `ComputeEquipesAtivas.agregarEquipesAtivas`/
`ComputeEquipesNaoProdutivas.agregarEquipesNaoProdutivas`). O navegador nunca
faz descoberta de gid (só server-side, sem CORS) — só lê o que o fetcher já
publicou, igual a todas as outras fontes online deste projeto.

`ARQUIVOS_PUBLICAR` (`atualizar-arquivos.js`) ganha o arquivo novo, e
`test/publicacao-docs-sincronizado.test.js` precisa cobri-lo (mesma trava que
já existe para os outros CSVs).

## `render-aba-semanal.js`: denominador da média

`somarEquipesNoIntervalo` usa hoje `totalDias = fimEpoch - inicioEpoch + 1`
(todos os dias do intervalo). Troca para: dias da semana que estão dentro do
mês e não são domingo. Semana cheia (segunda a sábado, todos dentro do mês) dá
6; semana parcial de borda de mês dá os dias que sobraram; se o resultado for
zero (semana composta só de domingo — acontece no recorte por mês), esse
domingo é contado sozinho (denominador 1). O numerador (soma de
`equipesPorDia` através de `indices`) não muda.

## Erros e degradação

Mesmo espírito de robustez do resto do projeto — nenhuma fonte nova pode
derrubar o build inteiro:

- Descoberta de gid falhando (planilha renomeada, endpoint mudou, ficou
  privada): erro claro dizendo "roda a descoberta de novo / confira a
  planilha", como os outros fetchers já fazem para mudança de layout.
- Roster sem cobertura de um mês: esse mês fica sem dado no Realizado
  (mesma lógica de "sem chave = sem dado" que `somarEquipesNoIntervalo` já
  tem).
- Equipe sem `Nº Equipe`/`ID` reconhecível: mesma falha alta que
  `atualizar-equipes-online.js` já tem para o Link 7 (não cai calado).
- CSV de roster ou de produção ausente no build/refresh: mantém a fonte de
  reserva atual (Ativas/mobilizadas) para `equipesPorDia`, com aviso — mesmo
  padrão que `equipes-online.csv` já segue hoje.
- CSV de roster ausente ou sem cobertura do mês corrente: Ativas/
  Não-produtivas ficam sem dado, com aviso — mesma degradação que já existe
  hoje pra falha de rede do espelho antigo, só a causa muda (arquivo faltando
  em vez de fetch falhando).

## Testes

- Módulo de cruzamento: casos sintéticos cobrindo ativa com produção no dia
  (fração 1/N), ativa sem produção mas com carry-forward dentro de 45 dias,
  ativa sem produção fora da janela (fica de fora), não-ativa (`fora`) nunca
  entra, `naoEquipe` conta como ativa.
- Descoberta de gid: fixture de HTML de `htmlview` com abas `(EQ)` de meses
  distintos + abas irrelevantes (outras categorias) — mesmo padrão de teste
  que `discover-gids.js` já tem no Matriz.
- Parser do roster multi-mês: fixture com 2+ meses, checando que o mês
  corrente é sempre re-buscado e um mês passado já coberto não é.
- `somarEquipesNoIntervalo`: semana cheia (÷6), semana parcial de fim de mês,
  semana composta só de domingo (÷1).
- Regressão: `test/publicacao-docs-sincronizado.test.js` cobrindo os dois
  arquivos novos; build/refresh com fixtures sintéticas continuam batendo
  (mesmo padrão dos testes de wireup existentes).

## Fora de escopo

- Publicar o roster completo (todas as categorias `(EQ e SUP)`, `VEIC`,
  `PESSOAS`, `SEG`) — só `(EQ)` interessa aqui, igual antes.
- Revisitar "Equipes Ativas" como conceito de UI/feature própria (fica para
  quando o dono do projeto retomar essa conversa, ver CLAUDE.md do repo).
- Qualquer mudança na definição de tipologia/exclusão além do que já está em
  vigor (`tools/comum/exclusoes.js`, `tools/comum/tipologias-avancos.js`).
