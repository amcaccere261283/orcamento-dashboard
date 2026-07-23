# Aba Alertas (semáforo de desvio) — Design v2

## Contexto

O dashboard ORÇAMENTO hoje tem duas abas (Tabela, Gráfico — ver `2026-07-21-primeira-tabela-orcamento-design.md` e `2026-07-21-grafico-orcamento-design.md`). O usuário quer uma terceira visão: uma tabela resumo que classifica o desvio de Realizado/Tendência contra Previsto/Previsto Inicial, por faixa de percentual, com um semáforo de cores — pra identificar rapidamente onde (SUP, tipologia, grupo...) o orçamento está fora da meta, sem precisar ler número a número na tabela detalhada.

## Revisão v2 (feedback pós-deploy, 2026-07-23)

A v1 (matriz de células coloridas, uma linha por grupo × N colunas de desvio) foi implementada, revisada e publicada, mas o usuário reportou 3 problemas depois de usar:

1. **Bug real:** os filtros de recorte de cima (Origem/Categoria/Tipologia/Grupo/SUP) nunca recalculavam a aba Alertas — só os 5 seletores próprios da aba tinham esse gatilho (`aoMudar`). Filtrar por SUP na barra de cima não mudava nada na Alertas.
2. **Sensação de filtro duplicado:** o seletor "Dimensão" de cima (Tabela/Gráfico) e o seletor "Dimensão" da própria Alertas mostravam o mesmo rótulo ("Financeiro") lado a lado, parecendo a mesma coisa duas vezes — confirmado como confusão de UI, não um bug de dado. **Decisão do usuário: manter os filtros de recorte compartilhados (não criar um segundo conjunto independente) — só corrigir a propagação.**
3. **Falta de confiança no dado:** só a % aparecia (fundo colorido), sem os valores absolutos por trás — só no tooltip. **Decisão do usuário: virar tabela de LISTA** (uma linha por combinação Período×Numérico×Baseline, não uma célula), mostrando Referência/Pesquisado/Desvio/Status como colunas, no padrão de `tools/matriz/render-dashboard.js`'s aba Alertas (`renderTabelaAlertas`/`STATUS_ALERTA_META`/busca por texto).

As seções abaixo marcadas **(v1, substituída)** documentam o que existia antes; as seções **Linhas (v2)**, **Renderização da linha (v2)**, **Busca (v2)** e **Correção: propagação de filtros** substituem o comportamento. Toda a matemática (`bucketPeriodo`, `calcularCelulaAlerta`, `colunasAlertas`, `classificarSemaforo`) continua igual e é reaproveitada — a mudança é só em como a tabela é montada (linhas em vez de células) e no bug de propagação.

## Escopo v1

Uma terceira aba "Alertas", ao lado de "Tabela"/"Gráfico", reaproveitando os filtros de recorte já existentes (Origem/Categoria/Tipologia/Grupo/SUP) e a mesma base de registros (`window.__REGISTROS__`) já carregada no client. Fora de escopo: qualquer dado da aba Gerencial/Juvencio (fonte B.Dados, adiada — ver `project_gerencial_juvencio_chart_deferred` memory), export/impressão da tabela de alertas, e configuração dos thresholds pelo usuário (ficam fixos no código nesta v1).

## Mês vigente (`vigenteIdx`)

Os buckets de período (`mesVigente`/`m1`/`m2`/`m3`/`acumuladoAnterior`/`acumuladoFuturo`) precisam saber qual dos 12 meses é "hoje" — mas esse conceito **não existe hoje em nenhum lugar do pipeline real**: `compute-orcamento.js` já tem `calcularJanelas(mensal, vigenteIdx)` testado, mas nunca é chamado por `build-dashboard.js`; e o client nunca recebe nenhuma data, só os rótulos `<th>Jan/2026</th>` já formatados como texto (`periodos` só existe no servidor). Precisa ser adicionado:

- Nova função pura em `datas.js`: `calcularVigenteIdx(periodos, generatedAt)` → compara o ano/mês UTC de `generatedAt` com o ano dos `periodos` (sempre um único ano, Jan..Dez, mesma garantia já assumida pelo resto do projeto): mesmo ano → retorna o mês (0..11, bate direto com o índice do array); `generatedAt` de um ano anterior → `-1` (ano inteiro ainda é futuro); ano posterior → `12` (ano inteiro já é passado). `calcularJanelas` já trata esses dois extremos corretamente sem mudança (mês fora do intervalo 0..11 vira `null` em `valorMes`, e `somarMeses` já usa `Math.max`/`Math.min` nos limites).
- `renderDashboard` chama `calcularVigenteIdx(periodos, generatedAt)` e embute o resultado como `window.__VIGENTE_IDX__ = <n>;` no HTML — um inteiro isolado, não é dado sensível (mesma categoria dos rótulos de mês já em texto puro), não precisa estar no blob cifrado.

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

Qualquer mudança (recorte, ou um dos 5 seletores da aba) reconstrói a tabela inteira — ver Correção: propagação de filtros.

## Linhas (v1, substituída — ver Linhas (v2) abaixo)

~~Uma linha por valor distinto do campo escolhido em "Agrupar por"~~ — ver Linhas (v2).

## Colunas (v1, substituída — vira ordem de linha em v2)

Cada combinação marcada de **Período × Numérico × Baseline**, na ordem Período (na ordem da lista acima) → Numérico (Realizado antes de Tendência) → Baseline (Previsto antes de Previsto Inicial), com rótulo `"<Numérico> ÷ <Baseline> — <Período>"` (ex.: "Realizado ÷ Previsto — Total Ano") — essa combinação e esse rótulo continuam existindo em v2, só que cada uma vira uma LINHA (ver Linhas (v2)), não mais uma coluna. `colunasAlertas` (já implementada e testada) continua sendo a função que gera essa lista ordenada; só quem a consome muda.

