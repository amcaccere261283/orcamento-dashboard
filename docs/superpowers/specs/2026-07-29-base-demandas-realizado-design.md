# Base de demandas e realizado — design

Data: 2026-07-29

Traz para o Planejamento Semanal uma base mensal de **quantidade de furos** extraída da
aba `Avanços` do `Avanço Sond.xlsx`: quando as demandas chegam, quando a sondagem é feita,
quando o relatório fecha, o que foi cancelado e o que está parado. Análise mensal e
acumulada, na mesma grade de 12 meses que o orçamento já usa.

É a primeira frente que não sai da MATRIZ. Até aqui as duas páginas liam a mesma fonte
mensal (MATRIZ viva + estudo de linha de base); esta lê uma planilha de execução, linha por
furo, com datas reais.

## Escopo

**Entra:** o módulo de ingestão, o mapa de tipologias, a agregação mensal das 5 séries, e
uma aba nova com a tabela mensal/acumulada para conferir os números.

**Não entra:**

- **Os gráficos do orçamento portados para a página semanal.** Decisão do dono em
  2026-07-29: é o passo seguinte, spec próprio. Os gráficos vão consumir exatamente o
  `compute-demandas.js` deste spec, sem recalcular nada.
- **Qualquer valor em R$.** O Avanços não tem preço. Financeiro exigiria cruzar com preço
  unitário por (contrato, item), e a aba `Base Tags` da mesma planilha tem só 87 linhas —
  não cobre os 36 SUPs. Decisão do dono: a medida é quantidade de furos.
- **As colunas Realizado/Tendência da aba 1**, que seguem vazias. São dimensão
  volume/financeiro, não contagem de furos, e estão no caminho da Fase 2 (filtros) —
  ver "Convivência com a Fase 2".
- **Laboratório.** `LAB.C` e `LAB.E` não existem no Avanços; têm fonte própria
  (`02a. Extratos Laboratório Realizado`, `Lab Concluido`). Ficam zerados nesta base.

## A fonte

`G:\Meu Drive\PMO\06 - Orçamento\OR26 - Rev 01 - Frcst 6+6\Dados e extratos\Extratos Sond\Avanço Sond.xlsx`,
aba **`Avanços`** — 61.927 linhas de dados, uma por furo, 36 SUPs distintos.

Colunas que interessam:

| Col | Nome | Uso |
|---|---|---|
| A | Contrato | o SUP, no mesmo formato da MATRIZ (`SUP-7285-24`) |
| I | Criação da OS | data de chegada da demanda |
| J | Tipo | tipologia crua (21 rótulos distintos) |
| L | Status | `CONCLUIDO` 50.662 · `PENDENTE` 6.102 · `CANCELADO` 4.331 · `EXECUTADO` 811 · vazio 21 |
| N | Término Sondagem | fim da sondagem em campo, e início da etapa de relatório |
| O | Conclusão | fim da etapa de relatório |
| Q | Atualizado | última alteração da linha — única âncora de data das canceladas |

Semântica dos status, confirmada pelo dono: **CONCLUIDO** é o processo inteiro fechado
(sondagem + relatório); **EXECUTADO** é a sondagem feita em campo com o relatório ainda por
fazer; **PENDENTE** é o que ainda não teve nenhuma intervenção; **CANCELADO** é o que o nome
diz. Realizado em campo é, portanto, `CONCLUIDO + EXECUTADO`.

A aba usa só `sharedStrings` e números — `readXlsxSheet` de `tools/comum/xlsx-reader.js` lê
como está, sem extensão nenhuma. (Vale registrar o contraste: os arquivos de
`01. Extratos Produção` gravam texto como `inlineStr`, que o `xlsx-cells.js` atual **não**
lê — devolve zero para todas as colunas de texto. Não é problema deste spec porque ele não
usa aquela fonte, mas é armadilha para quem for mexer nela depois.)

## Arquitetura

Mesma pipeline que o orçamento já roda duas vezes (`parse-matriz` → `compute-orcamento` →
`render`): agregar no build e embutir a matriz mensal pronta no blob cifrado. Alternativas
descartadas, com o motivo:

- **Mandar os 61.927 furos crus e agregar no navegador** permitiria recortes futuros por
  semana ou dia sem rebuild, mas multiplica o blob por uma ordem de grandeza, faz a página
  iterar 60 mil linhas a cada mudança de filtro, e move a agregação para código só testável
  via DOM. O pedido é mensal + acumulado; recorte semanal não está pedido.
- **JSON intermediário commitado** livraria o build da dependência do `G:` montado, o que é
  um problema real para colaborador sem acesso ao Drive — mas cria um passo manual cuja
  omissão não faz o build falhar, exatamente o formato da armadilha do `docs/` desatualizado
  de 2026-07-22. Se valer resolver o `G:`, que seja de propósito e para as duas páginas.

