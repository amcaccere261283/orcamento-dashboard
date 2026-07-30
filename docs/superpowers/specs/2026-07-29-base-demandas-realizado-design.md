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
| P | Cancelamento | data do cancelamento — **texto `dd/MM/yyyy`**, não serial Excel |
| Q | Atualizado | última alteração da linha — **não usada por nenhuma série** |

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
| `tools/semanal/parse-avancos.js` | **Criar.** Lê a aba e devolve uma linha por furo: `{ sup, tipologia, status, criacaoOS, terminoSondagem, conclusao, cancelamento, atualizado }`. As datas vêm de serial Excel, **exceto `cancelamento`**, que na planilha é texto `dd/MM/yyyy`. Descarta linha vazia. Nenhuma agregação. |
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
| Relatório concluído | mês de `O`, status = CONCLUIDO | 14.804 |
| Canceladas | mês de `P`, status = CANCELADO | 1.240 |
| Pendentes *(estoque)* | chegou até o fim do mês e nem a sondagem terminou nem o cancelamento ocorreu até ali | 7.861 (jan) → 6.176 (dez) |

Distribuição mensal remedida em 2026-07-30 (jan..jul). De agosto em diante os quatro fluxos
são zero, porque não há evento futuro; o estoque **não** zera, fica parado em 6.176 até
dezembro — que é justamente o comportamento esperado de um saldo e a razão de ele não somar:

```
chegadas (I)            2972  2204  5625  1206  1145  1796  1622
sondagem realizada (N)  1208  2603  2798  2488  2506  2008  1776
relatório concluído (O)  879  2096  2733  2438  2498  2622  1538
canceladas (P)           136   283    86    59    71   296   309
estoque pendente        7861  7179  9920  8577  7154  6639  6176
```

> **Correção de 2026-07-30.** A primeira versão deste spec trazia números de um script de
> medição descartável cujo regex de célula era **guloso** (`[^>]*`): numa célula vazia
> autofechada (`<c r="M9" s="5"/>`) ele engolia a barra e seguia até o `</c>` seguinte,
> devorando a célula vizinha. O parser do repositório (`parseSheetGrid`, em
> `tools/comum/xlsx-cells.js`) usa a forma preguiçosa e sempre leu certo. Toda medição deste
> spec foi refeita com o leitor do próprio repositório. O que mudou: `relatorioConcluido`
> (14.753 → 14.804), a âncora das canceladas (ver abaixo), o saldo dos meses iniciais, e as
> contagens de data suja. O que não mudou: chegadas (16.570), sondagem realizada (15.387),
> 21 linhas descartadas, 13 SUPs fora da MATRIZ, e o saldo de dezembro (6.176).

### Fluxo x estoque

As quatro primeiras séries são **fluxos**: o acumulado é soma corrida. **Pendentes é
estoque** — no modo acumulado ele mostra o próprio saldo do mês, nunca uma soma. Somar
saldos daria um número sem significado, crescente e convincente.

É a mesma premissa que o projeto já carrega em dois lugares: `mediaEquipesPonderada`
(acumular equipes é média ponderada, não soma) e `dividirEmSemanas` (equipes é foto, não
fluxo, e não se divide por 4). Vira teste dedicado.

**Cancelada sai do saldo pela data, não pelo status.** Um furo cancelado em julho estava de
fato aberto em janeiro, e o saldo de janeiro tem que dizer isso. A data existe (coluna `P` —
ver a âncora abaixo), então não há aproximação a fazer aqui.

A primeira versão deste spec afirmava o contrário e declarava uma limitação incontornável
("o saldo histórico subestima em até 4.331 furos"). Isso era consequência do bug de medição:
com `P` lida como vazia, a única saída parecia ser dar baixa por status. Com a data real, a
limitação desaparece — e o efeito é visível, o saldo de janeiro sobe de 7.154 para 7.861.

### Por que cada âncora

