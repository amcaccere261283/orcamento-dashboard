# Gráfico ORÇAMENTO — Design v1

## Contexto

O dashboard ORÇAMENTO hoje mostra só uma tabela (`docs/superpowers/specs/2026-07-21-primeira-tabela-orcamento-design.md`). O usuário pediu um gráfico, usando como referência os gráficos reais já existentes em duas planilhas do Excel:

- `OR - 2026 (04.A) - Base 00.1 - 2026.02 R00.1 Atual.xlsx`, abas **FINANCEIRO 2026** (chartsheet) e **DASH GERAL CTT** (62 gráficos repetindo o mesmo padrão por dimensão/contrato).
- `Gerencial Semanal - Juvencio.xlsx`, aba **GERENCIAL** (4 gráficos semanais, Sondagem/Lab/Todos — cadência e estrutura diferentes da MATRIZ, não usado como referência aqui).

Padrão identificado nas duas primeiras abas (via inspeção direta do XML de cada `chartN.xml`): um combo chart com **barras mensais de P/R/T no eixo primário** e **linha do acumulado (soma corrida mês a mês) de P/R/T no eixo secundário**, repetido por dimensão (Financeiro/Volumetria/Equipes).

## Escopo v1

Uma segunda visão ("Gráfico") no dashboard ORÇAMENTO, alternável via abas com a "Tabela" já existente. Fora de escopo por enquanto: mini-gráfico de 3 barras (P/R/T, total do ano) tipo KPI visto na aba DASH — fica pra uma v2 se fizer falta.

## Arquitetura

Hand-rolled SVG, gerado inteiramente por JS client-side dentro do mesmo `SCRIPT_CLIENTE_TABELA` que já monta a tabela — sem biblioteca de gráficos, mantendo a arquitetura zero-dependência do projeto (mesma decisão já tomada pro parsing de xlsx). O gráfico reaproveita a mesma agregação por índices filtrados que a tabela já usa (`filtrarIndicesPorGrupoSup`-equivalente, já embutido em `recalcularTabela`), evitando duplicar a lógica de "quais registros valem pro recorte atual".

## Abas

Dois botões "Tabela" / "Gráfico" na barra de filtros (ao lado de "Limpar filtros"/"Atualizar dados"), alternando qual seção fica visível (`display: none` na não-ativa). Os filtros (tipologia/grupo/SUP/série) e o seletor de dimensão continuam compartilhados entre as duas abas — trocar de aba não reresta nada.

## Comportamento por dimensão

O seletor de dimensão já existente (Equipes/Volume/Financeiro/Produtividade/Ticket médio) também controla o gráfico. Duas dimensões de razão (Produtividade, Ticket médio) não recebem o mesmo tratamento das 3 dimensões de soma, porque "acumular" uma razão não tem significado real:

**Equipes / Volume / Financeiro (soma):**
- Barras agrupadas, eixo primário (esquerda): valor **mensal** de cada série visível (Previsto azul `#2f6ad0`, Realizado verde `#7fd858`, Tendência âmbar `#f6b53f`) — respeitando o filtro de série (`filtro-serie`): se um estiver selecionado, só essa barra aparece; senão as 3 aparecem agrupadas por mês.
- Linha, eixo secundário (direita, escala independente): **acumulado** (soma corrida mês a mês, popular o mês N com a soma de Jan..N) da mesma série, mesma cor da barra correspondente, traço tracejado (`stroke-dasharray`) pra diferenciar visualmente de uma barra sólida.

**Produtividade / Ticket médio (razão):**
- Só linha, eixo único: valor **mensal** de cada série visível (mesmas cores). Sem barras, sem acumulado.

## Cálculo do acumulado

Não existe hoje nenhuma soma corrida no código — é um valor novo. Pra uma série com valores mensais `[v0..v11]`, o acumulado é `[v0, v0+v1, v0+v1+v2, ...]` (soma corrida). Quando o registro agregado tem mais de uma tipologia (linha de total por SUP/geral), a soma corrida é feita sobre os valores mensais JÁ agregados (mesma soma que a tabela já mostra mês a mês), nunca recalculada tipologia por tipologia.

## Escala dos eixos

- Eixo X: 12 meses (Jan–Dez), mesmas categorias/rótulos da tabela (`formatarMesAno`).
- Eixo Y primário (barras, dimensões de soma): auto-escala com base no maior valor mensal entre as séries visíveis (mínimo sempre 0).
- Eixo Y secundário (linha do acumulado): auto-escala independente com base no maior acumulado visível — tipicamente bem maior que o eixo primário (por isso precisa ser um eixo à parte, fiel ao padrão original do Excel).
- Dimensões de razão (Produtividade/Ticket médio): eixo Y único, auto-escala com base no maior valor mensal entre as séries visíveis.
- Valor nulo (sem dado no mês) é tratado como 0 pra fins de posicionamento geométrico (a tabela mostra "—", o gráfico não tem como plotar um traço nesse ponto — convenção comum de gráfico).

## Redesenho

O SVG é reconstruído do zero a cada chamada de `recalcularTabela` (mesmo gatilho que já recalcula a tabela em toda mudança de filtro/dimensão), usando o mesmo conjunto de índices filtrados. Não há estado incremental — sempre um render completo, mesma filosofia do resto do script cliente.

## Legenda e rótulos

Legenda simples acima do gráfico (bolinha colorida + nome da série: Previsto/Realizado/Tendência), mostrando só as séries atualmente visíveis (respeitando o filtro de série). Rótulos numéricos nos eixos usam o mesmo `formatarNumero` (pt-BR, 2 casas) já usado na tabela — sem abreviação de milhar/milhão no v1.

## Testes

Funções puras de cálculo (soma corrida, escala/mapeamento de coordenadas) ficam isoladas de manipulação de DOM, testáveis via `vm.Context` do mesmo jeito que `calcularMensal`/`mesclarConsecutivos` já são hoje. A montagem do SVG em si (construção de string) é verificada via Playwright, seguindo o mesmo padrão de verificação visual já usado no resto do projeto.
