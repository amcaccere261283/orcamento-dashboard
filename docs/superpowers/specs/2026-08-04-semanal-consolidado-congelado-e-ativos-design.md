# Consolidado com tendência congelada, filtro global de SUPs ativos e três ajustes — design

Data: 2026-08-04 (segunda leva do dia). Página: Planejamento Semanal.
Escopo: só esta página — o dashboard de orçamento não é tocado.

## O pedido

Cinco itens, na ordem em que o dono do projeto pediu:

1. Os indicadores de status da aba Alertas do orçamento estão mais bonitos; fazer igual.
2. *(pergunta, respondida abaixo — não gera trabalho)* Como funciona o Balanço de massa
   na dimensão Demandas, e o que significa a barra positiva?
3. Na aba Consolidado, deixar só Realizado e Tendência (tirar Previsto). A Tendência da
   semana vigente e das passadas fica **congelada** — a que iniciou aquela semana; a das
   semanas futuras é a projeção viva.
4. Colocar o check de "somente SUPs ativos" valendo para a página inteira.
5. A aba Consolidado passa a usar o filtro de dimensão da barra compartilhada.

## Resposta ao item 2 (registro, não implementação)

Na dimensão **Demandas** do Balanço de massa (`compute-balanco.js`, `calcularLinhas`):

- **Referência (base):** o Previsto de **VOLUME** da MATRIZ no período, na base marcada
  (Previsto ou Previsto Inicial). A MATRIZ não tem previsão de demanda própria, e furo
  previsto é a grandeza comparável com furo chegado.
- **Medido:** furos que **CHEGARAM** no período — evento `chegada` do Avanço Sond.
- **A barra é `chegadas − previsto de volume`.** Positiva significa que entrou mais
  demanda do que o plano previa produzir: a carteira cresce mais rápido que a capacidade
  planejada. Negativa significa que o plano não tem lastro de demanda no período.
- Usa o Avanço Sond em **qualquer** período (volume e financeiro só o usam em Mês
  Vigente). Sem o agregado de demandas a linha fica **sem dado**, nunca zero.

**A ressalva, que vale registrar:** é um fluxo de ENTRADA contra um plano de PRODUÇÃO.
Mesma unidade, perguntas diferentes. Responde "a demanda que chega cabe no que
planejamos produzir?", não "a demanda veio como previsto?" — para essa segunda pergunta
não existe fonte hoje.

## Decisão 1 — o anel do indicador de status sai

`tools/semanal/render-semanal.js`, bloco `CSS_ABAS_SEMANAL`:

```css
#tabela-alertas .status-circulo,
#tabela-alertas-tendencia .status-circulo { box-shadow: 0 0 0 1px rgba(255,255,255,0.45); }
```

Essa regra é a **única** diferença visual entre o indicador de status desta página e o do
dashboard de orçamento — o markup (`<span class="status-circulo" style="background:…">` +
rótulo) e o CSS de `cssBase()` são idênticos nos dois. Ela sai por inteiro.

**Consequência aceita explicitamente pelo dono do projeto:** o `#1414CC` ("Excelente")
fica em ~1,65:1 contra a superfície escura e volta a quase sumir — justamente no status
que se quer achar varrendo a tela. O anel existia por causa disso. A escolha é ter as
duas páginas idênticas, e ela é deliberada: **não "corrigir" o contraste de volta numa
revisão de design futura sem perguntar ao dono do projeto.** As 5 cores do semáforo são
copiadas do orçamento de propósito e continuam intocáveis.

## Decisão 2 — colunas do Consolidado

Hoje a aba mostra Previsto, Realizado e Tendência, mais as colunas de premissa.

Passa a mostrar **Realizado** e **Tendência**. Previsto sai.

**As colunas de premissa ficam** (Equipes previstas + Produtividade média esperada em
Volume; Ticket médio previsto em Financeiro). Elas não são a série Previsto: são
premissas do MÊS, foram um pedido explícito de 2026-08-03, e a separação
física/financeira entre elas continua valendo.

