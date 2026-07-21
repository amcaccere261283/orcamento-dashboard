# ORÇAMENTO — primeira tabela filtrável (v1)

## Contexto

Novo projeto, irmão de `matriz-equipes-source` e `medicoes-dashboard`: um dashboard HTML
autocontido para acompanhar o orçamento/forecast de sondagem (mesmo domínio operacional da
matriz de equipes — tipologias SM, ST, etc. — mas na visão de planejamento financeiro/contratual).

Fonte de dados: planilha Excel real, mantida pelo usuário, sincronizada localmente via Google
Drive Desktop em:

```
G:\Meu Drive\PMO\06 - Orçamento\OR26 - Rev 01 - Frcst 6+6\Modelo\OR - 2026 (04.A) - Base Frcst 6+6 Atual R00.1.xlsx
```

Aba usada nesta v1: **MATRIZ** (renomeada pelo usuário a partir de "FRCST 6+6"). O arquivo também
tem as abas MATRIZ PASSADA (ex-"PROJ. GERAL - 110MM"), Mensal (oculta), Base T.Médio,
Extrato_Sond, Financeiro e resumo — todas fora do escopo desta v1.

Gráficos (o pedido original mencionava combos barra+linha com dois eixos) ficam para uma
próxima rodada de design, depois que a tabela estiver validada. Este spec cobre só a tabela.

## Estrutura real da aba MATRIZ (confirmada por inspeção direta do .xlsx)

Cabeçalho (linha 1, colunas B em diante): `ORIGEM, GRUPO, TOMADOR, SUP, ESCOPO, APOIO, INICIO,
TERMINO, SONDAGEM, Demanda à cadastrar, Demanda Cadastrada, BASE`, seguido de 3 blocos repetidos
de 12 colunas mensais (datas seriais do Excel, ex. 46023 = 01/01/2026):

1. **Bloco equipes**: 12 meses, depois `PICO, MÉDIA, PROD., DIAS`
2. **Bloco volume**: 12 meses, depois `TOTAL, TOTAL INICIAL, TICKET`
3. **Bloco financeiro**: 12 meses, depois `TOTAL, TOTAL INICIAL`

Por fim `OBSERVAÇÃO`.

Cada combinação (contrato, tipologia de SONDAGEM) ocupa 3 sublinhas: `P` (Previsto), `R`
(Realizado), `T` (Total/consolidado) — a coluna `BASE` marca qual das três é cada sublinha. Um
mesmo contrato pode ter várias tipologias, cada uma com seu próprio trio P/R/T.

O parser deve ler os rótulos de coluna e da coluna BASE diretamente da planilha (não assumir
posições fixas), já que a aba pode ganhar/perder colunas entre revisões do modelo.

## Tabela principal

**Filtros:**
- Tipologia (SONDAGEM)
- Contrato (TOMADOR / GRUPO / ORIGEM)

**Colunas de período**, relativas a um **mês vigente selecionável** (dropdown; ao trocar, a
tabela inteira recalcula as janelas abaixo, sem recarregar a página):

| Coluna | Definição |
|---|---|
| Acumulado anterior | Soma de todos os meses antes do mês vigente |
| Mês vigente | O mês escolhido no seletor |
| M+1, M+2, M+3 | Os 3 meses seguintes, abertos individualmente |
| Acumulado futuro | Soma de todos os meses depois de M+3 |

Cada período mostra Previsto x Realizado nas 3 dimensões (equipes, volume, financeiro), mais as
métricas derivadas (produtividade, ticket médio). A planilha só traz PROD./TICKET como resumo do
ano inteiro, não por período arbitrário — para os períodos da tabela (acumulado anterior, mês
vigente, M+1..M+3, acumulado futuro) o cálculo precisa ser refeito a partir dos valores brutos
(equipes/volume/financeiro) daquele período. Antes de implementar, ler as fórmulas que a própria
planilha usa nas colunas PROD./TICKET/MÉDIA (elas são calculadas em Excel, não digitadas) para
replicar exatamente a mesma matemática, em vez de inventar uma fórmula nova.

**Sem gráficos nesta v1** — ver "Próximos incrementos".

## Arquitetura

Mesmo padrão da matriz de equipes (parse → compute → render → build), zero dependências npm —
consistente com o resto do ecossistema, que nunca teve `package.json`/`npm install`.

| Arquivo | Responsabilidade |
|---|---|
| `tools/orcamento/parse-xlsx.js` | Leitor .xlsx genérico e artesanal: abre o zip via `zlib` nativo do Node (sem `unzip` externo), lê `sharedStrings.xml` e produz uma grade de células por planilha (linha, coluna → valor tipado). Não sabe nada sobre orçamento — reutilizável para qualquer aba/arquivo. |
| `tools/orcamento/parse-matriz.js` | Entende a estrutura específica da aba MATRIZ: cabeçalhos multi-linha, blocos de 12 meses, trincas P/R/T por (contrato, tipologia). Produz uma lista de registros, um por (contrato, tipologia, sublinha P/R/T), com os valores mensais das 3 dimensões. |
| `tools/orcamento/compute-orcamento.js` | Recebe os registros + um mês de referência; calcula as janelas de período (acumulado anterior/mês vigente/M+1..M+3/acumulado futuro) e as métricas derivadas. |
| `tools/orcamento/render-dashboard.js` | Gera o HTML da tabela: filtros (tipologia, contrato, mês vigente) como dropdowns, filtragem client-side via atributos `data-*` (mesmo padrão da matriz de equipes, sem framework). |
| `tools/orcamento/build-dashboard.js` | Orquestra: lê o .xlsx do caminho no G:\, chama parse → compute → render, grava `dist/orcamento-dashboard.html`. |

**Leitura do arquivo**: direto do caminho local (`G:\Meu Drive\...`), sem publicação intermediária
— o script de build lê o arquivo do disco cada vez que roda, igual ao fluxo `node
build-dashboard.js` da matriz de equipes.

## Testes

`node --test`, um arquivo por módulo (`test/orcamento-parse-xlsx.test.js`,
`test/orcamento-parse-matriz.test.js`, `test/orcamento-compute-orcamento.test.js`,
`test/orcamento-render-dashboard.test.js`), TDD como no resto do ecossistema. Os testes do parser
genérico usam arquivos .xlsx pequenos e sintéticos (construídos no teste); os da MATRIZ usam
fixtures que espelham a estrutura real (blocos de 12 meses, trincas P/R/T) sem precisar do
arquivo real do usuário no repositório.

## Repositório e deploy

- Novo repositório **`orcamento-dashboard`**, criado localmente em
  `C:\Users\amcac\OneDrive\Desktop\Projetos IA\orcamento-dashboard`, git inicializado.
- **Privado** no GitHub (dados financeiros/contratuais são mais sensíveis que os das outras duas
  dashboards, que são públicas).
- Deploy via GitHub Pages no repo privado, se o plano do GitHub do usuário suportar Pages em
  repo privado (Pro/Team/Enterprise); caso não suporte, o dashboard fica só local (abrir o HTML
  gerado direto no navegador) até decidirmos publicação.
- Mesmo padrão de conveniência da matriz de equipes: um `.bat` que abre o HTML gerado.

## Próximos incrementos (fora desta v1)

- Gráficos combinados (barra + linha, dois eixos) sobre os dados da tabela — próxima rodada de
  design, a pedido explícito do usuário.
- Integração com a aba MATRIZ PASSADA (visão histórica/consolidada).
- Integração com a aba Financeiro (granularidade diferente: ID Contrato x Tipo).
- Automação da leitura (hoje é sempre manual, rodando `node build-dashboard.js`).
