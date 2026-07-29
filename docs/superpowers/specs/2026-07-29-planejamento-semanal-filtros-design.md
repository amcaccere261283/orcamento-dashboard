# Planejamento Semanal — Fase 2 (filtros) — design

Data: 2026-07-29

Fecha a primeira pendência da Fase 2 registrada no `CLAUDE.md`: a página Planejamento
Semanal (`docs/planejamento-semanal.html`) hoje não tem barra de filtros nem seletor de
dimensão completo — a aba 1 (Tabela semanal) está travada em dimensão `financeiro` sem
recorte algum, e a aba 2 (Balanço de massa) mostra todas as tipologias. O spec original
(`2026-07-28-planejamento-semanal-design.md`) já previa "mesma barra de filtros e mesmo
seletor de dimensão do orçamento" para a aba 1, e assumia (incorretamente, na prática) que
o filtro de tipologia já estaria disponível na casca compartilhada para a aba 2. Este
documento fecha essa lacuna.

## Contexto e causa raiz

`markupFiltros()`/`markupFiltroMulti()`, já compartilhados em `tools/comum/render-shell.js`
desde a Fase B, geram só o **esqueleto HTML vazio** dos filtros (painéis `hidden`, sem
opções). Toda a lógica de interação — o formato de estado, a função que aplica filtros aos
registros e o wiring de checkbox — nunca saiu de `tools/orcamento/render-dashboard.js`. É
essa lógica, e não a marcação, que falta extrair para a página semanal poder reusá-la.

## Arquitetura: extrair a lógica de filtros para `tools/comum/render-shell.js`

Move para o módulo compartilhado:

- **Formato de estado**: `filtrosSelecionados`, um objeto `{ chave: Set<valor> }` — um `Set`
  por campo. `Set` vazio = "sem filtro, mostra tudo"; não-vazio = OR dentro do campo, AND
  entre campos (mesma semântica de hoje, `filtroExclui`).
- **`indicesFiltrados(registros, estado, campos)`** — função pura que aplica o estado aos
  registros e devolve os índices que passam. `campos` é a lista de `{ chave, campo }` a
  checar (cada consumidor decide quais campos participam da exclusão de linhas — ver
  "Escopo de campos" abaixo).
- **`montarFiltroMulti(cfg, registros, estado, aoMudar)`** — monta a lista de opções no
  painel, escuta `change` em cada checkbox, aplica as regras `minimoUm`/`exclusivo` quando
  configuradas, atualiza o `Set` do estado, atualiza o rótulo do botão trigger, e por fim
  chama `aoMudar()`. A função **não decide o que recalcular** — isso é responsabilidade de
  cada página (`recalcularTabela()` no orçamento, uma função equivalente nova na semanal).
  Esse desacoplamento é o que permite reusar a mesma função sem ela precisar conhecer
  Tabela, Gráfico, Alertas ou Balanço de massa.

**Não muda**: `markupFiltros()`/`markupFiltroMulti()` (a marcação) já estavam certas — ficam
onde estão. `FILTROS_CONFIG` (a lista de quais campos existem e como se comportam) continua
sendo definida por cada página, porque os campos disponíveis diferem (ver próxima seção).

**Critério de aceite da extração**: reconstruir o dashboard de orçamento com uma senha
fictícia e exigir diff byte-a-byte contra o `dist/orcamento-dashboard.html` anterior,
ignorando apenas `__DADOS_CIFRADOS__` e o timestamp "Gerado em" — mesma técnica já usada nas
Fases A/B e já coberta por `test/orcamento-html-inalterado.test.js`. A extração é uma
mudança de organização de código, não de comportamento: o orçamento deve continuar
pixel-a-pixel e byte-a-byte idêntico.

## Escopo de campos — aba 1 (Tabela semanal)

Réplica do orçamento, com uma omissão deliberada:

- **Inclui**: `origem`, `categoria` (derivado da tipologia, com cascata — ver
  `opcoesFiltro` no orçamento), `tipologia`, `grupo`, `sup`, e o seletor de **dimensão**
  (equipes / volume / financeiro). Várias dimensões podem ficar marcadas simultaneamente,
  cada uma renderiza seu próprio bloco — mesmo comportamento do orçamento hoje.
- **Fica de fora**: `filtro-serie` (previstoInicial/previsto/realizado/total/...). No
  orçamento esse filtro decide quais colunas aparecem na Tabela. Na aba semanal as colunas
  já são fixas (Previsto/Realizado/Tendência por semana, sempre as três — ver spec original),
  então não há o que essa opção alternaria; incluí-la seria um controle sem efeito.

Esses filtros (exceto dimensão) atuam como exclusão de linha via `indicesFiltrados` — mesma
função, mesma semântica de hoje no orçamento.

## Escopo de campos — aba 2 (Balanço de massa)

