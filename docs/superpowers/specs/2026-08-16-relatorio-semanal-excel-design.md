# Relatório Semanal em Excel (nível gerencial) — Design

Data: 2026-08-16
Página: `docs/planejamento-semanal.html` (repo `orcamento-dashboard`)

## Objetivo

Um botão na aba **Consolidado** que gera, inteiramente no navegador, um arquivo
`.xlsx` com visão gerencial da semana: Previsto, Realizado e Tendência de
Volume e Equipes, por tipologia e por contrato, cobrindo três janelas de tempo
(semana anterior, acumulado do mês até a data, semana que vem), com um
capítulo de destaque para os principais desvios e campos para registrar ações
e responsáveis. Cada geração também grava um resumo numa Google Sheet, para
existir histórico entre gerações.

## Decisões de arquitetura (fechadas com o dono do projeto em 2026-08-16)

1. **Geração 100% no navegador.** O botão monta o `.xlsx` a partir dos dados
   já carregados na página (`window.__REGISTROS__`, demandas, etc. — os
   mesmos que alimentam Tabela Semanal/Consolidado/Alertas) e dispara o
   download via `Blob`. Não é um script Node à parte: qualquer um que abra o
   dashboard publicado consegue gerar o relatório, sem terminal.
2. **Histórico central em Google Sheet via Apps Script**, mesmo padrão já em
   produção para a aba Alocação Equipes (`alocacao-sheet.js` +
   `apps-script-alocacao.gs`).
3. **Critério de desvio: o semáforo de Alertas.** Reaproveita
   `classificarSemaforo` (`render-aba-alertas.js`) literalmente — mesmos hex,
   mesmos limiares (Crítico <70%, Atenção 70–90%, Dentro da meta 90–110%,
   Excelente >110%, Sem dado). O capítulo de desvios lista só Crítico e
   Atenção.
4. **Botão na aba Consolidado** — é a aba que já mostra o fechamento
   gerencial da semana.

## Estrutura do arquivo (4 abas)

### 1. Resumo

Capa do relatório: mês/semana reportada (com datas), "Gerado em"/"Gerado
por", e um resumo de contagem (quantos itens Crítico e quantos Atenção
apareceram no capítulo de Desvios, por dimensão).

### 2. Desvios

O capítulo de destaque. Duas seções internas — **Por tipologia** e **Por
contrato** — cada uma cruzando as duas dimensões (Volume, Equipes) e as três
janelas de tempo. Só entram linhas classificadas **Crítico** ou **Atenção**
pelo semáforo; **Excelente**/**Dentro da meta**/**Sem dado** ficam fora deste
capítulo (aparecem nas abas Volume/Equipes, não aqui).

Base de comparação por janela (é sempre "o que aconteceu/vai acontecer" ÷
Previsto, mesma leitura do semáforo de Alertas):

| Janela | Numerador do desvio |
|---|---|
| Semana anterior | Realizado ÷ Previsto |
| Acumulado do mês até a data | Realizado ÷ Previsto |
| Semana que vem | Tendência ÷ Previsto (não existe Realizado — ainda não aconteceu) |

Colunas: SUP, Tomador, Tipologia (e Contrato, na segunda seção), Janela,
Dimensão, Previsto, Realizado/Tendência (o que aplica), Desvio %, Status
(texto + cor de fundo condicional via `dxf`, mesmas 4 cores do
`xlsx-writer.js`), e duas colunas em branco: **Ação** e **Responsável**, para
preenchimento manual depois de aberto no Excel.

### 3. Volume / 4. Equipes

Uma aba por dimensão. Tabela aberta por **SUP → Tipologia → Contrato**, mesma
hierarquia de `blocosPorSup`/`tipologiasPresentes`
(`render-aba-consolidado.js`), com uma linha TOTAL GERAL no topo e uma linha
TOTAL por SUP fechando cada bloco — igual ao Consolidado.

Colunas, em 3 blocos:

- **Semana anterior** (Previsto | Realizado | Tendência congelada no início
  dela)
- **Acumulado do mês até a data** (Previsto | Realizado | Tendência)
- **Semana que vem** (Previsto | Tendência — sem Realizado)

Formatação numérica: Volume inteiro (0 casas); Equipes com 2 casas (é média
ponderada, igual ao resto do projeto).

