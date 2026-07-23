# Aba Alertas (semáforo de desvio) — Design v1

## Contexto

O dashboard ORÇAMENTO hoje tem duas abas (Tabela, Gráfico — ver `2026-07-21-primeira-tabela-orcamento-design.md` e `2026-07-21-grafico-orcamento-design.md`). O usuário quer uma terceira visão: uma tabela resumo que classifica o desvio de Realizado/Tendência contra Previsto/Previsto Inicial, por faixa de percentual, com um semáforo de cores — pra identificar rapidamente onde (SUP, tipologia, grupo...) o orçamento está fora da meta, sem precisar ler número a número na tabela detalhada.

## Escopo v1

Uma terceira aba "Alertas", ao lado de "Tabela"/"Gráfico", reaproveitando os filtros de recorte já existentes (Origem/Categoria/Tipologia/Grupo/SUP) e a mesma base de registros (`window.__REGISTROS__`) já carregada no client. Fora de escopo: qualquer dado da aba Gerencial/Juvencio (fonte B.Dados, adiada — ver `project_gerencial_juvencio_chart_deferred` memory), export/impressão da tabela de alertas, e configuração dos thresholds pelo usuário (ficam fixos no código nesta v1).

## Arquitetura

Mesmo arquivo `render-dashboard.js`, mesmo padrão das duas abas existentes: HTML/CSS/JS gerados como strings e embutidos no HTML final, sem dependência nova. A aba Alertas ganha:

- Uma terceira seção (`secao-alertas`), alternada por `alternarAba` do mesmo jeito que `secao-tabela`/`secao-grafico` já são hoje.
- Cinco seletores próprios, usando o mesmo componente visual de filtro multi-select (`montarFiltroMulti`/`filtro-multi-*`) já usado pelos filtros de recorte — mas com estado próprio, independente de `filtrosSelecionados` (ver seção Estado).
- Um helper novo `bucketPeriodo(mensal, vigenteIdx, periodo)` que espelha os buckets do `calcularJanelas` de `compute-orcamento.js` (hoje só usado no build) — client-side, na mesma linha da duplicação que já existe entre `calcularMensal`/`calcularTotalAno` (client) e o que o build calcula. Não vale a pena unificar: o client roda como string de `<script>` no HTML final, sem `require()` em runtime.

## Filtros de recorte (compartilhados)

Origem/Categoria/Tipologia/Grupo/SUP continuam valendo como hoje — mudar um desses filtros na aba Alertas também afeta Tabela/Gráfico (mesmo `filtrosSelecionados` global), e vice-versa. Consistente com o resto do dashboard.

## Estado próprio da aba Alertas

Cinco seletores novos, com estado **independente** do resto (não compartilham objeto com `filtrosSelecionados.dimensao`/`.serie`, que continuam controlando só Tabela/Gráfico):

- **Agrupar por** (seleção única): `sup` | `tipologia` | `grupo` | `categoria` | `origem`. Default: `sup`.
- **Dimensão** (seleção única): `equipes` | `volume` | `financeiro` | `produtividade` | `ticketMedio`. Default: `financeiro`.
- **Numérico** (multi-select): `realizado` | `total` (rótulo "Tendência"). Default: ambos marcados.
- **Baseline** (multi-select): `previsto` | `previstoInicial`. Default: só `previsto` marcado (mesma convenção do filtro de Série existente, onde Previsto Inicial começa desmarcado).
- **Período** (multi-select, 8 opções): `acumuladoAnterior`, `mesVigente`, `m1`, `m2`, `m3`, `acumuladoFuturo`, `acumuladoAteVigente`, `totalAno`. Default: `acumuladoAteVigente` + `totalAno` marcados.

Trocar "Agrupar por" ou "Dimensão" reconstrói a tabela inteira. Marcar/desmarcar Numérico/Baseline/Período reconstrói só as colunas (linhas continuam as mesmas).

## Linhas

Uma linha por valor distinto do campo escolhido em "Agrupar por", entre os registros que passam nos filtros de recorte atuais (mesma função `indicesFiltrados` já usada por Tabela/Gráfico) — ordem alfabética do valor. Mais uma linha final **TOTAL GERAL**, somando todos os registros filtrados independente do agrupamento.

Sem sub-agrupamento hierárquico nesta v1: se "Agrupar por" = SUP, a linha de um SUP soma todas as tipologias dele; pra ver por tipologia dentro de um SUP, o usuário troca "Agrupar por" ou usa o filtro de SUP pra restringir antes.

