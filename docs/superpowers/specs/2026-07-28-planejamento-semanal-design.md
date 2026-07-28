# Planejamento Semanal — design

Data: 2026-07-28

Segunda página do repositório `orcamento-dashboard`, com layout, filtros e comportamento
idênticos ao dashboard de orçamento. Amplia a análise do mês vigente separando-o em 4
semanas (Previsto, Realizado, Tendência) e acrescenta o gráfico "Balanço de massa", que
compara Realizado contra a base prevista por SUP, dentro de cada tipologia de sondagem.

## Contexto e restrições

**A planilha semanal ainda não existe.** O usuário vai disponibilizá-la depois. Realizado
e Tendência semanais são os únicos dados que dependem dela; todo o resto sai do que o
orçamento já lê hoje. O projeto foi fatiado para que a ausência dela não bloqueie nada
além dessas duas colunas.

**Os dados reais, medidos na MATRIZ atual em 2026-07-28:**

- 340 registros = 34 SUPs × 10 tipologias, grade **densa**: todo SUP tem linha em toda
  tipologia, mesmo sem volume nenhum.
- Tipologias: `SP`, `SM / SM.F / SR`, `ST`, `PI`, `BL`, `CPTu`, `SH`, `VT`, `LAB.C`,
  `LAB.E`. (`SM / SM.F / SR` é **um** rótulo, não três.)
- `MENSAL`, `ACUMULADO` e `GRUPO="Todos"` são blocos-resumo do Excel e já são descartados
  por `parseMatriz` — não são tipologias nem SUPs.

A densidade da grade é o fato que mais influencia o desenho da aba 2: sem filtro de
atividade, todo gráfico mostraria 34 linhas, a maioria com barra de comprimento zero.

**Forma do registro** produzido por `parseMatriz` (é o contrato de entrada das duas abas):

```js
{ origem, grupo, tomador, sup, escopo, apoio, inicio, termino, tipologia, observacao,
  previsto:  { equipes[12], equipesResumo{pico,media,prod,dias},
               volume[12],  volumeResumo{total,totalInicial,ticket},
               financeiro[12], financeiroResumo{total,totalInicial} },
  realizado: { ...igual... },
  total:     { ...igual... } }
```

`previsto` = BASE "P", `realizado` = "R", `total` = "T" (a Tendência). O **Previsto
Inicial** não vem daqui: vem do estudo de linha de base, lido por `parse-baseline.js`, que
já entrega (SUP, tipologia) × 12 meses sem coluna BASE.

## Arquitetura: três fases

O `render-dashboard.js` do orçamento tem 2514 linhas, com CSS, markup e JS de cliente em
template literals. Duplicá-lo para obter "layout idêntico" garantiria divergência entre as
duas páginas em poucas semanas. A alternativa é extrair o que é comum, em três fases de
risco crescente.

### Fase A — utilitários compartilhados

Mover para `tools/comum/`: `xlsx-reader.js`, `zip-reader.js`, `xlsx-cells.js`,
`criptografia.js`, `datas.js`. São puros, já têm testes próprios e nenhum deles conhece
orçamento. Risco visual zero.

### Fase B — casca visual compartilhada

Extrair para `tools/comum/render-shell.js` o que as duas páginas dividem: tokens e base de
CSS, cabeçalho, barra de filtros multi-select, barra de abas e o fluxo de desbloqueio por
senha.

Junto vão as funções de cálculo que hoje estão presas como JS de cliente dentro do
`render-dashboard.js` e que a página nova precisa com a mesma semântica —
`mediaEquipesPonderada`, `somarIntervaloEquipeDias` e a constante `DIAS_PREMISSA_MES`.
Reimplementá-las do lado de cá seria a forma mais fácil de as duas páginas passarem a
discordar sobre quantas equipes havia num período.

