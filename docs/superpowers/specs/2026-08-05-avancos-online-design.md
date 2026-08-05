# Avanços online — design

Data: 2026-08-05

## Objetivo

Trocar a fonte de "Realizado" (furos de sondagem) do Planejamento Semanal — hoje o
arquivo local `Avanço Sond.xlsx` (aba "Avanços", no Google Drive em `G:\...`) — por um
script que busca os mesmos dados direto do sistema Sond
(`sond.com.br/avanco-sondagens-excel/tomador/{id}/contrato-financeiro/{id}/`), um export
por contrato, agregando só **contratos financeiros ativos**. Alimenta tanto o build
principal (`tools/semanal/build-dashboard.js`) quanto o botão "Atualizar dados" da
página publicada.

## Contexto e decisões já tomadas com o usuário

- Fonte nova = 100% compatível com o parser existente: o export por contrato tem TODAS
  as colunas que `tools/semanal/parse-avancos.js` exige, com o nome exato
  (`Contrato, Criação da OS, Tipo, Status, Inicio Sondagem, Termino Sondagem, Conclusão,
  Cancelamento, Atualizado, Observações de Campo, OS, Sondador`) — confirmado baixando
  um export real (contrato SUP-7133-24, 10.974 linhas) e comparando coluna a coluna.
- "Contratos ativos" = os mesmos que os endpoints internos já usados pelo projeto
  irmão `01.Avanço Sondagens Auto` retornam:
  `financeiro/get_tomadoras_contrato_financeiro_ativo_by_prestadora/prestador/1/`
  (lista de tomadoras) seguido de
  `financeiro/get_contratos_financeiro_ativo_vigencia_indiferente_empresa_tomadora_by_prestadora/tomador/{id}/prestador/1/`
  por tomadora. Confirmado ao vivo em 2026-08-05: 54 tomadoras, **83 contratos
  financeiros ativos** no total.
- Navegador: **Google Chrome** (não Brave), com `--remote-debugging-port=9222`,
  logado em sond.com.br — padrão trocado a pedido do usuário para todos os setups
  futuros deste tipo de automação nesta máquina. Testado e funcionando em 2026-08-05.
- O script roda **separado do build principal** (não every vez que reconstrói o
  dashboard) — grava um artefato publicado que tanto o build quanto o botão
  "Atualizar dados" da página consomem.
- O mecanismo antigo (`tools/semanal/apps-script-espelho-avancos.gs`, que espelhava o
  `.xlsx` do Drive numa Sheet publicada a cada 30 min) é **aposentado** — substituído
  inteiramente pelo novo script.

## Achado-chave: reaproveitar o formato CSV existente evita tocar no parser

O botão "Atualizar dados" já busca uma Sheet publicada como CSV
(`URL_ESPELHO_AVANCOS_SEMANAL`), converte pra uma "grade" via `parseCsvGrid`
(`tools/semanal/parse-matriz-cliente.js`, já `require`ável tanto no Node quanto
bundlada pro navegador), e alimenta a MESMA `parseAvancos()` que o build usa — só que
com um `null` no início da grade pra imitar o formato 1-indexado que `readXlsxSheet`
produz (`gridCsvComoXlsx`, em `render-semanal.js`).

Ou seja: se o script novo publicar os dados combinados dos 83 contratos como **um CSV
só, com o mesmo cabeçalho que a aba "Avanços" já tem**, tanto o build (Node) quanto o
botão (navegador) continuam usando `parseAvancos()`/`parseCsvGrid()` **sem nenhuma
mudança** — só troca de onde o CSV vem. Essa é a decisão de design central: gerar CSV,
não JSON, e não um `.xlsx` sintético.

## Arquitetura

```
tools/semanal/atualizar-avancos-online.js   (script novo, roda à parte)
  1. Abre UMA sessão CDP no Chrome (reaproveita a mesma aba pra todos os fetches --
     não abre 83 abas, só paga o custo de carregar a página uma vez).
  2. Busca as 54 tomadoras ativas, depois os contratos financeiros ativos de cada uma
     -- 83 pares (tomador_id, contrato_id, nome do SUP).
  3. Para cada contrato: baixa o .xlsx via fetch (mesmo endpoint
     avanco-sondagens-excel), lê com readXlsxSheet-a-partir-de-buffer (extração nova,
     ver abaixo), roda parseAvancos() sem modificar.
  4. Junta os `furos` de todos os contratos e serializa de volta pra CSV (mesmo
     cabeçalho da aba "Avanços" original) via um serializador novo e pequeno.
  5. Grava em dist/avancos-online.csv.

tools/comum/xlsx-reader.js
  Pequena extração: readXlsxSheet(filePath, nomeAba) passa a chamar
  readXlsxSheetFromBuffer(buffer, nomeAba) por dentro -- a nova função fica exportada
  e reutilizável pelo script de fetch (que não tem um arquivo em disco, só o buffer
  baixado).

tools/semanal/build-dashboard.js
  Troca `readXlsxSheet(configDemandas.caminhoArquivo, configDemandas.nomeAba)` por ler
  dist/avancos-online.csv + parseCsvGrid + o mesmo ajuste de indexação
  (unshift(null)) que o navegador já faz -- parseAvancos() continua idêntica.

tools/semanal/render-semanal.js
  Troca URL_ESPELHO_AVANCOS_SEMANAL da Sheet publicada antiga pro arquivo publicado
  em docs/ (mesmo domínio do GitHub Pages -- sem problema de CORS, diferente de tentar
  buscar sond.com.br direto da página pública). Remove a checagem "PENDENTE" pra essa
  URL especificamente, já que a fonte nova sempre vai estar configurada.

Publicação
  cp dist/avancos-online.csv docs/avancos-online.csv, commit + push -- mesmo padrão
  manual já usado pros outros HTMLs deste repo (CLAUDE.md: "O Pages serve /docs, não
  /dist").
```