## Linhas (v2)

Duas dimensões de agrupamento, aninhadas:

1. **Grupo** (valor do campo escolhido em "Agrupar por": SUP/Tipologia/Grupo/Categoria/Origem), em ordem alfabética — mesmo `agruparIndicesAlertas` já implementado. Mais um grupo final **TOTAL GERAL**, somando todos os registros filtrados.
2. Dentro de cada grupo, **uma linha por combinação marcada** de Período×Numérico×Baseline (mesma lista e mesma ordem que `colunasAlertas` já produz).

Ou seja: com os defaults (2 numéricos × 1 baseline × 2 períodos = 4 combinações) e N grupos, a tabela tem `N × 4` linhas de dado + 4 linhas de TOTAL GERAL. Sem sub-agrupamento hierárquico dentro do "Agrupar por" (mesma ressalva da v1): se "Agrupar por" = SUP, a linha de um SUP soma todas as tipologias dele.

Colunas da tabela (fixas, não dependem da seleção): **[rótulo do Agrupar por]** (ex. "SUP") | **Combinação** | **Referência** | **Pesquisado** | **Desvio** | **Status**.

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

## Renderização da célula (v1, substituída — ver Renderização da linha (v2) abaixo)

~~Fundo sólido com a cor da faixa~~ — ver Renderização da linha (v2). `calcularCelulaAlerta` (já implementada e testada, devolve `{ desvio, numerador, denominador }`) continua sendo a função de cálculo — só a apresentação muda.

## Renderização da linha (v2)

Cada `<tr>` de dado (dentro de um grupo, para uma combinação) renderiza:

- **[Agrupar por]**: o valor do grupo (ex. "SUP-6498-23"), repetido em toda linha do grupo (sem rowspan — mesmo motivo já documentado pra Tabela: rowspan quebra filtro/busca por linha).
- **Combinação**: o rótulo já existente (`"<Numérico> ÷ <Baseline> — <Período>"`).
- **Referência**: `celula.denominador` (o valor do baseline) formatado com `formatarNumero(v, 0)`.
- **Pesquisado**: `celula.numerador` (o valor do numérico) formatado com `formatarNumero(v, 0)`.
- **Desvio**: `celula.desvio` como percentual inteiro (`104%`), ou `—` quando `null`.
- **Status**: `<span class="status-circulo" style="--circulo-cor:${classe.cor}"></span> ${classe.indicador}` — um círculo sólido (10px, `border-radius:50%`, cor de fundo = `classe.cor`) seguido do rótulo por extenso (Excelente/Dentro da meta/Atenção/Crítico/Sem dado), mesmo espírito do `statusChip` de `tools/matriz/render-dashboard.js`, mas círculo cheio em vez de badge com borda (pedido explícito do usuário: "círculo colorido").

Sem fundo colorido na linha inteira nem em nenhuma célula — só o círculo da coluna Status carrega cor.

## Busca (v2)

Campo de texto livre acima da tabela (mesmo padrão visual do `search-alertas` da matriz de equipes), filtrando as linhas visíveis por texto — reaproveita `normalizarBusca` (já existe no client, tira acento e caixa) em vez do `.toLowerCase()` simples da matriz de equipes, já que este projeto já tem essa função pronta e testada. Cada `<tr>` ganha um `data-search` com `[grupo, combinação].join(' ')` normalizado; o campo de busca compara contra isso, mesmo mecanismo do filtro de busca dentro de cada dropdown `filtro-multi` já existente (mas aplicado à tabela inteira, não a um painel de checkboxes).

## Correção: propagação de filtros

Bug encontrado: `montarFiltroMulti`'s handler de mudança de checkbox chamava `cfg.aoMudar ? cfg.aoMudar() : recalcularTabela();` — só os 5 `FILTROS_ALERTAS_CONFIG` tinham `aoMudar` (apontando pra `recalcularAlertas`), então mudar Origem/Categoria/Tipologia/Grupo/SUP/Série/Dimensão (os filtros de recorte, `FILTROS_CONFIG`) nunca recalculava a Alertas.

**Correção:** remove o campo `aoMudar` de `FILTROS_ALERTAS_CONFIG` (não é mais necessário) e troca a linha final do handler de mudança em `montarFiltroMulti` para chamar as duas funções incondicionalmente:
```js
recalcularTabela();
recalcularAlertas();
```
Qualquer mudança em qualquer filtro (recorte ou os 5 da Alertas) recalcula as duas abas — consistente com a filosofia "sem estado incremental" já documentada, e mais simples que manter um mecanismo de callback por config.

## Redesenho

Mesma filosofia do resto do script cliente: sem estado incremental, a tabela de Alertas é reconstruída inteira a cada mudança de filtro de recorte ou de qualquer um dos 5 seletores próprios da aba — nenhum diff de DOM.

## Testes

`calcularVigenteIdx` (novo, em `datas.js`) é testado como as outras funções puras desse módulo, via `node --test`. `bucketPeriodo` e a classificação do semáforo (faixa → cor) são funções client-side, testáveis isoladamente via `vm.Context`, mesmo padrão já usado para `calcularMensal`/`mesclarConsecutivos`/`dividirJanelas`. A montagem da tabela em si (linhas/colunas/cores renderizadas) é verificada via Playwright, mesmo padrão de verificação visual do resto do projeto. `renderCorpoAlertas`/`renderCabecalhoAlertas` (v2) ganham novos testes cobrindo o formato de lista (uma linha por combinação, colunas Referência/Pesquisado/Desvio/Status) e a busca por texto.