## Decisão 3 — a Tendência congelada

Uma coluna só, cujo significado depende da semana selecionada no controle da aba:

| Semana selecionada | O que a coluna mostra |
|---|---|
| já encerrada (`fim < hoje`) | **congelada**: a Tendência como era no 1º dia daquela semana |
| em curso (contém hoje) | **congelada**: a Tendência como era no 1º dia desta semana |
| futura (`inicio > hoje`) | **viva**: a projeção de hoje, pelos três ramos |

### Como se congela: recálculo, não snapshot

Congelar é chamar `calcularSeriesSemanaisDimensao` com
**`hojeEpoch = semanas[k].inicio`** (o 1º dia da semana escolhida) em vez do hoje real, e
ler a célula da semana `k`. Nessa recomputação a semana `k` É a semana vigente, então o
valor devolvido é exatamente a projeção que se fazia para ela inteira no momento em que
ela começou — que é o que "manter a tendência que iniciou a semana" pede.

Isso funciona porque **os eventos do Avanço Sond têm data**: o estado do passado é
reconstituível a partir do dado atual. Nada precisa ser gravado.

**A alternativa foi considerada e descartada.** Um snapshot de verdade — gravar o valor
toda segunda-feira — exigiria persistência: um arquivo de histórico versionado e um job
agendado para escrevê-lo. Este repositório **não tem nenhum GitHub Actions workflow**
(diferente do `matriz-equipes-source`, que mantém `historico.json` assim), e o build
depende de `ORCAMENTO_SENHA` e das planilhas em `G:`, que um runner não tem. Seria um
subsistema novo inteiro para um ganho pequeno.

**O preço dessa escolha, e ele é real:** como é recálculo e não gravação, um lançamento
RETROATIVO no Avanço Sond (furo digitado depois, com data da semana passada) muda um
número já "congelado". O congelamento é reprodutível, não imutável. Se um dia isso
incomodar, a correção é persistência de verdade — não remendar o recálculo.

### Relação com a regra 2.1

A regra 2.1 (spec de 2026-08-04, primeira leva) manda a Tendência nunca aparecer sobre
período já realizado, e some por inteiro num mês fechado. **A aba Consolidado é uma
exceção deliberada a ela**, e é a razão de existir deste pedido: ali a Tendência
congelada não é uma projeção sobre o passado, é o **registro histórico** do que se
projetava naquele momento. As duas coisas têm o mesmo nome e significados opostos — por
isso o cabeçalho da coluna precisa dizer qual está na tela.

### O que a tela mostra

O cabeçalho da coluna nomeia o modo e a data-âncora: **`Tendência congelada em dd/MM`,
onde `dd/MM` é o 1º DIA DA SEMANA selecionada** (a mesma data que foi passada como
`hojeEpoch`), nos dois casos congelados; e `Tendência (projeção de hoje)` na semana
futura. Sem isso as duas leituras ficam indistinguíveis, e o número congelado seria lido
como projeção corrente.

## Decisão 4 — "Somente SUPs ativos" global

