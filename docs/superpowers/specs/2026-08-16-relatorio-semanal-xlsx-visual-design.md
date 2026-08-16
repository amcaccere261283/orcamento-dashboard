# Layout visual do Relatório Semanal em Excel — Design

Data: 2026-08-16
Página: `docs/planejamento-semanal.html` (repo `orcamento-dashboard`)

## Objetivo

O `.xlsx` gerado pelo botão da aba Consolidado (ver
`2026-08-16-relatorio-semanal-excel-design.md`) hoje só escreve células cruas —
sem negrito, cor, largura de coluna ou cabeçalho congelado. Pedido do dono do
projeto: dar "cara de relatório" ao arquivo, sem mudar nenhum número que ele
já mostra.

## Escopo

Só o gerador client-side: `tools/semanal/xlsx-writer-browser.js` (o motor
OOXML) e `tools/semanal/render-relatorio-semanal-xlsx.js` (quem monta as 4
abas). Os dois rodam **inteiramente no navegador** — o botão "Gerar relatório
Excel" monta o arquivo a partir de `window.__REGISTROS__`/demandas já
carregados na página, sem passar por Node. `tools/lib/xlsx-writer.js` (o
gêmeo Node no repositório `matriz-equipes-source`, usado por
`gerar-historico-excel.js` da Matriz) fica de fora — projeto e formato de
consumo diferentes, nenhum motivo para acoplar os dois.

## Paleta (aprovada com o dono do projeto)

A da marca do dashboard, não uma paleta corporativa neutra:

| Papel | Cor |
|---|---|
| Faixa de título | grafite `#1A1A19`, texto branco |
| Acento do título | âmbar `#F6B53F` |
| Cabeçalho de tabela | grafite `#1A1A19`, texto branco, negrito |
| Zebra (linha par de dado) | cinza claro `#F2F2F2` |
| Bordas | cinza `#D9D9D9`, finas |
| Status Crítico / Atenção | os mesmos hex que a formatação condicional já usa hoje (`dxf` 0/1) — sem mudança |

## Extensão do motor (`xlsx-writer-browser.js`)

Hoje o motor não tem noção de estilo — todo `<c>` sai sem atributo `s`, e
`styles.xml` só declara um `cellXf` (índice 0) mais os 2 `dxf` de formatação
condicional. Fica:

1. **Tokens de estilo nomeados** — um mapa fixo (`titulo`, `cabecalhoTabela`,
   `linhaZebra`, `rotulo`, `numeroMilhar`, `numeroDuasCasas`, ...) resolvido
   para um índice de `cellXfs` gerado em `stylesXml()`. `str`/`num` ganham um
   segundo parâmetro opcional, `{ estilo }` — sem o parâmetro, o comportamento
   é idêntico ao de hoje (estilo 0, default), então nenhuma chamada existente
   quebra.
2. **Larguras de coluna** — `sheet.colWidths` (array paralelo às colunas) vira
   `<cols>` no XML, antes de `<sheetData>`.
3. **Células mescladas** — `sheet.merges` (lista de `'A1:L1'`) vira
   `<mergeCells>`, inserido depois de `<sheetData>` e antes de
   `<conditionalFormatting>` (ordem de schema OOXML).
4. **Congelamento de painel** — `sheet.freezeRows` (nº de linhas fixas no
   topo) vira `<sheetViews><sheetView><pane ySplit="N" .../></sheetView
   ></sheetViews>`, antes de `<cols>`.
5. **Altura de linha** — `sheet.rowHeights` (mapa índice→altura) escreve
   `ht`/`customHeight` no `<row>` correspondente (usado só na linha de
   título).

Nenhuma dessas chaves é obrigatória — uma `sheet` sem `colWidths`/`merges`/
`freezeRows`/`rowHeights` continua gerando exatamente o XML de hoje (os
testes atuais de `xlsx-writer-browser.js` continuam valendo sem alteração).

## Layout por aba

Todas as 4 abas ganham uma **linha de título mesclada no topo** (linha 1,
altura maior, estilo `titulo`): "Relatório Semanal — Planejamento · `<Aba>` ·
`<Mês/Ano>`". Na aba **Resumo** isso é uma restilização da linha 1 que já
existia (não desloca nada abaixo dela). Nas abas **Desvios/Volume/Equipes**,
que hoje começam direto pela tabela, é uma linha nova — todo o conteúdo delas
desce 1 linha. Os testes de `render-relatorio-semanal-xlsx.js` que hoje
verificam número exato de linha (`B9`, `B13`, contagem de `<row>` na aba
Volume) são atualizados junto, na mesma tarefa — é deslocamento estrutural
esperado, não regressão.

- **Resumo**: título restilizado; rótulos (coluna A) em negrito; larguras
  A=30/B=22.
- **Desvios**: título; cabeçalho das 12 colunas (`CABECALHO_DESVIOS`) com
  estilo `cabecalhoTabela`; linhas de dado com zebra; congelamento de 2 linhas
  (título + cabeçalho — cobre só a 1ª seção, "Por tipologia"; o cabeçalho de
  "Por contrato", mais abaixo na mesma aba, não fica fixo — limitação aceita,
  não há solução sem duplicar a estrutura). Larguras por coluna calibradas ao
  conteúdo (SUP/Tipologia/Status estreitas; Tomador/Ação largas).
- **Volume / Equipes**: título; cabeçalho das 12 colunas
  (`CABECALHO_DIMENSAO`) com `cabecalhoTabela`; zebra nas linhas de registro
  (linhas TOTAL GERAL/TOTAL SUP continuam com o destaque que já tinham,
  agora como um estilo próprio em vez de texto puro); congelamento de 2
  linhas (título + cabeçalho — aqui cobre a tabela inteira, é uma tabela só).
  Formatação numérica: `numeroMilhar` (`#,##0`) em Volume, `numeroDuasCasas`
  (`#,##0.00`) em Equipes — só exibição; os valores já chegam arredondados
  como hoje (`arredondar()` em `render-relatorio-semanal-xlsx.js` não muda).

## Fora de escopo

- Qualquer mudança em `compute-relatorio-semanal.js` ou nas contas do
  relatório — este design é só visual.
- `tools/lib/xlsx-writer.js` (repositório irmão) — não ganha os mesmos
  recursos nesta rodada; se um dia isso incomodar, é decisão própria de lá.
- Logo/imagem embutida — o motor não tem suporte a `drawing`/imagens, e não
  foi pedido.

## Testes

- `test/semanal-xlsx-writer-browser.test.js`: novos testes para `colWidths`
  → `<cols>`, `merges` → `<mergeCells>`, `freezeRows` → `<pane>`, e o novo
  parâmetro de estilo em `str`/`num` → atributo `s` no `<c>` correspondente,
  batendo com o índice certo em `cellXfs`.
- `test/semanal-render-relatorio-semanal-xlsx.test.js`: testes existentes que
  referenciam linha exata são atualizados para o novo deslocamento (+1 em
  Desvios/Volume/Equipes); novos testes confirmam a presença da linha de
  título mesclada e do congelamento em cada aba.
