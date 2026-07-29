# Planejamento Semanal — filtros e layout do orçamento

Fecha a **Fase 2** registrada em `CLAUDE.md`: a página `docs/planejamento-semanal.html`
foi publicada em 2026-07-29 sem a barra de filtros que o spec original prometia, com
dimensão fixa em `financeiro` e uma tabela agregada de 3 linhas.

Este spec traz para a página semanal os 7 filtros da aba Tabela do orçamento
(Origem, Categoria, Tipologia, Grupo, SUP, Série, Dimensão), aplica o recorte às
**duas** abas e iguala a tabela semanal ao layout da tabela do orçamento.

## O que muda, em uma frase

A tabela semanal deixa de ser um agregado de 3 linhas e passa a ser a tabela do
orçamento — mesmas colunas fixas, mesmos blocos de total, mesmos chips — com as
quatro semanas mais a coluna de fechamento no lugar dos 12 meses.

## Decisões tomadas com o dono do projeto (2026-07-29)

1. **Layout completo do orçamento** na tabela semanal, não a tabela agregada de hoje.
2. **Aba Balanço de massa**: recebe o recorte compartilhado e perde o select "Dimensão"
   próprio — a dimensão passa a vir da barra de cima. Período, Base e "Somente ativos"
   continuam locais.
3. **Faixa de ações completa**: abas + "Limpar filtros" + "Atualizar dados" (com o
   refresh ao vivo do espelho da MATRIZ portado do orçamento).
4. **Realizado e Tendência continuam vazios.** Não são derivados do valor mensal. O
   Previsto é um plano, e repartir um plano em 4 semanas é uma premissa declarada;
   o Realizado é medição, e espalhá-lo uniformemente pelas semanas afirmaria um
   recorte intra-mês que ninguém mediu. Ficam vazios até existir planilha semanal
   de origem.

## Arquitetura

### O obstáculo

Toda a máquina de filtro do orçamento vive dentro de `SCRIPT_CLIENTE_TABELA`, um
template literal em `tools/orcamento/render-dashboard.js`, e
`test/orcamento-html-inalterado.test.js` trava o HTML publicado byte a byte.
Duplicar o código na página semanal seria a forma mais fácil de as duas páginas
discordarem sobre o que um filtro significa.

### A saída: extração verbatim

O mesmo padrão que o repositório já aplicou duas vezes (`tools/comum/render-shell.js`
e `tools/comum/calculo-equipes.js`): recortar o texto para módulos em `tools/comum/`
entre marcadores `// <<< INICIO CLIENTE` / `// FIM CLIENTE >>>`, e o orçamento
reinjetá-lo **na posição exata** de onde saiu, via `trechosParaCliente()`.

Se a extração for verbatim, o golden do orçamento continua passando — e é justamente
ele que prova que foi verbatim. Nada de reformatar, modernizar `var` para `const` ou
reescrever comentário: o texto recortado é conteúdo do HTML publicado.

Atenção a um detalhe já documentado em `calculo-equipes.js`: dentro do template
literal os escapes aparecem dobrados (`\\(`, `\\s`, `\\n`). Ao migrar para um `.js`
de verdade eles viram escapes simples (`\(`, `\s`, `\n`) — a leitura do arquivo
injeta o texto cru, sem uma segunda passagem de avaliação. E `trechosParaCliente()`
normaliza `\r\n` para `\n`, senão o HTML publicado passaria a depender de como o
repositório foi clonado.

### Os três módulos novos