## Fonte dos números — tudo reaproveitado, quase nada recalculado

O módulo novo (`tools/semanal/compute-relatorio-semanal.js`) é um
**montador**, não um motor de cálculo novo:

- **Séries semanais**: `calcularSeriesSemanaisDimensao`
  (`render-aba-semanal.js`) — a mesma função que Tabela Semanal, Consolidado,
  Alertas e Gráficos já usam. Garante que o relatório nunca discorda do que a
  página mostra.
- **Congelamento da Tendência da semana anterior**: mesmo mecanismo do
  Consolidado — chamar `calcularSeriesSemanaisDimensao` de novo com
  `hojeEpoch = início da semana anterior`.
- **Acumulado do mês**: `agregarFatias` + `janelaDoPeriodo(PERIODO_ACUMULADO,
  ...)`, ambos já exportados de `render-aba-alertas.js`.
- **Semana que vem**: mesmas séries "ao vivo" (`hojeEpoch` de hoje), lidas no
  índice da semana seguinte.
- **Semáforo**: `classificarSemaforo` (`render-aba-alertas.js`), literal.
- **Agrupamento SUP/tipologia/contrato**: `blocosPorSup`,
  `tipologiasPresentes` (`render-aba-consolidado.js`).

### Índice de semana fora do mês selecionado

"Semana anterior" da 1ª semana do mês, e "semana que vem" da última semana do
mês, caem em **outro mês civil** — possivelmente outro ano. `semanasDoMes` já
aceita qualquer `(ano, mesIndex)`, inclusive fora de `[0,11]` (o overflow de
mês do `Date.UTC` do JavaScript resolve o rollover de ano sozinho), então
buscar a semana vizinha é só chamar `semanasDoMes(ano, mesIdx - 1)` /
`semanasDoMes(ano, mesIdx + 1)` quando o índice sair dos limites do mês
vigente.

**Limitação conhecida e aceita:** os registros só carregam Previsto/Tendência
para os 12 meses do ano corrente (`window.__ANO__`). Se a semana anterior cai
em dezembro do ano ANTERIOR (só acontece na 1ª semana de janeiro), Previsto e
Tendência daquela semana saem "sem dado" — só o Realizado (que vem do Avanço
Sond, por data, não por índice de mês) continua correto. Caso raro (1
semana/ano), documentado aqui e no comentário do código; não vale a
complexidade de carregar o ano anterior só por causa dele.

## Geração do .xlsx no navegador

`tools/lib/xlsx-writer.js` + `zip-writer.js` (repositório irmão
`matriz-equipes-source`, já usados por `tools/matriz/gerar-historico-excel.js`)
são independentes de dependências externas, mas usam `Buffer`/`node:zlib` —
Node puro, não rodam no navegador. Este projeto ganha uma cópia própria,
portada para browser-safe:

- `Buffer.from(str, 'utf8')` → `new TextEncoder().encode(str)` (Uint8Array).
- `Buffer.alloc`/`writeUInt32LE`/etc → `DataView` sobre um `ArrayBuffer`.
- `zlib.crc32` → tabela CRC32 pura em JS (~15 linhas, algoritmo padrão
  IEEE 802.3, sem dependência).
- `createZip`/`buildXlsx` devolvem `Uint8Array` em vez de `Buffer`; o
  download usa `new Blob([bytes], {type: '...spreadsheetml.sheet'})` +
  `URL.createObjectURL`.

Arquivos novos: `tools/semanal/xlsx-writer-browser.js` e
`tools/semanal/zip-writer-browser.js`, entram no `BUNDLE_ARQUIVOS`
(`render-semanal.js`) antes de `compute-relatorio-semanal.js`. Formatação
condicional (`dxf`) do semáforo é a mesma técnica que `xlsx-writer.js` já
implementa (`conditionalFormattingXml`) — só reaproveitar.

O botão em si: `<button id="gerar-relatorio-excel">`, handler que monta as 4
abas, chama `buildXlsx`, baixa o arquivo (nome
`relatorio-semanal-SUP...-AAAA-MM-DD.xlsx` com a data de geração), e dispara o
POST de histórico (abaixo) — o download não espera a rede.

## Histórico — Google Sheet via Apps Script