Um checkbox novo na barra de filtros compartilhada, dentro do slot `acoes` que
`markupFiltros` já expõe (onde já vivem o seletor de mês, "Limpar filtros" e "Atualizar
dados"). **Ligado por padrão**, como o do Balanço já é.

**O check do Balanço de massa sai.** Dois controles para o mesmo conceito divergem: a
pessoa marca um, o outro fica como estava, e as abas passam a descrever recortes
diferentes sem avisar. O Balanço passa a ler o estado compartilhado; a lógica dele de
aplicar o filtro às `linhas` não muda.

**Ponto de arquitetura que não pode ser esquecido:** este filtro **não** é um filtro de
índice como origem/categoria/tipologia/grupo/SUP. Aqueles recortam por uma propriedade do
registro e cabem em `indicesFiltrados` (`render-shell.js`). "Ativo" depende do PERÍODO
que a aba está mostrando, então é **estado compartilhado aplicado por aba**, cada uma na
sua granularidade e depois de saber seu próprio período. Enfiá-lo em `indicesFiltrados`
obrigaria a barra a conhecer o mês/semana de cada aba.

**Definição de "ativo"**, a mesma que o Balanço já usa (`compute-balanco.js`:
`ehPositivo(previstoPeriodo) || ehPositivo(realizadoPeriodo)`), por par (SUP, tipologia):
Previsto **ou** Realizado maior que zero no período. Para as abas Semanal, Alertas e
Consolidado o período é o **MÊS selecionado**, não a semana — atividade medida por semana
faria linhas aparecerem e sumirem a cada troca de semana, o que lê como defeito.

**Onde ele se aplica, aba por aba** (a barra é uma só, mas nem toda aba lista linhas por
registro):

- **Semanal, Balanço de massa, Alertas, Consolidado** — as quatro que quebram por
  (SUP, tipologia). É onde o check muda o que se vê.
- **Gráficos** — não muda nada na prática: a aba soma todos os registros filtrados numa
  série só, e um registro inativo tem Previsto e Realizado zerados ou nulos, contribuindo
  zero para os totais. Não vale escrever código para "aplicar" ali.
- **Demandas** — não se aplica: ela lê o agregado do Avanço Sond por tipologia, não
  quebra por registro da MATRIZ, e não existe "SUP inativo" naquela conta.

**Efeito colateral aceito:** as abas Semanal, Alertas e Consolidado passam a esconder,
por padrão, SUPs sem movimento no mês — o que hoje não fazem. É o pedido.

## Decisão 5 — dimensão do Consolidado vem da barra

`ESTADO_CONSOLIDADO.dimensao` e o `<select id="consolidado-dimensao">` saem. A aba passa
a usar a **primeira dimensão marcada na barra compartilhada**, a mesma convenção que a
aba Alertas já segue (a tabela tem um jogo de colunas de valor só, não dá para empilhar
dimensões nela).

**Consequência:** a aba deixa de abrir em Volume. Abre no que a barra tiver — Financeiro,
no padrão atual — e portanto mostra o Ticket médio em vez de Equipes previstas +
Produtividade. A razão original do default em Volume (as colunas de premissa física só
existem lá) continua verdadeira, mas o pedido é explícito: um seletor de dimensão só na
página inteira.

O controle de **semana** da aba continua sendo dela (não tem equivalente na barra).

### A coerção de dimensão, e onde ela tem de valer (revisão final, 2026-08-04)

A barra tem **três** dimensões (`DIMENSOES_CONFIG_SEMANAL`: equipes, volume, financeiro,
nessa ordem canônica) e esta tabela sabe desenhar **duas**. A regra é
`dimensaoDaTabela()` (`render-aba-consolidado.js`, exportada): `financeiro` fica
`financeiro`, **todo o resto vira `volume`** — a página não mede equipes por semana em
lugar nenhum, e Volume é a leitura física disponível.

**A coerção tem de valer também para o recorte de ativos, e é por isso que ela é uma
função exportada em vez de uma expressão solta.** `indicesDaAba(indices, dimensao)`
(Decisão 4) recebe a dimensão do recorte; passando a **crua** da barra, marcar "Equipes" —
sozinha **ou junto com Volume**, já que `equipes` vem primeiro na ordem canônica e
`dimensoes[0]` é quem manda — fazia `FiltroAtivos` filtrar por `previsto.equipes`
enquanto a tabela exibia colunas de **Volume**. Um registro com
`previsto.volume[mês] = 300` e `previsto.equipes[mês] = 0`, sem furo no mês, sumia de uma
tabela que estava mostrando justamente o volume dele. **Invariante: filtrar e exibir pela
MESMA dimensão.**

A aba Alertas não tem esse problema — ela filtra e exibe pela mesma dimensão crua (com
Equipes marcada as células saem "Sem dado", que é a resposta honesta lá) — e por isso
**não** passa por `dimensaoDaTabela`.

### A nota de tela quando a barra está em Equipes

Consequência direta da coerção: com "Equipes" marcada, a aba mostra números de **Volume**.
Antes deste branch isso era inalcançável (o seletor próprio da aba só tinha
volume/financeiro); agora é.

A aba emite, como **primeira linha do `<tbody>`**, uma nota dizendo que Equipes não se
aplica ao Consolidado e que os números exibidos são de Volume. **Mesma gramática visual da
nota que `render-alertas-tendencia.js` já usa** para o caso irmão (`<tr
class="linha-nota-alertas"><td colspan="N">`, com `.linha-nota-alertas td` já estilizada em
`CSS_SEMANAL`): nenhum componente novo, e `<tr>` e não `<p>` porque um `<p>` dentro de
tabela é içado para fora pelo parser HTML5 (foster parenting). O `colspan` é calculado
(4 colunas de texto + Realizado + Tendência + as premissas da dimensão exibida), não fixo.

### Rótulo da coluna congelada

O rótulo é **`Tendência congelada em dd/MM (até dd/MM)`** — âncora e fim da semana. A
primeira versão era `Tendência congelada em 06/07 (06/07 a 12/07)`: a data-âncora é sempre
o 1º dia da semana exibida, então ela aparecia duas vezes, e como `#tabela-consolidado th`
**não** tem `white-space: nowrap` (só `.cabecalho-premissa` e as colunas de texto têm), o
rótulo quebrava em duas linhas. A informação não saiu — foi reorganizada. A semana futura
continua `Tendência (projeção de hoje) (dd/MM a dd/MM)`.

## Testes

- **Congelamento:** a Tendência de uma semana encerrada bate com o que
  `calcularSeriesSemanaisDimensao` devolve para aquela semana quando chamada com
  `hojeEpoch` = 1º dia dela; e NÃO bate com a projeção de hoje quando as duas diferem
  (senão o teste passaria mesmo sem o congelamento). Semana futura usa o hoje real.
- **Cabeçalho:** diz "congelada" com a data certa nos dois casos congelados, e "projeção
  de hoje" na semana futura.
- **Colunas:** Previsto não aparece mais; Realizado e Tendência aparecem; as colunas de
  premissa continuam trocando com a dimensão.
- **Ativos:** com o check ligado, SUP sem Previsto nem Realizado no mês some das quatro
  abas; desligado, volta. O número do Balanço com o check ligado continua igual ao de
  antes desta mudança (era o default dele).
- **Dimensão:** trocar a dimensão na barra troca as colunas de premissa do Consolidado;
  não existe mais `#consolidado-dimensao` no HTML.
- **Coerção:** `dimensaoDaTabela` mapeia equipes→volume; e, com Equipes marcada na barra,
  um registro com volume previsto e equipes zeradas **continua na tabela** (o recorte de
  ativos usa a dimensão exibida, não a crua) e a nota de tela aparece. Prova por mutação:
  voltar o recorte para a dimensão crua tem de derrubar o teste.
- **Congelamento, o índice:** com furos plantados no **1º dia** da semana escolhida, a
  Tendência congelada muda se `indiceAtualEfetivo` for trocado por `indiceAtual` — é o
  único fixture que discrimina os dois (97 contra 74).
- **Anel:** o HTML gerado não contém mais a regra do `box-shadow` do `.status-circulo`.
- `test/orcamento-html-inalterado.test.js` continua passando — o orçamento não é tocado.

## Fora de escopo

- O dashboard de orçamento (inclusive o contraste do "Excelente" lá, que tem o mesmo
  problema e continua como está).
- Persistência de histórico / workflow agendado (ver Decisão 3).
- As colunas de premissa do Consolidado, que ficam como estão.