| Módulo | O que sai de `SCRIPT_CLIENTE_TABELA` |
|---|---|
| `tools/comum/agregacao-cliente.js` | `formatarNumero`, `somar`, `somarArraysMensais`, `CAMPOS_RATIO`, `calcularMensal` |
| `tools/comum/filtros-cliente.js` | `categoriaTipologia` (+`TIPOLOGIAS_SONDAGEM_ESPECIAL`), `linhasDistintas`, `capitalizarPalavras`, `filtroExclui`, `indicesFiltrados`, `normalizarBusca`, `aplicarSelecaoExclusiva`, `opcoesFiltro`, `atualizarRotuloFiltro`, `montarFiltroMulti`, `montarTodosFiltrosMulti`, `configurarAberturaFiltrosMulti`, `DIMENSOES_CONFIG`, `DIMENSOES_ROTULO`, `dimensoesEmOrdem`, `emOrdemCanonica`, `tipologiaColor` (+ os dois mapas de cor) |
| `tools/comum/refresh-cliente.js` | `URL_ESPELHO_MATRIZ`, `parseCsvGrid`, `parseMatrizClient`, `preservarPrevistoInicial`, `definirStatusAtualizacao`, `atualizarDadosAoVivo` |

Cada módulo pode ter mais de um bloco marcado quando o texto de origem não é
contíguo — `trechosParaCliente()` devolve um array, e o orçamento injeta cada
trecho no seu ponto. `fonteParaCliente()` concatena tudo, que é o que a página
semanal precisa.

`bucketIntervalo`, `bucketPeriodo`, `calcularTotalAno` e todo o cálculo de Alertas
**não** são extraídos: são do orçamento e só dele.

### A exceção: uma regeneração deliberada do golden

Uma função escapa da extração verbatim. `mesclarColunasRepetidas` (que esmaece
valores repetidos nas colunas SUP/Grupo/Tomador/Tipologia, parte do layout que a
tabela semanal precisa reproduzir) hardcoda o seletor `'#tabela-orcamento tbody tr'`.
Não existe forma de compartilhá-la sem mudar um byte do HTML do orçamento.

A saída é parametrizar o seletor numa global `SELETOR_LINHAS_TABELA`, definida por
cada página, e **regenerar o golden de propósito** — o que o `CLAUDE.md` permite
desde que o diff seja revisado linha a linha. O critério de aceite é que o diff
contenha exatamente três coisas: a linha da global nova, o comentário de 3 linhas
que a explica, e a substituição do seletor. Nada mais. Isso vira uma tarefa própria
do plano, para que um revisor possa rejeitá-la sem rejeitar as extrações verbatim.

### O contrato entre a casca e a página

`montarFiltroMulti` referencia como globais livres coisas que cada página define de
um jeito seu. Isso deixa de ser acidente e vira o contrato explícito do módulo,
documentado no topo de `filtros-cliente.js`:

| Global | Orçamento | Semanal |
|---|---|---|
| `FILTROS_CONFIG` | 7 filtros, série com 5 opções | 7 filtros, série com 3 (sem Previsto Inicial nem "Realizado + Previsto Inicial") |
| `filtrosSelecionados` | estado próprio | estado próprio |
| `renderCorpoTabela` | tabela mensal | tabela semanal |
| `recalcularTabela` | recalcula tabela + gráficos | recalcula tabela + aba Balanço |
| `recalcularAlertas` | recalcula a aba Alertas | no-op documentada (não há aba Alertas) |
| `escapeHtml`, `SERIE_LABELS`, `CLASSE_SERIE` | próprios | próprios |

A máquina é compartilhada; a configuração e os callbacks são de cada página. Um
teste deve provar que a semanal define todos os nomes que o módulo consome — a
falha natural aqui é um `ReferenceError` que só aparece no navegador, com os
testes em Node passando.

### Série: 3 opções, não 5

A semanal não carrega `previstoInicial` por registro (o baseline chega em
`window.__BASELINE__`, rechaveado por `sup||tipologia`, e serve só à aba Balanço).
"Realizado + Previsto Inicial" existe apenas no gráfico do orçamento. Logo a
`FILTROS_CONFIG` da semanal lista Previsto, Realizado e Tendência — exatamente as
três séries que a tabela renderiza — e as três começam marcadas.

## A tabela semanal