Novo par, no molde de `alocacao-sheet.js`/`apps-script-alocacao.gs`:

- `tools/semanal/historico-relatorio-sheet.js` — módulo dual Node+navegador,
  sem `require`, com `fetch`/`armazenamento` injetados (mesmo padrão de
  `criarClienteAlocacao`). Diferença: é **append-only** (histórico, não
  estado) — não existe "carregar o estado atual", só `gravar(linhas)`.
- `apps-script-historico-relatorio.gs` — cole numa Sheet nova (mesmo processo
  de setup do `apps-script-alocacao.gs`: Extensões > Apps Script, implantar
  como App da Web, "Qualquer pessoa"). `doPost` só faz `appendRow` (sem
  upsert: cada geração é um registro histórico novo, nunca substitui um
  anterior). Sem `doGet` com leitura de volta neste momento — o histórico é
  consultado abrindo a Sheet diretamente, não pelo dashboard.

**Granularidade da linha gravada: por (SUP × Tipologia), não por contrato.**
Colunas: `geradoEm, semanaInicio, semanaFim, sup, tipologia, dimensao,
previstoSemanaAnterior, realizadoSemanaAnterior, tendenciaSemanaAnterior,
previstoAcumulado, realizadoAcumulado, tendenciaAcumulado,
previstoSemanaQueVem, tendenciaSemanaQueVem, qtdCritico, qtdAtencao, autor`.
As duas últimas (`qtdCritico`/`qtdAtencao`) ficam em branco nas linhas por
SUP×tipologia e só são preenchidas na linha-resumo de fechamento de cada
geração (`sup='—', tipologia='TOTAL GERAL'`, campos de Previsto/Realizado/
Tendência também em branco nela — as duas linhas usam o mesmo cabeçalho, mas
carregam informação diferente: uma é grandeza, a outra é contagem). A
granularidade por CONTRATO fica só no `.xlsx` baixado —
replicá-la na Sheet multiplicaria a linha histórica por ~80 contratos toda
semana, para um uso (comparação de tendência ao longo do tempo) que faz
sentido no nível SUP×tipologia. Se isso se provar insuficiente na prática, dá
para revisitar depois — é mais fácil aumentar a granularidade de um histórico
que já existe do que podar um que já nasceu grande demais.

Falha de rede no POST: mesmo padrão de `alocacao-sheet.js` — grava numa fila
local (`localStorage`) e tenta de novo depois; o download do `.xlsx` já
aconteceu e não depende disso.

## Ações e Responsáveis

Só na aba Desvios (não em toda linha de Volume/Equipes — colocar em ~80
contratos × 2 dimensões × 3 janelas seria ruído). Colunas em branco, sem
validação nem fórmula: o usuário preenche depois de abrir no Excel. Não são
gravadas de volta em lugar nenhum (nem na Sheet de histórico) — o `.xlsx` é o
dono desse dado, igual a uma planilha de acompanhamento manual.

## Fora de escopo

- Ler o histórico de volta dentro do dashboard (ex.: um gráfico de evolução
  dos desvios ao longo das semanas). A Sheet existe para consulta manual por
  enquanto.
- Financeiro como terceira dimensão — o pedido foi explícito em Volume e
  Equipes.
- Qualquer edição do `.xlsx` gerado ser reimportada no dashboard.

## Testes

- `compute-relatorio-semanal.js`: testes Node puro para a montagem das 3
  janelas, o congelamento da semana anterior, o cruzamento de mês/ano na
  semana vizinha, e a classificação de desvios (reaproveitando
  `classificarSemaforo`).
- `xlsx-writer-browser.js`/`zip-writer-browser.js`: teste que gera um `.xlsx`
  e confere a estrutura do ZIP (mesmo tipo de teste que
  `test/xlsx-writer.test.js` do repositório irmão já faz) — sem precisar de
  navegador real, rodando em Node com `Uint8Array`/`TextEncoder`, que também
  existem lá.
- `historico-relatorio-sheet.js`: mesmo padrão de
  `test/semanal-apps-script-alocacao.test.js` — sandbox do `.gs` com um
  Sheets dublê, testando o `appendRow` isoladamente.
- Teste de wireup: o botão existe na aba Consolidado e está ligado ao handler
  (mesmo padrão de `test/semanal-render-semanal-wireup.test.js`).