## Colunas

Cada combinação marcada de **Período × Numérico × Baseline** vira uma coluna, na ordem Período (na ordem da lista acima) → Numérico (Realizado antes de Tendência) → Baseline (Previsto antes de Previsto Inicial). Rótulo da coluna: `"<Numérico> ÷ <Baseline> — <Período>"` (ex.: "Realizado ÷ Previsto — Total Ano"). Com os defaults (Período = Acumulado até Vigente + Total Ano; Numérico = ambos; Baseline = só Previsto): 4 colunas.

## Cálculo de cada célula

Para uma linha (grupo de registros) e uma coluna (período, numérico, baseline, mais a Dimensão selecionada globalmente pra aba), o intervalo de meses do período é sempre:

- `acumuladoAnterior`: meses `[0, vigenteIdx)`.
- `mesVigente`/`m1`/`m2`/`m3`: um mês só (`vigenteIdx`, `vigenteIdx+1`, `vigenteIdx+2`, `vigenteIdx+3`).
- `acumuladoFuturo`: meses `[vigenteIdx+4, 12)`.
- `acumuladoAteVigente`: meses `[0, vigenteIdx]` (inclui o vigente).
- `totalAno`: os 12 meses.

**Dimensões de soma (Equipes/Volume/Financeiro):** soma o array mensal bruto (`registro[serie][dimensao]`) através de todos os registros do grupo e dentro do intervalo de meses do período — mesma soma que `calcularMensal`/`calcularTotalAno` já fazem, só generalizada pra um intervalo de meses arbitrário em vez de "todos os 12" ou "1 mês". `desvio = numerador / denominador`; se o denominador somado for `0` ou todos os meses forem `null` (nenhum dado ainda) → célula "sem dado".

**Dimensões de razão (Produtividade/Ticket médio):** nunca faz média das razões mensais — soma os arrays BRUTOS de numerador e denominador (`CAMPOS_RATIO`) através dos registros do grupo e do intervalo de meses do período, e só então divide, exatamente como `calcularTotalAno` já faz pro ano inteiro hoje (generalizado aqui pra qualquer intervalo, não só 0..11). Exceção: quando a série é `previsto` e o grupo tem uma única tipologia, o valor é a premissa fixa da planilha (`equipesResumo.prod`/`volumeResumo.ticket`) — constante, independente do período escolhido (mesmo caso especial de `calcularMensal`/`calcularTotalAno`).

Em qualquer um dos dois casos: `desvio = numerador / denominador`. Se `denominador` for `0`, `null`, ou o numerador vier `null` (sem dado ainda no intervalo) → célula "sem dado", cinza, sem calcular razão.

## Semáforo

Mesma regra de faixa pra todas as dimensões (Financeiro aqui é receita bruta, não custo — maior é sempre melhor, sem inversão):

| Range | Indicador | Cor |
|---|---|---|
| > 110% | Excelente | `#1414CC` |
| 90%–110% | Dentro da meta | `#128A3E` |
| 70%–90% (excl.) | Atenção | `#F5A700` |
| < 70% | Crítico | `#D32020` |
| sem dado (baseline zero/nulo) | Sem dado | `#6E7580` |

Limites: `> 1.10` azul; `0.90 <= x <= 1.10` verde; `0.70 <= x < 0.90` amarelo; `x < 0.70` vermelho — sem sobreposição nem lacuna.

## Renderização da célula

Fundo sólido com a cor da faixa, texto branco com o percentual formatado (`104%`, 0 casas decimais). `title` (tooltip nativo, mesmo padrão de hover/foco já usado na Tabela) mostra os dois valores absolutos por trás da razão, formatados com `formatarNumero` já existente (ex.: "Realizado: 1.234,50 · Previsto: 1.186,00").

## Redesenho

Mesma filosofia do resto do script cliente: sem estado incremental, a tabela de Alertas é reconstruída inteira a cada mudança de filtro de recorte ou de qualquer um dos 5 seletores próprios da aba — nenhum diff de DOM.

## Testes

`bucketPeriodo` e a classificação do semáforo (faixa → cor) são funções puras, testáveis isoladamente via `vm.Context`, mesmo padrão já usado para `calcularMensal`/`mesclarConsecutivos`/`dividirJanelas`. A montagem da tabela em si (linhas/colunas/cores renderizadas) é verificada via Playwright, mesmo padrão de verificação visual do resto do projeto.