`tools/semanal/render-aba-semanal.js` é reescrita para emitir a mesma estrutura de
`renderCorpoTabela` do orçamento (`tools/orcamento/render-dashboard.js:1307`):

```
SUP    | Grupo | Tomador | Tipologia      | Série                  | S1 | S2 | S3 | S4 | Total
—      | Todos | Todos   | [TOTAL GERAL]  | Previsto — Financeiro  | .. | .. | .. | .. | ..
—      | Todos | Todos   | [SP]           | Previsto — Financeiro  | .. | .. | .. | .. | ..
SUP001 | G1    | Tomador | [SP]           | Previsto — Financeiro  | .. | .. | .. | .. | ..
SUP001 | G1    | Tomador | [TOTAL]        | Previsto — Financeiro  | .. | .. | .. | .. | ..
```

- TOTAL GERAL no topo (vira SUBTOTAL quando há recorte ativo, como no orçamento),
  um TOTAL GERAL POR TIPOLOGIA por tipologia, depois os registros agrupados por SUP
  com um TOTAL por SUP fechando cada bloco.
- Mesmas células `col-mesclavel`, mesmos `data-*` (`data-serie`, `data-dimensao`,
  `data-registro-indices`, `data-total-*`), mesmos chips coloridos, mesma coluna SUP
  fixa, mesma mesclagem de valores repetidos.
- Um bloco de 3 linhas por dimensão marcada, na ordem canônica de `DIMENSOES_CONFIG`.
- As células saem vazias do `renderCorpoTabela` e são preenchidas pelo
  `recalcularTabela` no cliente — mesmo desenho do orçamento, e o que permite
  filtrar sem remontar a tabela inteira.

O preenchimento de uma linha: `calcularMensal(valoresLista, serie, dimensao)` dá o
array de 12 meses, `[vigenteIdx]` recorta o mês vigente, e `dividirEmSemanas` /
`fecharMes` repartem em semanas.

## As 5 dimensões na semana

`tools/semanal/compute-semanal.js` hoje só distingue fluxo de foto. Generalizando:

| Dimensão | Semanas | Coluna de fechamento |
|---|---|---|
| Financeiro, Volume | mês ÷ 4 | soma |
| Equipes | valor do mês repetido | média |
| Produtividade, Ticket médio | valor do mês repetido | o próprio valor |

Razões repetem porque são **invariantes ao corte**: ticket médio = (fin÷4)÷(vol÷4)
= fin÷vol; produtividade = (vol÷4) ÷ (equipes × dias÷4) = a mesma taxa diária.
Dividir uma razão por 4 produziria um número errado em silêncio.

Como repetir quatro valores iguais e tirar a média devolve o mesmo número, razão e
foto percorrem o mesmo caminho de código. A distinção real, e o único conceito novo
em `compute-semanal.js`, é `{equipes, produtividade, ticketMedio}` (não repartem)
contra `{financeiro, volume}` (repartem).

**Cabeçalho da última coluna, dinâmico**: `Total` quando toda dimensão marcada soma,
`Média` quando todas são foto/razão, `Total / Média` quando mistura. É o motivo pelo
qual `rotuloColunaFechamento` existe — sem isso alguém lê "Total" numa coluna de
Equipes e soma contratos por engano.

Casas decimais seguem o orçamento: 2 para Produtividade, 0 para o resto.

## A aba Balanço de massa

- Recebe `indicesFiltrados(...)` no lugar de todos os índices — Origem, Categoria,
  Tipologia, Grupo e SUP passam a recortar os gráficos.
- `renderControles` perde o select "Dimensão"; sobram Período, Base e "Somente ativos".
- A dimensão vem de `dimensoesEmOrdem(filtrosSelecionados.dimensao)`.

