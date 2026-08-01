# Seletor de mês na página semanal

## Motivação

A Tabela Semanal e a aba Gráficos mostram só o mês vigente, sempre --
`window.__VIGENTE_IDX__` é uma constante fixa, calculada uma vez no build
(`calcularVigenteIdx`). Quando o mês vigente muda (ex.: 1º de agosto), não
existe mais nenhum jeito de olhar o fechamento de julho na tela -- pedido
do usuário, que quer poder rever meses já fechados.

## Por que isso é simples

`calcularSeriesSemanaisDimensao`/`renderAbaSemanal` (`tools/semanal/render-aba-semanal.js`)
e `renderAbaGraficoSemanal` (`tools/semanal/render-aba-grafico-semanal.js`) já
são genéricas: recebem um índice de mês (0-11) como parâmetro qualquer, e
`semanasDoMes(ano, mesIndex)` calcula as semanas daquele mês sem nenhuma
suposição de que seja o mês corrente. O comportamento de Realizado/Tendência
já se ajusta sozinho conforme a relação entre `hojeEpoch` e as semanas do mês
pedido:

- **Mês no passado** (todas as semanas terminam antes de hoje):
  `indiceSemanaAtual` devolve `-1` (nenhuma semana contém "hoje"), e o loop de
  `calcularTendenciaSemanal` conta TODAS as semanas como "decorridas" -- o
  Realizado fica completo e a Tendência coincide com ele, sem projeção
  nenhuma. Efeito prático: mês fechado aparece fechado.
- **Mês vigente** (comportamento de hoje, sem mudança): uma semana contém
  "hoje", Realizado vai até lá e Tendência projeta o resto.
- **Mês no futuro**: nenhuma semana contém "hoje" e nenhuma termina antes
  dele -- Realizado fica em zero/sem-dado em todas (`contarEventosNoIntervalo`
  com um intervalo que não inclui nenhum evento real), o que é o
  comportamento correto pra um mês que ainda não aconteceu.

Ou seja: **nenhuma mudança é necessária em `compute-semanal.js`,
`render-aba-semanal.js` ou `render-aba-grafico-semanal.js`** -- eles já
fazem a coisa certa pra qualquer mês. O trabalho inteiro é: parar de
hardcodar `window.__VIGENTE_IDX__` como o único índice possível, e dar ao
usuário um jeito de escolher outro.

## Escopo

- **Afeta**: aba Semanal (Tabela) e aba Gráficos -- as duas mostram a MESMA
  quebra semanal do mesmo mês, então o seletor tem que valer pras duas ao
  mesmo tempo (senão a Tabela mostraria julho e o Gráfico mostraria agosto,
  inconsistente).
- **Fora de escopo**: aba Balanço de massa. Ela já tem seu próprio controle
  de período (`ESTADO_BALANCO.periodo`, "Mês vigente"/"Acumulado até o
  mês"), independente e com granularidade diferente (mensal, não semanal) --
  o pedido do usuário foi especificamente sobre a Tabela Semanal, e misturar
  os dois conceitos de "período" acrescentaria complexidade sem necessidade.
- **Fora de escopo**: aba Demandas (não participa da barra de filtros
  compartilhada nem desta seleção de mês -- sempre mostra o agregado anual
  inteiro).

## Design

### Onde o controle mora

Um novo `<select id="seletor-mes-semanal">` dentro de `MARKUP_ACOES_SEMANAL`
(`tools/semanal/render-semanal.js`), ao lado do botão "Atualizar dados" --
NÃO no `markupFiltros`/`scriptFiltros` compartilhado com o orçamento
(`tools/comum/render-shell.js`), que é código realmente comum aos dois
dashboards e não deve ganhar um conceito que só a semanal usa. 12 opções
fixas (Jan..Dez, valores `"0"`..`"11"`), sem depender de dado nenhum --
não precisa ser montado dinamicamente no cliente, pode nascer no HTML
estático do build.

### Estado no cliente

Nova variável em `SCRIPT_CLIENTE_SEMANAL`:

```js
var mesSelecionadoIdx = Math.max(0, Math.min(11, window.__VIGENTE_IDX__));
```

O `Math.max(0, Math.min(11, ...))` cobre o caso raro em que
`window.__VIGENTE_IDX__` vem fora de `[0,11]` (ano inteiro no passado/futuro
em relação a `geradoEm`, ver `calcularVigenteIdx`) -- sem isso, o `<select>`
nasceria sem nenhuma opção correspondente selecionada.

### Fluxo

1. `montarDashboard` seta `document.getElementById('seletor-mes-semanal').value = String(mesSelecionadoIdx)`
   e liga um listener de `change` que atualiza `mesSelecionadoIdx` e chama
   `recalcularSemanal()` -- mesmo padrão dos outros controles (filtros,
   Balanço).
2. `recalcularSemanal()` (que já centraliza "o que recalcular quando algo
   muda") passa `mesSelecionadoIdx` em vez de `window.__VIGENTE_IDX__` nas
   chamadas a `RenderAbaSemanal.renderAbaSemanal(...)` e
   `montarAbaGraficoSemanal(...)` (que hoje lê `window.__VIGENTE_IDX__`
   direto de dentro da própria função -- também precisa mudar pra receber o
   valor, não ler a constante global).
3. **`atualizarDadosAoVivoSemanal()` (o botão "Atualizar dados") NÃO reseta
   `mesSelecionadoIdx`**: atualizar os dados não deve jogar o usuário de
   volta pro mês vigente se ele estava olhando julho -- só
   `montarTodosFiltrosMultiSemanal` + `recalcularSemanal()` (que já lê o
   estado atual de `mesSelecionadoIdx`, sem mudar).

### Rótulos dos meses

Duplica um array `MESES_PT_SEMANAL` de 3 letras (Jan..Dez) direto no
`SCRIPT_CLIENTE_SEMANAL`, no mesmo espírito de `diaEpoch` já duplicado ali
(ver comentário em `tools/comum/datas.js`) -- é um array de 12 strings
estático, não vale estender `fonteParaCliente()` de `datas.js` só por causa
dele. Usado só pra montar os `<option>` no HTML estático (build-time, Node
já tem `MESES_PT` real em `tools/comum/datas.js` -- usa esse no servidor,
sem duplicar lá).

## Fora de escopo (explícito)

- Não muda `compute-semanal.js`, `render-aba-semanal.js`,
  `render-aba-grafico-semanal.js`, `compute-balanco.js` -- toda a lógica de
  cálculo por mês já existe e já está correta pra qualquer índice.
- Não adiciona um seletor equivalente em `tools/orcamento/render-dashboard.js`
  (arquivo trancado por teste byte-a-byte, e o orçamento já mostra o ano
  inteiro numa tabela só -- não tem o mesmo problema).
- Não muda o botão "Atualizar dados" além de garantir que ele não reseta o
  mês selecionado.