- **Chegadas conta todos os status, inclusive cancelada.** Chegou é chegou; o cancelamento é
  evento posterior e tem série própria, então a conta líquida é possível na tela. Contar só
  as sobreviventes reescreveria o passado a cada cancelamento novo.
- **Sondagem realizada exige o status, não só a data.** `N` está preenchida em linha
  PENDENTE também; sem o filtro de status a série contaria furo não executado.
- **Relatório concluído exige `status = CONCLUIDO`, e não a presença de `O`.** As duas regras
  dão o mesmo resultado hoje: **nenhuma** das 811 linhas EXECUTADO tem `O` preenchida, e
  nenhuma das 50.662 CONCLUIDO está sem ela. Filtrar por status é ainda assim o certo, porque
  é o status que carrega o significado — "relatório fechado" é uma etapa, não a existência de
  uma célula — e porque a planilha pode passar a preencher `O` em linha EXECUTADO sem avisar.
  (A primeira versão deste spec afirmava que 798 das 811 EXECUTADO tinham `O`; era o bug de
  medição. A regra sobrevive à correção, a justificativa não.)
- **Canceladas ancoram em `P` (Cancelamento), a data real do evento.** Todas as 4.331
  canceladas têm data, e todas as 4.331 são parseáveis. Duas particularidades importam:
  **`P` é gravada como TEXTO no formato `dd/MM/yyyy`**, não como serial Excel — `Number()`
  nela devolve `NaN`, que é exatamente como a primeira versão deste spec concluiu, errado, que
  a coluna estava vazia. E as datas vão de 2023-03-15 a 2026-07-22: só **1.240** dos 4.331
  cancelamentos ocorreram em 2026.
  **`Q` (Atualizado) não serve como âncora.** É a última alteração da linha, e a distância é
  material: a linha 22 foi cancelada em 27/02/2025 e tem `Q` = 19/12/2025 — dez meses depois,
  em outro ano. Ancorar em `Q` contaria 1.902 linhas *tocadas* em 2026 no lugar dos 1.240
  cancelamentos *ocorridos* em 2026.

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

Tudo abaixo foi remedido na planilha real em 2026-07-30 com o leitor do próprio repositório,
não suposto e não herdado da primeira versão deste spec:

- **21 linhas vazias** (sem SUP, tipo nem profundidade): descartadas por `parse-avancos.js`,
  com a contagem no log do build. Sobram 61.906 linhas úteis.
- **As colunas de data estão essencialmente limpas.** `M` (Início Sondagem, não usada por
  série nenhuma) tem **2** valores fora de 2023-2027; `N` e `O` têm **zero**. Nenhuma linha
  CONCLUIDO está sem `O`, e nenhuma das 61.906 está sem `I`. A primeira versão deste spec
  falava de 3.929 datas absurdas em `M`, 15 em `O` e 61 CONCLUIDO sem `O` — todos artefatos do
  regex guloso, que deslocava as colunas.
- **`P` (Cancelamento) é texto, e é o único campo de data que não é serial.** As 4.331
  canceladas têm valor, e todas as 4.331 parseiam como `dd/MM/yyyy`. Um leitor que faça
  `Number()` nela recebe `NaN` e conclui, errado, que a coluna está vazia.
- **74 furos CONCLUIDO/EXECUTADO sem `N` válida** nunca saem do estoque pela regra de data.
  É a diferença entre o saldo de dezembro (6.176) e as 6.102 linhas PENDENTE de hoje.
  Reportado no log — a alternativa, calar, faria o saldo divergir do status sem explicação.
- **6.233 furos de legado** chegaram antes de 2026 e, em 2026-01-01, não tinham término nem
  cancelamento: o saldo de janeiro (7.861) é majoritariamente isso. A tabela rotula o estoque
  de abertura, senão janeiro parece um pico inexplicável.
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
- **`O` em linha EXECUTADO não conta** em *relatório concluído* — hoje nenhuma linha real
  está nesse estado, e o teste existe para o dia em que estiver.