**Fallback obrigatório**: `compute-balanco.js` lê `registro[base][dimensao]` como
array mensal, que existe para `financeiro`, `volume` e `equipes` mas **não** para
`produtividade` nem `ticketMedio` (são derivadas, nunca guardadas no registro). Com
uma dessas marcada, a aba usa a primeira dimensão suportada entre as marcadas — ou
`financeiro`, se nenhuma for — e **exibe uma nota dizendo qual está usando e por quê**.
Desenhar zeros em silêncio é o pior desfecho possível e precisa de teste próprio.

## A casca da página

`tools/semanal/render-semanal.js` passa a chamar
`markupFiltros(FILTROS_PRINCIPAIS, { acoes: MARKUP_ACOES, extra: MARKUP_NOTA_PREMISSA })`,
com:

- a faixa `.filtros-acoes` com as abas, "Limpar filtros" e "Atualizar dados"
  (+ o `<span id="status-atualizacao">`);
- a nota de premissa de Produtividade, visível só quando essa dimensão está marcada;
- logo no cabeçalho e marca d'água — `assets/logo-suporte-infra-negativo.png` e
  `assets/logo-alvo.png`, os mesmos do orçamento, carregados como data-URI por
  `tools/semanal/build-dashboard.js`;
- o carimbo **"Gerado em …"** no subtítulo, no formato do orçamento. Fecha a
  pendência registrada em `CLAUDE.md`: sem ele não dá para verificar um deploy pelo
  conteúdo, que é exatamente a verificação que o incidente de 2026-07-22 tornou
  obrigatória.

O CSS não precisa crescer: `cssBase()` já traz `.filtros*`, `.filtro-multi*`,
`#limpar-filtros`, `#atualizar-dashboard`, `.nota-premissa`, `table/th/td`,
`.tipologia-chip*`, `.celula-*`, `.serie-label`, `.linha-*` e `.valor-repetido` —
justamente as ~79 linhas que a página semanal herdava sem usar. `CSS_BALANCO`
perde as regras do select removido; `CSS_SEMANAL` mantém `.linha-tendencia`.

## Testes

- **`test/orcamento-html-inalterado.test.js` continua passando byte a byte.** É a
  prova das três extrações e o critério de aceite mais importante deste trabalho.
- `compute-semanal.js` nas 5 dimensões: repartição e fechamento corretos para fluxo,
  foto e razão; e que uma razão nunca é dividida por 4.
- Estrutura da nova `renderCorpoTabela` semanal: ordem dos blocos, `data-*` presentes,
  número de linhas por dimensão marcada, células vazias na montagem.
- Wire-up: a página semanal define todo nome que `filtros-cliente.js` e
  `refresh-cliente.js` consomem como global livre (o `ReferenceError` que só
  apareceria no navegador).
- Fallback de dimensão do Balanço, com a nota visível.
- Cabeçalho dinâmico da coluna de fechamento nos três casos.
- Presença do "Gerado em" no HTML gerado.
- `test/publicacao-docs-sincronizado.test.js` já trava a cópia para `docs/`.

## Publicação

Build das duas páginas (o orçamento também, para exercitar o golden), depois
`cp dist/planejamento-semanal.html docs/planejamento-semanal.html` e
`cp dist/orcamento-dashboard.html docs/index.html`, commit dos dois juntos e push.
A revisão de design do Open Design roda sobre o HTML semanal antes do commit final —
se o OD estiver disponível na máquina; o `CLAUDE.md` do repositório principal manda
seguir sem ele quando não estiver.

## Fora de escopo

- A aba Gerencial (adiada pelo dono em 2026-07-22).
- Uma fonte de dados semanal de verdade para Realizado/Tendência.
- Dividir `cssBase()` em base neutra + CSS do orçamento (exigiria regenerar o golden
  de propósito; está documentado no topo de `render-shell.js` como trabalho à parte).
- A semântica de `fecharMes` com semanas parcialmente nulas: continua média/soma só
  dos válidos. Ninguém exercita isso enquanto Realizado e Tendência forem nulos.