## O que NÃO muda

- `parse-avancos.js`, `parseCsvGrid`, `compute-demandas.js`, `compute-balanco.js`,
  `compute-semanal.js` e todo o resto do pipeline de cálculo — zero mudança, porque a
  interface (`furos`, vindos de `parseAvancos(grid)`) continua idêntica.
- A aba "Lab Concluido" (ensaios de laboratório) — fica exatamente como está hoje (fonte
  local + Sheet espelho), não faz parte deste escopo. O usuário só pediu Sondagens
  (Avanços) e Demandas, que vêm da MESMA fonte "Avanços" — Lab é uma aba diferente do
  mesmo workbook e não foi mencionada.
- A MATRIZ viva e a linha de base — continuam vindo do G:\ Drive, sem mudança.

## Formato do CSV combinado

Uma linha de cabeçalho (as colunas obrigatórias de `parse-avancos.js`, na mesma ordem
que o export real usa, já que `locateColunasAvancos` procura por NOME, não por
posição) seguida de todas as linhas de todos os 83 contratos, sem coluna extra de
"qual contrato/tomador" nem separador entre contratos — são só furos, e cada linha já
tem `Contrato` (SUP) como uma das colunas obrigatórias.

Campos são escapados no padrão CSV (aspas quando o valor tem vírgula/aspas/quebra de
linha, aspas internas dobradas) — mesmo formato que `parseCsvGrid` já sabe ler (é o
mesmo parser usado pra CSV publicado pelo Google Sheets).

**Correção (2026-08-05, achada rodando contra dado real — ver task-3-report.md):** a
versão original deste documento dizia que o export por contrato tinha o cabeçalho na
"linha 0" (sem a linha em branco que o `Avanço Sond.xlsx` original supostamente tinha
na linha 1). **Isso estava errado.** `readXlsxSheetFromBuffer`
(`tools/comum/xlsx-reader.js`) indexa cada linha pelo número de linha LITERAL do Excel
(`parseSheetGrid`: `grid[rowNumber] = row`), e o Excel numera a partir de 1, nunca 0 —
ou seja, `grid[0]` é SEMPRE `undefined` pra qualquer `.xlsx` real, e o cabeçalho (linha
1 do Excel) sempre cai em `grid[1]`, dado a partir de `grid[2]`. Confirmado baixando um
contrato real: `grid[0]=undefined`, `grid[1]=["Contrato","Tomador","Objeto",...]`,
`grid[2]=` primeira linha de furo. **As duas fontes (workbook original e export por
contrato) se comportam de forma IDÊNTICA nesse aspecto** — não existe a diferença de
formato que a versão anterior deste documento registrou. O ajuste de indexação
(`grid.unshift(null)`) que `gridCsvComoXlsx()` já faz continua necessário do mesmo
jeito, mas pelo motivo já documentado (`parseCsvGrid` produz uma grade 0-indexada
normal, diferente da indexação-por-linha-do-Excel que `readXlsxSheetFromBuffer`
produz) — não por causa de nenhuma peculiaridade específica de uma das duas fontes.

## Erros e resiliência

- Se um contrato falhar ao baixar (timeout, HTTP erro), o script **não aborta o resto**
  — registra o SUP que falhou, continua os outros, e reporta no fim um resumo
  (quantos ok, quantos falharam, quais). Decisão: dado parcial com aviso é melhor que
  falha total (mesmo princípio já usado no restante do projeto — "ficar sem dado e
  avisar", nunca cair calado numa métrica diferente).
- Se a sessão do Chrome não estiver logada/disponível, o script falha alto de uma vez
  (sem tentar login) — mesmo padrão do Controle Diário Sond.
- `build-dashboard.js` continua falhando alto (mensagem clara) se
  `dist/avancos-online.csv` não existir ou não tiver o cabeçalho esperado — mesmo
  tratamento de erro que já existe pra "G:\ não montado".

## Fora de escopo (por enquanto)

- Agendamento automático do script (Task Scheduler) — fica manual por enquanto, como o
  build principal já é. Pode ser adicionado depois, mesmo padrão do Controle Diário
  Sond.
- Aba "Lab Concluido" — fica como está.
- Suporte a rodar de outra máquina fica coberto pelo requisito já conhecido (Chrome
  com debug port + login manual + repositório clonado), documentado no CLAUDE.md como
  parte da implementação.