### Módulos

| Arquivo | Responsabilidade |
|---|---|
| `tools/semanal/config-demandas.js` | **Criar.** Caminho do arquivo e nome da aba. Separado do `config.js` do orçamento: é outra fonte, com outro ciclo de atualização, e nada do orçamento depende dela. |
| `tools/semanal/parse-avancos.js` | **Criar.** Lê a aba e devolve uma linha por furo: `{ sup, tipologiaCrua, status, criacaoOS, terminoSondagem, conclusao, atualizado }`, datas já convertidas de serial Excel. Descarta linha vazia. Nenhuma agregação. |
| `tools/comum/tipologias-avancos.js` | **Criar.** O mapa de tipologia crua → rótulo do dashboard, e só isso. Em `comum/` porque a ingestão de laboratório vai precisar do mesmo mapa. |
| `tools/semanal/compute-demandas.js` | **Criar.** Função pura, sem I/O: recebe os furos e os 12 períodos, devolve `(tipologia, mês) → 5 séries`. |
| `tools/semanal/render-aba-demandas.js` | **Criar.** A tabela: um bloco por série, uma linha por tipologia, 12 colunas de mês + total, com alternância Mensal/Acumulado. |
| `tools/semanal/render-semanal.js` | **Modificar, ~10 linhas, todas aditivas.** `alternarAba` e `montarDashboard` são escritas aba por aba, não genéricas: entram a entrada em `ABAS_VISUALIZACAO`, a `<div id="secao-demandas">`, duas linhas em `alternarAba`, o listener e a chamada em `montarDashboard`, a entrada em `BUNDLE_ARQUIVOS` e o `<style>` próprio. Nenhuma linha existente muda de comportamento — ver "Convivência com a Fase 2". |
| `tools/semanal/build-dashboard.js` | **Modificar.** Ler a nova fonte e passar `demandas` para `renderSemanal`. |

### O agregado no blob

`renderSemanal` faz `JSON.stringify({ registros, baseline })` e cifra o resultado. O novo
`demandas` entra nesse mesmo objeto **como array de objetos simples**, nunca como `Map`:
`JSON.stringify` de um `Map` devolve `{}`, e os dados desapareceriam dentro do blob cifrado
sem erro nenhum. O próprio `build-dashboard.js` já documenta essa pegadinha no comentário de
`baselineParaCliente` — foi ela que obrigou o `baseline` a virar array.

O eixo de meses são os mesmos 12 `periodos` que o build já deriva do cabeçalho da MATRIZ.
Reaproveitar é o que garante que a série de demandas fique alinhada com o resto do
dashboard em vez de assumir ano corrente.

## As cinco séries

Todas em quantidade de furos, por (tipologia, mês).

| Série | Regra | Total 2026 |
|---|---|---|
| Demandas chegadas | mês de `I`, todos os status | 16.570 |
| Sondagem realizada | mês de `N`, status ∈ {CONCLUIDO, EXECUTADO} | 15.387 |
| Relatório concluído | mês de `O`, status = CONCLUIDO | 14.753 |
| Canceladas | mês de `Q`, status = CANCELADO | 1.902 |
| Pendentes *(estoque)* | chegou até o fim do mês e sondagem não terminou até ali; exclui CANCELADO | 7.154 (jan) → 6.176 (dez) |

Distribuição mensal medida em 2026-07-29 (jan..jul). De agosto em diante os quatro fluxos
são zero, porque não há evento futuro; o estoque **não** zera, fica parado em 6.176 até
dezembro — que é justamente o comportamento esperado de um saldo e a razão de ele não somar:

```
chegadas (I)            2972  2204  5625  1206  1145  1796  1622
sondagem realizada (N)  1208  2603  2798  2488  2506  2008  1776
relatório concluído (O)  879  2096  2733  2438  2498  2575  1534
canceladas (Q)           164    59    61    42   312   385   879
estoque pendente        7154  6614  9297  7980  6578  6337  6176
```

### Fluxo x estoque

As quatro primeiras séries são **fluxos**: o acumulado é soma corrida. **Pendentes é
estoque** — no modo acumulado ele mostra o próprio saldo do mês, nunca uma soma. Somar
saldos daria um número sem significado, crescente e convincente.

É a mesma premissa que o projeto já carrega em dois lugares: `mediaEquipesPonderada`
(acumular equipes é média ponderada, não soma) e `dividirEmSemanas` (equipes é foto, não
fluxo, e não se divide por 4). Vira teste dedicado.