**Critério de aceite:** reconstruir o dashboard de orçamento com uma senha fictícia e
exigir diff **byte-a-byte** contra o `dist/orcamento-dashboard.html` anterior, ignorando
apenas a linha `__DADOS_CIFRADOS__` e o timestamp `Gerado em`. Qualquer diferença reprova a
fase. Essa é a técnica de verificação que o projeto já usa e está registrada no
`CLAUDE.md`.

Esta é a única fase que mexe no dashboard que está no ar.

### Fase C — a página nova

`tools/semanal/` com `build-dashboard.js`, `compute-semanal.js`, `render-semanal.js`,
produzindo `dist/planejamento-semanal.html` e sua cópia obrigatória em
`docs/planejamento-semanal.html`.

URL publicada: `https://amcaccere261283.github.io/orcamento-dashboard/planejamento-semanal.html`.
O Pages deste repositório serve `master:/docs`; a página nova entra como um segundo arquivo
em `/docs` e **não altera** a URL do orçamento, que continua sendo o `index.html`.

## Aba 1 — Tabela semanal do mês vigente

Mesma barra de filtros e mesmo seletor de dimensão (equipes / volume / financeiro) do
orçamento. Agrupamento de linhas idêntico ao da aba Tabela atual.

Colunas: S1..S4, cada uma com Previsto / Realizado / Tendência, mais o total do mês.

**Previsto semanal = Previsto mensal do mês vigente ÷ 4**, por definição do usuário. É uma
divisão nominal, não calendária: nenhum mês tem exatamente 4 semanas, então S1..S4 são
quatro fatias iguais do mês, não semanas ISO. Nenhum cálculo depende de datas.