- **Pendentes não acumula:** saldos 5/7/6 em três meses dão 5/7/6 no modo acumulado, não
  5/12/18.
- **Cancelada ancorada em `P`, com `P` em texto `dd/MM/yyyy`**, e **cancelada sai do estoque
  no mês do cancelamento** — não antes (o furo estava aberto) e não nunca.
- **`P` ilegível não derruba a linha:** um valor que não parseia deixa o furo fora da série de
  canceladas e **dentro** do estoque, com contagem no log — nunca um `Invalid Date`
  silencioso, que compararia `false` contra tudo.
- **Mapa de tipologias, um caso por linha da tabela**, incluindo `SM.A` **não** caindo em
  `SM / SM.F / SR` e `SP.F` **não** caindo em `SP`.
- **Rótulo desconhecido faz o build falhar** citando o rótulo.
- **`SEG.A`/`SEG.V` sem furo no período não renderizam** o bloco.
- **O agregado sobrevive ao `JSON.stringify`** do blob: nenhum `Map` no payload.
- **Sanidade contra a planilha real**, condicionado à existência do `G:` (`fs.existsSync` no
  caminho, `skip` se não houver): chegadas de 2026 somam 16.570, relatório concluído 14.804,
  canceladas 1.240, e o saldo vai de 7.861 (jan) a 6.176 (dez). Sem isso, um erro de
  mapeamento passa por toda a suíte sintética — foi exatamente este teste que pegou o erro de
  medição que gerou a correção de 2026-07-30.

Os testes existentes de `render-semanal` mudam de expectativa (passa a haver uma terceira
aba) e precisam ser ajustados junto, não depois.

## Convivência com a Fase 2

A Fase 2 (filtros e layout do orçamento na aba 1) está em andamento em paralelo — há um
spec do Kairo em `2026-07-29-planejamento-semanal-filtros-design.md` e outro do dono em
`2026-07-29-semanal-filtros-layout-orcamento-design.md`, com uma branch local implementando
o segundo. Esta frente foi desenhada para não colidir:

- Toca **um único arquivo compartilhado**, `render-semanal.js`, e só de forma aditiva
  (ver a linha dele na tabela de módulos). Todo o resto é arquivo novo.
- Não toca `render-aba-semanal.js`, `render-aba-balanco.js`, `compute-semanal.js` nem
  `render-shell.js` — que é onde as duas versões da Fase 2 trabalham.
- Não muda o HTML do orçamento, então `test/orcamento-html-inalterado.test.js` continua
  passando sem regenerar golden.

## Riscos

**Formato de data misturado na mesma aba.** Quatro colunas de data são serial Excel e uma
(`P`) é texto `dd/MM/yyyy`. Se a planilha passar a gravar `P` como serial — ou outra coluna
como texto — o parser silenciosamente deixa de ver a data, e nada quebra: a série encolhe.
A defesa é o teste contra a planilha real, que trava as somas; ele é o único que enxergaria.
Se alguém acrescentar coluna de data nova, meça o formato antes de assumir.

**Medição por script descartável foi a causa do maior retrabalho deste spec.** Os números da
primeira versão vieram de um script de sondagem com regex guloso, e duas decisões de design
foram tomadas em cima deles. A lição, registrada aqui de propósito: para medir a planilha,
use `readXlsxSheet` do próprio repositório, não um leitor improvisado — mesmo para uma
sondagem rápida.

**O build passa a depender de uma terceira planilha no `G:`.** Se o arquivo não existir, o
build deve falhar com mensagem clara dizendo qual caminho faltou, não com `ENOENT` cru: um
caminho errado em cache já travou uma sessão inteira neste projeto (registrado no
`CLAUDE.md`, no item da aba Gerencial).

**A planilha é grande** (61.927 linhas, ~826 mil células, 15 MB). O parser de XML por regex
do repo dá conta, mas o build fica sensivelmente mais lento. Se incomodar, o caminho é
filtrar linha por ano antes de agregar — não trocar o parser.