**Limitação declarada do estoque:** cancelada sai do saldo **por status**, não por data,
porque data de cancelamento não existe na planilha (ver a âncora `Q` abaixo). Consequência: um
furo cancelado em julho já aparece fora do saldo de janeiro, embora naquele momento estivesse
de fato em aberto. O saldo histórico subestima em até 4.331 furos no pior caso, decrescendo
até zero no mês corrente. Não há como corrigir com os dados disponíveis — a planilha guarda
só o status final, não as transições. A alternativa (manter cancelada no saldo até a data de
`Q`) trocaria um erro conhecido e limitado por um pior: usar um proxy de data para decidir
presença em estoque, onde o erro não teria teto.

### Por que cada âncora

- **Chegadas conta todos os status, inclusive cancelada.** Chegou é chegou; o cancelamento é
  evento posterior e tem série própria, então a conta líquida é possível na tela. Contar só
  as sobreviventes reescreveria o passado a cada cancelamento novo.
- **Sondagem realizada exige o status, não só a data.** `N` está preenchida em linha
  PENDENTE também; sem o filtro de status a série contaria furo não executado.
- **Relatório concluído exige `status = CONCLUIDO`, não a presença de `O`.** 798 das 811
  linhas EXECUTADO têm `O` preenchida, o que contradiz a definição de EXECUTADO ("relatório
  a ser executado"). Nessas linhas `O` não significa relatório fechado. Quem trocar essa
  regra por "tem `O`" infla a série em ~800 furos.
- **Canceladas ancoram em `Q`, e isso é um proxy declarado.** A coluna `P` se chama
  "Cancelamento" mas está **vazia em todas as 4.331 canceladas** e **preenchida em todas as
  50.662 CONCLUIDO**, tipicamente cerca de um ano depois da conclusão: comporta-se como prazo
  contratual, não como data de evento. `Q` (Atualizado) é a única data que existe em 100% das
  canceladas. O risco é conhecido: se alguém tocar a linha depois do cancelamento, a data
  anda. A alternativa exata seria ancorar em `I` (553 furos em 2026), mas isso mede outra
  coisa — a safra de chegada que morreu, não quando o cancelamento aconteceu — e não
  combinaria com as outras quatro séries, que são todas de evento.

## Mapa de tipologias

A MATRIZ tem 10 rótulos; o Avanços tem 21. Definição do dono em 2026-07-29:

| Cru no Avanços | Rótulo na base |
|---|---|
| `SP`, `ST`, `PI`, `BL`, `SH`, `VT` | idem |
| `CPTU` | `CPTu` (só caixa) |
| `SM`, `SM.F`, `SR` | `SM / SM.F / SR` (rótulo único, como na MATRIZ) |
| `SP.F` | `SP.F` — independente, **não** entra em `SP` |
| `SM.A` | `SM.A` — independente, **não** entra em `SM / SM.F / SR` |
| `SEG.A`, `SEG.V` | rótulos próprios, em bloco separado, renderizado só se houver furo no período (são serviços acionados sob demanda) |
| `BQ`, `SN`, `DN`, `PZ.SP`, `PZ.SM`, `INA` | `Especiais` |
| — | `LAB.C` e `LAB.E` existem na grade com zero |

**Rótulo desconhecido faz o build falhar**, citando o rótulo na mensagem. A alternativa —
cair calado em `Especiais` — deixaria uma tipologia nova contabilizada no lugar errado por
meses sem ninguém perceber. Falhar é barato: mexer no mapa é uma linha.

## Eixo SUP

Os 36 SUPs do Avanços entram com o rótulo real, inclusive os 13 que a MATRIZ não tem
(1.150 linhas, as maiores sendo `SUP-6785-23 (SO)` com 494 e `SUP-8238-25` com 251). Os 11
SUPs da MATRIZ sem nenhuma linha no Avanços ficam zerados.

Nada é descartado por não casar. Foi exatamente esse o Critical que a revisão final da Fase
1 pegou em `linha-base.js`: linha sem correspondência virava indistinguível de linha
legitimamente ausente. O build reporta a contagem dos dois lados no log.

## Bordas e qualidade de dados

Tudo abaixo foi medido na planilha real em 2026-07-29, não suposto:

- **21 linhas vazias** (sem SUP, tipo nem profundidade): descartadas por `parse-avancos.js`,
  com a contagem no log do build.
- **3.929 datas absurdas em `M`** (Início Sondagem), de 1901 a 2078. Não afeta nada: `M` não
  ancora série nenhuma. Fica registrado para ninguém tentar usar `M` sem saneamento.
- **`N` está 100% limpa**: as 61.927 linhas têm valor dentro de 2023-02 a 2026-07-28. As duas
  colunas que o dono definiu como bordas do ciclo (`I` e `N`) são justamente as sem lixo.
- **15 datas absurdas em `O`** e **61 linhas CONCLUIDO sem `O`**: ficam fora da série de
  relatório, com contagem no log.
- **74 furos concluídos sem `N` válida** nunca saem do estoque pela regra de data. É a
  diferença entre o saldo de dezembro (6.176) e as 6.102 linhas PENDENTE de hoje. Reportado
  no log — a alternativa, calar, faria o saldo divergir do status sem explicação.
- **5.546 furos de legado** chegaram antes de 2026 e não terminaram: o saldo de janeiro
  (7.154) é majoritariamente isso. A tabela rotula o estoque de abertura, senão janeiro
  parece um pico inexplicável.
- **Limite de saneamento de data:** serial fora de 2023-01-01..2027-01-01 é tratado como
  ausente. A planilha só tem operação a partir de 2023-02.

## A aba Demandas

Um bloco por série, linha por tipologia, 12 colunas de mês mais a coluna de fechamento, e um
controle **Mensal / Acumulado**.

A coluna de fechamento segue a natureza da série, não o modo: em fluxo ela é **Total** (soma
dos 12 no modo mensal, último valor no acumulado — o mesmo número); em estoque ela é
**Saldo**, sempre o último mês, nos dois modos. Somar 12 saldos mensais produziria
exatamente o número sem significado que este spec evita, e chamá-lo de "Total" no modo
mensal só esconderia isso atrás de um rótulo. Mesmo cuidado que a aba 1 já toma ao trocar
"Total" por "Média" na dimensão equipes.

Sem barra de filtros nesta aba. Quando a Fase 2 entregar a barra compartilhada, ela recorta
esta aba pelo mesmo caminho das outras — mas não antes, e não neste spec.

## Testes

`node --test test/*.test.js`, Node puro, sem DOM, sobre fixture sintética de furos:

- **Âncora de cada série:** um furo CONCLUIDO com `N` em março e `O` em abril conta em
  *sondagem realizada* de março e em *relatório concluído* de abril — nunca nos dois no mesmo
  mês, nunca duas vezes.
- **`N` sem status não conta:** furo PENDENTE com `N` preenchida fica fora de *sondagem
  realizada*.
- **`O` em linha EXECUTADO não conta** em *relatório concluído*.
- **Pendentes não acumula:** saldos 5/7/6 em três meses dão 5/7/6 no modo acumulado, não
  5/12/18.
- **Cancelada fora do estoque**, e cancelada ancorada em `Q`.
- **Mapa de tipologias, um caso por linha da tabela**, incluindo `SM.A` **não** caindo em
  `SM / SM.F / SR` e `SP.F` **não** caindo em `SP`.
- **Rótulo desconhecido faz o build falhar** citando o rótulo.
- **`SEG.A`/`SEG.V` sem furo no período não renderizam** o bloco.
- **O agregado sobrevive ao `JSON.stringify`** do blob: nenhum `Map` no payload.
- **Sanidade contra a planilha real**, condicionado à existência do `G:` (`fs.existsSync` no
  caminho, `t.skip` se não houver): chegadas de 2026 somam 16.570 e o saldo de dezembro é
  6.176. Sem isso, um erro de mapeamento passa por toda a suíte sintética.

Os testes existentes de `render-semanal` mudam de expectativa (passa a haver uma terceira
aba) e precisam ser ajustados junto, não depois.

## Convivência com a Fase 2

A Fase 2 (filtros e layout do orçamento na aba 1) está em andamento em paralelo — há um
spec do Kairo em `2026-07-29-planejamento-semanal-filtros-design.md` e outro do dono em
`2026-07-29-semanal-filtros-layout-orcamento-design.md`, com uma branch local implementando
o segundo. Esta frente foi desenhada para não colidir:

- Toca **um único arquivo compartilhado**, `render-semanal.js`, em duas linhas (registrar a
  aba e chamar o render). Todo o resto é arquivo novo.
- Não toca `render-aba-semanal.js`, `render-aba-balanco.js`, `compute-semanal.js` nem
  `render-shell.js` — que é onde as duas versões da Fase 2 trabalham.
- Não muda o HTML do orçamento, então `test/orcamento-html-inalterado.test.js` continua
  passando sem regenerar golden.

## Riscos

**O proxy `Q` para canceladas** é a única regra deste spec que não é exata. Se a série de
canceladas parecer errada em uso, é o primeiro lugar para olhar — e a troca para `I` é
localizada em `compute-demandas.js`.

**O build passa a depender de uma terceira planilha no `G:`.** Se o arquivo não existir, o
build deve falhar com mensagem clara dizendo qual caminho faltou, não com `ENOENT` cru: um
caminho errado em cache já travou uma sessão inteira neste projeto (registrado no
`CLAUDE.md`, no item da aba Gerencial).

**A planilha é grande** (61.927 linhas, ~826 mil células, 15 MB). O parser de XML por regex
do repo dá conta, mas o build fica sensivelmente mais lento. Se incomodar, o caminho é
filtrar linha por ano antes de agregar — não trocar o parser.