**Exceção obrigatória: equipes não se divide por 4.** Volume e financeiro são fluxos —
dividir o mês em 4 partes iguais faz sentido e fecha na soma. Equipes é uma foto, não um
fluxo: se 2 equipes estão mobilizadas no mês, cada semana tem 2 equipes, não 0,5. O próprio
orçamento já trata isso e documenta a premissa em `mediaEquipesPonderada` ("acumular vários
meses deve ser uma MÉDIA ponderada pelos dias, não uma soma bruta"). Aplicar o ÷ 4 a
equipes produziria números errados em silêncio, e ainda quebraria a comparação com o
orçamento, que mostra a média.

Portanto, na dimensão **equipes**, o Previsto de cada semana é o próprio valor mensal, e o
"total do mês" da linha é a média das 4 semanas — não a soma. Nas dimensões **volume** e
**financeiro**, vale o ÷ 4 e o total é a soma. Essa diferença é visível na interface: o
rótulo da coluna de total muda entre "Total" e "Média" conforme a dimensão, para que
ninguém some equipes por engano.

**Realizado e Tendência semanais vêm da planilha nova.** Até ela chegar, as colunas são
renderizadas vazias. A aba é navegável e o Previsto já é conferível desde o primeiro dia.

**Invariante testável:** a soma S1+S2+S3+S4 do Previsto tem que bater exatamente com o
valor do mês vigente calculado pelo orçamento, para toda combinação de filtros. Isso vira
teste automatizado e é o que garante que as duas páginas contam a mesma história.

## Aba 2 — Balanço de massa

Um gráfico de barras divergentes **por tipologia**. A escolha de quais tipologias aparecem
vem do filtro de tipologia já existente na casca compartilhada: um gráfico por tipologia
selecionada, empilhados, cada um com a tipologia como cabeçalho (o "ST" do sketch). Filtro
vazio significa, como no resto do dashboard, "sem filtro" — todas as tipologias.

Por gráfico, uma linha por SUP:

- **Linha central** = a base escolhida no seletor: **Previsto** ou **Previsto Inicial**.
  Tendência não entra — o usuário descartou explicitamente.
- **Barra colorida** = `Realizado − base`. Verde para a direita quando acima, vermelha para
  a esquerda quando abaixo. Comprimento proporcional ao desvio absoluto.
- **Barra laranja hachurada, desenhada dentro da colorida** = equipes médias mobilizadas,
  também `Realizado − base`, em **escala horizontal própria e independente**. Equipes andam
  na casa das unidades e volume na de centenas ou milhares; numa régua só a barra laranja
  seria imperceptível.

  Para períodos de mais de um mês ("acumulado até o mês"), equipes usa **média ponderada
  pelos dias**, nunca soma — mesma premissa do orçamento. A função que faz isso,
  `mediaEquipesPonderada`, hoje vive como JS de cliente dentro do `render-dashboard.js`, não
  em `compute-orcamento.js`. A Fase B a move para o módulo compartilhado, junto com
  `DIAS_PREMISSA_MES`, de onde as duas páginas passam a consumi-la.
- **Rótulos**, como no sketch: a base junto à linha central, o realizado na ponta da barra,
  as equipes em laranja.

Controles próprios da aba:

- **Período**: mês vigente, acumulado até o mês, e S1..S4. As semanas ficam desabilitadas
  enquanto a planilha semanal não existir.
- **Dimensão**: volumetria ou financeiro.
- **Check "somente SUPs ativos no período"**, ligado por padrão.

### Ordenação

Ordem decrescente pelo desvio **com sinal**: `+100, +70, +15, −50, −72`. Uma regra só que
satisfaz as duas exigências do usuário — do maior para o menor, positivos antes dos
negativos. Entre negativos, isso põe o menos negativo primeiro (`−50` antes de `−72`).

### Definição de "SUP ativo no período"

Ativo = tem movimento na tipologia daquele gráfico, no período selecionado: `previsto > 0`
**ou** `realizado > 0` na dimensão escolhida. A atividade é avaliada por (SUP, tipologia),
não por SUP — a grade é densa e um contrato pode estar ativo em `ST` e zerado em `LAB.E`.

As colunas `inicio`/`termino` do registro (datas seriais do Excel) **não** são usadas para
isso: a janela contratual não diz se houve movimento naquela tipologia.

O check **filtra** (esconde os inativos), não apenas realça. Com 34 SUPs densos por
tipologia, esconder é o que torna o gráfico legível.

## Fora de escopo

**A alimentação de volta para o orçamento.** O objetivo declarado é que os resultados deste
projeto alimentem o dashboard de orçamento, mas desenhar esse retorno antes de conhecer a
planilha semanal seria chute. Vira um spec próprio quando a aba 1 estiver de pé e a
planilha existir.

**Semanas calendárias.** S1..S4 são fatias nominais do mês. Se a planilha semanal chegar
com semanas ISO ou com 5 semanas em alguns meses, isso vira uma revisão deste spec, não uma
adaptação silenciosa.

## Testes

- Fase A: as suítes existentes continuam passando sem alteração de comportamento.
- Fase B: diff byte-a-byte do HTML do orçamento, descrito acima.
- Aba 1: o invariante de fechamento S1..S4 contra o mês vigente, sob várias combinações de
  filtro — soma em volume e financeiro, média em equipes. Um teste específico deve falhar
  se alguém aplicar o ÷ 4 à dimensão equipes.
- Aba 2: cálculo do desvio e da ordenação com sinal; escalas independentes produzindo
  comprimentos corretos; o filtro de ativos removendo exatamente as linhas sem movimento.
- Build: a página nova é gerada e `docs/planejamento-semanal.html` fica idêntica a
  `dist/planejamento-semanal.html`.

## Riscos

**A Fase B toca no dashboard que está no ar.** Mitigado pelo diff byte-a-byte, mas é onde a
revisão deve ser mais cuidadosa.

**O Previsto Inicial não cobre necessariamente todos os SUPs da MATRIZ viva.** A linha de
base é uma foto do início do projeto; contratos que entraram depois não têm linha lá. Com a
base "Previsto Inicial" selecionada, esses SUPs precisam aparecer explicitamente como sem
base — nunca como desvio zero, que seria indistinguível de "realizado bateu o previsto".