A barra de filtros é **compartilhada entre as duas abas** — um único
`filtrosSelecionados`, uma única barra, posicionada entre o cabeçalho e o seletor de abas
(mesma relação Tabela/Gráfico do orçamento hoje). A tipologia filtrada nessa barra decide
quais tipologias viram gráfico empilhado: `listarTipologias(registros, indices)` já
deduplica sobre o `indices` recebido e já é consumida por um `.map(...)` que gera um
`.grafico-painel` por tipologia — nenhum código novo de iteração é necessário, só passar
`indices` filtrado em vez de `indicesTodos`.

**Continuam separados da barra compartilhada** (controles próprios da aba, inalterados):

- **Período** (mês vigente / acumulado até o mês / S1..S4 — desabilitado até existir
  planilha semanal).
- **Base** (Previsto / Previsto Inicial).
- **Dimensão da aba 2** (volumetria / financeiro — só 2 opções, `<select>` ad hoc, CSS
  próprio fora de `cssBase()`).
- Checkbox **"somente SUPs ativos no período"**.

Motivo de manter esses 4 separados: são conceitos exclusivos do gráfico de balanço (não se
aplicam à Tabela), e a dimensão de 3 opções da aba 1 não é compatível com a de 2 opções da
aba 2 — um seletor único deixaria "equipes" marcável sem qualquer efeito visível na aba 2
(equipes já aparece sempre como a barra laranja sobreposta, independente da dimensão
escolhida).

## Fluxo de dados (ambas as abas)

1. Usuário marca/desmarca uma opção em qualquer filtro da barra compartilhada.
2. `montarFiltroMulti` atualiza `filtrosSelecionados[chave]` e chama `aoMudar()`.
3. `aoMudar()`, específico da página semanal, recalcula `indices = indicesFiltrados(...)`
   uma vez e repassa esse mesmo `indices` para:
   - a re-renderização da Tabela semanal (aba 1), respeitando as dimensões marcadas;
   - `renderAbaBalanco` (aba 2), que por sua vez chama `listarTipologias` e
     `calcularLinhas`/`ordenarPorDesvio` já existentes, agora sobre o subconjunto filtrado.
4. Os controles próprios da aba 2 (Período/Base/Dimensão-2/Ativos) continuam sendo estado
   local dela, aplicados **depois** do `indices` da barra compartilhada — filtram ainda mais
   dentro do que já passou pela barra principal.

## Testes

- **Rede de segurança do orçamento**: depois de mover a lógica para `render-shell.js`,
  reconstruir com senha fictícia e exigir diff byte-a-byte contra o HTML atual (ignorando
  `__DADOS_CIFRADOS__` e "Gerado em"). Coberto por `test/orcamento-html-inalterado.test.js`
  — deve continuar passando sem alteração.
- **Testes novos da lógica compartilhada**: mover/adaptar os testes de
  `indicesFiltrados`/`montarFiltroMulti` (hoje implícitos nos testes do orçamento) para
  exercitar a função a partir de `tools/comum/`, cobrindo os dois consumidores
  (orçamento e semanal).
- **Testes existentes da semanal que mudam de expectativa**:
  `test/semanal-render-semanal-wireup.test.js` e
  `test/semanal-render-aba-balanco-wireup.test.js` hoje travam "sem filtro" (`indicesTodos`
  fixo) como o único comportamento esperado. Passam a cobrir "filtro vazio → todos os
  registros" como **um caso entre vários**, mais casos novos com filtro ativo: filtrar por
  `tipologia` e conferir que só os gráficos daquela tipologia aparecem na aba 2; filtrar por
  `sup` e conferir que a Tabela (aba 1) recalcula só com os registros daquele sup.
- **Invariante existente** (soma S1+S2+S3+S4 do Previsto bate com o mês vigente do
  orçamento, por definição do spec original) precisa continuar batendo também **sob filtro
  ativo**, não só sem filtro — estende o teste existente para rodar com uma combinação de
  filtros aplicada, além do caso sem filtro.

## Fora de escopo

- **Carimbo "Gerado em"** na página semanal e **semântica de `fecharMes` com semanas
  parcialmente nulas** — as outras duas pendências da Fase 2 registradas no `CLAUDE.md`,
  tratadas em specs próprios.
- **Unificar a dimensão da aba 2 com a da aba 1** — decisão explícita deste spec (seção
  "Escopo de campos — aba 2") de mantê-las separadas.
- **Filtro de série na aba 1** — decisão explícita deste spec de não incluir, por não haver
  colunas alternáveis na Tabela semanal.

## Riscos

**Esta fase toca no dashboard de orçamento que está no ar** (a extração da lógica de
filtros de `render-dashboard.js` para `render-shell.js`). Mitigado pelo diff byte-a-byte,
mas é onde a revisão de código deve ser mais cuidadosa — mesma cautela já registrada para a
Fase B original.
